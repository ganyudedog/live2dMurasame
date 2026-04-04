import type { DragSessionState } from '../DragSessionController';
import { resolveBubbleResizePolicy } from '../policy/WindowPolicyEngine';
import { debug } from '../../../../../utils/log';

type RefLike<T> = { current: T };

export interface BubbleResizeOrchestratorDeps {
  isDevToolsOpenedNow: () => boolean;
  isDevtoolsDockedLike: (params: { boundsWidth?: number | null; innerWidth: number; outerWidth?: number | null }) => boolean;
  getWindowCenter: () => number;
  commitBaseline: (nextCenter: number) => number;
  requestResize: (width: number, height: number, options?: { preserveCenterLine?: boolean; source?: string }) => void;
  isWindowPolicySuppressed: () => boolean;
  windowBoundsRef: RefLike<{ x: number; y: number; width: number; height: number } | null>;
  suppressAutoResizeUntilRef: RefLike<number>;
  isWindowDragActiveRef: RefLike<boolean>;
  dragSessionStateRef: RefLike<DragSessionState>;
  targetWindowWidthRef: RefLike<number | null>;
  pendingResizeRef: RefLike<{ width: number; height: number } | null>;
  pendingBoundsPredictionRef: RefLike<{ x: number; y: number; width: number; height: number } | null>;
  pendingResizeIssuedAtRef: RefLike<number | null>;
  suppressResizeForBubbleRef: RefLike<boolean>;
}

/**
 * 气泡触发的窗口宽度治理编排。
 *
 * 该模块只做职责迁移：把 applyWindowWidth 的决策与提交流程从 hook 中抽离，
 * 保持行为不变，便于后续继续并入 GeometryRuntime。
 */
export const handleBubbleWindowWidth = (
  requiredWidth: number,
  deps: BubbleResizeOrchestratorDeps,
): void => {
  if (typeof window === 'undefined') return;
  if (!Number.isFinite(requiredWidth)) return;

  const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

  const dockedLike = deps.isDevtoolsDockedLike({
    boundsWidth: deps.windowBoundsRef.current?.width ?? null,
    innerWidth: typeof window.innerWidth === 'number' ? window.innerWidth : 0,
    outerWidth: typeof window.outerWidth === 'number' ? window.outerWidth : null,
  });

  const decision = resolveBubbleResizePolicy({
    now,
    suppressAutoResizeUntil: deps.suppressAutoResizeUntilRef.current,
    isWindowDragActive: deps.isWindowDragActiveRef.current,
    dragSessionState: deps.dragSessionStateRef.current,
    hasWindowBounds: Boolean(deps.windowBoundsRef.current),
    devToolsOpened: deps.isDevToolsOpenedNow(),
    devtoolsDockedLike: dockedLike,
    requiredWidth,
    innerWidth: window.innerWidth,
    desiredHeight: window.innerHeight,
    targetWindowWidth: deps.targetWindowWidthRef.current,
    pendingResize: deps.pendingResizeRef.current,
  });

  debug('pet.resize', 'bubbleResize.policy', {
    requiredWidth,
    normalizedWidth: decision.action === 'skip' ? decision.fallbackWidth : decision.normalizedWidth,
    desiredHeight: window.innerHeight,
    stableHeight: deps.windowBoundsRef.current?.height ?? null,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    boundsWidth: deps.windowBoundsRef.current?.width ?? null,
    boundsHeight: deps.windowBoundsRef.current?.height ?? null,
    boundsX: deps.windowBoundsRef.current?.x ?? null,
    boundsY: deps.windowBoundsRef.current?.y ?? null,
    targetWindowWidth: deps.targetWindowWidthRef.current,
    pendingWidth: deps.pendingResizeRef.current?.width ?? null,
    dragSessionState: deps.dragSessionStateRef.current,
    fallbackWidth: decision.action === 'skip' ? decision.fallbackWidth : null,
    decisionAction: decision.action,
    decisionReason: decision.action === 'skip' ? decision.reason : 'policy-allowed',
    policySuppressed: deps.isWindowPolicySuppressed() ? 1 : 0,
  });

  if (decision.action === 'skip') {
    deps.pendingResizeRef.current = null;
    deps.pendingBoundsPredictionRef.current = null;
    deps.targetWindowWidthRef.current = decision.fallbackWidth;
    deps.suppressResizeForBubbleRef.current = false;
    return;
  }

  deps.targetWindowWidthRef.current = decision.normalizedWidth;
  if (decision.action === 'noop') {
    return;
  }

  if (!deps.pendingResizeRef.current) {
    const baselineCenter = deps.getWindowCenter();
    if (Number.isFinite(baselineCenter)) {
      deps.commitBaseline(baselineCenter);
    }
  }
  deps.pendingResizeRef.current = { width: decision.normalizedWidth, height: decision.desiredHeight };
  deps.pendingResizeIssuedAtRef.current = typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

  deps.requestResize(decision.normalizedWidth, decision.desiredHeight, {
    preserveCenterLine: true,
    source: 'applyWindowWidth',
  });
};