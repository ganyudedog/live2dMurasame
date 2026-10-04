import { useEffect, type RefObject } from 'react';

export interface UsePetCanvasConfigRefsParams {
  modelPath: string;
  modelPathRef: RefObject<string>;
}

export const usePetCanvasConfigRefs = ({
  modelPath,
  modelPathRef,
}: UsePetCanvasConfigRefsParams): void => {
  useEffect(() => {
    modelPathRef.current = modelPath;
  }, [modelPath, modelPathRef]);
};
