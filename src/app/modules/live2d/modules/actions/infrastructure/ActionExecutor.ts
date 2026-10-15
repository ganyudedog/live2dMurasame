import type { ActionDefinition, ActionTrack } from '../domain/types';

interface Transition {
  from: number;
  track: ActionTrack;
  startedAt: number;
  enterMs: number;
  releaseAt: number;
  returnMs: number;
  releaseValue?: number;
}

/** 参数轨迹执行器：进入首帧、线性关键帧动画、回到当前本地结果。 */
export class ActionExecutor {
  private readonly transitions = new Map<string, Transition>();
  private readonly displayed = new Map<string, number>();
  private pendingGroups: ActionDefinition[][] = [];
  private groupIndex = 0;
  private groupEndAt = 0;

  isActive(now: number): boolean {
    return this.pendingGroups.length > 0 || now < this.groupEndAt
      || [...this.transitions.values()].some((transition) => now < transition.releaseAt + transition.returnMs);
  }

  controls(id: string): boolean { return this.transitions.has(id); }

  start(groups: ActionDefinition[][],
    now: number, current: ReadonlyMap<string, number>): void {
    this.release(now);
    this.pendingGroups = groups.slice(1);
    this.groupIndex = 0;
    this.startGroup(groups[0], now, current);
  }

  /** 在渲染帧推进顺序组，不使用独立定时器，打断后不会残留回调补播。 */
  advance(now: number, baseline: () => ReadonlyMap<string, number>): number | undefined {
    if (!this.pendingGroups.length || now < this.groupEndAt) return undefined;
    this.startGroup(this.pendingGroups.shift()!, now, baseline());
    return ++this.groupIndex;
  }

  private startGroup(group: ActionDefinition[], now: number, current: ReadonlyMap<string, number>): void {
    this.groupEndAt = now + Math.max(...group.map((action) => action.enterMs + action.durationMs + action.returnMs));
    // 每个动作保留自己的时序；同组参数冲突由后列动作覆盖，其他参数仍并行运行。
    for (const action of group) for (const track of action.tracks) {
      const from = current.get(track.parameterId) ?? track.keyframes[0].value;
      this.displayed.set(track.parameterId, from);
      this.transitions.set(track.parameterId, { from, track, startedAt: now,
        enterMs: action.enterMs, returnMs: action.returnMs, releaseAt: now + action.enterMs + action.durationMs });
    }
  }

  release(now: number): void {
    this.pendingGroups = [];
    this.groupEndAt = now;
    for (const [id, transition] of this.transitions) {
      if (transition.releaseAt <= now) continue;
      // 打断从最近实际显示值回退，避免跳到未播放到的终点。
      transition.releaseValue = this.displayed.get(id) ?? this.animate(transition, now);
      transition.releaseAt = now;
    }
  }

  sample(id: string, baseline: number, now: number): number {
    const transition = this.transitions.get(id);
    if (!transition) return baseline;
    let value: number;
    if (now >= transition.releaseAt) {
      const progress = transition.returnMs === 0 ? 1 : Math.min(1, (now - transition.releaseAt) / transition.returnMs);
      // 自然结束从轨迹末帧回退；本地 Idle 保持运行，终点跟随当前本地值。
      const from = transition.releaseValue ?? transition.track.keyframes.at(-1)!.value;
      value = from * (1 - progress) + baseline * progress;
      if (progress >= 1) {
        this.transitions.delete(id); this.displayed.delete(id);
        return baseline;
      }
    } else value = this.animate(transition, now);
    this.displayed.set(id, value);
    return value;
  }

  private animate(transition: Transition, now: number): number {
    const elapsed = Math.max(0, now - transition.startedAt);
    const points = transition.track.keyframes;
    if (elapsed < transition.enterMs) return transition.from
      + (points[0].value - transition.from) * elapsed / transition.enterMs;
    const time = elapsed - transition.enterMs;
    for (let i = 1; i < points.length; i++) {
      if (time <= points[i].timeMs) {
        const before = points[i - 1];
        const after = points[i];
        return before.value + (after.value - before.value) * (time - before.timeMs) / (after.timeMs - before.timeMs);
      }
    }
    return points.at(-1)!.value;
  }

  clear(): void {
    this.transitions.clear(); this.displayed.clear();
    this.pendingGroups = []; this.groupEndAt = 0; this.groupIndex = 0;
  }
}
