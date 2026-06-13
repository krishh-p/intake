import { NextResponse } from "next/server";
import { isAiConfigured } from "@/lib/ai/xai";

export async function GET() {
  return NextResponse.json({
    aiConfigured: isAiConfigured(),
    model: process.env.XAI_MODEL ?? "grok-3-fast",
  });
}
