// 仅用于离线 LLM 分析：保留实际时间/数值关键点，避免逐帧导出的曲线挤满上下文。
const rounded = (value) => Math.round(value * 10000) / 10000;
const cubic = (a, b, c, d, t) => (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b
  + 3 * (1 - t) * t ** 2 * c + t ** 3 * d;

function extrema(a, b, c, d) {
  const qa = -a + 3 * b - 3 * c + d;
  const qb = 2 * (a - 2 * b + c);
  const qc = b - a;
  if (Math.abs(qa) < 1e-12) return Math.abs(qb) < 1e-12 ? [] : [-qc / qb];
  const delta = qb * qb - 4 * qa * qc;
  return delta < 0 ? [] : [(-qb + Math.sqrt(delta)) / (2 * qa), (-qb - Math.sqrt(delta)) / (2 * qa)];
}

export function summarizeMotionCurve(curve) {
  const points = [curve.initial];
  let previous = curve.initial;
  for (const segment of curve.segments) {
    const end = segment.points.at(-1);
    if (segment.kind === 'bezier') {
      const [b, c] = segment.points;
      const samples = [...new Set([0.25, 0.5, 0.75, 1, ...extrema(previous.value, b.value, c.value, end.value)
        .filter((t) => t > 0 && t < 1)])].sort((a, b) => a - b);
      for (const t of samples) points.push({ timeMs: cubic(previous.timeMs, b.timeMs, c.timeMs, end.timeMs, t),
        value: cubic(previous.value, b.value, c.value, end.value, t) });
    } else if (segment.kind === 'stepped') {
      points.push({ timeMs: Math.max(previous.timeMs, end.timeMs - 0.001), value: previous.value }, end);
    } else if (segment.kind === 'inverseStepped') {
      points.push({ timeMs: Math.min(end.timeMs, previous.timeMs + 0.001), value: end.value }, end);
    } else points.push(end);
    previous = end;
  }
  // 同时计算贝塞尔极值，避免把控制柄数值误当作实际动作幅度。
  const min = points.reduce((value, p) => Math.min(value, p.value), Infinity);
  const max = points.reduce((value, p) => Math.max(value, p.value), -Infinity);
  const selected = [0, points.length - 1];
  let maxSampleError = 0;
  if (min !== max) while (true) {
    let split = -1;
    maxSampleError = 0;
    for (let span = 1; span < selected.length; span++) {
      const start = selected[span - 1], end = selected[span];
      const a = points[start], b = points[end];
      for (let i = start + 1; i < end; i++) {
        const progress = b.timeMs === a.timeMs ? 1 : (points[i].timeMs - a.timeMs) / (b.timeMs - a.timeMs);
        const error = Math.abs(points[i].value - (a.value + (b.value - a.value) * progress));
        if (error > maxSampleError) { maxSampleError = error; split = i; }
      }
    }
    if (maxSampleError <= (max - min) * 0.01 || selected.length >= 32 || split < 0) break;
    selected.push(split); selected.sort((a, b) => a - b);
  }
  return { parameterId: curve.parameterId, observedMin: rounded(min), observedMax: rounded(max),
    // 该误差只针对已采样点，不宣称是整条连续曲线的数学误差上界。
    maxSampleError: rounded(maxSampleError),
    samples: (min === max ? [0] : selected).map((i) => [rounded(points[i].timeMs), rounded(points[i].value)]) };
}
