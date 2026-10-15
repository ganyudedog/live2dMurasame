import type { ActionDefinition, ActionSourceData } from '../../../shared/actionCatalog.js';

export const headAction: ActionDefinition = {
  id: 'head', label: '转头', category: 'head', durationMs: 900, enterMs: 200, returnMs: 250,
  tracks: [{ parameterId: 'ParamAngleX', keyframes: [{ timeMs: 0, value: 5 }, { timeMs: 400, value: 20 }, { timeMs: 900, value: 5 }] }],
};
export const shyAction: ActionDefinition = {
  id: 'shy', label: '害羞', category: 'emotion', durationMs: 900, enterMs: 200, returnMs: 250,
  tracks: [{ parameterId: 'ParamCheek', keyframes: [{ timeMs: 0, value: 0.8 }] }],
};
export const actionSources: ActionSourceData = {
  modelPath: 'model-a',
  parameters: [{ id: 'ParamAngleX', observedMin: -20, observedMax: 20 }, { id: 'ParamCheek', observedMin: 0, observedMax: 1 }],
  motions: [{ group: 'Talk', index: 0, durationMs: 1000, curves: [
    { parameterId: 'ParamAngleX', samples: [[0, -20], [1000, 20]], maxSampleError: 0, observedMin: -20, observedMax: 20 },
    { parameterId: 'ParamCheek', samples: [[0, 0], [1000, 1]], maxSampleError: 0, observedMin: 0, observedMax: 1 },
  ] }],
};
