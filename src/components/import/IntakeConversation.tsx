"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { IntakeChatMessage } from "@/lib/ai/intakeAgent";
import { GrokVoiceSession, type VoiceSessionStatus } from "@/lib/voice/GrokVoiceSession";
import { useIntake } from "@/lib/IntakeContext";
import { useAuth } from "@/lib/AuthContext";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { ProcessingIndicator } from "@/components/ui/ProcessingIndicator";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<VoiceSessionStatus, string> = {
  idle: "Ready to start",
  connecting: "Connecting…",
  ready: "Intake is joining…",
  listening: "Listening",
  speaking: "Intake is speaking",
  thinking: "Intake is thinking",
};

export function IntakeConversation() {
  const { user } = useAuth();
  const { completeIntakeConversation, processing, error, clearError } = useIntake();
  const [status, setStatus] = useState<VoiceSessionStatus>("idle");
  const [messages, setMessages] = useState<IntakeChatMessage[]>([]);
  const [savedSummary, setSavedSummary] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const sessionRef = useRef<GrokVoiceSession | null>(null);
  const messagesRef = useRef<IntakeChatMessage[]>([]);
  const savingRef = useRef(false);

  const autoSaveAndEnd = useCallback(async () => {
    if (savingRef.current) return;

    const session = sessionRef.current;
    const transcript = (session?.getMessages() ?? messagesRef.current).filter((m) =>
      m.content.trim()
    );

    session?.stop();
    sessionRef.current = null;
    setStatus("idle");

    if (!transcript.some((m) => m.role === "user")) return;

    savingRef.current = true;
    clearError();
    try {
      await completeIntakeConversation(transcript);
      setSavedSummary("Conversation saved to your timeline and knowledge graph.");
      setTimeout(() => setSavedSummary(null), 5000);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Could not save conversation");
    } finally {
      savingRef.current = false;
    }
  }, [clearError, completeIntakeConversation]);

  useEffect(() => {
    return () => {
      const session = sessionRef.current;
      const transcript = (session?.getMessages() ?? messagesRef.current).filter((m) =>
        m.content.trim()
      );
      session?.stop();
      sessionRef.current = null;
      if (transcript.some((m) => m.role === "user") && !savingRef.current) {
        void completeIntakeConversation(transcript);
      }
    };
  }, [completeIntakeConversation]);

  const startSession = useCallback(async () => {
    if (!user || sessionRef.current) return;
    clearError();
    setLocalError(null);
    setSavedSummary(null);
    messagesRef.current = [];
    setMessages([]);

    const session = new GrokVoiceSession({
      patientName: user.name,
      onStatus: setStatus,
      onMessages: (next) => {
        messagesRef.current = next;
        setMessages(next);
      },
      onError: (message) => setLocalError(message),
      onDisconnect: () => void autoSaveAndEnd(),
    });

    sessionRef.current = session;
    try {
      await session.start();
    } catch (err) {
      sessionRef.current = null;
      setStatus("idle");
      setLocalError(err instanceof Error ? err.message : "Could not start voice session");
    }
  }, [user, clearError, autoSaveAndEnd]);

  const isLive = status !== "idle";
  const displayError = localError || error;
  const isSaving = processing.active;

  return (
    <div className="panel overflow-hidden">
      <header className="flex items-center gap-3 border-b border-line px-5 py-4">
        <div
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-full font-display text-sm",
            isLive ? "bg-accent text-white" : "bg-accent-soft text-accent"
          )}
        >
          I
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">Intake</p>
          <p className="text-xs text-ink-faint">Live voice intake</p>
        </div>
        <StatusPill status={status} saving={isSaving} />
      </header>

      <div className="px-5 py-8">
        <div className="mx-auto flex max-w-sm flex-col items-center text-center">
          <VoiceOrb status={status} />
          <p className="mt-6 font-display text-lg text-ink">
            {isSaving ? "Saving your conversation…" : isLive ? "Talk with Intake" : "Start a voice session"}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            {isLive
              ? "Speak naturally. When you end the session, Intake saves automatically."
              : "Intake will ask about symptoms, medications, and care barriers. End the session when you're done — no manual save needed."}
          </p>

          <div className="mt-6">
            {!isLive ? (
              <Button onClick={() => void startSession()} disabled={isSaving}>
                Start voice session
              </Button>
            ) : (
              <Button variant="danger" onClick={() => void autoSaveAndEnd()} disabled={isSaving} className="gap-2">
                {isSaving ? (
                  <>
                    <ProcessingIndicator size="xs" variant="inverse" />
                    Saving…
                  </>
                ) : (
                  "End session"
                )}
              </Button>
            )}
          </div>
        </div>
      </div>

      {messages.length > 0 && (
        <div className="border-t border-line px-5 py-4">
          <p className="text-[10px] font-medium uppercase tracking-widest text-ink-faint">
            Session transcript
          </p>
          <ul className="mt-3 max-h-48 space-y-3 overflow-y-auto">
            {messages
              .filter((m) => m.content.trim())
              .map((msg, i) => (
                <li
                  key={`${msg.role}-${i}`}
                  className={cn(
                    "text-sm leading-relaxed",
                    msg.role === "assistant" ? "text-ink" : "text-ink-muted"
                  )}
                >
                  <span className="font-medium text-ink-faint">
                    {msg.role === "assistant" ? "Intake" : "You"}:
                  </span>{" "}
                  {msg.content}
                </li>
              ))}
          </ul>
        </div>
      )}

      {(displayError || savedSummary) && (
        <div className="border-t border-line px-5 py-3">
          {displayError && <Alert tone="error">{displayError}</Alert>}
          {savedSummary && <Alert tone="success">{savedSummary}</Alert>}
        </div>
      )}
    </div>
  );
}

function StatusPill({ status, saving }: { status: VoiceSessionStatus; saving: boolean }) {
  const live = status !== "idle";
  const label = saving ? "Saving…" : STATUS_LABEL[status];

  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-1 text-[11px] font-medium",
        live || saving ? "bg-accent-soft text-accent" : "bg-paper text-ink-faint"
      )}
    >
      {(live || saving) && (
        <ProcessingIndicator size="xs" className="mr-1.5 inline-flex translate-y-px" />
      )}
      {label}
    </span>
  );
}

function VoiceOrb({ status }: { status: VoiceSessionStatus }) {
  const active = status === "listening" || status === "speaking" || status === "ready";
  const speaking = status === "speaking";

  return (
    <div
      className={cn(
        "relative flex h-28 w-28 items-center justify-center rounded-full border",
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
      <MicIcon className={cn("relative h-8 w-8", speaking ? "text-accent" : "text-ink-muted")} />
    </div>
  );
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"
      />
    </svg>
  );
}
