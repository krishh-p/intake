"use client";

import { PageHeader } from "@/components/layout/PageHeader";
import { ReportPanel } from "@/components/ReportPanel";

export default function ReportsPage() {
  return (
    <>
      <PageHeader
        title="Visit reports"
        description="Generate a specialty-focused brief to prepare for your next appointment."
      />
      <ReportPanel variant="full" />
    </>
  );
}
