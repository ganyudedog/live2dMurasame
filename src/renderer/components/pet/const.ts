export const BUBBLE_MAX_WIDTH = 260; // legacy cap (still used as hard ceiling)
export const BUBBLE_ZONE_BASE_WIDTH = 200; // scale=1 时单侧气泡区域目标宽度
export const BUBBLE_ZONE_MIN_WIDTH = 120; // 单侧最小可用宽度
export const BUBBLE_HEAD_SAFE_GAP = 18; // 头部安全间距
export const BUBBLE_GAP = 16; // 模型和气泡之间的距离
export const BUBBLE_EXTRA_GAP = 100; // 额外左右偏移量，按缩放比放大
export const BUBBLE_PADDING = 12; // 窗口边缘内边距

export const RESIZE_THROTTLE_MS = 120;
export const STARTUP_ENLARGE_BOUNDS_RATIO_GUARD = 1.6; // 启动期 bounds 异常膨胀防护阈值
export const STARTUP_ENLARGE_BASEFRAME_RATIO_GUARD = 0.9; // baseFrame 接近容器宽度时视为可疑
export const ENLARGE_CONFIRM_DELTA_PX = 40; // 放大量两帧确认允许波动
export const ENLARGE_CONFIRM_WINDOW_MS = 260; // 两帧确认最大时间窗
export const CONTEXT_ZONE_LATCH_MS = 1400; // keep context-menu zone active briefly after leaving

export const DEFAULT_TOUCH_PRIORITY = ['hair', 'face', 'xiongbu', 'qunzi', 'leg'] as const;
