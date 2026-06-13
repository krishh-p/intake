import type { HealthEvent } from "@/lib/schema";

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter((v) => v && v.trim())));
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function withValue(e: HealthEvent): string {
  const value =
    e.value !== undefined && e.value !== null && `${e.value}`.trim()
      ? ` ${e.value}${e.unit ? ` ${e.unit}` : ""}`
      : "";
  return `${e.label}${value}`;
}

/**
 * Compact, plain-text summary of the patient's records for grounding the
 * realtime voice model (which cannot run the knowledge-graph tools live).
 */
export function summarizePatientHealth(events: HealthEvent[]): string {
  if (!events.length) return "";
  const lines: string[] = [];

  const conditions = events.filter(
    (e) => e.type === "condition" && e.status !== "resolved",
  );
  if (conditions.length) {
    lines.push(`Active conditions: ${unique(conditions.map((e) => e.label)).join(", ")}`);
  }

  const meds = events.filter(
    (e) => e.type === "medication" && e.status !== "resolved",
  );
  if (meds.length) {
    lines.push(`Current medications: ${unique(meds.map(withValue)).join(", ")}`);
  }

  const measurements = [...events]
    .filter((e) => e.type === "lab" || e.type === "vital")
    .sort(
      (a, b) =>
        new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime(),
    );
  const latest = new Map<string, HealthEvent>();
  for (const e of measurements) latest.set(e.label, e); // last write = most recent
  if (latest.size) {
    lines.push(
      `Recent labs & vitals: ${[...latest.values()]
        .slice(-14)
        .map((e) => `${withValue(e)} (${fmtDate(e.observedAt)})`)
        .join("; ")}`,
    );
  }

  const symptoms = events.filter((e) => e.type === "symptom");
  if (symptoms.length) {
    lines.push(
      `Reported symptoms: ${unique(symptoms.map((e) => e.label)).slice(0, 10).join(", ")}`,
    );
  }

  return lines.join("\n");
}

export function buildAskVoiceInstructions(
  patientName: string,
  context: string,
): string {
  const firstName = patientName.trim().split(/\s+/)[0] || "there";
  return `You are Intake's health companion, talking with ${patientName} by voice about their own health.

You have a summary of their personal health records below. Answer their questions using ONLY this information, plus general, well-established health knowledge for context. Be warm, clear, and conversational.

Voice rules:
- Keep replies to 2-4 short sentences. Avoid long lists.
- Plain, friendly language. You are not a doctor — explain what their records show and suggest discussing specifics with their clinician. Never diagnose or prescribe.
- If their records don't cover something, say so honestly.
- Use "${firstName}" occasionally, not every turn.
- The patient may pause to think — that's fine, don't fill silence.

Patient health summary:
${context || "No records are available yet."}

Opening: greet them briefly, mention you can answer questions about their health records, and invite their first question. Keep it under 25 words.`;
}
