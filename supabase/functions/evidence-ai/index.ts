// Evidence AI Edge Function.
//
// Runs Supabase's built-in `gte-small` embedding model (384-dim, English,
// L2-normalized) entirely inside the Edge runtime — no external API, no model
// download, no Vercel cold start. Two actions:
//
//   action: "search"  -> embed the query + cosine-kNN over the caller's rows
//                        via the match_evidence RPC. One round trip on the hot
//                        path. Returns ranked { ref_type, ref_id, source_id,
//                        label, score } rows.
//
//   action: "index"   -> backfill embeddings for the caller's clinical_facts /
//                        source_chunks rows that don't have one yet. Idempotent
//                        (filters on embedding IS NULL); run off the hot path.
//
// All DB access flows through the caller's JWT, so Row Level Security scopes
// every read/write to that user.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const session = new Supabase.ai.Session("gte-small");

const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function embed(text: string): Promise<number[]> {
  const out = await session.run(text, { mean_pool: true, normalize: true });
  return Array.from(out as ArrayLike<number>);
}

function factText(f: Record<string, unknown>): string {
  const parts: string[] = [];
  if (f.label) parts.push(String(f.label));
  if (f.normalized_label) parts.push(String(f.normalized_label));
  if (f.value !== null && f.value !== undefined) parts.push(String(f.value));
  if (f.unit) parts.push(String(f.unit));
  if (f.evidence_quote) parts.push(String(f.evidence_quote));
  return parts.join(" ").slice(0, 1800);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing authorization" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    },
  );

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // empty / invalid body -> treated as default search with no query
  }
  const action = String(body.action ?? "search");

  if (action === "index") {
    let facts = 0;
    let chunks = 0;

    const { data: factRows } = await supabase
      .from("clinical_facts")
      .select("id,label,normalized_label,value,unit,evidence_quote")
      .is("embedding", null)
      .limit(1000);
    for (const f of factRows ?? []) {
      const vector = await embed(factText(f as Record<string, unknown>));
      const { error } = await supabase
        .from("clinical_facts")
        .update({ embedding: vector })
        .eq("id", (f as { id: string }).id);
      if (!error) facts++;
    }

    const { data: chunkRows } = await supabase
      .from("source_chunks")
      .select("id,text")
      .is("embedding", null)
      .limit(1000);
    for (const c of chunkRows ?? []) {
      const text = String((c as { text?: string }).text ?? "").slice(0, 1800);
      if (!text) continue;
      const vector = await embed(text);
      const { error } = await supabase
        .from("source_chunks")
        .update({ embedding: vector })
        .eq("id", (c as { id: string }).id);
      if (!error) chunks++;
    }

    return json({ indexed: { facts, chunks } });
  }

  // default action: semantic search
  const query = String(body.query ?? "").trim().slice(0, 2000);
  if (!query) return json({ results: [] });
  const matchCount = Math.min(Math.max(Number(body.match_count ?? 12), 1), 50);
  const threshold = Number.isFinite(Number(body.threshold))
    ? Number(body.threshold)
    : 0.25;

  const queryEmbedding = await embed(query);
  const { data, error } = await supabase.rpc("match_evidence", {
    query_embedding: queryEmbedding,
    match_count: matchCount,
    similarity_threshold: threshold,
  });
  if (error) return json({ error: error.message }, 500);
  return json({ results: data ?? [] });
});
