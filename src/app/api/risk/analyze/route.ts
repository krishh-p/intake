import { NextResponse } from "next/server";
import { aiEnrichAlerts, isAiConfigured } from "@/lib/ai/extract";
import { evaluateRiskRules } from "@/lib/risk/rules";
import type { HealthEvent } from "@/lib/schema";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { events }: { events: HealthEvent[] } = body;

    if (!events) {
      return NextResponse.json({ error: "events are required" }, { status: 400 });
    }

    const ruleAlerts = evaluateRiskRules(events);
    let aiAlerts: typeof ruleAlerts = [];

    if (isAiConfigured() && events.length >= 3) {
      aiAlerts = await aiEnrichAlerts(events, ruleAlerts);
    }

    const severityOrder = { high: 0, medium: 1, low: 2 };
    const alerts = [...ruleAlerts, ...aiAlerts].sort(
      (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
    );

    return NextResponse.json({
      alerts,
      ruleCount: ruleAlerts.length,
      aiCount: aiAlerts.length,
      method: aiAlerts.length > 0 ? "rules+ai" : "rules",
    });
  } catch (error) {
    console.error("Risk analyze error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Risk analysis failed" },
      { status: 500 }
    );
  }
}
