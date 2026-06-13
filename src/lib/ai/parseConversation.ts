import type { IntakeChatMessage } from "@/lib/ai/intakeAgent";
import { formatConversationTranscript } from "@/lib/ai/intakeAgent";
import { grokChat, isAiConfigured, parseJsonResponse } from "@/lib/ai/xai";
import { VALID_EVENT_TYPES } from "@/lib/ai/prompts";
import { parseVoiceTranscript } from "@/lib/ingest/voiceParser";
import type {
  ConversationContext,
  HealthEvent,
  Source,
} from "@/lib/schema";
import { generateId } from "@/lib/utils";

const PARSE_CONVERSATION_SYSTEM = `You parse completed Intake health conversations into structured context for a patient knowledge graph.

Return JSON only:
{
  "context": {
    "title": "short label for this conversation (max 8 words)",
    "summary": "2-3 sentence plain-language summary of what the patient shared",
    "chiefConcern": "the patient's main health concern in one phrase",
    "topics": ["topic tags, e.g. fatigue, kidney care"],
    "symptoms": ["reported symptoms"],
    "medications": ["reported medications or changes"],
    "barriers": ["care access barriers"],
    "concerns": ["worries or questions the patient raised"],
    "followUpItems": ["things to follow up on before next visit"]
  },
  "events": [
    {
      "type": "condition" | "symptom" | "medication" | "lab" | "vital" | "encounter" | "care_task" | "barrier" | "note",
      "label": "short clinical label",
      "value": "optional",
      "unit": "optional",
      "status": "active" | "resolved" | "unknown"
    }
  ]
}

Rules:
- Extract only what the patient explicitly shared.
- Do NOT diagnose.
- events should cover distinct clinical facts mentioned in the conversation.
- context arrays should be concise, deduplicated strings.`;

type ParsedContextPayload = {
  title?: string;
  summary?: string;
  chiefConcern?: string;
  topics?: string[];
  symptoms?: string[];
  medications?: string[];
  barriers?: string[];
  concerns?: string[];
  followUpItems?: string[];
};

type ParsedEvent = {
  type: string;
  label: string;
  value?: string | number;
  unit?: string;
  status?: string;
};

export type ParsedIntakeConversation = {
  source: Source;
  events: HealthEvent[];
  context: ConversationContext;
  method: "ai" | "fallback";
};

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function patientOnlyText(messages: IntakeChatMessage[]): string {
  return messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join(" ");
}

function fallbackContextPayload(
  messages: IntakeChatMessage[],
  events: HealthEvent[]
): ParsedContextPayload {
  const patientText = patientOnlyText(messages);
  const lower = patientText.toLowerCase();

  const symptoms: string[] = [];
  if (/tired|fatigue|exhausted/.test(lower)) symptoms.push("Fatigue");
  if (/swelling|edema/.test(lower)) symptoms.push("Swelling");
  if (/shortness of breath|breathless/.test(lower)) symptoms.push("Shortness of breath");

  const medications: string[] = [];
  if (/ibuprofen|advil|motrin|nsaid/.test(lower)) medications.push("NSAID use");
  if (/lisinopril/.test(lower)) medications.push("Lisinopril");

  const barriers: string[] = [];
  if (/missed|appointment/.test(lower)) barriers.push("Missed appointment");
  if (/insurance/.test(lower)) barriers.push("Insurance issue");
  if (/refill|pharmacy/.test(lower)) barriers.push("Medication refill issue");

  const chiefConcern =
    symptoms[0] ??
    barriers[0] ??
    (patientText.length > 0 ? patientText.slice(0, 80) : "Patient-reported health update");

  return {
    title: "Intake conversation",
    summary:
      patientText.length > 0
        ? patientText.slice(0, 280)
        : "Patient shared health context through an Intake conversation.",
    chiefConcern,
    topics: uniqueStrings([
      ...symptoms.map((s) => `symptom: ${s}`),
      ...medications.map((m) => `medication: ${m}`),
      ...barriers.map((b) => `barrier: ${b}`),
    ]),
    symptoms,
    medications,
    barriers,
    concerns: [],
    followUpItems: events
      .filter((e) => e.type === "care_task")
      .map((e) => e.label)
      .slice(0, 5),
  };
}

function buildContext(
  payload: ParsedContextPayload,
  patientId: string,
  sourceId: string,
  eventIds: string[],
  messageCount: number
): ConversationContext {
  const capturedAt = new Date().toISOString();
  return {
    id: generateId("ctx"),
    patientId,
    sourceId,
    capturedAt,
    title: payload.title?.trim() || "Intake conversation",
    summary:
      payload.summary?.trim() ||
      "Patient shared symptoms, medications, and care context with Intake.",
    chiefConcern: payload.chiefConcern?.trim() || "Patient-reported health update",
    topics: uniqueStrings(payload.topics ?? []),
    symptoms: uniqueStrings(payload.symptoms ?? []),
    medications: uniqueStrings(payload.medications ?? []),
    barriers: uniqueStrings(payload.barriers ?? []),
    concerns: uniqueStrings(payload.concerns ?? []),
    followUpItems: uniqueStrings(payload.followUpItems ?? []),
    eventIds,
    messageCount,
  };
}

function eventsFromParsed(
  parsedEvents: ParsedEvent[],
  patientId: string,
  sourceId: string
): HealthEvent[] {
  const now = new Date().toISOString();
  return parsedEvents
    .filter((e) => e.label && VALID_EVENT_TYPES.includes(e.type as HealthEvent["type"]))
    .map((e) => ({
      id: generateId("evt"),
      patientId,
      sourceId,
      type: e.type as HealthEvent["type"],
      label: e.label,
      value: e.value,
      unit: e.unit,
      observedAt: now,
      status: (["active", "resolved", "unknown"].includes(e.status ?? "")
        ? e.status
        : "active") as HealthEvent["status"],
      metadata: { conversationExtracted: true },
    }));
}

export async function parseIntakeConversation(
  messages: IntakeChatMessage[],
  patientId: string,
  patientName: string
): Promise<ParsedIntakeConversation> {
  const transcript = formatConversationTranscript(messages);
  const sourceId = generateId("src");
  const source: Source = {
    id: sourceId,
    type: "voice",
    title: "Intake conversation — patient-reported context",
    capturedAt: new Date().toISOString(),
    rawText: transcript,
  };

  if (isAiConfigured()) {
    try {
      const raw = await grokChat(
        [
          { role: "system", content: PARSE_CONVERSATION_SYSTEM },
          {
            role: "user",
            content: `Patient: ${patientName}\n\nConversation:\n"""\n${transcript}\n"""`,
          },
        ],
        { json: true, temperature: 0.2 }
      );

      const parsed = parseJsonResponse<{
        context?: ParsedContextPayload;
        events?: ParsedEvent[];
      }>(raw);

      const events = eventsFromParsed(parsed.events ?? [], patientId, sourceId);
      const context = buildContext(
        parsed.context ?? {},
        patientId,
        sourceId,
        events.map((e) => e.id),
        messages.length
      );

      if (events.length > 0) {
        return { source, events, context, method: "ai" };
      }
    } catch {
      // fall through to deterministic parser
    }
  }

  const fallback = parseVoiceTranscript(patientId, patientOnlyText(messages) || transcript);
  const events = fallback.events.map((event) => ({
    ...event,
    sourceId,
    metadata: { ...event.metadata, conversationExtracted: true },
  }));

  const context = buildContext(
    fallbackContextPayload(messages, events),
    patientId,
    sourceId,
    events.map((e) => e.id),
    messages.length
  );

  return { source, events, context, method: "fallback" };
}
