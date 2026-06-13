"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { askHealthAgent } from "@/lib/api/client";
import { useIntake } from "@/lib/IntakeContext";
import {
  GrokVoiceSession,
  type VoiceSessionStatus,
} from "@/lib/voice/GrokVoiceSession";
import { summarizePatientHealth } from "@/lib/voice/askVoiceInstructions";
import type { AgentStep, AskCitation } from "@/lib/schema";
import type { IntakeChatMessage } from "@/lib/ai/intakeAgent";
import { cn, generateId } from "@/lib/utils";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: AskCitation[];
  steps?: AgentStep[];
  followUps?: string[];
  pending?: boolean;
  error?: boolean;
  voice?: boolean;
};

const TOOL_LABELS: Record<string, string> = {
  agent_turn: "Reasoning",
  search_graph: "Searching the knowledge graph",
  get_node: "Inspecting a graph node",
  explain_relationships: "Tracing connections",
  list_metrics: "Listing available metrics",
  get_metric_series: "Fetching metric series",
  compute_trend: "Computing a trend",
  query_events: "Querying events",
  search_evidence: "Searching your records",
  get_risk_alerts: "Checking risk alerts",
  get_current_date: "Getting today's date",
  submit_answer: "Writing the answer",
};

const VOICE_STATUS_LABEL: Record<VoiceSessionStatus, string> = {
  idle: "Ready",
  connecting: "Connecting…",
  ready: "Companion is joining…",
  listening: "Listening",
  speaking: "Speaking",
  thinking: "Thinking",
};

const SUGGESTIONS = [
  "Why is my kidney function getting worse?",
  "What's driving my blood sugar trend?",
  "Which of my medications matter most right now?",
  "What should I ask my doctor about next?",
];

function graphHref(nodeId: string) {
  return `/graph?focus=${encodeURIComponent(nodeId)}`;
}

function formatStepArgs(tool: string, args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;
  if ((tool === "search_graph" || tool === "explain_relationships") && a.query) {
    return ` — "${String(a.query)}"`;
  }
  if (tool === "get_node" && a.nodeId) {
    return ` — ${String(a.nodeId).replace(/^node_/, "")}`;
  }
  if ((tool === "compute_trend" || tool === "get_metric_series") && a.metric) {
    return ` — ${String(a.metric)}`;
  }
  if (tool === "query_events" && a.labelPattern) {
    return ` — /${String(a.labelPattern)}/`;
  }
  if (tool === "search_evidence" && a.query) {
    return ` — "${String(a.query)}"`;
  }
  if (tool === "agent_turn" && a.turn) {
    return ` — turn ${String(a.turn)}`;
  }
  return "";
}

export function AskAgent() {
  const { state, aiConfigured } = useIntake();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);

  const [voiceLive, setVoiceLive] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<VoiceSessionStatus>("idle");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceMessages, setVoiceMessages] = useState<IntakeChatMessage[]>([]);

  const sessionRef = useRef<GrokVoiceSession | null>(null);
  const voiceMessagesRef = useRef<IntakeChatMessage[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, voiceMessages, running]);

  const stopVoice = useCallback(() => {
    const session = sessionRef.current;
    const transcript = (session?.getMessages() ?? voiceMessagesRef.current).filter(
      (m) => m.content.trim()
    );
    session?.stop();
    sessionRef.current = null;
    setVoiceLive(false);
    setVoiceStatus("idle");
    if (transcript.length) {
      setMessages((prev) => [
        ...prev,
        ...transcript.map((m) => ({
          id: generateId("msg"),
          role: m.role as "user" | "assistant",
          content: m.content,
          voice: true,
        })),
      ]);
    }
    voiceMessagesRef.current = [];
    setVoiceMessages([]);
  }, []);

  useEffect(() => {
    return () => {
      sessionRef.current?.stop();
      sessionRef.current = null;
    };
  }, []);

  const startVoice = useCallback(async () => {
    if (sessionRef.current || !aiConfigured) return;
    setVoiceError(null);
    voiceMessagesRef.current = [];
    setVoiceMessages([]);

    const session = new GrokVoiceSession({
      patientName: state.patient.name,
      mode: "ask",
      context: summarizePatientHealth(state.events),
      onStatus: setVoiceStatus,
      onMessages: (next) => {
        voiceMessagesRef.current = next;
        setVoiceMessages([...next]);
      },
      onError: (message) => setVoiceError(message),
      onDisconnect: () => stopVoice(),
    });

    sessionRef.current = session;
    setVoiceLive(true);
    try {
      await session.start();
    } catch (err) {
      sessionRef.current = null;
      setVoiceLive(false);
      setVoiceStatus("idle");
      setVoiceError(
        err instanceof Error ? err.message : "Could not start voice session"
      );
    }
  }, [aiConfigured, state.patient.name, state.events, stopVoice]);

  const send = useCallback(
    async (q: string) => {
      const text = q.trim();
      if (!text || running || voiceLive || state.events.length === 0) return;

      const assistantId = generateId("msg");
      const history = messages
        .filter((m) => m.content.trim())
        .map((m) => ({ role: m.role, content: m.content }));

      setMessages((prev) => [
        ...prev,
        { id: generateId("msg"), role: "user", content: text },
        { id: assistantId, role: "assistant", content: "", steps: [], pending: true },
      ]);
      setInput("");
      setRunning(true);

      try {
        const result = await askHealthAgent(
          state.patient.name,
          text,
          state.events,
          state.sources,
          history,
          (step) =>
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, steps: [...(m.steps ?? []), step] }
                  : m
              )
            )
        );
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: result.answer,
                  citations: result.citations,
                  followUps: result.followUps,
                  pending: false,
                }
              : m
          )
        );
      } catch (err) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content:
                    err instanceof Error ? err.message : "Something went wrong.",
                  pending: false,
                  error: true,
                }
              : m
          )
        );
      } finally {
        setRunning(false);
      }
    },
    [messages, running, voiceLive, state.events, state.sources, state.patient.name]
  );

  const isEmpty = messages.length === 0 && !voiceLive;

  return (
    <section className="flex min-h-[60vh] flex-col">
      {!aiConfigured && (
        <p className="mb-4 text-sm text-ink-muted">
          XAI API key is not configured. Add XAI_API_KEY to enable the assistant.
        </p>
      )}

      <div className="flex-1 space-y-5 pb-4">
        {isEmpty && (
          <div className="mx-auto max-w-md py-10 text-center">
            <p className="font-display text-lg text-ink">Ask about your health</p>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-muted">
              I search your knowledge graph — conditions, labs, medications, and how
              they connect — and answer with citations you can open. Or switch on
              voice to just talk.
            </p>
            <div className="mt-6 flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  disabled={!aiConfigured}
                  className="border border-line bg-surface px-3 py-2 text-sm text-ink-muted transition hover:border-line-strong hover:text-ink disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) =>
          m.role === "user" ? (
            <UserBubble key={m.id} content={m.content} voice={m.voice} />
          ) : (
            <AssistantBubble key={m.id} message={m} onFollowUp={(q) => void send(q)} />
          )
        )}

        {voiceLive &&
          voiceMessages
            .filter((m) => m.content.trim())
            .map((m, i) =>
              m.role === "user" ? (
                <UserBubble key={`v-${i}`} content={m.content} voice />
              ) : (
                <AssistantBubble
                  key={`v-${i}`}
                  message={{
                    id: `v-${i}`,
                    role: "assistant",
                    content: m.content,
                    voice: true,
                  }}
                  onFollowUp={() => {}}
                />
              )
            )}

        <div ref={bottomRef} />
      </div>

      <div className="sticky bottom-0 -mx-1 bg-paper/80 px-1 pb-2 pt-3 backdrop-blur">
        {voiceError && (
          <div className="mb-2 border border-alert-high/30 bg-alert-high/5 px-3 py-2 text-xs text-alert-high">
            {voiceError}
          </div>
        )}

        {voiceLive ? (
          <div className="flex items-center gap-3 rounded-2xl border border-accent/40 bg-surface px-4 py-3">
            <VoicePulse status={voiceStatus} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">Voice chat</p>
              <p className="text-xs text-ink-faint">
                {VOICE_STATUS_LABEL[voiceStatus]} · speak naturally
              </p>
            </div>
            <Button variant="danger" onClick={stopVoice}>
              End voice
            </Button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            className="flex items-end gap-2 rounded-2xl border border-line bg-surface p-2 shadow-sm"
          >
            <button
              type="button"
              onClick={() => void startVoice()}
              disabled={!aiConfigured}
              title="Switch to voice chat"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line text-ink-muted transition hover:border-accent hover:text-accent disabled:opacity-50"
            >
              <MicIcon className="h-5 w-5" />
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              placeholder={
                state.events.length === 0
                  ? "Import health data to start asking…"
                  : "Ask about your health…"
              }
              rows={1}
              disabled={running || !aiConfigured || state.events.length === 0}
              className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-1 py-2 text-sm text-ink outline-none placeholder:text-ink-faint"
            />
            <Button
              type="submit"
              disabled={running || !aiConfigured || !input.trim()}
              className="shrink-0"
            >
              {running ? "…" : "Send"}
            </Button>
          </form>
        )}
        <p className="mt-1.5 px-1 text-center text-[11px] text-ink-faint">
          Educational summary of your own records — not a diagnosis.
        </p>
      </div>
    </section>
  );
}

function UserBubble({ content, voice }: { content: string; voice?: boolean }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-sm leading-relaxed text-white">
        {voice && <MicBadge className="text-white/70" />}
        {content}
      </div>
    </div>
  );
}

function AssistantBubble({
  message,
  onFollowUp,
}: {
  message: ChatMessage;
  onFollowUp: (q: string) => void;
}) {
  const { content, citations, steps, followUps, pending, error, voice } = message;
  const answerParts = useMemo(() => splitAnswer(content), [content]);

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] space-y-3">
        <div
          className={cn(
            "rounded-2xl rounded-bl-md border px-4 py-3 text-[15px] leading-relaxed",
            error
              ? "border-alert-high/30 bg-alert-high/5 text-alert-high"
              : "border-line bg-surface text-ink"
          )}
        >
          {voice && <MicBadge className="text-ink-faint" />}

          {pending && !content && <Trace steps={steps ?? []} live />}

          {content && (
            <div className="whitespace-pre-wrap">
              {answerParts.map((part, i) =>
                part.type === "text" ? (
                  <span key={i}>{part.value}</span>
                ) : (
                  <CitationMarker
                    key={i}
                    index={part.index}
                    citation={citations?.[part.index - 1]}
                  />
                )
              )}
            </div>
          )}

          {!pending && content && (steps?.length ?? 0) > 0 && (
            <details className="mt-3 border-t border-line pt-2">
              <summary className="cursor-pointer list-none text-[11px] font-medium uppercase tracking-wider text-ink-faint">
                Reasoning · {steps!.length} steps
              </summary>
              <div className="mt-2">
                <Trace steps={steps ?? []} live={false} />
              </div>
            </details>
          )}
        </div>

        {!pending && citations && citations.length > 0 && (
          <div className="rounded-xl border border-line bg-paper px-3 py-2.5">
            <p className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">
              Citations · from your knowledge graph
            </p>
            <ol className="mt-2 space-y-1.5">
              {citations.map((c, i) => (
                <li key={c.id} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 font-mono-data text-[11px] text-ink-faint">
                    [{i + 1}]
                  </span>
                  <span className="min-w-0 flex-1">
                    {c.nodeId ? (
                      <a
                        href={graphHref(c.nodeId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-ink underline decoration-dotted underline-offset-4 hover:text-accent"
                        title="Open in knowledge graph (new tab)"
                      >
                        {c.label}
                      </a>
                    ) : (
                      <span className="text-ink">{c.label}</span>
                    )}
                    {c.detail && (
                      <span className="text-ink-muted"> — {c.detail}</span>
                    )}
                  </span>
                  {c.nodeId && (
                    <a
                      href={graphHref(c.nodeId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 self-center text-[11px] text-accent hover:text-accent-hover"
                    >
                      Graph ↗
                    </a>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}

        {!pending && followUps && followUps.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {followUps.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => onFollowUp(f)}
                className="border border-line bg-surface px-3 py-1.5 text-xs text-ink-muted transition hover:border-line-strong hover:text-ink"
              >
                {f}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Trace({ steps, live }: { steps: AgentStep[]; live: boolean }) {
  return (
    <ol className="space-y-1.5">
      {steps.map((step, i) => (
        <li
          key={`${step.tool}-${i}`}
          className="flex items-start gap-2 font-mono-data text-[12px] text-ink-muted"
        >
          <span className="text-ink-faint">{String(i + 1).padStart(2, "0")}</span>
          <span>
            {TOOL_LABELS[step.tool] ?? step.tool}
            {formatStepArgs(step.tool, step.args)}
          </span>
        </li>
      ))}
      {live && (
        <li className="flex items-center gap-2 text-[12px] text-ink-faint">
          <span className="h-3 w-3 animate-spin rounded-full border border-line border-t-accent" />
          Thinking…
        </li>
      )}
    </ol>
  );
}

function CitationMarker({
  index,
  citation,
}: {
  index: number;
  citation?: AskCitation;
}) {
  const className =
    "mx-0.5 inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1 align-super text-[10px] font-semibold transition";
  if (citation?.nodeId) {
    return (
      <a
        href={graphHref(citation.nodeId)}
        target="_blank"
        rel="noopener noreferrer"
        title={`${citation.label} — open in knowledge graph`}
        className={cn(className, "bg-accent-soft text-accent hover:bg-accent hover:text-white")}
      >
        {index}
      </a>
    );
  }
  if (citation) {
    return (
      <span title={citation.label} className={cn(className, "bg-accent-soft text-accent")}>
        {index}
      </span>
    );
  }
  return <span>[{index}]</span>;
}

function VoicePulse({ status }: { status: VoiceSessionStatus }) {
  const active = status === "listening" || status === "speaking" || status === "ready";
  const speaking = status === "speaking";
  return (
    <div
      className={cn(
        "relative flex h-10 w-10 items-center justify-center rounded-full border",
        speaking ? "border-accent bg-accent-soft" : "border-line bg-paper"
      )}
    >
      {active && (
        <span
          className={cn(
            "absolute inset-0 rounded-full",
            speaking ? "animate-ping bg-accent/20" : "animate-pulse bg-accent/10"
          )}
        />
      )}
      <MicIcon className={cn("relative h-5 w-5", speaking ? "text-accent" : "text-ink-muted")} />
    </div>
  );
}

function MicBadge({ className }: { className?: string }) {
  return (
    <span className={cn("mr-1.5 inline-flex translate-y-px align-middle", className)}>
      <MicIcon className="h-3.5 w-3.5" />
    </span>
  );
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"
      />
    </svg>
  );
}

type AnswerPart =
  | { type: "text"; value: string }
  | { type: "cite"; index: number };

function splitAnswer(text: string): AnswerPart[] {
  const parts: AnswerPart[] = [];
  const regex = /\[(\d+)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: "cite", index: Number(match[1]) });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push({ type: "text", value: text.slice(lastIndex) });
  }
  return parts;
}
