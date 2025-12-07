/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, type RefObject } from 'react';
import type { Live2DModel as Live2DModelType } from '../live2d/runtime';

export interface UseEyeResetParams {
  ignoreMouse: boolean;
  modelRef: RefObject<Live2DModelType | null>;
}

/**
 * 忽略鼠标时重置模型眼球与角度参数。
 */
export const useEyeReset = ({ ignoreMouse, modelRef }: UseEyeResetParams): void => {
  useEffect(() => {
    const model = modelRef.current;
    if (!model) return;
    try {
      const core = (model as unknown as { internalModel?: { coreModel?: any } }).internalModel?.coreModel;
      if (!core) return;
      core.setParameterValueById?.('ParamEyeBallX', 0);
      core.setParameterValueById?.('ParamEyeBallY', 0);
      core.setParameterValueById?.('ParamAngleX', 0);
      core.setParameterValueById?.('ParamAngleY', 0);
    } catch {
      // ignore reset failures
    }
  }, [ignoreMouse, modelRef]);
};
