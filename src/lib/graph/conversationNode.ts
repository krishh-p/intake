import type {
  ConversationContext,
  GraphEdge,
  GraphNode,
  HealthEvent,
} from "@/lib/schema";
import { generateId } from "@/lib/utils";

export function conversationContextToGraphNode(context: ConversationContext): GraphNode {
  return {
    id: `node_ctx_${context.id}`,
    kind: "conversation",
    label: context.chiefConcern || context.title,
    eventIds: context.eventIds,
    metadata: {
      contextId: context.id,
      title: context.title,
      summary: context.summary,
      chiefConcern: context.chiefConcern,
      topics: context.topics,
      symptoms: context.symptoms,
      medications: context.medications,
      barriers: context.barriers,
      concerns: context.concerns,
      followUpItems: context.followUpItems,
      messageCount: context.messageCount,
      capturedAt: context.capturedAt,
    },
  };
}

export function addConversationNodesToGraph(
  patientNodeId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
  contexts: ConversationContext[],
  events: HealthEvent[]
): void {
  const eventNodeByEventId = new Map<string, GraphNode>();
  for (const node of nodes) {
    for (const eventId of node.eventIds ?? []) {
      eventNodeByEventId.set(eventId, node);
    }
  }

  for (const context of contexts) {
    const contextNode = conversationContextToGraphNode(context);
    nodes.push(contextNode);

    edges.push({
      id: generateId("edge"),
      from: patientNodeId,
      to: contextNode.id,
      relation: "reported",
      evidenceEventIds: context.eventIds,
    });

    const sourceNodeId = `node_src_${context.sourceId}`;
    if (nodes.some((n) => n.id === sourceNodeId)) {
      edges.push({
        id: generateId("edge"),
        from: contextNode.id,
        to: sourceNodeId,
        relation: "mentioned_in",
        evidenceEventIds: context.eventIds,
      });
    }

    const linkedNodes = new Set<string>();
    for (const eventId of context.eventIds) {
      const eventNode = eventNodeByEventId.get(eventId);
      if (!eventNode || linkedNodes.has(eventNode.id)) continue;
      linkedNodes.add(eventNode.id);

      edges.push({
        id: generateId("edge"),
        from: contextNode.id,
        to: eventNode.id,
        relation: "possibly_related_to",
        evidenceEventIds: [eventId],
      });
    }

    if (linkedNodes.size === 0 && context.eventIds.length > 0) {
      const fallbackEvent = events.find((e) => context.eventIds.includes(e.id));
      if (fallbackEvent) {
        const nodeId = `node_${fallbackEvent.type}_${fallbackEvent.id}`;
        if (nodes.some((n) => n.id === nodeId)) {
          edges.push({
            id: generateId("edge"),
            from: contextNode.id,
            to: nodeId,
            relation: "possibly_related_to",
            evidenceEventIds: [fallbackEvent.id],
          });
        }
      }
    }
  }
}
