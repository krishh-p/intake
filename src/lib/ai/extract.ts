import {
  buildExtractPrompt,
  buildGraphPrompt,
  buildReportPrompt,
  buildRiskPrompt,
  EXTRACT_EVENTS_SYSTEM,
  GRAPH_RELATIONS_SYSTEM,
  REPORT_SYSTEM,
  RISK_ENRICH_SYSTEM,
  VALID_EVENT_TYPES,
  VALID_RELATIONS,
} from "@/lib/ai/prompts";
import { grokChat, isAiConfigured, parseJsonResponse } from "@/lib/ai/xai";
import type {
  DoctorReport,
  GraphEdge,
  GraphEdgeRelation,
  GraphNode,
  HealthEvent,
  ReportSpecialty,
  RiskAlert,
  Source,
  SourceType,
} from "@/lib/schema";
import { generateId } from "@/lib/utils";
import { generateReport } from "@/lib/reports/generateReport";

type ExtractedEvent = {
  type: string;
  label: string;
  value?: string | number;
  unit?: string;
  status?: string;
  metadata?: Record<string, unknown>;
};

type AiRelationship = {
  fromLabel: string;
  toLabel: string;
  relation: string;
  reason?: string;
};

type AiAlert = {
  severity: string;
  title: string;
  timeHorizon: string;
  specialty: string[];
  explanation: string;
  evidenceLabels: string[];
  suggestedQuestions: string[];
};

export { isAiConfigured };

export async function aiExtractEvents(
  text: string,
  sourceType: SourceType,
  patientId: string,
  sourceId: string,
  patientName: string
): Promise<HealthEvent[]> {
  const raw = await grokChat(
    [
      { role: "system", content: EXTRACT_EVENTS_SYSTEM },
      {
        role: "user",
        content: buildExtractPrompt(text, sourceType, patientName),
      },
    ],
    { json: true }
  );

  const parsed = parseJsonResponse<{ events: ExtractedEvent[] }>(raw);
  const now = new Date().toISOString();

  return (parsed.events ?? [])
    .filter((e) => e.label && VALID_EVENT_TYPES.includes(e.type as HealthEvent["type"]))
    .map((e) => ({
      id: generateId("evt"),
      patientId,
      sourceId,
      type: e.type as HealthEvent["type"],
      label: e.label,
      value: e.value,
      unit: e.unit,
      observedAt: now,
      status: (["active", "resolved", "unknown"].includes(e.status ?? "")
        ? e.status
        : "active") as HealthEvent["status"],
      metadata: { ...e.metadata, aiExtracted: true },
    }));
}

export async function aiExtractRelationships(
  events: HealthEvent[],
  nodes: GraphNode[]
): Promise<GraphEdge[]> {
  if (events.length < 2) return [];

  const raw = await grokChat(
    [
      { role: "system", content: GRAPH_RELATIONS_SYSTEM },
      {
        role: "user",
        content: buildGraphPrompt(events),
      },
    ],
    { json: true }
  );

  const parsed = parseJsonResponse<{ relationships: AiRelationship[] }>(raw);
  const edges: GraphEdge[] = [];

  for (const rel of parsed.relationships ?? []) {
    if (!VALID_RELATIONS.includes(rel.relation as GraphEdgeRelation)) continue;

    const fromNode = findNodeByLabel(nodes, rel.fromLabel);
    const toNode = findNodeByLabel(nodes, rel.toLabel);
    if (!fromNode || !toNode || fromNode.id === toNode.id) continue;

    const evidenceEventIds = collectEventIds(fromNode, toNode, events, rel.fromLabel, rel.toLabel);

    edges.push({
      id: generateId("edge"),
      from: fromNode.id,
      to: toNode.id,
      relation: rel.relation as GraphEdgeRelation,
      evidenceEventIds,
    });
  }

  return dedupeEdges(edges);
}

export async function aiGenerateReport(
  specialty: ReportSpecialty,
  patientName: string,
  events: HealthEvent[],
  sources: Source[],
  alerts: RiskAlert[]
): Promise<Pick<DoctorReport, "summary" | "topConcerns" | "questions">> {
  const eventsText = events
    .map((e) => `- [${e.type}] ${e.label}${e.value !== undefined ? `: ${e.value}` : ""}${e.unit ? ` ${e.unit}` : ""}`)
    .join("\n");
  const alertsText =
    alerts.length > 0
      ? alerts.map((a) => `- [${a.severity}] ${a.title}: ${a.explanation}`).join("\n")
      : "None";

  const raw = await grokChat(
    [
      { role: "system", content: REPORT_SYSTEM },
      {
        role: "user",
        content: buildReportPrompt(specialty, patientName, eventsText, alertsText),
      },
    ],
    { json: true }
  );

  return parseJsonResponse<{ summary: string; topConcerns: string[]; questions: string[] }>(raw);
}

export async function aiEnrichAlerts(
  events: HealthEvent[],
  existingAlerts: RiskAlert[]
): Promise<RiskAlert[]> {
  const eventsText = events
    .map((e) => `- [${e.type}] ${e.label}${e.value !== undefined ? `: ${e.value}` : ""}`)
    .join("\n");
  const existingText =
    existingAlerts.length > 0
      ? existingAlerts.map((a) => `- [${a.severity}] ${a.title}`).join("\n")
      : "None";

  const raw = await grokChat(
    [
      { role: "system", content: RISK_ENRICH_SYSTEM },
      {
        role: "user",
        content: buildRiskPrompt(eventsText, existingText),
      },
    ],
    { json: true, temperature: 0.3 }
  );

  const parsed = parseJsonResponse<{ alerts: AiAlert[] }>(raw);
  const existingTitles = new Set(existingAlerts.map((a) => a.title.toLowerCase()));

  return (parsed.alerts ?? [])
    .filter((a) => a.title && !existingTitles.has(a.title.toLowerCase()))
    .slice(0, 2)
    .map((a) => ({
      id: generateId("alert"),
      severity: (["high", "medium", "low"].includes(a.severity)
        ? a.severity
        : "medium") as RiskAlert["severity"],
      title: a.title,
      timeHorizon: a.timeHorizon || "Next 2 weeks",
      specialty: a.specialty ?? ["primary care"],
      explanation: a.explanation,
      evidenceEventIds: matchEventsByLabels(events, a.evidenceLabels ?? []),
      suggestedQuestions: a.suggestedQuestions ?? [],
    }))
    .filter((a) => a.evidenceEventIds.length > 0);
}

export function mergeReportWithTemplate(
  specialty: ReportSpecialty,
  patientName: string,
  events: HealthEvent[],
  sources: Source[],
  alerts: RiskAlert[],
  aiContent: Pick<DoctorReport, "summary" | "topConcerns" | "questions">
): DoctorReport {
  const base = generateReport(specialty, patientName, events, sources, alerts);
  return {
    ...base,
    summary: aiContent.summary || base.summary,
    topConcerns: aiContent.topConcerns?.length ? aiContent.topConcerns : base.topConcerns,
    questions: aiContent.questions?.length ? aiContent.questions : base.questions,
  };
}

function findNodeByLabel(nodes: GraphNode[], label: string): GraphNode | undefined {
  const lower = label.toLowerCase();
  return (
    nodes.find((n) => n.label.toLowerCase() === lower) ??
    nodes.find((n) => n.label.toLowerCase().includes(lower) || lower.includes(n.label.toLowerCase()))
  );
}

function collectEventIds(
  fromNode: GraphNode,
  toNode: GraphNode,
  events: HealthEvent[],
  fromLabel: string,
  toLabel: string
): string[] {
  const ids = new Set<string>();
  for (const id of fromNode.eventIds ?? []) ids.add(id);
  for (const id of toNode.eventIds ?? []) ids.add(id);

  if (ids.size === 0) {
    for (const e of events) {
      const l = e.label.toLowerCase();
      if (l.includes(fromLabel.toLowerCase()) || l.includes(toLabel.toLowerCase())) {
        ids.add(e.id);
      }
    }
  }
  return Array.from(ids);
}

function matchEventsByLabels(events: HealthEvent[], labels: string[]): string[] {
  const ids: string[] = [];
  for (const label of labels) {
    const lower = label.toLowerCase();
    const match = events.find(
      (e) =>
        e.label.toLowerCase() === lower ||
        e.label.toLowerCase().includes(lower) ||
        lower.includes(e.label.toLowerCase())
    );
    if (match) ids.push(match.id);
  }
  return ids;
}

function dedupeEdges(edges: GraphEdge[]): GraphEdge[] {
  const seen = new Set<string>();
  return edges.filter((e) => {
    const key = `${e.from}|${e.to}|${e.relation}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
