interface WindowCommandIntentPayload {
  intentId: string;
  epoch?: number;
  source: string;
  kind: 'position' | 'size' | 'bounds' | 'drag-state';
  payload?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    anchorCenter?: number;
    phase?: 'start' | 'move' | 'end';
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
export const createWindowCommandGateway = (): WindowCommandGateway => {
  const sendWindowIntent = async (intent: WindowCommandIntentPayload): Promise<PetWindowIntentAck | undefined> => {
    if (typeof window === 'undefined') return undefined;
    const bridge = window.WindowAPI?.sendWindowIntent;
    if (typeof bridge !== 'function') {
      throw new Error('WindowAPI.sendWindowIntent is not available');
    }
    return bridge(intent);
  };

  return {
    sendWindowIntent,
  };
};