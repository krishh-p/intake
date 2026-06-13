import type { GraphNodeKind, HealthEventType } from "@/lib/schema";
import { groundConcept, titleCase } from "@/lib/knowledge/ontology";

/**
 * Canonicalize a free-text label to a stable display form. Delegates to the
 * clinical ontology (lexicon + alias matching) and falls back to title-casing
 * with terminology-aware fixups for unknown terms.
 */
export function normalizeLabel(label: string, kind?: HealthEventType): string {
  const trimmed = label.replace(/\s+/g, " ").trim();
  if (!trimmed) return trimmed;
  const grounded = groundConcept(trimmed, kind);
  if (grounded.known) return grounded.canonical;
  return titleCase(trimmed)
    .replace(/\bEgfr\b/g, "eGFR")
    .replace(/\bHba1c\b/g, "HbA1c")
    .replace(/\bLdl\b/g, "LDL")
    .replace(/\bTsh\b/g, "TSH")
    .replace(/\bInr\b/g, "INR")
    .replace(/\bCkd\b/g, "CKD")
    .replace(/\bCopd\b/g, "COPD");
}

export function canonicalKey(kind: string, label: string): string {
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
