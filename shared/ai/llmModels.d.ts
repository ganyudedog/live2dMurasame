/**
 * 档位值是开放的：接口可以声明协议之外的扩展档位（ultra、max……），
 * 所以这里是 string 而不是固定联合类型；合法字符由 normalizeEfforts 约束。
 */
export type ReasoningEffortValue = string;
export type EffortSource = 'catalog' | 'error' | 'probe' | 'none';

export interface LlmModelEntry {
  id: string;
  /** 该模型接受哪些思考深度档位（顺序即接口顺序，第一项是默认档）；空数组表示接口不接受 reasoning_effort。 */
  efforts: ReasoningEffortValue[];
  /** 档位的来源：模型列表扩展字段 / 报错消息枚举 / 逐档探测 / 尚未检测。 */
  effortsSource: EffortSource;
  probedAt: number;
}

/** 已知档位顺序，仅用于逐档探测的候选序列；不是白名单。 */
export const KNOWN_REASONING_EFFORTS: readonly ReasoningEffortValue[];
export const EFFORT_SOURCES: readonly EffortSource[];
export const LLM_MODEL_LIMITS: Readonly<{ maxModels: number; maxIdLength: number; maxEfforts: number }>;

export function isEffortToken(value?: string | null): boolean;
export function normalizeEfforts(raw?: readonly string[] | null): ReasoningEffortValue[];
export function normalizeLlmModel(raw?: Partial<LlmModelEntry> | null): LlmModelEntry | null;
export function normalizeLlmModels(raw?: readonly Partial<LlmModelEntry>[] | null): LlmModelEntry[];
export function findLlmModel(models: readonly LlmModelEntry[] | undefined | null, id?: string | null): LlmModelEntry | null;
export function resolveChatEffort(
  models: readonly LlmModelEntry[] | undefined | null,
  modelId?: string | null,
  effort?: string | null,
): ReasoningEffortValue | '';
export function normalizeMemorySelection(
  models: readonly LlmModelEntry[] | undefined | null,
  modelId?: string | null,
  effort?: string | null,
): { memoryModel: string; memoryReasoningEffort: ReasoningEffortValue | '' };
