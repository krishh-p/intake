"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/lib/AuthContext";
import {
  analyzeGraph,
  analyzeRisk,
  checkAiHealth,
  doctorNoteToText,
  extractFromText,
  finalizeIntakeConversation,
} from "@/lib/api/client";
import { parseEmrFile } from "@/lib/ingest/emrParser";
import { type DoctorNoteInput } from "@/lib/ingest/doctorNoteParser";
import { buildGraph } from "@/lib/graph/buildGraph";
import { queryGraph, searchEvidenceForAlert } from "@/lib/graph/queryGraph";
import {
  buildEvidenceIndex,
  type EvidenceIndex,
  type SearchResult,
} from "@/lib/index/evidenceIndex";
import { type IntakeChatMessage } from "@/lib/ai/intakeAgent";
import { workspaceKey } from "@/lib/auth/store";
import type {
  ConversationContext,
  GraphEdge,
  GraphNode,
  HealthEvent,
  IntakeState,
  RiskAlert,
  Source,
} from "@/lib/schema";
import { evaluateRiskRules } from "@/lib/risk/rules";

type ProcessingState = { active: boolean; message: string };

type IntakeContextValue = {
  state: IntakeState;
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  displayGraph: { nodes: GraphNode[]; edges: GraphEdge[]; focusEventIds: Set<string> };
  alerts: RiskAlert[];
  evidenceIndex: EvidenceIndex;
  evidenceForAlert: SearchResult[];
  indexStats: { documentCount: number; termCount: number; eventCount: number };
  aiConfigured: boolean;
  processing: ProcessingState;
  error: string | null;
  selectedAlertId: string | null;
  selectedNodeId: string | null;
  highlightedEventIds: Set<string>;
  graphFilterMode: "full" | "evidence";
  importEmrFile: (file: File) => Promise<void>;
  addVoiceNote: (transcript: string) => Promise<void>;
  completeIntakeConversation: (messages: IntakeChatMessage[]) => Promise<void>;
  submitDoctorNote: (input: DoctorNoteInput) => Promise<void>;
  selectAlert: (id: string | null) => void;
  selectNode: (id: string | null) => void;
  setGraphFilterMode: (mode: "full" | "evidence") => void;
  clearWorkspace: () => void;
  clearError: () => void;
};

const IntakeContext = createContext<IntakeContextValue | null>(null);
const emptyIndex = buildEvidenceIndex([], []);

export function IntakeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [sources, setSources] = useState<Source[]>([]);
  const [events, setEvents] = useState<HealthEvent[]>([]);
  const [contexts, setContexts] = useState<ConversationContext[]>([]);
  const [hydrated, setHydrated] = useState(false);

  const [graph, setGraph] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({
    nodes: [],
    edges: [],
  });
  const [alerts, setAlerts] = useState<RiskAlert[]>([]);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [graphFilterMode, setGraphFilterMode] = useState<"full" | "evidence">("full");
  const [processing, setProcessing] = useState<ProcessingState>({
    active: false,
    message: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [aiConfigured, setAiConfigured] = useState(false);
  const analyzeSeq = useRef(0);

  const state: IntakeState = useMemo(
    () => ({
      patient: { id: user!.id, name: user!.name, dob: user!.dob },
      sources,
      events,
      contexts,
    }),
    [user, sources, events, contexts]
  );

  useEffect(() => {
    if (!user) return;
    try {
      const raw = localStorage.getItem(workspaceKey(user.id));
      if (raw) {
        const ws = JSON.parse(raw) as {
          sources: Source[];
          events: HealthEvent[];
          contexts?: ConversationContext[];
        };
        setSources(ws.sources ?? []);
        setEvents(ws.events ?? []);
        setContexts(ws.contexts ?? []);
      } else {
        setSources([]);
        setEvents([]);
        setContexts([]);
      }
    } catch {
      setSources([]);
      setEvents([]);
      setContexts([]);
    }
    setHydrated(true);
  }, [user?.id]);

  useEffect(() => {
    if (!hydrated || !user) return;
    localStorage.setItem(
      workspaceKey(user.id),
      JSON.stringify({ sources, events, contexts })
    );
  }, [sources, events, contexts, user, hydrated]);

  useEffect(() => {
    checkAiHealth().then(({ aiConfigured: ok }) => setAiConfigured(ok));
  }, []);

  const evidenceIndex = useMemo(
    () => buildEvidenceIndex(sources, events),
    [sources, events]
  );
  const indexStats = useMemo(() => evidenceIndex.getStats(), [evidenceIndex]);

  const reanalyze = useCallback(
    async (
      evts: HealthEvent[],
      srcs: Source[],
      ctxs: ConversationContext[],
      patientName: string
    ) => {
      const seq = ++analyzeSeq.current;
      setProcessing({ active: true, message: "Building knowledge graph" });
      try {
        const graphResult = await analyzeGraph(patientName, evts, srcs, ctxs);
        if (seq !== analyzeSeq.current) return;
        setGraph({ nodes: graphResult.nodes, edges: graphResult.edges });
        setProcessing({ active: true, message: "Evaluating risk patterns" });
        const riskResult = await analyzeRisk(evts);
        if (seq !== analyzeSeq.current) return;
        setAlerts(riskResult.alerts);
        setProcessing({ active: false, message: "" });
      } catch (err) {
        if (seq !== analyzeSeq.current) return;
        setGraph(buildGraph(patientName, evts, srcs, ctxs));
        setAlerts(evaluateRiskRules(evts));
        setProcessing({ active: false, message: "" });
        setError(err instanceof Error ? err.message : "Analysis unavailable");
      }
    },
    []
  );

  useEffect(() => {
    if (!user || events.length === 0) {
      setGraph({ nodes: [], edges: [] });
      setAlerts([]);
      return;
    }
    reanalyze(events, sources, contexts, user.name);
  }, [events, sources, contexts, user, reanalyze]);

  const appendConversation = useCallback(
    (source: Source, newEvents: HealthEvent[], context: ConversationContext) => {
      setSources((prev) => [...prev, source]);
      setEvents((prev) => [...prev, ...newEvents]);
      setContexts((prev) => [...prev, context]);
    },
    []
  );

  const appendIngestion = useCallback((source: Source, newEvents: HealthEvent[]) => {
    setSources((prev) => [...prev, source]);
    setEvents((prev) => [...prev, ...newEvents]);
  }, []);

  const importEmrFileHandler = useCallback(
    async (file: File) => {
      if (!user) return;
      setError(null);
      setProcessing({ active: true, message: "Importing medical records" });
      try {
        const { source, events: imported } = await parseEmrFile(user.id, file);
        appendIngestion(source, imported);
      } catch (err) {
        setError(err instanceof Error ? err.message : "EMR import failed");
      } finally {
        setProcessing({ active: false, message: "" });
      }
    },
    [user, appendIngestion]
  );

  const addVoiceNote = useCallback(
    async (transcript: string) => {
      if (!user) return;
      const text = transcript.trim();
      if (text.length < 10) {
        setError("Provide at least a few sentences about symptoms, medications, or concerns.");
        return;
      }
      setError(null);
      setProcessing({ active: true, message: "Processing voice note" });
      try {
        const result = await extractFromText(text, "voice", user.id, user.name);
        appendIngestion(result.source, result.events);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Voice note processing failed");
      } finally {
        setProcessing({ active: false, message: "" });
      }
    },
    [user, appendIngestion]
  );

  const completeIntakeConversation = useCallback(
    async (messages: IntakeChatMessage[]) => {
      if (!user) return;
      if (!messages.some((m) => m.role === "user")) {
        setError("Share a bit more with Intake before saving.");
        return;
      }
      setError(null);
      setProcessing({ active: true, message: "Parsing conversation for graph" });
      try {
        const result = await finalizeIntakeConversation(messages, user.id, user.name);
        appendConversation(result.source, result.events, result.context);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Conversation save failed");
      } finally {
        setProcessing({ active: false, message: "" });
      }
    },
    [user, appendConversation]
  );

  const submitDoctorNote = useCallback(
    async (input: DoctorNoteInput) => {
      if (!user) return;
      if (!input.clinicianName.trim() || !input.note.trim()) {
        setError("Clinician name and note are required.");
        return;
      }
      setError(null);
      setProcessing({ active: true, message: "Processing clinician note" });
      try {
        const result = await extractFromText(
          doctorNoteToText(input),
          "doctor_note",
          user.id,
          user.name
        );
        appendIngestion(
          {
            ...result.source,
            title: `${input.clinicianName} — ${input.specialty || "Clinical note"}`,
          },
          result.events
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Note processing failed");
      } finally {
        setProcessing({ active: false, message: "" });
      }
    },
    [user, appendIngestion]
  );

  const clearWorkspace = useCallback(() => {
    analyzeSeq.current++;
    setSources([]);
    setEvents([]);
    setContexts([]);
    setGraph({ nodes: [], edges: [] });
    setAlerts([]);
    setSelectedAlertId(null);
    setSelectedNodeId(null);
    setGraphFilterMode("full");
    setError(null);
    if (user) {
      localStorage.setItem(
        workspaceKey(user.id),
        JSON.stringify({ sources: [], events: [], contexts: [] })
      );
    }
  }, [user]);

  const selectedAlert = alerts.find((a) => a.id === selectedAlertId);
  const evidenceForAlert = useMemo(() => {
    if (!selectedAlert) return [];
    return searchEvidenceForAlert(evidenceIndex, selectedAlert);
  }, [selectedAlert, evidenceIndex]);

  const displayGraph = useMemo(() => {
    if (graph.nodes.length === 0) {
      return { nodes: [], edges: [], focusEventIds: new Set<string>() };
    }
    if (graphFilterMode === "evidence" && selectedAlert) {
      return queryGraph(graph.nodes, graph.edges, { alert: selectedAlert });
    }
    if (selectedNodeId) {
      return queryGraph(graph.nodes, graph.edges, { nodeId: selectedNodeId });
    }
    return { nodes: graph.nodes, edges: graph.edges, focusEventIds: new Set<string>() };
  }, [graph, graphFilterMode, selectedAlert, selectedNodeId]);

  const highlightedEventIds = useMemo(() => {
    const ids = new Set<string>();
    selectedAlert?.evidenceEventIds.forEach((id) => ids.add(id));
    evidenceForAlert.forEach((r) => {
      if (r.document.eventId) ids.add(r.document.eventId);
    });
    graph.nodes.find((n) => n.id === selectedNodeId)?.eventIds?.forEach((id) => ids.add(id));
    displayGraph.focusEventIds.forEach((id) => ids.add(id));
    return ids;
  }, [selectedAlert, selectedNodeId, graph.nodes, evidenceForAlert, displayGraph]);

  const selectAlert = useCallback((id: string | null) => {
    setSelectedAlertId(id);
    setSelectedNodeId(null);
    if (id) setGraphFilterMode("evidence");
  }, []);

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
      </div>
    );
  }

  return (
    <IntakeContext.Provider
      value={{
        state,
        graph,
        displayGraph,
        alerts,
        evidenceIndex,
        evidenceForAlert,
        indexStats,
        aiConfigured,
        processing,
        error,
        selectedAlertId,
        selectedNodeId,
        highlightedEventIds,
        graphFilterMode,
        importEmrFile: importEmrFileHandler,
        addVoiceNote,
        completeIntakeConversation,
        submitDoctorNote,
        selectAlert,
        selectNode: setSelectedNodeId,
        setGraphFilterMode,
        clearWorkspace,
        clearError: () => setError(null),
      }}
    >
      {children}
    </IntakeContext.Provider>
  );
}

export function useIntake() {
  const ctx = useContext(IntakeContext);
  if (!ctx) throw new Error("useIntake must be used within IntakeProvider");
  return ctx;
}
