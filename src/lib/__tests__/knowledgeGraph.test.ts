import { describe, expect, it } from "vitest";
import { buildGraph } from "../graph/buildGraph";
import { getEvidencePath } from "../graph/queryGraph";
import { buildKnowledgeFromEvents } from "../knowledge/facts";
import { isRelationValid } from "../knowledge/graphSchema";
import { evaluateRiskRules } from "../risk/rules";
import { generateReport } from "../reports/generateReport";
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

  it("does not expand evidence paths to clinically unrelated nodes", () => {
    const sources = [source("src_a", "CKD, ibuprofen, potassium, and unrelated asthma.")];
    const events = [
      event({ id: "evt_ckd", sourceId: "src_a", type: "condition", label: "CKD" }),
      event({ id: "evt_nsaid", sourceId: "src_a", type: "medication", label: "Ibuprofen" }),
      event({ id: "evt_k", sourceId: "src_a", type: "lab", label: "Potassium", value: 5.4 }),
      event({ id: "evt_asthma", sourceId: "src_a", type: "condition", label: "Asthma" }),
    ];
    const graph = buildGraph("Test Patient", events, sources);

    const path = getEvidencePath(["evt_ckd", "evt_nsaid"], graph.nodes, graph.edges);
    const labels = path.nodes.map((node) => node.label);

    // Asthma has no clinical link to CKD/NSAIDs, so it must not be pulled in.
    expect(labels.some((label) => /asthma/i.test(label))).toBe(false);
    expect(labels.some((label) => /kidney/i.test(label))).toBe(true);
    expect(labels.some((label) => /ibuprofen/i.test(label))).toBe(true);
  });
});

describe("ontology grounding and entity resolution", () => {
  it("merges aliases and abbreviations into one grounded entity", () => {
    const sources = [source("src_a", "Notes")];
    const events = [
      event({ id: "e1", sourceId: "src_a", type: "medication", label: "Advil" }),
      event({ id: "e2", sourceId: "src_a", type: "medication", label: "ibuprofen 400mg" }),
    ];
    const knowledge = buildKnowledgeFromEvents(sources, events);
    expect(knowledge.entities).toHaveLength(1);
    expect(knowledge.entities[0].canonicalLabel).toBe("Ibuprofen");
    expect(knowledge.entities[0].drugClasses).toContain("nsaid");
    expect(knowledge.entities[0].coding?.system).toBe("RxNorm");
  });

  it("fuzzy-merges near-duplicate unknown labels", () => {
    const sources = [source("src_a", "Notes")];
    const events = [
      event({ id: "e1", sourceId: "src_a", type: "condition", label: "Fibromyalgia syndrome" }),
      event({ id: "e2", sourceId: "src_a", type: "condition", label: "Fibromyalgia syndromes" }),
    ];
    const knowledge = buildKnowledgeFromEvents(sources, events);
    expect(knowledge.entities).toHaveLength(1);
  });
});

describe("general relationship inference (works for any patient)", () => {
  it("derives a drug-drug interaction never seen in the demo", () => {
    const sources = [source("src_a", "Med list")];
    const events = [
      event({ id: "e1", sourceId: "src_a", type: "medication", label: "Warfarin" }),
      event({ id: "e2", sourceId: "src_a", type: "medication", label: "Aspirin" }),
    ];
    const graph = buildGraph("Test Patient", events, sources);
    const contraindication = graph.edges.find(
      (edge) => edge.relation === "contraindicated_with"
    );
    expect(contraindication).toBeDefined();
    expect(contraindication?.metadata?.source).toBe("ontology-rules");
  });

  it("derives a direction-aware worsening trend edge", () => {
    const sources = [source("src_a", "Labs over time")];
    const events = [
      event({ id: "c1", sourceId: "src_a", type: "condition", label: "Type 2 diabetes" }),
      event({
        id: "l1",
        sourceId: "src_a",
        type: "lab",
        label: "HbA1c",
        value: 6.8,
        observedAt: "2026-01-01T00:00:00.000Z",
      }),
      event({
        id: "l2",
        sourceId: "src_a",
        type: "lab",
        label: "HbA1c",
        value: 8.4,
        observedAt: "2026-04-01T00:00:00.000Z",
      }),
    ];
    const graph = buildGraph("Test Patient", events, sources);
    const trend = graph.edges.find((edge) => edge.relation === "worsening_trend");
    expect(trend).toBeDefined();
  });
});

describe("general risk engine (no hardcoded patient)", () => {
  it("flags an interaction for a non-demo medication pair", () => {
    const events = [
      event({ id: "e1", patientId, sourceId: "src_a", type: "medication", label: "Spironolactone" }),
      event({ id: "e2", patientId, sourceId: "src_a", type: "medication", label: "Lisinopril" }),
    ];
    const alerts = evaluateRiskRules(events);
    expect(alerts.some((a) => /interaction|hyperkalemia/i.test(a.explanation))).toBe(true);
  });

  it("flags an out-of-range lab using reference ranges", () => {
    const events = [
      event({
        id: "e1",
        patientId,
        sourceId: "src_a",
        type: "lab",
        label: "TSH",
        value: 9.2,
      }),
    ];
    const alerts = evaluateRiskRules(events);
    expect(alerts.some((a) => /tsh/i.test(a.title))).toBe(true);
  });

  it("produces no alerts for a healthy single normal lab", () => {
    const events = [
      event({ id: "e1", patientId, sourceId: "src_a", type: "lab", label: "TSH", value: 2.0 }),
    ];
    expect(evaluateRiskRules(events)).toHaveLength(0);
  });
});

describe("general report generation", () => {
  it("builds a data-driven summary without hardcoded demographics", () => {
    const sources = [source("src_a", "Visit")];
    const events = [
      event({ id: "e1", sourceId: "src_a", type: "condition", label: "Asthma" }),
      event({ id: "e2", sourceId: "src_a", type: "medication", label: "Albuterol" }),
    ];
    const report = generateReport("primary_care", "Jordan Lee", events, sources, []);
    expect(report.summary).toContain("Jordan Lee");
    expect(report.summary).toMatch(/asthma/i);
    expect(report.summary).not.toMatch(/58-year-old/);
  });
});

describe("relation schema validation", () => {
  it("rejects edges that violate domain/range", () => {
    // A medication cannot "report" a symptom — only the patient can.
    expect(isRelationValid("medication", "reported", "symptom")).toBe(false);
    expect(isRelationValid("patient", "reported", "symptom")).toBe(true);
    expect(isRelationValid("medication", "contraindicated_with", "condition")).toBe(true);
  });
});

describe("contradiction detection", () => {
  it("flags conflicting active/resolved status across sources", () => {
    const sources = [source("src_a", "Active CKD"), source("src_b", "CKD resolved")];
    const events = [
      event({ id: "e1", sourceId: "src_a", type: "condition", label: "CKD", status: "active" }),
      event({ id: "e2", sourceId: "src_b", type: "condition", label: "Chronic kidney disease", status: "resolved" }),
    ];
    const knowledge = buildKnowledgeFromEvents(sources, events);
    expect(knowledge.reviewItems.some((r) => r.targetType === "contradiction")).toBe(true);
  });
});
