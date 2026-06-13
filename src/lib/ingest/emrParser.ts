import type { EmrPayload, HealthEvent, Source } from "@/lib/schema";
import { generateId } from "@/lib/utils";

export function parseEmrJson(
  patientId: string,
  data: EmrPayload,
  fileName?: string
): { source: Source; events: HealthEvent[] } {
  const source: Source = {
    id: generateId("src"),
    type: "emr",
    title: fileName ? `EMR import — ${fileName}` : "EMR import",
    capturedAt: new Date().toISOString(),
    rawText: JSON.stringify(data, null, 2),
  };

  const events: HealthEvent[] = [];
  const fallbackDate = new Date().toISOString();

  for (const condition of data.conditions ?? []) {
    events.push({
      id: generateId("evt"),
      patientId,
      sourceId: source.id,
      type: "condition",
      label: condition.label,
      observedAt: condition.onset ?? fallbackDate,
      status: (condition.status as "active") ?? "active",
    });
  }

  for (const med of data.medications ?? []) {
    events.push({
      id: generateId("evt"),
      patientId,
      sourceId: source.id,
      type: "medication",
      label: med.label,
      value: med.dose,
      observedAt: med.start ?? fallbackDate,
      status: (med.status as "active") ?? "active",
    });
  }

  for (const lab of data.labs ?? []) {
    events.push({
      id: generateId("evt"),
      patientId,
      sourceId: source.id,
      type: "lab",
      label: lab.label,
      value: lab.value,
      unit: lab.unit,
      observedAt: lab.date ?? fallbackDate,
    });
  }

  for (const vital of data.vitals ?? []) {
    events.push({
      id: generateId("evt"),
      patientId,
      sourceId: source.id,
      type: "vital",
      label: vital.label,
      value: vital.value,
      unit: vital.unit,
      observedAt: vital.date ?? fallbackDate,
    });
  }

  for (const encounter of data.encounters ?? []) {
    events.push({
      id: generateId("evt"),
      patientId,
      sourceId: source.id,
      type: "encounter",
      label: encounter.label,
      observedAt: encounter.date ?? fallbackDate,
      metadata: {
        clinician: encounter.clinician,
        specialty: encounter.specialty,
      },
    });
  }

  for (const task of data.careTasks ?? []) {
    events.push({
      id: generateId("evt"),
      patientId,
      sourceId: source.id,
      type: "care_task",
      label: task.label,
      observedAt: task.due ?? fallbackDate,
      status: (task.status as "unknown") ?? "unknown",
    });
  }

  return { source, events };
}

export async function parseEmrFile(
  patientId: string,
  file: File
): Promise<{ source: Source; events: HealthEvent[] }> {
  const text = await file.text();
  let data: EmrPayload;

  try {
    data = JSON.parse(text) as EmrPayload;
  } catch {
    throw new Error("Invalid JSON file. Upload a valid EMR export.");
  }

  const result = parseEmrJson(patientId, data, file.name);
  if (result.events.length === 0) {
    throw new Error(
      "No health records found. Expected keys: conditions, medications, labs, vitals, encounters, or careTasks."
    );
  }

  return result;
}
