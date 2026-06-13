/**
 * Clinical ontology / knowledge base.
 *
 * This module is the grounding backbone for the knowledge graph. Following the
 * approach used by clinical KGs (UMLS as a cross-reference backbone with
 * SNOMED CT for problems, RxNorm for drugs, LOINC for labs), every concept here
 * carries a canonical label, aliases, an optional coding slot for future
 * grounding, and the semantic attributes the reasoning layers need
 * (drug classes, lab reference ranges + directionality, specialty routing).
 *
 * The data here is intentionally general — it is NOT tied to any single patient.
 * Unknown terms fall through to a generic normalized concept so the pipeline
 * never depends on a term being present in the lexicon.
 */

import type { Coding, GraphNodeKind, HealthEventType, LabFlag } from "@/lib/schema";

export type { Coding, CodingSystem } from "@/lib/schema";

/** Pharmacologic / mechanistic drug classes used for interaction reasoning. */
export type DrugClass =
  | "nsaid"
  | "ace_inhibitor"
  | "arb"
  | "beta_blocker"
  | "calcium_channel_blocker"
  | "loop_diuretic"
  | "thiazide_diuretic"
  | "potassium_sparing_diuretic"
  | "biguanide"
  | "sulfonylurea"
  | "sglt2_inhibitor"
  | "dpp4_inhibitor"
  | "glp1_agonist"
  | "insulin"
  | "statin"
  | "anticoagulant"
  | "antiplatelet"
  | "ppi"
  | "opioid"
  | "benzodiazepine"
  | "corticosteroid"
  | "ssri"
  | "snri"
  | "thyroid_hormone"
  | "potassium_supplement"
  | "bronchodilator"
  | "inhaled_corticosteroid";

export type Specialty =
  | "primary_care"
  | "cardiology"
  | "nephrology"
  | "endocrinology"
  | "pharmacy"
  | "pulmonology"
  | "psychiatry"
  | "gastroenterology"
  | "neurology"
  | "rheumatology";

export type LabDirection = "higher_worse" | "lower_worse" | "two_sided";

export type ConceptKind = "condition" | "medication" | "lab" | "symptom";

type BaseConcept = {
  canonical: string;
  aliases: string[];
  coding?: Coding;
  specialties?: Specialty[];
};

export type ConditionConcept = BaseConcept & {
  /** Broad disease category for category-level rules (e.g. "renal", "cardiac"). */
  category?: string;
};

export type MedicationConcept = BaseConcept & {
  classes: DrugClass[];
  /** Labs that should be monitored while on this medication. */
  monitorLabs?: string[];
};

export type LabConcept = BaseConcept & {
  unit?: string;
  /** Normal reference interval; either bound may be omitted. */
  low?: number;
  high?: number;
  /** Which direction of abnormality is clinically concerning. */
  direction: LabDirection;
};

export type SymptomConcept = BaseConcept & {
  /** Organ-system grouping used for symptom-cluster reasoning. */
  systemGroup?: string;
};

export type GroundedConcept = {
  kind: ConceptKind;
  canonical: string;
  aliases: string[];
  coding?: Coding;
  specialties: Specialty[];
  classes?: DrugClass[];
  category?: string;
  systemGroup?: string;
  unit?: string;
  low?: number;
  high?: number;
  direction?: LabDirection;
  monitorLabs?: string[];
  /** True when the term matched a lexicon entry rather than a generic fallback. */
  known: boolean;
};

// ---------------------------------------------------------------------------
// Lexicon
// ---------------------------------------------------------------------------

const CONDITIONS: ConditionConcept[] = [
  {
    canonical: "Chronic kidney disease",
    aliases: ["ckd", "kidney disease", "chronic renal disease", "renal insufficiency", "chronic renal failure"],
    coding: { system: "SNOMED", code: "709044004", display: "Chronic kidney disease" },
    category: "renal",
    specialties: ["nephrology", "primary_care"],
  },
  {
    canonical: "Acute kidney injury",
    aliases: ["aki", "acute renal failure", "acute kidney failure"],
    category: "renal",
    specialties: ["nephrology"],
  },
  {
    canonical: "Type 2 diabetes",
    aliases: ["diabetes", "diabetes mellitus", "t2dm", "type 2 dm", "dm2", "type ii diabetes"],
    coding: { system: "SNOMED", code: "44054006", display: "Type 2 diabetes mellitus" },
    category: "metabolic",
    specialties: ["endocrinology", "primary_care"],
  },
  {
    canonical: "Type 1 diabetes",
    aliases: ["t1dm", "type 1 dm", "dm1"],
    category: "metabolic",
    specialties: ["endocrinology"],
  },
  {
    canonical: "Hypertension",
    aliases: ["htn", "high blood pressure", "elevated blood pressure"],
    coding: { system: "SNOMED", code: "38341003", display: "Hypertensive disorder" },
    category: "cardiac",
    specialties: ["cardiology", "primary_care"],
  },
  {
    canonical: "Heart failure",
    aliases: ["chf", "congestive heart failure", "hfref", "hfpef", "cardiac failure"],
    category: "cardiac",
    specialties: ["cardiology"],
  },
  {
    canonical: "Coronary artery disease",
    aliases: ["cad", "ischemic heart disease", "coronary heart disease"],
    category: "cardiac",
    specialties: ["cardiology"],
  },
  {
    canonical: "Atrial fibrillation",
    aliases: ["afib", "a-fib", "atrial fib"],
    category: "cardiac",
    specialties: ["cardiology"],
  },
  {
    canonical: "Hyperlipidemia",
    aliases: ["high cholesterol", "dyslipidemia", "hypercholesterolemia"],
    category: "metabolic",
    specialties: ["cardiology", "primary_care"],
  },
  {
    canonical: "Asthma",
    aliases: ["reactive airway disease"],
    category: "respiratory",
    specialties: ["pulmonology", "primary_care"],
  },
  {
    canonical: "COPD",
    aliases: ["chronic obstructive pulmonary disease", "emphysema", "chronic bronchitis"],
    category: "respiratory",
    specialties: ["pulmonology"],
  },
  {
    canonical: "Hypothyroidism",
    aliases: ["underactive thyroid", "low thyroid"],
    category: "endocrine",
    specialties: ["endocrinology", "primary_care"],
  },
  {
    canonical: "Hyperkalemia",
    aliases: ["high potassium", "elevated potassium"],
    category: "electrolyte",
    specialties: ["nephrology", "primary_care"],
  },
  {
    canonical: "Anemia",
    aliases: ["low hemoglobin", "low blood count"],
    category: "hematologic",
    specialties: ["primary_care"],
  },
  {
    canonical: "Depression",
    aliases: ["major depressive disorder", "mdd"],
    category: "psychiatric",
    specialties: ["psychiatry", "primary_care"],
  },
  {
    canonical: "Anxiety",
    aliases: ["generalized anxiety disorder", "gad"],
    category: "psychiatric",
    specialties: ["psychiatry", "primary_care"],
  },
  {
    canonical: "Osteoarthritis",
    aliases: ["oa", "degenerative joint disease", "djd"],
    category: "musculoskeletal",
    specialties: ["rheumatology", "primary_care"],
  },
  {
    canonical: "Gout",
    aliases: ["gouty arthritis"],
    category: "musculoskeletal",
    specialties: ["rheumatology", "primary_care"],
  },
  {
    canonical: "GERD",
    aliases: ["gastroesophageal reflux disease", "acid reflux", "reflux"],
    category: "gastrointestinal",
    specialties: ["gastroenterology", "primary_care"],
  },
];

const MEDICATIONS: MedicationConcept[] = [
  {
    canonical: "Ibuprofen",
    aliases: ["advil", "motrin", "nsaid", "nsaids", "naproxen", "aleve", "diclofenac", "celecoxib", "meloxicam", "indomethacin"],
    classes: ["nsaid"],
    coding: { system: "RxNorm", code: "5640", display: "Ibuprofen" },
  },
  {
    canonical: "Lisinopril",
    aliases: ["zestril", "prinivil", "enalapril", "ramipril", "benazepril", "captopril"],
    classes: ["ace_inhibitor"],
    coding: { system: "RxNorm", code: "29046", display: "Lisinopril" },
    monitorLabs: ["Potassium", "Creatinine", "eGFR"],
  },
  {
    canonical: "Losartan",
    aliases: ["cozaar", "valsartan", "olmesartan", "irbesartan", "candesartan", "telmisartan"],
    classes: ["arb"],
    monitorLabs: ["Potassium", "Creatinine", "eGFR"],
  },
  {
    canonical: "Metoprolol",
    aliases: ["lopressor", "toprol", "atenolol", "carvedilol", "bisoprolol", "propranolol"],
    classes: ["beta_blocker"],
  },
  {
    canonical: "Amlodipine",
    aliases: ["norvasc", "diltiazem", "verapamil", "nifedipine"],
    classes: ["calcium_channel_blocker"],
  },
  {
    canonical: "Furosemide",
    aliases: ["lasix", "bumetanide", "torsemide"],
    classes: ["loop_diuretic"],
    monitorLabs: ["Potassium", "Creatinine"],
  },
  {
    canonical: "Hydrochlorothiazide",
    aliases: ["hctz", "chlorthalidone"],
    classes: ["thiazide_diuretic"],
    monitorLabs: ["Potassium", "Sodium"],
  },
  {
    canonical: "Spironolactone",
    aliases: ["aldactone", "eplerenone", "amiloride", "triamterene"],
    classes: ["potassium_sparing_diuretic"],
    monitorLabs: ["Potassium"],
  },
  {
    canonical: "Metformin",
    aliases: ["glucophage", "fortamet"],
    classes: ["biguanide"],
    coding: { system: "RxNorm", code: "6809", display: "Metformin" },
    monitorLabs: ["eGFR", "HbA1c", "Creatinine"],
  },
  {
    canonical: "Glipizide",
    aliases: ["glucotrol", "glyburide", "glimepiride"],
    classes: ["sulfonylurea"],
  },
  {
    canonical: "Empagliflozin",
    aliases: ["jardiance", "dapagliflozin", "farxiga", "canagliflozin", "invokana"],
    classes: ["sglt2_inhibitor"],
    monitorLabs: ["eGFR"],
  },
  {
    canonical: "Sitagliptin",
    aliases: ["januvia", "linagliptin", "saxagliptin"],
    classes: ["dpp4_inhibitor"],
  },
  {
    canonical: "Semaglutide",
    aliases: ["ozempic", "wegovy", "dulaglutide", "trulicity", "liraglutide"],
    classes: ["glp1_agonist"],
  },
  {
    canonical: "Insulin",
    aliases: ["lantus", "humalog", "novolog", "glargine", "lispro", "insulin glargine"],
    classes: ["insulin"],
    monitorLabs: ["HbA1c"],
  },
  {
    canonical: "Atorvastatin",
    aliases: ["lipitor", "simvastatin", "rosuvastatin", "crestor", "pravastatin"],
    classes: ["statin"],
    monitorLabs: ["LDL"],
  },
  {
    canonical: "Warfarin",
    aliases: ["coumadin", "apixaban", "eliquis", "rivaroxaban", "xarelto", "dabigatran"],
    classes: ["anticoagulant"],
    monitorLabs: ["INR"],
  },
  {
    canonical: "Aspirin",
    aliases: ["asa", "clopidogrel", "plavix"],
    classes: ["antiplatelet"],
  },
  {
    canonical: "Omeprazole",
    aliases: ["prilosec", "pantoprazole", "protonix", "esomeprazole", "nexium"],
    classes: ["ppi"],
  },
  {
    canonical: "Prednisone",
    aliases: ["prednisolone", "methylprednisolone", "dexamethasone"],
    classes: ["corticosteroid"],
    monitorLabs: ["Glucose"],
  },
  {
    canonical: "Levothyroxine",
    aliases: ["synthroid", "levoxyl"],
    classes: ["thyroid_hormone"],
    monitorLabs: ["TSH"],
  },
  {
    canonical: "Sertraline",
    aliases: ["zoloft", "fluoxetine", "prozac", "citalopram", "escitalopram", "lexapro"],
    classes: ["ssri"],
  },
  {
    canonical: "Albuterol",
    aliases: ["ventolin", "proair", "salbutamol"],
    classes: ["bronchodilator"],
  },
];

const LABS: LabConcept[] = [
  {
    canonical: "eGFR",
    aliases: ["egfr", "estimated gfr", "glomerular filtration rate", "gfr"],
    coding: { system: "LOINC", code: "33914-3", display: "Estimated glomerular filtration rate" },
    unit: "mL/min/1.73m2",
    low: 60,
    direction: "lower_worse",
    specialties: ["nephrology"],
  },
  {
    canonical: "Creatinine",
    aliases: ["creat", "serum creatinine", "scr"],
    unit: "mg/dL",
    low: 0.6,
    high: 1.3,
    direction: "higher_worse",
    specialties: ["nephrology"],
  },
  {
    canonical: "Potassium",
    aliases: ["k", "k+", "serum potassium"],
    coding: { system: "LOINC", code: "2823-3", display: "Potassium [Moles/volume] in Serum or Plasma" },
    unit: "mmol/L",
    low: 3.5,
    high: 5.0,
    direction: "two_sided",
    specialties: ["nephrology", "cardiology"],
  },
  {
    canonical: "Sodium",
    aliases: ["na", "na+", "serum sodium"],
    unit: "mmol/L",
    low: 135,
    high: 145,
    direction: "two_sided",
  },
  {
    canonical: "HbA1c",
    aliases: ["a1c", "hemoglobin a1c", "glycated hemoglobin", "hgba1c"],
    coding: { system: "LOINC", code: "4548-4", display: "Hemoglobin A1c/Hemoglobin.total in Blood" },
    unit: "%",
    high: 5.7,
    direction: "higher_worse",
    specialties: ["endocrinology"],
  },
  {
    canonical: "Glucose",
    aliases: ["blood glucose", "fasting glucose", "fbg", "blood sugar"],
    unit: "mg/dL",
    low: 70,
    high: 99,
    direction: "two_sided",
    specialties: ["endocrinology"],
  },
  {
    canonical: "LDL",
    aliases: ["ldl cholesterol", "low density lipoprotein", "ldl-c"],
    unit: "mg/dL",
    high: 100,
    direction: "higher_worse",
    specialties: ["cardiology"],
  },
  {
    canonical: "Hemoglobin",
    aliases: ["hgb", "hb"],
    unit: "g/dL",
    low: 12,
    high: 17,
    direction: "lower_worse",
  },
  {
    canonical: "TSH",
    aliases: ["thyroid stimulating hormone", "thyrotropin"],
    unit: "mIU/L",
    low: 0.4,
    high: 4.0,
    direction: "two_sided",
    specialties: ["endocrinology"],
  },
  {
    canonical: "INR",
    aliases: ["international normalized ratio", "prothrombin"],
    unit: "",
    low: 0.8,
    high: 1.2,
    direction: "two_sided",
  },
  {
    canonical: "Blood pressure",
    aliases: ["bp", "systolic", "diastolic"],
    unit: "mmHg",
    direction: "higher_worse",
    specialties: ["cardiology", "primary_care"],
  },
];

const SYMPTOMS: SymptomConcept[] = [
  { canonical: "Shortness of breath", aliases: ["sob", "dyspnea", "breathless", "can't catch my breath", "trouble breathing", "winded"], systemGroup: "cardiopulmonary" },
  { canonical: "Edema", aliases: ["swelling", "ankle swelling", "leg swelling", "fluid retention", "puffy"], systemGroup: "cardiopulmonary" },
  { canonical: "Chest pain", aliases: ["chest pressure", "chest tightness", "angina"], systemGroup: "cardiopulmonary" },
  { canonical: "Palpitations", aliases: ["racing heart", "heart pounding", "fluttering"], systemGroup: "cardiopulmonary" },
  { canonical: "Fatigue", aliases: ["tired", "exhaustion", "low energy", "worn out"], systemGroup: "constitutional" },
  { canonical: "Dizziness", aliases: ["lightheaded", "vertigo", "dizzy"], systemGroup: "neurologic" },
  { canonical: "Headache", aliases: ["head pain", "migraine"], systemGroup: "neurologic" },
  { canonical: "Nausea", aliases: ["queasy", "sick to stomach"], systemGroup: "gastrointestinal" },
  { canonical: "Knee pain", aliases: ["joint pain", "arthralgia", "leg pain"], systemGroup: "musculoskeletal" },
  { canonical: "Cough", aliases: ["coughing"], systemGroup: "cardiopulmonary" },
  { canonical: "Polyuria", aliases: ["frequent urination", "urinating often"], systemGroup: "genitourinary" },
  { canonical: "Weight gain", aliases: ["gained weight"], systemGroup: "constitutional" },
];

// ---------------------------------------------------------------------------
// Lookup index
// ---------------------------------------------------------------------------

type Indexed = {
  byKind: Record<ConceptKind, BaseConcept[]>;
  aliasMap: Map<string, { kind: ConceptKind; concept: BaseConcept }>;
};

function buildIndex(): Indexed {
  const byKind: Record<ConceptKind, BaseConcept[]> = {
    condition: CONDITIONS,
    medication: MEDICATIONS,
    lab: LABS,
    symptom: SYMPTOMS,
  };
  const aliasMap = new Map<string, { kind: ConceptKind; concept: BaseConcept }>();
  for (const kind of Object.keys(byKind) as ConceptKind[]) {
    for (const concept of byKind[kind]) {
      const keys = [concept.canonical, ...concept.aliases];
      for (const key of keys) {
        const norm = key.trim().toLowerCase();
        if (!aliasMap.has(norm)) aliasMap.set(norm, { kind, concept });
      }
    }
  }
  return { byKind, aliasMap };
}

const INDEX = buildIndex();

function eventKindToConceptKind(kind: HealthEventType): ConceptKind | null {
  switch (kind) {
    case "condition":
      return "condition";
    case "medication":
      return "medication";
    case "lab":
    case "vital":
      return "lab";
    case "symptom":
      return "symptom";
    default:
      return null;
  }
}

function toGrounded(kind: ConceptKind, concept: BaseConcept, known: boolean): GroundedConcept {
  return {
    kind,
    canonical: concept.canonical,
    aliases: concept.aliases,
    coding: concept.coding,
    specialties: concept.specialties ?? [],
    classes: (concept as MedicationConcept).classes,
    category: (concept as ConditionConcept).category,
    systemGroup: (concept as SymptomConcept).systemGroup,
    unit: (concept as LabConcept).unit,
    low: (concept as LabConcept).low,
    high: (concept as LabConcept).high,
    direction: (concept as LabConcept).direction,
    monitorLabs: (concept as MedicationConcept).monitorLabs,
    known,
  };
}

/**
 * Ground a free-text label to a clinical concept. Falls back to a generic
 * concept (known=false) so callers never have to special-case misses.
 */
export function groundConcept(label: string, eventKind?: HealthEventType): GroundedConcept {
  const text = label.trim().toLowerCase();
  if (!text) {
    return { kind: "condition", canonical: label.trim(), aliases: [], specialties: [], known: false };
  }

  const targetKind = eventKind ? eventKindToConceptKind(eventKind) : null;

  // 1. Exact alias hit (optionally constrained to the expected concept kind).
  const exact = INDEX.aliasMap.get(text);
  if (exact && (!targetKind || exact.kind === targetKind)) {
    return toGrounded(exact.kind, exact.concept, true);
  }

  // 2. Word-boundary containment against aliases (handles "history of CKD" etc.).
  const searchKinds: ConceptKind[] = targetKind
    ? [targetKind]
    : ["condition", "medication", "lab", "symptom"];
  for (const kind of searchKinds) {
    for (const concept of INDEX.byKind[kind]) {
      const keys = [concept.canonical, ...concept.aliases];
      for (const key of keys) {
        const k = key.toLowerCase();
        if (k.length < 3) continue;
        if (containsWord(text, k)) {
          return toGrounded(kind, concept, true);
        }
      }
    }
  }

  // 3. Generic fallback — title-cased label under the requested kind.
  return {
    kind: targetKind ?? "condition",
    canonical: titleCase(label),
    aliases: [],
    specialties: [],
    known: false,
  };
}

function containsWord(haystack: string, needle: string): boolean {
  const idx = haystack.indexOf(needle);
  if (idx === -1) return false;
  const before = idx === 0 ? " " : haystack[idx - 1];
  const after = idx + needle.length >= haystack.length ? " " : haystack[idx + needle.length];
  const boundary = /[^a-z0-9]/i;
  return boundary.test(before) && boundary.test(after);
}

export function titleCase(label: string): string {
  return label
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Lab interpretation
// ---------------------------------------------------------------------------

export type { LabFlag } from "@/lib/schema";

export function interpretLabValue(
  concept: GroundedConcept,
  value: number | string | undefined
): LabFlag {
  if (concept.kind !== "lab") return "unknown";
  const numeric = parseNumeric(value);
  if (numeric === null) return "unknown";
  if (concept.high !== undefined && numeric > concept.high) return "high";
  if (concept.low !== undefined && numeric < concept.low) return "low";
  if (concept.high === undefined && concept.low === undefined) return "unknown";
  return "normal";
}

/** Whether an out-of-range value is in the clinically concerning direction. */
export function isAbnormalConcerning(concept: GroundedConcept, flag: LabFlag): boolean {
  if (flag === "normal" || flag === "unknown") return false;
  if (concept.direction === "two_sided") return true;
  if (concept.direction === "higher_worse") return flag === "high";
  if (concept.direction === "lower_worse") return flag === "low";
  return false;
}

export function parseNumeric(value: number | string | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const match = value.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

/** Parse a "120/80" style blood-pressure string into systolic/diastolic. */
export function parseBloodPressure(value: number | string | undefined): { systolic: number; diastolic: number } | null {
  if (typeof value !== "string") return null;
  const match = value.match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
  if (!match) return null;
  return { systolic: Number(match[1]), diastolic: Number(match[2]) };
}

// ---------------------------------------------------------------------------
// Clinical relationship rules (general, ontology-driven)
// ---------------------------------------------------------------------------

export type Severity = "high" | "medium" | "low";

/** A drug-class ↔ condition contraindication / caution. */
export type ContraindicationRule = {
  id: string;
  drugClass: DrugClass;
  /** Matches either a condition's canonical label or its category. */
  condition: { canonical?: string; category?: string };
  severity: Severity;
  rationale: string;
  specialties: Specialty[];
  questions: string[];
};

export const CONTRAINDICATION_RULES: ContraindicationRule[] = [
  {
    id: "nsaid_ckd",
    drugClass: "nsaid",
    condition: { category: "renal" },
    severity: "high",
    rationale:
      "NSAIDs reduce renal blood flow and can accelerate kidney injury and raise potassium in chronic kidney disease, especially alongside ACE inhibitors or ARBs.",
    specialties: ["nephrology", "pharmacy", "primary_care"],
    questions: [
      "Should I stop NSAIDs and use a kidney-safe pain option instead?",
      "How often should my kidney function and potassium be rechecked?",
    ],
  },
  {
    id: "nsaid_hf",
    drugClass: "nsaid",
    condition: { canonical: "Heart failure" },
    severity: "high",
    rationale:
      "NSAIDs cause sodium and fluid retention that can worsen heart failure and blunt diuretic effectiveness.",
    specialties: ["cardiology", "pharmacy"],
    questions: ["Is there a safer pain reliever given my heart failure?"],
  },
  {
    id: "nsaid_htn",
    drugClass: "nsaid",
    condition: { canonical: "Hypertension" },
    severity: "medium",
    rationale: "NSAIDs can raise blood pressure and reduce the effect of several antihypertensives.",
    specialties: ["primary_care", "cardiology", "pharmacy"],
    questions: ["Could NSAIDs be keeping my blood pressure high?"],
  },
  {
    id: "metformin_ckd",
    drugClass: "biguanide",
    condition: { category: "renal" },
    severity: "medium",
    rationale:
      "Metformin requires dose adjustment or discontinuation as kidney function declines because of lactic acidosis risk; confirm current eGFR.",
    specialties: ["endocrinology", "nephrology", "pharmacy"],
    questions: ["Is metformin still safe at my current kidney function?"],
  },
  {
    id: "ace_hyperkalemia",
    drugClass: "ace_inhibitor",
    condition: { canonical: "Hyperkalemia" },
    severity: "high",
    rationale: "ACE inhibitors raise serum potassium and can be dangerous when potassium is already elevated.",
    specialties: ["nephrology", "cardiology", "pharmacy"],
    questions: ["Should my ACE inhibitor dose change given my potassium?"],
  },
  {
    id: "arb_hyperkalemia",
    drugClass: "arb",
    condition: { canonical: "Hyperkalemia" },
    severity: "high",
    rationale: "ARBs raise serum potassium and can be dangerous when potassium is already elevated.",
    specialties: ["nephrology", "cardiology", "pharmacy"],
    questions: ["Should my ARB dose change given my potassium?"],
  },
  {
    id: "corticosteroid_diabetes",
    drugClass: "corticosteroid",
    condition: { category: "metabolic" },
    severity: "medium",
    rationale: "Corticosteroids raise blood glucose and can destabilize diabetes control.",
    specialties: ["endocrinology", "pharmacy"],
    questions: ["How should I monitor my blood sugar while on steroids?"],
  },
  {
    id: "nsaid_anticoagulant_gi",
    drugClass: "nsaid",
    condition: { canonical: "GERD" },
    severity: "medium",
    rationale: "NSAIDs increase the risk of GI bleeding and ulceration, compounding reflux disease.",
    specialties: ["gastroenterology", "pharmacy"],
    questions: ["Do I need stomach protection if I keep taking NSAIDs?"],
  },
];

/** A drug-class ↔ drug-class interaction. */
export type InteractionRule = {
  id: string;
  classA: DrugClass;
  classB: DrugClass;
  severity: Severity;
  rationale: string;
  specialties: Specialty[];
  questions: string[];
};

export const INTERACTION_RULES: InteractionRule[] = [
  {
    id: "ace_potassium_sparing",
    classA: "ace_inhibitor",
    classB: "potassium_sparing_diuretic",
    severity: "high",
    rationale: "Combining an ACE inhibitor with a potassium-sparing diuretic substantially raises hyperkalemia risk.",
    specialties: ["cardiology", "nephrology", "pharmacy"],
    questions: ["Is it safe to take these two together for my potassium?"],
  },
  {
    id: "arb_potassium_sparing",
    classA: "arb",
    classB: "potassium_sparing_diuretic",
    severity: "high",
    rationale: "Combining an ARB with a potassium-sparing diuretic substantially raises hyperkalemia risk.",
    specialties: ["cardiology", "nephrology", "pharmacy"],
    questions: ["Is it safe to take these two together for my potassium?"],
  },
  {
    id: "ace_arb",
    classA: "ace_inhibitor",
    classB: "arb",
    severity: "high",
    rationale: "Dual ACE inhibitor + ARB therapy increases kidney injury and hyperkalemia risk without added benefit for most patients.",
    specialties: ["cardiology", "nephrology", "pharmacy"],
    questions: ["Do I really need both an ACE inhibitor and an ARB?"],
  },
  {
    id: "anticoagulant_nsaid",
    classA: "anticoagulant",
    classB: "nsaid",
    severity: "high",
    rationale: "NSAIDs added to anticoagulation markedly increase bleeding risk.",
    specialties: ["pharmacy", "cardiology"],
    questions: ["What pain reliever is safe while I'm on a blood thinner?"],
  },
  {
    id: "anticoagulant_antiplatelet",
    classA: "anticoagulant",
    classB: "antiplatelet",
    severity: "high",
    rationale: "Combining an anticoagulant with an antiplatelet increases bleeding risk and needs a clear indication.",
    specialties: ["cardiology", "pharmacy"],
    questions: ["Do I need both a blood thinner and aspirin?"],
  },
  {
    id: "ssri_anticoagulant",
    classA: "ssri",
    classB: "anticoagulant",
    severity: "medium",
    rationale: "SSRIs can increase bleeding risk when combined with anticoagulants.",
    specialties: ["pharmacy", "psychiatry"],
    questions: ["Does my antidepressant raise bleeding risk with my blood thinner?"],
  },
  {
    id: "opioid_benzodiazepine",
    classA: "opioid",
    classB: "benzodiazepine",
    severity: "high",
    rationale: "Concurrent opioids and benzodiazepines increase the risk of respiratory depression and overdose.",
    specialties: ["pharmacy", "primary_care"],
    questions: ["Is it safe to take these sedating medications together?"],
  },
];

/**
 * Concept → primary specialty routing, used for report relevance and alert
 * routing without per-patient hardcoding.
 */
export function specialtiesForConcept(concept: GroundedConcept): Specialty[] {
  if (concept.specialties.length > 0) return concept.specialties;
  return ["primary_care"];
}

export function eventTypeToNodeKindForConcept(kind: ConceptKind): GraphNodeKind {
  switch (kind) {
    case "condition":
      return "condition";
    case "medication":
      return "medication";
    case "lab":
      return "lab";
    case "symptom":
      return "symptom";
  }
}
