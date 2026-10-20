import fs from 'node:fs';
import path from 'node:path';
import { getModelConfigDirFor, getLegacyModelMemoryFilePathsFor } from './configDao.js';

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

const asObject = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const safeDate = (value) => {
  const date = new Date(Number.isFinite(value) ? value : Date.now());
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
};
const dateDayNumber = (date) => {
  const match = String(date ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000;
};
const episodeAgeDays = (date, now = Date.now()) => {
  const age = dateDayNumber(safeDate(now)) - dateDayNumber(date);
  return Number.isFinite(age) ? Math.max(0, Math.floor(age)) : Infinity;
};
const atomicWrite = (filePath, content) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, content, 'utf8');
  fs.renameSync(tempPath, filePath);
};
const readText = (filePath, fallback = '') => {
  try { return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : fallback; }
  catch { return fallback; }
};
const readJson = (filePath, fallback = {}) => {
  try { return fs.existsSync(filePath) ? asObject(JSON.parse(fs.readFileSync(filePath, 'utf8'))) : fallback; }
  catch { return fallback; }
};
const writeJson = (filePath, value) => atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`);
const coreLineCount = (content) => {
  const trimmed = String(content ?? '').trimEnd();
  return trimmed ? trimmed.split(/\r?\n/).length : 0;
};
const normalizeCore = (content) => {
  const value = String(content ?? '').trim();
  return value ? `${value}\n` : DEFAULT_CORE;
};
const assertCoreLimits = (content) => {
  if (Buffer.byteLength(content, 'utf8') > MAX_CORE_BYTES) throw new Error('核心记忆不能超过 30 KB');
  if (coreLineCount(content) > MAX_CORE_LINES) throw new Error('核心记忆不能超过 2000 行');
};
const fitCoreToLimits = (content) => {
  const lines = normalizeCore(content).trimEnd().split(/\r?\n/).slice(0, MAX_CORE_LINES);
  while (lines.length > 1 && Buffer.byteLength(`${lines.join('\n')}\n`, 'utf8') > MAX_CORE_BYTES) lines.pop();
  const fitted = normalizeCore(lines.join('\n'));
  return Buffer.byteLength(fitted, 'utf8') <= MAX_CORE_BYTES ? fitted : DEFAULT_CORE;
};

const pathsFor = (modelPath) => {
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

const ensureMemoryFiles = (modelPath) => {
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

const toEpisodeBlock = ({ userText, assistantText, at = Date.now(), conversationCount = 0 }) => {
  const date = safeDate(at);
  const time = new Date(at).toLocaleTimeString('zh-CN', {
    timeZone: APP_TIME_ZONE, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const quote = (text) => String(text ?? '').trim().split(/\r?\n/).map((line) => `> ${line}`).join('\n');
  return { date, block: `\n<!-- conversation-count:${conversationCount} -->\n### ${time}\n\n**用户**\n${quote(userText)}\n\n**角色**\n${quote(assistantText)}\n` };
};

const deriveEpisodeAgeBand = (date, now = Date.now()) => {
  const ageDays = episodeAgeDays(date, now);
  if (ageDays <= 1) return 1;
  if (ageDays <= 3) return 3;
  if (ageDays <= 5) return 5;
  if (ageDays <= EPISODE_RETENTION_DAYS) return 7;
  return null;
};

const listEpisodeDates = (paths) => fs.readdirSync(paths.episodesDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && EPISODE_DATE.test(path.basename(entry.name, '.md')))
  .map((entry) => path.basename(entry.name, '.md'))
  .sort();

const conversationCounts = (content) => [...String(content ?? '').matchAll(/<!-- conversation-count:(\d+) -->/g)]
  .map((match) => Number(match[1])).filter(Number.isInteger);

const pruneExpiredEpisodes = (paths, now = Date.now(), state = null) => {
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

const migrateLegacyMemory = (modelPath, paths) => {
  const state = readJson(paths.statePath, DEFAULT_STATE);
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
  const summary = legacy?.summary ?? {};
  const recent = legacy?.recent?.messages ?? [];
  const sections = [];
  if (summary.summary) sections.push(`## 近期摘要\n\n${summary.summary}`);
  if (summary.facts?.length) sections.push(`## 已知事实\n\n${summary.facts.map((fact) => `- ${fact}`).join('\n')}`);
  if (summary.open_loops?.length) sections.push(`## 待继续话题\n\n${summary.open_loops.map((item) => `- ${item}`).join('\n')}`);
  if (sections.length) atomicWrite(paths.corePath, fitCoreToLimits(`${DEFAULT_CORE}${sections.join('\n\n')}\n`));

  const grouped = new Map();
  recent.forEach((message) => {
    if (!message?.text) return;
    const date = safeDate(message.ts || Date.now());
    const list = grouped.get(date) ?? [];
    list.push(message);
    grouped.set(date, list);
  });
  for (const [date, messages] of grouped) {
    const episodePath = path.join(paths.episodesDir, `${date}.md`);
    let body = readText(episodePath, `# 对话片段 ${date}\n`);
    for (const message of messages) {
      const speaker = message.role === 'assistant' ? '角色' : '用户';
      body += `\n### ${new Date(message.ts || Date.now()).toLocaleTimeString('zh-CN', { hour12: false })} · ${speaker}\n\n${message.text}\n`;
    }
    atomicWrite(episodePath, body);
  }
  const migratedState = {
    ...DEFAULT_STATE,
    ...state,
    conversationCount: Math.floor((legacy?.meta?.messageCount ?? 0) / 2),
    lastConversationAt: legacy?.meta?.lastMessageAt ?? 0,
    lastConsolidatedCount: Math.floor((legacy?.meta?.lastSummarizedCount ?? 0) / 2),
    legacyMigratedAt: Date.now(),
  };
  writeJson(paths.statePath, migratedState);
  return migratedState;
};

const unquoteEpisodeText = (value) => String(value ?? '')
  .split(/\r?\n/).map((line) => line.replace(/^> ?/, '')).join('\n').trim();

const parseEpisodeBlocks = (content, date) => {
  const markedBlocks = String(content ?? '').split(/(?=<!-- conversation-count:\d+ -->)/g).filter((block) => /conversation-count:\d+/.test(block));
  const rawBlocks = markedBlocks.length
    ? markedBlocks
    : String(content ?? '').split(/(?=^###\s+.+?\s+·\s+(?:用户|角色)\s*$)/m).filter((block) => /^###\s+.+?\s+·\s+(?:用户|角色)\s*$/m.test(block));
  return rawBlocks.map((block) => {
    const count = Number(block.match(/<!-- conversation-count:(\d+) -->/)?.[1]);
    const time = block.match(/^###\s+(.+)$/m)?.[1]?.trim() ?? '';
    const userMatch = block.match(/\*\*用户\*\*\s*\n([\s\S]*?)(?=\n\s*\*\*角色\*\*|$)/);
    const assistantMatch = block.match(/\*\*角色\*\*\s*\n([\s\S]*)$/);
    const legacyMatch = block.match(/^###\s+(.+?)\s+·\s+(用户|角色)\s*\n\n([\s\S]*)$/m);
    const userText = unquoteEpisodeText(userMatch?.[1] ?? (legacyMatch?.[2] === '用户' ? legacyMatch[3] : ''));
    const assistantText = unquoteEpisodeText(assistantMatch?.[1] ?? (legacyMatch?.[2] === '角色' ? legacyMatch[3] : ''));
    return {
      date,
      time,
      conversationCount: Number.isInteger(count) ? count : 0,
      userText,
      assistantText,
      rawText: block.trim(),
    };
  }).filter((block) => block.userText || block.assistantText);
};

const tokenizeForBm25 = (value) => {
  const text = String(value ?? '').toLowerCase();
  const tokens = [];
  const latin = text.match(/[a-z0-9_]+/g) ?? [];
  tokens.push(...latin);
  const cjk = [...text].filter((char) => /[\u3400-\u9fff]/u.test(char));
  if (cjk.length === 1) tokens.push(cjk[0]);
  for (let index = 0; index < cjk.length - 1; index += 1) tokens.push(`${cjk[index]}${cjk[index + 1]}`);
  return tokens.filter(Boolean);
};

const bm25Scores = (query, documents) => {
  const queryTokens = [...new Set(tokenizeForBm25(query))];
  if (!queryTokens.length) return documents.map(() => 0);
  const tokenized = documents.map((document) => tokenizeForBm25(document));
  const documentFrequency = new Map();
  tokenized.forEach((tokens) => {
    for (const token of new Set(tokens)) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
  });
  const averageLength = tokenized.reduce((sum, tokens) => sum + tokens.length, 0) / Math.max(1, tokenized.length);
  const k1 = 1.2;
  const b = 0.75;
  return tokenized.map((tokens) => {
    const frequencies = new Map();
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

const pendingEpisodes = (paths, state) => {
  const pending = [];
  for (const date of listEpisodeDates(paths)) {
    const content = readText(path.join(paths.episodesDir, `${date}.md`));
    parseEpisodeBlocks(content, date).forEach((block) => {
      if (block.conversationCount > (state.lastConsolidatedCount ?? 0)) {
        pending.push({ count: block.conversationCount, date, text: block.rawText });
      }
    });
  }
  pending.sort((a, b) => a.count - b.count);
  const pendingBatch = [];
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

export const loadModelMemoryDocuments = (modelPath) => {
  const paths = ensureMemoryFiles(modelPath);
  const state = { ...DEFAULT_STATE, ...migrateLegacyMemory(modelPath, paths) };
  const deletedCount = pruneExpiredEpisodes(paths, Date.now(), state);
  if (deletedCount > 0) writeJson(paths.statePath, state);
  const pending = pendingEpisodes(paths, state);
  const episodeDates = listEpisodeDates(paths);
  return {
    coreText: readText(paths.corePath),
    // 只返回日期索引；原始 episode 只能通过显式历史查询读取。
    episodes: [],
    episodeDates,
    episodeCount: episodeDates.length,
    state: { ...DEFAULT_STATE, ...state },
    pendingEpisodeText: pending.text,
    pendingThroughCount: pending.throughCount,
    pendingSinceDate: pending.sinceDate,
    actionCatalogChat: readText(paths.actionCatalogChatPath).slice(-MAX_ACTION_CHAT_BYTES),
  };
};

export const recallModelMemoryEpisodes = (modelPath, {
  dates = [], query = '', speaker = 'both', approximate = false, maxChars = MAX_EPISODE_RECALL_CHARS,
} = {}) => {
  const paths = ensureMemoryFiles(modelPath);
  const state = { ...DEFAULT_STATE, ...migrateLegacyMemory(modelPath, paths) };
  const deletedCount = pruneExpiredEpisodes(paths, Date.now(), state);
  if (deletedCount > 0) writeJson(paths.statePath, state);
  const availableDates = new Set(listEpisodeDates(paths));
  const requestedDates = [...new Set(Array.isArray(dates) ? dates : [])]
    .filter((date) => EPISODE_DATE.test(String(date)) && availableDates.has(date));
  const expired = Array.isArray(dates) && dates.length > 0 && requestedDates.length === 0;
  if (!requestedDates.length) return { status: expired ? 'expired' : 'empty', dates: [], approximate, matches: [], text: '' };

  const blocks = requestedDates.flatMap((date) => parseEpisodeBlocks(
    readText(path.join(paths.episodesDir, `${date}.md`)), date,
  )).map((block) => ({
    ...block,
    searchText: speaker === 'user' ? block.userText : speaker === 'assistant' ? block.assistantText : `${block.userText}\n${block.assistantText}`,
  })).filter((block) => block.searchText);
  const scores = bm25Scores(query, blocks.map((block) => block.searchText));
  const queryHasTerms = tokenizeForBm25(query).length > 0;
  const scored = blocks.map((block, index) => ({
    ...block,
    score: queryHasTerms ? scores[index] : Math.max(0.1, block.searchText.length / 120),
    ageBand: deriveEpisodeAgeBand(block.date),
  })).filter((block) => !queryHasTerms || block.score > 0);
  scored.sort((left, right) => right.score - left.score
    || right.date.localeCompare(left.date)
    || right.conversationCount - left.conversationCount);
  const selected = [];
  let usedChars = 0;
  for (const block of scored) {
    const itemChars = block.userText.length + block.assistantText.length + block.date.length + block.time.length + 40;
    if (selected.length && usedChars + itemChars > Math.min(MAX_EPISODE_RECALL_CHARS, Math.max(500, maxChars))) continue;
    selected.push({
      date: block.date,
      time: block.time,
      conversationCount: block.conversationCount,
      userText: block.userText,
      assistantText: block.assistantText,
      score: Number(block.score.toFixed(4)),
      ageBand: block.ageBand,
    });
    usedChars += itemChars;
  }
  return {
    status: selected.length ? 'ok' : 'no-match',
    dates: requestedDates,
    approximate,
    matches: selected,
    text: selected.map((item) => `【${item.date} ${item.time}】\n用户：${item.userText}\n角色：${item.assistantText}`).join('\n\n'),
  };
};

export const appendModelMemoryConversation = (modelPath, conversation) => {
  const paths = ensureMemoryFiles(modelPath);
  const state = { ...DEFAULT_STATE, ...readJson(paths.statePath, DEFAULT_STATE) };
  pruneExpiredEpisodes(paths, Date.now(), state);
  state.conversationCount += 1;
  state.lastConversationAt = Number.isFinite(conversation?.at) ? Math.floor(conversation.at) : Date.now();
  const { date, block } = toEpisodeBlock({ ...conversation, conversationCount: state.conversationCount });
  const episodePath = path.join(paths.episodesDir, `${date}.md`);
  let content = readText(episodePath, `# 对话片段 ${date}\n`);
  if (Buffer.byteLength(content + block, 'utf8') > MAX_EPISODE_BYTES) throw new Error('当天记忆归档超过 512 KB，已停止追加');
  atomicWrite(episodePath, `${content}${block}`);
  writeJson(paths.statePath, state);
  return loadModelMemoryDocuments(modelPath);
};

export const updateModelMemoryCore = (modelPath, content) => {
  if (typeof content !== 'string') throw new TypeError('核心记忆必须是 Markdown 文本');
  const normalized = normalizeCore(content);
  assertCoreLimits(normalized);
  const paths = ensureMemoryFiles(modelPath);
  atomicWrite(paths.corePath, normalized);
  return loadModelMemoryDocuments(modelPath);
};

export const updateModelMemoryMaintenanceState = (modelPath, patch = {}) => {
  const paths = ensureMemoryFiles(modelPath);
  const current = { ...DEFAULT_STATE, ...readJson(paths.statePath, DEFAULT_STATE) };
  const next = { ...current };
  if (Number.isFinite(patch.lastConsolidatedCount)) next.lastConsolidatedCount = Math.max(0, Math.floor(patch.lastConsolidatedCount));
  if (Number.isFinite(patch.lastDecayAt)) next.lastDecayDate = safeDate(patch.lastDecayAt);
  writeJson(paths.statePath, next);
  return next;
};

export const saveModelMemoryConsolidation = (modelPath, { content, processedThroughCount } = {}) => {
  if (!Number.isFinite(processedThroughCount)) throw new TypeError('记忆整理必须提供已处理的对话游标');
  updateModelMemoryCore(modelPath, content);
  const paths = ensureMemoryFiles(modelPath);
  const current = { ...DEFAULT_STATE, ...readJson(paths.statePath, DEFAULT_STATE) };
  current.lastConsolidatedCount = Math.min(current.conversationCount, Math.max(current.lastConsolidatedCount, Math.floor(processedThroughCount)));
  current.lastDecayDate = safeDate(Date.now());
  writeJson(paths.statePath, current);
  return loadModelMemoryDocuments(modelPath);
};

export const replaceActionCatalogChat = (modelPath, content) => {
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
  return loadModelMemoryDocuments(modelPath);
};

export const getModelMemoryEpisodeAgeBand = deriveEpisodeAgeBand;
