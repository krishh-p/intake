/**
 * Specialty visit-brief generator (general, data-driven).
 *
 * Builds a pre-visit brief from the patient's actual facts and alerts — no
 * hardcoded patient narrative. Concept→specialty relevance comes from the
 * ontology, summaries are composed dynamically, and lab trends are surfaced
 * direction-aware.
 */

import type {
  DoctorReport,
  HealthEvent,
  ReportSpecialty,
  RiskAlert,
  Source,
} from "@/lib/schema";
import {
  groundConcept,
  interpretLabValue,
  isAbnormalConcerning,
  type GroundedConcept,
  type Specialty,
} from "@/lib/knowledge/ontology";
import { normalizeLabel } from "@/lib/knowledge/normalize";
import { computeTrends, type TrendInput } from "@/lib/knowledge/temporal";

const SPECIALTY_LABELS: Record<ReportSpecialty, string> = {
  primary_care: "Primary Care",
  cardiology: "Cardiology",
  nephrology: "Nephrology",
  endocrinology: "Endocrinology",
  pharmacy: "Pharmacy / Medication Review",
};

const REPORT_TO_SPECIALTY: Record<ReportSpecialty, Specialty> = {
  primary_care: "primary_care",
  cardiology: "cardiology",
  nephrology: "nephrology",
  endocrinology: "endocrinology",
  pharmacy: "pharmacy",
};

function sortByDate(events: HealthEvent[]) {
  return [...events].sort(
    (a, b) => new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime()
  );
}

function filterByType(events: HealthEvent[], types: HealthEvent["type"][]) {
  return events.filter((e) => types.includes(e.type));
}

function isRelevant(concept: GroundedConcept, specialty: ReportSpecialty): boolean {
  if (specialty === "primary_care") return true;
  if (specialty === "pharmacy") return concept.kind === "medication" || concept.kind === "lab";
  return concept.specialties.includes(REPORT_TO_SPECIALTY[specialty]);
}

function filterAlertsForSpecialty(alerts: RiskAlert[], specialty: ReportSpecialty): RiskAlert[] {
  if (specialty === "primary_care") return alerts;
  const target = REPORT_TO_SPECIALTY[specialty].replace("_", " ");
  const keyword = target.split(" ")[0];
  return alerts.filter((a) => a.specialty.some((s) => s.toLowerCase().includes(keyword)));
}

function describeList(items: string[], max = 4): string {
  if (items.length === 0) return "";
  const shown = items.slice(0, max);
  const extra = items.length - shown.length;
  return shown.join(", ") + (extra > 0 ? `, and ${extra} more` : "");
}

export function generateReport(
  specialty: ReportSpecialty,
  patientName: string,
  events: HealthEvent[],
  sources: Source[],
  alerts: RiskAlert[]
): DoctorReport {
  const meds = sortByDate(filterByType(events, ["medication"]));
  const labsAndVitals = sortByDate(filterByType(events, ["lab", "vital"]));
  const symptoms = sortByDate(filterByType(events, ["symptom"]));
  const conditions = sortByDate(filterByType(events, ["condition"]));
  const barriers = sortByDate(filterByType(events, ["barrier"]));
  const careTasks = sortByDate(filterByType(events, ["care_task"]));

  const relevantAlerts = filterAlertsForSpecialty(alerts, specialty);
  const usedSourceIds = new Set(events.map((e) => e.sourceId));
  const evidenceSources = sources.filter((s) => usedSourceIds.has(s.id));

  // Compute trends + flag abnormal labs (direction-aware).
  const trendInputs: TrendInput[] = labsAndVitals.map((e) => ({
    kind: e.type,
    label: e.label,
    normalizedLabel: normalizeLabel(e.label, e.type),
    value: e.value,
    unit: e.unit,
    observedAt: e.observedAt,
  }));
  const trends = computeTrends(trendInputs);
  const worseningTrends = Array.from(trends.values()).filter((t) => t.worsening);

  const abnormalLabs = labsAndVitals.filter((e) => {
    const concept = groundConcept(normalizeLabel(e.label, e.type), e.type);
    return isAbnormalConcerning(concept, interpretLabValue(concept, e.value));
  });

  // Build a dynamic, specialty-aware patient snapshot.
  const conditionNames = conditions.map((c) => normalizeLabel(c.label, c.type));
  const relevantConditions = conditions
    .filter((c) => isRelevant(groundConcept(normalizeLabel(c.label, c.type), c.type), specialty))
    .map((c) => normalizeLabel(c.label, c.type));
  const medNames = meds.map((m) => normalizeLabel(m.label, m.type));
  const symptomNames = Array.from(new Set(symptoms.map((s) => normalizeLabel(s.label, s.type))));

  const summaryParts: string[] = [];
  if (conditionNames.length > 0) {
    summaryParts.push(`${patientName} has a history of ${describeList(conditionNames)}.`);
  } else {
    summaryParts.push(`${patientName}'s record does not list established diagnoses yet.`);
  }
  if (medNames.length > 0) {
    summaryParts.push(`Current medications include ${describeList(medNames)}.`);
  }
  if (worseningTrends.length > 0) {
    summaryParts.push(
      `Worsening trends: ${describeList(
        worseningTrends.map((t) => `${t.label} ${t.first}→${t.last}${t.unit ? ` ${t.unit}` : ""}`)
      )}.`
    );
  } else if (abnormalLabs.length > 0) {
    summaryParts.push(
      `Out-of-range results: ${describeList(abnormalLabs.map((l) => `${normalizeLabel(l.label, l.type)} ${l.value ?? ""}`))}.`
    );
  }
  if (symptomNames.length > 0) {
    summaryParts.push(`Reported symptoms: ${describeList(symptomNames)}.`);
  }
  if (barriers.length > 0) {
    summaryParts.push(`Care barriers noted: ${describeList(barriers.map((b) => b.label))}.`);
  }
  if (specialty !== "primary_care" && relevantConditions.length > 0) {
    summaryParts.push(
      `Most relevant to ${SPECIALTY_LABELS[specialty].toLowerCase()}: ${describeList(relevantConditions)}.`
    );
  }

  // Top concerns: alerts first, then abnormal labs and care gaps.
  const concerns: string[] = [
    ...relevantAlerts.map((a) => a.title),
    ...worseningTrends.map((t) => `${t.label} trending unfavorably (${t.first}→${t.last})`),
    ...abnormalLabs
      .filter((l) => !worseningTrends.some((t) => t.label === normalizeLabel(l.label, l.type)))
      .map((l) => `${normalizeLabel(l.label, l.type)} out of range (${l.value ?? ""})`),
    ...barriers.map((b) => `Care barrier: ${b.label}`),
  ];

  // Questions: from relevant alerts, else sensible defaults.
  const alertQuestions = relevantAlerts.flatMap((a) => a.suggestedQuestions);
  const questions =
    alertQuestions.length > 0
      ? Array.from(new Set(alertQuestions)).slice(0, 5)
      : defaultQuestions(specialty, relevantConditions);

  // Timeline relevant to this specialty.
  const relevantTimeline = sortByDate(
    events.filter((e) => {
      if (specialty === "primary_care") return e.type !== "note";
      const concept = groundConcept(normalizeLabel(e.label, e.type), e.type);
      return isRelevant(concept, specialty) || e.type === "barrier";
    })
  ).slice(0, 10);

  return {
    specialty,
    title: `${SPECIALTY_LABELS[specialty]} Visit Brief — ${patientName}`,
    summary: summaryParts.join(" "),
    topConcerns: dedupe(concerns).slice(0, 5),
    relevantTimeline,
    medications: meds,
    labsAndVitals: labsAndVitals.slice(0, 12),
    patientContext: [...symptoms, ...barriers, ...careTasks],
    questions,
    evidenceSources,
  };
}

function defaultQuestions(specialty: ReportSpecialty, conditions: string[]): string[] {
  const focus = conditions[0] ?? "my overall health";
  return [
    `What should I prioritize for ${focus} before the next visit?`,
    "Are any of my medications interacting or unnecessary?",
    "Which symptoms should prompt urgent attention?",
    `What follow-up or tests do you recommend from a ${SPECIALTY_LABELS[specialty].toLowerCase()} perspective?`,
  ];
}

function dedupe(items: string[]): string[] {
  return Array.from(new Set(items.filter(Boolean)));
}

export function reportToPlainText(report: DoctorReport): string {
  const lines: string[] = [
    report.title,
    "=".repeat(report.title.length),
    "",
    "PATIENT SNAPSHOT",
    report.summary,
    "",
    "TOP CONCERNS",
    ...report.topConcerns.map((c, i) => `${i + 1}. ${c}`),
    "",
    "CURRENT MEDICATIONS",
    ...report.medications.map((m) => `- ${m.label}${m.value ? `: ${m.value}` : ""}`),
    "",
    "RECENT LABS & VITALS",
    ...report.labsAndVitals.map(
      (l) =>
        `- ${l.label}: ${l.value ?? ""}${l.unit ? ` ${l.unit}` : ""} (${new Date(l.observedAt).toLocaleDateString()})`
    ),
    "",
    "PATIENT-REPORTED CONTEXT",
    ...report.patientContext.map((p) => `- ${p.label}${p.value ? `: ${p.value}` : ""}`),
    "",
    "QUESTIONS FOR THIS VISIT",
    ...report.questions.map((q, i) => `${i + 1}. ${q}`),
    "",
    "EVIDENCE SOURCES",
    ...report.evidenceSources.map((s) => `- ${s.title} (${s.type})`),
    "",
    "DISCLAIMER",
    "Generated from patient-provided and imported data. Not a diagnosis. Clinician review required.",
  ];
  return lines.join("\n");
}
