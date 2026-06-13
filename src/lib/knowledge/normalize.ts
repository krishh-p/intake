import type { GraphNodeKind, HealthEventType } from "@/lib/schema";

const SYNONYMS: Array<{ pattern: RegExp; canonical: string }> = [
  { pattern: /\b(chronic kidney disease|ckd|kidney disease)\b/i, canonical: "Chronic kidney disease" },
  { pattern: /\b(nsaid|advil|motrin|ibuprofen)\b/i, canonical: "Ibuprofen / NSAID use" },
  { pattern: /\b(shortness of breath|sob|breathless)\b/i, canonical: "Shortness of breath" },
  { pattern: /\b(swelling|edema)\b/i, canonical: "Edema / swelling" },
  { pattern: /\b(a1c|hba1c)\b/i, canonical: "HbA1c" },
  { pattern: /\begfr\b/i, canonical: "eGFR" },
  { pattern: /\bpotassium\b/i, canonical: "Potassium" },
  { pattern: /\blisinopril\b/i, canonical: "Lisinopril" },
  { pattern: /\bmetformin\b/i, canonical: "Metformin" },
  { pattern: /\bdiabetes\b/i, canonical: "Diabetes" },
];

export function normalizeLabel(label: string): string {
  const trimmed = label.replace(/\s+/g, " ").trim();
  for (const synonym of SYNONYMS) {
    if (synonym.pattern.test(trimmed)) return synonym.canonical;
  }
  return trimmed
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bEgfr\b/g, "eGFR")
    .replace(/\bHba1c\b/g, "HbA1c");
}

export function canonicalKey(kind: string, label: string) {
  return `${kind}:${normalizeLabel(label).toLowerCase()}`;
}

export function eventTypeToNodeKind(type: HealthEventType): GraphNodeKind {
  switch (type) {
    case "condition":
      return "condition";
    case "symptom":
      return "symptom";
    case "medication":
      return "medication";
    case "lab":
    case "vital":
      return "lab";
    case "encounter":
      return "encounter";
    case "care_task":
      return "task";
    case "barrier":
      return "barrier";
    default:
      return "encounter";
  }
}
