import { grokChat, isAiConfigured, parseJsonResponse } from "@/lib/ai/xai";

export type IntakeChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type IntakeChatResponse = {
  message: string;
  readyToExtract: boolean;
  method: "ai" | "fallback";
};

export const INTAKE_AGENT_SYSTEM = `You are Intake, a calm and empathetic health intake assistant in a patient-owned app also called Intake.

Your job is to have a natural conversation with the patient to gather:
- Current symptoms and how long they've had them
- Medications (prescribed and OTC) and recent changes
- Recent labs, vitals, or doctor visits if they mention them
- Barriers to care (missed appointments, insurance, refills)
- Anything else relevant before their next appointment

Rules:
- Ask ONE focused question at a time. Keep replies to 2-4 sentences.
- Warm, plain language. Never diagnose or give medical advice.
- Briefly reflect what you heard before asking the next question.
- Use the patient's first name occasionally.
- After 3-5 meaningful exchanges, if you have symptoms and useful context, set readyToExtract to true and tell them they can save to their timeline.
- If the patient says they're done, that's all, or asks to save, set readyToExtract to true.

Return JSON only:
{
  "message": "your reply to the patient",
  "readyToExtract": false
}`;

const FALLBACK_GREETING =
  "Hi — I'm Intake. Tell me what's been going on with your health lately, in your own words.";

const FALLBACK_PROMPTS = [
  "Thanks for sharing. What medications are you taking, and has anything changed recently?",
  "Got it. Any trouble getting care — missed appointments, insurance issues, or refill delays?",
  "Thanks — I have enough to add this to your timeline. Tap Save when you're ready.",
];

function firstName(fullName: string) {
  return fullName.trim().split(/\s+/)[0] || "there";
}

function buildChatPrompt(patientName: string, messages: IntakeChatMessage[]): string {
  const transcript =
    messages.length === 0
      ? "(Conversation just started — greet the patient and ask your first question.)"
      : messages
          .map((m) => `${m.role === "assistant" ? "Intake" : "Patient"}: ${m.content}`)
          .join("\n");

  return `Patient name: ${patientName}
Patient first name: ${firstName(patientName)}

Conversation so far:
${transcript}`;
}

function fallbackReply(
  patientName: string,
  messages: IntakeChatMessage[]
): IntakeChatResponse {
  const userTurns = messages.filter((m) => m.role === "user").length;

  if (messages.length === 0) {
    const name = firstName(patientName);
    return {
      message: `Hi ${name} — I'm Intake. ${FALLBACK_GREETING.replace("Hi — I'm Intake. ", "")}`,
      readyToExtract: false,
      method: "fallback",
    };
  }

  if (userTurns >= FALLBACK_PROMPTS.length) {
    return {
      message: FALLBACK_PROMPTS[FALLBACK_PROMPTS.length - 1],
      readyToExtract: true,
      method: "fallback",
    };
  }

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const done =
    lastUser &&
    /\b(done|that's all|that is all|save|finished|nothing else)\b/i.test(lastUser.content);

  if (done) {
    return {
      message:
        "Thanks — I'll add what you've shared to your timeline. Tap Save when you're ready.",
      readyToExtract: true,
      method: "fallback",
    };
  }

  return {
    message: FALLBACK_PROMPTS[userTurns - 1] ?? FALLBACK_PROMPTS[FALLBACK_PROMPTS.length - 1],
    readyToExtract: userTurns >= FALLBACK_PROMPTS.length,
    method: "fallback",
  };
}

export async function runIntakeChat(
  patientName: string,
  messages: IntakeChatMessage[]
): Promise<IntakeChatResponse> {
  if (!isAiConfigured()) {
    return fallbackReply(patientName, messages);
  }

  try {
    const raw = await grokChat(
      [
        { role: "system", content: INTAKE_AGENT_SYSTEM },
        { role: "user", content: buildChatPrompt(patientName, messages) },
      ],
      { json: true, temperature: 0.4 }
    );

    const parsed = parseJsonResponse<{ message?: string; readyToExtract?: boolean }>(raw);
    const message = parsed.message?.trim();
    if (!message) throw new Error("Empty agent response");

    return {
      message,
      readyToExtract: Boolean(parsed.readyToExtract),
      method: "ai",
    };
  } catch {
    return fallbackReply(patientName, messages);
  }
}

export function formatConversationTranscript(messages: IntakeChatMessage[]): string {
  return messages
    .map((m) => `${m.role === "assistant" ? "Intake" : "Patient"}: ${m.content}`)
    .join("\n\n");
}
