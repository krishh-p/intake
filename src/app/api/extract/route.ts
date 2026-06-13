import { NextResponse } from "next/server";
import { aiExtractEvents, isAiConfigured } from "@/lib/ai/extract";
import {
  parseDoctorNote,
  type DoctorNoteInput,
} from "@/lib/ingest/doctorNoteParser";
import { parseVoiceTranscript } from "@/lib/ingest/voiceParser";
import type { SourceType } from "@/lib/schema";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      text,
      sourceType,
      patientId,
      patientName,
    }: {
      text: string;
      sourceType: SourceType;
      patientId: string;
      patientName?: string;
    } = body;

    if (!text?.trim() || !sourceType || !patientId) {
      return NextResponse.json(
        { error: "text, sourceType, and patientId are required" },
        { status: 400 }
      );
    }

    const sourceId = `src_${Date.now()}`;

    if (isAiConfigured()) {
      try {
        const events = await aiExtractEvents(
          text,
          sourceType,
          patientId,
          sourceId,
          patientName ?? "Patient"
        );

        if (events.length > 0) {
          return NextResponse.json({
            source: {
              id: sourceId,
              type: sourceType,
              title: sourceTitle(sourceType),
              capturedAt: new Date().toISOString(),
              rawText: text,
            },
            events,
            method: "ai",
          });
        }
      } catch (aiError) {
        console.error("AI extraction failed, using fallback:", aiError);
      }
    }

    const fallback =
      sourceType === "voice"
        ? parseVoiceTranscript(patientId, text)
        : parseDoctorNote(patientId, doctorNoteFromText(text));

    return NextResponse.json({ ...fallback, method: "fallback" });
  } catch (error) {
    console.error("Extract error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Extraction failed" },
      { status: 500 }
    );
  }
}

function doctorNoteFromText(text: string): DoctorNoteInput {
  const clinicianLine = text.match(/^Clinician: (.+)$/m)?.[1] ?? "";
  const clinicianMatch = clinicianLine.match(/^(.+?) \((.+)\)$/);
  return {
    clinicianName: clinicianMatch?.[1]?.trim() || "Clinician",
    specialty: clinicianMatch?.[2]?.trim() || "Unknown",
    note: text.match(/^Note: ([\s\S]+?)(?:\n(?:Follow-up|Labs|Medication):|$)/m)?.[1]?.trim() ?? text,
    followUp: text.match(/^Follow-up: (.+)$/m)?.[1]?.trim(),
    lab: text.match(/^Labs: (.+)$/m)?.[1]?.trim(),
    medicationChange: text.match(/^Medication: (.+)$/m)?.[1]?.trim(),
  };
}

function sourceTitle(type: SourceType): string {
  switch (type) {
    case "voice":
      return "Voice note — patient-reported context";
    case "doctor_note":
      return "Doctor note — clinician entry";
    case "emr":
      return "EMR import";
    default:
      return "Manual entry";
  }
}
