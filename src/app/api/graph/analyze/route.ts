import { NextResponse } from "next/server";
import { buildGraphFromKnowledge } from "@/lib/graph/buildGraph";
import { buildKnowledgeFromEvents } from "@/lib/knowledge/facts";
import { buildKnowledgeRelationships } from "@/lib/knowledge/relationships";
import type { ConversationContext, HealthEvent, Source } from "@/lib/schema";

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

    return NextResponse.json({
      nodes: graph.nodes,
      edges: graph.edges,
      reviewCount: relationshipResult.reviewItems.length + knowledge.reviewItems.length,
      method: "facts+rules",
    });
  } catch (error) {
    console.error("Graph analyze error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Graph analysis failed" },
      { status: 500 }
    );
  }
}
