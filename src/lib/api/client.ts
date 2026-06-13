import type { IntakeChatMessage, IntakeChatResponse } from "@/lib/ai/intakeAgent";
import type {
  ConversationContext,
  DoctorReport,
  GraphEdge,
  GraphNode,
  HealthEvent,
  ReportSpecialty,
  RiskAlert,
  Source,
  SourceType,
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
