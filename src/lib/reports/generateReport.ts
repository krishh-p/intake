import type {
  DoctorReport,
  HealthEvent,
  ReportSpecialty,
  RiskAlert,
  Source,
} from "@/lib/schema";

function sortByDate(events: HealthEvent[]) {
  return [...events].sort(
    (a, b) => new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime()
  );
}

function filterByType(events: HealthEvent[], types: HealthEvent["type"][]) {
  return events.filter((e) => types.includes(e.type));
}

function filterAlertsForSpecialty(alerts: RiskAlert[], specialty: ReportSpecialty) {
  const map: Record<ReportSpecialty, string[]> = {
    primary_care: ["primary care", "insurance navigator"],
    cardiology: ["cardiology"],
    nephrology: ["nephrology"],
    endocrinology: ["endocrinology"],
    pharmacy: ["pharmacy"],
  };
  const keys = map[specialty];
  return alerts.filter((a) =>
    a.specialty.some((s) => keys.some((k) => s.toLowerCase().includes(k.split(" ")[0])))
  );
}

function formatLabTrend(events: HealthEvent[], label: string) {
  const labs = events
    .filter((e) => e.type === "lab" && e.label === label)
    .sort((a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime());
  if (labs.length === 0) return null;
  if (labs.length === 1) return `${label} ${labs[0].value} ${labs[0].unit ?? ""}`.trim();
  const first = labs[0];
  const last = labs[labs.length - 1];
  return `${label} trend: ${first.value} → ${last.value} ${last.unit ?? ""}`.trim();
}

const SPECIALTY_LABELS: Record<ReportSpecialty, string> = {
  primary_care: "Primary Care",
  cardiology: "Cardiology",
  nephrology: "Nephrology",
  endocrinology: "Endocrinology",
  pharmacy: "Pharmacy / Medication Review",
};

export function generateReport(
  specialty: ReportSpecialty,
  patientName: string,
  events: HealthEvent[],
  sources: Source[],
  alerts: RiskAlert[]
): DoctorReport {
  const meds = sortByDate(filterByType(events, ["medication"]));
  const labsAndVitals = sortByDate(filterByType(events, ["lab", "vital"]));
  const symptoms = sortByDate(filterByType(events, ["symptom"]));
  const barriers = sortByDate(filterByType(events, ["barrier"]));
  const relevantAlerts = filterAlertsForSpecialty(alerts, specialty);
  const usedSourceIds = new Set(events.map((e) => e.sourceId));
  const evidenceSources = sources.filter((s) => usedSourceIds.has(s.id));

  const egfrTrend = formatLabTrend(events, "eGFR");
  const kTrend = formatLabTrend(events, "Potassium");
  const a1cTrend = formatLabTrend(events, "HbA1c");

  const configs: Record<
    ReportSpecialty,
    { summary: string; concerns: string[]; questions: string[]; timeline: HealthEvent[]; context: HealthEvent[] }
  > = {
    cardiology: {
      summary: `${patientName} is a 58-year-old with hypertension, type 2 diabetes, and stage 3a CKD presenting with new ankle swelling and exertional shortness of breath. Recent BP readings remain elevated (146–152/90–94 mmHg). She reports daily ibuprofen use and a delayed lisinopril refill. Cardiology visit is scheduled next month; latest kidney labs may not yet be in the cardiology record.`,
      concerns: [
        "New edema and shortness of breath — evaluate for fluid overload or heart failure",
        "Persistently elevated blood pressure despite ACE inhibitor therapy",
        "NSAID use and refill gap may be contributing to volume and BP instability",
        ...(relevantAlerts.slice(0, 2).map((a) => a.title)),
      ],
      questions: [
        "Given new swelling and SOB, do I need echo or BNP testing before my visit?",
        "Should I restrict sodium or fluid until evaluated?",
        "Is my current antihypertensive plan adequate with declining kidney function?",
        "How should ibuprofen use be addressed given cardiac and kidney risk?",
      ],
      timeline: sortByDate([
        ...symptoms,
        ...labsAndVitals.filter((e) => /blood pressure|potassium|egfr/i.test(e.label)),
        ...filterByType(events, ["encounter"]).filter((e) =>
          /cardiology/i.test(String(e.metadata?.specialty ?? e.label))
        ),
      ]).slice(0, 8),
      context: [...symptoms, ...barriers.filter((e) => /refill/i.test(e.label))],
    },
    nephrology: {
      summary: `${patientName} has stage 3a CKD with a concerning downward eGFR trend${egfrTrend ? ` (${egfrTrend})` : ""} and rising potassium${kTrend ? ` (${kTrend})` : ""}. She missed nephrology follow-up after an insurance change and is taking daily ibuprofen for knee pain while on lisinopril. PCP ordered repeat BMP in two weeks. Patient-reported edema and fatigue may reflect worsening kidney-related fluid retention.`,
      concerns: [
        "Worsening kidney function with hyperkalemia risk",
        "Daily NSAID use in setting of CKD and ACE inhibitor",
        "Missed nephrology follow-up and care-navigation gap",
        "Repeat BMP ordered — ensure results reach all specialists",
        ...(relevantAlerts.slice(0, 1).map((a) => a.title)),
      ],
      questions: [
        "Should I stop ibuprofen immediately?",
        "Is lisinopril still appropriate at this eGFR and potassium level?",
        "Can you help coordinate nephrology re-establishment under new insurance?",
        "What BP and diet targets should I follow until repeat labs?",
      ],
      timeline: sortByDate([
        ...labsAndVitals.filter((e) => /egfr|potassium|creatinine/i.test(e.label)),
        ...meds.filter((e) => /ibuprofen|lisinopril/i.test(e.label)),
        ...barriers,
        ...filterByType(events, ["care_task"]).filter((e) => /bmp|kidney/i.test(e.label)),
      ]).slice(0, 8),
      context: [...barriers, ...symptoms.filter((e) => /fatigue|swelling/i.test(e.label))],
    },
    primary_care: {
      summary: `${patientName} receives fragmented care across primary care, urgent care, cardiology, and nephrology. Key trends: rising A1c, falling eGFR, elevated potassium, high BP, new volume-related symptoms, daily NSAID use, missed nephrology visit, and lisinopril refill delay. Intake highlights cross-specialty coordination gaps before upcoming cardiology and overdue nephrology follow-up.`,
      concerns: [
        "Multi-morbidity coordination: diabetes, HTN, CKD with conflicting medication exposures",
        "Care gap: missed nephrology and delayed pharmacy refill",
        "Repeat BMP ordered — ensure closed-loop follow-up",
        "Urgent care NSAID recommendation may conflict with CKD management",
        ...(relevantAlerts.slice(0, 2).map((a) => a.title)),
      ],
      questions: [
        "Can we reconcile medications across all recent visits?",
        "Who owns follow-up on repeat BMP results?",
        "Can you help re-establish nephrology and address insurance barriers?",
        "What red-flag symptoms should prompt urgent evaluation?",
      ],
      timeline: sortByDate(events).slice(0, 10),
      context: [...barriers, ...symptoms],
    },
    endocrinology: {
      summary: `${patientName} has type 2 diabetes with a rising HbA1c trend${a1cTrend ? ` (${a1cTrend})` : ""} on metformin. Worsening CKD may constrain future diabetes therapy choices. Recent fatigue and care-access barriers (insurance change, refill delay) may affect adherence and lifestyle management.`,
      concerns: [
        "HbA1c rising — diabetes control slipping",
        "CKD progression may limit metformin and other agent options",
        "NSAID and BP medication issues may indirectly affect metabolic management",
        "Patient-reported fatigue and access barriers",
      ],
      questions: [
        "Is metformin still appropriate at current eGFR?",
        "Should we add or switch diabetes therapy given A1c trend?",
        "Would CGM or structured diabetes education help now?",
        "How should kidney and cardiac comorbidities guide glycemic targets?",
      ],
      timeline: sortByDate([
        ...labsAndVitals.filter((e) => /hba1c|a1c|blood pressure/i.test(e.label)),
        ...meds.filter((e) => /metformin/i.test(e.label)),
        ...filterByType(events, ["condition"]).filter((e) => /diabetes/i.test(e.label)),
      ]).slice(0, 8),
      context: [...symptoms.filter((e) => /fatigue/i.test(e.label)), ...barriers],
    },
    pharmacy: {
      summary: `${patientName}'s active medication list includes metformin, lisinopril, and newly reported daily ibuprofen (OTC plus urgent care recommendation). Lisinopril refill was delayed. Given CKD and elevated potassium, NSAID use presents a significant medication safety concern requiring reconciliation across prescribers.`,
      concerns: [
        "Daily ibuprofen with CKD, hyperkalemia risk, and lisinopril",
        "Lisinopril refill delay — assess adherence and BP impact",
        "Medication list fragmentation across urgent care, PCP, and patient report",
        "Need for safer analgesic alternative for knee pain",
      ],
      questions: [
        "Can you review all prescriptions and OTC meds for kidney and potassium risk?",
        "What non-NSAID options are safe for my knee pain with CKD?",
        "Should lisinopril timing or dose change given recent labs?",
        "Can pharmacy notify my doctors if future refills are delayed?",
      ],
      timeline: sortByDate([
        ...meds,
        ...barriers.filter((e) => /refill/i.test(e.label)),
        ...labsAndVitals.filter((e) => /potassium|egfr/i.test(e.label)),
      ]).slice(0, 8),
      context: [...meds.filter((e) => /ibuprofen/i.test(e.label)), ...barriers],
    },
  };

  const config = configs[specialty];

  return {
    specialty,
    title: `${SPECIALTY_LABELS[specialty]} Visit Brief — ${patientName}`,
    summary: config.summary,
    topConcerns: config.concerns.slice(0, 5),
    relevantTimeline: config.timeline,
    medications: meds,
    labsAndVitals: labsAndVitals.slice(0, 10),
    patientContext: config.context,
    questions: config.questions,
    evidenceSources,
  };
}

export function reportToPlainText(report: DoctorReport): string {
  const lines: string[] = [
    report.title,
    "=".repeat(report.title.length),
    "",
    "PATIENT SNAPSHOT",
    report.summary,
    "",
    "TOP CONCERNS",
    ...report.topConcerns.map((c, i) => `${i + 1}. ${c}`),
    "",
    "CURRENT MEDICATIONS",
    ...report.medications.map((m) => `- ${m.label}${m.value ? `: ${m.value}` : ""}`),
    "",
    "RECENT LABS & VITALS",
    ...report.labsAndVitals.map(
      (l) =>
        `- ${l.label}: ${l.value ?? ""}${l.unit ? ` ${l.unit}` : ""} (${new Date(l.observedAt).toLocaleDateString()})`
    ),
    "",
    "PATIENT-REPORTED CONTEXT",
    ...report.patientContext.map((p) => `- ${p.label}${p.value ? `: ${p.value}` : ""}`),
    "",
    "QUESTIONS FOR THIS VISIT",
    ...report.questions.map((q, i) => `${i + 1}. ${q}`),
    "",
    "EVIDENCE SOURCES",
    ...report.evidenceSources.map((s) => `- ${s.title} (${s.type})`),
    "",
    "DISCLAIMER",
    "Generated from patient-provided and imported data. Not a diagnosis. Clinician review required.",
  ];
  return lines.join("\n");
}
