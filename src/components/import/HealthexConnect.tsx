"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { ProcessingIndicator } from "@/components/ui/ProcessingIndicator";
import { useIntake } from "@/lib/IntakeContext";
import { HEALTHEX_PROVIDERS, type HealthexProvider } from "@/lib/ingest/mockHealthex";
import { cn } from "@/lib/utils";

type Phase = "browse" | "authorizing" | "syncing" | "done";

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function HealthexConnect() {
  const { importEmrPayload, error, clearError } = useIntake();
  const [phase, setPhase] = useState<Phase>("browse");
  const [active, setActive] = useState<HealthexProvider | null>(null);
  const [connectedIds, setConnectedIds] = useState<string[]>([]);
  const [lastCount, setLastCount] = useState(0);
  const [statusLine, setStatusLine] = useState("");

  async function connect(provider: HealthexProvider) {
    clearError();
    setActive(provider);
    setPhase("authorizing");
    setStatusLine(`Redirecting to ${provider.network}…`);
    await delay(900);
    setStatusLine(`Authorizing access with ${provider.name}…`);
    await delay(1100);

    setPhase("syncing");
    setStatusLine("Locating patient record…");
    await delay(800);
    setStatusLine("Pulling conditions, medications, labs, and vitals…");
    await delay(1000);

    const count = await importEmrPayload(
      provider.buildPayload(),
      `Healthex · ${provider.name}`,
    );

    setLastCount(count);
    setConnectedIds((prev) =>
      prev.includes(provider.id) ? prev : [...prev, provider.id],
    );
    setPhase("done");
  }

  function reset() {
    setActive(null);
    setPhase("browse");
    setStatusLine("");
    clearError();
  }

  const busy = phase === "authorizing" || phase === "syncing";

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center gap-3 border-b border-line bg-paper px-6 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent text-sm font-semibold text-white">
          hx
        </div>
        <div>
          <p className="text-sm font-medium text-ink">Healthex</p>
          <p className="text-xs text-ink-faint">
            Connected health records network · demo
          </p>
        </div>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          Sandbox
        </span>
      </div>

      <div className="px-6 py-6">
        {error && (
          <Alert tone="error" className="mb-4">
            {error}
          </Alert>
        )}

        {busy && active && (
          <div className="flex flex-col items-center justify-center gap-4 py-10 text-center">
            <ProcessingIndicator size="md" />
            <div>
              <p className="text-sm text-ink">
                {phase === "authorizing" ? "Connecting" : "Syncing"} ·{" "}
                {active.name}
              </p>
              <p className="mt-1 text-xs text-ink-faint">{statusLine}</p>
            </div>
          </div>
        )}

        {phase === "done" && active && (
          <div className="flex flex-col items-center justify-center gap-4 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success-soft text-lg text-success">
              ✓
            </div>
            <div>
              <p className="text-sm text-ink">
                Synced {lastCount} record{lastCount === 1 ? "" : "s"} from{" "}
                {active.name}
              </p>
              <p className="mt-1 text-xs text-ink-faint">
                Added to your timeline, knowledge graph, and trends.
              </p>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              <Button onClick={reset} variant="secondary">
                Connect another provider
              </Button>
            </div>
          </div>
        )}

        {phase === "browse" && (
          <>
            <p className="mb-4 text-sm text-ink-muted">
              Choose your health system to securely import your records. This is
              a sandbox connection that returns realistic sample data.
            </p>
            <ul className="divide-y divide-line border border-line">
              {HEALTHEX_PROVIDERS.map((provider) => {
                const connected = connectedIds.includes(provider.id);
                return (
                  <li
                    key={provider.id}
                    className="flex items-center gap-4 px-4 py-3.5"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-md border border-line bg-paper text-xs font-semibold text-ink-muted">
                      {initials(provider.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink">
                        {provider.name}
                      </p>
                      <p className="truncate text-xs text-ink-faint">
                        {provider.network} · {provider.location}
                      </p>
                    </div>
                    <Button
                      variant={connected ? "secondary" : "primary"}
                      onClick={() => void connect(provider)}
                      className={cn(connected && "text-ink-muted")}
                    >
                      {connected ? "Re-sync" : "Connect"}
                    </Button>
                  </li>
                );
              })}
            </ul>
            <p className="mt-4 text-xs leading-relaxed text-ink-faint">
              Healthex never stores your provider credentials. You can disconnect
              a source at any time.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
