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
  displayLang: 'zh',
  // 破坏性迁移：TTS 输出格式改为全局配置。
  ttsMediaType: 'wav',
  // 破坏性迁移：TTS 流式开关改为全局配置。
  ttsStreamingMode: true,
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
    baseUrl: 'http://127.0.0.1:9881',
    gptWeightsPath: '',
    sovitsWeightsPath: '',
    textLang: 'ja',
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

const normalizeTextField = (value) => {
  return typeof value === 'string' ? value : '';
};

const toSafeObject = (value) => {
  return value && typeof value === 'object' ? value : {};
};

const normalizeRagProfile = (input = {}) => {
  const source = toSafeObject(input);
  const next = { ...DEFAULT_MODEL_CONFIG.rag.profile };
  next.personal = normalizeTextField(source.personal);
  next.speakingStyle = normalizeTextField(source.speakingStyle);
  next.relation = normalizeTextField(source.relation);
  next.banned = normalizeTextField(source.banned);
  next.world = normalizeTextField(source.world);

  // 兼容旧字段：若历史配置里只有 mustFollow，则迁移到 banned。
  if (!next.banned && typeof source.mustFollow === 'string') {
    next.banned = source.mustFollow;
  }
  return next;
};

const normalizeRagRetrieval = (input = {}) => {
  const source = toSafeObject(input);
  const next = { ...DEFAULT_MODEL_CONFIG.rag.retrieval };
  if (typeof source.enabled === 'boolean') next.enabled = source.enabled;
  if (Number.isFinite(source.topK)) next.topK = Math.max(1, Math.floor(source.topK));
  if (Number.isFinite(source.threshold)) next.threshold = Math.max(0, Math.min(1, source.threshold));
  if (typeof source.knowledgeBasePath === 'string') next.knowledgeBasePath = source.knowledgeBasePath;
  if (typeof source.embeddingModel === 'string' && source.embeddingModel.trim()) {
    next.embeddingModel = source.embeddingModel;
  }
  if (typeof source.rerankerModel === 'string' && source.rerankerModel.trim()) {
    next.rerankerModel = source.rerankerModel;
  }
  return next;
};

const normalizeRagConfig = (input = {}) => {
  if (!input || typeof input !== 'object') {
    return {
      profile: { ...DEFAULT_MODEL_CONFIG.rag.profile },
      retrieval: { ...DEFAULT_MODEL_CONFIG.rag.retrieval },
    };
  }

  const source = toSafeObject(input);
  const profileSource = source.profile && typeof source.profile === 'object' ? source.profile : source;
  const retrievalSource = source.retrieval && typeof source.retrieval === 'object' ? source.retrieval : source;

  return {
    profile: normalizeRagProfile(profileSource),
    retrieval: normalizeRagRetrieval(retrievalSource),
  };
};

const clampNumber = (value, fallback, min, max) => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
};

const normalizeTextSplitMode = (value, fallback = 'cut5') => {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const normalized = value.trim().toLowerCase();

  if (normalized === 'cut0' || normalized === 'cut1' || normalized === 'cut2'
    || normalized === 'cut3' || normalized === 'cut4' || normalized === 'cut5') {
    return normalized;
  }

  if (normalized === 'none') return 'cut0';
  if (normalized === 'cut50') return 'cut2';
  if (normalized === 'cut_punc' || normalized === 'punctuation'
    || normalized === 'cut_zh_comma' || normalized === 'cut_en_comma') {
    return 'cut5';
  }

  return fallback;
};

const normalizeTtsConfig = (input = {}) => {
  const source = toSafeObject(input);
  const next = { ...DEFAULT_MODEL_CONFIG.tts };
  if (typeof source.enabled === 'boolean') next.enabled = source.enabled;
  if (typeof source.baseUrl === 'string' && source.baseUrl.trim()) next.baseUrl = source.baseUrl.trim();
  if (typeof source.gptWeightsPath === 'string') next.gptWeightsPath = source.gptWeightsPath;
  if (typeof source.sovitsWeightsPath === 'string') next.sovitsWeightsPath = source.sovitsWeightsPath;
  if (typeof source.textLang === 'string' && source.textLang.trim()) next.textLang = source.textLang.trim();
  if (typeof source.promptLang === 'string' && source.promptLang.trim()) next.promptLang = source.promptLang.trim();
  if (typeof source.refAudioPath === 'string') next.refAudioPath = source.refAudioPath;
  if (typeof source.refAudioText === 'string') next.refAudioText = source.refAudioText;
  next.textSplitMode = normalizeTextSplitMode(source.textSplitMode, next.textSplitMode);
  next.speedFactor = clampNumber(source.speedFactor, next.speedFactor, 0, 2);
  next.fragmentInterval = clampNumber(source.fragmentInterval, next.fragmentInterval, 0, 0.5);
  next.topK = Math.max(1, Math.min(100, Number.isFinite(source.topK) ? Math.floor(source.topK) : next.topK));
  next.topP = clampNumber(source.topP, next.topP, 0, 1);
  next.temperature = clampNumber(source.temperature, next.temperature, 0, 1);
  if (typeof source.useLastGeneratedAsRef === 'boolean') next.useLastGeneratedAsRef = source.useLastGeneratedAsRef;
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
  next.tts = normalizeTtsConfig(input && input.tts);
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
  if (settings.displayLang === 'zh' || settings.displayLang === 'en' || settings.displayLang === 'ja' || settings.displayLang === 'ko') {
    next.displayLang = settings.displayLang;
  }
  if (settings.ttsMediaType === 'wav' || settings.ttsMediaType === 'ogg' || settings.ttsMediaType === 'aac') {
    next.ttsMediaType = settings.ttsMediaType;
  }
  if (typeof settings.ttsStreamingMode === 'boolean') {
    next.ttsStreamingMode = settings.ttsStreamingMode;
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
