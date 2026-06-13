import { describe, expect, it } from "vitest";
import { buildGraph } from "../graph/buildGraph";
import { getEvidencePath } from "../graph/queryGraph";
import { buildKnowledgeFromEvents } from "../knowledge/facts";
import type { HealthEvent, Source } from "../schema";

const patientId = "patient_test";

function source(id: string, rawText: string): Source {
  return {
    id,
    type: "voice",
    title: `Source ${id}`,
    capturedAt: "2026-01-01T00:00:00.000Z",
    rawText,
  };
}

function event(input: Partial<HealthEvent> & Pick<HealthEvent, "id" | "sourceId" | "type" | "label">): HealthEvent {
  return {
    patientId,
    observedAt: "2026-01-01T00:00:00.000Z",
    ...input,
  };
}

describe("robust knowledge graph pipeline", () => {
  it("keeps generic notes out of graph entities", () => {
    const sources = [source("src_a", "I am rambling about parking and portal frustration.")];
    const events = [
      event({
        id: "evt_noise",
        sourceId: "src_a",
        type: "note",
        label: "Patient-reported context",
        value: "I am rambling about parking and portal frustration.",
      }),
    ];

    const knowledge = buildKnowledgeFromEvents(sources, events);

    expect(knowledge.clinicalFacts).toHaveLength(1);
    expect(knowledge.clinicalFacts[0].relevance).toBe("evidence_only");
    expect(knowledge.entities).toHaveLength(0);
  });

  it("normalizes duplicate clinical labels into one entity", () => {
    const sources = [
      source("src_a", "History of CKD."),
      source("src_b", "Chronic kidney disease discussed at follow-up."),
    ];
    const events = [
      event({ id: "evt_ckd_a", sourceId: "src_a", type: "condition", label: "CKD" }),
      event({
        id: "evt_ckd_b",
        sourceId: "src_b",
        type: "condition",
        label: "Chronic kidney disease",
      }),
    ];

    const knowledge = buildKnowledgeFromEvents(sources, events);

    expect(knowledge.entities).toHaveLength(1);
    expect(knowledge.entities[0].canonicalLabel).toBe("Chronic kidney disease");
    expect(knowledge.entities[0].aliases).toEqual(
      expect.arrayContaining(["CKD", "Chronic kidney disease"])
    );
  });

  it("preserves multi-source provenance edges for merged entities", () => {
    const sources = [
      source("src_a", "History of CKD."),
      source("src_b", "Chronic kidney disease discussed at follow-up."),
    ];
    const events = [
      event({ id: "evt_ckd_a", sourceId: "src_a", type: "condition", label: "CKD" }),
      event({
        id: "evt_ckd_b",
        sourceId: "src_b",
        type: "condition",
        label: "Chronic kidney disease",
      }),
    ];

    const graph = buildGraph("Test Patient", events, sources);
    const sourceEdges = graph.edges.filter((edge) => edge.relation === "mentioned_in");

    expect(sourceEdges).toHaveLength(2);
    expect(sourceEdges.flatMap((edge) => edge.evidenceEventIds)).toEqual(
      expect.arrayContaining(["evt_ckd_a", "evt_ckd_b"])
    );
  });

  it("does not expand evidence paths to every patient-linked node", () => {
    const sources = [source("src_a", "CKD, ibuprofen, potassium, and unrelated diabetes.")];
    const events = [
      event({ id: "evt_ckd", sourceId: "src_a", type: "condition", label: "CKD" }),
      event({ id: "evt_nsaid", sourceId: "src_a", type: "medication", label: "Ibuprofen" }),
      event({ id: "evt_k", sourceId: "src_a", type: "lab", label: "Potassium", value: 5.4 }),
      event({ id: "evt_diabetes", sourceId: "src_a", type: "condition", label: "Diabetes" }),
    ];
    const graph = buildGraph("Test Patient", events, sources);

    const path = getEvidencePath(["evt_ckd", "evt_nsaid"], graph.nodes, graph.edges);
    const labels = path.nodes.map((node) => node.label);

    expect(labels.some((label) => /diabetes/i.test(label))).toBe(false);
    expect(labels.some((label) => /kidney/i.test(label))).toBe(true);
    expect(labels.some((label) => /ibuprofen/i.test(label))).toBe(true);
  });
});
