/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, type RefObject } from 'react';

export interface UsePetCanvasConfigRefsParams {
  modelPath: string;
  modelPathRef: RefObject<string>;
  persistedModelConfig: unknown;
  interactionZonesRef: RefObject<{
    actions: string[];
    zones: { heightRange: [number, number]; motions: string[] }[];
  } | null>;
}

export const usePetCanvasConfigRefs = ({
  modelPath,
  modelPathRef,
  persistedModelConfig,
  interactionZonesRef,
}: UsePetCanvasConfigRefsParams): void => {
  useEffect(() => {
    modelPathRef.current = modelPath;
  }, [modelPath, modelPathRef]);

  useEffect(() => {
    const raw = (persistedModelConfig as any)?.interactionZones;
    if (!raw || typeof raw !== 'object') {
      interactionZonesRef.current = null;
      return;
    }
    interactionZonesRef.current = raw as {
      actions: string[];
      zones: { heightRange: [number, number]; motions: string[] }[];
    };
  }, [persistedModelConfig, interactionZonesRef]);
};
