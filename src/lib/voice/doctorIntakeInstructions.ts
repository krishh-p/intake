import { INTAKE_TURN_DETECTION } from "@/lib/voice/intakeVoiceInstructions";
import type { ReportSpecialty } from "@/lib/schema";

export { INTAKE_TURN_DETECTION };

const SPECIALTY_THEMES: Record<ReportSpecialty, string> = {
  primary_care:
    "overall health picture, medications, recent symptoms, care coordination, and barriers to follow-up",
  cardiology:
    "chest symptoms, shortness of breath, swelling, blood pressure, heart-related medications, and activity tolerance",
  nephrology:
    "kidney labs, fluid retention, blood pressure, medications affecting kidneys (NSAIDs, ACE inhibitors), and missed kidney follow-ups",
  endocrinology:
    "blood sugar control, HbA1c trends, diabetes medications, weight changes, and how kidney or heart issues affect diabetes care",
  pharmacy:
    "all current medications including OTC, recent changes, refill delays, side effects, and medication interactions",
};

const SPECIALTY_LABELS: Record<ReportSpecialty, string> = {
  primary_care: "primary care",
  cardiology: "cardiology",
  nephrology: "nephrology",
  endocrinology: "endocrinology",
  pharmacy: "pharmacy",
};

export function specialtyLabel(specialty: ReportSpecialty): string {
  return SPECIALTY_LABELS[specialty];
}

const DOCTOR_INTAKE_BASE = `You are Intake, conducting a preliminary specialist intake before a patient's appointment.

Your role: ask the questions a {specialty} clinician would want answered before the visit — not to diagnose, but to gather structured context.

Voice rules:
- Keep every reply to 1-2 short sentences, then stop talking.
- Ask exactly one question per turn. No lists, no recaps, no repeating what the patient just said.
- Plain, warm language. Never diagnose or give medical advice.
- Use the patient's first name at most once every few turns.
- The patient may pause to think — that is normal. Do not fill silence.
- Cover: {themes}
- After 4-6 useful exchanges, briefly say they can end the session when ready.`;

export function buildDoctorIntakeInstructions(
  patientName: string,
  specialty: ReportSpecialty,
  focus?: { metric?: string; changeSummary?: string }
): string {
  const firstName = patientName.trim().split(/\s+/)[0] || "there";
  const label = SPECIALTY_LABELS[specialty];
  const themes = SPECIALTY_THEMES[specialty];
  const focusLine = focus?.metric
    ? `\nFocus area from their health data: ${focus.metric}${focus.changeSummary ? ` — ${focus.changeSummary}` : ""}. Weave this into your questions naturally.`
    : "";

  return `${DOCTOR_INTAKE_BASE.replace("{specialty}", label).replace("{themes}", themes)}

Patient name: ${patientName}. Use "${firstName}" occasionally.${focusLine}

Opening: one brief greeting, say you're helping prepare for their ${label} visit, then ask a single opening question. Keep it under 25 words.`;
}
