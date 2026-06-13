import { buildTrendTools } from "@/lib/agent/tools";
import {
  grokResponsesCreate,
  isServerSideToolOutput,
  toResponsesTools,
} from "@/lib/ai/xai";
import { buildEvidenceIndex } from "@/lib/index/evidenceIndex";
import type {
  AgentStep,
  HealthEvent,
  ReportSpecialty,
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
- Use web_search for clinical context when helpful: reference ranges, guideline thresholds, what worsening trends typically mean, and evidence-based action suggestions. Prefer trusted medical sources (e.g. NIH, ADA, KDIGO, AHA).
- You may cite web sources in narratives, but evidenceEventIds must come from patient data tools only.
- Every trend in submit_trend_report MUST include evidenceEventIds drawn from tool results only.
- Prioritize clinically meaningful movement (labs/vitals worsening, control slipping, new symptoms).
- For direction: worsening = clinically bad trend (e.g. rising HbA1c, falling eGFR); improving = clinically good; stable = no meaningful change.
- Max 6 trends. Skip metrics with insufficient data.
- When a worsening or clinically meaningful trend warrants specialist attention, set recommendedSpecialty (primary_care, cardiology, nephrology, endocrinology, or pharmacy) and a one-line recommendationReason.
- Finish by calling submit_trend_report exactly once with your final analysis.`;

const VALID_SPECIALTIES = new Set([
  "primary_care",
  "cardiology",
  "nephrology",
  "endocrinology",
  "pharmacy",
]);

type RawTrendInput = {
  metric?: string;
  direction?: Trend["direction"];
  severity?: Trend["severity"];
  changeSummary?: string;
  narrative?: string;
  suggestedActions?: string[];
  evidenceEventIds?: string[];
  recommendedSpecialty?: string;
  recommendationReason?: string;
};

function parseToolArgs(raw?: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function buildTrendReport(
  rawTrends: RawTrendInput[],
  validIds: Set<string>
): TrendReport {
  const trends: Trend[] = rawTrends
    .map((t) => {
      const specialty =
        t.recommendedSpecialty && VALID_SPECIALTIES.has(t.recommendedSpecialty)
          ? (t.recommendedSpecialty as ReportSpecialty)
          : undefined;
      return {
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
        recommendedSpecialty: specialty,
        recommendationReason: specialty
          ? t.recommendationReason?.trim()
          : undefined,
      };
    })
    .filter((t) => t.evidenceEventIds.length > 0);

  return {
    trends,
    generatedAt: new Date().toISOString(),
    method: "agent",
  };
}

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
  const tools = toResponsesTools(schemas, { webSearch: true });

  const initialInput = [
    { role: "system" as const, content: TREND_AGENT_SYSTEM },
    {
      role: "user" as const,
      content: `Patient: ${input.patientName}. Analyze trends across ${input.events.length} health events and ${input.sources.length} sources. Today is ${new Date().toISOString()}.`,
    },
  ];

  const maxSteps = 8;
  let previousResponseId: string | undefined;
  let nextInput: typeof initialInput | Array<{
    type: "function_call_output";
    call_id: string;
    output: string;
  }> = initialInput;
  const emittedSteps = new Set<string>();

  const emitStep = (tool: string, args: Record<string, unknown>, key: string) => {
    if (emittedSteps.has(key)) return;
    emittedSteps.add(key);
    input.onStep?.({ tool, args });
  };

  for (let step = 0; step < maxSteps; step++) {
    emitStep("agent_turn", { turn: step + 1 }, `turn-${step + 1}`);

    const response = await grokResponsesCreate(nextInput, tools, {
      previousResponseId,
      maxTurns: 6,
      onStreamEvent: (event) => {
        if (event.type === "response.output_item.added" && event.item) {
          const item = event.item;
          if (item.type === "web_search_call") {
            emitStep(
              "web_search",
              { query: item.action?.query ?? item.arguments },
              `ws-${item.id ?? item.call_id ?? JSON.stringify(item)}`
            );
          } else if (item.type === "function_call" && item.name) {
            emitStep(
              item.name,
              parseToolArgs(item.arguments),
              `fn-pending-${item.call_id ?? item.id ?? item.name}`
            );
          }
        }

        if (
          event.type === "response.function_call_arguments.done" &&
          event.name
        ) {
          emitStep(
            event.name,
            parseToolArgs(event.arguments),
            `fn-${event.call_id ?? event.name}-${event.arguments ?? ""}`
          );
        }
      },
    });
    previousResponseId = response.id;

    for (const item of response.output) {
      if (isServerSideToolOutput(item)) {
        const toolName = item.name ?? item.type.replace(/_call$/, "");
        emitStep(
          toolName,
          parseToolArgs(item.arguments),
          `srv-${item.call_id ?? toolName}-${item.arguments ?? ""}`
        );
      }
    }

    const functionCalls = response.output.filter(
      (item) => item.type === "function_call"
    );
    if (!functionCalls.length) {
      break;
    }

    const toolOutputs: Array<{
      type: "function_call_output";
      call_id: string;
      output: string;
    }> = [];

    for (const call of functionCalls) {
      const name = call.name ?? "";
      const args = parseToolArgs(call.arguments);
      emitStep(
        name,
        args,
        `fn-${call.call_id ?? name}-${call.arguments ?? ""}`
      );

      if (name === "submit_trend_report") {
        const rawTrends = (args.trends as RawTrendInput[] | undefined) ?? [];
        return buildTrendReport(rawTrends, validIds);
      }

      const executor = executors[name];
      const result = executor
        ? executor(args)
        : { error: `Unknown tool: ${name}` };

      toolOutputs.push({
        type: "function_call_output",
        call_id: call.call_id ?? "",
        output: JSON.stringify(result),
      });
    }

    nextInput = toolOutputs;
  }

  return {
    trends: [],
    generatedAt: new Date().toISOString(),
    method: "fallback",
  };
}
