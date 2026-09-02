export const BUBBLE_MAX_WIDTH = 260; // legacy cap (still used as hard ceiling)
export const BUBBLE_ZONE_BASE_WIDTH = 200; // scale=1 时单侧气泡区域目标宽度
export const BUBBLE_ZONE_MIN_WIDTH = 120; // 单侧最小可用宽度
export const BUBBLE_HEAD_SAFE_GAP = 18; // 头部安全间距
export const BUBBLE_GAP = 16; // 模型和气泡之间的距离
export const BUBBLE_EXTRA_GAP = 100; // 额外左右偏移量，按缩放比放大
export const BUBBLE_PADDING = 12; // 窗口边缘内边距
export const BUBBLE_SIDE_WIDTH = 100; // 三矩形协议中模型左右两侧的默认逻辑宽度
export const BUBBLE_SIDE_MIN_WIDTH = 50; // 缩放后单侧区域仍需保留的最小宽度
export const BUBBLE_SIDE_MAX_WIDTH = 150; // 避免大比例缩放时侧区无界增长

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/** 三矩形协议使用的最终单侧宽度，所有调用方必须共享这一限幅结果。 */
export const resolveBubbleSideWidth = (configuredWidth: number, scale: number): number => {
  const baseWidth = clamp(
    Number.isFinite(configuredWidth) ? configuredWidth : BUBBLE_SIDE_WIDTH,
    BUBBLE_SIDE_MIN_WIDTH,
    BUBBLE_SIDE_MAX_WIDTH,
  );
  const visualScale = clamp(Number.isFinite(scale) ? scale : 1, 0.3, 2);
  return clamp(baseWidth * visualScale, BUBBLE_SIDE_MIN_WIDTH, BUBBLE_SIDE_MAX_WIDTH);
};

/** ChatBubble 在 CSS 缩放前使用的最大宽度，与最终侧区宽度保持一致。 */
export const resolveBubbleContentMaxWidth = (configuredWidth: number, scale: number): number => {
  const visualScale = clamp(Number.isFinite(scale) ? scale : 1, 0.3, 2);
  const sideWidth = resolveBubbleSideWidth(configuredWidth, visualScale);
  return Math.max(44, sideWidth / visualScale - 32);
};

export const STARTUP_ENLARGE_BOUNDS_RATIO_GUARD = 1.6; // 启动期 bounds 异常膨胀防护阈值
export const STARTUP_ENLARGE_BASEFRAME_RATIO_GUARD = 0.9; // baseFrame 接近容器宽度时视为可疑
export const ENLARGE_CONFIRM_DELTA_PX = 40; // 放大量两帧确认允许波动
export const ENLARGE_CONFIRM_WINDOW_MS = 260; // 两帧确认最大时间窗
export const CONTEXT_ZONE_LATCH_MS = 1400; // keep context-menu zone active briefly after leaving
