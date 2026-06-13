const XAI_BASE = "https://api.x.ai/v1";

export function isAiConfigured(): boolean {
  return Boolean(process.env.XAI_API_KEY);
}

export function getXaiModel(): string {
  return process.env.XAI_MODEL ?? "grok-3-fast";
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

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

export function parseJsonResponse<T>(raw: string): T {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const payload = jsonMatch ? jsonMatch[1].trim() : trimmed;
  return JSON.parse(payload) as T;
}
