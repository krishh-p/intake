"use client";

import Link from "next/link";
import { EmrImportForm } from "@/components/import/EmrImportForm";
import { PageHeader } from "@/components/layout/PageHeader";

export default function ImportRecordsPage() {
  return (
    <>
      <Link href="/import" className="text-sm text-accent hover:text-accent-hover">
        Back to import
      </Link>
      <PageHeader
        title="Medical records"
        description="Upload a JSON file exported from your EMR. Supported fields include conditions, medications, labs, vitals, encounters, and care tasks."
      />
      <div className="max-w-xl">
        <EmrImportForm />
      </div>
    </>
  );
}
