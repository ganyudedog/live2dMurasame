/**
 * 重新获取模型清单后的收敛：接口这次没返回的模型一律丢弃。
 * 否则“以前选过、现在接口已经没有了”的模型会一直留在后端清单里，选中它只会报错。
 */
export const keepFetchedModels = (
  models: readonly PetLlmModel[],
  fetched: readonly { id: string }[],
): { kept: PetLlmModel[]; dropped: string[] } => {
  const ids = new Set(fetched.map((model) => model.id));
  return {
    kept: models.filter((model) => ids.has(model.id)),
    dropped: models.filter((model) => !ids.has(model.id)).map((model) => model.id),
  };
};
