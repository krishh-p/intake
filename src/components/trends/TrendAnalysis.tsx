"use client";

import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { runTrendAgent } from "@/lib/api/client";
import { useIntake } from "@/lib/IntakeContext";
import type { AgentStep, Trend, TrendReport } from "@/lib/schema";
import { cn, sourceTypeLabel } from "@/lib/utils";

const SEVERITY = {
  high: { dot: "bg-alert-high", label: "High" },
  medium: { dot: "bg-alert-medium", label: "Medium" },
  low: { dot: "bg-ink-faint", label: "Low" },
};

const DIRECTION = {
  worsening: { label: "Worsening", className: "text-alert-high" },
  improving: { label: "Improving", className: "text-accent" },
  stable: { label: "Stable", className: "text-ink-muted" },
};

const TOOL_LABELS: Record<string, string> = {
  list_metrics: "Listing available metrics",
  get_metric_series: "Fetching metric series",
  compute_trend: "Computing trend",
  query_events: "Querying events",
  search_evidence: "Searching evidence",
  get_risk_alerts: "Checking risk alerts",
  get_current_date: "Getting current date",
  submit_trend_report: "Submitting trend report",
};

function formatStepArgs(tool: string, args: unknown) {
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;
  if (tool === "compute_trend" || tool === "get_metric_series") {
    return a.metric ? ` — ${String(a.metric)}` : "";
  }
  if (tool === "search_evidence" && a.query) {
    return ` — "${String(a.query)}"`;
  }
  if (tool === "query_events" && a.labelPattern) {
    return ` — /${String(a.labelPattern)}/`;
  }
  return "";
}

function TrendCard({
  trend,
  evidenceLabels,
}: {
  trend: Trend;
  evidenceLabels: { id: string; label: string; type: string; sourceType: string }[];
}) {
  const sev = SEVERITY[trend.severity];
  const dir = DIRECTION[trend.direction];

  return (
    <article className="border border-line bg-surface p-6">
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">
        <span className={cn("flex items-center gap-1.5", dir.className)}>
          <span className={cn("h-1.5 w-1.5 rounded-full", sev.dot)} />
          {dir.label}
        </span>
        <span>·</span>
        <span>{sev.label} priority</span>
      </div>

      <h3 className="mt-2 font-display text-lg text-ink">{trend.metric}</h3>
      <p className="mt-1 font-mono-data text-sm text-ink-muted">
        {trend.changeSummary}
      </p>
      <p className="mt-3 text-sm leading-relaxed text-ink-muted">
        {trend.narrative}
      </p>

      {trend.suggestedActions.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">
            Suggested actions
          </p>
          <ul className="mt-2 space-y-1.5">
            {trend.suggestedActions.map((action) => (
              <li
                key={action}
                className="flex gap-2 text-sm text-ink-muted before:mt-2 before:h-1 before:w-1 before:shrink-0 before:rounded-full before:bg-accent"
              >
                {action}
              </li>
            ))}
          </ul>
        </div>
      )}

      {evidenceLabels.length > 0 && (
        <div className="mt-4 border border-line bg-paper px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">
            Cited from your data
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {evidenceLabels.map((ev) => (
              <span
                key={ev.id}
                className="border border-line px-2.5 py-0.5 text-[11px] text-ink-muted"
                title={ev.label}
              >
                {ev.label}
                <span className="text-ink-faint"> · {sourceTypeLabel(ev.sourceType)}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

export function TrendAnalysis() {
  const { state, aiConfigured } = useIntake();
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [report, setReport] = useState<TrendReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sourceTypeById = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of state.sources) map.set(s.id, s.type);
    return map;
  }, [state.sources]);

  const evidenceForTrend = useCallback(
    (trend: Trend) =>
      trend.evidenceEventIds
        .map((id) => state.events.find((e) => e.id === id))
        .filter((e): e is NonNullable<typeof e> => Boolean(e))
        .map((e) => ({
          id: e.id,
          label: e.label,
          type: e.type,
          sourceType: sourceTypeById.get(e.sourceId) ?? "event",
        })),
    [state.events, sourceTypeById]
  );

  const runAnalysis = useCallback(async () => {
    if (state.events.length === 0) return;
    setRunning(true);
    setSteps([]);
    setReport(null);
    setError(null);

    try {
      const result = await runTrendAgent(
        state.patient.name,
        state.events,
        state.sources,
        (step) => setSteps((prev) => [...prev, step])
      );
      setReport(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Trend analysis failed");
    } finally {
      setRunning(false);
    }
  }, [state.patient.name, state.events, state.sources]);

  const runButton = (
    <Button onClick={() => void runAnalysis()} disabled={running || !aiConfigured}>
      {running ? "Analyzing…" : "Run analysis"}
    </Button>
  );

  return (
    <section>
      {(report || running || steps.length > 0) && (
        <div className="mb-6 flex justify-end">{runButton}</div>
      )}

      {!aiConfigured && (
        <p className="mb-6 text-sm text-ink-muted">
          XAI API key is not configured. Add XAI_API_KEY to enable the trend agent.
        </p>
      )}

      {error && (
        <div className="mb-6 border border-alert-high/30 bg-alert-high/5 px-4 py-3 text-sm text-alert-high">
          {error}
        </div>
      )}

      {(running || steps.length > 0) && (
        <div className="mb-8 border border-line bg-paper px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">
            Agent trace
          </p>
          <ol className="mt-3 space-y-2">
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
            {running && (
              <li className="flex items-center gap-2 text-[12px] text-ink-faint">
                <span className="h-3 w-3 animate-spin rounded-full border border-line border-t-accent" />
                Thinking…
              </li>
            )}
          </ol>
        </div>
      )}

      {report && report.trends.length === 0 && !running && (
        <EmptyState
          title="No trends found"
          description="The agent did not find enough repeated metrics to surface trends. Add more lab or vital readings over time."
          actionLabel="Import more data"
          actionHref="/import"
        />
      )}

      {report && report.trends.length > 0 && (
        <div className="space-y-4">
          <p className="text-sm text-ink-muted">
            {report.trends.length} trend{report.trends.length === 1 ? "" : "s"} found
            <span className="text-ink-faint">
              {" "}
              · analyzed {new Date(report.generatedAt).toLocaleString()}
            </span>
          </p>
          {report.trends.map((trend) => (
            <TrendCard
              key={trend.id}
              trend={trend}
              evidenceLabels={evidenceForTrend(trend)}
            />
          ))}
        </div>
      )}

      {!report && !running && steps.length === 0 && (
        <div className="panel px-6 py-10 text-center">
          <p className="font-display text-lg text-ink">Ready to investigate</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-muted">
            Trend Scout will list your metrics, compute changes, search your records for
            context, and return cited trends with suggested actions.
          </p>
          <div className="mt-6">{runButton}</div>
        </div>
      )}
    </section>
  );
}
