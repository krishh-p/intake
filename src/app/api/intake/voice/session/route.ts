import { NextResponse } from "next/server";
import { getXaiModel, getXaiVoice, getXaiVoiceModel, isAiConfigured } from "@/lib/ai/xai";
import { buildIntakeVoiceInstructions } from "@/lib/voice/intakeVoiceInstructions";

const SESSION_URL = "https://api.x.ai/v1/realtime/client_secrets";

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

    return NextResponse.json({
      token: data.value,
      expiresAt: data.expires_at,
      voice: getXaiVoice(),
      model: getXaiVoiceModel(),
      instructions: buildIntakeVoiceInstructions(patientName),
    });
  } catch (error) {
    console.error("Voice session error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Voice session failed" },
      { status: 500 }
    );
  }
}
