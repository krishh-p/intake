"use client";

import { useCallback, useEffect, useState } from "react";
import { useIntake } from "@/lib/IntakeContext";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { ProcessingIndicator } from "@/components/ui/ProcessingIndicator";
import { generateAiReport } from "@/lib/api/client";
import { generateReport, reportToPlainText } from "@/lib/reports/generateReport";
import type { DoctorReport, ReportSpecialty } from "@/lib/schema";
import { cn, formatDate, sourceTypeLabel } from "@/lib/utils";

const SPECIALTIES: { id: ReportSpecialty; label: string }[] = [
  { id: "primary_care", label: "Primary care" },
  { id: "cardiology", label: "Cardiology" },
  { id: "nephrology", label: "Nephrology" },
  { id: "endocrinology", label: "Endocrinology" },
  { id: "pharmacy", label: "Pharmacy" },
];

export function ReportPanel({ variant = "full" }: { variant?: "compact" | "full" }) {
  const { state, alerts } = useIntake();
  const [specialty, setSpecialty] = useState<ReportSpecialty>("cardiology");
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchReport = useCallback(async () => {
    if (state.events.length === 0) {
      setReport(null);
      return;
    }
    setLoading(true);
    try {
      const result = await generateAiReport(
        specialty,
        state.patient.name,
        state.events,
        state.sources,
        alerts
      );
      setReport(result.report);
    } catch {
      setReport(
        generateReport(specialty, state.patient.name, state.events, state.sources, alerts)
      );
    } finally {
      setLoading(false);
    }
  }, [specialty, state, alerts]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchReport();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchReport]);

  async function handleCopy() {
    if (!report) return;
    await navigator.clipboard.writeText(reportToPlainText(report));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (state.events.length === 0) {
    return (
      <EmptyState
        title="No data to report on"
        description="Import health data first, then generate a visit brief."
        actionLabel="Import health data"
        actionHref="/import"
      />
    );
  }

  return (
    <div className="space-y-6 print:space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4 print:hidden">
        <div className="flex flex-wrap gap-1 border border-line p-1">
          {SPECIALTIES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSpecialty(s.id)}
              disabled={loading}
              className={cn(
                "rounded-sm px-3 py-1.5 text-sm transition",
                specialty === s.id
                  ? "bg-accent text-white"
                  : "text-ink-muted hover:text-ink",
                loading && "opacity-60"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleCopy} disabled={!report || loading}>
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => window.print()}
            disabled={!report || loading}
          >
            Print
          </Button>
          <Button onClick={fetchReport} disabled={loading}>
            Regenerate
          </Button>
        </div>
      </div>

      <div
        id="report-content"
        className={cn("panel", variant === "full" ? "p-8 sm:p-10" : "p-6")}
      >
        {loading && !report ? (
          <div className="flex flex-col items-center gap-4 py-16">
            <ProcessingIndicator size="md" label="Generating report" />
            <p className="text-sm text-ink-muted">Generating report...</p>
          </div>
        ) : report ? (
          <article className="space-y-8">
            <header className="border-b border-line pb-6">
              <p className="text-[11px] uppercase tracking-widest text-ink-faint">Visit brief</p>
              <h2 className="mt-2 font-display text-2xl text-ink">{report.title}</h2>
              <p className="mt-2 font-mono-data text-sm text-ink-faint">
                Prepared {new Date().toLocaleDateString("en-US", { dateStyle: "long" })}
              </p>
            </header>

            <section>
              <h3 className="text-xs font-medium uppercase tracking-widest text-ink-faint">
                Summary
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-ink-muted">{report.summary}</p>
            </section>

            <section>
              <h3 className="text-xs font-medium uppercase tracking-widest text-ink-faint">
                Top concerns
              </h3>
              <ol className="mt-3 space-y-2">
                {report.topConcerns.map((c, i) => (
                  <li key={c} className="flex gap-3 text-sm text-ink-muted">
                    <span className="font-mono-data text-xs text-ink-faint">{i + 1}.</span>
                    {c}
                  </li>
                ))}
              </ol>
            </section>

            <div className="grid gap-8 sm:grid-cols-2">
              <section>
                <h3 className="text-xs font-medium uppercase tracking-widest text-ink-faint">
                  Medications
                </h3>
                <ul className="mt-3 space-y-2">
                  {report.medications.map((m) => (
                    <li key={m.id} className="text-sm text-ink-muted">
                      <span className="text-ink">{m.label}</span>
                      {m.value && <span className="text-ink-faint"> — {m.value}</span>}
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <h3 className="text-xs font-medium uppercase tracking-widest text-ink-faint">
                  Labs and vitals
                </h3>
                <ul className="mt-3 space-y-2">
                  {report.labsAndVitals.slice(0, 6).map((l) => (
                    <li key={l.id} className="text-sm text-ink-muted">
                      {l.label}: {l.value}
                      {l.unit ? ` ${l.unit}` : ""}
                      <span className="font-mono-data text-ink-faint">
                        {" "}
                        ({formatDate(l.observedAt)})
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            <section>
              <h3 className="text-xs font-medium uppercase tracking-widest text-ink-faint">
                Questions to ask
              </h3>
              <ol className="mt-3 list-decimal space-y-1.5 pl-5">
                {report.questions.map((q) => (
                  <li key={q} className="text-sm text-ink-muted">
                    {q}
                  </li>
                ))}
              </ol>
            </section>

            <section>
              <h3 className="text-xs font-medium uppercase tracking-widest text-ink-faint">
                Sources
              </h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {report.evidenceSources.map((s) => (
                  <span
                    key={s.id}
                    className="border border-line px-3 py-1 text-xs text-ink-muted"
                  >
                    {s.title} · {sourceTypeLabel(s.type)}
                  </span>
                ))}
              </div>
            </section>

            <footer className="border-t border-line pt-6 text-xs text-ink-faint">
              Generated from your imported data. Not a diagnosis. Clinician review required.
            </footer>
          </article>
        ) : null}
      </div>
    </div>
  );
}
