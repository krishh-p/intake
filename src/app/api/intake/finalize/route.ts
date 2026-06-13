import { NextResponse } from "next/server";
import { parseIntakeConversation } from "@/lib/ai/parseConversation";
import type { IntakeChatMessage } from "@/lib/ai/intakeAgent";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      messages,
      patientId,
      patientName,
    }: {
      messages: IntakeChatMessage[];
      patientId: string;
      patientName: string;
    } = body;

    if (!patientId?.trim() || !patientName?.trim()) {
      return NextResponse.json(
        { error: "patientId and patientName are required" },
        { status: 400 }
      );
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

    const result = await parseIntakeConversation(
      safeMessages,
      patientId.trim(),
      patientName.trim()
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error("Intake finalize error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Conversation parse failed" },
      { status: 500 }
    );
  }
}
