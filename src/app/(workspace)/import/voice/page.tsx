"use client";

import Link from "next/link";
import { VoiceImportForm } from "@/components/import/VoiceImportForm";
import { PageHeader } from "@/components/layout/PageHeader";

export default function ImportVoicePage() {
  return (
    <>
      <Link href="/import" className="text-sm text-accent hover:text-accent-hover">
        Back to import
      </Link>
      <PageHeader
        title="Voice note"
        description="Describe what is happening with your health. Intake extracts structured clinical events from your note."
      />
      <div className="max-w-2xl">
        <VoiceImportForm />
      </div>
    </>
  );
}
