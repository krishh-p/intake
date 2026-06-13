"use client";

import { AskAgent } from "@/components/ask/AskAgent";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { useIntake } from "@/lib/IntakeContext";

export default function AskPage() {
  const { state } = useIntake();

  if (state.events.length === 0) {
    return (
      <>
        <PageHeader
          title="Ask"
          description="Ask an AI companion about your health. It searches your knowledge graph for answers and reasons, with citations you can click through to."
        />
        <EmptyState
          title="No data to ask about"
          description="Import health records or talk to Intake to build your knowledge graph first."
          actionLabel="Import health data"
          actionHref="/import"
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Ask"
        description="Ask about your health. The agent searches your knowledge graph — conditions, labs, medications, and their connections — and answers with clickable citations."
      />
      <AskAgent />
    </>
  );
}
