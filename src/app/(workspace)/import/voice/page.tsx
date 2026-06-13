"use client";

import Link from "next/link";
import { IntakeConversation } from "@/components/import/IntakeConversation";
import { PageHeader } from "@/components/layout/PageHeader";

export default function ImportVoicePage() {
  return (
    <>
      <Link href="/import" className="text-sm text-accent hover:text-accent-hover">
        Back to import
      </Link>
      <PageHeader
        title="Talk to Intake"
        description="Start a live voice session with Intake. End the session when you're done — it saves automatically to your timeline and knowledge graph."
      />
      <div className="max-w-2xl">
        <IntakeConversation />
      </div>
    </>
  );
}
