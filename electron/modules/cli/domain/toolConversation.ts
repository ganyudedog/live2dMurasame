import type { CommandClaim } from '../../../../shared/cli/contracts.js';

export interface ToolOperation {
  invocationId: string;
  command: string;
  args: string;
  status: 'pending' | 'succeeded' | 'failed';
  result?: string;
}
export interface ToolTurn {
  requestId: string;
  userText: string;
  operations: ToolOperation[];
  /** Loop completion does not imply that every operation or submitted task succeeded. */
  loopStatus: 'running' | 'completed' | 'failed';
  loopError?: string;
  assistantText?: string;
}
export interface ToolConversation {
  revision: number;
  summary: string;
  /** Exact identifiers are retained separately from lossy model summaries. */
  facts: string[];
  turns: ToolTurn[];
}
export const CONTEXT_BYTES = 20 * 1024;
const TRIM_NOTICE = '部分历史或操作明细因容量限制已省略；状态不明时重新查询，不要推断执行结果。';
export const canCompactTurn = (turn: ToolTurn): boolean => turn.loopStatus !== 'running'
  && turn.assistantText !== undefined && turn.operations.every((operation) => operation.status !== 'pending');
export const byteSize = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');
export const limitText = (text: string, bytes: number): string => {
  if (Buffer.byteLength(text, 'utf8') <= bytes) return text;
  let result = '';
  let size = 0;
  const suffix = '\n[内容截断，请按需重新查询]';
  for (const char of text) {
    size += Buffer.byteLength(char, 'utf8');
    if (size > bytes - Buffer.byteLength(suffix, 'utf8')) break;
    result += char;
  }
  return `${result}${suffix}`;
};
export const operationText = (value: unknown): string => {
  const text = JSON.stringify(value) ?? 'null';
  if (Buffer.byteLength(text, 'utf8') <= 6000) return text;
  const facts = value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).filter(([key, item]) => ['id', 'status', 'exitCode', 'success'].includes(key)
      && ['string', 'number', 'boolean'].includes(typeof item))
      .map(([key, item]) => [key, typeof item === 'string' ? limitText(item, 128) : item])) : {};
  return JSON.stringify({ ...facts, truncated: true, preview: limitText(text, 2200) });
};

/** Keep statuses and the actual reply even when one operation returns very large output. */
const boundedTurn = (turn: ToolTurn, budget: number): { turn: ToolTurn; truncated: boolean } => {
  const view = structuredClone(turn);
  const truncated = byteSize(view) > budget;
  for (const fieldBudget of [2048, 512, 128]) {
    if (byteSize(view) <= budget) return { turn: view, truncated };
    for (const operation of view.operations) {
      operation.args = limitText(operation.args, fieldBudget);
      if (operation.result) operation.result = limitText(operation.result, fieldBudget);
    }
    view.userText = limitText(view.userText, Math.max(1024, fieldBudget));
    if (view.assistantText) view.assistantText = limitText(view.assistantText, Math.max(1024, fieldBudget));
    if (view.loopError) view.loopError = limitText(view.loopError, fieldBudget);
  }
  while (byteSize(view) > budget && view.operations.length > 1) {
    view.operations.shift();
  }
  return { turn: view, truncated };
};

export const boundConversationStorage = (state: ToolConversation): void => {
  let omitted = false;
  state.turns = state.turns.map((turn) => {
    const bounded = boundedTurn(turn, 32 * 1024);
    omitted ||= bounded.truncated;
    return bounded.turn;
  });
  while (byteSize(state) > 128 * 1024 && state.turns.length > 2) {
    state.turns.shift();
    omitted = true;
  }
  if (omitted && !state.summary.includes(TRIM_NOTICE)) {
    state.summary = `${limitText(state.summary, 4096 - Buffer.byteLength(TRIM_NOTICE) - 1)}\n${TRIM_NOTICE}`;
  }
};

export const rememberIdentifiers = (state: ToolConversation, value: unknown): void => {
  const add = (value: unknown) => {
    const fact = JSON.stringify(value);
    if (Buffer.byteLength(fact) <= 1024) state.facts = [...state.facts.filter((old) => old !== fact), fact];
  };
  const visit = (item: unknown, key = '') => {
    if (typeof item === 'string' && key === 'stdout') {
      // Retain verbatim path lines from discovery; never infer a path from prose.
      for (const line of item.split(/\r?\n/)) {
        if (/^\s*(?:[A-Za-z]:\\|\/)/.test(line) && Buffer.byteLength(line) <= 1024) {
          add({ observedPathLine: line });
        }
      }
    } else if (Array.isArray(item)) item.forEach((child) => visit(child));
    else if (item && typeof item === 'object') {
      const entries = Object.entries(item);
      const identifiers = entries.filter(([name, child]) => typeof child === 'string'
        && /^(id|path|modelPath|FullName|workspaceId|taskId|providerSessionId)$/i.test(name));
      // Keep an id and its path together, so compression cannot swap their association.
      if (identifiers.length) add(Object.fromEntries(identifiers));
      entries.forEach(([name, child]) => visit(child, name));
    }
  };
  visit(value);
  while (byteSize(state.facts) > 4096) state.facts.shift();
};

/** A bounded projection; trimming this view never deletes the persisted journal. */
export const conversationView = (state: ToolConversation, currentRequest: string): CommandClaim => {
  const history = state.turns.filter((turn) => turn.requestId !== currentRequest);
  const bounded = history.map((turn) => boundedTurn(turn, 11 * 1024));
  const view = { summary: state.summary, exactIdentifiers: state.facts, turns: bounded.map((item) => item.turn),
    notice: bounded.some((item) => item.truncated) ? TRIM_NOTICE : undefined };
  while (byteSize(view) > CONTEXT_BYTES && view.turns.length > 1) {
    view.turns.shift();
    view.notice = TRIM_NOTICE;
  }
  if (byteSize(view) > CONTEXT_BYTES) view.summary = limitText(view.summary, 2048);
  const context = JSON.stringify(view);
  // Only compact a contiguous prefix with a delivered reply. Never summarize in-flight work.
  const older: ToolTurn[] = [];
  let compactionTruncated = false;
  for (const turn of history.slice(0, -2)) {
    if (!canCompactTurn(turn)) break;
    const candidate = boundedTurn(turn, 12 * 1024);
    if (byteSize(older) + byteSize(candidate.turn) > 28 * 1024) break;
    older.push(candidate.turn);
    compactionTruncated ||= candidate.truncated;
  }
  return { context, ...(byteSize({ ...view, turns: history }) > CONTEXT_BYTES && older.length ? {
    compaction: { revision: state.revision, throughRequestId: older.at(-1)!.requestId,
      text: JSON.stringify({ summary: state.summary, turns: older, notice: compactionTruncated ? TRIM_NOTICE : undefined }) },
  } : {}) };
};
