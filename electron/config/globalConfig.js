export const DEFAULT_TOUCH_PRIORITY = ['hair', 'face', 'xiongbu', 'qunzi', 'leg'];

export const DEFAULT_LIVE2D_GLOBAL_SETTINGS = {
  scale: 1.0,
  ignoreMouse: false,
  autoLaunch: false,
  showDragHandleOnHover: true,
  forcedFollow: false,
  debugModeEnabled: false,
};

export const DEFAULT_GLOBAL_CONFIG = {
  VITE_TOUCH_PRIORITY: DEFAULT_TOUCH_PRIORITY,
  VITE_MODEL_PATHS: [],
  VITE_DEBUG: false,
  CURRENT_PATH: null,
  GLOBAL: { ...DEFAULT_LIVE2D_GLOBAL_SETTINGS },
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

export const normalizeLive2denvGlobal = (settings = {}) => {
  const next = { ...DEFAULT_LIVE2D_GLOBAL_SETTINGS };
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

export const normalizeGlobalConfig = (input = {}) => {
  const next = {
    ...DEFAULT_GLOBAL_CONFIG,
    ...(input || {}),
  };
  next.VITE_MODEL_PATHS = Array.isArray(next.VITE_MODEL_PATHS)
    ? next.VITE_MODEL_PATHS.filter(Boolean)
    : [];
  next.VITE_TOUCH_PRIORITY = Array.isArray(next.VITE_TOUCH_PRIORITY)
    ? next.VITE_TOUCH_PRIORITY.filter(Boolean)
    : DEFAULT_TOUCH_PRIORITY;
  if (typeof next.VITE_DEBUG !== 'boolean') {
    next.VITE_DEBUG = Boolean(next.VITE_DEBUG);
  }
  if (next.CURRENT_PATH && typeof next.CURRENT_PATH !== 'string') {
    next.CURRENT_PATH = null;
  }
  const legacySettings = {
    scale: input?.scale,
    ignoreMouse: input?.ignoreMouse,
    autoLaunch: input?.autoLaunch,
    showDragHandleOnHover: input?.showDragHandleOnHover,
    forcedFollow: input?.forcedFollow,
    debugModeEnabled: input?.debugModeEnabled,
  };
  next.GLOBAL = normalizeLive2denvGlobal({
    ...(input?.GLOBAL || {}),
    ...legacySettings,
  });
  return next;
};
