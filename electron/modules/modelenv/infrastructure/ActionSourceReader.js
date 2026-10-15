import fs from 'node:fs';
import path from 'node:path';
import { summarizeMotionCurve } from '../domain/motionCurveSummary.js';

const kinds = ['linear', 'bezier', 'stepped', 'inverseStepped'];

// Cubism motion3 Segments: initial (time,value), then kind and 1/3 points.
function decodeCurve(curve, durationMs) {
  const data = curve.Segments;
  if (typeof curve.Id !== 'string' || !Array.isArray(data) || data.length < 2
    || data.some((n) => typeof n !== 'number' || !Number.isFinite(n))) throw new Error('无效的 motion 参数曲线');
  let cursor = 0;
  const point = () => {
    if (cursor + 1 >= data.length) throw new Error(`参数 ${curve.Id} 的曲线不完整`);
    const result = { timeMs: data[cursor++] * 1000, value: data[cursor++] };
    if (result.timeMs < 0 || result.timeMs > durationMs + 1) throw new Error(`参数 ${curve.Id} 的时间越界`);
    return result;
  };
  const initial = point();
  let previous = initial.timeMs;
  const values = [initial.value];
  const segments = [];
  while (cursor < data.length) {
    const type = data[cursor++];
    if (!Number.isInteger(type) || !kinds[type]) throw new Error(`未知曲线类型 ${type}`);
    const points = Array.from({ length: type === 1 ? 3 : 1 }, point);
    if (points.at(-1).timeMs <= previous) throw new Error(`参数 ${curve.Id} 的曲线时间未递增`);
    previous = points.at(-1).timeMs;
    values.push(...points.map((p) => p.value));
    segments.push({ kind: kinds[type], points });
  }
  return { parameterId: curve.Id, initial, segments,
    observedMin: Math.min(...values), observedMax: Math.max(...values) };
}

export function readActionSources(modelPath) {
  const root = fs.realpathSync(modelPath);
  const read = (relative) => {
    if (typeof relative !== 'string' || !relative) throw new Error('模型缺少动作文件路径');
    const file = fs.realpathSync(path.resolve(root, relative));
    const relation = path.relative(root, file);
    if (relation.startsWith('..') || path.isAbsolute(relation)) throw new Error('动作文件位于模型目录之外');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  };
  const modelFile = fs.readdirSync(root).find((name) => name.endsWith('.model3.json'));
  if (!modelFile) throw new Error('模型目录缺少 model3.json');
  const model = read(modelFile);
  const names = new Map();
  if (model.FileReferences?.DisplayInfo) {
    for (const item of read(model.FileReferences.DisplayInfo).Parameters ?? []) {
      if (typeof item.Id === 'string' && typeof item.Name === 'string') names.set(item.Id, item.Name);
    }
  }
  const parameters = new Map();
  const motions = Object.entries(model.FileReferences?.Motions ?? {}).flatMap(([group, entries]) => {
    if (!Array.isArray(entries)) throw new Error('模型原生动作清单无效');
    return entries.map((entry, index) => {
      const motion = read(entry.File);
      const durationMs = motion.Meta?.Duration * 1000;
      if (!Number.isFinite(durationMs) || durationMs <= 0 || !Array.isArray(motion.Curves)) throw new Error(`动作 ${group}:${index} 内容无效`);
      // Editor 可将 Meta.Duration 舍入到两位小数，但末关键帧保留三位；允许一帧的导出误差。
      const frameMs = 1000 / (Number.isFinite(motion.Meta.Fps) && motion.Meta.Fps > 0 ? motion.Meta.Fps : 30);
      const decoded = motion.Curves.filter((curve) => curve.Target === 'Parameter')
        .map((curve) => decodeCurve(curve, durationMs + frameMs));
      const actualDurationMs = Math.max(durationMs, ...decoded.map((curve) => curve.segments.at(-1)?.points.at(-1).timeMs ?? curve.initial.timeMs));
      const curves = decoded.map(summarizeMotionCurve);
      for (const curve of curves) {
        const existing = parameters.get(curve.parameterId);
        parameters.set(curve.parameterId, { id: curve.parameterId,
          ...(names.has(curve.parameterId) ? { name: names.get(curve.parameterId) } : {}),
          observedMin: Math.min(existing?.observedMin ?? Infinity, curve.observedMin),
          observedMax: Math.max(existing?.observedMax ?? -Infinity, curve.observedMax) });
      }
      return { group, index, durationMs: actualDurationMs, curves };
    });
  });
  if (!parameters.size) throw new Error('原生动作中没有可读取的参数曲线');
  return { modelPath, motions, parameters: [...parameters.values()] };
}
