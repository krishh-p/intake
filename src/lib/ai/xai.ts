const XAI_BASE = "https://api.x.ai/v1";
const DEFAULT_TEXT_MODEL = "grok-3-fast";
const DEFAULT_VOICE_MODEL = "grok-voice-latest";
const DEFAULT_VOICE = "ara";

export function isAiConfigured(): boolean {
  return Boolean(process.env.XAI_API_KEY);
}

/** Text/chat completions model — extraction, intake chat, reports, risk. */
export function getXaiModel(): string {
  const configured = process.env.XAI_MODEL?.trim();
  if (!configured) return DEFAULT_TEXT_MODEL;
  if (/voice|realtime/i.test(configured)) {
    console.warn(
      `XAI_MODEL "${configured}" is a voice/realtime model; using ${DEFAULT_TEXT_MODEL} for text APIs. Set XAI_VOICE_MODEL for voice intake instead.`
    );
    return DEFAULT_TEXT_MODEL;
  }
  return configured;
}

/** Realtime voice model — /import/voice only. Never used for text/chat APIs. */
export function getXaiVoiceModel(): string {
  const configured = process.env.XAI_VOICE_MODEL?.trim();
  if (!configured) return DEFAULT_VOICE_MODEL;
  if (!/voice|realtime/i.test(configured)) {
    console.warn(
      `XAI_VOICE_MODEL "${configured}" does not look like a voice/realtime model.`
    );
  }
  return configured;
}

/** Voice persona for realtime sessions (e.g. ara). */
export function getXaiVoice(): string {
  return process.env.XAI_VOICE?.trim() || DEFAULT_VOICE;
}

/** Tool-capable text model — avoids voice models in XAI_MODEL. */
export function getXaiToolModel(): string {
  return process.env.XAI_TOOL_MODEL ?? "grok-3-fast";
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type GrokToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type GrokToolMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: GrokToolCall[];
  tool_call_id?: string;
};

export type GrokToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export async function grokChat(
  messages: ChatMessage[],
  options?: { json?: boolean; temperature?: number }
): Promise<string> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    throw new Error("XAI_API_KEY is not configured");
  }

  const response = await fetch(`${XAI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: getXaiModel(),
      messages,
      temperature: options?.temperature ?? 0.2,
      ...(options?.json
        ? { response_format: { type: "json_object" } }
        : {}),
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Grok API error ${response.status}: ${errText}`);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from Grok");
  return content;
}

export async function grokChatWithTools(
  messages: GrokToolMessage[],
  tools: GrokToolDef[],
  options?: {
    temperature?: number;
    toolChoice?: "auto" | "required" | "none";
    model?: string;
  }
): Promise<GrokToolMessage> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    throw new Error("XAI_API_KEY is not configured");
  }

  const response = await fetch(`${XAI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options?.model ?? getXaiToolModel(),
      messages,
      tools,
      tool_choice: options?.toolChoice ?? "auto",
      temperature: options?.temperature ?? 0.1,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Grok API error ${response.status}: ${errText}`);
  }

  const data = (await response.json()) as {
    choices?: { message?: GrokToolMessage }[];
  };
  const msg = data.choices?.[0]?.message;
  if (!msg) throw new Error("Empty response from Grok");
  return msg;
}

export function parseJsonResponse<T>(raw: string): T {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const payload = jsonMatch ? jsonMatch[1].trim() : trimmed;
  return JSON.parse(payload) as T;
}
