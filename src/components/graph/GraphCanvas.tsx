"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIntake } from "@/lib/IntakeContext";
import { getEventsForNode, getSourceForEvent } from "@/lib/graph/buildGraph";
import type { GraphEdge, GraphNode } from "@/lib/schema";
import { cn, sourceTypeLabel } from "@/lib/utils";
import { Button } from "@/components/ui/Button";

const NODE_STYLE: Record<string, { fill: string; stroke: string; ring: string }> = {
  patient: { fill: "#1a1f2e", stroke: "#1a1f2e", ring: "#cdd2dc" },
  condition: { fill: "#6d5b8a", stroke: "#5a4a72", ring: "#e8e4ef" },
  symptom: { fill: "#b4233c", stroke: "#962038", ring: "#f5e0e4" },
  medication: { fill: "#2e5c8a", stroke: "#244a70", ring: "#dce8f4" },
  lab: { fill: "#9a5b0a", stroke: "#7d4a08", ring: "#f3ead8" },
  encounter: { fill: "#5c6578", stroke: "#4a5263", ring: "#e3e6ec" },
  task: { fill: "#1f6b8a", stroke: "#19566f", ring: "#d9ecf4" },
  barrier: { fill: "#b4233c", stroke: "#962038", ring: "#f5e0e4" },
  source: { fill: "#9ba3b4", stroke: "#7a8496", ring: "#e3e6ec" },
};

const KIND_LABELS: Record<string, string> = {
  patient: "Patient",
  condition: "Condition",
  symptom: "Symptom",
  medication: "Medication",
  lab: "Lab / Vital",
  encounter: "Encounter",
  task: "Care task",
  barrier: "Barrier",
  source: "Source",
};

const RELATION_LABELS: Record<string, string> = {
  contraindicated_with: "Contraindicated",
  worsening_trend: "Worsening trend",
  possibly_related_to: "Related",
  barrier_to: "Barrier",
  risk_factor_for: "Risk factor",
  needs_follow_up: "Follow-up",
  has_condition: "Has condition",
  takes: "Takes",
  reported: "Reported",
  mentioned_in: "Source",
};

function forceLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number,
  height: number,
  iterations = 120
) {
  const positions = new Map<string, { x: number; y: number; vx: number; vy: number }>();
  const cx = width / 2;
  const cy = height / 2;
  const patient = nodes.find((n) => n.kind === "patient");

  nodes.forEach((node, i) => {
    const angle = (i / Math.max(nodes.length, 1)) * Math.PI * 2;
    const r = node.kind === "patient" ? 0 : node.kind === "source" ? 220 : 160;
    positions.set(node.id, {
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
      vx: 0,
      vy: 0,
    });
  });

  if (patient) positions.set(patient.id, { x: cx, y: cy, vx: 0, vy: 0 });

  for (let iter = 0; iter < iterations; iter++) {
    for (const [idA, posA] of positions) {
      if (idA === patient?.id) continue;
      for (const [idB, posB] of positions) {
        if (idA === idB) continue;
        const dx = posA.x - posB.x;
        const dy = posA.y - posB.y;
        const dist = Math.max(Math.hypot(dx, dy), 1);
        const force = 2000 / (dist * dist);
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
      const target = edge.relation === "mentioned_in" ? 140 : 100;
      const force = (dist - target) * 0.025;
      if (edge.from !== patient?.id) {
        a.vx += (dx / dist) * force;
        a.vy += (dy / dist) * force;
      }
      if (edge.to !== patient?.id) {
        b.vx -= (dx / dist) * force;
        b.vy -= (dy / dist) * force;
      }
    }

    for (const [id, pos] of positions) {
      if (id === patient?.id) continue;
      pos.vx += (cx - pos.x) * 0.002;
      pos.vy += (cy - pos.y) * 0.002;
      pos.vx *= 0.82;
      pos.vy *= 0.82;
      pos.x = Math.max(60, Math.min(width - 60, pos.x + pos.vx));
      pos.y = Math.max(60, Math.min(height - 60, pos.y + pos.vy));
    }
  }

  const result = new Map<string, { x: number; y: number }>();
  for (const [id, pos] of positions) result.set(id, { x: pos.x, y: pos.y });
  return result;
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
  const [dimensions, setDimensions] = useState({ width: 1200, height: 800 });
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setDimensions({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { nodes, edges } = displayGraph.nodes.length > 0 ? displayGraph : graph;
  const positions = useMemo(
    () => forceLayout(nodes, edges, dimensions.width, dimensions.height),
    [nodes, edges, dimensions]
  );

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const detailEvents = selectedNode ? getEventsForNode(selectedNode, state.events) : [];
  const activeId = selectedNodeId ?? hoveredId;
  const clinicalEdges = edges.filter((e) => e.relation !== "mentioned_in");
  const hasGraph = graph.nodes.length > 1;

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setTransform((t) => ({
      ...t,
      scale: Math.min(3, Math.max(0.3, t.scale * delta)),
    }));
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
      if (!isPanning) return;
      setTransform((t) => ({
        ...t,
        x: panStart.current.tx + (e.clientX - panStart.current.x),
        y: panStart.current.ty + (e.clientY - panStart.current.y),
      }));
    },
    [isPanning]
  );

  const handleMouseUp = useCallback(() => setIsPanning(false), []);

  const resetView = () => setTransform({ x: 0, y: 0, scale: 1 });

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-6 py-4">
        <div>
          <h1 className="font-display text-lg text-ink">Knowledge graph</h1>
          <p className="mt-0.5 font-mono-data text-[11px] text-ink-faint">
            {hasGraph
              ? `${nodes.length} nodes · ${clinicalEdges.length} relationships · ${indexStats.documentCount} indexed sources`
              : "Import data to build your graph"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border border-line p-0.5">
            <button
              type="button"
              onClick={() => setGraphFilterMode("full")}
              className={cn(
                "rounded-sm px-3 py-1.5 text-xs font-medium transition",
                graphFilterMode === "full"
                  ? "bg-accent text-white"
                  : "text-ink-muted hover:text-ink"
              )}
            >
              Full graph
            </button>
            <button
              type="button"
              onClick={() => setGraphFilterMode("evidence")}
              disabled={!selectedAlertId}
              className={cn(
                "rounded-sm px-3 py-1.5 text-xs font-medium transition",
                graphFilterMode === "evidence"
                  ? "bg-accent text-white"
                  : "text-ink-muted hover:text-ink",
                !selectedAlertId && "opacity-40"
              )}
            >
              Evidence path
            </button>
          </div>
          <Button variant="secondary" onClick={resetView} className="px-3 py-1.5 text-xs">
            Reset view
          </Button>
        </div>
      </div>

      <div className="relative flex flex-1 overflow-hidden">
        <div
          ref={containerRef}
          className={cn("flex-1 cursor-grab bg-paper", isPanning && "cursor-grabbing")}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {!hasGraph ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <p className="text-sm text-ink">No graph data yet</p>
                <p className="mt-1 text-xs text-ink-faint">
                  Import medical records or add notes to generate your knowledge graph.
                </p>
              </div>
            </div>
          ) : (
            <svg
              width={dimensions.width}
              height={dimensions.height}
              className="select-none"
              role="img"
              aria-label="Interactive knowledge graph"
            >
              <rect width="100%" height="100%" fill="#f8f7f4" />
              <g transform={`translate(${transform.x},${transform.y}) scale(${transform.scale})`}>
                {edges.map((edge) => {
                  const from = positions.get(edge.from);
                  const to = positions.get(edge.to);
                  if (!from || !to) return null;
                  const isActive = activeId === edge.from || activeId === edge.to || hoveredEdge === edge.id;
                  const isClinical = edge.relation !== "mentioned_in";

                  return (
                    <line
                      key={edge.id}
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      stroke={isActive ? "#2e5c8a" : isClinical ? "#cdd2dc" : "#e3e6ec"}
                      strokeWidth={isActive ? 2 : 1}
                      strokeDasharray={
                        edge.relation === "contraindicated_with"
                          ? "6 4"
                          : edge.relation === "mentioned_in"
                            ? "2 4"
                            : undefined
                      }
                      onMouseEnter={() => setHoveredEdge(edge.id)}
                      onMouseLeave={() => setHoveredEdge(null)}
                    />
                  );
                })}

                {nodes.map((node) => {
                  const pos = positions.get(node.id);
                  if (!pos) return null;
                  const style = NODE_STYLE[node.kind] ?? NODE_STYLE.encounter;
                  const isSelected = selectedNodeId === node.id;
                  const isHighlighted =
                    isSelected || node.eventIds?.some((id) => highlightedEventIds.has(id));
                  const isDimmed =
                    graphFilterMode === "evidence" &&
                    selectedAlertId &&
                    !isHighlighted &&
                    node.kind !== "patient";
                  const radius = node.kind === "patient" ? 28 : node.kind === "source" ? 10 : 14;

                  return (
                    <g
                      key={node.id}
                      opacity={isDimmed ? 0.25 : 1}
                      className="cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        selectNode(selectedNodeId === node.id ? null : node.id);
                      }}
                      onMouseEnter={() => setHoveredId(node.id)}
                      onMouseLeave={() => setHoveredId(null)}
                    >
                      {isHighlighted && (
                        <circle
                          cx={pos.x}
                          cy={pos.y}
                          r={radius + 8}
                          fill="none"
                          stroke={style.ring}
                          strokeWidth={2}
                          opacity={0.9}
                        />
                      )}
                      <circle
                        cx={pos.x}
                        cy={pos.y}
                        r={radius}
                        fill={style.fill}
                        stroke={isSelected ? "#2e5c8a" : style.stroke}
                        strokeWidth={isSelected ? 2.5 : 1.5}
                      />
                      <text
                        x={pos.x}
                        y={pos.y + radius + 14}
                        textAnchor="middle"
                        fontSize={11}
                        fontWeight={500}
                        fill="#5c6578"
                      >
                        {node.label.length > 24 ? `${node.label.slice(0, 22)}…` : node.label}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
          )}
        </div>

        {hasGraph && (
          <div className="absolute bottom-6 left-6 border border-line bg-surface/95 px-4 py-3 backdrop-blur-sm">
            <p className="text-[10px] font-medium uppercase tracking-widest text-ink-faint">
              Node types
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
              {Object.entries(NODE_STYLE)
                .filter(([k]) => k !== "source")
                .map(([kind, s]) => (
                  <span key={kind} className="flex items-center gap-1.5 text-[11px] text-ink-muted">
                    <span className="h-2 w-2 rounded-full" style={{ background: s.fill }} />
                    {KIND_LABELS[kind] ?? kind}
                  </span>
                ))}
            </div>
          </div>
        )}

        {selectedNode && (
          <aside className="w-72 shrink-0 overflow-y-auto border-l border-line bg-surface p-6">
            <p className="text-[10px] font-medium uppercase tracking-widest text-ink-faint">
              {KIND_LABELS[selectedNode.kind] ?? selectedNode.kind}
            </p>
            <h2 className="mt-1 font-display text-lg text-ink">{selectedNode.label}</h2>

            {detailEvents.length > 0 && (
              <div className="mt-6">
                <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">
                  Evidence
                </p>
                <ul className="mt-3 space-y-3">
                  {detailEvents.map((evt) => {
                    const src = getSourceForEvent(evt, state.sources);
                    return (
                      <li key={evt.id} className="border border-line bg-paper px-3 py-2.5">
                        <p className="text-sm text-ink">{evt.label}</p>
                        {evt.value !== undefined && (
                          <p className="mt-0.5 font-mono-data text-xs text-ink-faint">
                            {evt.value}
                            {evt.unit ? ` ${evt.unit}` : ""}
                          </p>
                        )}
                        {src && (
                          <span className="mt-2 inline-block border border-line px-2 py-0.5 text-[10px] text-ink-faint">
                            {sourceTypeLabel(src.type)}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <button
              type="button"
              onClick={() => selectNode(null)}
              className="mt-6 text-xs text-ink-faint hover:text-ink"
            >
              Clear selection
            </button>
          </aside>
        )}

        {hoveredEdge && (
          <div className="pointer-events-none absolute top-20 left-1/2 -translate-x-1/2 border border-line bg-surface px-3 py-1.5 text-xs text-ink-muted shadow-sm">
            {RELATION_LABELS[edges.find((e) => e.id === hoveredEdge)?.relation ?? ""] ??
              edges.find((e) => e.id === hoveredEdge)?.relation}
          </div>
        )}
      </div>

      <p className="shrink-0 border-t border-line px-6 py-2 font-mono-data text-[10px] text-ink-faint">
        Scroll to zoom · Drag to pan · Click a node for details
      </p>
    </div>
  );
}
