import type { GlobalUiSettings, ModelConfig, ModelEntry } from './types';

export const DEFAULT_GLOBAL_UI_SETTINGS: GlobalUiSettings = {
  scale: 1.0,
  ignoreMouse: false,
  autoLaunch: false,
  showDragHandleOnHover: true,
  forcedFollow: false,
  debugModeEnabled: false,
};

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  touchMap: [0.1, 0.19, 0.39, 0.53, 1],
  visualFrame: {
    ratio: 0.7,
    minPx: 100,
    paddingPx: 0,
    center: 'face',
    offsetPx: 0,
    offsetRatio: -0.16,
  },
  bubble: {
    symmetric: true,
    headRatio: null,
  },
};

export const DEFAULT_MODELS: ModelEntry[] = [
  {
    id: 'murasame',
    name: 'Murasame',
    path: 'C:/Models/Murasame',
  },
  {
    id: 'koharu',
    name: 'Koharu',
    path: 'C:/Models/Koharu',
  },
  {
    id: 'sample',
    name: 'Sample',
    path: 'C:/Models/Sample',
  },
];

export const DEFAULT_ACTIONS = ['Tapface', 'Taphair', 'Tapbody', 'Tapleg'];
