export type SourceType = "emr" | "voice" | "doctor_note" | "manual";

/** Terminology systems we ground concepts to (UMLS-style cross references). */
export type CodingSystem = "SNOMED" | "RxNorm" | "LOINC" | "ICD10" | "INTERNAL";

export type Coding = {
  system: CodingSystem;
  code: string;
  display: string;
};

/** Out-of-range interpretation of a numeric lab/vital value. */
export type LabFlag = "normal" | "high" | "low" | "unknown";

/** Direction + magnitude of a time-ordered lab series. */
export type TrendSummary = {
  label: string;
  unit?: string;
  direction: "rising" | "falling" | "stable";
  worsening: boolean;
  first: number;
  last: number;
  delta: number;
  points: number;
  firstObservedAt: string;
  lastObservedAt: string;
};

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

export type FactRelevance = "graph" | "evidence_only" | "ignore";
export type ReviewStatus = "accepted" | "needs_review" | "rejected" | "superseded";
export type ExtractionMethod = "ai" | "rules" | "manual";
export type Provenance = {
  sourceId: string;
  chunkId?: string;
  quote?: string;
  startOffset?: number;
  endOffset?: number;
  method: ExtractionMethod;
  model?: string;
  promptVersion?: string;
};

export type SourceChunk = {
  id: string;
  sourceId: string;
  text: string;
  startOffset: number;
  endOffset: number;
  ordinal: number;
};

export type ExtractionRun = {
  id: string;
  sourceId: string;
  model: string;
  promptVersion: string;
  status: "completed" | "failed" | "fallback";
  startedAt: string;
  completedAt?: string;
  error?: string;
};

export type CandidateFact = {
  id: string;
  patientId: string;
  sourceId: string;
  chunkId?: string;
  kind: HealthEventType;
  label: string;
  normalizedLabel: string;
  value?: string | number;
  unit?: string;
  observedAt: string;
  status?: HealthEvent["status"];
  relevance: FactRelevance;
  confidence: number;
  evidenceQuote?: string;
  negated?: boolean;
  uncertain?: boolean;
  /** Terminology grounding for this fact's concept, when known. */
  coding?: Coding;
  /**
   * Bitemporal validity. `validFrom`/`validTo` describe when the fact was true
   * in the real world (NULL `validTo` = still current); `recordedAt` is when
   * the system learned it. Enables point-in-time and supersession reasoning.
   */
  validFrom?: string;
  validTo?: string;
  recordedAt?: string;
  /** Interpretation of a numeric lab/vital against its reference range. */
  labFlag?: LabFlag;
  metadata?: Record<string, unknown>;
};

export type ClinicalFact = CandidateFact & {
  reviewStatus: ReviewStatus;
  provenance: Provenance[];
  eventId: string;
  entityId?: string;
};

export type Entity = {
  id: string;
  patientId: string;
  kind: GraphNodeKind;
  canonicalLabel: string;
  aliases: string[];
  confidence: number;
  reviewStatus: ReviewStatus;
  factIds: string[];
  /** Terminology grounding (SNOMED/RxNorm/LOINC) when the concept is known. */
  coding?: Coding;
  /** Pharmacologic classes for medications (drives interaction reasoning). */
  drugClasses?: string[];
  /** Broad disease category for conditions (drives category-level rules). */
  category?: string;
  /** Specialties this concept routes to. */
  specialties?: string[];
  metadata?: Record<string, unknown>;
};

export type GraphRelationship = {
  id: string;
  patientId: string;
  fromEntityId: string;
  toEntityId: string;
  relation: GraphEdgeRelation;
  confidence: number;
  evidenceFactIds: string[];
  provenance: Provenance[];
  reviewStatus: ReviewStatus;
  /** Human-readable clinical justification for this edge. */
  rationale?: string;
  severity?: "high" | "medium" | "low";
  metadata?: Record<string, unknown>;
};

export type ReviewItem = {
  id: string;
  patientId: string;
  targetType: "fact" | "entity" | "relationship" | "contradiction";
  targetId: string;
  reason: string;
  status: "open" | "resolved";
  createdAt: string;
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
  | "barrier"
  | "conversation";

export type GraphNode = {
  id: string;
  kind: GraphNodeKind;
  label: string;
  eventIds?: string[];
  factIds?: string[];
  confidence?: number;
  reviewStatus?: ReviewStatus;
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
  evidenceFactIds?: string[];
  confidence?: number;
  reviewStatus?: ReviewStatus;
  metadata?: Record<string, unknown>;
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

export type TrendDirection = "improving" | "worsening" | "stable";

export type Trend = {
  id: string;
  metric: string;
  direction: TrendDirection;
  severity: "high" | "medium" | "low";
  changeSummary: string;
  narrative: string;
  suggestedActions: string[];
  window?: { start: string; end: string };
  dataPoints?: { observedAt: string; value: number; unit?: string }[];
  evidenceEventIds: string[];
  recommendedSpecialty?: ReportSpecialty;
  recommendationReason?: string;
};

export type TrendReport = {
  trends: Trend[];
  generatedAt: string;
  method: "agent" | "fallback";
};

export type AgentStep = {
  tool: string;
  args: unknown;
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
  intakeSummary?: string;
  intakeTranscript?: string;
};

export type SharedReport = {
  token: string;
  patientName: string;
  specialty: ReportSpecialty;
  report: DoctorReport;
  createdAt: string;
};

export type PatientProfile = {
  id: string;
  name: string;
  dob: string;
};

/** Structured summary of an Intake conversation — becomes a graph hub node. */
export type ConversationContext = {
  id: string;
  patientId: string;
  sourceId: string;
  capturedAt: string;
  title: string;
  summary: string;
  chiefConcern: string;
  topics: string[];
  symptoms: string[];
  medications: string[];
  barriers: string[];
  concerns: string[];
  followUpItems: string[];
  eventIds: string[];
  messageCount: number;
};

export type IntakeState = {
  patient: PatientProfile;
  sources: Source[];
  sourceChunks: SourceChunk[];
  events: HealthEvent[];
  contexts: ConversationContext[];
  candidateFacts: CandidateFact[];
  clinicalFacts: ClinicalFact[];
  entities: Entity[];
  graphRelationships: GraphRelationship[];
  reviewItems: ReviewItem[];
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
