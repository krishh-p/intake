/**
 * Relationship inference (general, ontology-driven).
 *
 * Replaces per-patient hardcoded edges with a general engine that reasons over
 * whatever entities exist using the clinical knowledge base:
 *   - Drug-class ↔ condition contraindications.
 *   - Drug-class ↔ drug-class interactions.
 *   - Condition → condition risk-factor associations.
 *   - Lab → condition worsening trends (direction-aware).
 *   - Symptom clustering within an organ system.
 *   - Barriers linked to the care they obstruct.
 *
 * Every edge is schema-validated (domain/range), carries evidence facts +
 * provenance, a clinical rationale, and a confidence that downgrades to
 * "needs_review" when evidence is uncertain.
 */

import type {
  ClinicalFact,
  Entity,
  GraphEdgeRelation,
  GraphRelationship,
  ReviewItem,
  TrendSummary,
} from "@/lib/schema";
import {
  CONTRAINDICATION_RULES,
  INTERACTION_RULES,
  type Severity,
} from "@/lib/knowledge/ontology";
import { isRelationValid } from "@/lib/knowledge/graphSchema";
import { similarity } from "@/lib/knowledge/entityResolution";
import { computeTrends } from "@/lib/knowledge/temporal";
import { stableId } from "@/lib/utils";

/** condition → conditions it is a recognized risk factor for. */
const CONDITION_RISK_LINKS: Array<{ from: string; to: string }> = [
  { from: "Type 2 diabetes", to: "Chronic kidney disease" },
  { from: "Hypertension", to: "Chronic kidney disease" },
  { from: "Hypertension", to: "Heart failure" },
  { from: "Hypertension", to: "Coronary artery disease" },
  { from: "Type 2 diabetes", to: "Coronary artery disease" },
  { from: "Hyperlipidemia", to: "Coronary artery disease" },
  { from: "Coronary artery disease", to: "Heart failure" },
  { from: "Atrial fibrillation", to: "Heart failure" },
  { from: "Chronic kidney disease", to: "Hyperkalemia" },
  { from: "Chronic kidney disease", to: "Anemia" },
];

/** lab canonical → condition (canonical or category) it tracks. */
const LAB_CONDITION_LINKS: Array<{ lab: string; condition?: string; category?: string }> = [
  { lab: "eGFR", category: "renal" },
  { lab: "Creatinine", category: "renal" },
  { lab: "HbA1c", category: "metabolic" },
  { lab: "Glucose", category: "metabolic" },
  { lab: "LDL", condition: "Hyperlipidemia" },
  { lab: "Blood pressure", condition: "Hypertension" },
  { lab: "Potassium", condition: "Hyperkalemia" },
  { lab: "TSH", condition: "Hypothyroidism" },
];

const SEVERITY_CONFIDENCE: Record<Severity, number> = { high: 0.9, medium: 0.8, low: 0.7 };

function factsForEntities(facts: ClinicalFact[], entities: Entity[]): ClinicalFact[] {
  const ids = new Set(entities.flatMap((entity) => entity.factIds));
  return facts.filter((fact) => ids.has(fact.id));
}

export function buildKnowledgeRelationships(
  patientId: string,
  entities: Entity[],
  facts: ClinicalFact[]
): { relationships: GraphRelationship[]; reviewItems: ReviewItem[] } {
  const relationships: GraphRelationship[] = [];
  const reviewItems: ReviewItem[] = [];

  const meds = entities.filter((e) => e.kind === "medication");
  const conditions = entities.filter((e) => e.kind === "condition");
  const labs = entities.filter((e) => e.kind === "lab");
  const symptoms = entities.filter((e) => e.kind === "symptom");
  const barriers = entities.filter((e) => e.kind === "barrier");

  const add = (
    from: Entity,
    to: Entity,
    relation: GraphEdgeRelation,
    confidence: number,
    rationale: string,
    severity?: Severity
  ) => {
    if (from.id === to.id) return;
    if (!isRelationValid(from.kind, relation, to.kind)) return; // schema guard
    const evidenceFacts = factsForEntities(facts, [from, to]);
    const rel: GraphRelationship = {
      id: stableId("rel", `${patientId}:${from.id}:${to.id}:${relation}`),
      patientId,
      fromEntityId: from.id,
      toEntityId: to.id,
      relation,
      confidence,
      evidenceFactIds: evidenceFacts.map((f) => f.id),
      provenance: evidenceFacts.flatMap((f) => f.provenance),
      reviewStatus:
        confidence < 0.75 || evidenceFacts.some((f) => f.reviewStatus === "needs_review")
          ? "needs_review"
          : "accepted",
      rationale,
      severity,
      metadata: { source: "ontology-rules" },
    };
    relationships.push(rel);
    if (rel.reviewStatus === "needs_review") {
      reviewItems.push({
        id: stableId("review", `${rel.id}:relationship`),
        patientId,
        targetType: "relationship",
        targetId: rel.id,
        reason: "Relationship requires review due to evidence uncertainty",
        status: "open",
        createdAt: new Date().toISOString(),
      });
    }
  };

  // 1. Drug-class ↔ condition contraindications.
  for (const med of meds) {
    const classes = med.drugClasses ?? [];
    for (const rule of CONTRAINDICATION_RULES) {
      if (!classes.includes(rule.drugClass)) continue;
      for (const condition of conditions) {
        const matches =
          (rule.condition.canonical && condition.canonicalLabel === rule.condition.canonical) ||
          (rule.condition.category && condition.category === rule.condition.category);
        if (!matches) continue;
        add(med, condition, "contraindicated_with", SEVERITY_CONFIDENCE[rule.severity], rule.rationale, rule.severity);
      }
    }
  }

  // 2. Drug-class ↔ drug-class interactions.
  for (let i = 0; i < meds.length; i++) {
    for (let j = i + 1; j < meds.length; j++) {
      const a = meds[i];
      const b = meds[j];
      const classesA = a.drugClasses ?? [];
      const classesB = b.drugClasses ?? [];
      for (const rule of INTERACTION_RULES) {
        const direct = classesA.includes(rule.classA) && classesB.includes(rule.classB);
        const swapped = classesA.includes(rule.classB) && classesB.includes(rule.classA);
        if (!direct && !swapped) continue;
        add(a, b, "contraindicated_with", SEVERITY_CONFIDENCE[rule.severity], rule.rationale, rule.severity);
      }
    }
  }

  // 3. Condition → condition risk factors.
  for (const link of CONDITION_RISK_LINKS) {
    const from = conditions.find((c) => c.canonicalLabel === link.from);
    const to = conditions.find((c) => c.canonicalLabel === link.to);
    if (from && to) {
      add(from, to, "risk_factor_for", 0.72, `${link.from} is a recognized risk factor for ${link.to}.`);
    }
  }

  // 4. Lab → condition worsening trends (direction-aware).
  const trends = computeTrends(facts);
  for (const lab of labs) {
    const trend = trends.get(lab.canonicalLabel.toLowerCase());
    if (!trend || !trend.worsening) continue;
    const link = LAB_CONDITION_LINKS.find((l) => l.lab === lab.canonicalLabel);
    if (!link) continue;
    const target = conditions.find(
      (c) =>
        (link.condition && c.canonicalLabel === link.condition) ||
        (link.category && c.category === link.category)
    );
    if (!target) continue;
    add(
      lab,
      target,
      "worsening_trend",
      0.8,
      `${lab.canonicalLabel} is trending ${trend.direction} (${trend.first}→${trend.last}${trend.unit ? ` ${trend.unit}` : ""}), consistent with worsening ${target.canonicalLabel}.`
    );
  }

  // 5. Symptom clustering within an organ system.
  const symptomGroups = new Map<string, Entity[]>();
  for (const symptom of symptoms) {
    const group = (symptom.metadata?.systemGroup as string | undefined) ?? "other";
    symptomGroups.set(group, [...(symptomGroups.get(group) ?? []), symptom]);
  }
  for (const [group, members] of symptomGroups) {
    if (group === "other" || members.length < 2) continue;
    for (let i = 1; i < members.length; i++) {
      add(
        members[0],
        members[i],
        "possibly_related_to",
        0.6,
        `${members[0].canonicalLabel} and ${members[i].canonicalLabel} are both ${group} symptoms and may share a cause.`
      );
    }
  }

  // 6. Barriers linked to the care they obstruct (best lexical match).
  const careTargets = [...conditions, ...meds, ...labs];
  for (const barrier of barriers) {
    let best: Entity | undefined;
    let bestScore = 0;
    for (const target of careTargets) {
      const score = similarity(barrier.canonicalLabel, target.canonicalLabel);
      if (score > bestScore) {
        bestScore = score;
        best = target;
      }
    }
    if (best && bestScore >= 0.3) {
      add(barrier, best, "barrier_to", 0.65, `"${barrier.canonicalLabel}" may be obstructing care for ${best.canonicalLabel}.`);
    }
  }

  return { relationships: dedupeRelationships(relationships), reviewItems };
}

export function dedupeRelationships(relationships: GraphRelationship[]): GraphRelationship[] {
  const seen = new Set<string>();
  return relationships.filter((rel) => {
    const key = `${rel.fromEntityId}:${rel.toEntityId}:${rel.relation}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export type { TrendSummary };
