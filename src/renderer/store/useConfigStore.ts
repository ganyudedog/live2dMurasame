import { create } from 'zustand';
import { agg, info, warn } from '../utils/log';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const isStringRecord = (value: unknown): value is Record<string, string> => {
  if (!isRecord(value)) return false;
  return Object.values(value).every((v) => typeof v === 'string');
};

const readOverrides = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) return {};
  const configOverrides = value['configOverrides'];
  if (isStringRecord(configOverrides)) return configOverrides;
  return {};
};

// 多模型适配上下文
interface ConfigState {
  live2denvConfig: PetLive2denvConfig | null;
  globalModelConfig: PetGlobalModelConfig | null;
  modelConfig: PetModelConfig | null;
  activeModelPath: string | null;
  modelKey: string | null;
  activeModelFileUrl: string | null;
  configOverrides: Record<string, string>;
  // 是否成功加载到初始快照
  hydrated: boolean;
  refresh: () => Promise<void>;
  updateGlobalModelConfig: (patch: PetGlobalModelConfigPayload) => Promise<PetGlobalModelConfig | null>;
  updateLive2denvConfig: (patch: Partial<PetLive2denvConfig>) => Promise<PetLive2denvConfig | null>;
  updateModelConfig: (options: { modelPath?: string; patch?: Partial<PetModelConfig> }) => Promise<{
    modelPath: string | null;
    modelKey?: string | null;
    activeModelFileUrl?: string | null;
    config: PetModelConfig | null;
    configOverrides: Record<string, string>;
  } | null>;
  pickModelFile: () => Promise<string | null>;
}

const getInitialSnapshot = (): PetConfigSnapshot | undefined => {
  if (typeof window === 'undefined') return undefined;
  return window.petAPI?.getConfigSnapshot?.();
};

let listenersAttached = false;

export const useConfigStore = create<ConfigState>((set) => {
  const snapshot = getInitialSnapshot();

  if (!listenersAttached && typeof window !== 'undefined') {
    listenersAttached = true;
    const api = window.petAPI;
    const detachLive2denv = api?.onLive2denvConfigUpdated?.((payload) => {
      agg({
        level: 'debug',
        ns: 'config',
        event: 'live2denv.updated',
        key: 'live2denvConfig',
        windowMs: 800,
        data: {
          hasLive2denv: !!payload?.live2denvConfig,
          hasGlobalModelConfig: !!payload?.globalModelConfig,
          activeModelPath: payload?.activeModelPath ?? null,
          modelKey: payload?.modelKey ?? null,
          hasFileUrl: !!payload?.activeModelFileUrl,
        },
      });
      set((state) => ({
        live2denvConfig: payload?.live2denvConfig ?? state.live2denvConfig,
        globalModelConfig: payload?.globalModelConfig ?? state.globalModelConfig,
        activeModelPath: payload?.activeModelPath ?? state.activeModelPath,
        modelKey: payload?.modelKey ?? state.modelKey,
        activeModelFileUrl: payload?.activeModelFileUrl ?? state.activeModelFileUrl,
      }));
    });
    const detachModel = api?.onModelConfigUpdated?.((payload) => {
      const overrides = readOverrides(payload);
      const modelFileUrl = isRecord(payload) ? payload['modelFileUrl'] : undefined;
      agg({
        level: 'debug',
        ns: 'config',
        event: 'model.updated',
        key: payload?.modelKey ?? payload?.modelPath ?? 'unknown',
        windowMs: 800,
        data: {
          modelPath: payload?.modelPath ?? null,
          modelKey: payload?.modelKey ?? null,
          hasConfig: !!payload?.config,
          hasOverrides: Object.keys(overrides).length > 0,
          hasFileUrl: typeof modelFileUrl === 'string' && modelFileUrl.length > 0,
        },
      });
      set((state) => ({
        modelConfig: payload?.config ?? state.modelConfig,
        configOverrides: Object.keys(overrides).length
          ? overrides
          : state.configOverrides,
        activeModelPath: payload?.modelPath ?? state.activeModelPath,
        modelKey: payload?.modelKey ?? state.modelKey,
        activeModelFileUrl: payload?.modelFileUrl ?? state.activeModelFileUrl,
      }));
    });
    if (typeof window !== 'undefined') {
      // 卸载时清理监听器
      window.addEventListener('beforeunload', () => {
        detachLive2denv?.();
        detachModel?.();
      });
    }
  }

  return {
    live2denvConfig: snapshot?.live2denvConfig ?? null,
    globalModelConfig: snapshot?.globalModelConfig ?? null,
    modelConfig: snapshot?.modelConfig ?? null,
    activeModelPath: snapshot?.activeModelPath ?? null,
    modelKey: snapshot?.modelKey ?? null,
    activeModelFileUrl: snapshot?.activeModelFileUrl ?? null,
    configOverrides: readOverrides(snapshot),
    hydrated: Boolean(snapshot),
    refresh: async () => {
      info('config', 'refresh.start');
      const api = window.petAPI;
      try {
        const [live2denvConfig, globalModelConfig, modelBundle] = await Promise.all([
          api?.getLive2denvConfig?.(),
          api?.getGlobalModelConfig?.(),
          api?.getModelConfig?.(),
        ]);

        const modelOverrides = readOverrides(modelBundle);
        const overrides = Object.keys(modelOverrides).length
          ? modelOverrides
          : readOverrides(snapshot);
        const nextActiveModelPath = modelBundle?.modelPath
          ?? live2denvConfig?.CURRENT_PATH
          ?? snapshot?.activeModelPath
          ?? null;
        const nextModelKey = modelBundle?.modelKey
          ?? snapshot?.modelKey
          ?? null;
        const nextFileUrl = modelBundle?.activeModelFileUrl
          ?? snapshot?.activeModelFileUrl
          ?? null;

        set({
          live2denvConfig: live2denvConfig ?? snapshot?.live2denvConfig ?? null,
          globalModelConfig: (globalModelConfig as PetGlobalModelConfig | undefined) ?? snapshot?.globalModelConfig ?? null,
          modelConfig: modelBundle?.config ?? snapshot?.modelConfig ?? null,
          activeModelPath: nextActiveModelPath,
          modelKey: nextModelKey,
          activeModelFileUrl: nextFileUrl,
          configOverrides: overrides,
          hydrated: true,
        });
        info('config', 'refresh.ok', {
          activeModelPath: nextActiveModelPath,
          modelKey: nextModelKey,
          hasFileUrl: !!nextFileUrl,
        });
      } catch (e) {
        warn('config', 'refresh.failed', { err: String(e) });
        throw e;
      }
    },
    updateGlobalModelConfig: async (patch) => {
      const api = window.petAPI;
      if (!api?.updateGlobalModelConfig) {
        warn('config', 'updateGlobalModelConfig.missingApi');
        return null;
      }
      try {
        const next = await api.updateGlobalModelConfig(patch);
        set((state) => ({
          globalModelConfig: (next as PetGlobalModelConfig | undefined) ?? state.globalModelConfig,
        }));
        return (next as PetGlobalModelConfig | undefined) ?? null;
      } catch (e) {
        warn('config', 'updateGlobalModelConfig.failed', { err: String(e) });
        throw e;
      }
    },
    updateLive2denvConfig: async (patch) => {
      const api = window.petAPI;
      if (!api?.updateLive2denvConfig) {
        warn('config', 'updateLive2denvConfig.missingApi');
        return null;
      }
      try {
        const next = await api.updateLive2denvConfig(patch);
        set((state) => {
          const resolvedPath = next?.CURRENT_PATH ?? state.activeModelPath;
          return {
            live2denvConfig: next ?? state.live2denvConfig,
            activeModelPath: typeof resolvedPath === 'string' ? resolvedPath : state.activeModelPath,
          };
        });
        return next ?? null;
      } catch (e) {
        warn('config', 'updateLive2denvConfig.failed', { err: String(e) });
        throw e;
      }
    },
    updateModelConfig: async (options) => {
      const api = window.petAPI;
      if (!api?.updateModelConfig) {
        warn('config', 'updateModelConfig.missingApi');
        return null;
      }
      try {
        const result = await api.updateModelConfig(options);
        if (!result) return null;
        set((state) => ({
          modelConfig: result.config ?? state.modelConfig,
          activeModelPath: result.modelPath ?? state.activeModelPath,
          modelKey: result.modelKey ?? state.modelKey,
          activeModelFileUrl: result.activeModelFileUrl ?? state.activeModelFileUrl,
          configOverrides: result.configOverrides ?? state.configOverrides,
        }));
        return result;
      } catch (e) {
        warn('config', 'updateModelConfig.failed', { err: String(e) });
        throw e;
      }
    },
    pickModelFile: async () => {
      const api = window.petAPI;
      if (!api?.pickModelFile) {
        warn('config', 'pickModelFile.missingApi');
        return null;
      }
      try {
        const modelDir = await api.pickModelFile();
        return typeof modelDir === 'string' ? modelDir : null;
      } catch (e) {
        warn('config', 'pickModelFile.failed', { err: String(e) });
        throw e;
      }
    },
  };
});
