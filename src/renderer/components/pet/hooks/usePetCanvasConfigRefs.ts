/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, type RefObject } from 'react';

export interface UsePetCanvasConfigRefsParams {
  modelPath: string;
  modelPathRef: RefObject<string>;
  persistedModelConfig: unknown;
  visualFrameRef: RefObject<any | null>;
  bubbleSettingsRef: RefObject<{ symmetric?: boolean; headRatio?: number | null } | null>;
  interactionZonesRef: RefObject<{
    actions: string[];
    zones: { heightRange: [number, number]; motions: string[] }[];
  } | null>;
}

export const usePetCanvasConfigRefs = ({
  modelPath,
  modelPathRef,
  persistedModelConfig,
  visualFrameRef,
  bubbleSettingsRef,
  interactionZonesRef,
}: UsePetCanvasConfigRefsParams): void => {
  useEffect(() => {
    modelPathRef.current = modelPath;
  }, [modelPath, modelPathRef]);

  useEffect(() => {
    const raw = (persistedModelConfig as any)?.visualFrame;
    visualFrameRef.current = raw && typeof raw === 'object' ? raw : null;
  }, [persistedModelConfig, visualFrameRef]);

  useEffect(() => {
    const raw = (persistedModelConfig as any)?.bubble;
    bubbleSettingsRef.current = raw && typeof raw === 'object' ? (raw as { symmetric?: boolean; headRatio?: number | null }) : null;
  }, [persistedModelConfig, bubbleSettingsRef]);

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
