import type {
  CandidateFact,
  ClinicalFact,
  FactRelevance,
  HealthEvent,
  ReviewItem,
  Source,
  SourceChunk,
} from "@/lib/schema";
import {
  applyCorroborationBoost,
  computeConfidence,
  CONFIDENCE_REJECT,
  CONFIDENCE_REVIEW,
  deriveReviewStatus,
} from "@/lib/knowledge/confidence";
import { chunkSource } from "@/lib/knowledge/chunk";
import { normalizeLabel } from "@/lib/knowledge/normalize";
import { groundConcept, interpretLabValue } from "@/lib/knowledge/ontology";
import { resolveEntities } from "@/lib/knowledge/entityResolution";
import { detectContradictions, withValidity } from "@/lib/knowledge/temporal";
import { stableId } from "@/lib/utils";

const GRAPH_TYPES = new Set(["condition", "symptom", "medication", "lab", "vital", "care_task", "barrier"]);
const GENERIC_LABELS = new Set([
  "patient-reported context",
  "clinician note",
  "noted labs",
  "medication plan update",
]);

export function relevanceForEvent(event: HealthEvent): FactRelevance {
  const label = event.label.trim().toLowerCase();
  if (!event.label.trim()) return "ignore";
  if (GENERIC_LABELS.has(label)) return "evidence_only";
  if (event.type === "note" || event.type === "encounter") return "evidence_only";
  return GRAPH_TYPES.has(event.type) ? "graph" : "evidence_only";
}

export function candidateFromEvent(event: HealthEvent, source?: Source): CandidateFact {
  const normalizedLabel = normalizeLabel(event.label, event.type);
  const grounded = groundConcept(normalizedLabel, event.type);
  const evidenceQuote =
    typeof event.value === "string" && event.value.length > 12
      ? event.value
      : source?.rawText?.slice(0, 240);

  const aiScore =
    typeof event.metadata?.aiScore === "number"
      ? event.metadata.aiScore
      : typeof event.metadata?.confidence === "number" && event.metadata?.aiExtracted
        ? event.metadata.confidence
        : undefined;

  return {
    id: stableId("cand", `${event.id}:${event.sourceId}:${event.type}:${event.label}`),
    patientId: event.patientId,
    sourceId: event.sourceId,
    kind: event.type,
    label: event.label,
    normalizedLabel,
    value: event.value,
    unit: event.unit ?? grounded.unit,
    observedAt: event.observedAt,
    status: event.status,
    relevance: relevanceForEvent(event),
    confidence: computeConfidence({
      sourceType: source?.type,
      aiExtracted: Boolean(event.metadata?.aiExtracted),
      aiScore,
      grounded: grounded.known,
      hasQuote: Boolean(evidenceQuote?.trim()),
      hasCoding: Boolean(grounded.coding),
      uncertain: Boolean(event.metadata?.uncertain),
      sourceCount: 1,
    }),
    evidenceQuote,
    uncertain: Boolean(event.metadata?.uncertain),
    negated: Boolean(event.metadata?.negated),
    coding: grounded.coding,
    labFlag: grounded.kind === "lab" ? interpretLabValue(grounded, event.value) : undefined,
    metadata: {
      ...event.metadata,
      grounded: grounded.known,
      ...(aiScore !== undefined ? { aiScore } : {}),
    },
  };
}

export function validateCandidate(candidate: CandidateFact): {
  accepted: boolean;
  reviewReason?: string;
} {
  if (!candidate.label.trim()) return { accepted: false, reviewReason: "Empty label" };
  if (candidate.relevance === "ignore") return { accepted: false, reviewReason: "Marked irrelevant" };
  if (candidate.negated) return { accepted: false, reviewReason: "Negated fact" };
  if (candidate.confidence < CONFIDENCE_REJECT) {
    return { accepted: false, reviewReason: "Low extraction confidence" };
  }
  if (Number.isNaN(new Date(candidate.observedAt).getTime())) {
    return { accepted: false, reviewReason: "Invalid observed date" };
  }
  const needsReview = deriveReviewStatus(candidate.confidence, candidate.uncertain) === "needs_review";
  return {
    accepted: true,
    reviewReason: needsReview
      ? "Needs review due to uncertainty or medium confidence"
      : undefined,
  };
}

export function acceptCandidate(
  candidate: CandidateFact,
  eventId: string,
  source?: Source,
  chunk?: SourceChunk
): { fact?: ClinicalFact; reviewItem?: ReviewItem } {
  const validation = validateCandidate(candidate);
  if (!validation.accepted) {
    return {
      reviewItem: {
        id: stableId("review", `${candidate.id}:${validation.reviewReason}`),
        patientId: candidate.patientId,
        targetType: "fact",
        targetId: candidate.id,
        reason: validation.reviewReason ?? "Rejected candidate",
        status: "open",
        createdAt: new Date().toISOString(),
      },
    };
  }

  const fact: ClinicalFact = {
    ...candidate,
    // Align fact id with event id so Supabase upserts never collide on `id`
    // when two events share the same clinical content but different event ids.
    id: eventId,
    eventId,
    reviewStatus: validation.reviewReason ? "needs_review" : "accepted",
    provenance: [
      {
        sourceId: candidate.sourceId,
        chunkId: chunk?.id,
        quote: candidate.evidenceQuote,
        startOffset: chunk?.startOffset,
        endOffset: chunk?.endOffset,
        method: candidate.metadata?.aiExtracted ? "ai" : "rules",
        model: typeof candidate.metadata?.model === "string" ? candidate.metadata.model : undefined,
        promptVersion:
          typeof candidate.metadata?.promptVersion === "string"
            ? candidate.metadata.promptVersion
            : undefined,
      },
    ],
    metadata: {
      ...candidate.metadata,
      sourceTitle: source?.title,
    },
  };

  return {
    fact,
    reviewItem: validation.reviewReason
      ? {
          id: stableId("review", `${fact.id}:${validation.reviewReason}`),
          patientId: fact.patientId,
          targetType: "fact",
          targetId: fact.id,
          reason: validation.reviewReason,
          status: "open",
          createdAt: new Date().toISOString(),
        }
      : undefined,
  };
}

export function healthEventFromFact(fact: ClinicalFact): HealthEvent {
  return {
    id: fact.eventId,
    patientId: fact.patientId,
    sourceId: fact.sourceId,
    type: fact.kind,
    label: fact.normalizedLabel || fact.label,
    value: fact.value,
    unit: fact.unit,
    observedAt: fact.observedAt,
    status: fact.status,
    metadata: {
      ...fact.metadata,
      factId: fact.id,
      confidence: fact.confidence,
      aiScore: fact.metadata?.aiScore,
      relevance: fact.relevance,
      reviewStatus: fact.reviewStatus,
      evidenceQuote: fact.evidenceQuote,
    },
  };
}

export function buildKnowledgeFromEvents(sources: Source[], events: HealthEvent[]) {
  const sourceMap = new Map(sources.map((s) => [s.id, s]));
  const sourceChunks = sources.flatMap(chunkSource);
  const chunkBySource = new Map<string, SourceChunk>();
  for (const chunk of sourceChunks) {
    if (!chunkBySource.has(chunk.sourceId)) chunkBySource.set(chunk.sourceId, chunk);
  }

  const candidateFacts = events.map((event) => candidateFromEvent(event, sourceMap.get(event.sourceId)));
  const clinicalFacts: ClinicalFact[] = [];
  const reviewItems: ReviewItem[] = [];
  const factFingerprint = new Set<string>();
  const recordedAt = new Date().toISOString();

  for (let i = 0; i < candidateFacts.length; i++) {
    const candidate = candidateFacts[i];
    const event = events[i];
    const accepted = acceptCandidate(
      candidate,
      event.id,
      sourceMap.get(candidate.sourceId),
      chunkBySource.get(candidate.sourceId)
    );
    if (accepted.reviewItem) reviewItems.push(accepted.reviewItem);
    if (!accepted.fact) continue;
    const fingerprint = `${accepted.fact.sourceId}:${accepted.fact.kind}:${accepted.fact.normalizedLabel}:${accepted.fact.observedAt}:${String(accepted.fact.value ?? "")}`;
    if (factFingerprint.has(fingerprint)) continue;
    factFingerprint.add(fingerprint);
    clinicalFacts.push(withValidity(accepted.fact, recordedAt));
  }

  const boostedFacts = applyCorroborationBoost(clinicalFacts, sourceMap);
  const entities = resolveEntities(boostedFacts);
  reviewItems.push(...detectContradictions(boostedFacts));
  return { sourceChunks, candidateFacts, clinicalFacts: boostedFacts, entities, reviewItems };
}
