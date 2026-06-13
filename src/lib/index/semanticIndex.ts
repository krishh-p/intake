/**
 * Semantic (vector) index + hybrid fusion.
 *
 * The companion to the lexical `EvidenceIndex`. Vectors are L2-normalized on
 * ingest, so cosine similarity is a plain dot product. Hybrid retrieval fuses
 * the lexical and semantic rankings with Reciprocal Rank Fusion (RRF), the
 * standard rank-combination method that needs no score calibration between the
 * two very different scoring scales.
 *
 * Design rule (clinical safety): semantics only widen *recall*. The lexical and
 * ontology layers remain the precision authority, so near-opposites that sit
 * close in embedding space (e.g. hyper- vs hypokalemia) are never treated as a
 * match on vector similarity alone.
 */

import type { EvidenceDocument, SearchResult } from "@/lib/index/evidenceIndex";

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}

export type SemanticHit = {
  id: string;
  score: number;
  document: EvidenceDocument;
};

export class SemanticIndex {
  private entries: { id: string; vector: number[]; document: EvidenceDocument }[] = [];

  upsert(document: EvidenceDocument, vector: number[]): void {
    const idx = this.entries.findIndex((e) => e.id === document.id);
    const entry = { id: document.id, vector, document };
    if (idx >= 0) this.entries[idx] = entry;
    else this.entries.push(entry);
  }

  search(queryVector: number[], limit = 8, minScore = 0.25): SemanticHit[] {
    return this.entries
      .map((e) => ({ id: e.id, score: cosineSimilarity(queryVector, e.vector), document: e.document }))
      .filter((hit) => hit.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  size(): number {
    return this.entries.length;
  }
}

/**
 * Reciprocal Rank Fusion. Each ranked list contributes 1/(k + rank) to an
 * item's fused score; k dampens the influence of low ranks (60 is the common
 * default from the original RRF paper).
 */
export function reciprocalRankFusion(rankedLists: string[][], k = 60): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of rankedLists) {
    list.forEach((id, rank) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
    });
  }
  return scores;
}

/**
 * Fuse lexical (BM25) and semantic (vector) results into a single ranked list
 * of `SearchResult`s. When the semantic list is empty (model unavailable / not
 * yet ready), this is a no-op that returns the lexical results unchanged.
 */
export function fuseEvidence(
  lexical: SearchResult[],
  semantic: SemanticHit[],
  limit = 8,
  k = 60
): SearchResult[] {
  if (semantic.length === 0) return lexical.slice(0, limit);

  const fused = reciprocalRankFusion(
    [lexical.map((r) => r.document.id), semantic.map((s) => s.id)],
    k
  );

  const docs = new Map<string, EvidenceDocument>();
  const matched = new Map<string, string[]>();
  for (const r of lexical) {
    docs.set(r.document.id, r.document);
    matched.set(r.document.id, r.matchedTerms);
  }
  for (const s of semantic) if (!docs.has(s.id)) docs.set(s.id, s.document);

  return Array.from(fused.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, score]) => ({
      document: docs.get(id)!,
      score,
      matchedTerms: matched.get(id) ?? ["semantic"],
    }))
    .filter((r) => r.document);
}
