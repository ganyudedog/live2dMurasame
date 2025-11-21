/* eslint-disable @typescript-eslint/no-explicit-any */
import { Live2DModel } from './runtime';

interface MotionManagerOptions {
  idleGroups?: string[]; // override idle groups
  idleMinMs?: number;
  idleMaxMs?: number;
  debug?: boolean; // 是否输出调试信息
}

export class MotionManager {
  private model: Live2DModel | null = null;
  private idleTimer: any = null;
  private options: MotionManagerOptions;
  private allGroups: string[] = [];
  private groupMotionCounts: Record<string, number> = {};
  // baseIdleGroup 目前未使用；后续可能用于“回到 Idle 再播放”策略
  /* @deprecated unused for now */
  private baseIdleGroup: string | null = null;
  private lastGroup: string | null = null;
  private debug = false;

  constructor(options?: MotionManagerOptions) {
    this.options = { idleMinMs: 20000, idleMaxMs: 40000, debug: false, ...options };
    this.debug = !!this.options.debug || !!(globalThis as any)?.LIVE2D_DEBUG;
  }

  attach(model: Live2DModel) {
    this.model = model;
    const settings = (model as any).internalModel?.settings;
    if (settings?.motions) {
      this.allGroups = Object.keys(settings.motions);
      this.groupMotionCounts = Object.fromEntries(
        Object.entries(settings.motions).map(([group, motions]) => [group, Array.isArray(motions) ? motions.length : 0]),
      );
    }
    // 选定基础 Idle 动作，用于打断回退
    const idleCandidates = this.allGroups.filter(g => /idle/i.test(g));
    if (this.options.idleGroups && this.options.idleGroups.length) {
      this.baseIdleGroup = this.options.idleGroups[0];
    } else if (idleCandidates.length) {
      this.baseIdleGroup = idleCandidates[0];
    } else {
      this.baseIdleGroup = this.allGroups[0] || null;
    }
    this.resetIdle();
    this.log('attach()', { groups: this.allGroups, baseIdleGroup: this.baseIdleGroup });
    try {
      const internal = (this.model as any).internalModel;
      const mm = internal?.motionManager;
      if (mm) this.log('internal motionManager keys', Object.keys(mm));
    } catch (e) {
      this.log('read internal motionManager failed', e);
    }
  }

  dispose() {
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.model = null;
  }

  play(group: string, index?: number) {
    if (!this.model) return;
    if (!this.allGroups.includes(group)) return;
    const resolvedIndex = typeof index === 'number' ? index : this.pickRandomIndex(group);
    this.log('play()', { group, index: resolvedIndex });
    try {
      (this.model as any).motion(group, resolvedIndex);
    } catch (e) {
      this.log('play motion error', e);
    }
    this.resetIdle();
    this.lastGroup = group;
  }

  randomIdle() {
    if (!this.model) return;
    const idleGroups = this.options.idleGroups || this.allGroups.filter(g => /idle/i.test(g));
    const source = idleGroups.length ? idleGroups : this.allGroups;
    if (!source.length) return;
    const group = source[Math.floor(Math.random() * source.length)];
    this.play(group, 0);
  }

  private resetIdle() {
    clearTimeout(this.idleTimer);
    const { idleMinMs = 20000, idleMaxMs = 40000 } = this.options;
    const delay = idleMinMs + Math.random() * (idleMaxMs - idleMinMs);
    this.idleTimer = setTimeout(() => this.randomIdle(), delay);
  }

  getGroups() { return this.allGroups; }

  private pickRandomIndex(group: string) {
    const count = this.groupMotionCounts[group] ?? 1;
    if (!Number.isFinite(count) || count <= 1) return 0;
    return Math.floor(Math.random() * count);
  }

  /**
   * 打断当前动作：立即停止当前 motion & 声音 -> 播放基础 idle -> 再播放目标动作
   * 若当前未播放或与目标相同则直接播放目标动作
   */
  interruptAndPlay(targetGroup: string) {
    if (!this.model) return;
    if (!this.allGroups.includes(targetGroup)) return;
    const targetIndex = this.pickRandomIndex(targetGroup);
    const internal = (this.model as any).internalModel;
    const mm = internal?.motionManager;
    // 判断是否正在播放：优先使用 Cubism 的 isFinished()
    const playing = !!(mm && (typeof mm.isFinished === 'function' ? !mm.isFinished() : (mm._currentAudio != null)));
    this.log('interruptAndPlay()', { targetGroup, playing, lastGroup: this.lastGroup, currentPriority: mm?._currentPriority, hasIsFinished: typeof mm?.isFinished === 'function' });
    if (!playing || this.lastGroup === targetGroup) {
      this.play(targetGroup, targetIndex);
      return;
    }
    // 先彻底停止 -> idle(可选) -> 目标（多形态调用，尽量兼容不同版本）
    const FORCE_PRIORITY = 3 as const;
    try { mm?.stopAllMotions?.(); } catch { /* swallow */ }
    try { if (mm?._currentAudio) { mm._currentAudio.pause(); mm._currentAudio.currentTime = 0; } } catch { /* swallow */ }

    const callForce = (group: string, index: number) => {
      // 依次尝试多种调用签名
      const modelAny = this.model as any;
      try { modelAny.motion(group, index, 'force'); return true; } catch (e) { this.log('force by string failed', e); }
      try { modelAny.motion(group, index, undefined, FORCE_PRIORITY); return true; } catch (e) { this.log('force by number failed', e); }
      try { mm?.startMotion?.(group, index, FORCE_PRIORITY); return true; } catch (e) { this.log('startMotion force failed', e); }
      try { mm?.startRandomMotion?.(group, FORCE_PRIORITY); return true; } catch (e) { this.log('startRandomMotion force failed', e); }
      return false;
    };

    // 回到 idle（如果存在），不阻塞失败
    if (this.baseIdleGroup) {
      const idleIndex = this.pickRandomIndex(this.baseIdleGroup);
      const okIdle = callForce(this.baseIdleGroup, idleIndex);
      this.log('play idle attempt', { okIdle, idle: this.baseIdleGroup });
    }

    setTimeout(() => {
      const idx = targetIndex;
      const ok = callForce(targetGroup, idx);
      this.log('forced motion invoked', { targetGroup, index: idx, ok });
      const stillPlaying = typeof mm?.isFinished === 'function' ? !mm.isFinished() : ok;
      this.log('post-interrupt state', { playing: stillPlaying, currentPriority: mm?._currentPriority, currentAudio: !!mm?._currentAudio });
    }, 60);
    this.resetIdle();
    this.lastGroup = targetGroup;
  }

  dump() {
    if (!this.model) { this.log('dump(): no model'); return; }
    try {
      const internal = (this.model as any).internalModel;
      const mm = internal?.motionManager;
      if (!mm) { this.log('dump(): no internal motionManager'); return; }
      const snapshot: Record<string, any> = {};
      Object.keys(mm).slice(0, 30).forEach(k => {
        snapshot[k] = (mm as any)[k];
      });
      this.log('dump snapshot', snapshot);
    } catch (e) {
      this.log('dump error', e);
    }
  }

  private log(...args: any[]) {
    if (this.debug) {
      console.log('[MotionManager]', ...args);
    }
  }
}
