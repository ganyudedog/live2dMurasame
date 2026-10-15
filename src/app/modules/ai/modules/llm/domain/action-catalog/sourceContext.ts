import type { ActionSourceData } from '../../../../../../../../shared/actionCatalog.js';

/** 配置请求分批读取全部参数，避免大模型文件超出单次上下文；不丢弃后面的 motion。 */
export function sourceContexts(sources: ActionSourceData, limit = 60000): unknown[] {
  const batches: unknown[] = [];
  let entries: Array<{ group: string; index: number; durationMs: number; parameterId: string;
    name?: string; observedMin: number; observedMax: number; maxSampleError: number; samples: Array<[number, number]> }> = [];
  let size = 0;
  const names = new Map(sources.parameters.map((parameter) => [parameter.id, parameter.name]));
  for (const motion of sources.motions) for (const curve of motion.curves) {
    const entry = { group: motion.group, index: motion.index, durationMs: motion.durationMs,
      ...curve, ...(names.get(curve.parameterId) ? { name: names.get(curve.parameterId) } : {}) };
    const length = JSON.stringify(entry).length;
    if (entries.length && size + length > limit) { batches.push({ curves: entries }); entries = []; size = 0; }
    entries.push(entry); size += length;
  }
  if (entries.length) batches.push({ curves: entries });
  return batches;
}
