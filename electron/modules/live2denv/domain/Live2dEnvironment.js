import { WindowState } from './WindowState.js';

const normalizePath = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

export class Live2dEnvironment {
  constructor({ modelPaths = [], currentModelPath = null, windowState = null, settings = {} } = {}) {
    this.modelPaths = [...new Set(modelPaths.map(normalizePath).filter(Boolean))];
    const current = normalizePath(currentModelPath);
    this.currentModelPath = current && this.modelPaths.includes(current) ? current : (this.modelPaths[0] ?? null);
    this.windowState = windowState instanceof WindowState ? windowState : new WindowState(windowState ?? {});
    this.settings = { ...(settings ?? {}) };
  }

  selectModel(modelPath) {
    const normalized = normalizePath(modelPath);
    if (!normalized || !this.modelPaths.includes(normalized)) throw new Error('Model path is not registered');
    return new Live2dEnvironment({ modelPaths: this.modelPaths, currentModelPath: normalized, windowState: this.windowState, settings: this.settings });
  }

  replaceModelPaths(modelPaths, currentModelPath = this.currentModelPath) {
    return new Live2dEnvironment({ modelPaths, currentModelPath, windowState: this.windowState, settings: this.settings });
  }

  withSettings(settings) {
    const nextSettings = { ...this.settings, ...settings };
    if (settings?.asr && typeof settings.asr === 'object') {
      nextSettings.asr = { ...(this.settings.asr ?? {}), ...settings.asr };
    }
    return new Live2dEnvironment({ modelPaths: this.modelPaths, currentModelPath: this.currentModelPath, windowState: this.windowState, settings: nextSettings });
  }

  recordWindowBounds(bounds) {
    return new Live2dEnvironment({
      modelPaths: this.modelPaths,
      currentModelPath: this.currentModelPath,
      windowState: this.windowState.recordUserBounds(bounds),
      settings: this.settings,
    });
  }

  toPersistence() {
    return { modelPaths: [...this.modelPaths], currentModelPath: this.currentModelPath, windowState: this.windowState.toJSON(), settings: { ...this.settings } };
  }
}
