"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthenticatedSupabase } from "@/lib/supabase/client";
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

async function upsertRows(
  supabase: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  onConflict?: string,
) {
  if (rows.length === 0) return;
  const { error } = await supabase
    .from(table)
    .upsert(rows, onConflict ? { onConflict } : undefined);
  if (error) throw new Error(error.message);
}

function dedupeRows<T extends Record<string, unknown>>(
  rows: T[],
  keyFor: (row: T) => string,
): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) byKey.set(keyFor(row), row);
  return Array.from(byKey.values());
}

export async function loadRemoteWorkspace(userId: string): Promise<{
  sources: Source[];
  events: HealthEvent[];
}> {
  const auth = await getAuthenticatedSupabase();
  if (!auth) return { sources: [], events: [] };
  if (auth.userId !== userId) {
    throw new Error(
      "Signed-in account does not match the active workspace user.",
    );
  }

  const { supabase } = auth;

  const [
    { data: sourceRows, error: sourcesError },
    { data: factRows, error: factsError },
  ] = await Promise.all([
    supabase
      .from("sources")
      .select("*")
      .eq("user_id", auth.userId)
      .order("captured_at"),
    supabase
      .from("clinical_facts")
      .select("*")
      .eq("user_id", auth.userId)
      .order("observed_at"),
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
  const auth = await getAuthenticatedSupabase();
  if (!auth) return;
  if (auth.userId !== input.userId) {
    throw new Error(
      "Signed-in account does not match the active workspace user.",
    );
  }

  const { supabase, userId } = auth;

  const sourceIds = new Set(input.sources.map((source) => source.id));

  const sourceRows = input.sources.map((source) => ({
    id: source.id,
    user_id: userId,
    type: source.type,
    title: source.title,
    captured_at: source.capturedAt,
    raw_text: source.rawText ?? null,
    metadata: {},
  }));
  const chunkRows = input.sourceChunks
    .filter((chunk) => sourceIds.has(chunk.sourceId))
    .map((chunk) => ({
      id: chunk.id,
      user_id: userId,
      source_id: chunk.sourceId,
      ordinal: chunk.ordinal,
      start_offset: chunk.startOffset,
      end_offset: chunk.endOffset,
      text: chunk.text,
      metadata: {},
    }));
  const chunkIds = new Set(chunkRows.map((chunk) => chunk.id));

  const candidateRows = input.candidateFacts
    .filter((fact) => sourceIds.has(fact.sourceId))
    .map((fact) => ({
      id: fact.id,
      user_id: userId,
      source_id: fact.sourceId,
      chunk_id:
        fact.chunkId && chunkIds.has(fact.chunkId) ? fact.chunkId : null,
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
  const clinicalRows = input.clinicalFacts
    .filter((fact) => sourceIds.has(fact.sourceId))
    .map((fact) => ({
      id: fact.id,
      user_id: userId,
      event_id: fact.eventId,
      source_id: fact.sourceId,
      chunk_id:
        fact.chunkId && chunkIds.has(fact.chunkId) ? fact.chunkId : null,
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
    user_id: userId,
    kind: entity.kind,
    canonical_label: entity.canonicalLabel,
    aliases: entity.aliases,
    confidence: entity.confidence,
    review_status: entity.reviewStatus,
    fact_ids: entity.factIds,
    metadata: entity.metadata ?? {},
  }));
  const entityIds = new Set(entityRows.map((entity) => entity.id));
  const edgeRows = input.graphRelationships
    .filter(
      (edge) =>
        entityIds.has(edge.fromEntityId) && entityIds.has(edge.toEntityId),
    )
    .map((edge) => ({
      id: edge.id,
      user_id: userId,
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
    user_id: userId,
    target_type: item.targetType,
    target_id: item.targetId,
    reason: item.reason,
    status: item.status,
    created_at: item.createdAt,
  }));

  await upsertRows(supabase, "sources", sourceRows);
  await upsertRows(supabase, "source_chunks", chunkRows);
  await upsertRows(supabase, "candidate_facts", candidateRows);
  await upsertRows(
    supabase,
    "clinical_facts",
    dedupeRows(clinicalRows, (row) => String(row.event_id)),
    "event_id",
  );
  await upsertRows(
    supabase,
    "entities",
    dedupeRows(
      entityRows,
      (row) => `${row.user_id}:${row.kind}:${row.canonical_label}`,
    ),
    "user_id,kind,canonical_label",
  );
  await upsertRows(
    supabase,
    "graph_edges",
    dedupeRows(
      edgeRows,
      (row) =>
        `${row.user_id}:${row.from_entity_id}:${row.to_entity_id}:${row.relation}`,
    ),
    "user_id,from_entity_id,to_entity_id,relation",
  );
  await upsertRows(supabase, "review_items", reviewRows);
}

export async function clearRemoteWorkspace(userId: string) {
  const auth = await getAuthenticatedSupabase();
  if (!auth) return;
  if (auth.userId !== userId) {
    throw new Error(
      "Signed-in account does not match the active workspace user.",
    );
  }

  const { supabase } = auth;
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
    const { error } = await supabase
      .from(table)
      .delete()
      .eq("user_id", auth.userId);
    if (error) throw new Error(error.message);
  }
}
