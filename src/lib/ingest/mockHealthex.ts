import type { EmrPayload } from "@/lib/schema";

export type HealthexProvider = {
  id: string;
  name: string;
  network: string;
  location: string;
  /** Builds a freshly-dated EMR payload so trends always look recent. */
  buildPayload: () => EmrPayload;
};

/** ISO date `months` before now (optionally with a day-of-month offset). */
function monthsAgo(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString();
}

/**
 * Primary demo connection: a longitudinal diabetes + chronic-kidney-disease
 * record with worsening HbA1c / eGFR / potassium so the trend agent and
 * specialist recommendations have meaningful signal to work with.
 */
function stanfordPayload(): EmrPayload {
  return {
    conditions: [
      { label: "Type 2 diabetes mellitus", status: "active", onset: monthsAgo(51) },
      { label: "Chronic kidney disease stage 3", status: "active", onset: monthsAgo(24) },
      { label: "Essential hypertension", status: "active", onset: monthsAgo(24) },
    ],
    medications: [
      { label: "Metformin", dose: "1000 mg twice daily", status: "active", start: monthsAgo(51) },
      { label: "Lisinopril", dose: "10 mg daily", status: "active", start: monthsAgo(24) },
      { label: "Empagliflozin", dose: "10 mg daily", status: "active", start: monthsAgo(6) },
    ],
    labs: [
      { label: "HbA1c", value: 6.8, unit: "%", date: monthsAgo(6) },
      { label: "HbA1c", value: 7.2, unit: "%", date: monthsAgo(4) },
      { label: "HbA1c", value: 7.8, unit: "%", date: monthsAgo(2) },
      { label: "HbA1c", value: 8.6, unit: "%", date: monthsAgo(0) },
      { label: "eGFR", value: 72, unit: "mL/min", date: monthsAgo(6) },
      { label: "eGFR", value: 65, unit: "mL/min", date: monthsAgo(4) },
      { label: "eGFR", value: 56, unit: "mL/min", date: monthsAgo(2) },
      { label: "eGFR", value: 48, unit: "mL/min", date: monthsAgo(0) },
      { label: "Potassium", value: 4.1, unit: "mEq/L", date: monthsAgo(6) },
      { label: "Potassium", value: 4.5, unit: "mEq/L", date: monthsAgo(4) },
      { label: "Potassium", value: 5.0, unit: "mEq/L", date: monthsAgo(2) },
      { label: "Potassium", value: 5.3, unit: "mEq/L", date: monthsAgo(0) },
    ],
    vitals: [
      { label: "Weight", value: 182, unit: "lb", date: monthsAgo(6) },
      { label: "Weight", value: 186, unit: "lb", date: monthsAgo(4) },
      { label: "Weight", value: 191, unit: "lb", date: monthsAgo(2) },
      { label: "Weight", value: 196, unit: "lb", date: monthsAgo(0) },
      { label: "Blood pressure", value: "132/84", date: monthsAgo(6) },
      { label: "Blood pressure", value: "138/86", date: monthsAgo(4) },
      { label: "Blood pressure", value: "144/90", date: monthsAgo(2) },
      { label: "Blood pressure", value: "148/92", date: monthsAgo(0) },
    ],
    encounters: [
      {
        label: "Endocrinology follow-up",
        clinician: "Dr. Patel",
        specialty: "endocrinology",
        date: monthsAgo(2),
      },
      {
        label: "Nephrology referral",
        clinician: "Dr. Chen",
        specialty: "nephrology",
        date: monthsAgo(1),
      },
    ],
    careTasks: [
      { label: "Repeat BMP and HbA1c in 3 months", due: monthsAgo(-3), status: "pending" },
      { label: "Schedule nephrology consult", due: monthsAgo(-1), status: "pending" },
    ],
  };
}

/** Secondary connection: cardiology-flavored record from another network. */
function bayCardioPayload(): EmrPayload {
  return {
    conditions: [
      { label: "Hyperlipidemia", status: "active", onset: monthsAgo(18) },
      { label: "Coronary artery disease", status: "active", onset: monthsAgo(9) },
    ],
    medications: [
      { label: "Atorvastatin", dose: "40 mg nightly", status: "active", start: monthsAgo(18) },
      { label: "Aspirin", dose: "81 mg daily", status: "active", start: monthsAgo(9) },
    ],
    labs: [
      { label: "LDL cholesterol", value: 142, unit: "mg/dL", date: monthsAgo(9) },
      { label: "LDL cholesterol", value: 128, unit: "mg/dL", date: monthsAgo(5) },
      { label: "LDL cholesterol", value: 96, unit: "mg/dL", date: monthsAgo(1) },
    ],
    vitals: [
      { label: "Resting heart rate", value: 78, unit: "bpm", date: monthsAgo(5) },
      { label: "Resting heart rate", value: 72, unit: "bpm", date: monthsAgo(1) },
    ],
    encounters: [
      {
        label: "Cardiology check-up",
        clinician: "Dr. Okafor",
        specialty: "cardiology",
        date: monthsAgo(1),
      },
    ],
  };
}

export const HEALTHEX_PROVIDERS: HealthexProvider[] = [
  {
    id: "stanford",
    name: "Stanford Health Care",
    network: "Epic MyChart",
    location: "Palo Alto, CA",
    buildPayload: stanfordPayload,
  },
  {
    id: "baycardio",
    name: "Bay Area Cardiology Associates",
    network: "athenahealth",
    location: "San Jose, CA",
    buildPayload: bayCardioPayload,
  },
];
