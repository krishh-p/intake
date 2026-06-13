import type { GraphEdge, GraphNode, RiskAlert } from "@/lib/schema";
import type { EvidenceIndex, SearchResult } from "@/lib/index/evidenceIndex";

export function getConnectedNodeIds(
  nodeId: string,
  edges: GraphEdge[]
): Set<string> {
  const connected = new Set<string>([nodeId]);
  for (const edge of edges) {
    if (edge.from === nodeId) connected.add(edge.to);
    if (edge.to === nodeId) connected.add(edge.from);
  }
  return connected;
}

export function getEvidencePath(
  alertEventIds: string[],
  nodes: GraphNode[],
  edges: GraphEdge[]
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const relevantNodes = nodes.filter((n) =>
    n.eventIds?.some((id) => alertEventIds.includes(id))
  );
  const nodeIds = new Set(relevantNodes.map((n) => n.id));
  nodeIds.add("node_patient");

  // Expand to nodes connected by clinical edges (not just source links)
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      if (nodeIds.has(edge.from) && !nodeIds.has(edge.to)) {
        nodeIds.add(edge.to);
        changed = true;
      }
      if (nodeIds.has(edge.to) && !nodeIds.has(edge.from)) {
        nodeIds.add(edge.from);
        changed = true;
      }
    }
  }

  const relevantEdges = edges.filter(
    (e) => nodeIds.has(e.from) && nodeIds.has(e.to)
  );

  return {
    nodes: nodes.filter((n) => nodeIds.has(n.id)),
    edges: relevantEdges,
  };
}

export function queryGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  options: {
    alert?: RiskAlert;
    nodeId?: string;
    searchResults?: SearchResult[];
  }
): { nodes: GraphNode[]; edges: GraphEdge[]; focusEventIds: Set<string> } {
  const focusEventIds = new Set<string>();

  if (options.alert) {
    options.alert.evidenceEventIds.forEach((id) => focusEventIds.add(id));
    const path = getEvidencePath(options.alert.evidenceEventIds, nodes, edges);
    return { ...path, focusEventIds };
  }

  if (options.nodeId) {
    const node = nodes.find((n) => n.id === options.nodeId);
    node?.eventIds?.forEach((id) => focusEventIds.add(id));
    const connected = getConnectedNodeIds(options.nodeId, edges);
    return {
      nodes: nodes.filter((n) => connected.has(n.id)),
      edges: edges.filter(
        (e) => connected.has(e.from) && connected.has(e.to)
      ),
      focusEventIds,
    };
  }

  if (options.searchResults?.length) {
    for (const result of options.searchResults) {
      if (result.document.eventId) {
        focusEventIds.add(result.document.eventId);
      }
    }
    const eventIds = Array.from(focusEventIds);
    if (eventIds.length > 0) {
      const path = getEvidencePath(eventIds, nodes, edges);
      return { ...path, focusEventIds };
    }
  }

  return { nodes, edges, focusEventIds };
}

export function searchEvidenceForAlert(
  index: EvidenceIndex,
  alert: RiskAlert
): SearchResult[] {
  const query = [alert.title, alert.explanation, ...alert.suggestedQuestions].join(" ");
  const results = index.search(query, 6);
  const eventIdSet = new Set(alert.evidenceEventIds);

  // Boost results that match known evidence event IDs
  return results
    .map((r) => ({
      ...r,
      score:
        r.score +
        (r.document.eventId && eventIdSet.has(r.document.eventId) ? 2 : 0),
    }))
    .sort((a, b) => b.score - a.score);
}
