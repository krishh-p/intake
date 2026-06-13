import { NextResponse } from "next/server";
import { getXaiModel, getXaiVoice, getXaiVoiceModel, isAiConfigured } from "@/lib/ai/xai";

export async function GET() {
  return NextResponse.json({
    aiConfigured: isAiConfigured(),
    textModel: getXaiModel(),
    voiceModel: getXaiVoiceModel(),
    voice: getXaiVoice(),
  });
}
