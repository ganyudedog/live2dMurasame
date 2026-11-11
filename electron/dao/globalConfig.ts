import fs from 'node:fs';
import { readActionCatalog, type ActionDefinition } from '../../shared/live2d/actionCatalog.js';
import { DEFAULT_SUBTITLE_SETTINGS, DEFAULT_PUSH_TO_TALK, normalizeSubtitleSettings, normalizePushToTalk, type SubtitleSettings, type PushToTalkSettings } from '../../shared/subtitle/subtitleSettings.js';
import {
  normalizeEfforts,
  normalizeLlmModels,
  normalizeMemorySelection,
  type LlmModelEntry,
} from '../../shared/ai/llmModels.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const finiteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const optionalAsrRange = (value: unknown, min: number, max: number): number | null => {
  if (value == null || value === '') return null;
  if (!finiteNumber(value)) return null;
  return Math.min(max, Math.max(min, value));
};

export interface AsrConfig {
  vadModelPath: string;
  vadThreshold: number | null;
  vadMinSpeechDuration: number | null;
  mode: 'local' | 'remote';
  engine: string;
  modelDir: string;
  endpoint: string;
  sampleRate: number;
  featureDim: number;
  numThreads: number;
  provider: string;
  debug: number;
  /** 已识别出文字后，静音多久提交。对应 Sherpa rule2。 */
  silenceAfterText: number;
  /** 还没有识别出文字时，静音多久结束。对应 Sherpa rule1，也用作 Silero 的最短静音。 */
  silenceWithoutText: number;
}

const WORKSPACE_ID = /^[a-zA-Z0-9_-]{1,80}$/;

/** 工作目录登记表：标识到绝对路径。非法条目丢弃。 */
export const normalizeWorkspaces = (value: unknown): Record<string, string> => {
  const entries: Array<[string, string]> = Array.isArray(value)
    ? value.flatMap((item) => isRecord(item) ? [[String(item.id ?? ''), String(item.path ?? '')]] : [])
    : isRecord(value) ? Object.entries(value).map(([id, path]) => [id, typeof path === 'string' ? path : '']) : [];
  const next: Record<string, string> = Object.create(null);
  for (const [id, rawPath] of entries) {
    const key = id.trim();
    const directory = rawPath.trim();
    if (!WORKSPACE_ID.test(key) || !directory || Object.hasOwn(next, key)) continue;
    next[key] = directory;
  }
  return next;
};

/** 保存前确认每个路径都是已有目录，并收成规范绝对路径。 */
export const resolveWorkspaceDirectories = (workspaces: Record<string, string>): Record<string, string> => {
  const next: Record<string, string> = Object.create(null);
  for (const [id, rawPath] of Object.entries(workspaces)) {
    const directory = fs.realpathSync(rawPath);
    if (!fs.statSync(directory).isDirectory()) throw new Error('Workspace must be a directory');
    next[id] = directory;
  }
  return next;
};

export type DisplayLang = 'zh' | 'en' | 'ja' | 'ko';

export interface GlobalModelConfig {
  scale: number;
  ignoreMouse: boolean;
  autoLaunch: boolean;
  showDragHandleOnHover: boolean;
  subtitle: SubtitleSettings;
  pushToTalk: PushToTalkSettings;
  forcedFollow: boolean;
  debugModeEnabled: boolean;
  apiKey: string;
  baseURL: string;
  displayLang: DisplayLang;
  llmModels: LlmModelEntry[];
  memoryModel: string;
  memoryReasoningEffort: string;
  asr: AsrConfig;
}

export interface BubbleConfig {
  symmetric: unknown;
  headRatio: unknown;
  side: 'auto' | 'left' | 'right';
  sideWidth: number;
  [key: string]: unknown;
}

export interface PersonaConfig {
  name: string;
  userAddress: string;
  voice: string;
  examples: string;
  boundaries: string;
  notes: string;
}

export type TextSplitMode = 'cut0' | 'cut1' | 'cut2' | 'cut3' | 'cut4' | 'cut5';

export interface TtsConfig {
  enabled: boolean;
  baseUrl: string;
  gptWeightsPath: string;
  sovitsWeightsPath: string;
  textLang: string;
  promptLang: string;
  refAudioPath: string;
  refAudioText: string;
  textSplitMode: TextSplitMode;
  speedFactor: number;
  fragmentInterval: number;
  topK: number;
  topP: number;
  temperature: number;
}

export interface InteractionBinding {
  group: string;
  index: number;
  weight: number;
}

export interface ModelConfig {
  bubble: BubbleConfig;
  persona: PersonaConfig;
  tts: TtsConfig;
  interaction?: Record<string, InteractionBinding[]>;
  actions: ActionDefinition[];
  [key: string]: unknown;
}

export interface PersistedBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PersistedWindowState {
  bounds: PersistedBounds | null;
  updatedAt: number;
}

export interface Live2denvConfig {
  modelPaths: string[];
  currentModelPath: string | null;
  settings: GlobalModelConfig;
  touchPriority?: string[];
  eyeMaxUp?: unknown;
  angleMaxUp?: unknown;
  windowState: PersistedWindowState;
  [key: string]: unknown;
}

export const DEFAULT_GLOBAL_MODEL_CONFIG: GlobalModelConfig = {
  scale: 1.0,
  ignoreMouse: false,
  autoLaunch: false,
  showDragHandleOnHover: true,
  subtitle: DEFAULT_SUBTITLE_SETTINGS,
  pushToTalk: DEFAULT_PUSH_TO_TALK,
  forcedFollow: false,
  debugModeEnabled: false,
  apiKey: '',
  baseURL: '',
  displayLang: 'zh',
  llmModels: [],
  memoryModel: '',
  memoryReasoningEffort: '',
  asr: {
    vadModelPath: '',
    vadThreshold: 0.5,
    vadMinSpeechDuration: 0.2,
    mode: 'local',
    engine: 'sherpa-onnx',
    modelDir: '',
    endpoint: '',
    sampleRate: 16000,
    featureDim: 80,
    numThreads: 2,
    provider: 'cpu',
    debug: 0,
    silenceAfterText: 1.2,
    silenceWithoutText: 0.7,
  },
};

export const DEFAULT_LIVE2DENV_CONFIG: Live2denvConfig = {
  modelPaths: [],
  currentModelPath: null,
  settings: { ...DEFAULT_GLOBAL_MODEL_CONFIG },
  windowState: { bounds: null, updatedAt: 0 },
};

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  bubble: {
    symmetric: true,
    headRatio: null,
    side: 'auto',
    sideWidth: 260,
  },
  persona: {
    name: '',
    userAddress: '',
    voice: '',
    examples: '',
    boundaries: '',
    notes: '',
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
    topK: 20,
    topP: 0.8,
    temperature: 0.5,
  },
  interaction: {},
  actions: [],
};

const normalizeTextField = (value: unknown): string => (typeof value === 'string' ? value : '');

const normalizePersona = (input: unknown): PersonaConfig => {
  const source = isRecord(input) ? input : {};
  return {
    name: normalizeTextField(source.name).trim(),
    userAddress: normalizeTextField(source.userAddress).trim(),
    voice: normalizeTextField(source.voice).trim(),
    examples: normalizeTextField(source.examples).trim(),
    boundaries: normalizeTextField(source.boundaries).trim(),
    notes: normalizeTextField(source.notes).trim(),
  };
};

const clampNumber = (value: unknown, fallback: number, min: number, max: number): number => {
  if (!finiteNumber(value)) return fallback;
  return Math.max(min, Math.min(max, value));
};

const normalizeTextSplitMode = (value: unknown, fallback: TextSplitMode = 'cut5'): TextSplitMode => {
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

const normalizeTtsConfig = (input: unknown): TtsConfig => {
  const source = isRecord(input) ? input : {};
  const next: TtsConfig = { ...DEFAULT_MODEL_CONFIG.tts };
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
  next.topK = Math.max(1, Math.min(100, finiteNumber(source.topK) ? Math.floor(source.topK) : next.topK));
  next.topP = clampNumber(source.topP, next.topP, 0, 1);
  next.temperature = clampNumber(source.temperature, next.temperature, 0, 1);
  return next;
};

const normalizeBubble = (input: unknown): BubbleConfig => {
  const source = isRecord(input) ? input : {};
  const side = source.side === 'left' || source.side === 'right' || source.side === 'auto' ? source.side : 'auto';
  return {
    ...DEFAULT_MODEL_CONFIG.bubble,
    ...source,
    side,
    sideWidth: clampNumber(source.sideWidth, DEFAULT_MODEL_CONFIG.bubble.sideWidth, 220, 320),
  };
};

const normalizeInteraction = (input: unknown): Record<string, InteractionBinding[]> | null => {
  if (!isRecord(input)) return null;
  const normalized: Record<string, InteractionBinding[]> = {};
  for (const [areaName, assignments] of Object.entries(input)) {
    const name = areaName.trim();
    if (!name || !Array.isArray(assignments)) continue;
    normalized[name] = assignments.flatMap((item): InteractionBinding[] => {
      if (!isRecord(item) || typeof item.group !== 'string' || !item.group.trim()) return [];
      if (typeof item.index !== 'number' || !Number.isInteger(item.index) || item.index < 0) return [];
      return [{
        group: item.group.trim(),
        index: item.index,
        weight: finiteNumber(item.weight) ? Math.max(0, item.weight) : 100,
      }];
    });
  }
  return normalized;
};

const personaSourceOf = (source: Record<string, unknown>): unknown => {
  if (source.persona && typeof source.persona === 'object') return source.persona;
  const legacyRag = source.rag && typeof source.rag === 'object' ? source.rag : {};
  if (isRecord(legacyRag) && legacyRag.profile && typeof legacyRag.profile === 'object') return legacyRag.profile;
  return legacyRag;
};

export const normalizeModelConfig = (input: unknown = {}): ModelConfig => {
  const source = isRecord(input) ? input : {};
  const interaction = normalizeInteraction(source.interaction);
  const next: ModelConfig = {
    ...DEFAULT_MODEL_CONFIG,
    bubble: normalizeBubble(source.bubble),
    persona: normalizePersona(personaSourceOf(source)),
    tts: normalizeTtsConfig(source.tts),
    actions: readActionCatalog(source.actions),
  };
  if (interaction) next.interaction = interaction;
  else delete next.interaction;
  for (const [key, value] of Object.entries(source)) {
    if (key === 'bubble' || key === 'persona' || key === 'tts' || key === 'actions' || key === 'interaction') continue;
    if (key === 'visualFrame' || key === 'interactionZones' || key === 'rag') continue;
    next[key] = value;
  }
  return next;
};

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : [];

export const normalizeGlobalModelConfig = (settings: unknown = {}): GlobalModelConfig => {
  const source = isRecord(settings) ? settings : {};
  const next: GlobalModelConfig = {
    ...DEFAULT_GLOBAL_MODEL_CONFIG,
    subtitle: normalizeSubtitleSettings(isRecord(source.subtitle) ? source.subtitle as Partial<SubtitleSettings> : undefined),
    pushToTalk: normalizePushToTalk(isRecord(source.pushToTalk) ? source.pushToTalk as Partial<PushToTalkSettings> : undefined),
  };
  if (finiteNumber(source.scale)) next.scale = source.scale;
  if (typeof source.ignoreMouse === 'boolean') next.ignoreMouse = source.ignoreMouse;
  if (typeof source.autoLaunch === 'boolean') next.autoLaunch = source.autoLaunch;
  if (typeof source.showDragHandleOnHover === 'boolean') next.showDragHandleOnHover = source.showDragHandleOnHover;
  if (typeof source.forcedFollow === 'boolean') next.forcedFollow = source.forcedFollow;
  if (typeof source.debugModeEnabled === 'boolean') next.debugModeEnabled = source.debugModeEnabled;
  if (typeof source.apiKey === 'string') next.apiKey = source.apiKey;
  if (typeof source.baseURL === 'string') next.baseURL = source.baseURL;
  const legacyModel = typeof source.model === 'string' ? source.model.trim() : '';
  const declaredModels = Array.isArray(source.llmModels)
    ? source.llmModels
    : (legacyModel ? [{ id: legacyModel, efforts: [], effortsSource: 'none', probedAt: 0 }] : []);
  next.llmModels = normalizeLlmModels(declaredModels as Parameters<typeof normalizeLlmModels>[0]);
  const memoryModel = typeof source.memoryModel === 'string' && source.memoryModel.trim() ? source.memoryModel : legacyModel;
  const effortRaw = source.memoryReasoningEffort;
  const memory = normalizeMemorySelection(
    next.llmModels,
    memoryModel,
    normalizeEfforts(typeof effortRaw === 'string' ? [effortRaw] : [])[0] ?? '',
  );
  next.memoryModel = memory.memoryModel;
  next.memoryReasoningEffort = memory.memoryReasoningEffort;
  if (source.displayLang === 'zh' || source.displayLang === 'en' || source.displayLang === 'ja' || source.displayLang === 'ko') {
    next.displayLang = source.displayLang;
  }
  const asr = isRecord(source.asr) ? source.asr : {};
  const silenceAfter = finiteNumber(asr.silenceAfterText) ? asr.silenceAfterText
    : finiteNumber(asr.rule2MinTrailingSilence) ? asr.rule2MinTrailingSilence : DEFAULT_GLOBAL_MODEL_CONFIG.asr.silenceAfterText;
  const silenceWithout = finiteNumber(asr.silenceWithoutText) ? asr.silenceWithoutText
    : finiteNumber(asr.rule1MinTrailingSilence) ? asr.rule1MinTrailingSilence : DEFAULT_GLOBAL_MODEL_CONFIG.asr.silenceWithoutText;
  const positiveInt = (value: unknown, fallback: number): number =>
    finiteNumber(value) && value > 0 ? Math.floor(value) : fallback;
  next.asr = {
    ...DEFAULT_GLOBAL_MODEL_CONFIG.asr,
    vadModelPath: typeof asr.vadModelPath === 'string' ? asr.vadModelPath.trim() : '',
    vadThreshold: optionalAsrRange(asr.vadThreshold, 0.05, 0.95),
    vadMinSpeechDuration: optionalAsrRange(asr.vadMinSpeechDuration, 0.15, 0.3),
    mode: asr.mode === 'remote' ? 'remote' : 'local',
    engine: typeof asr.engine === 'string' && asr.engine.trim() ? asr.engine.trim() : DEFAULT_GLOBAL_MODEL_CONFIG.asr.engine,
    modelDir: typeof asr.modelDir === 'string' ? asr.modelDir.trim() : '',
    endpoint: typeof asr.endpoint === 'string' ? asr.endpoint.trim() : '',
    sampleRate: positiveInt(asr.sampleRate, DEFAULT_GLOBAL_MODEL_CONFIG.asr.sampleRate),
    featureDim: positiveInt(asr.featureDim, DEFAULT_GLOBAL_MODEL_CONFIG.asr.featureDim),
    numThreads: positiveInt(asr.numThreads, DEFAULT_GLOBAL_MODEL_CONFIG.asr.numThreads),
    provider: typeof asr.provider === 'string' && asr.provider.trim() ? asr.provider.trim() : DEFAULT_GLOBAL_MODEL_CONFIG.asr.provider,
    debug: finiteNumber(asr.debug) ? Math.max(0, Math.floor(asr.debug)) : DEFAULT_GLOBAL_MODEL_CONFIG.asr.debug,
    silenceAfterText: Math.max(0.5, silenceAfter),
    silenceWithoutText: Math.max(0.2, silenceWithout),
  };
  return next;
};

const trimmedStringOrNull = (value: unknown): string | null =>
  typeof value === 'string' ? (value.trim() || null) : null;

export const normalizeLive2denvConfig = (input: unknown = {}): Live2denvConfig => {
  const source = isRecord(input) ? input : {};
  const next: Record<string, unknown> = {
    ...DEFAULT_LIVE2DENV_CONFIG,
    ...source,
  };
  const legacyModelPaths = Array.isArray(source.VITE_MODEL_PATHS) ? source.VITE_MODEL_PATHS.filter(Boolean) : [];
  const modelPaths = (Array.isArray(source.modelPaths) ? source.modelPaths.filter(Boolean) : legacyModelPaths)
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    .map((value) => value.trim());
  const currentRaw = source.currentModelPath ?? source.CURRENT_PATH ?? null;
  let currentModelPath = trimmedStringOrNull(currentRaw);
  if (!currentModelPath || !modelPaths.includes(currentModelPath)) currentModelPath = modelPaths[0] ?? null;
  next.modelPaths = [...new Set(modelPaths)];
  next.currentModelPath = currentModelPath;
  next.touchPriority = Array.isArray(source.touchPriority)
    ? stringList(source.touchPriority)
    : (Array.isArray(source.VITE_TOUCH_PRIORITY) ? stringList(source.VITE_TOUCH_PRIORITY) : undefined);
  next.eyeMaxUp = finiteNumber(source.eyeMaxUp) ? source.eyeMaxUp : source.VITE_EYE_MAX_UP;
  next.angleMaxUp = finiteNumber(source.angleMaxUp) ? source.angleMaxUp : source.VITE_ANGLE_MAX_UP;
  delete next.VITE_MODEL_PATHS;
  delete next.CURRENT_PATH;
  delete next.VITE_TOUCH_PRIORITY;
  delete next.VITE_EYE_MAX_UP;
  delete next.VITE_ANGLE_MAX_UP;
  const rawWindowState = isRecord(next.windowState) ? next.windowState : {};
  const rawBounds = isRecord(rawWindowState.bounds) ? rawWindowState.bounds : null;
  const boundsOk = rawBounds !== null
    && finiteNumber(rawBounds.x) && finiteNumber(rawBounds.y)
    && finiteNumber(rawBounds.width) && finiteNumber(rawBounds.height)
    && rawBounds.width > 0 && rawBounds.height > 0;
  next.windowState = {
    bounds: boundsOk && rawBounds ? {
      x: Math.round(rawBounds.x as number),
      y: Math.round(rawBounds.y as number),
      width: Math.round(rawBounds.width as number),
      height: Math.round(rawBounds.height as number),
    } : null,
    updatedAt: finiteNumber(rawWindowState.updatedAt) ? Math.max(0, Math.floor(rawWindowState.updatedAt)) : 0,
  };
  next.settings = normalizeGlobalModelConfig(source.settings ?? source.globalModelConfig ?? {});
  return next as Live2denvConfig;
};
