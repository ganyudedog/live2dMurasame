import fs from 'node:fs';
import path from 'node:path';
import { readTextFile as readText, readJsonFile, writeTextFile as atomicWrite, writeJsonFile as writeJson } from '../utils/file.js';
import { getModelConfigDirFor, getLegacyModelMemoryFilePathsFor } from './configDao.js';
import {
  acceptRelationshipProposals,
  applyManualAdjustment,
  composeRelationshipCore,
  evaluateRelationshipGrowth,
  isMeaningfulDesktopExchange,
  migrateRelationship,
  normalizeStoredRelationship,
  recordInteractionDay,
  toPublicRelationship,
  type StoredRelationship,
} from '../modules/modelenv/domain/relationship.js';
import { extractRelationship } from '../../shared/memory/relationship.js';

const DEFAULT_CORE = '# 核心记忆\n\n';
const APP_TIME_ZONE = 'Asia/Shanghai';
const DEFAULT_STATE = {
  version: 1,
  conversationCount: 0,
  lastConversationAt: 0,
  lastConsolidatedCount: 0,
  lastDecayDate: '',
  legacyMigratedAt: 0,
  entries: {},
};
const MAX_CORE_BYTES = 30 * 1024;
const MAX_CORE_LINES = 2000;
const MAX_EPISODE_BYTES = 512 * 1024;
const EPISODE_RETENTION_DAYS = 7;
const MAX_EPISODE_RECALL_CHARS = 12000;
const MAX_ACTION_CHAT_BYTES = 1024 * 1024;
const MAX_PENDING_CONVERSATIONS = 8;
const MAX_PENDING_TEXT_CHARS = 24000;
const EPISODE_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface JsonRecord { [key: string]: unknown }

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const asObject = (value: unknown): JsonRecord => isRecord(value) ? value : {};

const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

interface MemoryState {
  version: number;
  conversationCount: number;
  lastConversationAt: number;
  lastConsolidatedCount: number;
  lastDecayDate: string;
  legacyMigratedAt: number;
  entries: JsonRecord;
  [key: string]: unknown;
}

interface MemoryPaths {
  memoryDir: string;
  corePath: string;
  statePath: string;
  episodesDir: string;
  actionCatalogChatPath: string;
}

interface ArchivePaths {
  episodesDir: string;
  statePath: string;
  corePath?: string;
  actionCatalogChatPath?: string;
  memoryDir?: string;
}

interface MemoryArchive {
  platform: string;
  id: string;
  scope: string;
}

const asState = (value: unknown, fallback: MemoryState = DEFAULT_STATE as MemoryState): MemoryState => ({
  ...fallback,
  ...asObject(value),
} as MemoryState);

const safeDate = (value: unknown): string => {
  const date = new Date(finiteNumber(value) ? value : Date.now());
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
};
const dateDayNumber = (date: unknown): number => {
  const match = String(date ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000;
};
const episodeAgeDays = (date: unknown, now: number = Date.now()): number => {
  const age = dateDayNumber(safeDate(now)) - dateDayNumber(date);
  return Number.isFinite(age) ? Math.max(0, Math.floor(age)) : Infinity;
};
const readJson = (filePath: string, fallback: JsonRecord = {}): JsonRecord =>
  asObject(readJsonFile(filePath, fallback));
const coreLineCount = (content: unknown): number => {
  const trimmed = String(content ?? '').trimEnd();
  return trimmed ? trimmed.split(/\r?\n/).length : 0;
};
const normalizeCore = (content: unknown): string => {
  const value = String(content ?? '').trim();
  return value ? `${value}\n` : DEFAULT_CORE;
};
const assertCoreLimits = (content: string): void => {
  if (Buffer.byteLength(content, 'utf8') > MAX_CORE_BYTES) throw new Error('核心记忆不能超过 30 KB');
  if (coreLineCount(content) > MAX_CORE_LINES) throw new Error('核心记忆不能超过 2000 行');
};
const fitCoreToLimits = (content: unknown): string => {
  const lines = normalizeCore(content).trimEnd().split(/\r?\n/).slice(0, MAX_CORE_LINES);
  while (lines.length > 1 && Buffer.byteLength(`${lines.join('\n')}\n`, 'utf8') > MAX_CORE_BYTES) lines.pop();
  const fitted = normalizeCore(lines.join('\n'));
  return Buffer.byteLength(fitted, 'utf8') <= MAX_CORE_BYTES ? fitted : DEFAULT_CORE;
};

const pathsFor = (modelPath: string): MemoryPaths => {
  const memoryDir = path.join(getModelConfigDirFor(modelPath), 'memory');
  const episodesDir = path.join(memoryDir, 'episodes');
  return {
    memoryDir,
    corePath: path.join(memoryDir, 'MEMORY.md'),
    statePath: path.join(memoryDir, 'state.json'),
    episodesDir,
    actionCatalogChatPath: path.join(memoryDir, 'action-catalog-chat.md'),
  };
};

const ensureMemoryFiles = (modelPath: string): MemoryPaths => {
  const paths = pathsFor(modelPath);
  fs.mkdirSync(paths.episodesDir, { recursive: true });
  if (!fs.existsSync(paths.corePath)) atomicWrite(paths.corePath, DEFAULT_CORE);
  else {
    const currentCore = readText(paths.corePath, DEFAULT_CORE);
    const fittedCore = fitCoreToLimits(currentCore);
    if (fittedCore !== currentCore) atomicWrite(paths.corePath, fittedCore);
  }
  if (!fs.existsSync(paths.statePath)) writeJson(paths.statePath, DEFAULT_STATE);
  if (!fs.existsSync(paths.actionCatalogChatPath)) atomicWrite(paths.actionCatalogChatPath, '# 动作表配置对话\n\n');
  return paths;
};

// External archives share episode parsing/ranking but never desktop core-memory cursors.
const archiveOf = (value: unknown): MemoryArchive | null => {
  if (value == null) return null;
  const source = asObject(value);
  const segment = (item: unknown): item is string => typeof item === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(item)
    && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(item);
  if (!segment(source.platform) || !segment(source.id) || (source.scope !== 'group' && source.scope !== 'private')) {
    throw new Error('Invalid memory archive identity');
  }
  return { platform: source.platform, id: source.id, scope: source.scope };
};

const ensureEpisodeArchive = (modelPath: string, archive: unknown): MemoryPaths | ArchivePaths => {
  const identity = archiveOf(archive);
  if (!identity) return ensureMemoryFiles(modelPath);
  const episodesDir = path.join(pathsFor(modelPath).episodesDir, identity.platform.toLowerCase(), identity.scope, identity.id);
  fs.mkdirSync(episodesDir, { recursive: true });
  return { episodesDir, statePath: path.join(episodesDir, 'state.json') };
};

interface EpisodeInput {
  toolContext?: unknown;
  requestId?: unknown;
  userText?: unknown;
  assistantText?: unknown;
  sender?: unknown;
  conversationId?: unknown;
  at?: unknown;
  conversationCount?: number;
}

const toEpisodeBlock = ({ userText, assistantText, sender, conversationId, toolContext, requestId, at = Date.now(), conversationCount = 0 }: EpisodeInput) => {
  const date = safeDate(at);
  const time = new Date(at as number).toLocaleTimeString('zh-CN', {
    timeZone: APP_TIME_ZONE, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const senderRecord = isRecord(sender) ? sender : undefined;
  const metadata = JSON.stringify({
    sender: typeof senderRecord?.id === 'string' ? { id: senderRecord.id } : undefined,
    conversationId,
    requestId: typeof requestId === 'string' ? requestId : undefined,
  }).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e');
  const quote = (text: unknown): string => String(text ?? '').trim().split(/\r?\n/).map((line) => `> ${line}`).join('\n');
  return { date, block: `\n<!-- conversation-count:${conversationCount} -->\n### ${time}\n<!-- turn-meta:${metadata} -->\n\n**用户**\n${quote(userText)}\n\n**角色**\n${quote(assistantText)}\n${typeof toolContext === 'string' && toolContext ? `\n**工具执行（数据）**\n${quote(toolContext)}\n` : ''}` };
};

const deriveEpisodeAgeBand = (date: unknown, now = Date.now()): 1 | 3 | 5 | 7 | null => {
  const ageDays = episodeAgeDays(date, now);
  if (ageDays <= 1) return 1;
  if (ageDays <= 3) return 3;
  if (ageDays <= 5) return 5;
  if (ageDays <= EPISODE_RETENTION_DAYS) return 7;
  return null;
};

const listEpisodeDates = (paths: { episodesDir: string }): string[] => fs.readdirSync(paths.episodesDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && EPISODE_DATE.test(path.basename(entry.name, '.md')))
  .map((entry) => path.basename(entry.name, '.md'))
  .sort();

const conversationCounts = (content: unknown): number[] => [...String(content ?? '').matchAll(/<!-- conversation-count:(\d+) -->/g)]
  .map((match) => Number(match[1])).filter(Number.isInteger);

const pruneExpiredEpisodes = (paths: { episodesDir: string }, now = Date.now(), state: MemoryState | null = null): number => {
  let maxDeletedConversationCount = 0;
  for (const date of listEpisodeDates(paths)) {
    if (episodeAgeDays(date, now) <= EPISODE_RETENTION_DAYS) continue;
    const episodePath = path.join(paths.episodesDir, `${date}.md`);
    const content = readText(episodePath);
    maxDeletedConversationCount = Math.max(maxDeletedConversationCount, ...conversationCounts(content), 0);
    try { fs.unlinkSync(episodePath); } catch { /* best effort cleanup */ }
  }
  if (state && maxDeletedConversationCount > (state.lastConsolidatedCount ?? 0)) {
    state.lastConsolidatedCount = Math.min(state.conversationCount, maxDeletedConversationCount);
  }
  return maxDeletedConversationCount;
};

const readState = (filePath: string): MemoryState => asState(readJson(filePath, DEFAULT_STATE as unknown as JsonRecord));

const migrateLegacyMemory = (modelPath: string, paths: MemoryPaths): MemoryState => {
  const state = readState(paths.statePath);
  if (state.legacyMigratedAt || fs.readFileSync(paths.corePath, 'utf8') !== DEFAULT_CORE) return state;
  const legacyPaths = getLegacyModelMemoryFilePathsFor(modelPath);
  // 新格式已经写入过会话时，不能用空的旧 JSON 默认值覆盖它的游标。
  if (state.conversationCount > 0) {
    const migratedState = { ...state, legacyMigratedAt: Date.now() };
    writeJson(paths.statePath, migratedState);
    return migratedState;
  }
  const hasLegacy = [legacyPaths.recentPath, legacyPaths.summaryPath, legacyPaths.metaPath].some((filePath) => fs.existsSync(filePath));
  if (!hasLegacy) {
    const migratedState = { ...state, legacyMigratedAt: Date.now() };
    writeJson(paths.statePath, migratedState);
    return migratedState;
  }
  const legacy = {
    recent: readJson(legacyPaths.recentPath, { messages: [] }),
    summary: readJson(legacyPaths.summaryPath, {}),
    meta: readJson(legacyPaths.metaPath, {}),
  };
  const summary = asObject(legacy.summary);
  const recentMessages = Array.isArray(asObject(legacy.recent).messages) ? asObject(legacy.recent).messages as unknown[] : [];
  const sections: string[] = [];
  if (summary.summary) sections.push(`## 近期摘要\n\n${String(summary.summary)}`);
  if (Array.isArray(summary.facts) && summary.facts.length) sections.push(`## 已知事实\n\n${summary.facts.map((fact) => `- ${String(fact)}`).join('\n')}`);
  if (Array.isArray(summary.open_loops) && summary.open_loops.length) sections.push(`## 待继续话题\n\n${summary.open_loops.map((item) => `- ${String(item)}`).join('\n')}`);
  if (sections.length) atomicWrite(paths.corePath, fitCoreToLimits(`${DEFAULT_CORE}${sections.join('\n\n')}\n`));

  const grouped = new Map<string, JsonRecord[]>();
  recentMessages.forEach((message) => {
    const record = asObject(message);
    if (!record.text) return;
    const date = safeDate(record.ts || Date.now());
    const list = grouped.get(date) ?? [];
    list.push(record);
    grouped.set(date, list);
  });
  for (const [date, messages] of grouped) {
    const episodePath = path.join(paths.episodesDir, `${date}.md`);
    let body = readText(episodePath, `# 对话片段 ${date}\n`);
    for (const message of messages) {
      const speaker = message.role === 'assistant' ? '角色' : '用户';
      const stamp = message.ts || Date.now();
      body += `\n### ${new Date(stamp as number).toLocaleTimeString('zh-CN', { hour12: false })} · ${speaker}\n\n${String(message.text)}\n`;
    }
    atomicWrite(episodePath, body);
  }
  const meta = asObject(legacy.meta);
  const migratedState: MemoryState = {
    ...DEFAULT_STATE,
    ...state,
    conversationCount: Math.floor(Number(meta.messageCount ?? 0) / 2),
    lastConversationAt: (meta.lastMessageAt ?? 0) as number,
    lastConsolidatedCount: Math.floor(Number(meta.lastSummarizedCount ?? 0) / 2),
    legacyMigratedAt: Date.now(),
  };
  writeJson(paths.statePath, migratedState);
  return migratedState;
};

interface EpisodeBlock {
  toolContext?: string;
  requestId?: string;
  date: string;
  time: string;
  conversationCount: number;
  userText: string;
  assistantText: string;
  sender?: { id: string };
  conversationId: unknown;
  rawText: string;
}

const unquoteEpisodeText = (value: unknown): string => String(value ?? '')
  .split(/\r?\n/).map((line) => line.replace(/^> ?/, '')).join('\n').trim();

const parseEpisodeBlocks = (content: unknown, date: string): EpisodeBlock[] => {
  const markedBlocks = String(content ?? '').split(/(?=^<!-- conversation-count:\d+ -->$)/gm).filter((block) => /^<!-- conversation-count:\d+ -->$/m.test(block));
  const rawBlocks = markedBlocks.length
    ? markedBlocks
    : String(content ?? '').split(/(?=^###\s+.+?\s+·\s+(?:用户|角色)\s*$)/m).filter((block) => /^###\s+.+?\s+·\s+(?:用户|角色)\s*$/m.test(block));
  return rawBlocks.map((block) => {
    let metadata: JsonRecord = {};
    try {
      const raw = block.match(/^<!-- turn-meta:(.*?) -->$/m)?.[1] ?? '{}';
      metadata = asObject(JSON.parse(raw) as unknown);
    } catch { /* Accept archives without metadata or with damaged metadata. */ }
    const count = Number(block.match(/<!-- conversation-count:(\d+) -->/)?.[1]);
    const time = block.match(/^###\s+(.+)$/m)?.[1]?.trim() ?? '';
    const userMatch = block.match(/^\*\*用户\*\*[^\S\n]*\n([\s\S]*?)(?=^\*\*角色\*\*|(?![\s\S]))/m);
    const assistantMatch = block.match(/^\*\*角色\*\*[^\S\n]*\n([\s\S]*?)(?=^\*\*工具执行（数据）\*\*|(?![\s\S]))/m);
    const toolMatch = block.match(/^\*\*工具执行（数据）\*\*[^\S\n]*\n([\s\S]*)$/m);
    const legacyMatch = block.match(/^###\s+(.+?)\s+·\s+(用户|角色)\s*\n\n([\s\S]*)$/m);
    const userText = unquoteEpisodeText(userMatch?.[1] ?? (legacyMatch?.[2] === '用户' ? legacyMatch[3] : ''));
    const assistantText = unquoteEpisodeText(assistantMatch?.[1] ?? (legacyMatch?.[2] === '角色' ? legacyMatch[3] : ''));
    return {
      date,
      time,
      conversationCount: Number.isInteger(count) ? count : 0,
      userText,
      assistantText,
      toolContext: toolMatch ? unquoteEpisodeText(toolMatch[1]) : undefined,
      requestId: typeof metadata.requestId === 'string' ? metadata.requestId : undefined,
      sender: isRecord(metadata.sender) && typeof metadata.sender.id === 'string' ? { id: metadata.sender.id } : undefined,
      conversationId: metadata.conversationId,
      rawText: block.trim(),
    };
  }).filter((block) => block.userText || block.assistantText);
};

const tokenizeForBm25 = (value: unknown): string[] => {
  const text = String(value ?? '').toLowerCase();
  const tokens: string[] = [];
  const latin = text.match(/[a-z0-9_]+/g) ?? [];
  tokens.push(...latin);
  const cjk = [...text].filter((char) => /[\u3400-\u9fff]/u.test(char));
  if (cjk.length === 1) tokens.push(cjk[0]);
  for (let index = 0; index < cjk.length - 1; index += 1) tokens.push(`${cjk[index]}${cjk[index + 1]}`);
  return tokens.filter(Boolean);
};

const bm25Scores = (query: unknown, documents: readonly string[]): number[] => {
  const queryTokens = [...new Set(tokenizeForBm25(query))];
  if (!queryTokens.length) return documents.map(() => 0);
  const tokenized = documents.map((document) => tokenizeForBm25(document));
  const documentFrequency = new Map<string, number>();
  tokenized.forEach((tokens) => {
    for (const token of new Set(tokens)) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
  });
  const averageLength = tokenized.reduce((sum, tokens) => sum + tokens.length, 0) / Math.max(1, tokenized.length);
  const k1 = 1.2;
  const b = 0.75;
  return tokenized.map((tokens) => {
    const frequencies = new Map<string, number>();
    tokens.forEach((token) => frequencies.set(token, (frequencies.get(token) ?? 0) + 1));
    return queryTokens.reduce((score, token) => {
      const tf = frequencies.get(token) ?? 0;
      if (!tf) return score;
      const df = documentFrequency.get(token) ?? 0;
      const idf = Math.log(1 + (tokenized.length - df + 0.5) / (df + 0.5));
      const denominator = tf + k1 * (1 - b + b * tokens.length / Math.max(1, averageLength));
      return score + idf * (tf * (k1 + 1)) / denominator;
    }, 0);
  });
};

const pendingEpisodes = (paths: { episodesDir: string }, state: MemoryState) => {
  const pending: Array<{ count: number; date: string; text: string }> = [];
  for (const date of listEpisodeDates(paths)) {
    const content = readText(path.join(paths.episodesDir, `${date}.md`));
    parseEpisodeBlocks(content, date).forEach((block) => {
      if (block.conversationCount > (state.lastConsolidatedCount ?? 0)) {
        pending.push({ count: block.conversationCount, date, text: block.rawText });
      }
    });
  }
  pending.sort((a, b) => a.count - b.count);
  const pendingBatch: Array<{ count: number; text: string; date?: string }> = [];
  let pendingChars = 0;
  for (const item of pending.slice(0, MAX_PENDING_CONVERSATIONS)) {
    const remaining = MAX_PENDING_TEXT_CHARS - pendingChars;
    if (remaining <= 0) break;
    const text = item.text.length > remaining ? item.text.slice(0, remaining) : item.text;
    pendingChars += text.length;
    pendingBatch.push({ count: item.count, text });
    if (text.length < item.text.length) break;
  }
  return {
    text: pendingBatch.map((item) => item.text).join('\n\n'),
    throughCount: pendingBatch.at(-1)?.count ?? (state.lastConsolidatedCount ?? 0),
    sinceDate: pendingBatch[0]?.date ?? '',
  };
};

const desktopPaths = (paths: MemoryPaths | ArchivePaths): MemoryPaths => {
  if (!paths.corePath || !paths.actionCatalogChatPath || !paths.memoryDir) {
    throw new Error('Desktop memory files are unavailable');
  }
  return paths as MemoryPaths;
};

const memoryLocks = new Set<string>();
const withMemoryLock = <T>(modelPath: string, run: () => T): T => {
  if (memoryLocks.has(modelPath)) throw new Error('Memory update is already in progress');
  memoryLocks.add(modelPath);
  try { return run(); }
  finally { memoryLocks.delete(modelPath); }
};

const fitRelationshipCore = (sourceText: string, relationship: StoredRelationship): string => {
  const section = composeRelationshipCore('', relationship).trimEnd();
  const body = extractRelationship(sourceText).memoryText.trim();
  const lines = body ? body.split(/\r?\n/) : [];
  const build = (count: number): string => {
    const kept = lines.slice(0, count).join('\n').trim();
    return kept ? `${section}\n\n${kept}\n` : `${section}\n`;
  };
  let count = lines.length;
  let text = build(count);
  while (count > 0 && (Buffer.byteLength(text, 'utf8') > MAX_CORE_BYTES || coreLineCount(text) > MAX_CORE_LINES)) {
    count -= 1;
    text = build(count);
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_CORE_BYTES || coreLineCount(text) > MAX_CORE_LINES) return `${section}\n`;
  return text;
};

const strictRelationshipCore = (sourceText: string, relationship: StoredRelationship): string => {
  const text = composeRelationshipCore(sourceText, relationship);
  assertCoreLimits(text);
  return text;
};

/** Reads or creates the authoritative relationship, then repairs the core section from it. */
const adoptDesktopRelationship = (paths: MemoryPaths, state: MemoryState, now = Date.now()): boolean => {
  const raw = state.relationship;
  const relationship = normalizeStoredRelationship(raw) ?? migrateRelationship(readText(paths.corePath, DEFAULT_CORE), now);
  state.relationship = relationship;
  const currentCore = readText(paths.corePath, DEFAULT_CORE);
  const nextCore = fitRelationshipCore(currentCore, relationship);
  if (nextCore !== currentCore) atomicWrite(paths.corePath, nextCore);
  return JSON.stringify(raw) !== JSON.stringify(relationship) || nextCore !== currentCore;
};

const relationshipEvidence = (paths: MemoryPaths, rememberedCount: number, throughCount: number) => {
  type Evidence = { conversationCount: number; userText: string };
  const priorTurns: Evidence[] = [];
  const candidateTurns: Evidence[] = [];
  for (const date of listEpisodeDates(paths)) {
    for (const block of parseEpisodeBlocks(readText(path.join(paths.episodesDir, `${date}.md`)), date)) {
      if (block.toolContext) continue;
      const userText = block.userText.trim();
      if (block.conversationCount <= 0 || block.conversationCount > throughCount || userText.length < 4) continue;
      const target = block.conversationCount <= rememberedCount ? priorTurns : candidateTurns;
      target.push({ conversationCount: block.conversationCount, userText });
    }
  }
  return { priorTurns, candidateTurns };
};

const readModelMemorySnapshot = (modelPath: string, archive?: unknown) => {
  const paths = ensureEpisodeArchive(modelPath, archive);
  const state = archive == null
    ? migrateLegacyMemory(modelPath, desktopPaths(paths))
    : readState(paths.statePath);
  const relationshipDirty = archive == null ? adoptDesktopRelationship(desktopPaths(paths), state) : false;
  const deletedCount = pruneExpiredEpisodes(paths, Date.now(), state);
  if (deletedCount > 0 || relationshipDirty) writeJson(paths.statePath, state);
  const pending = pendingEpisodes(paths, state);
  const episodeDates = listEpisodeDates(paths);
  const stored = archive == null ? desktopPaths(paths) : null;
  const relationship = stored ? toPublicRelationship(state.relationship) : null;
  return {
    coreText: stored ? readText(stored.corePath) : '',
    // 只返回日期索引；原始 episode 只能通过显式历史查询读取。
    episodes: [] as unknown[],
    episodeDates,
    episodeCount: episodeDates.length,
    state: { ...DEFAULT_STATE, ...state, relationship: relationship ?? state.relationship },
    relationship,
    pendingEpisodeText: stored ? pending.text : '',
    pendingThroughCount: pending.throughCount,
    pendingSinceDate: pending.sinceDate,
    actionCatalogChat: stored ? readText(stored.actionCatalogChatPath).slice(-MAX_ACTION_CHAT_BYTES) : '',
  };
};

export const loadModelMemoryDocuments = (modelPath: string, archive?: unknown) =>
  withMemoryLock(modelPath, () => readModelMemorySnapshot(modelPath, archive));

// Recent context is chronological, independent of relevance and consolidation cursors.
export const loadRecentModelMemoryTurns = (modelPath: string, query: unknown = {}) => {
  const source = asObject(query);
  const paths = ensureEpisodeArchive(modelPath, source.archive);
  const state = readState(paths.statePath);
  if (pruneExpiredEpisodes(paths, Date.now(), state) > 0) writeJson(paths.statePath, state);
  const count = finiteNumber(source.limit) ? Math.max(1, Math.min(10, Math.floor(source.limit))) : 10;
  const turns: Array<Omit<EpisodeBlock, 'rawText'>> = [];
  for (const date of listEpisodeDates(paths).reverse()) {
    const blocks = parseEpisodeBlocks(readText(path.join(paths.episodesDir, `${date}.md`)), date);
    for (const { ...block } of blocks.reverse()) {
      if (block.userText && block.assistantText) turns.push(block);
      if (turns.length === count) return { turns: turns.reverse() };
    }
  }
  return { turns: turns.reverse() };
};

export const recallModelMemoryEpisodes = (modelPath: string, query: unknown = {}) => {
  const source = asObject(query);
  const archive = source.archive;
  const dates = source.dates === undefined ? [] : source.dates;
  const textQuery = source.query === undefined ? '' : source.query;
  const speaker = source.speaker === undefined ? 'both' : source.speaker;
  const approximate = source.approximate === undefined ? false : source.approximate;
  const maxChars = source.maxChars === undefined ? MAX_EPISODE_RECALL_CHARS : Number(source.maxChars);
  const paths = ensureEpisodeArchive(modelPath, archive);
  const state = archive == null ? migrateLegacyMemory(modelPath, desktopPaths(paths)) : readState(paths.statePath);
  const deletedCount = pruneExpiredEpisodes(paths, Date.now(), state);
  if (deletedCount > 0) writeJson(paths.statePath, state);
  const availableDates = new Set(listEpisodeDates(paths));
  const candidates = archive != null && Array.isArray(dates) && !dates.length ? [...availableDates] : dates;
  const requestedDates = [...new Set(Array.isArray(candidates) ? candidates : [])]
    .filter((date): date is string => typeof date === 'string' && EPISODE_DATE.test(date) && availableDates.has(date));
  const expired = Array.isArray(dates) && dates.length > 0 && requestedDates.length === 0;
  if (!requestedDates.length) return { status: expired ? 'expired' : 'empty', dates: [], approximate, matches: [], text: '' };

  const blocks = requestedDates.flatMap((date) => parseEpisodeBlocks(
    readText(path.join(paths.episodesDir, `${date}.md`)), date,
  )).map((block) => ({
    ...block,
    searchText: speaker === 'user' ? block.userText : speaker === 'assistant' ? block.assistantText : `${block.userText}\n${block.assistantText}\n${block.toolContext ?? ''}`,
  })).filter((block) => block.searchText);
  const scores = bm25Scores(textQuery, blocks.map((block) => block.searchText));
  const queryHasTerms = tokenizeForBm25(textQuery).length > 0;
  const scored = blocks.map((block, index) => ({
    ...block,
    score: queryHasTerms ? (scores[index] ?? 0) : Math.max(0.1, block.searchText.length / 120),
    ageBand: deriveEpisodeAgeBand(block.date),
  })).filter((block) => !queryHasTerms || block.score > 0);
  scored.sort((left, right) => right.score - left.score
    || right.date.localeCompare(left.date)
    || right.conversationCount - left.conversationCount);
  const selected: Array<{
    date: string;
    time: string;
    conversationCount: number;
    userText: string;
    assistantText: string;
    toolContext?: string;
    score: number;
    ageBand: 1 | 3 | 5 | 7 | null;
  }> = [];
  const selectedTexts: string[] = [];
  const separator = '\n\n';
  let usedChars = 0;
  for (const block of scored) {
    const item = {
      date: block.date,
      time: block.time,
      conversationCount: block.conversationCount,
      userText: block.userText,
      assistantText: block.assistantText,
      toolContext: speaker === 'both' ? block.toolContext : undefined,
      score: Number(block.score.toFixed(4)),
      ageBand: block.ageBand,
    };
    const text = `【${item.date} ${item.time}】\n用户：${item.userText}\n角色：${item.assistantText}${item.toolContext ? `\n工具执行（数据）：${item.toolContext}` : ''}`;
    const itemChars = text.length + (selected.length ? separator.length : 0);
    if (selected.length && usedChars + itemChars > Math.min(MAX_EPISODE_RECALL_CHARS, Math.max(500, maxChars))) continue;
    selected.push(item);
    selectedTexts.push(text);
    usedChars += itemChars;
  }
  return {
    status: selected.length ? 'ok' : 'no-match',
    dates: requestedDates,
    approximate,
    matches: selected,
    text: selectedTexts.join(separator),
  };
};

export const appendModelMemoryConversation = (modelPath: string, conversation: unknown) => withMemoryLock(modelPath, () => {
  const source = asObject(conversation);
  const paths = ensureEpisodeArchive(modelPath, source.archive);
  const state = readState(paths.statePath);
  pruneExpiredEpisodes(paths, Date.now(), state);
  if (typeof source.toolContext === 'string' && Buffer.byteLength(source.toolContext, 'utf8') > 24 * 1024) throw new Error('Tool context exceeds episode budget');
  // A retried final response must not duplicate an episode or relationship evidence.
  if (typeof source.requestId === 'string' && listEpisodeDates(paths).some((date) =>
    parseEpisodeBlocks(readText(path.join(paths.episodesDir, `${date}.md`)), date).some((turn) =>
      turn.requestId === source.requestId && turn.conversationId === source.conversationId
      && turn.sender?.id === (isRecord(source.sender) ? source.sender.id : undefined)))) {
    return readModelMemorySnapshot(modelPath, source.archive);
  }
  state.conversationCount += 1;
  state.lastConversationAt = finiteNumber(source.at) ? Math.floor(source.at) : Date.now();
  const { date, block } = toEpisodeBlock({ ...source, conversationCount: state.conversationCount });
  const episodePath = path.join(paths.episodesDir, `${date}.md`);
  const content = readText(episodePath, `# 对话片段 ${date}\n`);
  if (Buffer.byteLength(content + block, 'utf8') > MAX_EPISODE_BYTES) throw new Error('当天记忆归档超过 512 KB，已停止追加');
  atomicWrite(episodePath, `${content}${block}`);
  // Conversation archives and personal memory have independent state.
  if (source.archive == null) {
    const desktop = desktopPaths(paths);
    const now = Date.now();
    const at = finiteNumber(source.at) ? Math.floor(source.at) : now;
    let relationship = normalizeStoredRelationship(state.relationship)
      ?? migrateRelationship(readText(desktop.corePath, DEFAULT_CORE), now);
    if (!source.toolContext && isMeaningfulDesktopExchange(source.userText, source.assistantText)) {
      relationship = evaluateRelationshipGrowth(
        recordInteractionDay(relationship, at), now, undefined, state.conversationCount,
      );
    }
    state.relationship = relationship;
  }
  writeJson(paths.statePath, state);
  return readModelMemorySnapshot(modelPath, source.archive);
});

export const updateModelMemoryCore = (modelPath: string, content: unknown) => withMemoryLock(modelPath, () => {
  if (typeof content !== 'string') throw new TypeError('核心记忆必须是 Markdown 文本');
  const paths = ensureMemoryFiles(modelPath);
  const state = migrateLegacyMemory(modelPath, paths);
  const relationship = normalizeStoredRelationship(state.relationship)
    ?? migrateRelationship(readText(paths.corePath, DEFAULT_CORE), Date.now());
  const normalized = strictRelationshipCore(content, relationship);
  atomicWrite(paths.corePath, normalized);
  state.relationship = relationship;
  writeJson(paths.statePath, state);
  return readModelMemorySnapshot(modelPath);
});

export const updateModelMemoryMaintenanceState = (modelPath: string, patch: unknown = {}) => withMemoryLock(modelPath, () => {
  const source = asObject(patch);
  const paths = ensureMemoryFiles(modelPath);
  const next = migrateLegacyMemory(modelPath, paths);
  adoptDesktopRelationship(paths, next);
  if (finiteNumber(source.lastConsolidatedCount)) next.lastConsolidatedCount = Math.max(0, Math.floor(source.lastConsolidatedCount));
  if (finiteNumber(source.lastDecayAt)) next.lastDecayDate = safeDate(source.lastDecayAt);
  writeJson(paths.statePath, next);
  return next;
});

export const saveModelMemoryConsolidation = (modelPath: string, input: unknown = {}) => withMemoryLock(modelPath, () => {
  const source = asObject(input);
  if (!finiteNumber(source.processedThroughCount)) throw new TypeError('记忆整理必须提供已处理的对话游标');
  if (typeof source.content !== 'string') throw new TypeError('核心记忆必须是 Markdown 文本');
  const paths = ensureMemoryFiles(modelPath);
  const state = migrateLegacyMemory(modelPath, paths);
  const now = Date.now();
  let relationship = normalizeStoredRelationship(state.relationship)
    ?? migrateRelationship(readText(paths.corePath, DEFAULT_CORE), now);
  const processedThroughCount = Math.min(state.conversationCount, Math.max(0, Math.floor(source.processedThroughCount)));
  const rememberedCount = state.lastConsolidatedCount ?? 0;
  relationship = acceptRelationshipProposals(relationship, source.relationshipEvents, {
    priorMemory: extractRelationship(readText(paths.corePath, DEFAULT_CORE)).memoryText,
    ...(Array.isArray(source.relationshipEvents) && source.relationshipEvents.length
      ? relationshipEvidence(paths, rememberedCount, processedThroughCount) : {}),
  });
  relationship = evaluateRelationshipGrowth(relationship, now, undefined, processedThroughCount);
  atomicWrite(paths.corePath, strictRelationshipCore(source.content, relationship));
  state.lastConsolidatedCount = Math.min(state.conversationCount, Math.max(state.lastConsolidatedCount, Math.floor(source.processedThroughCount)));
  state.lastDecayDate = safeDate(now);
  state.relationship = relationship;
  writeJson(paths.statePath, state);
  return readModelMemorySnapshot(modelPath);
});

const applyRelationshipChange = (
  modelPath: string,
  change: (relationship: StoredRelationship, now: number, conversationCount: number) => StoredRelationship | null,
) =>
  withMemoryLock(modelPath, () => {
    const paths = ensureMemoryFiles(modelPath);
    const state = migrateLegacyMemory(modelPath, paths);
    const now = Date.now();
    const current = normalizeStoredRelationship(state.relationship)
      ?? migrateRelationship(readText(paths.corePath, DEFAULT_CORE), now);
    const next = change(current, now, Math.max(0, Math.floor(state.conversationCount || 0)));
    if (!next) {
      state.relationship = current;
      adoptDesktopRelationship(paths, state, now);
      writeJson(paths.statePath, state);
      return readModelMemorySnapshot(modelPath);
    }
    state.relationship = next;
    atomicWrite(paths.corePath, strictRelationshipCore(readText(paths.corePath, DEFAULT_CORE), next));
    writeJson(paths.statePath, state);
    return readModelMemorySnapshot(modelPath);
  });

export const adjustModelMemoryRelationship = (modelPath: string, input: unknown) => (
  applyRelationshipChange(modelPath, (relationship, now, conversationCount) => {
    const source = asObject(input);
    const result = applyManualAdjustment(relationship, {
      expectedRevision: typeof source.expectedRevision === 'number' ? source.expectedRevision : undefined,
      stage: typeof source.stage === 'string' ? source.stage : undefined,
      conversationCount,
    }, now);
    return result.changed ? result.relationship : null;
  })
);

export const replaceActionCatalogChat = (modelPath: string, content: unknown) => withMemoryLock(modelPath, () => {
  if (typeof content !== 'string') throw new TypeError('动作表配置对话必须是文本');
  const paths = ensureMemoryFiles(modelPath);
  const header = '# 动作表配置对话\n\n';
  const body = content.replace(/^# 动作表配置对话\s*/u, '').trim();
  let normalized = body ? `${header}${body}\n` : header;
  if (Buffer.byteLength(normalized, 'utf8') > MAX_ACTION_CHAT_BYTES) {
    const marker = '<!-- 较早的对话已按 1 MB 上限裁剪 -->\n';
    const budget = MAX_ACTION_CHAT_BYTES - Buffer.byteLength(header + marker, 'utf8');
    const tail = Buffer.from(body, 'utf8').subarray(-budget).toString('utf8');
    normalized = `${header}${marker}${tail}`;
  }
  atomicWrite(paths.actionCatalogChatPath, normalized);
  return readModelMemorySnapshot(modelPath);
});

export const getModelMemoryEpisodeAgeBand = deriveEpisodeAgeBand;
