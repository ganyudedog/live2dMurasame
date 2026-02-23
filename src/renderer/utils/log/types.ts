/**
 * Renderer 日志系统类型定义。
 *
 * 设计目标：
 * - DevTools-only：仅输出到 console，不做远端上报/回放。
 * - 结构化：每条日志都是对象，方便筛选 ns/event。
 * - 智能降噪：通过去重聚合（dedupe）与采样聚合（sample）减少刷屏。
 * - 上下文关联：通过 ContextProvider 自动注入 ctx。
 *
 * 注意：本项目约定 debug/高频日志的总开关由 `debugModeEnabled` 提供，
 * logger 层通过 EnabledProvider 获取该状态。
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogEntry = {
  /** 相对时间戳（优先 performance.now） */
  t: number;
  level: LogLevel;
  /** 命名空间：稳定且短，例如 'pet.layout' */
  ns: string;
  /** 事件名：稳定且短，例如 'bounds.changed' */
  event: string;
  /** 可选的简短消息，避免堆叠长文本 */
  msg?: string;
  /** 本次关键参数（结构化），建议避免塞入巨型对象 */
  data?: Record<string, unknown>;
  /** 自动注入的上下文（动态获取） */
  ctx?: Record<string, unknown>;
  /** 聚合/采样元信息：用于描述这是“汇总输出”而不是逐条输出 */
  agg?: {
    kind: 'dedupe' | 'sample';
    key: string;
    count: number;
    firstT: number;
    lastT: number;
    windowMs: number;
  };
};

/**
 * 上下文提供者：每次输出都会调用，用于注入 ctx。
 *
 * 约定：返回的对象会被浅拷贝后写入日志，避免引用后续被改动。
 */
export type ContextProvider = () => Record<string, unknown> | null | undefined;

/**
 * 总开关提供者：用于决定 debug 级别日志是否输出。
 *
 * 约定：绑定到 `debugModeEnabled`（控制面板开关 + 同步 live2denv.json）。
 */
export type EnabledProvider = () => boolean;

export type AggInput = {
  level: LogLevel;
  ns: string;
  event: string;
  /**
   * 同类归并 key。
   * 建议：同一事件维度使用稳定 key，例如 'mainWindow'、requestId 或 modelPath。
   */
  key: string;
  /** 汇总窗口大小；到期输出 1 条 summary（默认由实现层决定） */
  windowMs?: number;
  msg?: string;
  data?: Record<string, unknown>;
};

export type SampleInput = {
  /** 采样日志仅允许 info/debug（warn/error 请直接输出或走 dedupe） */
  level: Exclude<LogLevel, 'warn' | 'error'>;
  ns: string;
  event: string;
  /** 同类采样归并 key */
  key: string;
  /** 固定采样周期（默认由实现层决定；本项目默认 500ms） */
  intervalMs?: number;
  /** 单值采样（values/value 二选一） */
  value?: number;
  /** 多值采样（values/value 二选一） */
  values?: Record<string, number>;
  /**
   * 阈值触发：当任意字段的变化量超过阈值时，立即 flush 当前窗口并开启新窗口。
   * 用于避免丢失“突变”这类关键事件。
   */
  thresholds?: Record<string, number>;
  msg?: string;
  /** 附加信息（非数值），例如 requestId、来源标识等 */
  data?: Record<string, unknown>;
};
