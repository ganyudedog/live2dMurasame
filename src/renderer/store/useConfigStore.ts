import { create } from 'zustand';
import { debug, info, warn } from '../utils/log';
import { toast } from 'react-hot-toast';

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
  return window.ConfigAPI?.getSnapshot?.();
};

let listenersAttached = false;

export const useConfigStore = create<ConfigState>((set) => {
  const snapshot = getInitialSnapshot();

  if (!listenersAttached && typeof window !== 'undefined') {
    listenersAttached = true;
    const configApi = window.ConfigAPI;
    const modelApi = window.ModelAPI;
    const detachLive2denv = configApi?.onLive2denvConfigUpdated?.((payload) => {
      debug('config', 'live2denv.updated', {
        hasLive2denv: !!payload?.live2denvConfig,
        hasGlobalModelConfig: !!payload?.globalModelConfig,
        activeModelPath: payload?.activeModelPath ?? null,
        modelKey: payload?.modelKey ?? null,
        hasFileUrl: !!payload?.activeModelFileUrl,
      });
      set((state) => ({
        live2denvConfig: payload?.live2denvConfig ?? state.live2denvConfig,
        globalModelConfig: payload?.globalModelConfig ?? state.globalModelConfig,
        activeModelPath: payload?.activeModelPath ?? state.activeModelPath,
        modelKey: payload?.modelKey ?? state.modelKey,
        activeModelFileUrl: payload?.activeModelFileUrl ?? state.activeModelFileUrl,
      }));
    });
    const detachModel = modelApi?.onConfigUpdated?.((payload) => {
      const overrides = readOverrides(payload);
      const modelFileUrl = isRecord(payload) ? payload['modelFileUrl'] : undefined;
      debug('config', 'model.updated', {
        modelPath: payload?.modelPath ?? null,
        modelKey: payload?.modelKey ?? null,
        hasConfig: !!payload?.config,
        hasOverrides: Object.keys(overrides).length > 0,
        hasFileUrl: typeof modelFileUrl === 'string' && modelFileUrl.length > 0,
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
      const configApi = window.ConfigAPI;
      const modelApi = window.ModelAPI;
      try {
        const [live2denvConfig, globalModelConfig, modelBundle] = await Promise.all([
          configApi?.getLive2denvConfig?.(),
          configApi?.getGlobalModelConfig?.(),
          modelApi?.getConfig?.(),
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
        toast.error(String(e instanceof Error ? e.message : e));
        warn('config', 'refresh.failed', { err: String(e) });
        throw e;
      }
    },
    updateGlobalModelConfig: async (patch) => {
      const configApi = window.ConfigAPI;
      if (!configApi?.updateGlobalModelConfig) {
        warn('config', 'updateGlobalModelConfig.missingApi');
        return null;
      }
      try {
        const next = await configApi.updateGlobalModelConfig(patch);
        set((state) => ({
          globalModelConfig: (next as PetGlobalModelConfig | undefined) ?? state.globalModelConfig,
        }));
        return (next as PetGlobalModelConfig | undefined) ?? null;
      } catch (e) {
        toast.error(String(e instanceof Error ? e.message : e));
        warn('config', 'updateGlobalModelConfig.failed', { err: String(e) });
        throw e;
      }
    },
    updateLive2denvConfig: async (patch) => {
      const configApi = window.ConfigAPI;
      if (!configApi?.updateLive2denvConfig) {
        warn('config', 'updateLive2denvConfig.missingApi');
        return null;
      }
      try {
        const next = await configApi.updateLive2denvConfig(patch);
        set((state) => {
          const resolvedPath = next?.CURRENT_PATH ?? state.activeModelPath;
          return {
            live2denvConfig: next ?? state.live2denvConfig,
            activeModelPath: typeof resolvedPath === 'string' ? resolvedPath : state.activeModelPath,
          };
        });
        return next ?? null;
      } catch (e) {
        toast.error(String(e instanceof Error ? e.message : e));
        warn('config', 'updateLive2denvConfig.failed', { err: String(e) });
        throw e;
      }
    },
    updateModelConfig: async (options) => {
      const modelApi = window.ModelAPI;
      if (!modelApi?.updateConfig) {
        warn('config', 'updateModelConfig.missingApi');
        return null;
      }
      try {
        const result = await modelApi.updateConfig(options);
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
        toast.error(String(e instanceof Error ? e.message : e));
        warn('config', 'updateModelConfig.failed', { err: String(e) });
        throw e;
      }
    },
    pickModelFile: async () => {
      const modelApi = window.ModelAPI;
      if (!modelApi?.pickModelFile) {
        warn('config', 'pickModelFile.missingApi');
        return null;
      }
      try {
        const modelDir = await modelApi.pickModelFile();
        return typeof modelDir === 'string' ? modelDir : null;
      } catch (e) {
        toast.error(String(e instanceof Error ? e.message : e));
        warn('config', 'pickModelFile.failed', { err: String(e) });
        throw e;
      }
    },
  };
});
