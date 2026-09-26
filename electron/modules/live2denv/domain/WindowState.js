import { tryCreateBounds } from './Bounds.js';

export class WindowState {
  constructor({ bounds = null, updatedAt = 0 } = {}) {
    this.bounds = tryCreateBounds(bounds);
    this.updatedAt = Number.isFinite(updatedAt) ? Math.max(0, Math.floor(updatedAt)) : 0;
  }

  recordUserBounds(bounds, updatedAt = Date.now()) {
    const next = tryCreateBounds(bounds);
    if (!next) throw new Error('Cannot persist invalid window bounds');
    return new WindowState({ bounds: next, updatedAt });
  }

  toJSON() {
    return { bounds: this.bounds?.toJSON() ?? null, updatedAt: this.updatedAt };
  }
}
