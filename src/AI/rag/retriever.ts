const DEFAULT_MAX_CHUNK_CHARS = 320;
const DEFAULT_CHUNK_OVERLAP = 48;
const DEFAULT_RETRIEVAL_LIMIT = 3;

export interface RagChunk {
  id: string;
  text: string;
  score: number;
}

export interface RagRetrieveOptions {
  query: string;
  documentText: string;
  topK?: number;
  threshold?: number;
}

const normalizeWhitespace = (input: string): string => {
  return String(input ?? '').replace(/\r/g, '').replace(/\t/g, ' ').replace(/\u3000/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
};

const tokenize = (input: string): string[] => {
  const normalized = normalizeWhitespace(input).toLowerCase();
  const wordTokens = normalized.match(/[a-z0-9_\-\u4e00-\u9fa5]{2,}/g) ?? [];
  return Array.from(new Set(wordTokens));
};

const splitIntoParagraphs = (documentText: string): string[] => {
  const normalized = normalizeWhitespace(documentText);
  if (!normalized) return [];
  return normalized
    .split(/\n\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
};

const chunkParagraph = (text: string, maxChunkChars: number, overlap: number): string[] => {
  if (text.length <= maxChunkChars) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(text.length, start + maxChunkChars);
    chunks.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks.filter(Boolean);
};

const scoreChunk = (queryTokens: string[], chunkText: string): number => {
  if (!queryTokens.length) return 0;
  const haystack = chunkText.toLowerCase();
  let hitCount = 0;
  let weighted = 0;
  for (const token of queryTokens) {
    if (!haystack.includes(token)) continue;
    hitCount += 1;
    weighted += token.length >= 4 ? 1.2 : 1;
  }
  if (!hitCount) return 0;
  const coverage = hitCount / queryTokens.length;
  const density = Math.min(1, weighted / Math.max(1, chunkText.length / 40));
  return Number((coverage * 0.8 + density * 0.2).toFixed(4));
};

export const retrieveRelevantChunks = (options: RagRetrieveOptions): RagChunk[] => {
  const query = String(options.query ?? '').trim();
  const documentText = String(options.documentText ?? '').trim();
  if (!query || !documentText) return [];

  const queryTokens = tokenize(query);
  if (!queryTokens.length) return [];

  const threshold = typeof options.threshold === 'number' && Number.isFinite(options.threshold)
    ? Math.max(0, Math.min(1, options.threshold))
    : 0.6;
  const topK = typeof options.topK === 'number' && Number.isFinite(options.topK)
    ? Math.max(1, Math.min(8, Math.floor(options.topK)))
    : DEFAULT_RETRIEVAL_LIMIT;

  const paragraphs = splitIntoParagraphs(documentText);
  const chunks = paragraphs.flatMap((paragraph, paragraphIndex) => {
    return chunkParagraph(paragraph, DEFAULT_MAX_CHUNK_CHARS, DEFAULT_CHUNK_OVERLAP).map((text, chunkIndex) => ({
      id: `p${paragraphIndex}_c${chunkIndex}`,
      text,
      score: scoreChunk(queryTokens, text),
    }));
  });

  return chunks
    .filter((chunk) => chunk.score >= threshold)
    .sort((left, right) => right.score - left.score)
    .slice(0, topK);
};