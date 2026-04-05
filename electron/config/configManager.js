import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { getModelKeyFromPath } from '../utils/modelKey.js';
import {
  DEFAULT_LIVE2DENV_CONFIG,
  DEFAULT_MODEL_CONFIG,
  DEFAULT_TOUCH_PRIORITY,
  DEFAULT_GLOBAL_MODEL_CONFIG,
  normalizeLive2denvConfig,
  normalizeGlobalModelConfig,
  normalizeModelConfig,
} from './globalConfig.js';

const CONFIG_DIR_NAME = 'config';
const GLOBAL_CONFIG_FILENAME = 'live2denv.json';
const GLOBAL_MODEL_CONFIG_FILENAME = 'globalModelConfig.json';

const DEFAULT_MODEL_MEMORY_RECENT = {
  version: 1,
  messages: [],
  updatedAt: 0,
};

const DEFAULT_MODEL_MEMORY_SUMMARY = {
  version: 1,
  summary: '',
  facts: [],
  open_loops: [],
  updatedAt: 0,
};

const DEFAULT_MODEL_MEMORY_META = {
  version: 1,
  messageCount: 0,
  lastSummarizedCount: 0,
  lastMessageAt: 0,
  updatedAt: 0,
};

const toSafeObject = (value) => {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
};

const normalizeTextField = (value) => {
  return typeof value === 'string' ? value : '';
};

const normalizeTimestamp = (value) => {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
};

const normalizeStringList = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
};

const normalizeModelMemoryMessage = (input = {}) => {
  const source = toSafeObject(input);
  const role = typeof source.role === 'string' && source.role.trim() ? source.role.trim() : 'user';
  return {
    id: normalizeTextField(source.id),
    role,
    text: normalizeTextField(source.text ?? source.content),
    source: normalizeTextField(source.source),
    name: normalizeTextField(source.name),
    ts: normalizeTimestamp(source.ts ?? source.timestamp),
    meta: toSafeObject(source.meta),
  };
};

export const normalizeModelMemoryRecent = (input = {}) => {
  const source = toSafeObject(input);
  return {
    version: 1,
    messages: Array.isArray(source.messages)
      ? source.messages.map((item) => normalizeModelMemoryMessage(item))
      : [...DEFAULT_MODEL_MEMORY_RECENT.messages],
    updatedAt: normalizeTimestamp(source.updatedAt),
  };
};

export const normalizeModelMemorySummary = (input = {}) => {
  const source = toSafeObject(input);
  return {
    version: 1,
    summary: normalizeTextField(source.summary),
    facts: normalizeStringList(source.facts),
    open_loops: normalizeStringList(source.open_loops),
    updatedAt: normalizeTimestamp(source.updatedAt),
  };
};

export const normalizeModelMemoryMeta = (input = {}) => {
  const source = toSafeObject(input);
  return {
    version: 1,
    messageCount: normalizeTimestamp(source.messageCount),
    lastSummarizedCount: normalizeTimestamp(source.lastSummarizedCount),
    lastMessageAt: normalizeTimestamp(source.lastMessageAt),
    updatedAt: normalizeTimestamp(source.updatedAt),
  };
};

const ensureAppReady = () => {
  if (!app || !app.isReady()) {
    throw new Error('Electron app is not ready to access userData path');
  }
};

const getBaseConfigDir = () => {
  ensureAppReady();
  return path.join(app.getPath('userData'), CONFIG_DIR_NAME);
};

const getGlobalConfigPath = () => path.join(getBaseConfigDir(), GLOBAL_CONFIG_FILENAME);

const getGlobalModelConfigPath = () => path.join(getBaseConfigDir(), GLOBAL_MODEL_CONFIG_FILENAME);

// 生成一个安全的模型key，避免因路径问题导致的配置冲突
const getSafeModelKey = (modelDir) => {
  const key = getModelKeyFromPath(modelDir);
  return key || `model-${Date.now().toString(36)}`;
};

// 基于模型路径生成一个稳定且安全的配置目录，避免不同模型路径因细微差异导致的配置分散或冲突
export const getModelConfigDirFor = (modelDir) => {
  const modelKey = getSafeModelKey(modelDir);
  return path.join(getBaseConfigDir(), modelKey);
};

export const getModelMemoryDirFor = (modelDir) => {
  return path.join(getModelConfigDirFor(modelDir), 'memory');
};

export const getModelMemoryFilePathsFor = (modelDir) => {
  const memoryDir = getModelMemoryDirFor(modelDir);
  return {
    memoryDir,
    recentPath: path.join(memoryDir, 'recent.json'),
    summaryPath: path.join(memoryDir, 'summary.json'),
    metaPath: path.join(memoryDir, 'meta.json'),
  };
};

const readJsonFile = (filePath, fallback) => {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    if (!raw) {
      return fallback;
    }
    return JSON.parse(raw);
  } catch (error) {
    console.warn('[config] read failed', filePath, error);
    return fallback;
  }
};

const writeJsonFile = (filePath, data) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
};

export const getModelConfigPathFor = (modelDir) => {
  const modelKey = path.basename(getModelConfigDirFor(modelDir));
  return path.join(getModelConfigDirFor(modelDir), `${modelKey}.json`);
};

export const ensureConfigDirectories = () => {
  const baseDir = getBaseConfigDir();
  fs.mkdirSync(baseDir, { recursive: true });
};

const ensureModelStorageStructure = (modelDir) => {
  const configPath = getModelConfigPathFor(modelDir);
  const modelDirPath = path.dirname(configPath);
  const { memoryDir, recentPath, summaryPath, metaPath } = getModelMemoryFilePathsFor(modelDir);

  fs.mkdirSync(modelDirPath, { recursive: true });
  fs.mkdirSync(memoryDir, { recursive: true });

  if (!fs.existsSync(recentPath)) {
    writeJsonFile(recentPath, DEFAULT_MODEL_MEMORY_RECENT);
  }
  if (!fs.existsSync(summaryPath)) {
    writeJsonFile(summaryPath, DEFAULT_MODEL_MEMORY_SUMMARY);
  }
  if (!fs.existsSync(metaPath)) {
    writeJsonFile(metaPath, DEFAULT_MODEL_MEMORY_META);
  }

  return {
    configPath,
    modelDirPath,
    memoryDir,
    recentPath,
    summaryPath,
    metaPath,
  };
};

export const loadLive2denvConfig = () => {
  ensureConfigDirectories();
  const configPath = getGlobalConfigPath();
  const raw = readJsonFile(configPath, DEFAULT_LIVE2DENV_CONFIG);
  const normalized = normalizeLive2denvConfig(raw);
  if (!fs.existsSync(configPath)) {
    writeJsonFile(configPath, normalized);
  }
  return normalized;
};

export const saveLive2denvConfig = (config) => {
  ensureConfigDirectories();
  const normalized = normalizeLive2denvConfig(config);
  const configPath = getGlobalConfigPath();
  writeJsonFile(configPath, normalized);
  return normalized;
};

export const loadGlobalModelConfig = () => {
  ensureConfigDirectories();
  const configPath = getGlobalModelConfigPath();
  const raw = readJsonFile(configPath, DEFAULT_GLOBAL_MODEL_CONFIG);
  const normalized = normalizeGlobalModelConfig(raw);
  if (!fs.existsSync(configPath)) {
    writeJsonFile(configPath, normalized);
  }
  return normalized;
};

export const saveGlobalModelConfig = (settings) => {
  ensureConfigDirectories();
  const normalized = normalizeGlobalModelConfig(settings);
  const configPath = getGlobalModelConfigPath();
  writeJsonFile(configPath, normalized);
  return normalized;
};

export const loadModelConfig = (modelDir) => {
  ensureConfigDirectories();
  const { configPath } = ensureModelStorageStructure(modelDir);
  const config = normalizeModelConfig(readJsonFile(configPath, DEFAULT_MODEL_CONFIG));
  if (!fs.existsSync(configPath)) {
    writeJsonFile(configPath, config);
  }
  return config;
};

export const saveModelConfig = (modelDir, config) => {
  ensureConfigDirectories();
  const { configPath } = ensureModelStorageStructure(modelDir);
  const merged = normalizeModelConfig(config);
  writeJsonFile(configPath, merged);
  return merged;
};

export const loadModelMemoryRecent = (modelDir) => {
  ensureConfigDirectories();
  const { recentPath } = ensureModelStorageStructure(modelDir);
  return normalizeModelMemoryRecent(readJsonFile(recentPath, DEFAULT_MODEL_MEMORY_RECENT));
};

export const saveModelMemoryRecent = (modelDir, recent) => {
  ensureConfigDirectories();
  const { recentPath } = ensureModelStorageStructure(modelDir);
  const normalized = normalizeModelMemoryRecent(recent);
  writeJsonFile(recentPath, normalized);
  return normalized;
};

export const loadModelMemorySummary = (modelDir) => {
  ensureConfigDirectories();
  const { summaryPath } = ensureModelStorageStructure(modelDir);
  return normalizeModelMemorySummary(readJsonFile(summaryPath, DEFAULT_MODEL_MEMORY_SUMMARY));
};

export const saveModelMemorySummary = (modelDir, summary) => {
  ensureConfigDirectories();
  const { summaryPath } = ensureModelStorageStructure(modelDir);
  const normalized = normalizeModelMemorySummary(summary);
  writeJsonFile(summaryPath, normalized);
  return normalized;
};

export const loadModelMemoryMeta = (modelDir) => {
  ensureConfigDirectories();
  const { metaPath } = ensureModelStorageStructure(modelDir);
  return normalizeModelMemoryMeta(readJsonFile(metaPath, DEFAULT_MODEL_MEMORY_META));
};

export const saveModelMemoryMeta = (modelDir, meta) => {
  ensureConfigDirectories();
  const { metaPath } = ensureModelStorageStructure(modelDir);
  const normalized = normalizeModelMemoryMeta(meta);
  writeJsonFile(metaPath, normalized);
  return normalized;
};

export const loadModelMemory = (modelDir) => {
  ensureConfigDirectories();
  ensureModelStorageStructure(modelDir);
  return {
    recent: loadModelMemoryRecent(modelDir),
    summary: loadModelMemorySummary(modelDir),
    meta: loadModelMemoryMeta(modelDir),
  };
};

export const saveModelMemory = (modelDir, patch = {}) => {
  ensureConfigDirectories();
  ensureModelStorageStructure(modelDir);

  const current = loadModelMemory(modelDir);
  const source = toSafeObject(patch);
  const next = {
    recent: Object.prototype.hasOwnProperty.call(source, 'recent')
      ? saveModelMemoryRecent(modelDir, { ...current.recent, ...toSafeObject(source.recent) })
      : current.recent,
    summary: Object.prototype.hasOwnProperty.call(source, 'summary')
      ? saveModelMemorySummary(modelDir, { ...current.summary, ...toSafeObject(source.summary) })
      : current.summary,
    meta: Object.prototype.hasOwnProperty.call(source, 'meta')
      ? saveModelMemoryMeta(modelDir, { ...current.meta, ...toSafeObject(source.meta) })
      : current.meta,
  };

  return next;
};

export const removeModelConfig = (modelDir) => {
  try {
    const modelDirPath = getModelConfigDirFor(modelDir);
    if (fs.existsSync(modelDirPath)) {
      fs.rmSync(modelDirPath, { recursive: true, force: true });
    }
  } catch (error) {
    console.warn('[config] remove failed', modelDir, error);
  }
};

export const listModelConfigs = () => {
  ensureConfigDirectories();
  const dir = getBaseConfigDir();
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const configPath = path.join(dir, entry.name, `${entry.name}.json`);
      return fs.existsSync(configPath) ? configPath : null;
    })
    .filter(Boolean);
};

export {
  DEFAULT_LIVE2DENV_CONFIG,
  DEFAULT_MODEL_CONFIG,
  DEFAULT_TOUCH_PRIORITY,
  DEFAULT_MODEL_MEMORY_RECENT,
  DEFAULT_MODEL_MEMORY_SUMMARY,
  DEFAULT_MODEL_MEMORY_META,
  normalizeLive2denvConfig,
  normalizeGlobalModelConfig,
  normalizeModelConfig,
};
