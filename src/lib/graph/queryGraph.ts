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
  const alertIds = new Set(alertEventIds);
  const seedNodes = nodes.filter((n) => n.eventIds?.some((id) => alertIds.has(id)));
  const nodeIds = new Set(seedNodes.map((n) => n.id));
  const edgeIds = new Set<string>();

  for (const edge of edges) {
    if (edge.evidenceEventIds.some((id) => alertIds.has(id))) {
      edgeIds.add(edge.id);
      nodeIds.add(edge.from);
      nodeIds.add(edge.to);
    }
  }

  // Expand clinical context at most one hop, avoiding the patient hub flood-fill.
  const frontier = new Set(nodeIds);
  for (let depth = 0; depth < 1; depth++) {
    const next = new Set<string>();
    for (const edge of edges) {
      if (edge.relation === "mentioned_in") continue;
      if (edge.from === "node_patient" || edge.to === "node_patient") continue;
      const touchesFrontier = frontier.has(edge.from) || frontier.has(edge.to);
      if (!touchesFrontier) continue;
      edgeIds.add(edge.id);
      if (!nodeIds.has(edge.from)) next.add(edge.from);
      if (!nodeIds.has(edge.to)) next.add(edge.to);
      nodeIds.add(edge.from);
      nodeIds.add(edge.to);
    }
    frontier.clear();
    next.forEach((id) => frontier.add(id));
  }

  if (nodeIds.size > 0) {
    nodeIds.add("node_patient");
    for (const edge of edges) {
      const isPatientSeedEdge =
        (edge.from === "node_patient" && nodeIds.has(edge.to)) ||
        (edge.to === "node_patient" && nodeIds.has(edge.from));
      const isSourceEvidenceEdge =
        edge.relation === "mentioned_in" &&
        nodeIds.has(edge.from) &&
        edge.evidenceEventIds.some((id) => alertIds.has(id));
      if (isPatientSeedEdge || isSourceEvidenceEdge) edgeIds.add(edge.id);
      if (isSourceEvidenceEdge) nodeIds.add(edge.to);
    }
  }

  const relevantEdges = edges.filter((e) => edgeIds.has(e.id));

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
