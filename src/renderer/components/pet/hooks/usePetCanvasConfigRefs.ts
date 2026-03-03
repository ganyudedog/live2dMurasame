/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, type RefObject } from 'react';

export interface UsePetCanvasConfigRefsParams {
  modelPath: string;
  modelPathRef: RefObject<string>;
  touchPriority: string[];
  touchPriorityRef: RefObject<string[]>;
  persistedModelConfig: unknown;
  touchMapRef: RefObject<number[] | null>;
  visualFrameRef: RefObject<any | null>;
  bubbleSettingsRef: RefObject<{ symmetric?: boolean; headRatio?: number | null } | null>;
  interactionZonesRef: RefObject<Record<string, { heightRange?: [number, number]; motions?: string[] }> | null>;
}

export const usePetCanvasConfigRefs = ({
  modelPath,
  modelPathRef,
  touchPriority,
  touchPriorityRef,
  persistedModelConfig,
  touchMapRef,
  visualFrameRef,
  bubbleSettingsRef,
  interactionZonesRef,
}: UsePetCanvasConfigRefsParams): void => {
  useEffect(() => {
    modelPathRef.current = modelPath;
  }, [modelPath, modelPathRef]);

  useEffect(() => {
    touchPriorityRef.current = touchPriority;
  }, [touchPriority, touchPriorityRef]);

  useEffect(() => {
    const raw = (persistedModelConfig as any)?.touchMap;
    const ok = Array.isArray(raw)
      && raw.length === 5
      && raw.every((v: unknown) => typeof v === 'number' && Number.isFinite(v));
    touchMapRef.current = ok ? (raw as number[]) : null;
  }, [persistedModelConfig, touchMapRef]);

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
    interactionZonesRef.current = raw as Record<string, { heightRange?: [number, number]; motions?: string[] }>;
  }, [persistedModelConfig, interactionZonesRef]);
};
