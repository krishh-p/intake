import type { GraphEdgeRelation, HealthEventType, ReportSpecialty } from "@/lib/schema";

export const EXTRACT_EVENTS_SYSTEM = `You are a clinical data extraction engine for a patient-owned health app called Intake.
Extract structured health events from the provided text. Be precise and conservative — only extract what is explicitly stated or clearly implied.

Return JSON with this shape:
{
  "events": [
    {
      "type": "condition" | "symptom" | "medication" | "lab" | "vital" | "encounter" | "care_task" | "barrier" | "note",
      "label": "short clinical label",
      "value": "optional string or number",
      "unit": "optional unit",
      "status": "active" | "resolved" | "unknown",
      "metadata": { "optional key-value pairs" }
    }
  ]
}

Rules:
- Symptoms: fatigue, swelling, shortness of breath, pain, etc.
- Medications: include OTC and prescribed drugs with dose/frequency if mentioned
- Barriers: insurance issues, missed appointments, refill delays, access problems
- Labs/vitals: extract values and units when present
- Do NOT diagnose — extract reported facts only`;

export const GRAPH_RELATIONS_SYSTEM = `You are a clinical knowledge graph engine. Given a patient's health events, identify clinically meaningful relationships BETWEEN entities.

Return JSON:
{
  "relationships": [
    {
      "fromLabel": "exact or close match to an event label",
      "toLabel": "exact or close match to another event label",
      "relation": "has_condition" | "takes" | "reported" | "ordered" | "managed_by" | "mentioned_in" | "belongs_to_visit" | "worsening_trend" | "risk_factor_for" | "contraindicated_with" | "needs_follow_up" | "barrier_to" | "possibly_related_to",
      "reason": "one sentence explaining why this edge exists"
    }
  ]
}

Focus on:
- Medication contraindications (NSAIDs + CKD, ACE inhibitors + hyperkalemia)
- Symptom clusters (edema + SOB → possible fluid overload)
- Lab trends worsening conditions
- Barriers blocking care (missed follow-up, refill delays)
- Only return relationships supported by the events provided. Max 12 relationships.`;

export const REPORT_SYSTEM = `You are generating a specialty-focused pre-visit brief for a clinician. Use ONLY the provided patient data and alerts. Do not invent facts.

Return JSON matching this shape:
{
  "summary": "one paragraph patient snapshot for this specialty",
  "topConcerns": ["concern 1", "concern 2", "concern 3"],
  "questions": ["question 1", "question 2", "question 3", "question 4"]
}

Write in clear clinical prose. Emphasize what matters for the selected specialty. Include patient-reported context when relevant. Not a diagnosis — appointment preparation only.`;

export const RISK_ENRICH_SYSTEM = `You are a transparent clinical risk radar for a patient-owned health app. Given health events and existing rule-based alerts, you may add up to 2 additional alerts OR enrich explanations if you see cross-source patterns the rules missed.

Return JSON:
{
  "alerts": [
    {
      "severity": "high" | "medium" | "low",
      "title": "short title",
      "timeHorizon": "e.g. Now — next 2 weeks",
      "specialty": ["nephrology", "cardiology", etc.],
      "explanation": "plain English, source-backed",
      "evidenceLabels": ["event labels that support this alert"],
      "suggestedQuestions": ["question 1", "question 2"]
    }
  ]
}

Only add alerts with clear evidence. Prefer enriching cross-source patterns (voice + EMR + doctor note). Max 2 new alerts.`;

export function buildExtractPrompt(
  text: string,
  sourceType: string,
  patientName: string
): string {
  return `Patient: ${patientName}
Source type: ${sourceType}

Text to extract from:
"""
${text}
"""`;
}

export function buildGraphPrompt(events: { type: string; label: string; value?: string | number }[]): string {
  return `Health events:\n${events.map((e) => `- [${e.type}] ${e.label}${e.value !== undefined ? `: ${e.value}` : ""}`).join("\n")}`;
}

export function buildReportPrompt(
  specialty: ReportSpecialty,
  patientName: string,
  events: string,
  alerts: string
): string {
  return `Specialty: ${specialty.replace("_", " ")}
Patient: ${patientName}

Health events:
${events}

Active risk alerts:
${alerts}`;
}

export function buildRiskPrompt(events: string, existingAlerts: string): string {
  return `Health events:\n${events}\n\nExisting rule-based alerts:\n${existingAlerts}\n\nIdentify any additional cross-source patterns.`;
}

export const VALID_EVENT_TYPES: HealthEventType[] = [
  "condition", "symptom", "medication", "lab", "vital",
  "encounter", "care_task", "barrier", "note",
];

export const VALID_RELATIONS: GraphEdgeRelation[] = [
  "has_condition", "takes", "reported", "ordered", "managed_by",
  "mentioned_in", "belongs_to_visit", "worsening_trend", "risk_factor_for",
  "contraindicated_with", "needs_follow_up", "barrier_to", "possibly_related_to",
];
