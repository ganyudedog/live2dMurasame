import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_GLOBAL_CONFIG,
  DEFAULT_MODEL_CONFIG,
  DEFAULT_TOUCH_PRIORITY,
  normalizeGlobalConfig,
  normalizeLive2denvGlobal,
} from './globalConfig.js';

const CONFIG_DIR_NAME = 'config';
const GLOBAL_CONFIG_FILENAME = 'liv2denv.json';
const MODEL_CONFIG_DIR_NAME = 'models';

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

const getModelConfigDir = () => path.join(getBaseConfigDir(), MODEL_CONFIG_DIR_NAME);

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

const sanitizeModelKey = (modelPath) => {
  const baseName = path.basename(modelPath || '');
  const safeName = baseName
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (safeName) {
    return safeName;
  }
  return `model-${Date.now().toString(36)}`;
};

export const getModelConfigPathFor = (modelDir) => {
  const key = sanitizeModelKey(modelDir);
  return path.join(getModelConfigDir(), `${key}.json`);
};

export const ensureConfigDirectories = () => {
  const baseDir = getBaseConfigDir();
  const modelDir = getModelConfigDir();
  fs.mkdirSync(baseDir, { recursive: true });
  fs.mkdirSync(modelDir, { recursive: true });
};

export const loadGlobalConfig = () => {
  ensureConfigDirectories();
  const configPath = getGlobalConfigPath();
  const config = readJsonFile(configPath, DEFAULT_GLOBAL_CONFIG);
  const normalized = normalizeGlobalConfig(config);
  if (!fs.existsSync(configPath)) {
    writeJsonFile(configPath, normalized);
  }
  return normalized;
};

export const saveGlobalConfig = (config) => {
  ensureConfigDirectories();
  const normalized = normalizeGlobalConfig(config);
  const configPath = getGlobalConfigPath();
  writeJsonFile(configPath, normalized);
  return normalized;
};

export const loadGlobalSettings = () => {
  const config = loadGlobalConfig();
  return normalizeLive2denvGlobal(config.GLOBAL);
};

export const saveGlobalSettings = (settings) => {
  const config = loadGlobalConfig();
  const normalized = normalizeLive2denvGlobal(settings);
  const next = { ...config, GLOBAL: normalized };
  return saveGlobalConfig(next);
};

export const loadModelConfig = (modelDir) => {
  ensureConfigDirectories();
  const configPath = getModelConfigPathFor(modelDir);
  const config = readJsonFile(configPath, DEFAULT_MODEL_CONFIG);
  if (!fs.existsSync(configPath)) {
    writeJsonFile(configPath, config);
  }
  return { ...DEFAULT_MODEL_CONFIG, ...config };
};

export const saveModelConfig = (modelDir, config) => {
  ensureConfigDirectories();
  const configPath = getModelConfigPathFor(modelDir);
  const merged = { ...DEFAULT_MODEL_CONFIG, ...config };
  writeJsonFile(configPath, merged);
  return merged;
};

export const removeModelConfig = (modelDir) => {
  try {
    const configPath = getModelConfigPathFor(modelDir);
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
  } catch (error) {
    console.warn('[config] remove failed', modelDir, error);
  }
};

export const listModelConfigs = () => {
  ensureConfigDirectories();
  const dir = getModelConfigDir();
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(dir, name));
};

export {
  DEFAULT_GLOBAL_CONFIG,
  DEFAULT_MODEL_CONFIG,
  DEFAULT_TOUCH_PRIORITY,
  normalizeGlobalConfig,
  normalizeLive2denvGlobal,
};
