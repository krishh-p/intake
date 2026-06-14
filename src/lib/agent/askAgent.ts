import { buildAskTools } from "@/lib/agent/askTools";
import {
  extractResponsesText,
  grokResponsesCreate,
  toResponsesTools,
} from "@/lib/ai/xai";
import { buildGraphFromKnowledge } from "@/lib/graph/buildGraph";
import { buildEvidenceIndex } from "@/lib/index/evidenceIndex";
import { buildKnowledgeFromEvents } from "@/lib/knowledge/facts";
import { buildKnowledgeRelationships } from "@/lib/knowledge/relationships";
import type {
  AgentStep,
  AskAnswer,
  AskCitation,
  GraphNode,
  HealthEvent,
  Source,
} from "@/lib/schema";
import { generateId } from "@/lib/utils";

const ASK_AGENT_SYSTEM = `You are Intake's health companion. The patient asks a question about their own health, and you answer it using ONLY their personal knowledge graph and records.

How to work:
- Start by searching the knowledge graph (search_graph) and exploring relevant nodes (get_node) to gather the patient's conditions, medications, labs, and symptoms.
- To explain WHY something is happening or how things connect, use explain_relationships — it surfaces risk factors, worsening trends, drug interactions, and possible links with rationale.
- Use compute_trend / query_events / search_evidence / get_risk_alerts for quantitative grounding.
- Investigate before answering, but be decisive: once you have enough evidence to answer (usually after 2-4 rounds of tool calls), STOP searching and call submit_answer. Do not keep exploring redundant angles.

Hard rules:
- NEVER invent facts, numbers, medications, or diagnoses. Everything must come from tool results.
- Ground EVERY clinical claim in a citation referencing a real nodeId or eventId returned by a tool.
- The citations array MUST contain exactly one entry for every inline marker you use, in order: [1] -> citations[0], [2] -> citations[1], and so on. Do not skip numbers and do not reuse a number for two different facts. If you reference [4], there must be at least 4 citations.
- Write a clear, warm, plain-English answer for the patient. Reference citations inline as [1], [2], … in the same order as the citations array.
- You are not a doctor and must not give a diagnosis or prescribe. Explain what the patient's own data shows and suggest discussing specifics with their clinician.
- If the data cannot answer the question, say so honestly and cite what you do know.
- ALWAYS deliver your final answer by calling submit_answer exactly once. NEVER write the final answer as plain text — if you write prose instead of calling submit_answer, the patient sees nothing.`;

function parseToolArgs(raw?: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

type RawCitation = { nodeId?: string; eventId?: string; note?: string };

function resolveCitations(
  raw: RawCitation[],
  nodes: GraphNode[],
  events: HealthEvent[]
): AskCitation[] {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const eventById = new Map(events.map((e) => [e.id, e]));
  const nodeByEventId = new Map<string, GraphNode>();
  for (const n of nodes) {
    for (const eid of n.eventIds ?? []) {
      if (!nodeByEventId.has(eid)) nodeByEventId.set(eid, n);
    }
  }

  // Keep a strict 1:1, order-preserving mapping with the model's citations
  // array so inline [n] markers always resolve to citations[n-1]. Dropping or
  // deduping entries here would shift every later marker.
  return raw.map((c) => {
    let label = "";
    let kind: string | undefined;
    let nodeId: string | undefined;
    let eventId: string | undefined;

    const node = c.nodeId ? nodeById.get(c.nodeId) : undefined;
    const event = c.eventId ? eventById.get(c.eventId) : undefined;

    if (node) {
      nodeId = node.id;
      kind = node.kind;
      label = node.label;
    }
    if (event) {
      eventId = event.id;
      const valuePart =
        event.value !== undefined
          ? ` ${event.value}${event.unit ? ` ${event.unit}` : ""}`
          : "";
      const date = new Date(event.observedAt);
      const datePart = Number.isNaN(date.getTime())
        ? ""
        : ` · ${date.toLocaleDateString(undefined, { month: "short", year: "numeric" })}`;
      label = `${event.label}${valuePart}${datePart}`;
      kind = kind ?? event.type;
      if (!nodeId) nodeId = nodeByEventId.get(event.id)?.id;
    }

    if (!label) label = c.note?.trim() || "Supporting record";

    return {
      id: generateId("cite"),
      label,
      kind,
      nodeId,
      eventId,
      detail: c.note?.trim() || undefined,
    };
  });
}

export type AskHistoryMessage = { role: "user" | "assistant"; content: string };

export async function runAskAgent(input: {
  patientName: string;
  question: string;
  events: HealthEvent[];
  sources: Source[];
  history?: AskHistoryMessage[];
  onStep?: (step: AgentStep) => void;
  signal?: AbortSignal;
}): Promise<AskAnswer> {
  const { patientName, question, events, sources } = input;

  // Rebuild the knowledge graph server-side from the patient's events + sources
  // so the agent reasons over the exact same graph the UI renders.
  const index = buildEvidenceIndex(sources, events);
  const knowledge = buildKnowledgeFromEvents(sources, events);
  const rel = buildKnowledgeRelationships(
    events[0]?.patientId ?? "patient",
    knowledge.entities,
    knowledge.clinicalFacts
  );
  const { nodes, edges } = buildGraphFromKnowledge(
    patientName,
    sources,
    knowledge.clinicalFacts,
    knowledge.entities,
    rel.relationships,
    [],
    events
  );

  const { schemas, executors } = buildAskTools({
    events,
    sources,
    index,
    nodes,
    edges,
    entities: knowledge.entities,
    clinicalFacts: knowledge.clinicalFacts,
    relationships: rel.relationships,
  });
  const tools = toResponsesTools(schemas, { webSearch: false });

  const history = (input.history ?? [])
    .filter(
      (m) =>
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim(),
    )
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content }));

  const initialInput = [
    { role: "system" as const, content: ASK_AGENT_SYSTEM },
    ...history,
    {
      role: "user" as const,
      content: `Patient: ${patientName}. Today is ${new Date().toISOString()}.\n\nQuestion: ${question}`,
    },
  ];

  const maxSteps = 14;
  let previousResponseId: string | undefined;
  let nextInput:
    | typeof initialInput
    | Array<{ type: "function_call_output"; call_id: string; output: string }> =
    initialInput;
  const emittedKeys = new Set<string>();

  const emitStep = (tool: string, args: Record<string, unknown>, key: string) => {
    if (emittedKeys.has(key)) return;
    emittedKeys.add(key);
    input.onStep?.({ tool, args });
  };

  // Most recent assistant prose, in case the model writes its answer as text
  // instead of calling submit_answer.
  let lastAssistantText = "";

  // Force a final submit_answer via tool_choice. Returns the structured answer
  // when the model complies, else null (capturing any prose it produced).
  const forceSubmit = async (instruction: string): Promise<AskAnswer | null> => {
    if (input.signal?.aborted) return null;
    try {
      const forced = await grokResponsesCreate(
        [{ role: "user" as const, content: instruction }],
        tools,
        {
          previousResponseId,
          maxTurns: 2,
          signal: input.signal,
          toolChoice: { type: "function", name: "submit_answer" },
        },
      );
      if (forced.id) previousResponseId = forced.id;
      const submit = forced.output.find(
        (item) => item.type === "function_call" && item.name === "submit_answer",
      );
      if (submit) {
        input.onStep?.({
          tool: "submit_answer",
          args: parseToolArgs(submit.arguments),
        });
        return buildAnswer(question, parseToolArgs(submit.arguments), nodes, events);
      }
      const text = extractResponsesText(forced);
      if (text) lastAssistantText = text;
    } catch {
      // fall through
    }
    return null;
  };

  const proseAnswer = (): AskAnswer => ({
    question,
    answer: lastAssistantText,
    citations: [],
    followUps: [],
    method: "agent",
    generatedAt: new Date().toISOString(),
  });

  for (let step = 0; step < maxSteps; step++) {
    if (input.signal?.aborted) break;
    emitStep("agent_turn", { turn: step + 1 }, `turn-${step + 1}`);

    const response = await grokResponsesCreate(nextInput, tools, {
      previousResponseId,
      maxTurns: 6,
      signal: input.signal,
      onStreamEvent: (event) => {
        if (
          event.type === "response.function_call_arguments.done" &&
          event.name
        ) {
          emitStep(
            event.name,
            parseToolArgs(event.arguments),
            `fn-${event.call_id ?? event.name}`
          );
        }
      },
    });
    previousResponseId = response.id;

    const text = extractResponsesText(response);
    if (text) lastAssistantText = text;

    const functionCalls = response.output.filter(
      (item) => item.type === "function_call"
    );

    if (!functionCalls.length) {
      // The model answered in prose instead of calling submit_answer. Force the
      // tool so we get structured citations; if it still won't, surface the
      // prose rather than the canned fallback.
      const forced = await forceSubmit(
        "Provide your final answer now by calling submit_answer, with citations referencing the nodeIds/eventIds from the tool results above.",
      );
      if (forced) return forced;
      if (lastAssistantText) return proseAnswer();
      break;
    }

    const toolOutputs: Array<{
      type: "function_call_output";
      call_id: string;
      output: string;
    }> = [];

    for (const call of functionCalls) {
      const name = call.name ?? "";
      const args = parseToolArgs(call.arguments);
      emitStep(name, args, `fn-${call.call_id ?? name}`);

      if (name === "submit_answer") {
        return buildAnswer(question, args, nodes, events);
      }

      const executor = executors[name];
      const result = executor ? executor(args) : { error: `Unknown tool: ${name}` };
      toolOutputs.push({
        type: "function_call_output",
        call_id: call.call_id ?? "",
        output: JSON.stringify(result),
      });
    }

    nextInput = toolOutputs;
  }

  // Out of investigation steps — force one final structured answer, then fall
  // back to any prose, and only then to the canned message.
  const forced = await forceSubmit(
    "You are out of investigation steps. Call submit_answer now with your best answer, grounded only in the evidence you have already gathered, with citations.",
  );
  if (forced) return forced;
  if (lastAssistantText) return proseAnswer();

  return {
    question,
    answer:
      "I wasn't able to complete an analysis of your records for that question. Try rephrasing or importing more data.",
    citations: [],
    followUps: [],
    method: "fallback",
    generatedAt: new Date().toISOString(),
  };
}

function buildAnswer(
  question: string,
  args: Record<string, unknown>,
  nodes: GraphNode[],
  events: HealthEvent[],
): AskAnswer {
  const answer = String(args.answer ?? "").trim();
  const citations = resolveCitations(
    Array.isArray(args.citations) ? (args.citations as RawCitation[]) : [],
    nodes,
    events,
  );
  const followUps = Array.isArray(args.followUps)
    ? (args.followUps as unknown[])
        .filter((f): f is string => typeof f === "string")
        .slice(0, 3)
    : [];
  return {
    question,
    answer: answer || "I couldn't find enough in your records to answer that.",
    citations,
    followUps,
    method: "agent",
    generatedAt: new Date().toISOString(),
  };
}
