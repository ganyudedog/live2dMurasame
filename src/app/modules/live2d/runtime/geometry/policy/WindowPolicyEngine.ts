import type { DragSessionState } from '../DragSessionController';

/**
 * 纯策略：拖动相关状态下是否应禁止 renderer 侧二次窗口治理。
 */
export const isWindowPolicySuppressed = (state: DragSessionState): boolean => {
  return state === 'pending-drag' || state === 'dragging' || state === 'settling';
};

export interface BubbleResizePolicyInput {
  now: number;
  suppressAutoResizeUntil: number;
  isWindowDragActive: boolean;
  dragSessionState: DragSessionState;
  hasWindowBounds: boolean;
  devToolsOpened: boolean;
  devtoolsDockedLike: boolean;
  requiredWidth: number;
  innerWidth: number;
  desiredHeight: number;
  targetWindowWidth: number | null;
  pendingResize: { width: number; height: number } | null;
}

export type BubbleResizePolicyResult =
  | { action: 'skip'; reason: 'suppressed' | 'dragging' | 'missing-bounds' | 'devtools' | 'docked-like'; fallbackWidth: number }
  | { action: 'noop'; normalizedWidth: number }
  | { action: 'queue-resize'; normalizedWidth: number; desiredHeight: number };

export interface AckFollowupPolicyInput {
  now: number;
  suppressAutoResizeUntil: number;
  sameDesired: boolean;
}

export type AckFollowupPolicyResult =
  | { action: 'skip'; reason: 'same-desired' | 'suppressed' }
  | { action: 'send' };

/**
 * 纯策略：根据当前运行时状态判断 bubble 宽度需求是否允许转为窗口 resize。
 */
export const resolveBubbleResizePolicy = ({
  now,
  suppressAutoResizeUntil,
  isWindowDragActive,
  dragSessionState,
  hasWindowBounds,
  devToolsOpened,
  devtoolsDockedLike,
  requiredWidth,
  innerWidth,
  desiredHeight,
  targetWindowWidth,
  pendingResize,
}: BubbleResizePolicyInput): BubbleResizePolicyResult => {
  if (now < suppressAutoResizeUntil) {
    return { action: 'skip', reason: 'suppressed', fallbackWidth: innerWidth };
  }

  if (isWindowDragActive || isWindowPolicySuppressed(dragSessionState)) {
    return { action: 'skip', reason: 'dragging', fallbackWidth: innerWidth };
  }

  if (!hasWindowBounds) {
    return { action: 'skip', reason: 'missing-bounds', fallbackWidth: innerWidth };
  }

  if (devToolsOpened) {
    return { action: 'skip', reason: 'devtools', fallbackWidth: innerWidth };
  }

  if (devtoolsDockedLike) {
    return { action: 'skip', reason: 'docked-like', fallbackWidth: innerWidth };
  }

  const normalizedWidth = Math.max(Math.round(requiredWidth), 320);
  const pendingMatches = pendingResize
    && Math.abs(pendingResize.width - normalizedWidth) <= 1
    && Math.abs(pendingResize.height - desiredHeight) <= 1;
  if (pendingMatches) {
    return { action: 'noop', normalizedWidth };
  }

  if (Math.abs(innerWidth - normalizedWidth) <= 1) {
    return { action: 'noop', normalizedWidth };
  }

  if (targetWindowWidth !== null && Math.abs(targetWindowWidth - normalizedWidth) <= 1 && !pendingResize) {
    return { action: 'noop', normalizedWidth };
  }

  return {
    action: 'queue-resize',
    normalizedWidth,
    desiredHeight,
  };
};

/**
 * 纯策略：ack 回流后是否允许继续发送 follow-up resize。
 *
 * 说明：当前实现保持既有行为，只做策略位置收口，不在此处追加新的拖动门控。
 */
export const resolveAckFollowupPolicy = ({
  now,
  suppressAutoResizeUntil,
  sameDesired,
}: AckFollowupPolicyInput): AckFollowupPolicyResult => {
  if (sameDesired) {
    return { action: 'skip', reason: 'same-desired' };
  }

  if (now < suppressAutoResizeUntil) {
    return { action: 'skip', reason: 'suppressed' };
  }

  return { action: 'send' };
};