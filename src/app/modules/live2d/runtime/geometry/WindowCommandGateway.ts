import { debug, warn } from '@app/shared/logging/compat';

interface WindowCommandIntentPayload {
  intentId: string;
  epoch?: number;
  source: string;
  kind: 'position' | 'size' | 'bounds';
  payload?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    anchorCenter?: number;
    final?: boolean;
    [key: string]: unknown;
  };
  priority?: number;
  ts?: number;
}

export interface WindowCommandGateway {
  sendWindowIntent: (intent: WindowCommandIntentPayload) => Promise<PetWindowIntentAck | undefined>;
}

/**
 * Renderer 侧窗口命令唯一出口。
 *
 * 当前阶段先统一收口调用点，后续若需要同帧合并/coalescing，
 * 只在这里扩展而不再修改各个布局模块。
 */
export const createWindowCommandGateway = (windowApi: PetWindowAPI | undefined): WindowCommandGateway => {
  const sendWindowIntent = async (intent: WindowCommandIntentPayload): Promise<PetWindowIntentAck | undefined> => {
    const bridge = windowApi?.sendWindowIntent;
    if (typeof bridge !== 'function') {
      throw new Error('WindowAPI.sendWindowIntent is not available');
    }

    debug('pet.resize', 'gateway.intent.send', {
      intentId: intent.intentId,
      kind: intent.kind,
      source: intent.source,
      epoch: Number.isFinite(intent.epoch) ? intent.epoch : null,
      priority: Number.isFinite(intent.priority) ? intent.priority : null,
      x: Number.isFinite(intent.payload?.x) ? intent.payload?.x : null,
      y: Number.isFinite(intent.payload?.y) ? intent.payload?.y : null,
      width: Number.isFinite(intent.payload?.width) ? intent.payload?.width : null,
      height: Number.isFinite(intent.payload?.height) ? intent.payload?.height : null,
      anchorCenter: Number.isFinite(intent.payload?.anchorCenter) ? intent.payload?.anchorCenter : null,
    });

    try {
      const ack = await bridge(intent);
      debug('pet.resize', 'gateway.intent.ack', {
        intentId: intent.intentId,
        kind: intent.kind,
        source: intent.source,
        ackStatus: typeof ack?.status === 'string' ? ack.status : null,
        ackReason: typeof ack?.reason === 'string' ? ack.reason : null,
      });
      return ack;
    } catch (error) {
      warn('pet.resize', 'gateway.intent.error', {
        intentId: intent.intentId,
        kind: intent.kind,
        source: intent.source,
        error: String(error),
      });
      throw error;
    }
  };

  return {
    sendWindowIntent,
  };
};
