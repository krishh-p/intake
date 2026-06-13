"use client";

import { useState } from "react";
import { useIntake } from "@/lib/IntakeContext";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { FieldLabel, Input, Textarea } from "@/components/ui/Input";
import { ProcessingIndicator } from "@/components/ui/ProcessingIndicator";
import { EMPTY_DOCTOR_NOTE } from "@/lib/schema";

export function ClinicianImportForm() {
  const { submitDoctorNote, processing, error, clearError } = useIntake();
  const [form, setForm] = useState(EMPTY_DOCTOR_NOTE);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    clearError();
    setSuccess(false);
    const ok = await submitDoctorNote(form);
    if (!ok) return;
    setForm(EMPTY_DOCTOR_NOTE);
    setSuccess(true);
    setTimeout(() => setSuccess(false), 3000);
  }

  return (
    <form onSubmit={handleSubmit} className="panel p-8">
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}
      {success && (
        <Alert tone="success" className="mb-4">
          Clinician note added to your timeline.
        </Alert>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block text-sm">
          <FieldLabel>Clinician name</FieldLabel>
          <Input
            value={form.clinicianName}
            onChange={(e) => setForm({ ...form, clinicianName: e.target.value })}
            required
          />
        </label>
        <label className="block text-sm">
          <FieldLabel>Specialty</FieldLabel>
          <Input
            value={form.specialty}
            onChange={(e) => setForm({ ...form, specialty: e.target.value })}
            placeholder="Primary care, cardiology, etc."
          />
        </label>
      </div>

      <label className="mt-5 block text-sm">
        <FieldLabel>Clinical note</FieldLabel>
        <Textarea
          rows={5}
          value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })}
          required
          placeholder="Enter the clinician's notes from your visit..."
        />
      </label>

      <label className="mt-5 block text-sm">
        <FieldLabel>Follow-up task</FieldLabel>
        <Input
          value={form.followUp}
          onChange={(e) => setForm({ ...form, followUp: e.target.value })}
        />
      </label>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <label className="block text-sm">
          <FieldLabel>Labs (optional)</FieldLabel>
          <Input value={form.lab} onChange={(e) => setForm({ ...form, lab: e.target.value })} />
        </label>
        <label className="block text-sm">
          <FieldLabel>Medication change (optional)</FieldLabel>
          <Input
            value={form.medicationChange}
            onChange={(e) => setForm({ ...form, medicationChange: e.target.value })}
          />
        </label>
      </div>

      <Button type="submit" disabled={processing.active} className="mt-8 gap-2">
        {processing.active ? (
          <>
            <ProcessingIndicator size="xs" variant="inverse" />
            Processing...
          </>
        ) : (
          "Submit note"
        )}
      </Button>
    </form>
  );
}
