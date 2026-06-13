"use client";

import { useCallback, useEffect, useState } from "react";
import { useIntake } from "@/lib/IntakeContext";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { ProcessingIndicator } from "@/components/ui/ProcessingIndicator";
import { generateAiReport, buildReportFromIntake } from "@/lib/api/client";
import { generateReport, reportToPlainText } from "@/lib/reports/generateReport";
import { ReportArticle } from "@/components/reports/ReportArticle";
import type { DoctorReport, ReportSpecialty } from "@/lib/schema";
import { cn } from "@/lib/utils";

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
          <ReportArticle report={report} />
        ) : null}
      </div>
    </div>
  );
}
