import { runAskAgent } from "@/lib/agent/askAgent";
import { isAiConfigured } from "@/lib/ai/xai";
import type { HealthEvent, Source } from "@/lib/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

function sseLine(payload: unknown) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export async function POST(request: Request) {
  if (!isAiConfigured()) {
    return new Response(
      sseLine({ type: "error", error: "XAI_API_KEY is not configured" }),
      { status: 503, headers: SSE_HEADERS },
    );
  }

  let body: {
    patientName?: string;
    question?: string;
    events?: HealthEvent[];
    sources?: Source[];
    history?: { role: "user" | "assistant"; content: string }[];
  };

  try {
    body = await request.json();
  } catch {
    return new Response(sseLine({ type: "error", error: "Invalid JSON body" }), {
      status: 400,
      headers: SSE_HEADERS,
    });
  }

  const { patientName, question, events, sources, history } = body;

  if (!patientName?.trim() || !question?.trim() || !events?.length) {
    return new Response(
      sseLine({
        type: "error",
        error: "patientName, question, and events are required",
      }),
      { status: 400, headers: SSE_HEADERS },
    );
  }

  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sseLine(payload)));
        } catch {
          closed = true;
        }
      };

      // Padding comment defeats first-chunk buffering by some dev servers/proxies
      // so step events flush to the client as they happen.
      try {
        controller.enqueue(encoder.encode(`:${" ".repeat(2048)}\n\n`));
      } catch {
        closed = true;
      }
      send({ type: "started" });

      try {
        const answer = await runAskAgent({
          patientName: patientName.trim(),
          question: question.trim(),
          events,
          sources: sources ?? [],
          history: Array.isArray(history) ? history : [],
          onStep: (step) => send({ type: "step", ...step }),
          signal: request.signal,
        });
        send({ type: "done", answer });
      } catch (error) {
        if (!closed && !request.signal.aborted) {
          console.error("Ask agent error:", error);
          send({
            type: "error",
            error: error instanceof Error ? error.message : "Ask failed",
          });
        }
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
