interface CurvePoint { timeMs: number; value: number }
interface CurveSegment { kind: string; points: CurvePoint[] }
export interface DecodedMotionCurve {
  parameterId: string;
  initial: CurvePoint;
  segments: CurveSegment[];
  observedMin: number;
  observedMax: number;
}

const rounded = (value: number): number => Math.round(value * 10000) / 10000;
const cubic = (a: number, b: number, c: number, d: number, t: number): number =>
  (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * d;

function extrema(a: number, b: number, c: number, d: number): number[] {
  const qa = -a + 3 * b - 3 * c + d;
  const qb = 2 * (a - 2 * b + c);
  const qc = b - a;
  if (Math.abs(qa) < 1e-12) return Math.abs(qb) < 1e-12 ? [] : [-qc / qb];
  const delta = qb * qb - 4 * qa * qc;
  return delta < 0 ? [] : [(-qb + Math.sqrt(delta)) / (2 * qa), (-qb - Math.sqrt(delta)) / (2 * qa)];
}

const endPoint = (segment: CurveSegment): CurvePoint => {
  const end = segment.points.at(-1);
  if (!end) throw new Error('曲线分段缺少终点');
  return end;
};

export function summarizeMotionCurve(curve: DecodedMotionCurve): {
  parameterId: string;
  observedMin: number;
  observedMax: number;
  maxSampleError: number;
  samples: Array<[number, number]>;
} {
  const points: CurvePoint[] = [curve.initial];
  let previous = curve.initial;
  for (const segment of curve.segments) {
    const end = endPoint(segment);
    if (segment.kind === 'bezier') {
      const controlB = segment.points[0];
      const controlC = segment.points[1];
      if (!controlB || !controlC) throw new Error('贝塞尔曲线缺少控制点');
      const samples = [...new Set([0.25, 0.5, 0.75, 1, ...extrema(previous.value, controlB.value, controlC.value, end.value)
        .filter((t) => t > 0 && t < 1)])].sort((left, right) => left - right);
      for (const t of samples) {
        points.push({
          timeMs: cubic(previous.timeMs, controlB.timeMs, controlC.timeMs, end.timeMs, t),
          value: cubic(previous.value, controlB.value, controlC.value, end.value, t),
        });
      }
    } else if (segment.kind === 'stepped') {
      points.push({ timeMs: Math.max(previous.timeMs, end.timeMs - 0.001), value: previous.value }, end);
    } else if (segment.kind === 'inverseStepped') {
      points.push({ timeMs: Math.min(end.timeMs, previous.timeMs + 0.001), value: end.value }, end);
    } else points.push(end);
    previous = end;
  }
  const min = points.reduce((value, point) => Math.min(value, point.value), Infinity);
  const max = points.reduce((value, point) => Math.max(value, point.value), -Infinity);
  const selected = [0, points.length - 1];
  let maxSampleError = 0;
  if (min !== max) while (true) {
    let split = -1;
    maxSampleError = 0;
    for (let span = 1; span < selected.length; span += 1) {
      const start = selected[span - 1] ?? 0;
      const end = selected[span] ?? 0;
      const a = points[start];
      const b = points[end];
      if (!a || !b) continue;
      for (let index = start + 1; index < end; index += 1) {
        const point = points[index];
        if (!point) continue;
        const progress = b.timeMs === a.timeMs ? 1 : (point.timeMs - a.timeMs) / (b.timeMs - a.timeMs);
        const error = Math.abs(point.value - (a.value + (b.value - a.value) * progress));
        if (error > maxSampleError) { maxSampleError = error; split = index; }
      }
    }
    if (maxSampleError <= (max - min) * 0.01 || selected.length >= 32 || split < 0) break;
    selected.push(split);
    selected.sort((left, right) => left - right);
  }
  return {
    parameterId: curve.parameterId,
    observedMin: rounded(min),
    observedMax: rounded(max),
    maxSampleError: rounded(maxSampleError),
    samples: (min === max ? [0] : selected).map((index) => {
      const point = points[index];
      if (!point) throw new Error('曲线采样点缺失');
      return [rounded(point.timeMs), rounded(point.value)] as [number, number];
    }),
  };
}
