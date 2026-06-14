"use client";

import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { useIntake } from "@/lib/IntakeContext";
import { formatDateTime } from "@/lib/utils";

export default function OverviewPage() {
  const { state, alerts, graph, indexStats } = useIntake();
  const hasData = state.events.length > 0;
  const recent = [...state.events]
    .sort((a, b) => new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime())
    .slice(0, 5);

  const highAlerts = alerts.filter((a) => a.severity === "high").length;

  const links = [
    {
      href: "/import/healthex",
      title: "Connect with Healthex",
      description: "Pull your EMR/EHR records from a connected health system",
    },
    {
      href: "/import/voice",
      title: "Talk to Intake",
      description: "Live voice session with Intake",
    },
    {
      href: "/graph",
      title: "Explore graph",
      description: "Interactive view of connected health data",
    },
    {
      href: "/reports",
      title: "Prepare a visit",
      description: "Generate a specialty-focused brief",
    },
  ];

  return (
    <>
      <PageHeader
        title={`Welcome back, ${state.patient.name.split(" ")[0]}`}
        description="Your private workspace for organizing health data, surfacing patterns, and preparing for appointments."
      />

      {!hasData ? (
        <EmptyState
          title="Start by importing your data"
          description="Upload medical records, talk to Intake, or enter a clinician note. Intake will connect everything into a searchable health graph."
          actionLabel="Import health data"
          actionHref="/import"
        />
      ) : (
        <>
          <div className="grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Health events" value={state.events.length} />
            <StatCard label="Data sources" value={state.sources.length} />
            <StatCard label="Graph nodes" value={graph.nodes.length} />
            <StatCard
              label="Active alerts"
              value={alerts.length}
              hint={highAlerts > 0 ? `${highAlerts} high priority` : undefined}
            />
          </div>

          <div className="mt-12 grid gap-10 lg:grid-cols-2">
            <section>
              <h2 className="text-xs font-medium uppercase tracking-widest text-ink-faint">
                Recent activity
              </h2>
              <ul className="mt-4 divide-y divide-line border border-line bg-surface">
                {recent.map((evt) => (
                  <li key={evt.id} className="flex items-start justify-between gap-4 px-5 py-4">
                    <div>
                      <p className="text-sm text-ink">{evt.label}</p>
                      <p className="mt-0.5 text-xs capitalize text-ink-faint">
                        {evt.type.replace("_", " ")}
                      </p>
                    </div>
                    <time className="shrink-0 font-mono-data text-[11px] text-ink-faint">
                      {formatDateTime(evt.observedAt)}
                    </time>
                  </li>
                ))}
              </ul>
              <Link
                href="/timeline"
                className="mt-3 inline-block text-sm text-accent hover:text-accent-hover"
              >
                View full timeline
              </Link>
            </section>

            <section>
              <h2 className="text-xs font-medium uppercase tracking-widest text-ink-faint">
                Quick actions
              </h2>
              <ul className="mt-4 divide-y divide-line border border-line bg-surface">
                {links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="block px-5 py-4 transition hover:bg-paper"
                    >
                      <p className="text-sm text-ink">{link.title}</p>
                      <p className="mt-0.5 text-xs text-ink-muted">{link.description}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <p className="mt-10 font-mono-data text-[11px] text-ink-faint">
            {indexStats.documentCount} indexed documents · {indexStats.termCount} search terms
          </p>
        </>
      )}
    </>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div className="bg-surface px-5 py-5">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-1 font-mono-data text-3xl text-ink">{value}</p>
      {hint && <p className="mt-1 text-xs text-alert-high">{hint}</p>}
    </div>
  );
}
