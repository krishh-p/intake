# Intake

Patient-owned health intelligence workspace that turns fragmented medical records, clinician notes, and patient-reported context into a traceable knowledge graph.

[Live demo](https://intake-nine-chi.vercel.app/)

## What it does

Intake helps patients organize longitudinal health information and ask grounded questions about it. The application:

1. Imports JSON EMR exports, clinician notes, and voice or chat intake.
2. Extracts structured facts and resolves duplicate clinical entities.
3. Builds an ontology-grounded graph with source provenance and confidence gates.
4. Surfaces timelines, risk alerts, trends, specialty reports, and citation-backed answers.

## Technical highlights

- **Knowledge graph:** 12 node types and 13 validated relationship types with entity resolution, provenance edges, and corroboration-based confidence scoring.
- **Agentic workflows:** Grok-powered question-answering and trend agents use 11 tools for evidence retrieval, graph traversal, deterministic calculations, and structured final responses.
- **Grounded answers:** Inline citations resolve back to source events and graph nodes; low-confidence facts are rejected or flagged for review.
- **Retrieval:** BM25 lexical search with optional 384-dimensional embedding search and reciprocal-rank fusion through Supabase.
- **Clinical rules:** Ontology-backed medication, contraindication, interaction, laboratory, and trend rules complement model-generated analysis.
- **Quality:** 27 Vitest cases cover graph construction, entity merging, confidence scoring, provenance, and retrieval fusion.

## Stack

- **Application:** Next.js 16, React 19, TypeScript, Tailwind CSS
- **AI:** xAI Grok chat, Responses, tool-calling, and realtime voice APIs
- **Data:** local-first browser storage with optional Supabase Postgres and Edge Functions
- **Testing:** Vitest

## Architecture

```text
EMR export / clinician note / voice intake
                    |
                    v
       parsing and AI fact extraction
                    |
                    v
 ontology grounding + entity resolution
                    |
                    v
 provenance-aware health knowledge graph
                    |
          +---------+---------+
          |                   |
          v                   v
 risk and trend rules   Grok tool-calling agents
          |                   |
          +---------+---------+
                    v
 timeline, graph, reports, and cited answers
```

## Local setup

Requires Node.js 20 or newer.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

AI features require an `.env.local` file:

```bash
XAI_API_KEY=your_xai_api_key
XAI_MODEL=grok-3-fast
XAI_TOOL_MODEL=grok-3-fast
XAI_VOICE_MODEL=grok-voice-latest
```

Supabase-backed persistence and semantic retrieval are optional:

```bash
NEXT_PUBLIC_SUPABASE_URL=your_project_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_publishable_key
```

Without Supabase, account data persists locally in the browser.

## Commands

```bash
npm run dev
npm run test
npm run lint
npm run build
```

## EMR import format

Upload JSON containing any supported collection:

```json
{
  "conditions": [{ "label": "...", "onset": "2024-01-01", "status": "active" }],
  "medications": [{ "label": "...", "dose": "...", "start": "2024-01-01" }],
  "labs": [{ "label": "...", "value": 5.2, "unit": "...", "date": "2024-01-01" }],
  "vitals": [{ "label": "Blood pressure", "value": "120/80", "date": "2024-01-01" }],
  "encounters": [{ "label": "...", "clinician": "...", "date": "2024-01-01" }],
  "careTasks": [{ "label": "...", "due": "2024-01-01" }]
}
```

## Important limitations

Intake is an educational prototype, not a medical device. It does not diagnose conditions or replace professional medical advice. The portal connector included in the repository is a mock integration; EMR ingestion currently uses uploaded JSON exports.
