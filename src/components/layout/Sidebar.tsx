"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { useIntake } from "@/lib/IntakeContext";
import { calculateAge, cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Overview", icon: OverviewIcon },
  { href: "/import", label: "Import", icon: ImportIcon },
  { href: "/timeline", label: "Timeline", icon: TimelineIcon },
  { href: "/graph", label: "Knowledge graph", icon: GraphIcon },
  { href: "/trends", label: "Trends", icon: TrendsIcon },
  { href: "/reports", label: "Reports", icon: ReportsIcon },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const { state, indexStats } = useIntake();

  function handleSignOut() {
    logout();
    router.replace("/login");
  }

  const age = calculateAge(state.patient.dob);

  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col border-r border-line bg-surface">
      <div className="px-5 py-6">
        <Link href="/" className="font-display text-xl tracking-tight text-ink">
          Intake
        </Link>
        <p className="mt-1 text-[11px] uppercase tracking-widest text-ink-faint">
          Health workspace
        </p>
      </div>

      <nav className="flex-1 px-2">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "mb-0.5 flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition",
                active
                  ? "nav-active-thread bg-accent-soft text-accent"
                  : "text-ink-muted hover:bg-paper hover:text-ink"
              )}
            >
              <Icon
                className={cn(
                  "h-[15px] w-[15px] shrink-0",
                  active ? "text-accent" : "text-ink-faint"
                )}
              />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-line p-4">
        <div className="px-2 py-2">
          <p className="truncate text-sm text-ink">{state.patient.name}</p>
          <p className="mt-0.5 font-mono-data text-[11px] text-ink-faint">
            Age {age} · {indexStats.eventCount} events
          </p>
          <p className="mt-1 truncate text-[11px] text-ink-faint">{user?.email}</p>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          className="mt-2 w-full rounded-md px-3 py-2 text-left text-[13px] text-ink-muted transition hover:bg-paper hover:text-ink focus-ring"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}

function OverviewIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
    </svg>
  );
}

function ImportIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12M12 16.5V3" />
    </svg>
  );
}

function TimelineIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function GraphIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
    </svg>
  );
}

function TrendsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
    </svg>
  );
}

function ReportsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}
