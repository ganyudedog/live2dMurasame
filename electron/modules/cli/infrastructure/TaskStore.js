import fs from 'node:fs';
import path from 'node:path';

/** Small single-writer ledger. Atomic replacement; corrupt data fails closed. */
export class TaskStore {
  constructor(file) {
    this.file = file;
    try { this.data = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.data = { version: 1, calls: {}, tasks: {}, settings: { workspaces: [], remoteSources: [] } };
    }
    if (this.data.version !== 1 || !this.data.calls || !this.data.tasks || !this.data.settings) throw new Error('Invalid CLI ledger');
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.data), { mode: 0o600 });
    fs.renameSync(temp, this.file);
  }
  collect(now = Date.now()) {
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
