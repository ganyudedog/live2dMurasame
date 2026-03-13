interface SendWindowIntent {
  (intent: PetWindowIntentPayload): Promise<PetWindowIntentAck | undefined>;
}

export interface ResizeCommandCommitter {
  createResizeRequestId: () => string;
  createAlignRequestId: () => string;
  sendResizeIntent: (params: {
    requestId: string;
    source: string;
    width: number;
    height: number;
    anchorCenter?: number;
    priority: number;
  }) => Promise<PetWindowIntentAck | undefined>;
  sendAlignIntent: (params: {
    intentId: string;
    targetX: number;
    y: number;
    priority: number;
  }) => Promise<PetWindowIntentAck | undefined>;
}

const buildRequestId = (prefix: string) => {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${t}_${r}`;
};

export const createResizeCommandCommitter = (sendWindowIntent: SendWindowIntent): ResizeCommandCommitter => {
  const sendResizeIntent = ({
    requestId,
    source,
    width,
    height,
    anchorCenter,
    priority,
  }: {
    requestId: string;
    source: string;
    width: number;
    height: number;
    anchorCenter?: number;
    priority: number;
  }) => {
    return sendWindowIntent({
      intentId: requestId,
      source,
      kind: 'size',
      payload: {
        width,
        height,
        anchorCenter,
        requestId,
      },
      priority,
      ts: Date.now(),
    });
  };

  const sendAlignIntent = ({
    intentId,
    targetX,
    y,
    priority,
  }: {
    intentId: string;
    targetX: number;
    y: number;
    priority: number;
  }) => {
    return sendWindowIntent({
      intentId,
      source: 'alignWindowToCenterLine',
      kind: 'position',
      payload: { x: targetX, y },
      priority,
      ts: Date.now(),
    });
  };

  return {
    createResizeRequestId: () => buildRequestId('rsz'),
    createAlignRequestId: () => buildRequestId('align'),
    sendResizeIntent,
    sendAlignIntent,
  };
};
