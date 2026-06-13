"use client";

import { useMemo } from "react";
import { useIntake } from "@/lib/IntakeContext";
import { EmptyState } from "@/components/ui/EmptyState";
import type { HealthEvent, Source } from "@/lib/schema";
import { cn, formatDateTime, sourceTypeLabel } from "@/lib/utils";

const TYPE_ACCENT: Record<string, string> = {
  condition: "bg-violet-400",
  symptom: "bg-rose-400",
  medication: "bg-blue-400",
  lab: "bg-amber-400",
  vital: "bg-orange-400",
  encounter: "bg-ink-faint",
  care_task: "bg-cyan-500",
  barrier: "bg-alert-high",
  note: "bg-indigo-400",
};

function TimelineItem({
  event,
  source,
  highlighted,
  isLast,
}: {
  event: HealthEvent;
  source: Source | undefined;
  highlighted: boolean;
  isLast: boolean;
}) {
  const accent = TYPE_ACCENT[event.type] ?? "bg-line-strong";

  return (
    <div className="clinical-thread relative pl-8 pr-5 py-4">
      <span
        className={cn(
          "absolute left-[-4px] top-5 h-2 w-2 rounded-full ring-2 ring-surface",
          accent
        )}
      />
      {!isLast && (
        <span className="absolute left-0 top-7 bottom-0 w-px bg-line-strong" aria-hidden />
      )}
      <div
        className={cn(
          "flex items-start justify-between gap-4",
          highlighted && "rounded-md bg-accent-soft/50 -mx-2 px-2 py-1"
        )}
      >
        <div>
          <p className="text-sm text-ink">{event.label}</p>
          {(event.value !== undefined || event.unit) && (
            <p className="mt-0.5 font-mono-data text-sm text-ink-muted">
              {event.value}
              {event.unit ? ` ${event.unit}` : ""}
            </p>
          )}
          <div className="mt-2 flex items-center gap-2 text-xs text-ink-faint">
            <span className="capitalize">{event.type.replace("_", " ")}</span>
            {source && (
              <>
                <span>·</span>
                <span>{sourceTypeLabel(source.type)}</span>
              </>
            )}
          </div>
        </div>
        <time className="shrink-0 font-mono-data text-[11px] text-ink-faint">
          {formatDateTime(event.observedAt)}
        </time>
      </div>
    </div>
  );
}

export function Timeline({ variant = "full" }: { variant?: "compact" | "full" }) {
  const { state, highlightedEventIds } = useIntake();

  const sorted = useMemo(
    () =>
      [...state.events].sort(
        (a, b) => new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime()
      ),
    [state.events]
  );

  const sourceMap = useMemo(() => {
    const map = new Map<string, Source>();
    state.sources.forEach((s) => map.set(s.id, s));
    return map;
  }, [state.sources]);

  if (sorted.length === 0) {
    return (
      <EmptyState
        title="No events yet"
        description="Import records or add notes to build your timeline."
        actionLabel="Import health data"
        actionHref="/import"
      />
    );
  }

  return (
    <div
      className={cn(
        "panel-inset px-2 py-2",
        variant === "compact" && "max-h-[420px] overflow-y-auto"
      )}
    >
      {sorted.map((event, i) => (
        <TimelineItem
          key={event.id}
          event={event}
          source={sourceMap.get(event.sourceId)}
          highlighted={highlightedEventIds.has(event.id)}
          isLast={i === sorted.length - 1}
        />
      ))}
    </div>
  );
}
