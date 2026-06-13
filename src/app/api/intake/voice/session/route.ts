import { NextResponse } from "next/server";
import { getXaiVoice, getXaiVoiceModel } from "@/lib/ai/xai";
import { buildIntakeVoiceInstructions } from "@/lib/voice/intakeVoiceInstructions";
import { buildDoctorIntakeInstructions } from "@/lib/voice/doctorIntakeInstructions";
import type { ReportSpecialty } from "@/lib/schema";

const SESSION_URL = "https://api.x.ai/v1/realtime/client_secrets";

const VALID_SPECIALTIES = new Set<ReportSpecialty>([
  "primary_care",
  "cardiology",
  "nephrology",
  "endocrinology",
  "pharmacy",
]);

export async function POST(request: Request) {
  try {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "XAI_API_KEY is not configured" }, { status: 503 });
    }

    const body = await request.json().catch(() => ({}));
    const patientName =
      typeof body.patientName === "string" && body.patientName.trim()
        ? body.patientName.trim()
        : "Patient";
    const mode = body.mode === "doctor" ? "doctor" : "intake";
    const specialty =
      typeof body.specialty === "string" && VALID_SPECIALTIES.has(body.specialty)
        ? (body.specialty as ReportSpecialty)
        : undefined;
    const focus =
      body.focus && typeof body.focus === "object"
        ? {
            metric:
              typeof body.focus.metric === "string" ? body.focus.metric : undefined,
            changeSummary:
              typeof body.focus.changeSummary === "string"
                ? body.focus.changeSummary
                : undefined,
          }
        : undefined;

    const response = await fetch(SESSION_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        expires_after: { seconds: 300 },
      }),
    });

    if (!response.ok) {
      const details = await response.text();
      return NextResponse.json(
        { error: "Failed to create voice session", details },
        { status: response.status }
      );
    }

    const data = (await response.json()) as { value: string; expires_at: number };

    const instructions =
      mode === "doctor" && specialty
        ? buildDoctorIntakeInstructions(patientName, specialty, focus)
        : buildIntakeVoiceInstructions(patientName);

    return NextResponse.json({
      token: data.value,
      expiresAt: data.expires_at,
      voice: getXaiVoice(),
      model: getXaiVoiceModel(),
      instructions,
    });
  } catch (error) {
    console.error("Voice session error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Voice session failed" },
      { status: 500 }
    );
  }
}
