const STORAGE_KEY = 'pet:llm:selection';

/**
 * 对话与动作表各自的模型/思考深度都只属于前端选择，不落后端：
 * 后端只持久化「有哪些模型可选」（llmModels）与记忆整理用的模型/深度。
 * 放在 shared 下是因为桌宠窗口的语音请求也要拿到同一份对话选择：
 * 只靠控制面板的内存态会让面板未打开时的对话没有模型。
 */
export type LlmSelectionScope = 'chat' | 'action';

export interface LlmSelection {
  model: string;
  effort: PetReasoningEffort | '';
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
);

const readRaw = (): Record<string, unknown> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return isObjectRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const writeRaw = (value: Record<string, unknown>): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch { /* 存储不可用时退化为内存态，不影响本次会话 */ }
};

const findModel = (models: readonly PetLlmModel[], id: unknown): PetLlmModel | null => (
  typeof id === 'string' && id.trim()
    ? models.find((model) => model.id === id.trim()) ?? null
    : null
);

const resolveEffort = (model: PetLlmModel | null, effort: unknown): PetReasoningEffort | '' => {
  if (!model || !model.efforts.length) return '';
  return model.efforts.includes(effort as PetReasoningEffort)
    ? (effort as PetReasoningEffort)
    : model.efforts[0];
};

/**
 * 兼容第一版（只有对话的扁平分法）：{ chatModel, chatEffort }。
 * 动作表是后来加的，老缓存里没有它，读到时就地补成默认，不需要用户重新选。
 */
const readScope = (raw: Record<string, unknown>, scope: LlmSelectionScope): Record<string, unknown> => {
  const nested = raw[scope];
  if (isObjectRecord(nested)) return nested;
  return scope === 'chat' ? { model: raw.chatModel, effort: raw.chatEffort } : {};
};

/**
 * 读取并对着注册表校验。注册表里还有模型时，选择永远不会是空的：
 * 缓存缺失、模型被删或被改名都会收敛到列表第一项，避免下拉框显示与状态不一致。
 */
export const loadLlmSelection = (
  models: readonly PetLlmModel[],
  scope: LlmSelectionScope = 'chat',
): LlmSelection => {
  const raw = readRaw();
  const entry = readScope(raw, scope);
  const stored = findModel(models, entry.model);
  if (stored) return { model: stored.id, effort: resolveEffort(stored, entry.effort) };
  if (models.length) {
    const first = models[0];
    const seeded: LlmSelection = { model: first.id, effort: resolveEffort(first, '') };
    writeRaw({ ...raw, [scope]: seeded });
    return seeded;
  }
  return { model: '', effort: '' };
};

export const saveLlmSelection = (
  models: readonly PetLlmModel[],
  scope: LlmSelectionScope,
  patch: { model?: string; effort?: PetReasoningEffort | '' },
): LlmSelection => {
  const raw = readRaw();
  const current = loadLlmSelection(models, scope);
  const model = findModel(models, patch.model !== undefined ? patch.model : current.model);
  const next: LlmSelection = {
    model: model?.id ?? '',
    effort: resolveEffort(model, patch.effort !== undefined ? patch.effort : current.effort),
  };
  writeRaw({ ...raw, [scope]: next });
  return next;
};
