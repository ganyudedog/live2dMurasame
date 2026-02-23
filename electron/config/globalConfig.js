export const DEFAULT_TOUCH_PRIORITY = ['hair', 'face', 'xiongbu', 'qunzi', 'leg'];

export const DEFAULT_GLOBAL_MODEL_CONFIG = {
  scale: 1.0,
  ignoreMouse: false,
  autoLaunch: false,
  showDragHandleOnHover: true,
  forcedFollow: false,
  debugModeEnabled: false,
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
