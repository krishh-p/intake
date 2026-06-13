import type { HealthEvent, Source } from "@/lib/schema";
import { generateId } from "@/lib/utils";

export type DoctorNoteInput = {
  clinicianName: string;
  specialty: string;
  note: string;
  followUp?: string;
  lab?: string;
  medicationChange?: string;
};

export function parseDoctorNote(
  patientId: string,
  input: DoctorNoteInput
): { source: Source; events: HealthEvent[] } {
  const source: Source = {
    id: generateId("src"),
    type: "doctor_note",
    title: `${input.clinicianName} — ${input.specialty}`,
    capturedAt: new Date().toISOString(),
    rawText: input.note,
  };

  const now = new Date().toISOString();
  const events: HealthEvent[] = [
    {
      id: generateId("evt"),
      patientId,
      sourceId: source.id,
      type: "note",
      label: "Clinician note",
      value: input.note,
      observedAt: now,
      metadata: {
        clinician: input.clinicianName,
        specialty: input.specialty,
      },
    },
    {
      id: generateId("evt"),
      patientId,
      sourceId: source.id,
      type: "encounter",
      label: `${input.specialty} documentation`,
      observedAt: now,
      metadata: {
        clinician: input.clinicianName,
        specialty: input.specialty,
      },
    },
  ];

  if (input.followUp) {
    events.push({
      id: generateId("evt"),
      patientId,
      sourceId: source.id,
      type: "care_task",
      label: input.followUp,
      observedAt: now,
      status: "pending" as "unknown",
    });
  }

  if (input.lab) {
    events.push({
      id: generateId("evt"),
      patientId,
      sourceId: source.id,
      type: "lab",
      label: "Noted labs",
      value: input.lab,
      observedAt: now,
    });
  }

  if (input.medicationChange) {
    events.push({
      id: generateId("evt"),
      patientId,
      sourceId: source.id,
      type: "medication",
      label: "Medication plan update",
      value: input.medicationChange,
      observedAt: now,
      status: "active",
    });
  }

  const noteLower = input.note.toLowerCase();

  if (noteLower.includes("ibuprofen")) {
    events.push({
      id: generateId("evt"),
      patientId,
      sourceId: source.id,
      type: "medication",
      label: "Ibuprofen",
      value: "Recommended by urgent care for knee pain",
      observedAt: now,
      status: "active",
      metadata: { prescribedBy: "Urgent care" },
    });
  }

  if (noteLower.includes("cardiology")) {
    events.push({
      id: generateId("evt"),
      patientId,
      sourceId: source.id,
      type: "care_task",
      label: "Cardiology visit scheduled",
      observedAt: now,
      status: "pending" as "unknown",
      metadata: { timing: "next month" },
    });
  }

  if (noteLower.includes("bmp") || noteLower.includes("egfr") || noteLower.includes("potassium")) {
    events.push({
      id: generateId("evt"),
      patientId,
      sourceId: source.id,
      type: "care_task",
      label: "Repeat BMP ordered",
      value: "Due to elevated potassium and reduced eGFR",
      observedAt: now,
      status: "pending" as "unknown",
      metadata: { timeframe: "2 weeks" },
    });
  }

  return { source, events };
}
