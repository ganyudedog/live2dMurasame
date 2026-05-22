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
  interactionZones: { actions: [], zones: [] },
  rag: {
    profile: {
      personal: '',
      speakingStyle: '',
      relation: '',
      banned: '',
      world: '',
    },
    retrieval: {
      enabled: true,
      topK: 3,
      threshold: 0.6,
      knowledgeBasePath: '',
      embeddingModel: 'bge-m3',
      rerankerModel: 'bge-reranker-v2-m3',
    },
  },
  tts: {
    enabled: false,
    baseUrl: 'http://127.0.0.1:9880',
    gptWeightsPath: '',
    sovitsWeightsPath: '',
    textLang: 'all_ja',
    promptLang: 'ja',
    refAudioPath: '',
    refAudioText: '',
    textSplitMode: 'cut5',
    speedFactor: 1,
    fragmentInterval: 0.3,
    useLastGeneratedAsRef: false,
    topK: 20,
    topP: 0.8,
    temperature: 0.5,
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
