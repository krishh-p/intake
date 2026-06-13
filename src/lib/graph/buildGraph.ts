import type {
  ConversationContext,
  ClinicalFact,
  Entity,
  GraphEdge,
  GraphNode,
  GraphRelationship,
  HealthEvent,
  Source,
} from "@/lib/schema";
import { addConversationNodesToGraph } from "@/lib/graph/conversationNode";
import { buildKnowledgeFromEvents } from "@/lib/knowledge/facts";
import { buildKnowledgeRelationships } from "@/lib/knowledge/relationships";
import { stableId } from "@/lib/utils";

export function buildGraph(
  patientName: string,
  events: HealthEvent[],
  sources: Source[],
  contexts: ConversationContext[] = []
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const knowledge = buildKnowledgeFromEvents(sources, events);
  const relationships = buildKnowledgeRelationships(
    events[0]?.patientId ?? "patient",
    knowledge.entities,
    knowledge.clinicalFacts
  );
  return buildGraphFromKnowledge(
    patientName,
    sources,
    knowledge.clinicalFacts,
    knowledge.entities,
    relationships.relationships,
    contexts,
    events
  );
}

export function buildGraphFromKnowledge(
  patientName: string,
  sources: Source[],
  clinicalFacts: ClinicalFact[],
  entities: Entity[],
  graphRelationships: GraphRelationship[],
  contexts: ConversationContext[] = [],
  events: HealthEvent[] = []
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const factsById = new Map(clinicalFacts.map((fact) => [fact.id, fact]));

  const patientNode: GraphNode = {
    id: "node_patient",
    kind: "patient",
    label: patientName,
  };
  nodes.push(patientNode);

  const sourceNodes = sources.map((source) => ({
    id: `node_src_${source.id}`,
    kind: "source" as const,
    label: source.title,
    metadata: { sourceType: source.type },
  }));
  nodes.push(...sourceNodes);

  for (const entity of entities) {
    const entityFacts = entity.factIds
      .map((id) => factsById.get(id))
      .filter((fact): fact is ClinicalFact => Boolean(fact));
    if (entityFacts.length === 0) continue;
    const eventIds = entityFacts.map((fact) => fact.eventId);
    const node: GraphNode = {
      id: entity.id,
      kind: entity.kind,
      label: formatEntityLabel(entity, entityFacts),
      eventIds,
      factIds: entity.factIds,
      confidence: entity.confidence,
      reviewStatus: entity.reviewStatus,
      metadata: {
        aliases: entity.aliases,
        sourceIds: entity.metadata?.sourceIds,
        latestValue: latestFact(entityFacts).value,
        unit: latestFact(entityFacts).unit,
      },
    };
    nodes.push(node);

    const firstFact = entityFacts[0];
    edges.push({
      id: stableId("edge", `patient:${entity.id}:${firstFact.kind}`),
      from: patientNode.id,
      to: entity.id,
      relation: relationForEventType(firstFact.kind),
      evidenceEventIds: eventIds,
      evidenceFactIds: entity.factIds,
      confidence: entity.confidence,
      reviewStatus: entity.reviewStatus,
      metadata: { source: "facts" },
    });

    for (const sourceId of new Set(entityFacts.map((fact) => fact.sourceId))) {
      const sourceNodeId = `node_src_${sourceId}`;
      if (!nodes.some((n) => n.id === sourceNodeId)) continue;
      edges.push({
        id: stableId("edge", `${entity.id}:source:${sourceId}`),
        from: entity.id,
        to: sourceNodeId,
        relation: "mentioned_in",
        evidenceEventIds: entityFacts
          .filter((fact) => fact.sourceId === sourceId)
          .map((fact) => fact.eventId),
        evidenceFactIds: entityFacts
          .filter((fact) => fact.sourceId === sourceId)
          .map((fact) => fact.id),
        confidence: 1,
        reviewStatus: "accepted",
        metadata: { source: "provenance" },
      });
    }
  }

  addConversationNodesToGraph(patientNode.id, nodes, edges, contexts, events);
  for (const relationship of graphRelationships) {
    const from = nodes.find((node) => node.id === relationship.fromEntityId);
    const to = nodes.find((node) => node.id === relationship.toEntityId);
    if (!from || !to) continue;
    const evidenceFacts = relationship.evidenceFactIds
      .map((id) => factsById.get(id))
      .filter((fact): fact is ClinicalFact => Boolean(fact));
    edges.push({
      id: relationship.id,
      from: relationship.fromEntityId,
      to: relationship.toEntityId,
      relation: relationship.relation,
      evidenceEventIds: evidenceFacts.map((fact) => fact.eventId),
      evidenceFactIds: relationship.evidenceFactIds,
      confidence: relationship.confidence,
      reviewStatus: relationship.reviewStatus,
      metadata: {
        ...relationship.metadata,
        provenance: relationship.provenance,
      },
    });
  }

  return { nodes, edges };
}

function relationForEventType(type: HealthEvent["type"]): GraphEdge["relation"] {
  switch (type) {
    case "condition":
      return "has_condition";
    case "symptom":
      return "reported";
    case "medication":
      return "takes";
    case "lab":
    case "vital":
      return "ordered";
    case "care_task":
      return "needs_follow_up";
    case "barrier":
      return "barrier_to";
    default:
      return "belongs_to_visit";
  }
}

function latestFact(group: ClinicalFact[]): ClinicalFact {
  return [...group].sort(
    (a, b) => new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime()
  )[0];
}

function formatEntityLabel(entity: Entity, group: ClinicalFact[]): string {
  const latest = latestFact(group);
  if (entity.kind === "lab") {
    if (latest.value !== undefined) {
      return `${entity.canonicalLabel}: ${latest.value}${latest.unit ? ` ${latest.unit}` : ""}`;
    }
  }
  return entity.canonicalLabel;
}

export function getEventsForNode(
  node: GraphNode,
  events: HealthEvent[]
): HealthEvent[] {
  if (!node.eventIds?.length) return [];
  return events.filter((e) => node.eventIds!.includes(e.id));
}

export function getSourceForEvent(
  event: HealthEvent,
  sources: Source[]
): Source | undefined {
  return sources.find((s) => s.id === event.sourceId);
}
