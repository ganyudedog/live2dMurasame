/**
 * 获取当前时间戳（毫秒）。
 *
 * - 优先使用 `performance.now()`：适合 DevTools 中做相对时间排序与对比。
 * - 回退到 `Date.now()`：兼容 performance 不存在/不可用的环境。
 */
export const nowMs = (): number => {
  try {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
  } catch {
    // ignore
  }
  return Date.now();
};
