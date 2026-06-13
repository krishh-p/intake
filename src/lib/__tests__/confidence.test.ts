import { describe, expect, it } from "vitest";
import {
  applyCorroborationBoost,
  computeConfidence,
  CONFIDENCE_REJECT,
  CONFIDENCE_REVIEW,
  deriveReviewStatus,
} from "../knowledge/confidence";
import { buildKnowledgeFromEvents, candidateFromEvent } from "../knowledge/facts";
import type { ClinicalFact, HealthEvent, Source } from "../schema";

describe("computeConfidence", () => {
  it("scores structured EMR facts with ontology grounding highly", () => {
    const score = computeConfidence({
      sourceType: "emr",
      grounded: true,
      hasQuote: true,
      hasCoding: true,
      sourceCount: 1,
    });
    expect(score).toBeGreaterThanOrEqual(0.95);
    expect(deriveReviewStatus(score)).toBe("accepted");
  });

  it("preserves AI per-fact judgment instead of a flat override", () => {
    const high = computeConfidence({
      sourceType: "voice",
      aiExtracted: true,
      aiScore: 0.92,
      grounded: true,
      hasQuote: true,
      hasCoding: true,
      sourceCount: 1,
    });
    const low = computeConfidence({
      sourceType: "voice",
      aiExtracted: true,
      aiScore: 0.55,
      grounded: false,
      hasQuote: false,
      hasCoding: false,
      uncertain: true,
      sourceCount: 1,
    });
    expect(high).toBeGreaterThan(low);
    expect(high).toBeGreaterThanOrEqual(CONFIDENCE_REVIEW);
    expect(low).toBeLessThan(CONFIDENCE_REJECT);
  });

  it("boosts confidence when multiple sources corroborate", () => {
    const single = computeConfidence({
      sourceType: "emr",
      grounded: true,
      hasQuote: true,
      hasCoding: true,
      sourceCount: 1,
    });
    const corroborated = computeConfidence({
      sourceType: "emr",
      grounded: true,
      hasQuote: true,
      hasCoding: true,
      sourceCount: 2,
    });
    expect(corroborated).toBeGreaterThan(single);
  });
});

describe("confidence in facts pipeline", () => {
  const emrSource: Source = {
    id: "src_emr",
    type: "emr",
    title: "EMR import",
    capturedAt: "2026-01-01T00:00:00.000Z",
    rawText: '{"conditions":[{"label":"Type 2 diabetes"}]}',
  };

  const voiceSource: Source = {
    id: "src_voice",
    type: "voice",
    title: "Voice note",
    capturedAt: "2026-01-01T00:00:00.000Z",
    rawText: "I was diagnosed with type 2 diabetes last year.",
  };

  it("assigns higher confidence to EMR than voice for the same concept", () => {
    const emrEvent: HealthEvent = {
      id: "evt_emr",
      patientId: "p1",
      sourceId: emrSource.id,
      type: "condition",
      label: "Type 2 diabetes",
      observedAt: "2026-01-01T00:00:00.000Z",
    };
    const voiceEvent: HealthEvent = {
      id: "evt_voice",
      patientId: "p1",
      sourceId: voiceSource.id,
      type: "condition",
      label: "Type 2 diabetes",
      observedAt: "2026-01-01T00:00:00.000Z",
    };

    const emrFact = candidateFromEvent(emrEvent, emrSource);
    const voiceFact = candidateFromEvent(voiceEvent, voiceSource);

    expect(emrFact.confidence).toBeGreaterThan(voiceFact.confidence);
  });

  it("raises fact confidence after cross-source corroboration", () => {
    const events: HealthEvent[] = [
      {
        id: "evt_emr",
        patientId: "p1",
        sourceId: emrSource.id,
        type: "medication",
        label: "Metformin",
        observedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "evt_voice",
        patientId: "p1",
        sourceId: voiceSource.id,
        type: "medication",
        label: "metformin",
        observedAt: "2026-02-01T00:00:00.000Z",
      },
    ];

    const knowledge = buildKnowledgeFromEvents([emrSource, voiceSource], events);
    const metforminFacts = knowledge.clinicalFacts.filter(
      (f) => f.normalizedLabel === "Metformin"
    );

    expect(metforminFacts.length).toBeGreaterThanOrEqual(1);
    for (const fact of metforminFacts) {
      expect(fact.confidence).toBeGreaterThanOrEqual(CONFIDENCE_REVIEW);
    }

    const entity = knowledge.entities.find((e) => e.canonicalLabel === "Metformin");
    expect(entity?.confidence).toBeGreaterThanOrEqual(CONFIDENCE_REVIEW);
  });

  it("stores grounded and aiScore metadata for downstream rescoring", () => {
    const aiEvent: HealthEvent = {
      id: "evt_ai",
      patientId: "p1",
      sourceId: voiceSource.id,
      type: "medication",
      label: "Metformin",
      observedAt: "2026-01-01T00:00:00.000Z",
      metadata: { aiExtracted: true, aiScore: 0.88, uncertain: false },
    };

    const fact = candidateFromEvent(aiEvent, voiceSource);
    expect(fact.metadata?.grounded).toBe(true);
    expect(fact.metadata?.aiScore).toBe(0.88);
    expect(fact.confidence).toBeGreaterThan(0.78);
  });
});

describe("applyCorroborationBoost", () => {
  it("updates reviewStatus when corroboration clears the review threshold", () => {
    const sourceA: Source = {
      id: "a",
      type: "voice",
      title: "Voice",
      capturedAt: "2026-01-01T00:00:00.000Z",
    };
    const sourceB: Source = {
      id: "b",
      type: "doctor_note",
      title: "Note",
      capturedAt: "2026-01-02T00:00:00.000Z",
    };
    const sourceMap = new Map([
      ["a", sourceA],
      ["b", sourceB],
    ]);

    const baseFact = (sourceId: string): ClinicalFact => ({
      id: `fact_${sourceId}`,
      eventId: `evt_${sourceId}`,
      patientId: "p1",
      sourceId,
      kind: "symptom",
      label: "Fatigue",
      normalizedLabel: "Fatigue",
      observedAt: "2026-01-01T00:00:00.000Z",
      relevance: "graph",
      confidence: 0.72,
      reviewStatus: "needs_review",
      provenance: [{ sourceId, method: "rules" }],
      metadata: { grounded: true },
      evidenceQuote: "I feel tired all the time",
    });

    const boosted = applyCorroborationBoost(
      [baseFact("a"), baseFact("b")],
      sourceMap
    );

    expect(boosted.every((f) => f.confidence >= CONFIDENCE_REVIEW)).toBe(true);
    expect(boosted.every((f) => f.reviewStatus === "accepted")).toBe(true);
  });
});
