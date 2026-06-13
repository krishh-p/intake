import type { HealthEvent, RiskAlert } from "@/lib/schema";
import { generateId } from "@/lib/utils";

function getLabs(events: HealthEvent[], label: string) {
  return events
    .filter((e) => e.type === "lab" && e.label === label)
    .sort((a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime());
}

function hasCondition(events: HealthEvent[], pattern: RegExp) {
  return events.some((e) => e.type === "condition" && pattern.test(e.label));
}

function hasSymptom(events: HealthEvent[], pattern: RegExp) {
  return events.some((e) => e.type === "symptom" && pattern.test(e.label));
}

function hasMedication(events: HealthEvent[], pattern: RegExp) {
  return events.some((e) => e.type === "medication" && pattern.test(e.label));
}

function hasBarrier(events: HealthEvent[], pattern: RegExp) {
  return events.some((e) => e.type === "barrier" && pattern.test(e.label));
}

function getHighBpEvents(events: HealthEvent[]) {
  return events.filter((e) => {
    if (e.type !== "vital" || e.label !== "Blood pressure") return false;
    const val = String(e.value ?? "");
    const match = val.match(/(\d+)\//);
    if (!match) return false;
    return parseInt(match[1], 10) >= 140;
  });
}

function collectIds(...groups: HealthEvent[][]) {
  return groups.flat().map((e) => e.id);
}

export function evaluateRiskRules(events: HealthEvent[]): RiskAlert[] {
  const alerts: RiskAlert[] = [];

  const egfrLabs = getLabs(events, "eGFR");
  const potassiumLabs = getLabs(events, "Potassium");
  const a1cLabs = getLabs(events, "HbA1c");
  const ckdEvents = events.filter(
    (e) => e.type === "condition" && /kidney|ckd/i.test(e.label)
  );
  const ibuprofenEvents = events.filter(
    (e) => e.type === "medication" && /ibuprofen/i.test(e.label)
  );
  const edemaEvents = events.filter(
    (e) => e.type === "symptom" && /swelling|edema/i.test(e.label)
  );
  const sobEvents = events.filter(
    (e) => e.type === "symptom" && /shortness of breath/i.test(e.label)
  );
  const missedNephEvents = events.filter(
    (e) => e.type === "barrier" && /nephrology/i.test(e.label)
  );
  const refillEvents = events.filter(
    (e) => e.type === "barrier" && /refill/i.test(e.label)
  );
  const highBpEvents = getHighBpEvents(events);

  if (egfrLabs.length >= 2 && potassiumLabs.length >= 1) {
    const firstEgfr = Number(egfrLabs[0].value);
    const lastEgfr = Number(egfrLabs[egfrLabs.length - 1].value);
    const lastK = Number(potassiumLabs[potassiumLabs.length - 1].value);

    if (lastEgfr < firstEgfr && lastK >= 5.0) {
      alerts.push({
        id: generateId("alert"),
        severity: "high",
        title: "Kidney function and potassium safety risk",
        timeHorizon: "Now — next 2 weeks",
        specialty: ["nephrology", "primary care", "pharmacy"],
        explanation:
          "eGFR has fallen over time while potassium is elevated. This pattern suggests worsening kidney function with electrolyte risk, especially with current medications.",
        evidenceEventIds: collectIds(egfrLabs, potassiumLabs, ckdEvents),
        suggestedQuestions: [
          "Should I stop or avoid ibuprofen and other NSAIDs?",
          "Do I need repeat BMP labs sooner than two weeks?",
          "Is my lisinopril dose still safe with these kidney numbers?",
        ],
      });
    }
  }

  if (
    (hasCondition(events, /kidney|ckd/i) || ckdEvents.length > 0) &&
    hasMedication(events, /ibuprofen/i)
  ) {
    alerts.push({
      id: generateId("alert"),
      severity: "high",
      title: "NSAID use with chronic kidney disease",
      timeHorizon: "Now",
      specialty: ["nephrology", "pharmacy", "primary care"],
      explanation:
        "Daily ibuprofen use combined with known chronic kidney disease increases risk of further kidney injury and elevated potassium, especially alongside ACE inhibitor therapy.",
      evidenceEventIds: collectIds(ckdEvents, ibuprofenEvents),
      suggestedQuestions: [
        "What can I take instead of ibuprofen for knee pain?",
        "Should urgent care have avoided prescribing an NSAID?",
        "Do I need medication reconciliation across all my doctors?",
      ],
    });
  }

  if (hasSymptom(events, /swelling|edema/i) || hasSymptom(events, /shortness of breath/i)) {
    alerts.push({
      id: generateId("alert"),
      severity: "high",
      title: "Possible fluid overload before cardiology visit",
      timeHorizon: "Before next cardiology appointment",
      specialty: ["cardiology", "primary care", "nephrology"],
      explanation:
        "New ankle swelling and shortness of breath on exertion may signal fluid retention or heart failure, especially with hypertension, kidney disease, and recent medication changes.",
      evidenceEventIds: collectIds(edemaEvents, sobEvents, highBpEvents),
      suggestedQuestions: [
        "Could these symptoms mean my heart is not pumping effectively?",
        "Should I be weighed daily or restrict salt/fluid?",
        "Do you need an updated echocardogram before my visit?",
      ],
    });
  }

  if (a1cLabs.length >= 2) {
    const first = Number(a1cLabs[0].value);
    const last = Number(a1cLabs[a1cLabs.length - 1].value);
    if (last > first) {
      alerts.push({
        id: generateId("alert"),
        severity: "medium",
        title: "Diabetes control worsening trend",
        timeHorizon: "Next 90 days",
        specialty: ["endocrinology", "primary care"],
        explanation:
          `HbA1c has risen from ${first}% to ${last}% over recent labs, suggesting diabetes control is slipping despite metformin.`,
        evidenceEventIds: collectIds(a1cLabs),
        suggestedQuestions: [
          "Should my diabetes medication be adjusted?",
          "Are kidney changes limiting my treatment options?",
          "Would diabetes education or CGM help right now?",
        ],
      });
    }
  }

  if (highBpEvents.length >= 2 || refillEvents.length > 0) {
    alerts.push({
      id: generateId("alert"),
      severity: "medium",
      title: "Blood pressure control at risk",
      timeHorizon: "Next 2 weeks",
      specialty: ["primary care", "cardiology", "pharmacy"],
      explanation:
        "Recent blood pressure readings remain above goal, and a delayed lisinopril refill may have interrupted therapy.",
      evidenceEventIds: collectIds(highBpEvents, refillEvents),
      suggestedQuestions: [
        "Was my BP higher because I missed lisinopril doses?",
        "Should I check BP at home daily until the refill is stable?",
        "Do I need a dose change given kidney function?",
      ],
    });
  }

  if (hasBarrier(events, /insurance|nephrology/i)) {
    alerts.push({
      id: generateId("alert"),
      severity: "medium",
      title: "Missed nephrology follow-up due to insurance change",
      timeHorizon: "Next appointment",
      specialty: ["nephrology", "primary care", "insurance navigator"],
      explanation:
        "A missed kidney specialist visit during worsening labs creates a care-navigation gap that may delay medication and monitoring decisions.",
      evidenceEventIds: collectIds(missedNephEvents, egfrLabs),
      suggestedQuestions: [
        "Can you help me get back in with nephrology under my new insurance?",
        "Is repeat BMP enough while I wait for that visit?",
        "Are there patient assistance options if cost is a barrier?",
      ],
    });
  }

  const severityOrder = { high: 0, medium: 1, low: 2 };
  return alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}

export function getSourceTypesForAlert(
  alert: RiskAlert,
  events: HealthEvent[],
  sources: { id: string; type: string }[]
): string[] {
  const eventIds = new Set(alert.evidenceEventIds);
  const sourceIds = new Set(
    events.filter((e) => eventIds.has(e.id)).map((e) => e.sourceId)
  );
  const types = new Set<string>();
  for (const source of sources) {
    if (sourceIds.has(source.id)) {
      types.add(source.type);
    }
  }
  return Array.from(types);
}
