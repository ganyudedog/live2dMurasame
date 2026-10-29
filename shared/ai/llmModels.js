// 档位是**开放**值域：接口可以声明协议之外的扩展档位（例如 ultra、max）。
// 这里只维护「已知顺序」，用于逐档探测的候选序列；绝不作为白名单去裁剪接口给出的值。
export const KNOWN_REASONING_EFFORTS = Object.freeze([
  'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'ultra', 'max',
]);

export const EFFORT_SOURCES = Object.freeze(['catalog', 'error', 'probe', 'none']);

export const LLM_MODEL_LIMITS = Object.freeze({ maxModels: 64, maxIdLength: 200, maxEfforts: 16 });

// 形如 none / xhigh / ultra-max 的短标识；空串、下划线开头和超长值都不算档位。
const EFFORT_TOKEN = /^[a-z][a-z0-9_.-]{0,31}$/;

export const isEffortToken = (value) => typeof value === 'string' && EFFORT_TOKEN.test(value.trim().toLowerCase());

export function normalizeEfforts(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const efforts = [];
  const seen = new Set();
  for (const item of list) {
    if (!isEffortToken(item)) continue;
    const value = item.trim().toLowerCase();
    if (seen.has(value)) continue;
    seen.add(value);
    efforts.push(value);
    // 保留接口给出的顺序（通常就是 none → max），它同时也是“第一档 = 默认档”的依据。
    if (efforts.length >= LLM_MODEL_LIMITS.maxEfforts) break;
  }
  return efforts;
}

export function normalizeLlmModel(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const id = typeof source.id === 'string' ? source.id.trim().slice(0, LLM_MODEL_LIMITS.maxIdLength) : '';
  if (!id) return null;
  return {
    id,
    efforts: normalizeEfforts(source.efforts),
    effortsSource: EFFORT_SOURCES.includes(source.effortsSource) ? source.effortsSource : 'none',
    probedAt: Number.isFinite(source.probedAt) ? Math.max(0, Math.floor(source.probedAt)) : 0,
  };
}

export function normalizeLlmModels(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const models = [];
  for (const item of list) {
    const model = normalizeLlmModel(item);
    if (!model || seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(model);
    if (models.length >= LLM_MODEL_LIMITS.maxModels) break;
  }
  return models;
}

export function findLlmModel(models, id) {
  const target = typeof id === 'string' ? id.trim() : '';
  if (!target) return null;
  return (Array.isArray(models) ? models : []).find((model) => model.id === target) ?? null;
}

/**
 * 深度只能取该模型探测出来的档位，缺省取第一档；模型没有档位时不发送该参数。
 * 这是唯一允许的“默认值”，来源是模型自身的能力集合，不是写死的常量。
 */
export function resolveChatEffort(models, modelId, effort) {
  const model = findLlmModel(models, modelId);
  if (!model || !model.efforts.length) return '';
  return model.efforts.includes(effort) ? effort : model.efforts[0];
}

/** 记忆整理模型必须已登记；深度同样被约束在该模型的档位内，缺省第一档。 */
export function normalizeMemorySelection(models, modelId, effort) {
  const model = findLlmModel(models, modelId);
  if (!model) return { memoryModel: '', memoryReasoningEffort: '' };
  return {
    memoryModel: model.id,
    memoryReasoningEffort: model.efforts.includes(effort) ? effort : (model.efforts[0] ?? ''),
  };
}
