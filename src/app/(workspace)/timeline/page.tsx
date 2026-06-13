"use client";

import { PageHeader } from "@/components/layout/PageHeader";
import { Timeline } from "@/components/Timeline";

export default function TimelinePage() {
  return (
    <>
      <PageHeader
        title="Timeline"
        description="A chronological view of every health event imported into your workspace."
      />
      <Timeline variant="full" />
    </>
  );
}
