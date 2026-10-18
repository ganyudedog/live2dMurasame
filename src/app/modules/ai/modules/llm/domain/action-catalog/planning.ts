import { ACTION_ID_PATTERN, type ActionDefinition } from '../../../../../../../../shared/actionCatalog.js';
import type { ReactionPlan } from './generation';

/** 用稳定候选下标消除不同分析批次同名ID的歧义，计划阶段不重复发送关键帧。 */
export function describeCandidates(candidates: ActionDefinition[]) {
  return candidates.map((action, index) => ({ index, id: action.id, label: action.label,
    description: action.description, category: action.category,
    totalMs: action.enterMs + action.durationMs + action.returnMs,
    parameters: action.tracks.map((track) => track.parameterId) }));
}

export function parseReactionPlans(input: unknown, candidateCount: number): ReactionPlan[] {
  if (!Array.isArray(input) || !input.length || input.length > 12) throw new Error('编排计划必须包含1至12个反应');
  const ids = new Set<string>();
  return input.map((item) => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !ACTION_ID_PATTERN.test(item.id)
      || ids.has(item.id) || typeof item.label !== 'string' || !item.label.trim()
      || typeof item.description !== 'string' || !item.description.trim()
      || !Array.isArray(item.candidateIndexes) || !item.candidateIndexes.length || item.candidateIndexes.length > 3
      || new Set(item.candidateIndexes).size !== item.candidateIndexes.length
      || item.candidateIndexes.some((index: unknown) => typeof index !== 'number' || !Number.isInteger(index)
        || index < 0 || index >= candidateCount)) throw new Error('编排计划包含无效ID、描述或候选引用');
    ids.add(item.id);
    return { id: item.id, label: item.label.trim(), description: item.description.trim(), candidateIndexes: [...item.candidateIndexes] };
  });
}
