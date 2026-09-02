import type { ActionCapability } from '../types/action';

interface Live2DCoreModelLike {
  getParameterCount?: () => number;
  getParameterId?: (index: number) => string;
}

const ANGLE_X_CANDIDATES = ['ParamAngleX'];
const EYE_L_CANDIDATES = ['ParamEyeLOpen', 'ParamEyeLOpening'];
const EYE_R_CANDIDATES = ['ParamEyeROpen', 'ParamEyeROpening'];
const MOUTH_CANDIDATES = ['ParamMouthOpenY', 'ParamMouthOpen'];
// 动作能力探测器，通过检查模型的参数来判断其是否支持特定的动作能力（如摇头、眨眼、张嘴），并返回一个包含能力标志和相关参数ID的对象。
// 通过检测模型参数来判断其是否支持特定的动作能力（如摇头、眨眼、张嘴），并返回相应的参数ID以供后续使用。
const collectParamIds = (core: Live2DCoreModelLike): Set<string> => {
  if (!core || typeof core.getParameterCount !== 'function' || typeof core.getParameterId !== 'function') {
    return new Set();
  }
  try {
    const count = Number(core.getParameterCount()) || 0;
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const id = core.getParameterId(i);
      if (typeof id === 'string' && id) ids.push(id);
    }
    return new Set(ids);
  } catch {
    return new Set();
  }
};

// 从候选参数列表中选择第一个在模型参数ID集合中存在的参数ID，如果没有找到则返回undefined。
const pickParamId = (knownIds: Set<string>, candidates: string[]): string | undefined => {
  for (const id of candidates) {
    if (knownIds.has(id)) return id;
  }
  return undefined;
};
// 检测模型的动作能力，并返回一个包含能力标志和相关参数ID的对象。
export const detectActionCapability = (core: Live2DCoreModelLike): ActionCapability => {
  const knownIds = collectParamIds(core);
  const angleXParamId = pickParamId(knownIds, ANGLE_X_CANDIDATES);
  const eyeLParamId = pickParamId(knownIds, EYE_L_CANDIDATES);
  const eyeRParamId = pickParamId(knownIds, EYE_R_CANDIDATES);
  const mouthParamId = pickParamId(knownIds, MOUTH_CANDIDATES);

  return {
    canShakeHead: Boolean(angleXParamId),
    canBlink: Boolean(eyeLParamId && eyeRParamId),
    canMouth: Boolean(mouthParamId),
    angleXParamId,
    eyeLParamId,
    eyeRParamId,
    mouthParamId,
  };
};
