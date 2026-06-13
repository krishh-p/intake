import type { EvidenceIndex } from "@/lib/index/evidenceIndex";
import { evaluateRiskRules } from "@/lib/risk/rules";
import type { GrokToolDef } from "@/lib/ai/xai";
import type { HealthEvent, Source } from "@/lib/schema";

function round(n: number, digits = 2) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function byObservedAt(a: HealthEvent, b: HealthEvent) {
  return new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime();
}

function withinDays(observedAt: string, sinceDays?: number) {
  if (!sinceDays || sinceDays <= 0) return true;
  const cutoff = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
  return new Date(observedAt).getTime() >= cutoff;
}

function minDate(events: HealthEvent[]) {
  return events.reduce(
    (min, e) => (e.observedAt < min ? e.observedAt : min),
    events[0]?.observedAt ?? ""
  );
}

function maxDate(events: HealthEvent[]) {
  return events.reduce(
    (max, e) => (e.observedAt > max ? e.observedAt : max),
    events[0]?.observedAt ?? ""
  );
}

function linregSlope(series: HealthEvent[]) {
  if (series.length < 2) return 0;
  const points = series.map((e) => ({
    t: new Date(e.observedAt).getTime() / (24 * 60 * 60 * 1000),
    v: Number(e.value),
  }));
  const n = points.length;
  const sumT = points.reduce((s, p) => s + p.t, 0);
  const sumV = points.reduce((s, p) => s + p.v, 0);
  const sumTV = points.reduce((s, p) => s + p.t * p.v, 0);
  const sumTT = points.reduce((s, p) => s + p.t * p.t, 0);
  const denom = n * sumTT - sumT * sumT;
  if (denom === 0) return 0;
  return (n * sumTV - sumT * sumV) / denom;
}

function isNumericEvent(e: HealthEvent) {
  return (
    (e.type === "lab" || e.type === "vital") &&
    e.value !== undefined &&
    !Number.isNaN(Number(e.value))
  );
}

const TOOL_SCHEMAS: GrokToolDef[] = [
  {
    type: "function",
    function: {
      name: "list_metrics",
      description:
        "List all numeric lab and vital metrics available for trend analysis, with counts and date ranges.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_metric_series",
      description:
        "Get chronological data points for a specific metric. Returns eventIds for citation.",
      parameters: {
        type: "object",
        properties: {
          metric: { type: "string", description: "Exact metric label, e.g. HbA1c, eGFR" },
          sinceDays: {
            type: "number",
            description: "Optional: only include readings from the last N days",
          },
        },
        required: ["metric"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compute_trend",
      description:
        "Compute deterministic trend statistics for a metric: first/last values, percent change, slope, direction, and evidenceEventIds.",
      parameters: {
        type: "object",
        properties: {
          metric: { type: "string" },
          sinceDays: { type: "number" },
        },
        required: ["metric"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_events",
      description: "Query health events by type, label pattern, or recency.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: [
              "condition",
              "symptom",
              "medication",
              "lab",
              "vital",
              "encounter",
              "care_task",
              "barrier",
              "note",
            ],
          },
          labelPattern: {
            type: "string",
            description: "Regex pattern to match event labels",
          },
          sinceDays: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_evidence",
      description:
        "Search patient records for supporting evidence. Returns snippets with eventIds and sourceIds.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query, e.g. 'swelling nephrology'" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_risk_alerts",
      description: "Get existing rule-based risk alerts with evidence event IDs.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_current_date",
      description: "Get today's date for grounding recent vs historical analysis.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_trend_report",
      description:
        "Submit the final trend report. Call exactly once when analysis is complete. Every trend must include evidenceEventIds from tool results.",
      parameters: {
        type: "object",
        properties: {
          trends: {
            type: "array",
            items: {
              type: "object",
              properties: {
                metric: { type: "string" },
                direction: {
                  type: "string",
                  enum: ["improving", "worsening", "stable"],
                },
                severity: { type: "string", enum: ["high", "medium", "low"] },
                changeSummary: {
                  type: "string",
                  description: "e.g. 'eGFR fell 62 → 48 over 5 months'",
                },
                narrative: {
                  type: "string",
                  description: "Plain-English, patient-facing explanation",
                },
                suggestedActions: {
                  type: "array",
                  items: { type: "string" },
                },
                evidenceEventIds: {
                  type: "array",
                  items: { type: "string" },
                  description: "MUST be event IDs returned by other tools",
                },
              },
              required: [
                "metric",
                "direction",
                "severity",
                "changeSummary",
                "narrative",
                "suggestedActions",
                "evidenceEventIds",
              ],
            },
          },
        },
        required: ["trends"],
        additionalProperties: false,
      },
    },
  },
];

export function buildTrendTools(
  events: HealthEvent[],
  _sources: Source[],
  index: EvidenceIndex
) {
  const numeric = events.filter(isNumericEvent);

  const executors: Record<string, (args: Record<string, unknown>) => unknown> = {
    list_metrics: () => {
      const byLabel = new Map<string, HealthEvent[]>();
      for (const e of numeric) {
        const list = byLabel.get(e.label) ?? [];
        list.push(e);
        byLabel.set(e.label, list);
      }
      return [...byLabel.entries()].map(([metric, evs]) => ({
        metric,
        count: evs.length,
        unit: evs[0]?.unit,
        firstObserved: minDate(evs),
        lastObserved: maxDate(evs),
      }));
    },

    get_metric_series: (args) => {
      const metric = String(args.metric ?? "");
      const sinceDays =
        typeof args.sinceDays === "number" ? args.sinceDays : undefined;
      return numeric
        .filter(
          (e) => e.label === metric && withinDays(e.observedAt, sinceDays)
        )
        .sort(byObservedAt)
        .map((e) => ({
          eventId: e.id,
          observedAt: e.observedAt,
          value: Number(e.value),
          unit: e.unit,
        }));
    },

    compute_trend: (args) => {
      const metric = String(args.metric ?? "");
      const sinceDays =
        typeof args.sinceDays === "number" ? args.sinceDays : undefined;
      const series = numeric
        .filter(
          (e) => e.label === metric && withinDays(e.observedAt, sinceDays)
        )
        .sort(byObservedAt);

      if (series.length < 2) {
        return {
          metric,
          direction: "stable",
          reason: "insufficient data",
          points: series.length,
          evidenceEventIds: series.map((e) => e.id),
        };
      }

      const first = Number(series[0].value);
      const last = Number(series[series.length - 1].value);
      const pctChange =
        first !== 0 ? ((last - first) / Math.abs(first)) * 100 : 0;
      const slope = linregSlope(series);

      let direction: "increasing" | "decreasing" | "stable" = "stable";
      if (Math.abs(pctChange) >= 5) {
        direction = last > first ? "increasing" : "decreasing";
      }

      return {
        metric,
        first,
        last,
        unit: series[0].unit,
        pctChange: round(pctChange),
        slopePerDay: round(slope),
        direction,
        window: {
          start: series[0].observedAt,
          end: series[series.length - 1].observedAt,
        },
        evidenceEventIds: series.map((e) => e.id),
        dataPoints: series.map((e) => ({
          observedAt: e.observedAt,
          value: Number(e.value),
          unit: e.unit,
        })),
      };
    },

    query_events: (args) => {
      const type = typeof args.type === "string" ? args.type : undefined;
      const labelPattern =
        typeof args.labelPattern === "string" ? args.labelPattern : undefined;
      const sinceDays =
        typeof args.sinceDays === "number" ? args.sinceDays : undefined;
      const pattern = labelPattern ? new RegExp(labelPattern, "i") : null;

      return events
        .filter((e) => {
          if (type && e.type !== type) return false;
          if (pattern && !pattern.test(e.label)) return false;
          if (!withinDays(e.observedAt, sinceDays)) return false;
          return true;
        })
        .sort(byObservedAt)
        .map((e) => ({
          eventId: e.id,
          type: e.type,
          label: e.label,
          value: e.value,
          unit: e.unit,
          observedAt: e.observedAt,
          status: e.status,
        }));
    },

    search_evidence: (args) => {
      const query = String(args.query ?? "");
      return index.search(query, 6).map((r) => ({
        eventId: r.document.eventId,
        sourceId: r.document.sourceId,
        sourceType: r.document.sourceType,
        title: r.document.title,
        snippet: r.document.text.slice(0, 240),
        score: round(r.score),
      }));
    },

    get_risk_alerts: () =>
      evaluateRiskRules(events).map((a) => ({
        title: a.title,
        severity: a.severity,
        explanation: a.explanation,
        evidenceEventIds: a.evidenceEventIds,
      })),

    get_current_date: () => ({
      today: new Date().toISOString(),
    }),
  };

  return { schemas: TOOL_SCHEMAS, executors };
}
