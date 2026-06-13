/**
 * Temporal reasoning.
 *
 * Health facts are not eternal — they have lifecycles. This module derives
 * time-aware signal from the fact stream:
 *   - Lab/vital trends with direction-aware "worsening" judgement grounded in
 *     each lab's reference range (e.g. falling eGFR is worsening, rising eGFR
 *     is improving).
 *   - Bitemporal validity windows (valid time vs. transaction time) so callers
 *     can distinguish current facts from historical ones.
 *   - Contradiction detection across sources (same concept, conflicting active
 *     vs. resolved status or divergent same-day values).
 */

import type { ClinicalFact, HealthEventType, ReviewItem, TrendSummary } from "@/lib/schema";
import {
  groundConcept,
  parseBloodPressure,
  parseNumeric,
  type GroundedConcept,
} from "@/lib/knowledge/ontology";
import { stableId } from "@/lib/utils";

/** Minimal shape needed for trend computation — satisfied by ClinicalFact. */
export type TrendInput = {
  kind: HealthEventType;
  label: string;
  normalizedLabel?: string;
  value?: string | number;
  unit?: string;
  observedAt: string;
};

function numericValue(fact: TrendInput): number | null {
  const bp = parseBloodPressure(fact.value);
  if (bp) return bp.systolic;
  return parseNumeric(fact.value);
}

/** Compute a trend per labeled lab/vital series. Keyed by canonical label. */
export function computeTrends(facts: TrendInput[]): Map<string, TrendSummary> {
  const series = new Map<string, { concept: GroundedConcept; points: TrendInput[] }>();

  for (const fact of facts) {
    if (fact.kind !== "lab" && fact.kind !== "vital") continue;
    if (numericValue(fact) === null) continue;
    const concept = groundConcept(fact.normalizedLabel || fact.label, fact.kind);
    const key = concept.canonical.toLowerCase();
    const entry = series.get(key) ?? { concept, points: [] };
    entry.points.push(fact);
    series.set(key, entry);
  }

  const trends = new Map<string, TrendSummary>();
  for (const [key, { concept, points }] of series) {
    if (points.length < 2) continue;
    const sorted = [...points].sort(
      (a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime()
    );
    const first = numericValue(sorted[0])!;
    const last = numericValue(sorted[sorted.length - 1])!;
    const delta = last - first;
    const direction = delta > epsilon(first) ? "rising" : delta < -epsilon(first) ? "falling" : "stable";

    let worsening = false;
    if (direction !== "stable") {
      if (concept.direction === "higher_worse") worsening = direction === "rising";
      else if (concept.direction === "lower_worse") worsening = direction === "falling";
      else worsening = true; // two-sided: any sustained drift is worth flagging
    }

    trends.set(key, {
      label: concept.canonical,
      unit: concept.unit || sorted[sorted.length - 1].unit,
      direction,
      worsening,
      first,
      last,
      delta: Number(delta.toFixed(2)),
      points: sorted.length,
      firstObservedAt: sorted[0].observedAt,
      lastObservedAt: sorted[sorted.length - 1].observedAt,
    });
  }

  return trends;
}

function epsilon(base: number): number {
  return Math.max(0.01, Math.abs(base) * 0.02);
}

/**
 * Assign bitemporal validity to a fact. Valid time is anchored to when the fact
 * was observed in the real world; a `resolved` status closes the window.
 */
export function withValidity<T extends ClinicalFact>(fact: T, recordedAt: string): T {
  return {
    ...fact,
    recordedAt: fact.recordedAt ?? recordedAt,
    validFrom: fact.validFrom ?? fact.observedAt,
    validTo: fact.validTo ?? (fact.status === "resolved" ? fact.observedAt : undefined),
  };
}

/**
 * Detect contradictions across sources for the same concept: a fact marked
 * resolved while a later/contemporaneous fact reports it active, or materially
 * divergent numeric values recorded on the same day.
 */
export function detectContradictions(facts: ClinicalFact[]): ReviewItem[] {
  const reviews: ReviewItem[] = [];
  const byConcept = new Map<string, ClinicalFact[]>();

  for (const fact of facts) {
    if (fact.relevance !== "graph") continue;
    const concept = groundConcept(fact.normalizedLabel || fact.label, fact.kind);
    const key = `${concept.kind}:${concept.canonical.toLowerCase()}`;
    byConcept.set(key, [...(byConcept.get(key) ?? []), fact]);
  }

  for (const [key, group] of byConcept) {
    if (group.length < 2) continue;
    const sourceIds = new Set(group.map((f) => f.sourceId));
    if (sourceIds.size < 2) continue;

    const hasActive = group.some((f) => f.status === "active");
    const hasResolved = group.some((f) => f.status === "resolved");
    if (hasActive && hasResolved) {
      reviews.push(contradiction(group[0].patientId, key, group, "active-vs-resolved",
        `Conflicting status across sources for ${group[0].normalizedLabel || group[0].label}: reported both active and resolved.`));
      continue;
    }

    // Divergent same-day numeric values (labs/vitals).
    if (group[0].kind === "lab" || group[0].kind === "vital") {
      const byDay = new Map<string, ClinicalFact[]>();
      for (const f of group) {
        const day = f.observedAt.slice(0, 10);
        byDay.set(day, [...(byDay.get(day) ?? []), f]);
      }
      for (const [, sameDay] of byDay) {
        const values = sameDay.map(numericValue).filter((v): v is number => v !== null);
        if (values.length < 2) continue;
        const min = Math.min(...values);
        const max = Math.max(...values);
        if (min > 0 && (max - min) / min > 0.25) {
          reviews.push(contradiction(group[0].patientId, key, sameDay, "divergent-values",
            `Divergent same-day values for ${group[0].normalizedLabel || group[0].label} (${min} vs ${max}).`));
          break;
        }
      }
    }
  }

  return reviews;
}

function contradiction(
  patientId: string,
  key: string,
  facts: ClinicalFact[],
  tag: string,
  reason: string
): ReviewItem {
  return {
    id: stableId("review", `contradiction:${key}:${tag}`),
    patientId,
    targetType: "contradiction",
    targetId: facts.map((f) => f.id).sort().join("|"),
    reason,
    status: "open",
    createdAt: new Date().toISOString(),
  };
}
