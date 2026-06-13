import { NextResponse } from "next/server";
import { buildGraphFromKnowledge } from "@/lib/graph/buildGraph";
import { buildKnowledgeFromEvents } from "@/lib/knowledge/facts";
import { buildKnowledgeRelationships } from "@/lib/knowledge/relationships";
import { aiExtractRelationships, isAiConfigured } from "@/lib/ai/extract";
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

    const knowledge = buildKnowledgeFromEvents(sources ?? [], events);
    const relationshipResult = buildKnowledgeRelationships(
      events[0]?.patientId ?? "patient",
      knowledge.entities,
      knowledge.clinicalFacts
    );
    const graph = buildGraphFromKnowledge(
      patientName,
      sources ?? [],
      knowledge.clinicalFacts,
      knowledge.entities,
      relationshipResult.relationships,
      contexts ?? [],
      events
    );

    // Optional AI enrichment: schema-validated edges the deterministic rules
    // may have missed, deduped against the existing rule edges.
    let aiEdges: GraphEdge[] = [];
    if (isAiConfigured() && events.length >= 2) {
      try {
        const existing = new Set(
          graph.edges.map((e) => `${e.from}|${e.to}|${e.relation}`)
        );
        const candidates = await aiExtractRelationships(events, graph.nodes);
        aiEdges = candidates.filter(
          (e) => !existing.has(`${e.from}|${e.to}|${e.relation}`)
        );
        graph.edges.push(...aiEdges);
      } catch (aiError) {
        console.error("AI graph enrichment failed, using rule edges:", aiError);
      }
    }

    return NextResponse.json({
      nodes: graph.nodes,
      edges: graph.edges,
      reviewCount: relationshipResult.reviewItems.length + knowledge.reviewItems.length,
      aiEdgeCount: aiEdges.length,
      method: aiEdges.length > 0 ? "facts+rules+ai" : "facts+rules",
    });
  } catch (error) {
    console.error("Graph analyze error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Graph analysis failed" },
      { status: 500 }
    );
  }
}
