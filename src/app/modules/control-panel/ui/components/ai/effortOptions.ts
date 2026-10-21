/**
 * 档位选项的展示值与接口返回的 label 完全一致：不做中文/英文映射。
 * 接口声明什么就显示什么（none、xhigh、ultra、max…… 甚至自定义变体），
 * 前端只负责排序与选中，不替接口改名。
 */
export const effortOptionList = (efforts: readonly PetReasoningEffort[]) =>
  efforts.map((value) => ({ value, label: value }));

export const modelOptionList = (models: readonly PetLlmModel[]) =>
  models.map(({ id }) => ({ value: id, label: id }));

export const findModelEfforts = (models: readonly PetLlmModel[], modelId: string): PetReasoningEffort[] =>
  models.find((model) => model.id === modelId)?.efforts ?? [];
