import { buildTrendTools } from "@/lib/agent/tools";
import {
  grokChatWithTools,
  type GrokToolMessage,
} from "@/lib/ai/xai";
import { buildEvidenceIndex } from "@/lib/index/evidenceIndex";
import type {
  AgentStep,
  HealthEvent,
  Source,
  Trend,
  TrendReport,
} from "@/lib/schema";
import { generateId } from "@/lib/utils";

const TREND_AGENT_SYSTEM = `You are Trend Scout, a health-trend analyst for Intake, a patient-owned health app.
Your job: find the most important trends in the patient's recent data and tie each to concrete actions the patient can take.

Hard rules:
- NEVER invent numbers. Get every value, slope, and percentage from compute_trend or get_metric_series.
- Investigate before concluding: call list_metrics first, then compute_trend on clinically meaningful metrics.
- Use search_evidence and get_risk_alerts to ground narratives and actions in the patient's own records.
- Every trend in submit_trend_report MUST include evidenceEventIds drawn from tool results only.
- Prioritize clinically meaningful movement (labs/vitals worsening, control slipping, new symptoms).
- For direction: worsening = clinically bad trend (e.g. rising HbA1c, falling eGFR); improving = clinically good; stable = no meaningful change.
- Max 6 trends. Skip metrics with insufficient data.
- Finish by calling submit_trend_report exactly once with your final analysis.`;

type RawTrendInput = {
  metric?: string;
  direction?: Trend["direction"];
  severity?: Trend["severity"];
  changeSummary?: string;
  narrative?: string;
  suggestedActions?: string[];
  evidenceEventIds?: string[];
};

export async function runTrendAgent(input: {
  patientName: string;
  events: HealthEvent[];
  sources: Source[];
  onStep?: (step: AgentStep) => void;
}): Promise<TrendReport> {
  const index = buildEvidenceIndex(input.sources, input.events);
  const { schemas, executors } = buildTrendTools(
    input.events,
    input.sources,
    index
  );
  const validIds = new Set(input.events.map((e) => e.id));

  const messages: GrokToolMessage[] = [
    { role: "system", content: TREND_AGENT_SYSTEM },
    {
      role: "user",
      content: `Patient: ${input.patientName}. Analyze trends across ${input.events.length} health events and ${input.sources.length} sources. Today is ${new Date().toISOString()}.`,
    },
  ];

  const maxSteps = 8;

  for (let step = 0; step < maxSteps; step++) {
    const msg = await grokChatWithTools(messages, schemas, {
      toolChoice: step === maxSteps - 1 ? "required" : "auto",
    });
    messages.push(msg);

    if (!msg.tool_calls?.length) {
      break;
    }

    for (const call of msg.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}") as Record<
          string,
          unknown
        >;
      } catch {
        args = {};
      }

      input.onStep?.({ tool: call.function.name, args });

      if (call.function.name === "submit_trend_report") {
        const rawTrends = (args.trends as RawTrendInput[] | undefined) ?? [];
        const trends: Trend[] = rawTrends
          .map((t) => ({
            id: generateId("trend"),
            metric: t.metric ?? "Unknown",
            direction: t.direction ?? "stable",
            severity: t.severity ?? "low",
            changeSummary: t.changeSummary ?? "",
            narrative: t.narrative ?? "",
            suggestedActions: t.suggestedActions ?? [],
            evidenceEventIds: (t.evidenceEventIds ?? []).filter((id) =>
              validIds.has(id)
            ),
          }))
          .filter((t) => t.evidenceEventIds.length > 0);

        return {
          trends,
          generatedAt: new Date().toISOString(),
          method: "agent",
        };
      }

      const executor = executors[call.function.name];
      const result = executor
        ? executor(args)
        : { error: `Unknown tool: ${call.function.name}` };

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  return {
    trends: [],
    generatedAt: new Date().toISOString(),
    method: "fallback",
  };
}
