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

/** Responses API tool — flat function defs plus server-side built-ins. */
export type GrokResponsesTool =
  | { type: "web_search" }
  | {
      type: "function";
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };

export type GrokResponsesOutputItem = {
  type: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  role?: string;
  text?: string;
  content?: Array<{ type?: string; text?: string }> | string;
};

export type GrokResponsesResult = {
  id: string;
  output: GrokResponsesOutputItem[];
  /** Concatenated assistant message text, when the model answered in prose. */
  outputText?: string;
};

/** Tool selection for the Responses API. */
export type GrokToolChoice =
  | "auto"
  | "required"
  | "none"
  | { type: "function"; name: string };

/** Pull assistant prose out of a Responses result (streamed or from output items). */
export function extractResponsesText(result: GrokResponsesResult): string {
  if (result.outputText?.trim()) return result.outputText.trim();
  const parts: string[] = [];
  for (const item of result.output) {
    if (item.type !== "message" && item.role !== "assistant") continue;
    if (typeof item.text === "string") parts.push(item.text);
    if (typeof item.content === "string") parts.push(item.content);
    else if (Array.isArray(item.content)) {
      for (const c of item.content) {
        if (typeof c.text === "string") parts.push(c.text);
      }
    }
  }
  return parts.join("").trim();
}

export function toResponsesTools(
  schemas: GrokToolDef[],
  options?: { webSearch?: boolean }
): GrokResponsesTool[] {
  const tools: GrokResponsesTool[] = schemas.map((schema) => ({
    type: "function",
    name: schema.function.name,
    description: schema.function.description,
    parameters: schema.function.parameters,
  }));
  if (options?.webSearch !== false) {
    tools.push({ type: "web_search" });
  }
  return tools;
}

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

export type GrokResponseInput =
  | string
  | Array<{ role: "system" | "user" | "assistant"; content: string }>
  | Array<{
      type: "function_call_output";
      call_id: string;
      output: string;
    }>;

const SERVER_SIDE_TOOL_TYPES = new Set([
  "web_search_call",
  "x_search_call",
  "code_interpreter_call",
]);

export function isServerSideToolOutput(item: GrokResponsesOutputItem) {
  return SERVER_SIDE_TOOL_TYPES.has(item.type);
}

type GrokResponsesStreamEvent = {
  type: string;
  response?: GrokResponsesResult;
  item?: GrokResponsesOutputItem & {
    id?: string;
    action?: { type?: string; query?: string };
  };
  call_id?: string;
  name?: string;
  arguments?: string;
  delta?: string;
};

function buildResponsesBody(
  input: GrokResponseInput,
  tools: GrokResponsesTool[],
  options?: {
    model?: string;
    previousResponseId?: string;
    temperature?: number;
    maxTurns?: number;
    stream?: boolean;
    toolChoice?: GrokToolChoice;
  }
) {
  const body: Record<string, unknown> = {
    model: options?.model ?? getXaiToolModel(),
    input,
    tools,
    temperature: options?.temperature ?? 0.1,
  };
  if (options?.previousResponseId) {
    body.previous_response_id = options.previousResponseId;
  }
  if (options?.maxTurns) {
    body.max_turns = options.maxTurns;
  }
  if (options?.stream) {
    body.stream = true;
  }
  if (options?.toolChoice) {
    body.tool_choice = options.toolChoice;
  }
  return body;
}

function parseResponsesSseChunk(
  chunk: string,
  onEvent?: (event: GrokResponsesStreamEvent) => void
): GrokResponsesResult | null {
  let completed: GrokResponsesResult | null = null;

  for (const part of chunk.split("\n\n")) {
    const trimmed = part.trim();
    if (!trimmed || trimmed.startsWith(":")) continue;

    const dataLine = trimmed
      .split("\n")
      .find((line) => line.startsWith("data:"));
    if (!dataLine) continue;

    const payload = dataLine.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;

    let event: GrokResponsesStreamEvent;
    try {
      event = JSON.parse(payload) as GrokResponsesStreamEvent;
    } catch {
      continue;
    }

    onEvent?.(event);

    if (event.type === "response.completed" && event.response?.output) {
      completed = event.response;
    }
  }

  return completed;
}

export async function grokResponsesCreate(
  input: GrokResponseInput,
  tools: GrokResponsesTool[],
  options?: {
    model?: string;
    previousResponseId?: string;
    temperature?: number;
    maxTurns?: number;
    signal?: AbortSignal;
    toolChoice?: GrokToolChoice;
    onStreamEvent?: (event: GrokResponsesStreamEvent) => void;
  }
): Promise<GrokResponsesResult> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    throw new Error("XAI_API_KEY is not configured");
  }

  const response = await fetch(`${XAI_BASE}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      buildResponsesBody(input, tools, { ...options, stream: true })
    ),
    signal: options?.signal,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Grok API error ${response.status}: ${errText}`);
  }

  if (!response.body) {
    throw new Error("Empty streaming response from Grok");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: GrokResponsesResult | null = null;
  let streamedText = "";

  // Capture assistant prose deltas so callers can recover an answer the model
  // wrote as text instead of via a tool call.
  const onEvent = (event: GrokResponsesStreamEvent) => {
    if (
      typeof event.delta === "string" &&
      (event.type === "response.output_text.delta" ||
        event.type === "response.output_audio_transcript.delta")
    ) {
      streamedText += event.delta;
    }
    options?.onStreamEvent?.(event);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const completed = parseResponsesSseChunk(part, onEvent);
      if (completed) result = completed;
    }
  }

  if (buffer.trim()) {
    const completed = parseResponsesSseChunk(buffer, onEvent);
    if (completed) result = completed;
  }

  if (!result?.output) {
    throw new Error("Stream ended without a completed Grok response");
  }

  if (streamedText.trim() && !result.outputText) {
    result.outputText = streamedText.trim();
  }

  return result;
}

export function parseJsonResponse<T>(raw: string): T {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const payload = jsonMatch ? jsonMatch[1].trim() : trimmed;
  return JSON.parse(payload) as T;
}
