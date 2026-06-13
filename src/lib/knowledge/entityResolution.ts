/**
 * Entity resolution.
 *
 * Implements the standard three-stage pipeline used in production entity
 * resolution systems:
 *   1. Blocking      — partition candidates by concept kind to avoid O(n^2)
 *                      comparisons across unrelated types.
 *   2. Matching      — a cascade from cheap exact/grounded keys to fuzzy
 *                      string similarity (token Jaccard + character bigram
 *                      Dice), so "CKD" and "Chronic kidney disease" collapse
 *                      even when only one is in the lexicon.
 *   3. Canonicalize  — transitive clustering followed by survivorship rules
 *                      that pick a golden record (grounded canonical label,
 *                      merged aliases, terminology coding).
 */

import type { ClinicalFact, Entity } from "@/lib/schema";
import {
  eventTypeToNodeKindForConcept,
  groundConcept,
  specialtiesForConcept,
  type ConceptKind,
  type GroundedConcept,
} from "@/lib/knowledge/ontology";
import { stableId } from "@/lib/utils";

const FUZZY_MERGE_THRESHOLD = 0.84;

export function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

export function jaccard(a: string, b: string): number {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) if (setB.has(token)) intersection++;
  return intersection / (setA.size + setB.size - intersection);
}

function bigrams(value: string): string[] {
  const clean = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const grams: string[] = [];
  for (let i = 0; i < clean.length - 1; i++) grams.push(clean.slice(i, i + 2));
  return grams;
}

export function diceCoefficient(a: string, b: string): number {
  const gramsA = bigrams(a);
  const gramsB = bigrams(b);
  if (gramsA.length === 0 || gramsB.length === 0) return a === b ? 1 : 0;
  const counts = new Map<string, number>();
  for (const g of gramsA) counts.set(g, (counts.get(g) ?? 0) + 1);
  let overlap = 0;
  for (const g of gramsB) {
    const c = counts.get(g) ?? 0;
    if (c > 0) {
      overlap++;
      counts.set(g, c - 1);
    }
  }
  return (2 * overlap) / (gramsA.length + gramsB.length);
}

/** Similarity rewarding either strong token overlap or strong character overlap. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  return Math.max(jaccard(a, b), diceCoefficient(a, b));
}

type Cluster = {
  facts: ClinicalFact[];
  grounded: GroundedConcept;
  /** Canonical key for stable identity. */
  key: string;
};

class UnionFind {
  private parent: number[];
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

function clusterKey(grounded: GroundedConcept): string {
  if (grounded.coding) return `${grounded.kind}:code:${grounded.coding.system}:${grounded.coding.code}`;
  return `${grounded.kind}:label:${grounded.canonical.toLowerCase()}`;
}

/**
 * Resolve clinical facts into canonical graph entities. Only graph-relevant
 * facts participate; evidence-only and ignored facts stay searchable but never
 * become nodes.
 */
export function resolveEntities(facts: ClinicalFact[]): Entity[] {
  const graphFacts = facts.filter((fact) => fact.relevance === "graph");
  if (graphFacts.length === 0) return [];

  // 1. Blocking by concept kind.
  const blocks = new Map<ConceptKind, ClinicalFact[]>();
  for (const fact of graphFacts) {
    const grounded = groundConcept(fact.normalizedLabel || fact.label, fact.kind);
    const list = blocks.get(grounded.kind) ?? [];
    list.push(fact);
    blocks.set(grounded.kind, list);
  }

  const entities: Entity[] = [];

  for (const [, blockFacts] of blocks) {
    // First collapse by exact canonical/coding key.
    const exact = new Map<string, Cluster>();
    for (const fact of blockFacts) {
      const grounded = groundConcept(fact.normalizedLabel || fact.label, fact.kind);
      const key = clusterKey(grounded);
      const existing = exact.get(key);
      if (existing) {
        existing.facts.push(fact);
        // Prefer a grounded concept over a generic fallback for the cluster.
        if (!existing.grounded.known && grounded.known) existing.grounded = grounded;
      } else {
        exact.set(key, { facts: [fact], grounded, key });
      }
    }

    const clusters = Array.from(exact.values());

    // 2. Fuzzy-merge clusters whose canonical labels are highly similar or that
    // share a terminology code (transitive closure via union-find).
    const uf = new UnionFind(clusters.length);
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        if (shouldMerge(clusters[i], clusters[j])) uf.union(i, j);
      }
    }

    const merged = new Map<number, Cluster[]>();
    for (let i = 0; i < clusters.length; i++) {
      const root = uf.find(i);
      const group = merged.get(root) ?? [];
      group.push(clusters[i]);
      merged.set(root, group);
    }

    // 3. Canonicalize each merged group into a golden-record entity.
    for (const group of merged.values()) {
      entities.push(buildEntity(group));
    }
  }

  return entities;
}

function shouldMerge(a: Cluster, b: Cluster): boolean {
  // Two distinct *known* concepts are already canonical; only merge them when
  // they share a terminology code. This prevents collapsing e.g. Type 1 vs
  // Type 2 diabetes just because their strings are similar.
  if (a.grounded.known && b.grounded.known) {
    if (a.grounded.coding && b.grounded.coding) {
      return (
        a.grounded.coding.system === b.grounded.coding.system &&
        a.grounded.coding.code === b.grounded.coding.code
      );
    }
    return a.grounded.canonical.toLowerCase() === b.grounded.canonical.toLowerCase();
  }
  // At least one side is an unknown fallback — fuzzy-merge on string similarity.
  return similarity(a.grounded.canonical, b.grounded.canonical) >= FUZZY_MERGE_THRESHOLD;
}

function buildEntity(group: Cluster[]): Entity {
  const allFacts = group.flatMap((c) => c.facts);
  const first = allFacts[0];

  // Survivorship: prefer a grounded canonical; otherwise the most frequent label.
  const groundedCluster = group.find((c) => c.grounded.known) ?? group[0];
  const grounded = groundedCluster.grounded;
  const canonicalLabel = grounded.known
    ? grounded.canonical
    : mostFrequent(allFacts.map((f) => f.normalizedLabel || f.label));

  const aliases = Array.from(
    new Set(allFacts.map((f) => f.label).filter(Boolean).concat(grounded.aliases.length ? [] : []))
  );

  const nodeKind = eventTypeToNodeKindForConcept(grounded.kind);
  const id = stableId("entity", `${first.patientId}:${nodeKind}:${canonicalLabel.toLowerCase()}`);

  return {
    id,
    patientId: first.patientId,
    kind: nodeKind,
    canonicalLabel,
    aliases,
    confidence: Math.min(...allFacts.map((f) => f.confidence)),
    reviewStatus: allFacts.some((f) => f.reviewStatus === "needs_review")
      ? "needs_review"
      : "accepted",
    factIds: allFacts.map((f) => f.id),
    coding: grounded.coding,
    drugClasses: grounded.classes,
    category: grounded.category,
    specialties: specialtiesForConcept(grounded),
    metadata: {
      eventIds: allFacts.map((f) => f.eventId),
      sourceIds: Array.from(new Set(allFacts.map((f) => f.sourceId))),
      conceptKind: grounded.kind,
      grounded: grounded.known,
      systemGroup: grounded.systemGroup,
    },
  };
}

function mostFrequent(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0] ?? "";
  let bestCount = 0;
  for (const [value, count] of counts) {
    // Tie-break toward the longer (more specific) label.
    if (count > bestCount || (count === bestCount && value.length > best.length)) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}
