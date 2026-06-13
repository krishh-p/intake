export type SourceType = "emr" | "voice" | "doctor_note" | "manual";

export type Source = {
  id: string;
  type: SourceType;
  title: string;
  capturedAt: string;
  rawText?: string;
};

export type HealthEventType =
  | "condition"
  | "symptom"
  | "medication"
  | "lab"
  | "vital"
  | "encounter"
  | "care_task"
  | "barrier"
  | "note";

export type HealthEvent = {
  id: string;
  patientId: string;
  sourceId: string;
  type: HealthEventType;
  label: string;
  value?: string | number;
  unit?: string;
  observedAt: string;
  status?: "active" | "resolved" | "unknown";
  metadata?: Record<string, unknown>;
};

export type GraphNodeKind =
  | "patient"
  | "condition"
  | "symptom"
  | "medication"
  | "lab"
  | "clinician"
  | "encounter"
  | "risk"
  | "source"
  | "task"
  | "barrier";

export type GraphNode = {
  id: string;
  kind: GraphNodeKind;
  label: string;
  eventIds?: string[];
  metadata?: Record<string, unknown>;
};

export type GraphEdgeRelation =
  | "has_condition"
  | "takes"
  | "reported"
  | "ordered"
  | "managed_by"
  | "mentioned_in"
  | "belongs_to_visit"
  | "worsening_trend"
  | "risk_factor_for"
  | "contraindicated_with"
  | "needs_follow_up"
  | "barrier_to"
  | "possibly_related_to";

export type GraphEdge = {
  id: string;
  from: string;
  to: string;
  relation: GraphEdgeRelation;
  evidenceEventIds: string[];
};

export type RiskAlert = {
  id: string;
  severity: "high" | "medium" | "low";
  title: string;
  timeHorizon: string;
  specialty: string[];
  explanation: string;
  evidenceEventIds: string[];
  suggestedQuestions: string[];
};

export type ReportSpecialty =
  | "primary_care"
  | "cardiology"
  | "nephrology"
  | "endocrinology"
  | "pharmacy";

export type DoctorReport = {
  specialty: ReportSpecialty;
  title: string;
  summary: string;
  topConcerns: string[];
  relevantTimeline: HealthEvent[];
  medications: HealthEvent[];
  labsAndVitals: HealthEvent[];
  patientContext: HealthEvent[];
  questions: string[];
  evidenceSources: Source[];
};

export type PatientProfile = {
  id: string;
  name: string;
  dob: string;
};

export type IntakeState = {
  patient: PatientProfile;
  sources: Source[];
  events: HealthEvent[];
};

export type EmrPayload = {
  conditions?: { label: string; status?: string; onset?: string }[];
  medications?: { label: string; dose?: string; status?: string; start?: string }[];
  labs?: { label: string; value?: string | number; unit?: string; date?: string }[];
  vitals?: { label: string; value?: string | number; unit?: string; date?: string }[];
  encounters?: {
    label: string;
    clinician?: string;
    specialty?: string;
    date?: string;
  }[];
  careTasks?: { label: string; due?: string; status?: string }[];
};

export const EMPTY_DOCTOR_NOTE = {
  clinicianName: "",
  specialty: "",
  note: "",
  followUp: "",
  lab: "",
  medicationChange: "",
};
