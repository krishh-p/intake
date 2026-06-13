"use client";

import { Sidebar } from "@/components/layout/Sidebar";
import { useIntake } from "@/lib/IntakeContext";

function ProcessingBar() {
  const { processing } = useIntake();
  if (!processing.active) return null;

  return (
    <div className="flex items-center gap-2 border-b border-line bg-surface px-6 py-2 text-xs text-ink-muted">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-line border-t-accent" />
      {processing.message}
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
