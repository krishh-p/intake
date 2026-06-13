import type { Source, SourceChunk } from "@/lib/schema";
import { stableId } from "@/lib/utils";

const MAX_CHUNK_LENGTH = 1200;

export function chunkSource(source: Source): SourceChunk[] {
  const text = source.rawText?.trim();
  if (!text) return [];

  const chunks: SourceChunk[] = [];
  let start = 0;
  let ordinal = 0;

  while (start < text.length) {
    const targetEnd = Math.min(start + MAX_CHUNK_LENGTH, text.length);
    const paragraphBreak = text.lastIndexOf("\n\n", targetEnd);
    const sentenceBreak = text.lastIndexOf(". ", targetEnd);
    const end =
      targetEnd === text.length
        ? targetEnd
        : paragraphBreak > start + 300
          ? paragraphBreak
          : sentenceBreak > start + 300
            ? sentenceBreak + 1
            : targetEnd;
    const chunkText = text.slice(start, end).trim();

    if (chunkText) {
      chunks.push({
        id: stableId("chunk", `${source.id}:${ordinal}:${start}:${end}`),
        sourceId: source.id,
        text: chunkText,
        startOffset: start,
        endOffset: end,
        ordinal,
      });
      ordinal++;
    }

    start = Math.max(end, start + 1);
  }

  return chunks;
}
