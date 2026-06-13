import type {
  GraphEdge,
  GraphNode,
  HealthEvent,
  Source,
} from "@/lib/schema";
import { generateId } from "@/lib/utils";

export function buildGraph(
  patientName: string,
  events: HealthEvent[],
  sources: Source[]
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const patientNode: GraphNode = {
    id: "node_patient",
    kind: "patient",
    label: patientName,
  };
  nodes.push(patientNode);

  const sourceNodes = sources.map((s) => ({
    id: `node_src_${s.id}`,
    kind: "source" as const,
    label: s.title,
    metadata: { sourceType: s.type },
  }));
  nodes.push(...sourceNodes);

  const grouped = new Map<string, HealthEvent[]>();
  for (const event of events) {
    const key = `${event.type}:${event.label}`;
    const list = grouped.get(key) ?? [];
    list.push(event);
    grouped.set(key, list);
  }

  for (const [, groupEvents] of grouped) {
    const first = groupEvents[0];
    const nodeId = `node_${first.type}_${first.id}`;
    const node: GraphNode = {
      id: nodeId,
      kind: mapEventTypeToNodeKind(first.type),
      label: formatNodeLabel(first, groupEvents),
      eventIds: groupEvents.map((e) => e.id),
      metadata: {
        eventType: first.type,
        latestValue: groupEvents[groupEvents.length - 1].value,
        unit: first.unit,
      },
    };
    nodes.push(node);

    edges.push({
      id: generateId("edge"),
      from: patientNode.id,
      to: nodeId,
      relation: relationForEventType(first.type),
      evidenceEventIds: groupEvents.map((e) => e.id),
    });

    const sourceNodeId = `node_src_${first.sourceId}`;
    if (nodes.some((n) => n.id === sourceNodeId)) {
      edges.push({
        id: generateId("edge"),
        from: nodeId,
        to: sourceNodeId,
        relation: "mentioned_in",
        evidenceEventIds: groupEvents.map((e) => e.id),
      });
    }
  }

  addClinicalRelationships(nodes, edges, events);

  return { nodes, edges };
}

function mapEventTypeToNodeKind(type: HealthEvent["type"]): GraphNode["kind"] {
  switch (type) {
    case "condition":
      return "condition";
    case "symptom":
      return "symptom";
    case "medication":
      return "medication";
    case "lab":
    case "vital":
      return "lab";
    case "encounter":
      return "encounter";
    case "care_task":
      return "task";
    case "barrier":
      return "barrier";
    default:
      return "encounter";
  }
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

function formatNodeLabel(first: HealthEvent, group: HealthEvent[]): string {
  if (first.type === "lab" || first.type === "vital") {
    const latest = group[group.length - 1];
    if (latest.value !== undefined) {
      return `${first.label}: ${latest.value}${latest.unit ? ` ${latest.unit}` : ""}`;
    }
  }
  return first.label;
}

function findNodeByLabel(nodes: GraphNode[], pattern: RegExp): GraphNode | undefined {
  return nodes.find((n) => pattern.test(n.label));
}

function addClinicalRelationships(
  nodes: GraphNode[],
  edges: GraphEdge[],
  events: HealthEvent[]
) {
  const ckd = findNodeByLabel(nodes, /kidney|ckd/i);
  const ibuprofen = findNodeByLabel(nodes, /ibuprofen/i);
  const lisinopril = findNodeByLabel(nodes, /lisinopril/i);
  const edema = findNodeByLabel(nodes, /swelling|edema/i);
  const sob = findNodeByLabel(nodes, /shortness of breath/i);
  const egfr = findNodeByLabel(nodes, /eGFR/i);
  const potassium = findNodeByLabel(nodes, /Potassium/i);
  const a1c = findNodeByLabel(nodes, /HbA1c|A1c/i);
  const missedNeph = findNodeByLabel(nodes, /nephrology follow-up/i);
  const refillDelay = findNodeByLabel(nodes, /refill delayed/i);

  if (ckd && ibuprofen) {
    edges.push({
      id: generateId("edge"),
      from: ibuprofen.id,
      to: ckd.id,
      relation: "contraindicated_with",
      evidenceEventIds: getEventIds([ibuprofen, ckd], events),
    });
  }

  if (ckd && egfr) {
    edges.push({
      id: generateId("edge"),
      from: egfr.id,
      to: ckd.id,
      relation: "worsening_trend",
      evidenceEventIds: getEventIds([egfr, ckd], events),
    });
  }

  if (potassium && egfr) {
    edges.push({
      id: generateId("edge"),
      from: potassium.id,
      to: egfr.id,
      relation: "possibly_related_to",
      evidenceEventIds: getEventIds([potassium, egfr], events),
    });
  }

  if (edema && ckd) {
    edges.push({
      id: generateId("edge"),
      from: edema.id,
      to: ckd.id,
      relation: "possibly_related_to",
      evidenceEventIds: getEventIds([edema, ckd], events),
    });
  }

  if (sob && edema) {
    edges.push({
      id: generateId("edge"),
      from: sob.id,
      to: edema.id,
      relation: "possibly_related_to",
      evidenceEventIds: getEventIds([sob, edema], events),
    });
  }

  if (missedNeph && ckd) {
    edges.push({
      id: generateId("edge"),
      from: missedNeph.id,
      to: ckd.id,
      relation: "barrier_to",
      evidenceEventIds: getEventIds([missedNeph, ckd], events),
    });
  }

  if (refillDelay && lisinopril) {
    edges.push({
      id: generateId("edge"),
      from: refillDelay.id,
      to: lisinopril.id,
      relation: "barrier_to",
      evidenceEventIds: getEventIds([refillDelay, lisinopril], events),
    });
  }

  if (a1c) {
    const diabetes = findNodeByLabel(nodes, /diabetes/i);
    if (diabetes) {
      edges.push({
        id: generateId("edge"),
        from: a1c.id,
        to: diabetes.id,
        relation: "worsening_trend",
        evidenceEventIds: getEventIds([a1c, diabetes], events),
      });
    }
  }
}

function getEventIds(nodes: GraphNode[], events: HealthEvent[]): string[] {
  const ids = new Set<string>();
  for (const node of nodes) {
    for (const id of node.eventIds ?? []) {
      ids.add(id);
    }
  }
  if (ids.size === 0) {
    return events.slice(0, 3).map((e) => e.id);
  }
  return Array.from(ids);
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
