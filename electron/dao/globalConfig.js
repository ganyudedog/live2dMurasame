export const DEFAULT_GLOBAL_MODEL_CONFIG = {
  scale: 1.0,
  ignoreMouse: false,
  autoLaunch: false,
  showDragHandleOnHover: true,
  forcedFollow: false,
  debugModeEnabled: false,
  model: 'deepseek-v4-flash',
  apiKey: '',
  baseURL: '',
  displayLang: 'zh',
  asr: {
    mode: 'local',
    engine: 'sherpa-onnx',
    modelDir: '',
    endpoint: '',
    sampleRate: 16000,
    featureDim: 80,
    numThreads: 2,
    provider: 'cpu',
    debug: 0,
    rule1MinTrailingSilence: 2.4,
    rule2MinTrailingSilence: 1.2,
    rule3MinUtteranceLength: 20,
  },
};

// Live2denvConfig: live2denv.json（模型列表、当前模型、桌宠和 AI 应用配置）。
export const DEFAULT_LIVE2DENV_CONFIG = {
  modelPaths: [],
  currentModelPath: null,
  settings: { ...DEFAULT_GLOBAL_MODEL_CONFIG },
};

export const DEFAULT_MODEL_CONFIG = {
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
    side: 'auto',
    sideWidth: 100,
  },
  interactionZones: {
    actions: [],
    zones: [],
  },
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

const normalizeInteractionZones = (input) => {
  const def = { actions: [], zones: [] };
  if (!input || typeof input !== 'object') return def;
  return {
    actions: Array.isArray(input.actions)
      ? input.actions.filter((v) => typeof v === 'string')
      : [],
    zones: Array.isArray(input.zones)
      ? input.zones.filter((z) => z && Array.isArray(z.heightRange) && Array.isArray(z.motions))
      : [],
  };
};

export const normalizeModelConfig = (input = {}) => {
  const next = {
    ...DEFAULT_MODEL_CONFIG,
    ...(input || {}),
  };

  next.visualFrame = {
    ...DEFAULT_MODEL_CONFIG.visualFrame,
    ...((input && input.visualFrame) || {}),
  };

  next.bubble = {
    ...DEFAULT_MODEL_CONFIG.bubble,
    ...((input && input.bubble) || {}),
  };
  next.bubble.side = ['auto', 'left', 'right'].includes(next.bubble.side) ? next.bubble.side : 'auto';
  next.bubble.sideWidth = clampNumber(next.bubble.sideWidth, 100, 50, 150);

  next.interactionZones = normalizeInteractionZones(input && input.interactionZones);

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
  if (typeof settings.model === 'string') {
    next.model = settings.model.trim();
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
  const asr = settings.asr && typeof settings.asr === 'object' ? settings.asr : {};
  next.asr = {
    ...DEFAULT_GLOBAL_MODEL_CONFIG.asr,
    mode: asr.mode === 'remote' ? 'remote' : 'local',
    engine: typeof asr.engine === 'string' && asr.engine.trim() ? asr.engine.trim() : DEFAULT_GLOBAL_MODEL_CONFIG.asr.engine,
    modelDir: typeof asr.modelDir === 'string' ? asr.modelDir.trim() : '',
    endpoint: typeof asr.endpoint === 'string' ? asr.endpoint.trim() : '',
    sampleRate: Number.isFinite(asr.sampleRate) && asr.sampleRate > 0 ? Math.floor(asr.sampleRate) : DEFAULT_GLOBAL_MODEL_CONFIG.asr.sampleRate,
    featureDim: Number.isFinite(asr.featureDim) && asr.featureDim > 0 ? Math.floor(asr.featureDim) : DEFAULT_GLOBAL_MODEL_CONFIG.asr.featureDim,
    numThreads: Number.isFinite(asr.numThreads) && asr.numThreads > 0 ? Math.floor(asr.numThreads) : DEFAULT_GLOBAL_MODEL_CONFIG.asr.numThreads,
    provider: typeof asr.provider === 'string' && asr.provider.trim() ? asr.provider.trim() : DEFAULT_GLOBAL_MODEL_CONFIG.asr.provider,
    debug: Number.isFinite(asr.debug) ? Math.max(0, Math.floor(asr.debug)) : DEFAULT_GLOBAL_MODEL_CONFIG.asr.debug,
    rule1MinTrailingSilence: Number.isFinite(asr.rule1MinTrailingSilence) ? Math.max(0, asr.rule1MinTrailingSilence) : DEFAULT_GLOBAL_MODEL_CONFIG.asr.rule1MinTrailingSilence,
    rule2MinTrailingSilence: Number.isFinite(asr.rule2MinTrailingSilence) ? Math.max(0, asr.rule2MinTrailingSilence) : DEFAULT_GLOBAL_MODEL_CONFIG.asr.rule2MinTrailingSilence,
    rule3MinUtteranceLength: Number.isFinite(asr.rule3MinUtteranceLength) ? Math.max(0, Math.floor(asr.rule3MinUtteranceLength)) : DEFAULT_GLOBAL_MODEL_CONFIG.asr.rule3MinUtteranceLength,
  };
  return next;
};

export const normalizeLive2denvConfig = (input = {}) => {
  const source = input && typeof input === 'object' ? input : {};
  const next = {
    ...DEFAULT_LIVE2DENV_CONFIG,
    ...source,
  };
  const legacyModelPaths = Array.isArray(source.VITE_MODEL_PATHS) ? source.VITE_MODEL_PATHS : [];
  const legacyCurrentModelPath = source.CURRENT_PATH ?? null;
  next.modelPaths = Array.isArray(source.modelPaths) ? source.modelPaths.filter(Boolean) : legacyModelPaths.filter(Boolean);
  next.currentModelPath = source.currentModelPath ?? legacyCurrentModelPath;
  next.touchPriority = Array.isArray(source.touchPriority)
    ? source.touchPriority.filter((value) => typeof value === 'string' && value.trim())
    : (Array.isArray(source.VITE_TOUCH_PRIORITY) ? source.VITE_TOUCH_PRIORITY.filter((value) => typeof value === 'string' && value.trim()) : undefined);
  next.eyeMaxUp = Number.isFinite(source.eyeMaxUp) ? source.eyeMaxUp : source.VITE_EYE_MAX_UP;
  next.angleMaxUp = Number.isFinite(source.angleMaxUp) ? source.angleMaxUp : source.VITE_ANGLE_MAX_UP;
  next.modelPaths = next.modelPaths.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim());
  if (next.currentModelPath && typeof next.currentModelPath === 'string') {
    next.currentModelPath = next.currentModelPath.trim() || null;
  }
  if (!next.currentModelPath || !next.modelPaths.includes(next.currentModelPath)) {
    next.currentModelPath = next.modelPaths[0] ?? null;
  }
  if (!Array.isArray(next.modelPaths)) {
    next.modelPaths = [];
  }
  /* Remove legacy persistence keys when the normalized object is written back. */
  delete next.VITE_MODEL_PATHS;
  delete next.CURRENT_PATH;
  delete next.VITE_TOUCH_PRIORITY;
  delete next.VITE_EYE_MAX_UP;
  delete next.VITE_ANGLE_MAX_UP;
  const rawWindowState = next.windowState && typeof next.windowState === 'object' ? next.windowState : {};
  const rawBounds = rawWindowState.bounds && typeof rawWindowState.bounds === 'object' ? rawWindowState.bounds : null;
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  next.windowState = {
    bounds: rawBounds && [rawBounds.x, rawBounds.y, rawBounds.width, rawBounds.height].every(finite)
      && rawBounds.width > 0 && rawBounds.height > 0
      ? {
        x: Math.round(rawBounds.x), y: Math.round(rawBounds.y),
        width: Math.round(rawBounds.width), height: Math.round(rawBounds.height),
      }
      : null,
    updatedAt: finite(rawWindowState.updatedAt) ? Math.max(0, Math.floor(rawWindowState.updatedAt)) : 0,
  };
  next.settings = normalizeGlobalModelConfig(source.settings ?? source.globalModelConfig ?? {});
  return next;
};
