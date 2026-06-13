"use client";

import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";

const OPTIONS = [
  {
    href: "/import/records",
    title: "Medical records",
    description: "Upload a JSON export from your electronic medical record system.",
  },
  {
    href: "/import/voice",
    title: "Voice note",
    description: "Record or write symptoms, medications, and care barriers in your own words.",
  },
  {
    href: "/import/clinician",
    title: "Clinician note",
    description: "Enter notes, labs, and follow-up tasks from a recent visit.",
  },
];

export default function ImportHubPage() {
  return (
    <>
      <PageHeader
        title="Import health data"
        description="Add information from your records, your own observations, or a clinician visit."
      />
      <div className="divide-y divide-line border border-line bg-surface">
        {OPTIONS.map((opt) => (
          <Link
            key={opt.href}
            href={opt.href}
            className="group block px-6 py-5 transition hover:bg-paper"
          >
            <h2 className="text-sm text-ink">{opt.title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-ink-muted">{opt.description}</p>
            <span className="mt-3 inline-block text-sm text-accent group-hover:text-accent-hover">
              Continue
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
