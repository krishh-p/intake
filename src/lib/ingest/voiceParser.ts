import type { HealthEvent, Source } from "@/lib/schema";
import { generateId } from "@/lib/utils";

export function parseVoiceTranscript(
  patientId: string,
  transcript: string
): { source: Source; events: HealthEvent[] } {
  if (!transcript.trim()) {
    throw new Error("Transcript is required.");
  }

  const source: Source = {
    id: generateId("src"),
    type: "voice",
    title: "Voice note — patient-reported context",
    capturedAt: new Date().toISOString(),
    rawText: transcript,
  };

  const now = new Date().toISOString();
  const lower = transcript.toLowerCase();
  const events: HealthEvent[] = [];

  if (/tired|fatigue|exhausted/.test(lower)) {
    events.push({
      id: generateId("evt"),
      patientId,
      sourceId: source.id,
      type: "symptom",
      label: "Fatigue",
      observedAt: now,
      status: "active",
    });
  }

  if (/swelling|edema/.test(lower)) {
    events.push({
      id: generateId("evt"),
      patientId,
      sourceId: source.id,
      type: "symptom",
      label: "Swelling",
      observedAt: now,
      status: "active",
    });
  }

  if (/shortness of breath|breathless|sob/.test(lower)) {
    events.push({
      id: generateId("evt"),
      patientId,
      sourceId: source.id,
      type: "symptom",
      label: "Shortness of breath",
      observedAt: now,
      status: "active",
    });
  }

  if (/ibuprofen|advil|motrin|nsaid/.test(lower)) {
    events.push({
      id: generateId("evt"),
      patientId,
      sourceId: source.id,
      type: "medication",
      label: "NSAID use",
      value: "Self-reported",
      observedAt: now,
      status: "active",
    });
  }

  if (/missed|insurance|appointment/.test(lower)) {
    events.push({
      id: generateId("evt"),
      patientId,
      sourceId: source.id,
      type: "barrier",
      label: "Care access barrier",
      observedAt: now,
      status: "active",
      metadata: { raw: transcript },
    });
  }

  if (/refill|pharmacy/.test(lower)) {
    events.push({
      id: generateId("evt"),
      patientId,
      sourceId: source.id,
      type: "barrier",
      label: "Medication refill issue",
      observedAt: now,
      status: "active",
    });
  }

  if (events.length === 0) {
    events.push({
      id: generateId("evt"),
      patientId,
      sourceId: source.id,
      type: "note",
      label: "Patient-reported context",
      value: transcript.slice(0, 200),
      observedAt: now,
    });
  }

  return { source, events };
}
