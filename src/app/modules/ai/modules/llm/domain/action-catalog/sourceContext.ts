import type { ActionSourceData, MotionParameterCurve } from '../../../../../../../../shared/actionCatalog.js';

export interface EvidenceWindow {
  id: string; group: string; index: number; startMs: number; endMs: number;
  curves: MotionParameterCurve[];
}
export interface SourceContext { windows: EvidenceWindow[] }

const sample = (points: MotionParameterCurve['samples'], time: number): number => {
  if (time <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [end, value] = points[i];
    if (time <= end) {
      const [start, before] = points[i - 1];
      return before + (value - before) * (time - start) / (end - start);
    }
  }
  return points.at(-1)![1];
};

/** 同一窗口保留所有部位及原始时间；边界值由摘要线性插值，仅是证据近似。 */
export function sourceContexts(sources: ActionSourceData, limit = 60000): SourceContext[] {
  const windows: EvidenceWindow[] = [];
  sources.motions.forEach((motion, motionIndex) => {
    const append = (startMs: number, endMs: number) => {
      const window: EvidenceWindow = { id: `m${motionIndex}:${startMs}-${endMs}`, group: motion.group,
        index: motion.index, startMs, endMs, curves: motion.curves.filter((curve) => curve.samples.length).map((curve) => ({
          ...curve, samples: [[startMs, sample(curve.samples, startMs)],
            ...curve.samples.filter(([time]) => time > startMs && time < endMs),
            [endMs, sample(curve.samples, endMs)]],
        })) };
      if (JSON.stringify({ windows: [window] }).length > limit) {
        if (endMs - startMs <= 100) throw new Error('联合动作窗口过大，无法在保留参数关联的情况下分批');
        const middle = Math.floor((startMs + endMs) / 2);
        append(startMs, middle); append(middle, endMs);
      } else windows.push(window);
    };
    // 重叠 400ms，保留跨边界的视线先行、头身跟随等关联。
    for (let start = 0; start < motion.durationMs; start += 2600) {
      const end = Math.min(motion.durationMs, start + 3000);
      append(start, end);
      if (end === motion.durationMs) break;
    }
  });
  const batches: SourceContext[] = [];
  let batch: SourceContext = { windows: [] };
  for (const window of windows) {
    if (batch.windows.length && JSON.stringify({ windows: [...batch.windows, window] }).length > limit) {
      batches.push(batch); batch = { windows: [] };
    }
    batch.windows.push(window);
  }
  if (batch.windows.length) batches.push(batch);
  return batches;
}
