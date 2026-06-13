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
import { ProcessingIndicator } from "@/components/ui/ProcessingIndicator";
import {
  analyzeRisk,
  checkAiHealth,
  doctorNoteToText,
  extractFromText,
  finalizeIntakeConversation,
  indexWorkspaceEmbeddings,
  searchEvidenceSemantic,
} from "@/lib/api/client";
import { fuseEvidence, type SemanticHit } from "@/lib/index/semanticIndex";
import { parseEmrFile, parseEmrJson } from "@/lib/ingest/emrParser";
import { type DoctorNoteInput } from "@/lib/ingest/doctorNoteParser";
import { buildGraphFromKnowledge } from "@/lib/graph/buildGraph";
import { queryGraph, searchEvidenceForAlert } from "@/lib/graph/queryGraph";
import { buildKnowledgeFromEvents } from "@/lib/knowledge/facts";
import { buildKnowledgeRelationships } from "@/lib/knowledge/relationships";
import {
  clearRemoteWorkspace,
  loadRemoteWorkspace,
  saveRemoteKnowledge,
} from "@/lib/supabase/workspace";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  buildEvidenceIndex,
  type EvidenceIndex,
  type SearchResult,
} from "@/lib/index/evidenceIndex";
import { type IntakeChatMessage } from "@/lib/ai/intakeAgent";
import { workspaceKey } from "@/lib/auth/store";
import type {
  ConversationContext,
  EmrPayload,
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
  displayGraph: {
    nodes: GraphNode[];
    edges: GraphEdge[];
    focusEventIds: Set<string>;
  };
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
  importEmrPayload: (
    data: EmrPayload,
    sourceTitle?: string,
  ) => Promise<number>;
  addVoiceNote: (transcript: string) => Promise<void>;
  completeIntakeConversation: (messages: IntakeChatMessage[]) => Promise<void>;
  submitDoctorNote: (input: DoctorNoteInput) => Promise<boolean>;
  selectAlert: (id: string | null) => void;
  selectNode: (id: string | null) => void;
  setGraphFilterMode: (mode: "full" | "evidence") => void;
  clearWorkspace: () => void;
  clearError: () => void;
};

const IntakeContext = createContext<IntakeContextValue | null>(null);

export function IntakeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [sources, setSources] = useState<Source[]>([]);
  const [events, setEvents] = useState<HealthEvent[]>([]);
  const [contexts, setContexts] = useState<ConversationContext[]>([]);
  const [hydrated, setHydrated] = useState(false);

  const [graph, setGraph] = useState<{
    nodes: GraphNode[];
    edges: GraphEdge[];
  }>({
    nodes: [],
    edges: [],
  });
  const [alerts, setAlerts] = useState<RiskAlert[]>([]);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [graphFilterMode, setGraphFilterMode] = useState<"full" | "evidence">(
    "full",
  );
  const [processing, setProcessing] = useState<ProcessingState>({
    active: false,
    message: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [aiConfigured, setAiConfigured] = useState(false);
  const analyzeSeq = useRef(0);

  useEffect(() => {
    if (!user) return;
    let active = true;

    async function hydrateWorkspace() {
      try {
        if (isSupabaseConfigured()) {
          const remote = await loadRemoteWorkspace(user!.id);
          if (!active) return;
          setSources(remote.sources);
          setEvents(remote.events);
          setContexts([]);
          setHydrated(true);
          return;
        }

        const raw = localStorage.getItem(workspaceKey(user!.id));
        if (raw) {
          const ws = JSON.parse(raw) as {
            sources: Source[];
            events: HealthEvent[];
            contexts?: ConversationContext[];
          };
          if (!active) return;
          setSources(ws.sources ?? []);
          setEvents(ws.events ?? []);
          setContexts(ws.contexts ?? []);
        } else {
          if (!active) return;
          setSources([]);
          setEvents([]);
          setContexts([]);
        }
      } catch {
        if (!active) return;
        setSources([]);
        setEvents([]);
        setContexts([]);
      }
      setHydrated(true);
    }

    hydrateWorkspace();
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!hydrated || !user) return;
    if (isSupabaseConfigured()) return;
    localStorage.setItem(
      workspaceKey(user.id),
      JSON.stringify({ sources, events, contexts }),
    );
  }, [sources, events, contexts, user, hydrated]);

  useEffect(() => {
    checkAiHealth().then(({ aiConfigured: ok }) => setAiConfigured(ok));
  }, []);

  const evidenceIndex = useMemo(
    () => buildEvidenceIndex(sources, events),
    [sources, events],
  );
  const indexStats = useMemo(() => evidenceIndex.getStats(), [evidenceIndex]);

  const knowledge = useMemo(
    () => buildKnowledgeFromEvents(sources, events),
    [sources, events],
  );
  const relationshipResult = useMemo(
    () =>
      buildKnowledgeRelationships(
        user?.id ?? "patient",
        knowledge.entities,
        knowledge.clinicalFacts,
      ),
    [user, knowledge.entities, knowledge.clinicalFacts],
  );
  const knowledgeReviewItems = useMemo(
    () => [...knowledge.reviewItems, ...relationshipResult.reviewItems],
    [knowledge.reviewItems, relationshipResult.reviewItems],
  );

  const derivedState: IntakeState = useMemo(
    () => ({
      patient: { id: user!.id, name: user!.name, dob: user!.dob },
      sources,
      sourceChunks: knowledge.sourceChunks,
      events,
      contexts,
      candidateFacts: knowledge.candidateFacts,
      clinicalFacts: knowledge.clinicalFacts,
      entities: knowledge.entities,
      graphRelationships: relationshipResult.relationships,
      reviewItems: knowledgeReviewItems,
    }),
    [
      user,
      sources,
      events,
      contexts,
      knowledge,
      relationshipResult.relationships,
      knowledgeReviewItems,
    ],
  );

  useEffect(() => {
    if (!hydrated || !user || !isSupabaseConfigured()) return;
    if (sources.length === 0 && events.length === 0) return;
    saveRemoteKnowledge({
      userId: user.id,
      sources,
      sourceChunks: knowledge.sourceChunks,
      candidateFacts: knowledge.candidateFacts,
      clinicalFacts: knowledge.clinicalFacts,
      entities: knowledge.entities,
      graphRelationships: relationshipResult.relationships,
      reviewItems: knowledgeReviewItems,
    })
      .then(() => {
        void indexWorkspaceEmbeddings();
      });
  }, [
    hydrated,
    user,
    sources,
    events,
    knowledge,
    relationshipResult.relationships,
    knowledgeReviewItems,
  ]);

  const reanalyze = useCallback(
    async (
      evts: HealthEvent[],
      srcs: Source[],
      ctxs: ConversationContext[],
      patientName: string,
    ) => {
      const seq = ++analyzeSeq.current;
      setProcessing({ active: true, message: "Building knowledge graph" });
      try {
        const knowledgeResult = buildKnowledgeFromEvents(srcs, evts);
        const relResult = buildKnowledgeRelationships(
          evts[0]?.patientId ?? user?.id ?? "patient",
          knowledgeResult.entities,
          knowledgeResult.clinicalFacts,
        );
        if (seq !== analyzeSeq.current) return;
        setGraph(
          buildGraphFromKnowledge(
            patientName,
            srcs,
            knowledgeResult.clinicalFacts,
            knowledgeResult.entities,
            relResult.relationships,
            ctxs,
            evts,
          ),
        );
        setProcessing({ active: true, message: "Evaluating risk patterns" });
        const riskResult = await analyzeRisk(evts);
        if (seq !== analyzeSeq.current) return;
        setAlerts(riskResult.alerts);
        setProcessing({ active: false, message: "" });
      } catch (err) {
        if (seq !== analyzeSeq.current) return;
        const knowledgeResult = buildKnowledgeFromEvents(srcs, evts);
        const relResult = buildKnowledgeRelationships(
          evts[0]?.patientId ?? user?.id ?? "patient",
          knowledgeResult.entities,
          knowledgeResult.clinicalFacts,
        );
        setGraph(
          buildGraphFromKnowledge(
            patientName,
            srcs,
            knowledgeResult.clinicalFacts,
            knowledgeResult.entities,
            relResult.relationships,
            ctxs,
            evts,
          ),
        );
        setAlerts(evaluateRiskRules(evts));
        setProcessing({ active: false, message: "" });
        setError(err instanceof Error ? err.message : "Analysis unavailable");
      }
    },
    [user],
  );

  useEffect(() => {
    if (!user || events.length === 0) {
      const timer = window.setTimeout(() => {
        setGraph({ nodes: [], edges: [] });
        setAlerts([]);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => {
      void reanalyze(events, sources, contexts, user.name);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [events, sources, contexts, user, reanalyze]);

  const appendConversation = useCallback(
    (
      source: Source,
      newEvents: HealthEvent[],
      context: ConversationContext,
    ) => {
      setSources((prev) => [...prev, source]);
      setEvents((prev) => [...prev, ...newEvents]);
      setContexts((prev) => [...prev, context]);
    },
    [],
  );

  const appendIngestion = useCallback(
    (source: Source, newEvents: HealthEvent[]) => {
      setSources((prev) => [...prev, source]);
      setEvents((prev) => [...prev, ...newEvents]);
    },
    [],
  );

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
    [user, appendIngestion],
  );

  const importEmrPayload = useCallback(
    async (data: EmrPayload, sourceTitle?: string): Promise<number> => {
      if (!user) return 0;
      setError(null);
      setProcessing({ active: true, message: "Syncing connected records" });
      try {
        const { source, events: imported } = parseEmrJson(user.id, data);
        if (imported.length === 0) {
          setError("No records were returned from the connected provider.");
          return 0;
        }
        appendIngestion(
          sourceTitle ? { ...source, title: sourceTitle } : source,
          imported,
        );
        return imported.length;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Record sync failed");
        return 0;
      } finally {
        setProcessing({ active: false, message: "" });
      }
    },
    [user, appendIngestion],
  );

  const addVoiceNote = useCallback(
    async (transcript: string) => {
      if (!user) return;
      const text = transcript.trim();
      if (text.length < 10) {
        setError(
          "Provide at least a few sentences about symptoms, medications, or concerns.",
        );
        return;
      }
      setError(null);
      setProcessing({ active: true, message: "Processing voice note" });
      try {
        const result = await extractFromText(text, "voice", user.id, user.name);
        appendIngestion(result.source, result.events);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Voice note processing failed",
        );
      } finally {
        setProcessing({ active: false, message: "" });
      }
    },
    [user, appendIngestion],
  );

  const completeIntakeConversation = useCallback(
    async (messages: IntakeChatMessage[]) => {
      if (!user) return;
      if (!messages.some((m) => m.role === "user")) {
        setError("Share a bit more with Intake before saving.");
        return;
      }
      setError(null);
      setProcessing({
        active: true,
        message: "Parsing conversation for graph",
      });
      try {
        const result = await finalizeIntakeConversation(
          messages,
          user.id,
          user.name,
        );
        appendConversation(result.source, result.events, result.context);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Conversation save failed",
        );
      } finally {
        setProcessing({ active: false, message: "" });
      }
    },
    [user, appendConversation],
  );

  const submitDoctorNote = useCallback(
    async (input: DoctorNoteInput): Promise<boolean> => {
      if (!user) return false;
      if (!input.clinicianName.trim() || !input.note.trim()) {
        setError("Clinician name and note are required.");
        return false;
      }
      setError(null);
      setProcessing({ active: true, message: "Processing clinician note" });
      try {
        const result = await extractFromText(
          doctorNoteToText(input),
          "doctor_note",
          user.id,
          user.name,
        );
        appendIngestion(
          {
            ...result.source,
            title: `${input.clinicianName} — ${input.specialty || "Clinical note"}`,
          },
          result.events,
        );
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Note processing failed");
        return false;
      } finally {
        setProcessing({ active: false, message: "" });
      }
    },
    [user, appendIngestion],
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
        JSON.stringify({ sources: [], events: [], contexts: [] }),
      );
      clearRemoteWorkspace(user.id);
    }
  }, [user]);

  const selectedAlert = alerts.find((a) => a.id === selectedAlertId);

  // Lexical (BM25) evidence — always available, synchronous, zero-dependency.
  const lexicalEvidence = useMemo(() => {
    if (!selectedAlert) return [];
    return searchEvidenceForAlert(evidenceIndex, selectedAlert);
  }, [selectedAlert, evidenceIndex]);

  // Semantic layer: query embedding + cosine-kNN run server-side in a Supabase
  // Edge Function (gte-small + pgvector), then fused with the lexical results
  // via RRF. The DB returns matches as fact/chunk references, which we map back
  // onto the in-memory evidence documents so RRF fuses on shared ids. Degrades
  // gracefully to lexical-only whenever the edge/model is unavailable.
  const semanticDisabledRef = useRef(false);
  // Fused (hybrid) results live in state and are stamped with the alert id +
  // evidence-index identity they were computed against, so a stale fetch never
  // leaks into a different alert or a rebuilt index.
  const [hybridEvidence, setHybridEvidence] = useState<{
    alertId: string;
    index: EvidenceIndex;
    results: SearchResult[];
  } | null>(null);

  useEffect(() => {
    if (!selectedAlert) return;
    if (!isSupabaseConfigured() || semanticDisabledRef.current) return;
    if (
      hybridEvidence &&
      hybridEvidence.alertId === selectedAlert.id &&
      hybridEvidence.index === evidenceIndex
    ) {
      return; // already have fresh fused results for this alert + index
    }

    let cancelled = false;
    const alert = selectedAlert;
    (async () => {
      const query = [
        alert.title,
        alert.explanation,
        ...alert.suggestedQuestions,
      ].join(" ");
      const rows = await searchEvidenceSemantic(query, 12);
      if (cancelled) return;
      if (!rows) {
        semanticDisabledRef.current = true; // edge/model unavailable — stay lexical
        return;
      }

      // Map DB rows (fact event_id / chunk source_id) to client evidence docs.
      const docs = evidenceIndex.getAllDocuments();
      const byEvent = new Map<string, (typeof docs)[number]>();
      const bySource = new Map<string, (typeof docs)[number]>();
      for (const d of docs) {
        if (d.eventId) byEvent.set(d.eventId, d);
        if (d.id.startsWith("doc_src") && !bySource.has(d.sourceId)) {
          bySource.set(d.sourceId, d);
        }
      }
      const semanticHits: SemanticHit[] = [];
      for (const r of rows) {
        const doc =
          r.ref_type === "fact" ? byEvent.get(r.ref_id) : bySource.get(r.source_id);
        if (doc) semanticHits.push({ id: doc.id, score: r.score, document: doc });
      }

      const fused = fuseEvidence(lexicalEvidence, semanticHits, 8);
      if (cancelled) return;
      setHybridEvidence({ alertId: alert.id, index: evidenceIndex, results: fused });
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedAlert, lexicalEvidence, evidenceIndex, hybridEvidence]);

  // Prefer fused (hybrid) results for the current alert when available for the
  // current evidence index; otherwise fall back to lexical. Synchronous and
  // dependency-free, with semantics as a progressive enhancement.
  const evidenceForAlert = useMemo<SearchResult[]>(() => {
    if (!selectedAlert) return [];
    if (
      hybridEvidence &&
      hybridEvidence.alertId === selectedAlert.id &&
      hybridEvidence.index === evidenceIndex
    ) {
      return hybridEvidence.results;
    }
    return lexicalEvidence;
  }, [selectedAlert, hybridEvidence, lexicalEvidence, evidenceIndex]);

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
    return {
      nodes: graph.nodes,
      edges: graph.edges,
      focusEventIds: new Set<string>(),
    };
  }, [graph, graphFilterMode, selectedAlert, selectedNodeId]);

  const highlightedEventIds = useMemo(() => {
    const ids = new Set<string>();
    selectedAlert?.evidenceEventIds.forEach((id) => ids.add(id));
    evidenceForAlert.forEach((r) => {
      if (r.document.eventId) ids.add(r.document.eventId);
    });
    graph.nodes
      .find((n) => n.id === selectedNodeId)
      ?.eventIds?.forEach((id) => ids.add(id));
    displayGraph.focusEventIds.forEach((id) => ids.add(id));
    return ids;
  }, [
    selectedAlert,
    selectedNodeId,
    graph.nodes,
    evidenceForAlert,
    displayGraph,
  ]);

  const selectAlert = useCallback((id: string | null) => {
    setSelectedAlertId(id);
    setSelectedNodeId(null);
    if (id) setGraphFilterMode("evidence");
  }, []);

  if (!hydrated) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-paper">
        <ProcessingIndicator size="md" label="Loading workspace" />
        <p className="text-xs text-ink-faint">Loading workspace</p>
      </div>
    );
  }

  return (
    <IntakeContext.Provider
      value={{
        state: derivedState,
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
        importEmrPayload,
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
