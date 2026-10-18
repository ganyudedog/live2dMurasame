import { z } from 'zod';
import { GENERATION_VERSION, type GenerationCheckpoint } from '@app/modules/ai/modules/llm/domain/action-catalog/generation';
import { parseActionCatalog } from '../../../../../../../shared/actionCatalog.js';
import { parseReactionPlans } from '@app/modules/ai/modules/llm/domain/action-catalog/planning';


const count = z.number().int().nonnegative();
const issueSchema = z.object({
  actionId: z.string(), code: z.string(), message: z.string(), severity: z.enum(['error', 'warning']), issueId: z.string().optional(),
});
const taskSchema = z.object({
  schemaVersion: z.literal(1), taskId: z.string(), revision: count, currentVersionId: z.string(),
  bestVersionId: z.string(), calls: count, startedAt: z.number().nonnegative(), noProgressCount: count,
  run: count, runCalls: count, elapsedMs: z.number().nonnegative(),
  budget: z.object({ maxCalls: count.positive(), maxDurationMs: count.positive(), maxNoProgress: count.positive() }),
  status: z.enum(['running', 'completed', 'paused', 'failed']),
  stopReason: z.enum(['budget', 'no-progress', 'cancelled', 'error']).optional(),
  stage: z.enum(['analyzing', 'planning', 'composing', 'checking', 'reviewing', 'repairing']).optional(),
  plan: z.array(z.string()).max(20), issues: z.array(issueSchema).max(256), openIssueIds: z.array(z.string()),
  lastSummary: z.string().optional(),
  history: z.array(z.object({ versionId: z.string(), summary: z.string(), issueIds: z.array(z.string()) })).max(24),
});
const reviewSchema = z.object({
  round: count, previousIssues: z.array(issueSchema), reviewIds: z.array(z.string()),
  fingerprint: z.string().optional(), completedIds: z.array(z.string()), issues: z.array(issueSchema),
  evaluated: z.boolean().optional(), repairStarted: z.boolean().optional(), repairIds: z.array(z.string()).optional(),
  best: z.object({ versionId: z.string(), actions: z.array(z.unknown()), issues: z.array(issueSchema), score: z.number().nonnegative() }).optional(),
  seen: z.array(z.string()).max(24),
});
export function parseGenerationTask(value: unknown): GenerationCheckpoint['task'] {
  const result = taskSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

type TaskKind = 'generate' | 'refine';
const storageKey = (path: string, kind: TaskKind = 'generate') => 'pet:action-generation:' + encodeURIComponent(path) + (kind === 'refine' ? ':refine' : '');
const activeCheckpoints = new Map<string, { key: string; checkpoint: GenerationCheckpoint }>();

/** 缓存分析、编排和任务状态。身份为源曲线、生成规则、配置和保护边界的摘要，不落盘API凭证。 */
export async function generationKey(input: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify({ version: GENERATION_VERSION, input }));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function readGenerationCheckpoint(path: string, key: string, kind: TaskKind = 'generate'): GenerationCheckpoint | undefined {
  try {
    const active = activeCheckpoints.get(storageKey(path, kind));
    const entry = active?.key === key ? active : JSON.parse(window.localStorage.getItem(storageKey(path, kind)) ?? 'null');
    if (entry?.key !== key || !entry.checkpoint?.batches || typeof entry.checkpoint.batches !== 'object'
      || Array.isArray(entry.checkpoint.batches)) return undefined;
    const batches: GenerationCheckpoint['batches'] = {};
    for (const [index, actions] of Object.entries(entry.checkpoint.batches)) {
      if (!/^\d+$/.test(index)) return undefined;
      batches[index] = parseActionCatalog(actions);
    }
    const checkpoint: GenerationCheckpoint = { batches };
    const task = parseGenerationTask(entry.checkpoint.task);
    if (task) checkpoint.task = task;
    const response = entry.checkpoint.lastResponse;
    if (typeof response?.key === 'string' && typeof response.text === 'string' && response.text.length <= 500000)
      checkpoint.lastResponse = { key: response.key, text: response.text };
    const refinement = entry.checkpoint.refinement;
    if (refinement && typeof refinement === 'object') {
      checkpoint.refinement = {
        ...(typeof refinement.message === 'string' ? { message: refinement.message } : {}),
        ...(Array.isArray(refinement.actions) ? { actions: parseActionCatalog(refinement.actions) } : {}),
      };
    }
    // 把审查中间结果和最佳动作一起验证，不能只恢复一个孤立的版本号。
    try {
      const review = reviewSchema.parse(entry.checkpoint.review);
      checkpoint.review = { ...review, best: review.best ? {
        ...review.best, actions: parseActionCatalog(review.best.actions),
      } : undefined };
    } catch { /* 旧检查点没有审查状态，继续复用分析和编排草稿。 */ }
    // 旧版只有batches，仍可恢复。组合进度损坏也不丢弃有效分析批次。
    try {
      const value = entry.checkpoint.composition;
      if (value?.version === 'reaction-plan-v1') {
        const plans = value.plans ? parseReactionPlans(value.plans, Object.values(batches).flat().length) : undefined;
        const completed = Object.fromEntries(Object.entries(value.completed ?? {}).map(([id, action]) => {
          const parsed = parseActionCatalog([action])[0];
          if (!plans?.some((p) => p.id === id) || parsed.id !== id) throw new Error('invalid composition');
          return [id, parsed];
        }));
        const draft = value.draft ? parseActionCatalog(value.draft) : undefined;
        checkpoint.composition = { version: 'reaction-plan-v1', plans, completed, draft };
      }
    } catch { /* 继续复用源曲线分析，重新编排组合。 */ }
    return checkpoint;
  } catch { /* 缓存损坏不影响重新生成。 */ }
  return undefined;
}

export function writeGenerationCheckpoint(path: string, key: string, checkpoint: GenerationCheckpoint, kind: TaskKind = 'generate'): boolean {
  // 浏览器配额耗尽时仍保留当前窗口的进度，返回值让UI明确告知持久化失败。
  checkpoint = JSON.parse(JSON.stringify(checkpoint));
  activeCheckpoints.set(storageKey(path, kind), { key, checkpoint });
  try {
    const value = JSON.stringify({ key, checkpoint });
    window.localStorage.setItem(storageKey(path, kind), value);
    return true;
  } catch { return false; }
}

export function clearGenerationCheckpoint(path: string, kind: TaskKind = 'generate'): void {
  activeCheckpoints.delete(storageKey(path, kind));
  try { window.localStorage.removeItem(storageKey(path, kind)); } catch { /* 可选缓存。 */ }
}
