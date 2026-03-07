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

const getGlobalModelConfigPath = () => path.join(getBaseConfigDir(), GLOBAL_MODEL_CONFIG_FILENAME);

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

export const getModelConfigPathFor = (modelDir) => {
  const key = getModelKeyFromPath(modelDir);
  if (!key) {
    return path.join(getModelConfigDir(), `model-${Date.now().toString(36)}.json`);
  }
  return path.join(getModelConfigDir(), `${key}.json`);
};

export const ensureConfigDirectories = () => {
  const baseDir = getBaseConfigDir();
  const modelDir = getModelConfigDir();
  fs.mkdirSync(baseDir, { recursive: true });
  fs.mkdirSync(modelDir, { recursive: true });
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
  const configPath = getModelConfigPathFor(modelDir);
  const config = normalizeModelConfig(readJsonFile(configPath, DEFAULT_MODEL_CONFIG));
  if (!fs.existsSync(configPath)) {
    writeJsonFile(configPath, config);
  }
  return config;
};

export const saveModelConfig = (modelDir, config) => {
  ensureConfigDirectories();
  const configPath = getModelConfigPathFor(modelDir);
  const merged = normalizeModelConfig(config);
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
  DEFAULT_LIVE2DENV_CONFIG,
  DEFAULT_MODEL_CONFIG,
  DEFAULT_TOUCH_PRIORITY,
  normalizeLive2denvConfig,
  normalizeGlobalModelConfig,
  normalizeModelConfig,
};
