import type { IntakeChatMessage, IntakeChatResponse } from "@/lib/ai/intakeAgent";
import type {
  AgentStep,
  ConversationContext,
  DoctorReport,
  GraphEdge,
  GraphNode,
  HealthEvent,
  ReportSpecialty,
  RiskAlert,
  Source,
  SourceType,
  TrendReport,
} from "@/lib/schema";
import type { DoctorNoteInput } from "@/lib/ingest/doctorNoteParser";

export async function checkAiHealth(): Promise<{
  aiConfigured: boolean;
  model: string;
}> {
  const res = await fetch("/api/health");
  if (!res.ok) return { aiConfigured: false, model: "unknown" };
  return res.json();
}

export async function chatWithIntake(
  patientName: string,
  messages: IntakeChatMessage[]
): Promise<IntakeChatResponse> {
  const res = await fetch("/api/intake/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patientName, messages }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error ?? "Chat failed");
  }
  return res.json();
}

export async function finalizeIntakeConversation(
  messages: IntakeChatMessage[],
  patientId: string,
  patientName: string
): Promise<{
  source: Source;
  events: HealthEvent[];
  context: ConversationContext;
  method: string;
}> {
  const res = await fetch("/api/intake/finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, patientId, patientName }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error ?? "Conversation parse failed");
  }
  return res.json();
}

export async function extractFromText(
  text: string,
  sourceType: SourceType,
  patientId: string,
  patientName: string
): Promise<{ source: Source; events: HealthEvent[]; method: string }> {
  const res = await fetch("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, sourceType, patientId, patientName }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error ?? "Extraction failed");
  }
  return res.json();
}

export async function analyzeGraph(
  patientName: string,
  events: HealthEvent[],
  sources: Source[],
  contexts: ConversationContext[] = []
): Promise<{
  nodes: GraphNode[];
  edges: GraphEdge[];
  aiEdgeCount: number;
  method: string;
}> {
  const res = await fetch("/api/graph/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patientName, events, sources, contexts }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error ?? "Graph analysis failed");
  }
  return res.json();
}

export async function analyzeRisk(
  events: HealthEvent[]
): Promise<{ alerts: RiskAlert[]; method: string }> {
  const res = await fetch("/api/risk/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error ?? "Risk analysis failed");
  }
  return res.json();
}

export async function generateAiReport(
  specialty: ReportSpecialty,
  patientName: string,
  events: HealthEvent[],
  sources: Source[],
  alerts: RiskAlert[]
): Promise<{ report: DoctorReport; method: string }> {
  const res = await fetch("/api/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ specialty, patientName, events, sources, alerts }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error ?? "Report generation failed");
  }
  return res.json();
}

export async function buildReportFromIntake(input: {
  specialty: ReportSpecialty;
  patientName: string;
  patientId: string;
  messages: IntakeChatMessage[];
  events: HealthEvent[];
  sources: Source[];
  alerts: RiskAlert[];
}): Promise<{ report: DoctorReport; method: string }> {
  const res = await fetch("/api/reports/from-intake", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error ?? "Report from intake failed");
  }
  return res.json();
}

export async function runTrendAgent(
  patientName: string,
  events: HealthEvent[],
  sources: Source[],
  onStep?: (step: AgentStep) => void
): Promise<TrendReport> {
  const res = await fetch("/api/trends/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patientName, events, sources }),
  });

  if (!res.ok || !res.body) {
    let message = "Trend analysis failed";
    try {
      const text = await res.text();
      const match = text.match(/data: (.+)/);
      if (match) {
        const parsed = JSON.parse(match[1]) as { error?: string };
        message = parsed.error ?? message;
      }
    } catch {
      // ignore parse errors
    }
    throw new Error(message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let report: TrendReport | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      const payload = JSON.parse(line.slice(5).trim()) as {
        type: string;
        tool?: string;
        args?: unknown;
        report?: TrendReport;
        error?: string;
      };

      if (payload.type === "step" && payload.tool) {
        onStep?.({ tool: payload.tool, args: payload.args });
      } else if (payload.type === "done" && payload.report) {
        report = payload.report;
      } else if (payload.type === "error") {
        throw new Error(payload.error ?? "Trend analysis failed");
      }
    }
  }

  if (!report) {
    throw new Error("Trend analysis completed without a report");
  }

  return report;
}

export function doctorNoteToText(input: DoctorNoteInput): string {
  const parts = [
    `Clinician: ${input.clinicianName} (${input.specialty})`,
    `Note: ${input.note}`,
  ];
  if (input.followUp) parts.push(`Follow-up: ${input.followUp}`);
  if (input.lab) parts.push(`Labs: ${input.lab}`);
  if (input.medicationChange) parts.push(`Medication: ${input.medicationChange}`);
  return parts.join("\n");
}
