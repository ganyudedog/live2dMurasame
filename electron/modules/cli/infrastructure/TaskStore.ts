import fs from 'node:fs';
import path from 'node:path';
import type { AgentSettings, TaskStatus } from '../service/commandTypes.js';

export interface CallRecord {
  hash: string;
  state: 'reserved' | 'done' | 'failed';
  issuedAt: number;
  result?: unknown;
  error?: string;
}

export interface AgentTaskRecord {
  id: string;
  owner: string;
  workspaceId: string;
  directory: string;
  provider: 'codex';
  prompt: string;
  requestId: string;
  conversationId: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  summary: string;
  sequence: number;
  error?: string;
  parentTaskId?: string;
  providerSessionId?: string;
}

export interface CliLedger {
  version: 1;
  calls: Record<string, CallRecord>;
  tasks: Record<string, AgentTaskRecord>;
  settings: AgentSettings;
}

const emptyLedger = (): CliLedger => ({
  version: 1,
  calls: {},
  tasks: {},
  settings: { workspaces: [], remoteSources: [] },
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isLedger = (value: unknown): value is CliLedger => {
  if (!isRecord(value) || value.version !== 1) return false;
  if (!isRecord(value.calls) || !isRecord(value.tasks) || !isRecord(value.settings)) return false;
  const settings = value.settings;
  return Array.isArray(settings.workspaces) && Array.isArray(settings.remoteSources);
};

/** Small single-writer ledger. Atomic replacement; corrupt data fails closed. */
export class TaskStore {
  readonly file: string;
  data: CliLedger;

  constructor(file: string) {
    this.file = file;
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!isLedger(parsed)) throw new Error('Invalid CLI ledger');
      this.data = parsed;
    } catch (error: unknown) {
      const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT';
      if (!missing) throw error;
      this.data = emptyLedger();
    }
  }

  save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.data), { mode: 0o600 });
    fs.renameSync(temp, this.file);
  }

  collect(now = Date.now()): void {
    for (const [key, call] of Object.entries(this.data.calls)) {
      if (now - call.issuedAt > 24 * 60 * 60 * 1000) delete this.data.calls[key];
    }
    for (const [key, task] of Object.entries(this.data.tasks)) {
      if (['succeeded', 'failed', 'cancelled', 'interrupted'].includes(task.status)
        && now - task.updatedAt > 7 * 24 * 60 * 60 * 1000) delete this.data.tasks[key];
    }
    this.save();
  }
}
