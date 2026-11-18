import fs from 'node:fs';
import path from 'node:path';

export interface CallRecord {
  hash: string;
  state: 'reserved' | 'done' | 'failed';
  issuedAt: number;
  result?: unknown;
  error?: string;
}

export interface CliLedger {
  version: 1;
  calls: Record<string, CallRecord>;
}

const emptyLedger = (): CliLedger => ({
  version: 1,
  calls: {},
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isLedger = (value: unknown): value is CliLedger => {
  if (!isRecord(value) || value.version !== 1) return false;
  return isRecord(value.calls);
};

/** Small single-writer ledger. Atomic replacement; corrupt data fails closed. */
export class CallStore {
  readonly file: string;
  data: CliLedger;

  constructor(file: string) {
    this.file = file;
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!isLedger(parsed)) throw new Error('Invalid CLI ledger');
      this.data = { version: 1, calls: parsed.calls };
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
    this.save();
  }
}
