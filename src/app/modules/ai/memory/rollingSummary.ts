const SUMMARY_TRIGGER_UNSUMMARIZED_MESSAGES = 8;
const SUMMARY_SOURCE_MESSAGES = 8;
const SUMMARY_MAX_TEXT_CHARS = 280;
const SUMMARY_MAX_FACTS = 6;
const SUMMARY_MAX_OPEN_LOOPS = 4;

const isString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

const truncateText = (value: string, maxChars: number): string => {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
};

const uniqueStrings = (values: string[], limit: number): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach((item) => {
    const text = String(item ?? '').trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    result.push(text);
  });
  return result.slice(0, limit);
};

const normalizeRoleLabel = (role?: string): string => {
  if (role === 'assistant') return '桌宠';
  if (role === 'user') return '用户';
  return '对话';
};

const compactSentence = (text?: string, maxChars = 48): string => {
  if (!isString(text)) return '';
  const normalized = text.replace(/\s+/g, ' ').trim();
  const hit = normalized.match(/^[^。！？!?\n]{1,64}[。！？!?]?/);
  return truncateText(hit?.[0] ?? normalized, maxChars);
};

const buildDialogueDigest = (messages: PetModelMemoryMessage[]): string => {
  const parts = messages
    .slice(-SUMMARY_SOURCE_MESSAGES)
    .map((message) => {
      const text = compactSentence(message.text, 40);
      if (!text) return '';
      return `${normalizeRoleLabel(message.role)}提到${text}`;
    })
    .filter(Boolean);
  return truncateText(parts.join('；'), SUMMARY_MAX_TEXT_CHARS);
};

const FACT_PATTERNS = [
  /我喜欢[^。！？!?\n]+/g,
  /我不喜欢[^。！？!?\n]+/g,
  /我是[^。！？!?\n]+/g,
  /我叫[^。！？!?\n]+/g,
  /请叫我[^。！？!?\n]+/g,
  /我的[^。！？!?\n]+/g,
  /我希望[^。！？!?\n]+/g,
  /我想要[^。！？!?\n]+/g,
  /你是[^。！？!?\n]+/g,
  /我们[^。！？!?\n]+/g,
];

const extractFacts = (messages: PetModelMemoryMessage[]): string[] => {
  const hits: string[] = [];
  messages.forEach((message) => {
    const text = isString(message.text) ? message.text : '';
    if (!text) return;
    FACT_PATTERNS.forEach((pattern) => {
      const matched = text.match(pattern) ?? [];
      matched.forEach((item) => {
        const fact = truncateText(item.replace(/\s+/g, ' ').trim(), 48);
        if (fact) hits.push(fact);
      });
    });
  });
  return uniqueStrings(hits, SUMMARY_MAX_FACTS);
};

const extractOpenLoops = (messages: PetModelMemoryMessage[]): string[] => {
  const hits: string[] = [];
  messages.forEach((message) => {
    const text = compactSentence(message.text, 56);
    if (!text) return;
    const hasQuestion = /[？?]|吗$|嘛$/.test(text);
    const hasFollowUp = /继续|下次|稍后|待会|之后|记得|帮我|我会|还要|安排/.test(text);
    if (hasQuestion || hasFollowUp) {
      hits.push(text);
    }
  });
  return uniqueStrings(hits.reverse(), SUMMARY_MAX_OPEN_LOOPS);
};

// 兼容历史脏数据：去掉被重复写入的“历史摘要：”前缀链，防止摘要文本无限递归。
const stripRecursiveHistoryPrefix = (value: string): string => {
  let output = String(value ?? '').trim();
  for (let i = 0; i < 8; i += 1) {
    if (!output.startsWith('历史摘要：')) break;
    output = output.slice('历史摘要：'.length).trim();
  }
  return output;
};

const mergeSummaryText = (previousSummary: string, dialogueDigest: string): string => {
  const parts: string[] = [];
  if (isString(dialogueDigest)) {
    parts.push(`近期对话：${dialogueDigest}`);
  }

  // 新策略：摘要主文本只记录“近期对话”，不再把旧摘要再次写回 summary，避免出现“历史摘要：历史摘要：...”
  // 兜底：当近期对话为空时，保留清洗后的旧摘要，避免 summary 变成空串。
  if (!parts.length && isString(previousSummary)) {
    parts.push(stripRecursiveHistoryPrefix(truncateText(previousSummary, SUMMARY_MAX_TEXT_CHARS)));
  }

  return truncateText(parts.join('；'), SUMMARY_MAX_TEXT_CHARS);
};

export interface BuildRollingSummaryInput {
  previousSummary?: PetModelMemorySummary | null;
  recent?: PetModelMemoryRecent | null;
  currentMeta?: PetModelMemoryMeta | null;
  nextMessageCount: number;
  now: number;
}

export interface BuildRollingSummaryResult {
  shouldUpdate: boolean;
  summary: PetModelMemorySummary;
  lastSummarizedCount: number;
}

export const buildRollingSummary = (input: BuildRollingSummaryInput): BuildRollingSummaryResult => {
  const previousSummary = input.previousSummary ?? null;
  const recent = input.recent ?? null;
  const currentMeta = input.currentMeta ?? null;
  const nextMessageCount = Math.max(0, Math.floor(input.nextMessageCount));
  const now = Math.max(0, Math.floor(input.now));
  const baseLastSummarizedCount = currentMeta?.lastSummarizedCount ?? 0;
  const unsummarizedCount = Math.max(0, nextMessageCount - Math.max(0, Math.floor(baseLastSummarizedCount)));

  const recentMessages = Array.isArray(recent?.messages) ? recent.messages : [];
  const previousFacts = Array.isArray(previousSummary?.facts) ? previousSummary.facts : [];
  const previousOpenLoops = Array.isArray(previousSummary?.open_loops) ? previousSummary.open_loops : [];
  const previousText = isString(previousSummary?.summary) ? previousSummary.summary : '';

  const dialogueDigest = buildDialogueDigest(recentMessages);
  const facts = uniqueStrings([...previousFacts, ...extractFacts(recentMessages)], SUMMARY_MAX_FACTS);
  const openLoops = uniqueStrings([...extractOpenLoops(recentMessages), ...previousOpenLoops], SUMMARY_MAX_OPEN_LOOPS);
  const summaryText = mergeSummaryText(previousText, dialogueDigest);

  return {
    shouldUpdate: unsummarizedCount >= SUMMARY_TRIGGER_UNSUMMARIZED_MESSAGES,
    summary: {
      version: 1,
      summary: summaryText,
      facts,
      open_loops: openLoops,
      updatedAt: now,
    },
    lastSummarizedCount: nextMessageCount,
  };
};