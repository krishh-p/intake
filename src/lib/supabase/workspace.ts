"use client";

import { getBrowserSupabase } from "@/lib/supabase/client";
import type {
  CandidateFact,
  ClinicalFact,
  Entity,
  GraphRelationship,
  HealthEvent,
  ReviewItem,
  Source,
  SourceChunk,
} from "@/lib/schema";

function valueToJson(value: string | number | undefined) {
  return value === undefined ? null : value;
}

function jsonToValue(value: unknown): string | number | undefined {
  if (typeof value === "string" || typeof value === "number") return value;
  return undefined;
}

export async function loadRemoteWorkspace(userId: string): Promise<{
  sources: Source[];
  events: HealthEvent[];
}> {
  const supabase = getBrowserSupabase();
  if (!supabase) return { sources: [], events: [] };

  const [{ data: sourceRows, error: sourcesError }, { data: factRows, error: factsError }] =
    await Promise.all([
      supabase.from("sources").select("*").eq("user_id", userId).order("captured_at"),
      supabase.from("clinical_facts").select("*").eq("user_id", userId).order("observed_at"),
    ]);

  if (sourcesError) throw new Error(sourcesError.message);
  if (factsError) throw new Error(factsError.message);

  return {
    sources: (sourceRows ?? []).map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      capturedAt: row.captured_at,
      rawText: row.raw_text ?? undefined,
    })),
    events: (factRows ?? []).map((row) => ({
      id: row.event_id,
      patientId: row.user_id,
      sourceId: row.source_id,
      type: row.kind,
      label: row.normalized_label,
      value: jsonToValue(row.value),
      unit: row.unit ?? undefined,
      observedAt: row.observed_at,
      status: row.status ?? undefined,
      metadata: {
        ...(row.metadata ?? {}),
        factId: row.id,
        confidence: Number(row.confidence),
        relevance: row.relevance,
        reviewStatus: row.review_status,
        evidenceQuote: row.evidence_quote ?? undefined,
      },
    })),
  };
}

export async function saveRemoteKnowledge(input: {
  userId: string;
  sources: Source[];
  sourceChunks: SourceChunk[];
  candidateFacts: CandidateFact[];
  clinicalFacts: ClinicalFact[];
  entities: Entity[];
  graphRelationships: GraphRelationship[];
  reviewItems: ReviewItem[];
}) {
  const supabase = getBrowserSupabase();
  if (!supabase) return;

  const sourceRows = input.sources.map((source) => ({
    id: source.id,
    user_id: input.userId,
    type: source.type,
    title: source.title,
    captured_at: source.capturedAt,
    raw_text: source.rawText ?? null,
    metadata: {},
  }));
  const chunkRows = input.sourceChunks.map((chunk) => ({
    id: chunk.id,
    user_id: input.userId,
    source_id: chunk.sourceId,
    ordinal: chunk.ordinal,
    start_offset: chunk.startOffset,
    end_offset: chunk.endOffset,
    text: chunk.text,
    metadata: {},
  }));
  const candidateRows = input.candidateFacts.map((fact) => ({
    id: fact.id,
    user_id: input.userId,
    source_id: fact.sourceId,
    chunk_id: fact.chunkId ?? null,
    kind: fact.kind,
    label: fact.label,
    normalized_label: fact.normalizedLabel,
    value: valueToJson(fact.value),
    unit: fact.unit ?? null,
    observed_at: fact.observedAt,
    status: fact.status ?? null,
    relevance: fact.relevance,
    confidence: fact.confidence,
    evidence_quote: fact.evidenceQuote ?? null,
    negated: fact.negated ?? false,
    uncertain: fact.uncertain ?? false,
    metadata: fact.metadata ?? {},
  }));
  const clinicalRows = input.clinicalFacts.map((fact) => ({
    id: fact.id,
    user_id: input.userId,
    event_id: fact.eventId,
    source_id: fact.sourceId,
    chunk_id: fact.chunkId ?? null,
    entity_id: fact.entityId ?? null,
    kind: fact.kind,
    label: fact.label,
    normalized_label: fact.normalizedLabel,
    value: valueToJson(fact.value),
    unit: fact.unit ?? null,
    observed_at: fact.observedAt,
    status: fact.status ?? null,
    relevance: fact.relevance,
    confidence: fact.confidence,
    review_status: fact.reviewStatus,
    provenance: fact.provenance,
    evidence_quote: fact.evidenceQuote ?? null,
    negated: fact.negated ?? false,
    uncertain: fact.uncertain ?? false,
    metadata: fact.metadata ?? {},
  }));
  const entityRows = input.entities.map((entity) => ({
    id: entity.id,
    user_id: input.userId,
    kind: entity.kind,
    canonical_label: entity.canonicalLabel,
    aliases: entity.aliases,
    confidence: entity.confidence,
    review_status: entity.reviewStatus,
    fact_ids: entity.factIds,
    metadata: entity.metadata ?? {},
  }));
  const edgeRows = input.graphRelationships.map((edge) => ({
    id: edge.id,
    user_id: input.userId,
    from_entity_id: edge.fromEntityId,
    to_entity_id: edge.toEntityId,
    relation: edge.relation,
    confidence: edge.confidence,
    evidence_fact_ids: edge.evidenceFactIds,
    provenance: edge.provenance,
    review_status: edge.reviewStatus,
    metadata: edge.metadata ?? {},
  }));
  const reviewRows = input.reviewItems.map((item) => ({
    id: item.id,
    user_id: input.userId,
    target_type: item.targetType,
    target_id: item.targetId,
    reason: item.reason,
    status: item.status,
    created_at: item.createdAt,
  }));

  const operations = [
    sourceRows.length ? supabase.from("sources").upsert(sourceRows) : null,
    chunkRows.length ? supabase.from("source_chunks").upsert(chunkRows) : null,
    candidateRows.length ? supabase.from("candidate_facts").upsert(candidateRows) : null,
    clinicalRows.length ? supabase.from("clinical_facts").upsert(clinicalRows) : null,
    entityRows.length ? supabase.from("entities").upsert(entityRows) : null,
    edgeRows.length ? supabase.from("graph_edges").upsert(edgeRows) : null,
    reviewRows.length ? supabase.from("review_items").upsert(reviewRows) : null,
  ].filter((operation): operation is NonNullable<typeof operation> => Boolean(operation));

  const results = await Promise.all(operations);
  const failure = results.find((result) => result.error);
  if (failure?.error) throw new Error(failure.error.message);
}

export async function clearRemoteWorkspace(userId: string) {
  const supabase = getBrowserSupabase();
  if (!supabase) return;
  const tables = [
    "risk_alerts",
    "review_items",
    "graph_edges",
    "entity_aliases",
    "entities",
    "clinical_facts",
    "candidate_facts",
    "extraction_runs",
    "source_chunks",
    "sources",
  ];
  for (const table of tables) {
    const { error } = await supabase.from(table).delete().eq("user_id", userId);
    if (error) throw new Error(error.message);
  }
}
