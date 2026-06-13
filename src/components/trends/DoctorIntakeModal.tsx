"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ReportArticle } from "@/components/reports/ReportArticle";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { ProcessingIndicator } from "@/components/ui/ProcessingIndicator";
import { buildReportFromIntake } from "@/lib/api/client";
import { useAuth } from "@/lib/AuthContext";
import { useIntake } from "@/lib/IntakeContext";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSharedReport } from "@/lib/supabase/sharedReports";
import type { DoctorReport, ReportSpecialty } from "@/lib/schema";
import { GrokVoiceSession, type VoiceSessionStatus } from "@/lib/voice/GrokVoiceSession";
import { specialtyLabel } from "@/lib/voice/doctorIntakeInstructions";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<VoiceSessionStatus, string> = {
  idle: "Ready to start",
  connecting: "Connecting…",
  ready: "Intake is joining…",
  listening: "Listening",
  speaking: "Intake is speaking",
  thinking: "Intake is thinking",
};

const SPECIALTY_DISPLAY: Record<ReportSpecialty, string> = {
  primary_care: "Primary care",
  cardiology: "Cardiology",
  nephrology: "Nephrology",
  endocrinology: "Endocrinology",
  pharmacy: "Pharmacy",
};

type Phase = "voice" | "building" | "done";

export function DoctorIntakeModal({
  specialty,
  focus,
  onClose,
}: {
  specialty: ReportSpecialty;
  focus?: { metric?: string; changeSummary?: string };
  onClose: () => void;
}) {
  const { user } = useAuth();
  const { state, alerts } = useIntake();
  const [status, setStatus] = useState<VoiceSessionStatus>("idle");
  const [phase, setPhase] = useState<Phase>("voice");
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  const sessionRef = useRef<GrokVoiceSession | null>(null);
  const messagesRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const savingRef = useRef(false);

  const displaySpecialty = SPECIALTY_DISPLAY[specialty];

  const finalizeSession = useCallback(async () => {
    if (savingRef.current || !user) return;

    const session = sessionRef.current;
    const transcript = (session?.getMessages() ?? messagesRef.current).filter((m) =>
      m.content.trim()
    );

    session?.stop();
    sessionRef.current = null;
    setStatus("idle");

    if (!transcript.some((m) => m.role === "user")) {
      setError("Share a bit more before ending the intake.");
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setPhase("building");
    setError(null);

    try {
      const { report: built } = await buildReportFromIntake({
        specialty,
        patientName: user.name,
        patientId: user.id,
        messages: transcript,
        events: state.events,
        sources: state.sources,
        alerts,
      });
      setReport(built);

      if (isSupabaseConfigured()) {
        const shared = await createSharedReport({
          patientName: user.name,
          specialty,
          report: built,
        });
        const url = `${window.location.origin}/r/${shared.token}`;
        setShareUrl(url);
      }

      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build report");
      setPhase("voice");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [user, specialty, state.events, state.sources, alerts]);

  useEffect(() => {
    return () => {
      sessionRef.current?.stop();
      sessionRef.current = null;
    };
  }, []);

  const startSession = useCallback(async () => {
    if (!user || sessionRef.current) return;
    setError(null);
    setReport(null);
    setShareUrl(null);
    messagesRef.current = [];

    const session = new GrokVoiceSession({
      patientName: user.name,
      mode: "doctor",
      specialty,
      focus,
      onStatus: setStatus,
      onMessages: (next) => {
        messagesRef.current = next;
      },
      onError: (message) => setError(message),
      onDisconnect: () => void finalizeSession(),
    });

    sessionRef.current = session;
    try {
      await session.start();
    } catch (err) {
      sessionRef.current = null;
      setStatus("idle");
      setError(err instanceof Error ? err.message : "Could not start voice session");
    }
  }, [user, specialty, focus, finalizeSession]);

  async function handleCopy() {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const isLive = status !== "idle" && phase === "voice";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="panel flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <p className="text-sm font-medium text-ink">
              {displaySpecialty} pre-visit intake
            </p>
            <p className="text-xs text-ink-faint">
              Intake will ask preliminary questions for your {specialtyLabel(specialty)} visit
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-faint transition hover:text-ink"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-6">
          {phase === "voice" && (
            <div className="mx-auto flex max-w-sm flex-col items-center text-center">
              <VoiceOrb status={status} />
              <p className="mt-6 font-display text-lg text-ink">
                {isLive ? `Talk with Intake` : `Prepare for ${displaySpecialty}`}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                {isLive
                  ? "Answer naturally. End when you're done — your report builds automatically."
                  : `Intake will run a short ${specialtyLabel(specialty)} intake to prepare a shareable visit brief.`}
              </p>
              {focus?.metric && (
                <p className="mt-3 font-mono-data text-xs text-ink-faint">
                  Focus: {focus.metric}
                  {focus.changeSummary ? ` — ${focus.changeSummary}` : ""}
                </p>
              )}
              <div className="mt-6">
                {!isLive ? (
                  <Button onClick={() => void startSession()}>Start intake</Button>
                ) : (
                  <Button
                    variant="danger"
                    onClick={() => void finalizeSession()}
                    disabled={saving}
                  >
                    End intake
                  </Button>
                )}
              </div>
              {isLive && (
                <p className="mt-4 text-xs text-ink-faint">{STATUS_LABEL[status]}</p>
              )}
            </div>
          )}

          {phase === "building" && (
            <div className="flex flex-col items-center gap-4 py-16">
              <ProcessingIndicator size="md" label="Building report" />
              <p className="text-sm text-ink-muted">Building your visit brief…</p>
            </div>
          )}

          {phase === "done" && report && (
            <div className="space-y-6">
              {shareUrl ? (
                <div className="border border-accent/30 bg-accent-soft/30 px-4 py-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">
                    Share with your doctor
                  </p>
                  <p className="mt-2 break-all font-mono-data text-sm text-ink">
                    {shareUrl}
                  </p>
                  <Button
                    variant="secondary"
                    className="mt-3"
                    onClick={() => void handleCopy()}
                  >
                    {copied ? "Copied" : "Copy link"}
                  </Button>
                </div>
              ) : (
                <div className="border border-line bg-paper px-4 py-3 text-sm text-ink-muted">
                  Report ready. Configure Supabase to enable shareable doctor links.
                </div>
              )}
              <ReportArticle
                report={report}
                footerNote="Shared by patient via Intake. Not a diagnosis. Clinician review required."
              />
            </div>
          )}

          {error && (
            <div className="mt-4">
              <Alert tone="error">{error}</Alert>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function VoiceOrb({ status }: { status: VoiceSessionStatus }) {
  const active = status === "listening" || status === "speaking" || status === "ready";
  const speaking = status === "speaking";

  return (
    <div
      className={cn(
        "relative flex h-24 w-24 items-center justify-center rounded-full border",
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
      <span className="relative font-display text-lg text-accent">I</span>
    </div>
  );
}
