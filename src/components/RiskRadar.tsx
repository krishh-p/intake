"use client";

import Link from "next/link";
import { useIntake } from "@/lib/IntakeContext";
import { EmptyState } from "@/components/ui/EmptyState";
import { getSourceTypesForAlert } from "@/lib/risk/rules";
import { cn, sourceTypeLabel } from "@/lib/utils";

const SEVERITY = {
  high: { dot: "bg-alert-high", label: "High" },
  medium: { dot: "bg-alert-medium", label: "Medium" },
  low: { dot: "bg-ink-faint", label: "Low" },
};

export function RiskRadar({ variant = "full" }: { variant?: "compact" | "full" }) {
  const {
    alerts,
    state,
    selectedAlertId,
    selectAlert,
    evidenceForAlert,
  } = useIntake();

  if (alerts.length === 0) {
    return (
      <EmptyState
        title="No insights yet"
        description="Add data from multiple sources to surface cross-source risk patterns."
        actionLabel="Import health data"
        actionHref="/import"
      />
    );
  }

  return (
    <div className={cn("space-y-4", variant === "compact" && "max-h-[520px] overflow-y-auto")}>
      {alerts.map((alert) => {
        const sev = SEVERITY[alert.severity];
        const sourceTypes = getSourceTypesForAlert(alert, state.events, state.sources);
        const isSelected = selectedAlertId === alert.id;

        return (
          <button
            key={alert.id}
            type="button"
            onClick={() => selectAlert(isSelected ? null : alert.id)}
            className={cn(
              "w-full border bg-surface p-6 text-left transition",
              isSelected
                ? "border-accent ring-1 ring-accent/20"
                : "border-line hover:border-line-strong"
            )}
          >
            <div className="flex items-start gap-4">
              <span className={cn("mt-2 h-1.5 w-1.5 shrink-0 rounded-full", sev.dot)} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">
                  <span>{sev.label}</span>
                  <span>·</span>
                  <span>{alert.timeHorizon}</span>
                </div>
                <h3 className="mt-2 font-display text-base text-ink">{alert.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">{alert.explanation}</p>

                <div className="mt-4 flex flex-wrap gap-2">
                  {sourceTypes.map((type) => (
                    <span
                      key={type}
                      className="border border-line px-2.5 py-0.5 text-[11px] text-ink-muted"
                    >
                      {sourceTypeLabel(type)}
                    </span>
                  ))}
                </div>

                {isSelected && evidenceForAlert.length > 0 && (
                  <div className="mt-4 border border-line bg-paper px-4 py-3">
                    <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">
                      Supporting evidence
                    </p>
                    <ul className="mt-2 space-y-1">
                      {evidenceForAlert.slice(0, 4).map((r) => (
                        <li key={r.document.id} className="text-xs text-ink-muted">
                          {r.document.title}
                        </li>
                      ))}
                    </ul>
                    <Link
                      href="/graph"
                      className="mt-3 inline-block text-xs text-accent hover:text-accent-hover"
                      onClick={(e) => e.stopPropagation()}
                    >
                      View in knowledge graph
                    </Link>
                  </div>
                )}

                {alert.suggestedQuestions.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">
                      Questions for your visit
                    </p>
                    <ul className="mt-2 space-y-1">
                      {alert.suggestedQuestions.slice(0, 2).map((q) => (
                        <li key={q} className="text-sm text-ink-muted">
                          {q}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </button>
        );
      })}

      <p className="pt-2 text-xs text-ink-faint">
        Not medical advice. Generated from your imported data — clinician review required.
      </p>
    </div>
  );
}
