import { NextResponse } from "next/server";
import { aiExtractRelationships, isAiConfigured } from "@/lib/ai/extract";
import { buildGraph } from "@/lib/graph/buildGraph";
import type { ConversationContext, GraphEdge, HealthEvent, Source } from "@/lib/schema";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      patientName,
      events,
      sources,
      contexts,
    }: {
      patientName: string;
      events: HealthEvent[];
      sources: Source[];
      contexts?: ConversationContext[];
    } = body;

    if (!patientName || !events) {
      return NextResponse.json(
        { error: "patientName and events are required" },
        { status: 400 }
      );
    }

    const baseGraph = buildGraph(patientName, events, sources ?? [], contexts ?? []);
    let aiEdges: GraphEdge[] = [];

    if (isAiConfigured() && events.length >= 2) {
      aiEdges = await aiExtractRelationships(events, baseGraph.nodes);
    }

    const mergedEdges = mergeEdges(baseGraph.edges, aiEdges);

    return NextResponse.json({
      nodes: baseGraph.nodes,
      edges: mergedEdges,
      aiEdgeCount: aiEdges.length,
      method: aiEdges.length > 0 ? "ai+rules" : "rules",
    });
  } catch (error) {
    console.error("Graph analyze error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Graph analysis failed" },
      { status: 500 }
    );
  }
}

function mergeEdges(base: GraphEdge[], ai: GraphEdge[]): GraphEdge[] {
  const seen = new Set(base.map((e) => `${e.from}|${e.to}|${e.relation}`));
  const merged = [...base];
  for (const edge of ai) {
    const key = `${edge.from}|${edge.to}|${edge.relation}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(edge);
    }
  }
  return merged;
}
