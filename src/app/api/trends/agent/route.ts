import { runTrendAgent } from "@/lib/agent/trendAgent";
import { isAiConfigured } from "@/lib/ai/xai";
import type { HealthEvent, Source } from "@/lib/schema";

function sseLine(payload: unknown) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export async function POST(request: Request) {
  if (!isAiConfigured()) {
    return new Response(
      sseLine({ type: "error", error: "XAI_API_KEY is not configured" }),
      {
        status: 503,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      }
    );
  }

  let body: {
    patientName?: string;
    events?: HealthEvent[];
    sources?: Source[];
  };

  try {
    body = await request.json();
  } catch {
    return new Response(sseLine({ type: "error", error: "Invalid JSON body" }), {
      status: 400,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  const { patientName, events, sources } = body;

  if (!patientName?.trim() || !events?.length) {
    return new Response(
      sseLine({ type: "error", error: "patientName and events are required" }),
      {
        status: 400,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      }
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(sseLine(payload)));
      };

      try {
        const report = await runTrendAgent({
          patientName: patientName.trim(),
          events,
          sources: sources ?? [],
          onStep: (step) => send({ type: "step", ...step }),
        });
        send({ type: "done", report });
      } catch (error) {
        console.error("Trend agent error:", error);
        send({
          type: "error",
          error:
            error instanceof Error ? error.message : "Trend analysis failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
