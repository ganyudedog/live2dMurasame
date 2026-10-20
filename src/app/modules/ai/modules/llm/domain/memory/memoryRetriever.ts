interface MemoryEntry {
  text: string;
  importance: number;
  confidence: number;
  mentions: number;
  lastSeen: string;
  expiresAt: string | null;
}

const TOKEN_PATTERN = /[a-z0-9_]+/giu;
const CJK_PATTERN = /[\u3400-\u9fff]/u;

const tokenize = (value: string): string[] => {
  const text = String(value ?? '').toLowerCase();
  const tokens: string[] = text.match(TOKEN_PATTERN) ?? [];
  const cjk: string[] = [...text].filter((char) => CJK_PATTERN.test(char));
  for (let index = 0; index < cjk.length - 1; index += 1) tokens.push(`${cjk[index]}${cjk[index + 1]}`);
  if (cjk.length === 1) tokens.push(cjk[0]);
  return tokens;
};

const metadata = (raw: string): Partial<MemoryEntry> => {
  const fields: Record<string, string> = {};
  raw.split(';').forEach((field) => {
    const index = field.indexOf('=');
    if (index <= 0) return;
    fields[field.slice(0, index).trim()] = field.slice(index + 1).trim();
  });
  const number = (key: string, fallback: number): number => {
    const value = Number(fields[key]);
    return Number.isFinite(value) ? value : fallback;
  };
  return {
    importance: number('importance', 0.6),
    confidence: number('confidence', 0.8),
    mentions: number('mentions', 1),
    lastSeen: fields.last_seen ?? '',
    expiresAt: fields.expires && fields.expires !== 'never' ? fields.expires : null,
  };
};

const parseEntries = (coreText: string): MemoryEntry[] => {
  const lines = String(coreText ?? '').split(/\r?\n/);
  const entries: MemoryEntry[] = [];
  let pendingMetadata: Partial<MemoryEntry> | null = null;
  for (const line of lines) {
    const comment = line.match(/^\s*<!--\s*([^>]+?)\s*-->\s*$/u);
    if (comment) {
      pendingMetadata = metadata(comment[1]);
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.+?)\s*$/u);
    if (!bullet) continue;
    entries.push({
      text: bullet[1], importance: pendingMetadata?.importance ?? 0.6,
      confidence: pendingMetadata?.confidence ?? 0.8, mentions: pendingMetadata?.mentions ?? 1,
      lastSeen: pendingMetadata?.lastSeen ?? '', expiresAt: pendingMetadata?.expiresAt ?? null,
    });
    pendingMetadata = null;
  }
  return entries;
};

const bm25 = (query: string, documents: string[]): number[] => {
  const queryTokens = [...new Set(tokenize(query))];
  const tokenized = documents.map(tokenize);
  const documentFrequency = new Map<string, number>();
  tokenized.forEach((tokens) => new Set(tokens).forEach((token) => documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1)));
  const averageLength = tokenized.reduce((total, tokens) => total + tokens.length, 0) / Math.max(1, tokenized.length);
  const k1 = 1.2;
  const b = 0.75;
  return tokenized.map((tokens) => {
    const frequencies = new Map<string, number>();
    tokens.forEach((token) => frequencies.set(token, (frequencies.get(token) ?? 0) + 1));
    return queryTokens.reduce((total, token) => {
      const frequency = frequencies.get(token) ?? 0;
      if (!frequency) return total;
      const df = documentFrequency.get(token) ?? 0;
      const idf = Math.log(1 + (tokenized.length - df + 0.5) / (df + 0.5));
      const denominator = frequency + k1 * (1 - b + b * tokens.length / Math.max(1, averageLength));
      return total + idf * frequency * (k1 + 1) / denominator;
    }, 0);
  });
};

const isExpired = (entry: MemoryEntry, now: number): boolean => {
  if (!entry.expiresAt) return false;
  const expiry = Date.parse(entry.expiresAt);
  return Number.isFinite(expiry) && expiry < now;
};

/** 从核心 Markdown 中只挑选与当前问题有关的条目，避免将整个文件注入 prompt。 */
export const recallCoreMemory = (coreText: string, query: string, maxChars = 6000): string => {
  const entries = parseEntries(coreText).filter((entry) => !isExpired(entry, Date.now()));
  if (!entries.length) return String(coreText ?? '').slice(0, maxChars);
  const hasQuery = Boolean(String(query ?? '').trim());
  const scores = hasQuery ? bm25(query, entries.map((entry) => entry.text)) : entries.map(() => 0);
  const ranked = entries.map((entry, index) => ({
    entry,
    score: (hasQuery ? scores[index] * 0.65 : 0) + entry.importance * 0.2 + entry.confidence * 0.1
      + Math.min(1, entry.mentions / 5) * 0.05,
  })).filter((item) => !hasQuery || item.score > 0.1).sort((left, right) => right.score - left.score);
  const selected: string[] = [];
  let chars = 0;
  for (const item of ranked) {
    const line = `- ${item.entry.text}`;
    if (selected.length && chars + line.length + 1 > maxChars) continue;
    selected.push(line);
    chars += line.length + 1;
  }
  if (selected.length) return selected.join('\n');
  return hasQuery ? '' : String(coreText ?? '').slice(0, maxChars);
};
