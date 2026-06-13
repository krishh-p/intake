import type {
  ClinicalFact,
  Entity,
  GraphEdgeRelation,
  GraphRelationship,
  ReviewItem,
} from "@/lib/schema";
import { stableId } from "@/lib/utils";

function findEntity(entities: Entity[], pattern: RegExp) {
  return entities.find((entity) => pattern.test(entity.canonicalLabel));
}

function factsForEntities(facts: ClinicalFact[], entities: Entity[]) {
  const ids = new Set(entities.flatMap((entity) => entity.factIds));
  return facts.filter((fact) => ids.has(fact.id));
}

function relationship(
  patientId: string,
  from: Entity,
  to: Entity,
  relation: GraphEdgeRelation,
  evidenceFacts: ClinicalFact[],
  confidence = 0.82
): GraphRelationship {
  return {
    id: stableId("rel", `${patientId}:${from.id}:${to.id}:${relation}`),
    patientId,
    fromEntityId: from.id,
    toEntityId: to.id,
    relation,
    confidence,
    evidenceFactIds: evidenceFacts.map((fact) => fact.id),
    provenance: evidenceFacts.flatMap((fact) => fact.provenance),
    reviewStatus:
      confidence < 0.75 || evidenceFacts.some((fact) => fact.reviewStatus === "needs_review")
        ? "needs_review"
        : "accepted",
    metadata: { source: "rules" },
  };
}

export function buildKnowledgeRelationships(
  patientId: string,
  entities: Entity[],
  facts: ClinicalFact[]
): { relationships: GraphRelationship[]; reviewItems: ReviewItem[] } {
  const relationships: GraphRelationship[] = [];
  const reviewItems: ReviewItem[] = [];
  const ckd = findEntity(entities, /kidney|ckd/i);
  const nsaid = findEntity(entities, /ibuprofen|nsaid/i);
  const egfr = findEntity(entities, /egfr/i);
  const potassium = findEntity(entities, /potassium/i);
  const edema = findEntity(entities, /edema|swelling/i);
  const sob = findEntity(entities, /shortness of breath/i);
  const lisinopril = findEntity(entities, /lisinopril/i);
  const refill = findEntity(entities, /refill|pharmacy/i);
  const nephrologyBarrier = findEntity(entities, /nephrology|care access/i);
  const a1c = findEntity(entities, /hba1c|a1c/i);
  const diabetes = findEntity(entities, /diabetes/i);

  const add = (from: Entity | undefined, to: Entity | undefined, relation: GraphEdgeRelation, confidence = 0.82) => {
    if (!from || !to || from.id === to.id) return;
    const evidenceFacts = factsForEntities(facts, [from, to]);
    const rel = relationship(patientId, from, to, relation, evidenceFacts, confidence);
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

  add(nsaid, ckd, "contraindicated_with", 0.9);
  add(egfr, ckd, "worsening_trend", 0.82);
  add(potassium, egfr, "possibly_related_to", 0.72);
  add(edema, ckd, "possibly_related_to", 0.68);
  add(sob, edema, "possibly_related_to", 0.7);
  add(nephrologyBarrier, ckd, "barrier_to", 0.85);
  add(refill, lisinopril, "barrier_to", 0.86);
  add(a1c, diabetes, "worsening_trend", 0.8);

  return {
    relationships: dedupeRelationships(relationships),
    reviewItems,
  };
}

export function dedupeRelationships(relationships: GraphRelationship[]) {
  const seen = new Set<string>();
  return relationships.filter((rel) => {
    const key = `${rel.fromEntityId}:${rel.toEntityId}:${rel.relation}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
