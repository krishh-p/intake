import { NextResponse } from "next/server";
import { runIntakeChat, type IntakeChatMessage } from "@/lib/ai/intakeAgent";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      patientName,
      messages,
    }: {
      patientName: string;
      messages: IntakeChatMessage[];
    } = body;

    if (!patientName?.trim()) {
      return NextResponse.json({ error: "patientName is required" }, { status: 400 });
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

    const result = await runIntakeChat(patientName.trim(), safeMessages);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Intake chat error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Chat failed" },
      { status: 500 }
    );
  }
}
