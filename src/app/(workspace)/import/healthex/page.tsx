"use client";

import Link from "next/link";
import { HealthexConnect } from "@/components/import/HealthexConnect";
import { PageHeader } from "@/components/layout/PageHeader";

export default function ImportHealthexPage() {
  return (
    <>
      <Link href="/import" className="text-sm text-accent hover:text-accent-hover">
        Back to import
      </Link>
      <PageHeader
        title="Connect with Healthex"
        description="Pull your EMR/EHR records directly from a connected health system — conditions, medications, labs, vitals, and visits — without exporting a file."
      />
      <div className="max-w-xl">
        <HealthexConnect />
      </div>
    </>
  );
}
