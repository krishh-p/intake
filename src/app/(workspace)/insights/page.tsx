"use client";

import { PageHeader } from "@/components/layout/PageHeader";
import { RiskRadar } from "@/components/RiskRadar";

export default function InsightsPage() {
  return (
    <>
      <PageHeader
        title="Insights"
        description="Source-backed risk alerts surfaced from patterns across your health data."
      />
      <RiskRadar variant="full" />
    </>
  );
}
