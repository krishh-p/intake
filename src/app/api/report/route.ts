import { NextResponse } from "next/server";
import {
  aiGenerateReport,
  isAiConfigured,
  mergeReportWithTemplate,
} from "@/lib/ai/extract";
import { generateReport } from "@/lib/reports/generateReport";
import type {
  HealthEvent,
  ReportSpecialty,
  RiskAlert,
  Source,
} from "@/lib/schema";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      specialty,
      patientName,
      events,
      sources,
      alerts,
    }: {
      specialty: ReportSpecialty;
      patientName: string;
      events: HealthEvent[];
      sources: Source[];
      alerts: RiskAlert[];
    } = body;

    if (!specialty || !patientName || !events?.length) {
      return NextResponse.json(
        { error: "specialty, patientName, and events are required" },
        { status: 400 }
      );
    }

    if (isAiConfigured()) {
      const aiContent = await aiGenerateReport(
        specialty,
        patientName,
        events,
        sources ?? [],
        alerts ?? []
      );
      const report = mergeReportWithTemplate(
        specialty,
        patientName,
        events,
        sources ?? [],
        alerts ?? [],
        aiContent
      );
      return NextResponse.json({ report, method: "ai" });
    }

    const report = generateReport(
      specialty,
      patientName,
      events,
      sources ?? [],
      alerts ?? []
    );
    return NextResponse.json({ report, method: "template" });
  } catch (error) {
    console.error("Report error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Report generation failed" },
      { status: 500 }
    );
  }
}
