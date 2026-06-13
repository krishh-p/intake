"use client";

import { PageHeader } from "@/components/layout/PageHeader";
import { TrendAnalysis } from "@/components/trends/TrendAnalysis";
import { EmptyState } from "@/components/ui/EmptyState";
import { useIntake } from "@/lib/IntakeContext";

export default function TrendsPage() {
  const { state } = useIntake();

  if (state.events.length === 0) {
    return (
      <>
        <PageHeader
          title="Trends"
          description="An AI agent analyzes your health data to surface trends and actionable next steps, cited from your records."
        />
        <EmptyState
          title="No data to analyze"
          description="Import health records or talk to Intake to build your timeline first."
          actionLabel="Import health data"
          actionHref="/import"
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Trends"
        description="Trend Scout investigates your labs, vitals, and symptoms — streaming each step — then surfaces trends tied to actions you can take."
      />
      <TrendAnalysis />
    </>
  );
}
