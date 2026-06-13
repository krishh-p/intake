"use client";

import Link from "next/link";
import { ClinicianImportForm } from "@/components/import/ClinicianImportForm";
import { PageHeader } from "@/components/layout/PageHeader";

export default function ImportClinicianPage() {
  return (
    <>
      <Link href="/import" className="text-sm text-accent hover:text-accent-hover">
        Back to import
      </Link>
      <PageHeader
        title="Clinician note"
        description="Enter documentation from a recent visit including follow-up tasks and lab results."
      />
      <div className="max-w-2xl">
        <ClinicianImportForm />
      </div>
    </>
  );
}
