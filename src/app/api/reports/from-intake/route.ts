import { NextResponse } from "next/server";
import {
  aiGenerateReport,
  isAiConfigured,
  mergeReportWithTemplate,
} from "@/lib/ai/extract";
import { formatConversationTranscript } from "@/lib/ai/intakeAgent";
import { parseIntakeConversation } from "@/lib/ai/parseConversation";
import { generateReport } from "@/lib/reports/generateReport";
import type { IntakeChatMessage } from "@/lib/ai/intakeAgent";
import type {
  HealthEvent,
  ReportSpecialty,
  RiskAlert,
  Source,
} from "@/lib/schema";

const VALID_SPECIALTIES = new Set<ReportSpecialty>([
  "primary_care",
  "cardiology",
  "nephrology",
  "endocrinology",
  "pharmacy",
]);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      specialty,
      patientName,
      patientId,
      messages,
      events,
      sources,
      alerts,
    }: {
      specialty: ReportSpecialty;
      patientName: string;
      patientId: string;
      messages: IntakeChatMessage[];
      events: HealthEvent[];
      sources: Source[];
      alerts: RiskAlert[];
    } = body;

    if (!specialty || !patientName?.trim() || !patientId?.trim()) {
      return NextResponse.json(
        { error: "specialty, patientName, and patientId are required" },
        { status: 400 }
      );
    }

    if (!VALID_SPECIALTIES.has(specialty)) {
      return NextResponse.json({ error: "Invalid specialty" }, { status: 400 });
    }

    const safeMessages = Array.isArray(messages)
      ? messages.filter(
          (m) =>
            m &&
            (m.role === "user" || m.role === "assistant") &&
            typeof m.content === "string" &&
            m.content.trim()
        )
      : [];

    if (!safeMessages.some((m) => m.role === "user")) {
      return NextResponse.json(
        { error: "At least one patient message is required" },
        { status: 400 }
      );
    }

    const workspaceEvents = events ?? [];
    const workspaceSources = sources ?? [];
    const workspaceAlerts = alerts ?? [];

    const parsed = await parseIntakeConversation(
      safeMessages,
      patientId.trim(),
      patientName.trim()
    );

    const mergedEvents = [...workspaceEvents, ...parsed.events];
    const mergedSources = [...workspaceSources, parsed.source];
    const intakeTranscript = formatConversationTranscript(safeMessages);
    const intakeSummary = parsed.context.summary;

    let report;
    if (isAiConfigured()) {
      const aiContent = await aiGenerateReport(
        specialty,
        patientName.trim(),
        mergedEvents,
        mergedSources,
        workspaceAlerts
      );
      report = mergeReportWithTemplate(
        specialty,
        patientName.trim(),
        mergedEvents,
        mergedSources,
        workspaceAlerts,
        aiContent
      );
    } else {
      report = generateReport(
        specialty,
        patientName.trim(),
        mergedEvents,
        mergedSources,
        workspaceAlerts
      );
    }

    report = {
      ...report,
      intakeSummary,
      intakeTranscript,
    };

    return NextResponse.json({ report, method: isAiConfigured() ? "ai" : "template" });
  } catch (error) {
    console.error("Report from intake error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Report from intake failed",
      },
      { status: 500 }
    );
  }
}
