/**
 * Risk engine (general, ontology-driven).
 *
 * Derives transparent, source-backed risk alerts from any patient's data by
 * reasoning over the clinical knowledge base rather than hardcoded scenarios:
 *   - Medication ↔ condition contraindications.
 *   - Medication ↔ medication interactions.
 *   - Out-of-range labs/vitals (direction-aware).
 *   - Worsening lab trends.
 *   - Care-access barriers.
 *   - Drug–lab monitoring gaps.
 */

import type { HealthEvent, RiskAlert } from "@/lib/schema";
import {
  CONTRAINDICATION_RULES,
  INTERACTION_RULES,
  groundConcept,
  interpretLabValue,
  isAbnormalConcerning,
  parseBloodPressure,
  type GroundedConcept,
  type Severity,
  type Specialty,
} from "@/lib/knowledge/ontology";
import { normalizeLabel } from "@/lib/knowledge/normalize";
import { computeTrends, type TrendInput } from "@/lib/knowledge/temporal";
import { stableId } from "@/lib/utils";

type GroundedEvent = {
  event: HealthEvent;
  concept: GroundedConcept;
};

function ground(events: HealthEvent[]): GroundedEvent[] {
  return events.map((event) => ({
    event,
    concept: groundConcept(normalizeLabel(event.label, event.type), event.type),
  }));
}

function specialtyLabels(specialties: Specialty[]): string[] {
  const map: Record<Specialty, string> = {
    primary_care: "primary care",
    cardiology: "cardiology",
    nephrology: "nephrology",
    endocrinology: "endocrinology",
    pharmacy: "pharmacy",
    pulmonology: "pulmonology",
    psychiatry: "psychiatry",
    gastroenterology: "gastroenterology",
    neurology: "neurology",
    rheumatology: "rheumatology",
  };
  return specialties.map((s) => map[s]);
}

export function evaluateRiskRules(events: HealthEvent[]): RiskAlert[] {
  const grounded = ground(events);
  const meds = grounded.filter((g) => g.event.type === "medication");
  const conditions = grounded.filter((g) => g.event.type === "condition");
  const labsVitals = grounded.filter((g) => g.event.type === "lab" || g.event.type === "vital");
  const barriers = grounded.filter((g) => g.event.type === "barrier");

  const alerts: RiskAlert[] = [];
  const seen = new Set<string>();
  const push = (alert: RiskAlert) => {
    const key = alert.title.toLowerCase();
    if (seen.has(key) || alert.evidenceEventIds.length === 0) return;
    seen.add(key);
    alerts.push(alert);
  };

  // 1. Medication ↔ condition contraindications.
  for (const med of meds) {
    const classes = med.concept.classes ?? [];
    for (const rule of CONTRAINDICATION_RULES) {
      if (!classes.includes(rule.drugClass)) continue;
      const condMatches = conditions.filter(
        (c) =>
          (rule.condition.canonical && c.concept.canonical === rule.condition.canonical) ||
          (rule.condition.category && c.concept.category === rule.condition.category)
      );
      if (condMatches.length === 0) continue;
      const condition = condMatches[0];
      push({
        id: stableId("alert", `contra:${rule.id}:${med.concept.canonical}`),
        severity: rule.severity,
        title: `${med.concept.canonical} with ${condition.concept.canonical}`,
        timeHorizon: rule.severity === "high" ? "Now" : "Next 2 weeks",
        specialty: specialtyLabels(rule.specialties),
        explanation: rule.rationale,
        evidenceEventIds: [med.event.id, ...condMatches.map((c) => c.event.id)],
        suggestedQuestions: rule.questions,
      });
    }
  }

  // 2. Medication ↔ medication interactions.
  for (let i = 0; i < meds.length; i++) {
    for (let j = i + 1; j < meds.length; j++) {
      const a = meds[i];
      const b = meds[j];
      const ca = a.concept.classes ?? [];
      const cb = b.concept.classes ?? [];
      for (const rule of INTERACTION_RULES) {
        const direct = ca.includes(rule.classA) && cb.includes(rule.classB);
        const swapped = ca.includes(rule.classB) && cb.includes(rule.classA);
        if (!direct && !swapped) continue;
        push({
          id: stableId("alert", `inter:${rule.id}:${a.concept.canonical}:${b.concept.canonical}`),
          severity: rule.severity,
          title: `${a.concept.canonical} + ${b.concept.canonical} interaction`,
          timeHorizon: rule.severity === "high" ? "Now" : "Next 2 weeks",
          specialty: specialtyLabels(rule.specialties),
          explanation: rule.rationale,
          evidenceEventIds: [a.event.id, b.event.id],
          suggestedQuestions: rule.questions,
        });
      }
    }
  }

  // 3. Out-of-range labs/vitals (latest reading per concept).
  const latestByLab = new Map<string, GroundedEvent>();
  for (const g of labsVitals) {
    const key = g.concept.canonical;
    const prev = latestByLab.get(key);
    if (!prev || new Date(g.event.observedAt) > new Date(prev.event.observedAt)) {
      latestByLab.set(key, g);
    }
  }
  for (const [, g] of latestByLab) {
    const bp = parseBloodPressure(g.event.value);
    if (g.concept.canonical === "Blood pressure" && bp) {
      if (bp.systolic >= 140 || bp.diastolic >= 90) {
        push({
          id: stableId("alert", `bp:${g.event.id}`),
          severity: bp.systolic >= 160 || bp.diastolic >= 100 ? "high" : "medium",
          title: "Elevated blood pressure",
          timeHorizon: "Next 2 weeks",
          specialty: ["primary care", "cardiology"],
          explanation: `Most recent blood pressure was ${bp.systolic}/${bp.diastolic} mmHg, above the usual ≥140/90 threshold for concern.`,
          evidenceEventIds: [g.event.id],
          suggestedQuestions: [
            "Is my blood pressure regimen still adequate?",
            "Should I monitor my blood pressure at home?",
          ],
        });
      }
      continue;
    }
    const flag = interpretLabValue(g.concept, g.event.value);
    if (isAbnormalConcerning(g.concept, flag)) {
      push({
        id: stableId("alert", `lab:${g.event.id}`),
        severity: "medium",
        title: `${g.concept.canonical} out of range`,
        timeHorizon: "Next 2 weeks",
        specialty: specialtyLabels(g.concept.specialties.length ? g.concept.specialties : ["primary_care"]),
        explanation: `Most recent ${g.concept.canonical} of ${g.event.value}${g.event.unit ? ` ${g.event.unit}` : ""} is ${flag} relative to its reference range.`,
        evidenceEventIds: [g.event.id],
        suggestedQuestions: [
          `What is causing my ${g.concept.canonical} to be ${flag}?`,
          "Do I need a repeat test or treatment change?",
        ],
      });
    }
  }

  // 4. Worsening lab trends.
  const trendInputs: TrendInput[] = labsVitals.map((g) => ({
    kind: g.event.type,
    label: g.event.label,
    normalizedLabel: g.concept.canonical,
    value: g.event.value,
    unit: g.event.unit,
    observedAt: g.event.observedAt,
  }));
  const trends = computeTrends(trendInputs);
  for (const [, trend] of trends) {
    if (!trend.worsening) continue;
    const related = labsVitals.filter((g) => g.concept.canonical === trend.label);
    push({
      id: stableId("alert", `trend:${trend.label}`),
      severity: "medium",
      title: `${trend.label} worsening trend`,
      timeHorizon: "Next 90 days",
      specialty: specialtyLabels(
        related[0]?.concept.specialties.length ? related[0].concept.specialties : ["primary_care"]
      ),
      explanation: `${trend.label} has moved ${trend.direction} from ${trend.first} to ${trend.last}${trend.unit ? ` ${trend.unit}` : ""} across ${trend.points} readings, a clinically unfavorable direction.`,
      evidenceEventIds: related.map((g) => g.event.id),
      suggestedQuestions: [
        `Why is my ${trend.label} trending the wrong way?`,
        "Does my treatment plan need to change?",
      ],
    });
  }

  // 5. Drug–lab monitoring gaps.
  for (const med of meds) {
    const monitor = med.concept.monitorLabs ?? [];
    if (monitor.length === 0) continue;
    const missing = monitor.filter(
      (lab) => !labsVitals.some((g) => g.concept.canonical === lab)
    );
    if (missing.length === monitor.length && monitor.length > 0) {
      push({
        id: stableId("alert", `monitor:${med.concept.canonical}`),
        severity: "low",
        title: `Monitoring gap for ${med.concept.canonical}`,
        timeHorizon: "Next visit",
        specialty: ["pharmacy", "primary care"],
        explanation: `${med.concept.canonical} typically requires monitoring of ${monitor.join(", ")}, but no recent results are on file.`,
        evidenceEventIds: [med.event.id],
        suggestedQuestions: [`Should I have ${monitor.join(" or ")} checked?`],
      });
    }
  }

  // 6. Care-access barriers.
  for (const barrier of barriers) {
    push({
      id: stableId("alert", `barrier:${barrier.event.id}`),
      severity: "medium",
      title: `Care barrier: ${barrier.event.label}`,
      timeHorizon: "Next appointment",
      specialty: ["primary care"],
      explanation: `A reported barrier ("${barrier.event.label}") may be interrupting needed care or medication.`,
      evidenceEventIds: [barrier.event.id],
      suggestedQuestions: [
        "Can you help me resolve this barrier to care?",
        "What should I do in the meantime?",
      ],
    });
  }

  const severityOrder: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  return alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}

export function getSourceTypesForAlert(
  alert: RiskAlert,
  events: HealthEvent[],
  sources: { id: string; type: string }[]
): string[] {
  const eventIds = new Set(alert.evidenceEventIds);
  const sourceIds = new Set(
    events.filter((e) => eventIds.has(e.id)).map((e) => e.sourceId)
  );
  const types = new Set<string>();
  for (const source of sources) {
    if (sourceIds.has(source.id)) {
      types.add(source.type);
    }
  }
  return Array.from(types);
}
