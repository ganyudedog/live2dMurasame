import type { ActionCapability, ActionIntentNormalized } from '../types/action';

interface Live2DCoreModelLike {
  getParameterValueById?: (id: string) => number;
  setParameterValueById?: (id: string, value: number) => void;
}

interface ActiveExecution {
  action: ActionIntentNormalized;
  startAt: number;
  endAt: number;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

// ActionExecutor 负责管理和执行模型动作（如摇头、眨眼、张嘴），根据当前的动作能力和意图，周期性地更新模型参数以实现预期的动画效果。
export class ActionExecutor {
  private active: ActiveExecution | null = null;
  private capability: ActionCapability = {
    canShakeHead: false,
    canBlink: false,
    canMouth: false,
  };

  setCapability(capability: ActionCapability): void {
    this.capability = capability;
  }

  getActiveAction(): ActionIntentNormalized | null {
    return this.active?.action ?? null;
  }

  start(action: ActionIntentNormalized, now: number): void {
    this.active = {
      action,
      startAt: now,
      endAt: now + action.durationMs,
    };
  }

  stop(): void {
    this.active = null;
  }

  tick(core: Live2DCoreModelLike, now: number): { finished: boolean; action?: ActionIntentNormalized } {
    const current = this.active;
    if (!current) return { finished: false };

    const duration = Math.max(1, current.endAt - current.startAt);
    const elapsed = Math.max(0, now - current.startAt);
    const progress = clamp(elapsed / duration, 0, 1);

    this.apply(core, current.action, progress);

    if (progress >= 1) {
      const endedAction = current.action;
      this.active = null;
      return { finished: true, action: endedAction };
    }

    return { finished: false };
  }

  private apply(core: Live2DCoreModelLike, action: ActionIntentNormalized, progress: number): void {
    if (action.kind === 'shake_head') {
      this.applyShakeHead(core, action.intensity, progress);
      return;
    }
    if (action.kind === 'blink') {
      this.applyBlink(core, action.intensity, progress);
      return;
    }
    this.applyMouth(core, action.intensity, progress);
  }

  private applyShakeHead(core: Live2DCoreModelLike, intensity: number, progress: number): void {
    if (!this.capability.canShakeHead || !this.capability.angleXParamId) return;
    const base = core.getParameterValueById?.(this.capability.angleXParamId) ?? 0;
    const amplitude = 4 + intensity * 8;
    const offset = Math.sin(progress * Math.PI * 2.2) * (1 - progress) * amplitude;
    core.setParameterValueById?.(this.capability.angleXParamId, clamp(base + offset, -30, 30));
  }

  private applyBlink(core: Live2DCoreModelLike, intensity: number, progress: number): void {
    if (!this.capability.canBlink || !this.capability.eyeLParamId || !this.capability.eyeRParamId) return;
    const close = progress < 0.5 ? progress * 2 : (1 - progress) * 2;
    const openness = clamp(1 - close * (0.7 + intensity * 0.3), 0, 1);
    core.setParameterValueById?.(this.capability.eyeLParamId, openness);
    core.setParameterValueById?.(this.capability.eyeRParamId, openness);
  }

  private applyMouth(core: Live2DCoreModelLike, intensity: number, progress: number): void {
    if (!this.capability.canMouth || !this.capability.mouthParamId) return;
    const base = core.getParameterValueById?.(this.capability.mouthParamId) ?? 0;
    const pulse = Math.sin(progress * Math.PI);
    const target = clamp(base + pulse * (0.25 + intensity * 0.55), 0, 1);
    core.setParameterValueById?.(this.capability.mouthParamId, target);
  }
}
