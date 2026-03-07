export const DEFAULT_TOUCH_PRIORITY = ['hair', 'face', 'xiongbu', 'qunzi', 'leg'];

export const DEFAULT_GLOBAL_MODEL_CONFIG = {
  scale: 1.0,
  ignoreMouse: false,
  autoLaunch: false,
  showDragHandleOnHover: true,
  forcedFollow: false,
  debugModeEnabled: false,
  apiKey: '',
  baseURL: '',
};

// Live2denvConfig: liv2denv.json（模型列表/当前模型等），不包含全局模型设置。
export const DEFAULT_LIVE2DENV_CONFIG = {
  VITE_TOUCH_PRIORITY: DEFAULT_TOUCH_PRIORITY,
  VITE_MODEL_PATHS: [],
  CURRENT_PATH: null,
};

export const DEFAULT_MODEL_CONFIG = {
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
  interactionZones: {},
  rag: {
    enabled: false,
    topK: 3,
    threshold: 0.6,
    knowledgeBasePath: '',
    embeddingModel: '',
    rerankerModel: '',
  },
};

const normalizeRagConfig = (input = {}) => {
  const next = { ...DEFAULT_MODEL_CONFIG.rag };
  if (!input || typeof input !== 'object') return next;
  if (typeof input.enabled === 'boolean') next.enabled = input.enabled;
  if (Number.isFinite(input.topK)) next.topK = input.topK;
  if (Number.isFinite(input.threshold)) next.threshold = input.threshold;
  if (typeof input.knowledgeBasePath === 'string') next.knowledgeBasePath = input.knowledgeBasePath;
  if (typeof input.embeddingModel === 'string') next.embeddingModel = input.embeddingModel;
  if (typeof input.rerankerModel === 'string') next.rerankerModel = input.rerankerModel;
  return next;
};

export const normalizeModelConfig = (input = {}) => {
  const next = {
    ...DEFAULT_MODEL_CONFIG,
    ...(input || {}),
  };

  next.touchMap = Array.isArray(next.touchMap)
    ? next.touchMap.filter((v) => Number.isFinite(v))
    : [...DEFAULT_MODEL_CONFIG.touchMap];

  next.visualFrame = {
    ...DEFAULT_MODEL_CONFIG.visualFrame,
    ...((input && input.visualFrame) || {}),
  };

  next.bubble = {
    ...DEFAULT_MODEL_CONFIG.bubble,
    ...((input && input.bubble) || {}),
  };

  next.interactionZones = (input && input.interactionZones && typeof input.interactionZones === 'object')
    ? input.interactionZones
    : {};

  next.rag = normalizeRagConfig(input && input.rag);
  return next;
};

export const normalizeGlobalModelConfig = (settings = {}) => {
  const next = { ...DEFAULT_GLOBAL_MODEL_CONFIG };
  if (Number.isFinite(settings.scale)) {
    next.scale = settings.scale;
  }
  if (typeof settings.ignoreMouse === 'boolean') {
    next.ignoreMouse = settings.ignoreMouse;
  }
  if (typeof settings.autoLaunch === 'boolean') {
    next.autoLaunch = settings.autoLaunch;
  }
  if (typeof settings.showDragHandleOnHover === 'boolean') {
    next.showDragHandleOnHover = settings.showDragHandleOnHover;
  }
  if (typeof settings.forcedFollow === 'boolean') {
    next.forcedFollow = settings.forcedFollow;
  }
  if (typeof settings.debugModeEnabled === 'boolean') {
    next.debugModeEnabled = settings.debugModeEnabled;
  }
  if (typeof settings.apiKey === 'string') {
    next.apiKey = settings.apiKey;
  }
  if (typeof settings.baseURL === 'string') {
    next.baseURL = settings.baseURL;
  }
  return next;
};

export const normalizeLive2denvConfig = (input = {}) => {
  const next = {
    ...DEFAULT_LIVE2DENV_CONFIG,
    ...(input || {}),
  };
  next.VITE_MODEL_PATHS = Array.isArray(next.VITE_MODEL_PATHS)
    ? next.VITE_MODEL_PATHS.filter(Boolean)
    : [];
  next.VITE_TOUCH_PRIORITY = Array.isArray(next.VITE_TOUCH_PRIORITY)
    ? next.VITE_TOUCH_PRIORITY.filter(Boolean)
    : DEFAULT_TOUCH_PRIORITY;
  if (next.CURRENT_PATH && typeof next.CURRENT_PATH !== 'string') {
    next.CURRENT_PATH = null;
  }

  // 兼容旧配置文件：如果存在 GLOBAL/legacy 字段，读取时会由 configManager 迁移到 globalModelConfig.json。
  // normalizeLive2denvConfig 本身不再生成/持久化这些字段。
  return next;
};
