"use client";

import { useRef, useState } from "react";
import { useIntake } from "@/lib/IntakeContext";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { ProcessingIndicator } from "@/components/ui/ProcessingIndicator";
import { cn } from "@/lib/utils";

export function EmrImportForm() {
  const { importEmrFile, processing, error, clearError } = useIntake();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [success, setSuccess] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    clearError();
    await importEmrFile(file);
    setSuccess(true);
    e.target.value = "";
  }

  return (
    <div className="panel p-8">
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleFileChange}
      />

      <div
        className={cn(
          "flex flex-col items-center justify-center border border-dashed px-6 py-14 transition",
          success ? "border-success/30 bg-success-soft/30" : "border-line bg-paper hover:border-line-strong"
        )}
      >
        <p className="text-sm text-ink">
          {success ? "Records imported successfully" : "Drop a JSON file or browse"}
        </p>
        <p className="mt-1 text-xs text-ink-faint">EMR export · JSON format</p>
        {fileName && <p className="mt-2 font-mono-data text-xs text-ink-faint">{fileName}</p>}
        <Button
          onClick={() => fileInputRef.current?.click()}
          disabled={processing.active}
          className="mt-6 gap-2"
        >
          {processing.active ? (
            <>
              <ProcessingIndicator size="xs" variant="inverse" />
              Importing...
            </>
          ) : (
            "Choose file"
          )}
        </Button>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-ink-faint">
        You can upload multiple files over time. Each import is added to your timeline and
        knowledge graph.
      </p>
    </div>
  );
}
