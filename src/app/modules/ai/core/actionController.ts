import { debug, warn } from '@app/shared/logging/compat';
import { detectActionCapability } from '../action/capability';
import { ActionExecutor } from '../action/executor';
import { normalizeActionIntent } from '../action/normalize';
import { actionIntentInputSchema } from '../types/action.schema';
import type { ActionDispatchResult, ActionIntentInput, ActionIntentNormalized, ActionCapability } from '../types/action';

interface Live2DCoreModelLike {
  getParameterCount?: () => number;
  getParameterId?: (index: number) => string;
  getParameterValueById?: (id: string) => number;
  setParameterValueById?: (id: string, value: number) => void;
}

interface ActionControllerOptions {
  dedupeWindowMs?: number;
  maxQueueSize?: number;
}

const DEFAULT_DEDUPE_WINDOW_MS = 220;
const DEFAULT_MAX_QUEUE_SIZE = 4;

const nowPerf = (): number => {
  try {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
  } catch {
    // ignore performance read failure
  }
  return Date.now();
};

export class Live2DActionController {
  private readonly dedupeWindowMs: number;
  private readonly maxQueueSize: number;
  private readonly executor = new ActionExecutor();

  private capability: ActionCapability = {
    canShakeHead: false,
    canBlink: false,
    canMouth: false,
  };

  private queue: ActionIntentNormalized[] = [];
  private lastAcceptedAtByKind = new Map<string, number>();
  private lastSignature = new Map<string, number>();
  private capabilityReady = false;

  constructor(options: ActionControllerOptions = {}) {
    this.dedupeWindowMs = options.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS;
    this.maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
  }

  dispatch(input: ActionIntentInput, source = 'unknown'): ActionDispatchResult {
    const parsed = actionIntentInputSchema.safeParse(input);
    if (!parsed.success) {
      warn('ai.action', 'dispatch.invalid', { source, issues: parsed.error.issues.map((issue) => issue.message) });
      return { ok: false, state: 'dropped', reason: 'invalid' };
    }

    const now = Date.now();
    const action = normalizeActionIntent(parsed.data, now);

    if (!this.supportsAction(action.kind)) {
      return { ok: false, state: 'dropped', reason: 'no-capability' };
    }

    if (this.isInCooldown(action, now)) {
      return { ok: false, state: 'dropped', reason: 'cooldown' };
    }

    if (this.isDuplicate(action, now)) {
      return { ok: false, state: 'dropped', reason: 'duplicate' };
    }

    this.lastAcceptedAtByKind.set(action.kind, now);

    const active = this.executor.getActiveAction();
    if (!active) {
      this.executor.start(action, nowPerf());
      return { ok: true, state: 'started' };
    }

    if (action.priority >= active.priority) {
      this.executor.start(action, nowPerf());
      return { ok: true, state: 'started' };
    }

    this.enqueue(action);
    return { ok: true, state: 'queued' };
  }

  tick(core: Live2DCoreModelLike, nowMs = performance.now()): void {
    if (!this.capabilityReady) {
      this.capability = detectActionCapability(core);
      this.capabilityReady = true;
      this.executor.setCapability(this.capability);
    }

    if (!this.executor.getActiveAction()) {
      const next = this.dequeueNext();
      if (next) {
        this.executor.start(next, nowPerf());
      }
    }

    const result = this.executor.tick(core, nowMs);
    if (result.finished && result.action) {
      debug('ai.action', 'finished', {
        kind: result.action.kind,
        intensity: result.action.intensity,
        durationMs: result.action.durationMs,
      });
    }
  }

  dispose(): void {
    this.queue = [];
    this.executor.stop();
    this.lastAcceptedAtByKind.clear();
    this.lastSignature.clear();
    this.capabilityReady = false;
  }

  getCapability(): ActionCapability {
    return this.capability;
  }

  private supportsAction(kind: ActionIntentNormalized['kind']): boolean {
    if (!this.capabilityReady) return true;
    if (kind === 'shake_head') return this.capability.canShakeHead;
    if (kind === 'blink') return this.capability.canBlink;
    return this.capability.canMouth;
  }

  private isInCooldown(action: ActionIntentNormalized, now: number): boolean {
    const lastAt = this.lastAcceptedAtByKind.get(action.kind) ?? 0;
    return action.cooldownMs > 0 && now - lastAt < action.cooldownMs;
  }

  private isDuplicate(action: ActionIntentNormalized, now: number): boolean {
    const signature = `${action.kind}|${Math.round(action.intensity * 100)}|${Math.round(action.durationMs / 20)}`;
    const lastAt = this.lastSignature.get(signature) ?? 0;
    this.lastSignature.set(signature, now);
    return now - lastAt < this.dedupeWindowMs;
  }

  private enqueue(action: ActionIntentNormalized): void {
    this.queue.push(action);
    this.queue.sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
    if (this.queue.length > this.maxQueueSize) {
      this.queue.length = this.maxQueueSize;
    }
  }

  private dequeueNext(): ActionIntentNormalized | undefined {
    return this.queue.shift();
  }
}

export const createLive2DActionController = (options?: ActionControllerOptions): Live2DActionController => {
  return new Live2DActionController(options);
};
