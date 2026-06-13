"use client";

import { AuthGuard } from "@/components/AuthGuard";
import { AppShell, GraphShell } from "@/components/layout/AppShell";
import { IntakeProvider } from "@/lib/IntakeContext";
import { usePathname } from "next/navigation";

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/graph") {
    return <GraphShell>{children}</GraphShell>;
  }
  return <AppShell>{children}</AppShell>;
}

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <IntakeProvider>
        <Shell>{children}</Shell>
      </IntakeProvider>
    </AuthGuard>
  );
}
