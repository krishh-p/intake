import type { IntakeChatMessage, IntakeChatResponse } from "@/lib/ai/intakeAgent";
import type {
  AgentStep,
  AskAnswer,
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

/**
 * Yield to the browser between streamed steps so React can paint each
 * intermediate state. Without this, several SSE events arriving in one read are
 * drained within a single microtask burst and only the final frame is painted —
 * making the agent trace appear to "jump" from Thinking… straight to the result.
 */
function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

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

export type SemanticEvidenceRow = {
  ref_type: "fact" | "chunk";
  ref_id: string;
  source_id: string;
  label: string;
  score: number;
};

/**
 * Semantic evidence search. Embeds the query with Supabase's built-in gte-small
 * model and runs a cosine-kNN over the signed-in user's own rows — all in a
 * single Edge Function round trip, off the Vercel hot path. Returns null on any
 * failure (model/edge unavailable, not signed in) so callers fall back to
 * lexical-only retrieval.
 */
export async function searchEvidenceSemantic(
  query: string,
  matchCount = 12,
): Promise<SemanticEvidenceRow[] | null> {
  if (!query.trim()) return [];
  try {
    const { getAuthenticatedSupabase } = await import("@/lib/supabase/client");
    const auth = await getAuthenticatedSupabase();
    if (!auth) return null;
    const { data, error } = await auth.supabase.functions.invoke("evidence-ai", {
      body: { action: "search", query, match_count: matchCount },
    });
    if (error) {
      const { logSupabaseError } = await import("@/lib/supabase/errors");
      logSupabaseError("evidence-ai:search", error);
      return null;
    }
    return ((data as { results?: SemanticEvidenceRow[] } | null)?.results ??
      null) as SemanticEvidenceRow[] | null;
  } catch {
    return null;
  }
}

let indexEmbeddingsQueue: Promise<void> = Promise.resolve();

/**
 * Backfill embeddings for the signed-in user's rows that don't have one yet.
 * Idempotent and best-effort; runs off the hot path (after a sync / on load).
 * Serialized and batched so concurrent callers don't overwhelm the edge function.
 */
export async function indexWorkspaceEmbeddings(): Promise<void> {
  indexEmbeddingsQueue = indexEmbeddingsQueue.then(async () => {
    try {
      const { getAuthenticatedSupabase } = await import("@/lib/supabase/client");
      const auth = await getAuthenticatedSupabase();
      if (!auth) return;

      for (let pass = 0; pass < 12; pass++) {
        const { data, error } = await auth.supabase.functions.invoke("evidence-ai", {
          body: { action: "index" },
        });
        if (error) {
          const { logSupabaseError } = await import("@/lib/supabase/errors");
          logSupabaseError("evidence-ai:index", error);
          return;
        }
        const hasMore = Boolean(
          (data as { hasMore?: boolean } | null)?.hasMore,
        );
        if (!hasMore) return;
      }
    } catch {
      // best-effort: semantic ranking simply won't include un-embedded rows yet
    }
  });
  await indexEmbeddingsQueue;
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
        await yieldToPaint();
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

export async function askHealthAgent(
  patientName: string,
  question: string,
  events: HealthEvent[],
  sources: Source[],
  history?: { role: "user" | "assistant"; content: string }[],
  onStep?: (step: AgentStep) => void,
  signal?: AbortSignal
): Promise<AskAnswer> {
  const res = await fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patientName, question, events, sources, history }),
    signal,
  });

  if (!res.ok || !res.body) {
    let message = "Ask failed";
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
  let answer: AskAnswer | null = null;

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
        answer?: AskAnswer;
        error?: string;
      };

      if (payload.type === "step" && payload.tool) {
        onStep?.({ tool: payload.tool, args: payload.args });
        await yieldToPaint();
      } else if (payload.type === "done" && payload.answer) {
        answer = payload.answer;
      } else if (payload.type === "error") {
        throw new Error(payload.error ?? "Ask failed");
      }
    }
  }

  if (!answer) {
    throw new Error("Ask completed without an answer");
  }

  return answer;
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
