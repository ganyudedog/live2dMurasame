/**
 * 一个模型的思考深度说明：有档位就原样列出接口返回的 label，
 * 空集要区分“没检测过”和“确实不接受该参数”。
 * 探测来源（接口报错 / 逐档探测）属于实现细节，不摆给用户看。
 */
export const describeEfforts = (model: PetLlmModel): string => {
  if (model.efforts.length) return model.efforts.join(' / ');
  return model.effortsSource === 'none' ? '尚未检测' : '不支持';
};
