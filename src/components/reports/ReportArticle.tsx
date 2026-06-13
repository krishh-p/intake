import type { DoctorReport } from "@/lib/schema";
import { formatDate, sourceTypeLabel } from "@/lib/utils";

export function ReportArticle({
  report,
  footerNote = "Generated from your imported data. Not a diagnosis. Clinician review required.",
}: {
  report: DoctorReport;
  footerNote?: string;
}) {
  return (
    <article className="space-y-8">
      <header className="border-b border-line pb-6">
        <p className="text-[11px] uppercase tracking-widest text-ink-faint">Visit brief</p>
        <h2 className="mt-2 font-display text-2xl text-ink">{report.title}</h2>
        <p className="mt-2 font-mono-data text-sm text-ink-faint">
          Prepared {new Date().toLocaleDateString("en-US", { dateStyle: "long" })}
        </p>
      </header>

      {report.intakeSummary && (
        <section>
          <h3 className="text-xs font-medium uppercase tracking-widest text-ink-faint">
            Pre-visit intake
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-ink-muted">
            {report.intakeSummary}
          </p>
        </section>
      )}

      <section>
        <h3 className="text-xs font-medium uppercase tracking-widest text-ink-faint">
          Summary
        </h3>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">{report.summary}</p>
      </section>

      <section>
        <h3 className="text-xs font-medium uppercase tracking-widest text-ink-faint">
          Top concerns
        </h3>
        <ol className="mt-3 space-y-2">
          {report.topConcerns.map((c, i) => (
            <li key={c} className="flex gap-3 text-sm text-ink-muted">
              <span className="font-mono-data text-xs text-ink-faint">{i + 1}.</span>
              {c}
            </li>
          ))}
        </ol>
      </section>

      <div className="grid gap-8 sm:grid-cols-2">
        <section>
          <h3 className="text-xs font-medium uppercase tracking-widest text-ink-faint">
            Medications
          </h3>
          <ul className="mt-3 space-y-2">
            {report.medications.map((m) => (
              <li key={m.id} className="text-sm text-ink-muted">
                <span className="text-ink">{m.label}</span>
                {m.value && <span className="text-ink-faint"> — {m.value}</span>}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="text-xs font-medium uppercase tracking-widest text-ink-faint">
            Labs and vitals
          </h3>
          <ul className="mt-3 space-y-2">
            {report.labsAndVitals.slice(0, 6).map((l) => (
              <li key={l.id} className="text-sm text-ink-muted">
                {l.label}: {l.value}
                {l.unit ? ` ${l.unit}` : ""}
                <span className="font-mono-data text-ink-faint">
                  {" "}
                  ({formatDate(l.observedAt)})
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section>
        <h3 className="text-xs font-medium uppercase tracking-widest text-ink-faint">
          Questions to ask
        </h3>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5">
          {report.questions.map((q) => (
            <li key={q} className="text-sm text-ink-muted">
              {q}
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h3 className="text-xs font-medium uppercase tracking-widest text-ink-faint">
          Sources
        </h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {report.evidenceSources.map((s) => (
            <span
              key={s.id}
              className="border border-line px-3 py-1 text-xs text-ink-muted"
            >
              {s.title} · {sourceTypeLabel(s.type)}
            </span>
          ))}
        </div>
      </section>

      <footer className="border-t border-line pt-6 text-xs text-ink-faint">
        {footerNote}
      </footer>
    </article>
  );
}
