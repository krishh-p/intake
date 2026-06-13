"use client";

import { Sidebar } from "@/components/layout/Sidebar";
import { ProcessingIndicator } from "@/components/ui/ProcessingIndicator";
import { useIntake } from "@/lib/IntakeContext";

function ProcessingBar() {
  const { processing } = useIntake();
  if (!processing.active) return null;

  return (
    <div
      className="processing-bar relative overflow-hidden border-b border-line bg-surface"
      role="status"
      aria-live="polite"
    >
      <div className="processing-bar__shimmer" aria-hidden />
      <div className="flex items-center gap-3 px-6 py-2.5">
        <ProcessingIndicator size="sm" label={processing.message} />
        <span className="text-xs text-ink-muted">{processing.message}</span>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-paper">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <ProcessingBar />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-5xl px-10 py-12">{children}</div>
        </main>
      </div>
    </div>
  );
}

export function GraphShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-paper">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <ProcessingBar />
        <main className="flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
