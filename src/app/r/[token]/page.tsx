"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ReportArticle } from "@/components/reports/ReportArticle";
import { ProcessingIndicator } from "@/components/ui/ProcessingIndicator";
import { getSharedReport } from "@/lib/supabase/sharedReports";
import type { SharedReport } from "@/lib/schema";

export default function SharedReportPage() {
  const params = useParams();
  const token = typeof params.token === "string" ? params.token : "";
  const [shared, setShared] = useState<SharedReport | null>(null);
  const [loading, setLoading] = useState(token !== "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;

    let active = true;
    getSharedReport(token)
      .then((result) => {
        if (!active) return;
        if (!result) {
          setError("Report not found or link has expired.");
          return;
        }
        setShared(result);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Could not load report");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [token]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <ProcessingIndicator size="md" label="Loading report" />
      </div>
    );
  }

  const effectiveError = error ?? (!token ? "Invalid link" : null);
  if (effectiveError || !shared) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper px-6">
        <div className="max-w-md text-center">
          <h1 className="font-display text-xl text-ink">Report unavailable</h1>
          <p className="mt-2 text-sm text-ink-muted">{effectiveError ?? "Not found"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper">
      <div className="border-b border-line bg-surface px-6 py-4">
        <p className="text-xs font-medium uppercase tracking-widest text-ink-faint">
          Intake · shared visit brief
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          Shared by {shared.patientName} · not a diagnosis
        </p>
      </div>
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="panel p-8 sm:p-10">
          <ReportArticle
            report={shared.report}
            footerNote="Patient-shared summary via Intake. Not a diagnosis. Clinician review required."
          />
        </div>
      </main>
    </div>
  );
}
