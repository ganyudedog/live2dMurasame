export type ActionCategory = 'head' | 'gaze' | 'blink' | 'emotion' | 'body' | 'other';
export interface ActionKeyframe { timeMs: number; value: number }
export interface ActionTrack { parameterId: string; keyframes: ActionKeyframe[] }
export interface ActionDefinition {
  id: string;
  label: string;
  category: ActionCategory;
  description?: string;
  durationMs: number;
  enterMs: number;
  returnMs: number;
  tracks: ActionTrack[];
}
export interface MotionParameterCurve {
  parameterId: string;
  samples: Array<[timeMs: number, value: number]>;
  maxSampleError: number;
  observedMin: number;
  observedMax: number;
}
export interface ActionSourceData {
  modelPath: string;
  motions: Array<{ group: string; index: number; durationMs: number; curves: MotionParameterCurve[] }>;
  parameters: Array<{ id: string; name?: string; observedMin: number; observedMax: number }>;
}
export const ACTION_CATEGORIES: readonly ActionCategory[];
export const ACTION_ID_PATTERN: RegExp;
export const RESERVED_ACTION_PARAMETERS: readonly string[];
export function parseActionCatalog(value: unknown): ActionDefinition[];
export function readActionCatalog(value: unknown): ActionDefinition[];
