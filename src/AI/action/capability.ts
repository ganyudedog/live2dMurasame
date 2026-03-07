import type { ActionCapability } from '../types/action';

interface Live2DCoreModelLike {
  getParameterCount?: () => number;
  getParameterId?: (index: number) => string;
}

const ANGLE_X_CANDIDATES = ['ParamAngleX'];
const EYE_L_CANDIDATES = ['ParamEyeLOpen', 'ParamEyeLOpening'];
const EYE_R_CANDIDATES = ['ParamEyeROpen', 'ParamEyeROpening'];
const MOUTH_CANDIDATES = ['ParamMouthOpenY', 'ParamMouthOpen'];

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

const pickParamId = (knownIds: Set<string>, candidates: string[]): string | undefined => {
  for (const id of candidates) {
    if (knownIds.has(id)) return id;
  }
  return undefined;
};

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
