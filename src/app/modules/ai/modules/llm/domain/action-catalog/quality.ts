import { parseActionCatalog, type ActionDefinition, type ActionSourceData } from '../../../../../../../../shared/actionCatalog.js';
import type { GenerationConstraints, QualityIssue } from './generation';

export function validateActions(value: unknown, sources: ActionSourceData): ActionDefinition[] {
  const actions = parseActionCatalog(value);
  const allowed = new Set(sources.parameters.map(({ id }) => id));
  for (const action of actions) for (const track of action.tracks) {
    if (!allowed.has(track.parameterId)) throw new Error(`动作 ${action.id} 使用未知参数 ${track.parameterId}`);
  }
  return actions;
}

/** 数值检查只发现风险，不把轨迹数量、极值或幅度阈值当作视觉合格证。 */
export function inspectActions(actions: ActionDefinition[], sources: ActionSourceData,
  constraints: GenerationConstraints = {}): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const ranges = new Map(sources.parameters.map((p) => [p.id, p]));
  const signatures = new Map<string, string>();
  for (const action of actions) {
    const add = (code: string, message: string, severity: QualityIssue['severity'] = 'warning') =>
      issues.push({ actionId: action.id, code, message, severity });
    const pose = action.tracks.filter((t) => /^Param(?:Body)?Angle/.test(t.parameterId));
    if (!pose.length) add('detail-only', '没有标准头身姿态轨迹；检查是否只是辅助细节，结合自定义参数语义判断，不强制添加不存在的部位。');
    if (!action.description) add('missing-context', '缺少使用场景和主姿态描述，日常对话模型难以选择。');
    if (!action.enterMs || !action.returnMs) add('abrupt-envelope', '进入或回退为0；检查是否会与动态Idle衔接突兀。');
    for (const track of action.tracks) {
      const points = track.keyframes;
      const values = points.map((p) => p.value);
      const min = Math.min(...values), max = Math.max(...values);
      const low = constraints.parameterMin?.[track.parameterId], high = constraints.parameterMax?.[track.parameterId];
      if ((low !== undefined && min < low - 1e-6) || (high !== undefined && max > high + 1e-6))
        add('protected-range', `${track.parameterId} 的 ${min}..${max} 超出前端保护 ${low ?? '未提供'}..${high ?? '未提供'}，执行时会裁平。`, 'error');
      const native = ranges.get(track.parameterId);
      if (native && (min < native.observedMin || max > native.observedMax))
        add('outside-evidence', `${track.parameterId} 超出原生观测范围；这不是硬边界错误，但需审查外推依据。`);
      if (pose.includes(track)) {
        const amplitude = Math.max(...values.map((v) => Math.abs(v - values[0])));
        let firstMs = 0;
        for (let i = 1; amplitude > 0 && i < points.length; i++) {
          if (Math.abs(points[i].value - values[0]) < amplitude * 0.5) continue;
          // 执行器在线性关键帧之间连续采样，不能把下一个关键帧的时刻当作起效时刻。
          const target = values[0] + Math.sign(points[i].value - values[0]) * amplitude * 0.5;
          firstMs = points[i - 1].timeMs + (target - points[i - 1].value)
            / (points[i].value - points[i - 1].value) * (points[i].timeMs - points[i - 1].timeMs);
          break;
        }
        if (amplitude > 0 && action.enterMs + firstMs > (action.enterMs + action.durationMs) * 0.65)
          add('late-pose', `${track.parameterId} 的明显姿态在时间轴后段才出现，可能在语音结束前来不及表达。`);
      }
    }
    const signature = JSON.stringify({ durationMs: action.durationMs, enterMs: action.enterMs, returnMs: action.returnMs,
      tracks: [...action.tracks].sort((a, b) => a.parameterId.localeCompare(b.parameterId)) });
    const previous = signatures.get(signature);
    if (previous) add('duplicate-motion', `轨迹与 ${previous} 完全相同，检查是否只换了名称。`);
    else signatures.set(signature, action.id);
  }
  return issues;
}
