import { buildTrendTools } from "@/lib/agent/tools";
import type { GrokToolDef } from "@/lib/ai/xai";
import type { EvidenceIndex } from "@/lib/index/evidenceIndex";
import type {
  ClinicalFact,
  Entity,
  GraphEdge,
  GraphNode,
  GraphRelationship,
  HealthEvent,
  Source,
} from "@/lib/schema";

/** Relations that explain *why* — the clinically meaningful connections. */
const REASONING_RELATIONS = new Set<string>([
  "risk_factor_for",
  "worsening_trend",
  "contraindicated_with",
  "possibly_related_to",
  "managed_by",
  "needs_follow_up",
  "barrier_to",
]);

const RELATION_PHRASES: Record<string, string> = {
  has_condition: "has condition",
  takes: "takes",
  reported: "reported",
  ordered: "ordered",
  managed_by: "is managed by",
  worsening_trend: "shows a worsening trend in",
  risk_factor_for: "is a risk factor for",
  contraindicated_with: "is contraindicated with",
  needs_follow_up: "needs follow-up on",
  barrier_to: "is a barrier to",
  possibly_related_to: "is possibly related to",
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
}

function matchScore(haystack: string, queryTokens: string[]): number {
  const hay = haystack.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (hay.includes(token)) score += 1;
  }
  return score;
}

const GRAPH_SCHEMAS: GrokToolDef[] = [
  {
    type: "function",
    function: {
      name: "search_graph",
      description:
        "Search the patient's knowledge graph for entities (conditions, medications, labs, symptoms, encounters, risks). Returns matching graph node ids and labels — use these nodeIds for citations and to explore further.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Concept to look for, e.g. 'kidney', 'metformin', 'fatigue'",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_node",
      description:
        "Inspect one knowledge-graph node: its underlying health events (with eventIds for citation) and its directly connected neighbors with the relationship between them.",
      parameters: {
        type: "object",
        properties: {
          nodeId: { type: "string", description: "A nodeId returned by search_graph" },
        },
        required: ["nodeId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "explain_relationships",
      description:
        "List clinically meaningful relationships in the knowledge graph (risk_factor_for, worsening_trend, contraindicated_with, possibly_related_to, managed_by, needs_follow_up, barrier_to) with the rationale and supporting evidence. This is the primary tool for finding REASONS and explaining 'why'.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Optional entity label to filter relationships, e.g. 'eGFR' or 'diabetes'. Omit to list all.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_answer",
      description:
        "Submit the final answer to the patient's question. Every clinical claim MUST be grounded in a citation that references a real nodeId or eventId returned by other tools. In `answer`, reference citations inline as [1], [2], … matching the order of the citations array.",
      parameters: {
        type: "object",
        properties: {
          answer: {
            type: "string",
            description:
              "Clear, plain-English answer for the patient. Reference citations inline as [1], [2], …",
          },
          citations: {
            type: "array",
            description: "Evidence behind the answer, in the order referenced in `answer`.",
            items: {
              type: "object",
              properties: {
                nodeId: {
                  type: "string",
                  description: "A knowledge-graph nodeId from search_graph/get_node",
                },
                eventId: {
                  type: "string",
                  description: "A health event id from get_node/query_events/compute_trend",
                },
                note: {
                  type: "string",
                  description: "Short reason this evidence supports the answer",
                },
              },
              additionalProperties: false,
            },
          },
          followUps: {
            type: "array",
            items: { type: "string" },
            description: "Up to 3 helpful follow-up questions the patient might ask next.",
          },
        },
        required: ["answer", "citations"],
        additionalProperties: false,
      },
    },
  },
];

const REUSED_TREND_TOOLS = new Set([
  "list_metrics",
  "get_metric_series",
  "compute_trend",
  "query_events",
  "search_evidence",
  "get_risk_alerts",
  "get_current_date",
]);

export function buildAskTools(input: {
  events: HealthEvent[];
  sources: Source[];
  index: EvidenceIndex;
  nodes: GraphNode[];
  edges: GraphEdge[];
  entities: Entity[];
  clinicalFacts: ClinicalFact[];
  relationships: GraphRelationship[];
}) {
  const { events, sources, index, nodes, edges, entities, clinicalFacts, relationships } =
    input;

  // Reuse the deterministic trend/event/evidence executors so the ask agent has
  // the same grounded data tools, minus the trend-report submission.
  const trend = buildTrendTools(events, sources, index);
  const reusedSchemas = trend.schemas.filter((s) =>
    REUSED_TREND_TOOLS.has(s.function.name)
  );

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const eventById = new Map(events.map((e) => [e.id, e]));
  const entityById = new Map(entities.map((e) => [e.id, e]));
  const factById = new Map(clinicalFacts.map((f) => [f.id, f]));

  const factIdsToEventIds = (factIds: string[]) =>
    Array.from(
      new Set(
        factIds
          .map((fid) => factById.get(fid)?.eventId)
          .filter((id): id is string => Boolean(id))
      )
    );

  const graphExecutors: Record<
    string,
    (args: Record<string, unknown>) => unknown
  > = {
    search_graph: (args) => {
      const query = String(args.query ?? "");
      const queryTokens = tokenize(query);
      return nodes
        .filter((n) => n.kind !== "source")
        .map((n) => {
          const aliases = Array.isArray(n.metadata?.aliases)
            ? (n.metadata.aliases as string[])
            : [];
          const score = matchScore([n.label, n.kind, ...aliases].join(" "), queryTokens);
          return { node: n, score };
        })
        .filter((r) => (queryTokens.length === 0 ? true : r.score > 0))
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)
        .map(({ node }) => ({
          nodeId: node.id,
          kind: node.kind,
          label: node.label,
          eventIds: node.eventIds ?? [],
          latestValue: node.metadata?.latestValue,
          unit: node.metadata?.unit,
        }));
    },

    get_node: (args) => {
      const nodeId = String(args.nodeId ?? "");
      const node = nodeById.get(nodeId);
      if (!node) return { error: `Unknown nodeId: ${nodeId}` };

      const nodeEvents = (node.eventIds ?? [])
        .map((id) => eventById.get(id))
        .filter((e): e is HealthEvent => Boolean(e))
        .map((e) => ({
          eventId: e.id,
          type: e.type,
          label: e.label,
          value: e.value,
          unit: e.unit,
          observedAt: e.observedAt,
          status: e.status,
        }));

      const neighbors = edges
        .filter((e) => e.from === nodeId || e.to === nodeId)
        .map((e) => {
          const otherId = e.from === nodeId ? e.to : e.from;
          const other = nodeById.get(otherId);
          return {
            relation: e.relation,
            direction: e.from === nodeId ? "outgoing" : "incoming",
            neighborNodeId: otherId,
            neighborLabel: other?.label ?? otherId,
            neighborKind: other?.kind,
            evidenceEventIds: e.evidenceEventIds,
            confidence: e.confidence,
          };
        })
        .filter((n) => n.relation !== "mentioned_in" || n.neighborKind === "source");

      return {
        nodeId: node.id,
        kind: node.kind,
        label: node.label,
        events: nodeEvents,
        neighbors,
      };
    },

    explain_relationships: (args) => {
      const query = typeof args.query === "string" ? args.query : "";
      const queryTokens = tokenize(query);

      return relationships
        .map((rel) => {
          const from = entityById.get(rel.fromEntityId);
          const to = entityById.get(rel.toEntityId);
          const fromLabel = from?.canonicalLabel ?? rel.fromEntityId;
          const toLabel = to?.canonicalLabel ?? rel.toEntityId;
          const score =
            queryTokens.length === 0
              ? 1
              : matchScore(`${fromLabel} ${toLabel}`, queryTokens);
          return { rel, from, to, fromLabel, toLabel, score };
        })
        .filter((r) => r.score > 0)
        .sort((a, b) => {
          const aReason = REASONING_RELATIONS.has(a.rel.relation) ? 1 : 0;
          const bReason = REASONING_RELATIONS.has(b.rel.relation) ? 1 : 0;
          if (aReason !== bReason) return bReason - aReason;
          return (b.rel.confidence ?? 0) - (a.rel.confidence ?? 0);
        })
        .slice(0, 12)
        .map(({ rel, from, to, fromLabel, toLabel }) => ({
          fromNodeId: rel.fromEntityId,
          fromLabel,
          fromKind: from?.kind,
          relation: rel.relation,
          phrase: `${fromLabel} ${RELATION_PHRASES[rel.relation] ?? rel.relation.replaceAll("_", " ")} ${toLabel}`,
          toNodeId: rel.toEntityId,
          toLabel,
          toKind: to?.kind,
          rationale: rel.rationale,
          severity: rel.severity,
          confidence: rel.confidence,
          evidenceEventIds: factIdsToEventIds(rel.evidenceFactIds),
        }));
    },
  };

  const reusedExecutors: Record<
    string,
    (args: Record<string, unknown>) => unknown
  > = {};
  for (const name of REUSED_TREND_TOOLS) {
    if (trend.executors[name]) reusedExecutors[name] = trend.executors[name];
  }

  return {
    schemas: [...reusedSchemas, ...GRAPH_SCHEMAS],
    executors: { ...reusedExecutors, ...graphExecutors },
  };
}
