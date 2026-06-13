import type { HealthEvent, Source } from "@/lib/schema";
import { sourceTypeLabel } from "@/lib/utils";

export type EvidenceDocument = {
  id: string;
  sourceId: string;
  eventId?: string;
  sourceType: string;
  title: string;
  text: string;
  tokens: string[];
  observedAt?: string;
};

export type SearchResult = {
  document: EvidenceDocument;
  score: number;
  matchedTerms: string[];
};

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "has", "have", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "this", "that", "these", "those", "it", "its",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s.%/-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

function eventToText(event: HealthEvent): string {
  const parts = [event.type, event.label];
  if (event.value !== undefined) parts.push(String(event.value));
  if (event.unit) parts.push(event.unit);
  if (event.status) parts.push(event.status);
  if (event.metadata) {
    parts.push(JSON.stringify(event.metadata));
  }
  return parts.join(" ");
}

export class EvidenceIndex {
  private documents: EvidenceDocument[] = [];
  private invertedIndex = new Map<string, Set<number>>();
  private avgDocLength = 0;

  rebuild(sources: Source[], events: HealthEvent[]): void {
    this.documents = [];
    this.invertedIndex.clear();

    for (const source of sources) {
      if (source.rawText) {
        this.addDocument({
          id: `doc_src_${source.id}`,
          sourceId: source.id,
          sourceType: source.type,
          title: source.title,
          text: source.rawText,
          observedAt: source.capturedAt,
        });
      } else {
        this.addDocument({
          id: `doc_src_meta_${source.id}`,
          sourceId: source.id,
          sourceType: source.type,
          title: source.title,
          text: `${source.title} ${sourceTypeLabel(source.type)}`,
          observedAt: source.capturedAt,
        });
      }
    }

    for (const event of events) {
      const text = eventToText(event);
      this.addDocument({
        id: `doc_evt_${event.id}`,
        sourceId: event.sourceId,
        eventId: event.id,
        sourceType: "event",
        title: event.label,
        text,
        observedAt: event.observedAt,
      });
    }

    const totalLen = this.documents.reduce((s, d) => s + d.tokens.length, 0);
    this.avgDocLength = this.documents.length > 0 ? totalLen / this.documents.length : 1;
  }

  private addDocument(doc: Omit<EvidenceDocument, "tokens">): void {
    const tokens = tokenize(`${doc.title} ${doc.text}`);
    const idx = this.documents.length;
    const full: EvidenceDocument = { ...doc, tokens };
    this.documents.push(full);

    const uniqueTokens = new Set(tokens);
    for (const token of uniqueTokens) {
      if (!this.invertedIndex.has(token)) {
        this.invertedIndex.set(token, new Set());
      }
      this.invertedIndex.get(token)!.add(idx);
    }
  }

  search(query: string, limit = 8): SearchResult[] {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0 || this.documents.length === 0) return [];

    const scores = new Map<number, { score: number; matched: Set<string> }>();
    const N = this.documents.length;

    for (const term of queryTokens) {
      const postings = this.invertedIndex.get(term);
      if (!postings) continue;

      const df = postings.size;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));

      for (const docIdx of postings) {
        const doc = this.documents[docIdx];
        const tf = doc.tokens.filter((t) => t === term).length;
        const tfNorm = tf / (tf + 0.5 + 1.5 * (doc.tokens.length / this.avgDocLength));
        const contribution = idf * tfNorm;

        const entry = scores.get(docIdx) ?? { score: 0, matched: new Set<string>() };
        entry.score += contribution;
        entry.matched.add(term);
        scores.set(docIdx, entry);
      }
    }

    return Array.from(scores.entries())
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, limit)
      .map(([idx, { score, matched }]) => ({
        document: this.documents[idx],
        score,
        matchedTerms: Array.from(matched),
      }));
  }

  getByEventIds(eventIds: string[]): EvidenceDocument[] {
    const idSet = new Set(eventIds);
    return this.documents.filter((d) => d.eventId && idSet.has(d.eventId));
  }

  getDocumentsForSource(sourceId: string): EvidenceDocument[] {
    return this.documents.filter((d) => d.sourceId === sourceId);
  }

  getAllDocuments(): EvidenceDocument[] {
    return [...this.documents];
  }

  getStats(): { documentCount: number; termCount: number; eventCount: number } {
    return {
      documentCount: this.documents.length,
      termCount: this.invertedIndex.size,
      eventCount: this.documents.filter((d) => d.eventId).length,
    };
  }
}

export function buildEvidenceIndex(sources: Source[], events: HealthEvent[]): EvidenceIndex {
  const index = new EvidenceIndex();
  index.rebuild(sources, events);
  return index;
}
