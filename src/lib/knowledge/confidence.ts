import type { ClinicalFact, Source, SourceType } from "@/lib/schema";

/** Facts below this score are rejected during validation. */
export const CONFIDENCE_REJECT = 0.45;

/** Facts below this score (or marked uncertain) are flagged needs_review. */
export const CONFIDENCE_REVIEW = 0.75;

export type ConfidenceInput = {
  sourceType?: SourceType;
  aiExtracted?: boolean;
  /** Raw model confidence when aiExtracted is true. */
  aiScore?: number;
  grounded: boolean;
  hasQuote: boolean;
  hasCoding: boolean;
  uncertain?: boolean;
  /** Distinct sources reporting the same normalized concept. */
  sourceCount?: number;
};

function baseScore(input: ConfidenceInput): number {
  if (input.aiExtracted) {
    const raw = input.aiScore ?? 0.65;
    // Preserve the model's per-fact judgment with a slight extraction discount.
    return Math.max(0.5, Math.min(0.88, raw * 0.92));
  }

  switch (input.sourceType) {
    case "emr":
      return 0.9;
    case "doctor_note":
      return 0.85;
    case "voice":
      return 0.8;
    case "manual":
      return 0.82;
    default:
      return 0.8;
  }
}

export function computeConfidence(input: ConfidenceInput): number {
  let score = baseScore(input);

  if (input.grounded) score += 0.08;
  if (input.hasQuote) score += 0.05;
  if (input.hasCoding) score += 0.05;

  const sources = input.sourceCount ?? 1;
  if (sources >= 2) score += 0.1;
  if (sources >= 3) score += 0.05;

  if (input.uncertain) score -= 0.15;
  if (!input.grounded && input.aiExtracted) score -= 0.08;

  return Math.round(Math.max(0, Math.min(1, score)) * 100) / 100;
}

export function deriveReviewStatus(
  confidence: number,
  uncertain?: boolean
): "accepted" | "needs_review" {
  return confidence < CONFIDENCE_REVIEW || uncertain
    ? "needs_review"
    : "accepted";
}

export function confidenceInputFromFact(
  fact: ClinicalFact,
  source?: Source,
  sourceCount = 1
): ConfidenceInput {
  const aiScore =
    typeof fact.metadata?.aiScore === "number"
      ? fact.metadata.aiScore
      : typeof fact.metadata?.confidence === "number" && fact.metadata?.aiExtracted
        ? fact.metadata.confidence
        : undefined;

  return {
    sourceType: source?.type,
    aiExtracted: Boolean(fact.metadata?.aiExtracted),
    aiScore,
    grounded: Boolean(fact.metadata?.grounded),
    hasQuote: Boolean(fact.evidenceQuote?.trim()),
    hasCoding: Boolean(fact.coding),
    uncertain: fact.uncertain,
    sourceCount,
  };
}

function corroborationKey(fact: ClinicalFact): string {
  return `${fact.kind}:${fact.normalizedLabel.toLowerCase()}`;
}

/**
 * Re-score facts after the full batch is known so cross-source agreement
 * can raise confidence (e.g. EMR + voice both mention Metformin).
 */
export function applyCorroborationBoost(
  facts: ClinicalFact[],
  sourceMap: Map<string, Source>
): ClinicalFact[] {
  const groups = new Map<string, ClinicalFact[]>();
  for (const fact of facts) {
    const key = corroborationKey(fact);
    groups.set(key, [...(groups.get(key) ?? []), fact]);
  }

  const sourceCounts = new Map<string, number>();
  for (const [key, group] of groups) {
    sourceCounts.set(key, new Set(group.map((f) => f.sourceId)).size);
  }

  return facts.map((fact) => {
    const sourceCount = sourceCounts.get(corroborationKey(fact)) ?? 1;
    const source = sourceMap.get(fact.sourceId);
    const confidence = computeConfidence(
      confidenceInputFromFact(fact, source, sourceCount)
    );
    if (confidence === fact.confidence) return fact;

    return {
      ...fact,
      confidence,
      reviewStatus: deriveReviewStatus(confidence, fact.uncertain),
    };
  });
}
