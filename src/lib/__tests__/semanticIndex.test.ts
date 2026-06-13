import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  fuseEvidence,
  reciprocalRankFusion,
  SemanticIndex,
} from "../index/semanticIndex";
import type { EvidenceDocument, SearchResult } from "../index/evidenceIndex";

function doc(id: string): EvidenceDocument {
  return {
    id,
    sourceId: "src",
    sourceType: "event",
    title: id,
    text: id,
    tokens: [id],
  };
}

describe("cosine similarity", () => {
  it("is 1 for identical normalized vectors and 0 for orthogonal", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });
});

describe("SemanticIndex", () => {
  it("ranks the nearest vector first and respects the score floor", () => {
    const index = new SemanticIndex();
    index.upsert(doc("a"), [1, 0]);
    index.upsert(doc("b"), [0.92, 0.39]);
    index.upsert(doc("c"), [0, 1]);
    const hits = index.search([1, 0], 5, 0.25);
    expect(hits[0].id).toBe("a");
    expect(hits[1].id).toBe("b");
    // c is orthogonal (score 0) and below the floor, so it is excluded.
    expect(hits.some((h) => h.id === "c")).toBe(false);
  });

  it("upserts by id without duplicating", () => {
    const index = new SemanticIndex();
    index.upsert(doc("a"), [1, 0]);
    index.upsert(doc("a"), [0, 1]);
    expect(index.size()).toBe(1);
  });
});

describe("reciprocal rank fusion", () => {
  it("rewards items ranked highly in multiple lists", () => {
    const scores = reciprocalRankFusion([
      ["x", "y", "z"],
      ["y", "x", "w"],
    ]);
    // y is rank 2 then rank 1; x is rank 1 then rank 2 — both beat singletons.
    expect((scores.get("y") ?? 0)).toBeGreaterThan(scores.get("z") ?? 0);
    expect((scores.get("x") ?? 0)).toBeGreaterThan(scores.get("w") ?? 0);
  });
});

describe("fuseEvidence", () => {
  const lexical: SearchResult[] = [
    { document: doc("a"), score: 5, matchedTerms: ["k"] },
    { document: doc("b"), score: 2, matchedTerms: ["k"] },
  ];

  it("returns lexical unchanged when there are no semantic hits", () => {
    const fused = fuseEvidence(lexical, []);
    expect(fused.map((r) => r.document.id)).toEqual(["a", "b"]);
  });

  it("pulls in a semantically-relevant doc the lexical search missed", () => {
    const fused = fuseEvidence(lexical, [
      { id: "c", score: 0.8, document: doc("c") },
      { id: "a", score: 0.7, document: doc("a") },
    ]);
    expect(fused.some((r) => r.document.id === "c")).toBe(true);
  });
});
