import { reaction, type IReactionDisposer } from 'mobx';
import type { LogService } from '@app/shared/logging/LogService';
import { PresenceGate, PresenceWatch, RECENT_CHAT_MS, type PresenceExpression } from '../domain/presenceState';
import { createPresenceCapture } from './presenceCapture';

export interface PresenceRuntimeOptions {
  enabled: () => boolean;
  blocked: () => boolean;
  onCue: (text: string, at: number) => void;
  onStartFailed: () => void;
}

/** 摄像头开关、状态观察和主动开口时机。对话服务只接收已经决定要说的一句。 */
export const createPresenceRuntime = (log?: LogService) => {
  const gate = new PresenceGate();
  const watch = new PresenceWatch();
  let capture: ReturnType<typeof createPresenceCapture> | null = null;
  let transition: Promise<void> = Promise.resolve();
  let lastUserInteractionAt = 0;
  let disposeReaction: IReactionDisposer | null = null;
  let options: PresenceRuntimeOptions | null = null;
  let disposed = false;

  const note = (expression: PresenceExpression) => {
    const now = Date.now();
    const current = options;
    if (!current || disposed) return;
    gate.observe(expression, now);
    const recent = lastUserInteractionAt > 0 && now - lastUserInteractionAt < RECENT_CHAT_MS;
    const text = watch.observe(expression, now, current.blocked() || recent);
    if (!text) return;
    gate.consumePrompt();
    current.onCue(text, now);
  };

  const sync = async (enabled: boolean) => {
    if (!enabled) {
      await capture?.stop();
      capture = null;
      gate.reset();
      watch.reset();
      return;
    }
    if (capture || disposed) return;
    const next = createPresenceCapture({
      onExpression: note,
      onError: (error) => log?.warn('PresenceCapture', 'frame.failed', { message: error.message }),
    });
    try {
      await next.start();
    } catch (error) {
      await next.stop();
      options?.onStartFailed();
      throw error;
    }
    if (disposed || !options?.enabled()) {
      await next.stop();
      return;
    }
    capture = next;
  };

  const schedule = (enabled: boolean) => {
    transition = transition.then(() => sync(enabled)).catch((error: unknown) => {
      const context = log?.contextRegistry.register('PresenceCapture', {
        relation: 'presence', params: { enabled }, behavior: '开关摄像头面部状态',
      });
      const trace = context?.beginTrace('sync');
      trace?.fail('摄像头状态同步失败', {}, error);
      context?.dispose();
    });
  };

  return {
    bind(next: PresenceRuntimeOptions) {
      if (disposeReaction || disposed) return;
      options = next;
      disposeReaction = reaction(() => next.enabled(), schedule);
    },
    noteUserInteraction(at = Date.now()) {
      lastUserInteractionAt = at;
    },
    consumePrompt(): string | null {
      return gate.consumePrompt();
    },
    async stop() {
      disposed = true;
      disposeReaction?.();
      disposeReaction = null;
      await capture?.stop();
      capture = null;
      gate.reset();
      watch.reset();
    },
  };
};
