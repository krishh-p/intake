/**
 * Graph schema (ontology constraints).
 *
 * Schema-guided construction is the single biggest lever for KG quality: every
 * generated edge is validated against a domain/range type constraint and
 * discarded if it violates the schema (post-hoc type checking). This keeps both
 * the rule engine and any LLM-proposed edges semantically well-formed.
 */

import type { GraphEdgeRelation, GraphNodeKind } from "@/lib/schema";

const ANY = "*" as const;

type Constraint = {
  from: GraphNodeKind[] | typeof ANY;
  to: GraphNodeKind[] | typeof ANY;
  /** Whether the relation is symmetric (used for dedup). */
  symmetric?: boolean;
};

export const RELATION_SCHEMA: Record<GraphEdgeRelation, Constraint> = {
  has_condition: { from: ["patient"], to: ["condition"] },
  takes: { from: ["patient"], to: ["medication"] },
  reported: { from: ["patient"], to: ["symptom", "conversation"] },
  ordered: { from: ["patient"], to: ["lab"] },
  managed_by: { from: ["condition", "patient"], to: ["clinician", "encounter"] },
  mentioned_in: { from: ANY, to: ["source"] },
  belongs_to_visit: { from: ANY, to: ["encounter"] },
  worsening_trend: { from: ["lab"], to: ["condition", "lab"] },
  risk_factor_for: { from: ["condition", "medication", "lab"], to: ["condition"] },
  contraindicated_with: { from: ["medication"], to: ["condition", "medication"], symmetric: true },
  needs_follow_up: { from: ["patient", "condition", "lab"], to: ["task"] },
  barrier_to: { from: ["barrier"], to: ["condition", "medication", "task", "lab"] },
  possibly_related_to: { from: ANY, to: ANY, symmetric: true },
};

export function isRelationValid(
  fromKind: GraphNodeKind,
  relation: GraphEdgeRelation,
  toKind: GraphNodeKind
): boolean {
  const constraint = RELATION_SCHEMA[relation];
  if (!constraint) return false;
  const fromOk = constraint.from === ANY || constraint.from.includes(fromKind);
  const toOk = constraint.to === ANY || constraint.to.includes(toKind);
  return fromOk && toOk;
}

export function isSymmetric(relation: GraphEdgeRelation): boolean {
  return Boolean(RELATION_SCHEMA[relation]?.symmetric);
}
