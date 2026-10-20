import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { getModelKeyFromPath } from '../utils/modelKey.js';
import {
  DEFAULT_LIVE2DENV_CONFIG,
  DEFAULT_MODEL_CONFIG,
  normalizeLive2denvConfig,
  normalizeModelConfig,
} from './globalConfig.js';

let logService = null;

export const configureConfigDao = (service) => {
  logService = service ?? null;
};

const reportError = (event, data = {}) => {
  logService?.error?.('storage', event, data);
};

const CONFIG_DIR_NAME = 'config';
const GLOBAL_CONFIG_FILENAME = 'live2denv.json';

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

export const getLegacyModelMemoryFilePathsFor = (modelDir) => {
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
    reportError('json.read.failed', { filePath, message: String(error?.message ?? error) });
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
  const memoryDir = getModelMemoryDirFor(modelDir);

  fs.mkdirSync(modelDirPath, { recursive: true });

  return {
    configPath,
    modelDirPath,
    memoryDir,
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

export const loadModelConfig = (modelDir) => {
  ensureConfigDirectories();
  const { configPath } = ensureModelStorageStructure(modelDir);

  if (fs.existsSync(configPath)) {
    const raw = readJsonFile(configPath, DEFAULT_MODEL_CONFIG);
    const normalized = normalizeModelConfig(raw);
    // 读取旧模型配置时立即落盘一次 persona 迁移，后续快照和外部编辑器只看到规范字段。
    if (JSON.stringify(raw) !== JSON.stringify(normalized)) writeJsonFile(configPath, normalized);
    return normalized;
  }

  const config = normalizeModelConfig(DEFAULT_MODEL_CONFIG);
  writeJsonFile(configPath, config);
  return config;
};

export const saveModelConfig = (modelDir, config) => {
  ensureConfigDirectories();
  const { configPath } = ensureModelStorageStructure(modelDir);
  const merged = normalizeModelConfig(config);
  writeJsonFile(configPath, merged);
  return merged;
};

export const removeModelConfig = (modelDir) => {
  try {
    const modelDirPath = getModelConfigDirFor(modelDir);
    if (fs.existsSync(modelDirPath)) {
      fs.rmSync(modelDirPath, { recursive: true, force: true });
    }
  } catch (error) {
    reportError('model.remove.failed', { modelDir, message: String(error?.message ?? error) });
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
  normalizeLive2denvConfig,
  normalizeModelConfig,
};
