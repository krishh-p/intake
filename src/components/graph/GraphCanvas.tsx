"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useIntake } from "@/lib/IntakeContext";
import { getEventsForNode, getSourceForEvent } from "@/lib/graph/buildGraph";
import type { GraphEdge, GraphNode } from "@/lib/schema";
import { cn, sourceTypeLabel } from "@/lib/utils";

type Point = { x: number; y: number };
type ClusterKey =
  | "person"
  | "clinical"
  | "signals"
  | "treatment"
  | "context"
  | "evidence";

const CLUSTERS: Record<
  ClusterKey,
  { label: string; note: string; fill: string; stroke: string; anchor: [number, number] }
> = {
  person: {
    label: "Patient",
    note: "The center of the map",
    fill: "#1f2a37",
    stroke: "#111827",
    anchor: [0.5, 0.5],
  },
  clinical: {
    label: "Conditions",
    note: "Long-running clinical themes",
    fill: "#6d5b8a",
    stroke: "#5a4a72",
    anchor: [0.28, 0.34],
  },
  signals: {
    label: "Signals",
    note: "Symptoms, labs, and vitals",
    fill: "#a15c18",
    stroke: "#7d4a08",
    anchor: [0.67, 0.32],
  },
  treatment: {
    label: "Treatment",
    note: "Medications and follow-up",
    fill: "#286083",
    stroke: "#1f4b66",
    anchor: [0.3, 0.7],
  },
  context: {
    label: "Context",
    note: "Conversations and barriers",
    fill: "#3d6b52",
    stroke: "#2f5540",
    anchor: [0.66, 0.7],
  },
  evidence: {
    label: "Sources",
    note: "Records and notes",
    fill: "#87909f",
    stroke: "#687284",
    anchor: [0.5, 0.88],
  },
};

const KIND_CLUSTER: Record<string, ClusterKey> = {
  patient: "person",
  condition: "clinical",
  risk: "clinical",
  symptom: "signals",
  lab: "signals",
  encounter: "context",
  medication: "treatment",
  task: "treatment",
  barrier: "context",
  conversation: "context",
  source: "evidence",
};

const KIND_LABELS: Record<string, string> = {
  patient: "Patient",
  condition: "Condition",
  symptom: "Symptom",
  medication: "Medication",
  lab: "Lab / vital",
  encounter: "Encounter",
  task: "Care task",
  barrier: "Barrier",
  source: "Source",
  conversation: "Conversation",
  risk: "Risk",
};

const RELATION_LABELS: Record<string, string> = {
  contraindicated_with: "Contraindicated",
  worsening_trend: "Worsening trend",
  possibly_related_to: "Possibly related",
  barrier_to: "Barrier",
  risk_factor_for: "Risk factor",
  needs_follow_up: "Follow-up",
  has_condition: "Has condition",
  takes: "Takes",
  reported: "Reported",
  mentioned_in: "Source trail",
  ordered: "Ordered",
  managed_by: "Managed by",
  belongs_to_visit: "Visit",
};

function nodeCluster(node: GraphNode): ClusterKey {
  return KIND_CLUSTER[node.kind] ?? "context";
}

function nodeTone(node: GraphNode) {
  return CLUSTERS[nodeCluster(node)];
}

function nodeRadius(node: GraphNode) {
  if (node.kind === "patient") return 31;
  if (node.kind === "conversation") return 20;
  if (node.kind === "source") return 10;
  return 15;
}

function relationLabel(relation: string) {
  return RELATION_LABELS[relation] ?? relation.replaceAll("_", " ");
}

function clusterLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number,
  height: number,
  overrides: Map<string, Point>,
  iterations = 90
) {
  const positions = new Map<string, { x: number; y: number; vx: number; vy: number }>();
  const marginX = Math.max(96, width * 0.08);
  const marginY = Math.max(82, height * 0.11);

  const clusterCenter = (cluster: ClusterKey): Point => {
    const [ax, ay] = CLUSTERS[cluster].anchor;
    return {
      x: marginX + (width - marginX * 2) * ax,
      y: marginY + (height - marginY * 2) * ay,
    };
  };

  const counts = new Map<ClusterKey, number>();
  nodes.forEach((node) => {
    const cluster = nodeCluster(node);
    const index = counts.get(cluster) ?? 0;
    counts.set(cluster, index + 1);
    const center = clusterCenter(cluster);
    const angle = index * 2.399963 + nodes.length * 0.07;
    const spread = node.kind === "source" ? 86 : 58 + (index % 3) * 18;
    const override = overrides.get(node.id);
    positions.set(node.id, {
      x: override?.x ?? center.x + Math.cos(angle) * spread,
      y: override?.y ?? center.y + Math.sin(angle) * spread,
      vx: 0,
      vy: 0,
    });
  });

  for (let iter = 0; iter < iterations; iter++) {
    for (const [idA, posA] of positions) {
      if (overrides.has(idA)) continue;
      const nodeA = nodes.find((node) => node.id === idA);
      if (!nodeA) continue;
      const center = clusterCenter(nodeCluster(nodeA));
      posA.vx += (center.x - posA.x) * 0.006;
      posA.vy += (center.y - posA.y) * 0.006;

      for (const [idB, posB] of positions) {
        if (idA === idB) continue;
        const dx = posA.x - posB.x;
        const dy = posA.y - posB.y;
        const dist = Math.max(Math.hypot(dx, dy), 1);
        const force = 1100 / (dist * dist);
        posA.vx += (dx / dist) * force;
        posA.vy += (dy / dist) * force;
      }
    }

    for (const edge of edges) {
      const a = positions.get(edge.from);
      const b = positions.get(edge.to);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(Math.hypot(dx, dy), 1);
      const target = edge.relation === "mentioned_in" ? 155 : 118;
      const force = (dist - target) * 0.018;
      if (!overrides.has(edge.from)) {
        a.vx += (dx / dist) * force;
        a.vy += (dy / dist) * force;
      }
      if (!overrides.has(edge.to)) {
        b.vx -= (dx / dist) * force;
        b.vy -= (dy / dist) * force;
      }
    }

    for (const [id, pos] of positions) {
      if (overrides.has(id)) continue;
      pos.vx *= 0.82;
      pos.vy *= 0.82;
      pos.x = Math.max(54, Math.min(width - 54, pos.x + pos.vx));
      pos.y = Math.max(54, Math.min(height - 54, pos.y + pos.vy));
    }
  }

  const result = new Map<string, Point>();
  for (const [id, pos] of positions) result.set(id, { x: pos.x, y: pos.y });
  return { positions: result, clusterCenter };
}

function matchesSearch(node: GraphNode, query: string) {
  if (!query) return true;
  const haystack = [
    node.label,
    node.kind,
    ...(Array.isArray(node.metadata?.aliases) ? node.metadata.aliases : []),
    ...(Array.isArray(node.metadata?.topics) ? node.metadata.topics : []),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function screenToGraph(
  point: Point,
  transform: { x: number; y: number; scale: number }
) {
  return {
    x: (point.x - transform.x) / transform.scale,
    y: (point.y - transform.y) / transform.scale,
  };
}

export function GraphCanvas() {
  const {
    displayGraph,
    graph,
    state,
    selectedNodeId,
    selectedAlertId,
    selectNode,
    highlightedEventIds,
    graphFilterMode,
    setGraphFilterMode,
    indexStats,
  } = useIntake();

  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 1200, height: 820 });
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [nodeOverrides, setNodeOverrides] = useState<Map<string, Point>>(new Map());
  const [search, setSearch] = useState("");
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null);
  const panStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const wheelZoomTimeoutRef = useRef<number | null>(null);
  const [isWheelZooming, setIsWheelZooming] = useState(false);

  // When arriving from a citation link (/graph?focus=<nodeId>), select that node
  // once the graph is available so its detail panel opens.
  const focusAppliedRef = useRef(false);
  useEffect(() => {
    if (focusAppliedRef.current) return;
    if (typeof window === "undefined") return;
    const focusId = new URLSearchParams(window.location.search).get("focus");
    if (!focusId) return;
    if (graph.nodes.some((node) => node.id === focusId)) {
      selectNode(focusId);
      focusAppliedRef.current = true;
    }
  }, [graph.nodes, selectNode]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setDimensions({
        width: Math.max(720, entry.contentRect.width),
        height: Math.max(560, entry.contentRect.height),
      });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (wheelZoomTimeoutRef.current !== null) {
        window.clearTimeout(wheelZoomTimeoutRef.current);
      }
    };
  }, []);

  const baseGraph = displayGraph.nodes.length > 0 ? displayGraph : graph;
  const baseRelations = useMemo(
    () => Array.from(new Set(baseGraph.edges.map((edge) => edge.relation))).sort(),
    [baseGraph.edges]
  );
  const [disabledRelations, setDisabledRelations] = useState<Set<string>>(new Set());

  const searchMatches = useMemo(
    () =>
      new Set(
        baseGraph.nodes
          .filter((node) => matchesSearch(node, search.trim()))
          .map((node) => node.id)
      ),
    [baseGraph.nodes, search]
  );

  const filteredNodeIds = useMemo(() => {
    if (!search.trim() && !expandedNodeId) return new Set(baseGraph.nodes.map((node) => node.id));
    const ids = new Set(search.trim() ? searchMatches : baseGraph.nodes.map((node) => node.id));
    if (expandedNodeId) ids.add(expandedNodeId);
    for (const edge of baseGraph.edges) {
      const touchesSearch = search.trim() && (searchMatches.has(edge.from) || searchMatches.has(edge.to));
      const touchesExpanded = expandedNodeId && (edge.from === expandedNodeId || edge.to === expandedNodeId);
      if (touchesSearch || touchesExpanded) {
        ids.add(edge.from);
        ids.add(edge.to);
      }
    }
    return ids;
  }, [baseGraph.nodes, baseGraph.edges, expandedNodeId, search, searchMatches]);

  const nodes = useMemo(
    () => baseGraph.nodes.filter((node) => filteredNodeIds.has(node.id)),
    [baseGraph.nodes, filteredNodeIds]
  );
  const edges = useMemo(
    () =>
      baseGraph.edges.filter(
        (edge) =>
          filteredNodeIds.has(edge.from) &&
          filteredNodeIds.has(edge.to) &&
          !disabledRelations.has(edge.relation)
      ),
    [baseGraph.edges, disabledRelations, filteredNodeIds]
  );
  const visibleEdges = useMemo(
    () =>
      edges.filter(
        (edge) =>
          edge.relation === "mentioned_in" ||
          edge.confidence === undefined ||
          edge.confidence >= 0.5 ||
          selectedNodeId === edge.from ||
          selectedNodeId === edge.to ||
          hoveredId === edge.from ||
          hoveredId === edge.to
      ),
    [edges, hoveredId, selectedNodeId]
  );

  const layout = useMemo(
    () => clusterLayout(nodes, visibleEdges, dimensions.width, dimensions.height, nodeOverrides),
    [nodes, visibleEdges, dimensions, nodeOverrides]
  );
  const positions = layout.positions;

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? graph.nodes.find((n) => n.id === selectedNodeId);
  const activeId = selectedNodeId ?? hoveredId;
  const detailEvents = selectedNode ? getEventsForNode(selectedNode, state.events) : [];
  const relatedEdges = selectedNode
    ? baseGraph.edges.filter((edge) => edge.from === selectedNode.id || edge.to === selectedNode.id)
    : [];
  const relatedNodes = relatedEdges
    .map((edge) => graph.nodes.find((node) => node.id === (edge.from === selectedNode?.id ? edge.to : edge.from)))
    .filter((node): node is GraphNode => Boolean(node));
  const hasGraph = graph.nodes.length > 1;
  const stats = {
    nodes: nodes.length,
    edges: visibleEdges.filter((edge) => edge.relation !== "mentioned_in").length,
    clusters: new Set(nodes.map(nodeCluster)).size,
  };

  const focusNode = useCallback(
    (nodeId: string) => {
      const point = positions.get(nodeId);
      if (!point) return;
      setExpandedNodeId(nodeId);
      setTransform({
        scale: 1.35,
        x: dimensions.width / 2 - point.x * 1.35,
        y: dimensions.height / 2 - point.y * 1.35,
      });
    },
    [dimensions, positions]
  );

  const resetView = () => {
    setExpandedNodeId(null);
    setSearch("");
    setTransform({ x: 0, y: 0, scale: 1 });
  };

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds) return;

    const mouseX = e.clientX - bounds.left;
    const mouseY = e.clientY - bounds.top;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;

    setIsWheelZooming(true);
    if (wheelZoomTimeoutRef.current !== null) {
      window.clearTimeout(wheelZoomTimeoutRef.current);
    }

    setTransform((t) => {
      const newScale = Math.min(3.2, Math.max(0.32, t.scale * delta));
      const scaleRatio = newScale / t.scale;
      // Keep the graph point under the cursor fixed while scale changes.
      return {
        scale: newScale,
        x: mouseX - (mouseX - t.x) * scaleRatio,
        y: mouseY - (mouseY - t.y) * scaleRatio,
      };
    });

    wheelZoomTimeoutRef.current = window.setTimeout(() => {
      setIsWheelZooming(false);
      wheelZoomTimeoutRef.current = null;
    }, 80);
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      setIsPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y };
    },
    [transform]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (draggedNodeId) {
        const bounds = containerRef.current?.getBoundingClientRect();
        if (!bounds) return;
        const graphPoint = screenToGraph(
          { x: e.clientX - bounds.left, y: e.clientY - bounds.top },
          transform
        );
        setNodeOverrides((current) => new Map(current).set(draggedNodeId, graphPoint));
        return;
      }
      if (!isPanning) return;
      setTransform((t) => ({
        ...t,
        x: panStart.current.tx + (e.clientX - panStart.current.x),
        y: panStart.current.ty + (e.clientY - panStart.current.y),
      }));
    },
    [draggedNodeId, isPanning, transform]
  );

  const endPointerAction = useCallback(() => {
    setIsPanning(false);
    setDraggedNodeId(null);
  }, []);

  const toggleRelation = (relation: string) => {
    setDisabledRelations((current) => {
      const next = new Set(current);
      if (next.has(relation)) next.delete(relation);
      else next.add(relation);
      return next;
    });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#eef0e8] text-[#18202a]">
      <div className="relative z-10 border-b border-[#c8cec3] bg-[#f7f6ef]/95 px-4 py-3 backdrop-blur md:px-6">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="font-mono-data text-[10px] uppercase tracking-[0.24em] text-[#667064]">
              Living map
            </p>
            <h1 className="mt-1 font-display text-xl tracking-tight text-[#18202a]">
              Knowledge graph
            </h1>
          </div>

          <div className="flex flex-1 flex-col gap-2 xl:max-w-4xl">
            <div className="flex flex-col gap-2 md:flex-row">
              <label className="group flex flex-1 items-center gap-2 border border-[#c8cec3] bg-[#fffdf7] px-3 py-2 shadow-[0_10px_30px_rgba(38,48,38,0.05)]">
                <span className="font-mono-data text-[10px] uppercase tracking-widest text-[#8a6f43]">
                  Find
                </span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search conditions, labs, conversations, sources..."
                  className="min-w-0 flex-1 bg-transparent text-sm text-[#18202a] outline-none placeholder:text-[#899184]"
                />
              </label>

              <div className="flex shrink-0 border border-[#c8cec3] bg-[#fffdf7] p-0.5">
                <button
                  type="button"
                  onClick={() => setGraphFilterMode("full")}
                  className={cn(
                    "px-3 py-1.5 text-xs transition",
                    graphFilterMode === "full"
                      ? "bg-[#263238] text-white"
                      : "text-[#667064] hover:text-[#18202a]"
                  )}
                >
                  Full map
                </button>
                <button
                  type="button"
                  onClick={() => setGraphFilterMode("evidence")}
                  disabled={!selectedAlertId}
                  className={cn(
                    "px-3 py-1.5 text-xs transition",
                    graphFilterMode === "evidence"
                      ? "bg-[#263238] text-white"
                      : "text-[#667064] hover:text-[#18202a]",
                    !selectedAlertId && "opacity-40"
                  )}
                >
                  Evidence path
                </button>
                <button
                  type="button"
                  onClick={resetView}
                  className="px-3 py-1.5 text-xs text-[#667064] transition hover:text-[#18202a]"
                >
                  Reset
                </button>
              </div>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1">
              {baseRelations.map((relation) => {
                const enabled = !disabledRelations.has(relation);
                return (
                  <button
                    key={relation}
                    type="button"
                    onClick={() => toggleRelation(relation)}
                    className={cn(
                      "shrink-0 border px-2.5 py-1 font-mono-data text-[10px] uppercase tracking-wider transition",
                      enabled
                        ? "border-[#31424a] bg-[#31424a] text-white"
                        : "border-[#c8cec3] bg-[#fffdf7] text-[#7c8379] opacity-60"
                    )}
                  >
                    {relationLabel(relation)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div
          ref={containerRef}
          className={cn(
            "relative flex-1 cursor-grab overflow-hidden",
            isPanning && "cursor-grabbing"
          )}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={endPointerAction}
          onMouseLeave={endPointerAction}
        >
          {!hasGraph ? (
            <div className="flex h-full items-center justify-center">
              <div className="max-w-sm border border-[#c8cec3] bg-[#fffdf7] px-6 py-5 text-center shadow-[0_24px_80px_rgba(38,48,38,0.08)]">
                <p className="font-display text-lg text-[#18202a]">The map is empty</p>
                <p className="mt-2 text-sm leading-relaxed text-[#667064]">
                  Import records or complete an intake conversation to begin charting the
                  clinical terrain.
                </p>
              </div>
            </div>
          ) : (
            <svg
              width={dimensions.width}
              height={dimensions.height}
              className="block select-none"
              role="img"
              aria-label="Interactive knowledge graph map"
            >
              <defs>
                <pattern id="atlas-grid" width="42" height="42" patternUnits="userSpaceOnUse">
                  <path d="M42 0H0V42" fill="none" stroke="#d9ddd3" strokeWidth="1" />
                  <circle cx="0" cy="0" r="1.2" fill="#c8cec3" />
                </pattern>
                <filter id="node-shadow" x="-50%" y="-50%" width="200%" height="200%">
                  <feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="#263238" floodOpacity="0.16" />
                </filter>
              </defs>
              <rect width="100%" height="100%" fill="#eef0e8" />
              <rect width="100%" height="100%" fill="url(#atlas-grid)" opacity="0.7" />
              <g transform={`translate(${transform.x},${transform.y}) scale(${transform.scale})`} style={{ transition: draggedNodeId || isPanning || isWheelZooming ? undefined : "transform 420ms cubic-bezier(.2,.8,.2,1)" }}>
                {Object.entries(CLUSTERS).map(([key, cluster]) => {
                  const center = layout.clusterCenter(key as ClusterKey);
                  const count = nodes.filter((node) => nodeCluster(node) === key).length;
                  if (count === 0) return null;
                  return (
                    <g key={key} opacity={key === "person" ? 0 : 1}>
                      <circle
                        cx={center.x}
                        cy={center.y}
                        r={key === "evidence" ? 104 : 128}
                        fill="none"
                        stroke={cluster.stroke}
                        strokeDasharray="2 10"
                        strokeOpacity="0.2"
                      />
                      <text
                        x={center.x}
                        y={center.y - (key === "evidence" ? 96 : 120)}
                        textAnchor="middle"
                        fontSize="10"
                        letterSpacing="0.18em"
                        fill="#667064"
                      >
                        {cluster.label.toUpperCase()}
                      </text>
                    </g>
                  );
                })}

                {visibleEdges.map((edge) => {
                  const from = positions.get(edge.from);
                  const to = positions.get(edge.to);
                  if (!from || !to) return null;
                  const isActive =
                    activeId === edge.from || activeId === edge.to || hoveredEdge === edge.id;
                  const stroke =
                    edge.relation === "contraindicated_with"
                      ? "#9d273c"
                      : edge.relation === "mentioned_in"
                        ? "#aab0a6"
                        : "#7b8780";
                  return (
                    <g key={edge.id}>
                      <line
                        x1={from.x}
                        y1={from.y}
                        x2={to.x}
                        y2={to.y}
                        stroke={stroke}
                        strokeOpacity={isActive ? 0.9 : 0.28}
                        strokeWidth={isActive ? 2.2 : 1.1}
                        strokeDasharray={
                          edge.relation === "mentioned_in"
                            ? "2 7"
                            : edge.relation === "contraindicated_with"
                              ? "7 5"
                              : undefined
                        }
                        className="transition-all duration-300"
                        onMouseEnter={() => setHoveredEdge(edge.id)}
                        onMouseLeave={() => setHoveredEdge(null)}
                      />
                    </g>
                  );
                })}

                {nodes.map((node) => {
                  const pos = positions.get(node.id);
                  if (!pos) return null;
                  const tone = nodeTone(node);
                  const radius = nodeRadius(node);
                  const isSelected = selectedNodeId === node.id;
                  const isHovered = hoveredId === node.id;
                  const isSearchMatch = search.trim() ? searchMatches.has(node.id) : false;
                  const isHighlighted =
                    isSelected ||
                    isHovered ||
                    isSearchMatch ||
                    node.eventIds?.some((id) => highlightedEventIds.has(id));
                  const isDimmed =
                    (search.trim() && !filteredNodeIds.has(node.id)) ||
                    (graphFilterMode === "evidence" &&
                      selectedAlertId &&
                      !isHighlighted &&
                      node.kind !== "patient");

                  return (
                    <g
                      key={node.id}
                      opacity={isDimmed ? 0.2 : 1}
                      className="cursor-pointer transition-opacity duration-300"
                      style={{ transition: "opacity 260ms ease" }}
                      onMouseEnter={() => setHoveredId(node.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      onMouseDown={(event) => {
                        event.stopPropagation();
                        setDraggedNodeId(node.id);
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        selectNode(selectedNodeId === node.id ? null : node.id);
                        focusNode(node.id);
                      }}
                    >
                      {isHighlighted && (
                        <circle
                          cx={pos.x}
                          cy={pos.y}
                          r={radius + 12}
                          fill={tone.fill}
                          opacity="0.12"
                        />
                      )}
                      <circle
                        cx={pos.x}
                        cy={pos.y}
                        r={radius}
                        fill={tone.fill}
                        stroke={isSelected ? "#0f1720" : tone.stroke}
                        strokeWidth={isSelected ? 3 : 1.5}
                        filter={node.kind === "patient" || isSelected ? "url(#node-shadow)" : undefined}
                        className="transition-all duration-300"
                      />
                      {node.kind !== "source" && (
                        <circle
                          cx={pos.x - radius * 0.25}
                          cy={pos.y - radius * 0.25}
                          r={Math.max(2.4, radius * 0.16)}
                          fill="#fffdf7"
                          opacity="0.72"
                        />
                      )}
                      <text
                        x={pos.x}
                        y={pos.y + radius + 16}
                        textAnchor="middle"
                        fontSize={node.kind === "patient" ? 12 : 11}
                        fontWeight={node.kind === "patient" ? 700 : 560}
                        fill="#27313a"
                        className="pointer-events-none"
                      >
                        {node.label.length > 28 ? `${node.label.slice(0, 26)}…` : node.label}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
          )}

          {hasGraph && (
            <>
              <div className="absolute left-4 top-4 max-w-[18rem] border border-[#c8cec3] bg-[#fffdf7]/92 px-4 py-3 shadow-[0_18px_50px_rgba(38,48,38,0.08)] backdrop-blur md:left-6 md:top-6">
                <p className="font-mono-data text-[10px] uppercase tracking-[0.24em] text-[#8a6f43]">
                  Cartography
                </p>
                <div className="mt-2 grid grid-cols-3 gap-3">
                  <Stat label="Nodes" value={stats.nodes} />
                  <Stat label="Links" value={stats.edges} />
                  <Stat label="Sources" value={indexStats.documentCount} />
                </div>
              </div>

              <div className="absolute bottom-4 left-4 max-w-[calc(100%-2rem)] border border-[#c8cec3] bg-[#fffdf7]/92 px-4 py-3 shadow-[0_18px_50px_rgba(38,48,38,0.08)] backdrop-blur md:bottom-6 md:left-6">
                <p className="font-mono-data text-[10px] uppercase tracking-[0.24em] text-[#667064]">
                  Legend
                </p>
                <div className="mt-2 flex max-w-[44rem] flex-wrap gap-x-4 gap-y-2">
                  {Object.entries(CLUSTERS).map(([key, cluster]) => (
                    <span
                      key={key}
                      title={cluster.note}
                      className="flex items-center gap-2 text-[11px] text-[#4d574f]"
                    >
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: cluster.fill }} />
                      <span>{cluster.label}</span>
                    </span>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {selectedNode && (
          <aside className="absolute right-3 top-3 z-20 max-h-[calc(100%-1.5rem)] w-[min(25rem,calc(100%-1.5rem))] overflow-y-auto border border-[#c8cec3] bg-[#fffdf7]/96 p-5 shadow-[0_24px_90px_rgba(24,32,42,0.18)] backdrop-blur lg:static lg:max-h-none lg:w-96 lg:shrink-0 lg:border-y-0 lg:border-r-0 lg:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-mono-data text-[10px] uppercase tracking-[0.24em] text-[#8a6f43]">
                  {KIND_LABELS[selectedNode.kind] ?? selectedNode.kind}
                </p>
                <h2 className="mt-2 font-display text-2xl leading-tight text-[#18202a]">
                  {selectedNode.label}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => selectNode(null)}
                className="border border-[#c8cec3] px-2 py-1 text-xs text-[#667064] transition hover:border-[#18202a] hover:text-[#18202a]"
              >
                Close
              </button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {selectedNode.confidence !== undefined && (
                <Badge>{Math.round(selectedNode.confidence * 100)}% confidence</Badge>
              )}
              {selectedNode.reviewStatus && (
                <Badge>{selectedNode.reviewStatus.replace("_", " ")}</Badge>
              )}
              <Badge>{relatedNodes.length} related</Badge>
            </div>

            {selectedNode.kind === "conversation" && (
              <ConversationDetail metadata={selectedNode.metadata} />
            )}

            {relatedNodes.length > 0 && (
              <section className="mt-6">
                <h3 className="font-mono-data text-[10px] uppercase tracking-[0.22em] text-[#667064]">
                  Nearby concepts
                </h3>
                <div className="mt-3 space-y-2">
                  {relatedNodes.slice(0, 8).map((node) => (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => {
                        selectNode(node.id);
                        focusNode(node.id);
                      }}
                      className="flex w-full items-center justify-between gap-3 border border-[#d8dcd2] bg-[#f7f6ef] px-3 py-2 text-left transition hover:border-[#9ca596]"
                    >
                      <span className="text-sm text-[#27313a]">{node.label}</span>
                      <span className="text-[10px] uppercase tracking-wider text-[#7c8379]">
                        {KIND_LABELS[node.kind] ?? node.kind}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {relatedEdges.length > 0 && (
              <section className="mt-6">
                <h3 className="font-mono-data text-[10px] uppercase tracking-[0.22em] text-[#667064]">
                  Relationship traces
                </h3>
                <ul className="mt-3 space-y-2">
                  {relatedEdges.slice(0, 8).map((edge) => (
                    <li key={edge.id} className="border-l-2 border-[#c8cec3] pl-3 text-sm text-[#4d574f]">
                      {relationLabel(edge.relation)}
                      {edge.confidence !== undefined && (
                        <span className="font-mono-data text-[10px] text-[#899184]">
                          {" "}
                          / {Math.round(edge.confidence * 100)}%
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {detailEvents.length > 0 && (
              <section className="mt-6">
                <h3 className="font-mono-data text-[10px] uppercase tracking-[0.22em] text-[#667064]">
                  Field evidence
                </h3>
                <ul className="mt-3 space-y-3">
                  {detailEvents.map((evt) => {
                    const src = getSourceForEvent(evt, state.sources);
                    return (
                      <li key={evt.id} className="border border-[#d8dcd2] bg-[#f7f6ef] px-3 py-3">
                        <p className="text-sm font-medium text-[#27313a]">{evt.label}</p>
                        {(evt.value !== undefined || evt.unit) && (
                          <p className="mt-1 font-mono-data text-xs text-[#667064]">
                            {evt.value}
                            {evt.unit ? ` ${evt.unit}` : ""}
                          </p>
                        )}
                        {typeof evt.metadata?.evidenceQuote === "string" && (
                          <blockquote className="mt-2 border-l-2 border-[#c8cec3] pl-2 text-xs leading-relaxed text-[#667064]">
                            {evt.metadata.evidenceQuote}
                          </blockquote>
                        )}
                        {src && (
                          <span className="mt-2 inline-block border border-[#c8cec3] px-2 py-0.5 text-[10px] text-[#667064]">
                            {sourceTypeLabel(src.type)} · {src.title}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {selectedNode.metadata && (
              <section className="mt-6">
                <h3 className="font-mono-data text-[10px] uppercase tracking-[0.22em] text-[#667064]">
                  Metadata
                </h3>
                <MetadataList metadata={selectedNode.metadata} />
              </section>
            )}
          </aside>
        )}

        {hoveredEdge && (
          <div className="pointer-events-none absolute left-1/2 top-20 z-30 -translate-x-1/2 border border-[#c8cec3] bg-[#fffdf7] px-3 py-1.5 text-xs text-[#4d574f] shadow-sm">
            {relationLabel(visibleEdges.find((edge) => edge.id === hoveredEdge)?.relation ?? "")}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-[#c8cec3] bg-[#f7f6ef] px-4 py-2 font-mono-data text-[10px] uppercase tracking-[0.18em] text-[#667064] md:px-6">
        Scroll to zoom · Drag the canvas to pan · Drag nodes to pin them · Click a node to focus its neighborhood
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="font-mono-data text-lg text-[#18202a]">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-[#7c8379]">{label}</p>
    </div>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="border border-[#c8cec3] bg-[#f7f6ef] px-2 py-1 font-mono-data text-[10px] uppercase tracking-wider text-[#667064]">
      {children}
    </span>
  );
}

function ConversationDetail({ metadata }: { metadata?: Record<string, unknown> }) {
  if (!metadata) return null;

  const summary = typeof metadata.summary === "string" ? metadata.summary : "";
  const sections: { label: string; items: string[] }[] = [
    { label: "Symptoms", items: stringArray(metadata.symptoms) },
    { label: "Medications", items: stringArray(metadata.medications) },
    { label: "Barriers", items: stringArray(metadata.barriers) },
    { label: "Concerns", items: stringArray(metadata.concerns) },
    { label: "Follow-up", items: stringArray(metadata.followUpItems) },
  ].filter((section) => section.items.length > 0);

  return (
    <div className="mt-5 space-y-4">
      {summary && <p className="text-sm leading-relaxed text-[#4d574f]">{summary}</p>}
      {sections.map((section) => (
        <div key={section.label}>
          <p className="font-mono-data text-[10px] uppercase tracking-[0.2em] text-[#7c8379]">
            {section.label}
          </p>
          <ul className="mt-2 space-y-1">
            {section.items.map((item) => (
              <li key={item} className="text-sm text-[#27313a]">
                {item}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function MetadataList({ metadata }: { metadata: Record<string, unknown> }) {
  const entries = Object.entries(metadata).filter(
    ([key, value]) =>
      value !== undefined &&
      value !== null &&
      !["summary", "symptoms", "medications", "barriers", "concerns", "followUpItems"].includes(key)
  );
  if (entries.length === 0) return <p className="mt-2 text-xs text-[#899184]">No extra metadata.</p>;

  return (
    <dl className="mt-3 space-y-2">
      {entries.slice(0, 8).map(([key, value]) => (
        <div key={key} className="grid grid-cols-[7rem_1fr] gap-2 text-xs">
          <dt className="text-[#7c8379]">{key}</dt>
          <dd className="break-words text-[#27313a]">
            {Array.isArray(value) ? value.join(", ") : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}
