import fs from 'node:fs';
import path from 'node:path';
import { summarizeMotionCurve, type DecodedMotionCurve } from '../domain/motionCurveSummary.js';

const kinds = ['linear', 'bezier', 'stepped', 'inverseStepped'] as const;

interface CurvePoint { timeMs: number; value: number }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function decodeCurve(curve: Record<string, unknown>, durationMs: number): DecodedMotionCurve {
  const data = curve.Segments;
  if (typeof curve.Id !== 'string' || !Array.isArray(data) || data.length < 2
    || data.some((item) => typeof item !== 'number' || !Number.isFinite(item))) throw new Error('无效的 motion 参数曲线');
  const samples = data as number[];
  let cursor = 0;
  const point = (): CurvePoint => {
    if (cursor + 1 >= samples.length) throw new Error(`参数 ${curve.Id} 的曲线不完整`);
    const timeMs = (samples[cursor++] ?? 0) * 1000;
    const value = samples[cursor++] ?? 0;
    if (timeMs < 0 || timeMs > durationMs + 1) throw new Error(`参数 ${curve.Id} 的时间越界`);
    return { timeMs, value };
  };
  const initial = point();
  let previous = initial.timeMs;
  const values = [initial.value];
  const segments: DecodedMotionCurve['segments'] = [];
  while (cursor < samples.length) {
    const type = samples[cursor++] ?? -1;
    if (!Number.isInteger(type) || !kinds[type]) throw new Error(`未知曲线类型 ${type}`);
    const decoded = Array.from({ length: type === 1 ? 3 : 1 }, point);
    const last = decoded.at(-1);
    if (!last || last.timeMs <= previous) throw new Error(`参数 ${curve.Id} 的曲线时间未递增`);
    previous = last.timeMs;
    values.push(...decoded.map((item) => item.value));
    segments.push({ kind: kinds[type] ?? 'linear', points: decoded });
  }
  return {
    parameterId: curve.Id,
    initial,
    segments,
    observedMin: Math.min(...values),
    observedMax: Math.max(...values),
  };
}

export function readActionSources(modelPath: string): {
  modelPath: string;
  motions: Array<{ group: string; index: number; durationMs: number; curves: ReturnType<typeof summarizeMotionCurve>[] }>;
  parameters: Array<{ id: string; name?: string; observedMin: number; observedMax: number }>;
} {
  const root = fs.realpathSync(modelPath);
  const read = (relative: unknown): Record<string, unknown> => {
    if (typeof relative !== 'string' || !relative) throw new Error('模型缺少动作文件路径');
    const file = fs.realpathSync(path.resolve(root, relative));
    const relation = path.relative(root, file);
    if (relation.startsWith('..') || path.isAbsolute(relation)) throw new Error('动作文件位于模型目录之外');
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!isRecord(parsed)) throw new Error('动作文件内容无效');
    return parsed;
  };
  const modelFile = fs.readdirSync(root).find((name) => name.endsWith('.model3.json'));
  if (!modelFile) throw new Error('模型目录缺少 model3.json');
  const model = read(modelFile);
  const names = new Map<string, string>();
  const fileReferences = isRecord(model.FileReferences) ? model.FileReferences : {};
  if (fileReferences.DisplayInfo) {
    const display = read(fileReferences.DisplayInfo);
    const parameters = Array.isArray(display.Parameters) ? display.Parameters : [];
    for (const item of parameters) {
      if (isRecord(item) && typeof item.Id === 'string' && typeof item.Name === 'string') names.set(item.Id, item.Name);
    }
  }
  const parameters = new Map<string, { id: string; name?: string; observedMin: number; observedMax: number }>();
  const motionGroups = isRecord(fileReferences.Motions) ? fileReferences.Motions : {};
  const motions = Object.entries(motionGroups).flatMap(([group, entries]) => {
    if (!Array.isArray(entries)) throw new Error('模型原生动作清单无效');
    return entries.map((entry, index) => {
      if (!isRecord(entry)) throw new Error(`动作 ${group}:${index} 内容无效`);
      const motion = read(entry.File);
      const meta = isRecord(motion.Meta) ? motion.Meta : {};
      const durationMs = typeof meta.Duration === 'number' ? meta.Duration * 1000 : Number.NaN;
      if (!Number.isFinite(durationMs) || durationMs <= 0 || !Array.isArray(motion.Curves)) throw new Error(`动作 ${group}:${index} 内容无效`);
      const frameMs = 1000 / (typeof meta.Fps === 'number' && Number.isFinite(meta.Fps) && meta.Fps > 0 ? meta.Fps : 30);
      const decoded = motion.Curves.filter((curve): curve is Record<string, unknown> => isRecord(curve) && curve.Target === 'Parameter')
        .map((curve) => decodeCurve(curve, durationMs + frameMs));
      const actualDurationMs = Math.max(durationMs, ...decoded.map((curve) => curve.segments.at(-1)?.points.at(-1)?.timeMs ?? curve.initial.timeMs));
      const curves = decoded.map(summarizeMotionCurve);
      for (const curve of curves) {
        const existing = parameters.get(curve.parameterId);
        const name = names.get(curve.parameterId);
        parameters.set(curve.parameterId, {
          id: curve.parameterId,
          ...(name ? { name } : {}),
          observedMin: Math.min(existing?.observedMin ?? Infinity, curve.observedMin),
          observedMax: Math.max(existing?.observedMax ?? -Infinity, curve.observedMax),
        });
      }
      return { group, index, durationMs: actualDurationMs, curves };
    });
  });
  if (!parameters.size) throw new Error('原生动作中没有可读取的参数曲线');
  return { modelPath, motions, parameters: [...parameters.values()] };
}
