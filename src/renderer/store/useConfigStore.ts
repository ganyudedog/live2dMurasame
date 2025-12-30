import { create } from 'zustand';

interface ConfigState {
  globalConfig: PetGlobalConfig | null;
  modelConfig: PetModelConfig | null;
  activeModelPath: string | null;
  envOverrides: Record<string, string>;
  // 是否成功加载到初始快照
  hydrated: boolean;
  refresh: () => Promise<void>;
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
    const detachGlobal = api?.onGlobalConfigUpdated?.((payload) => {
      set((state) => ({
        globalConfig: payload?.global ?? state.globalConfig,
        activeModelPath: payload?.activeModelPath ?? state.activeModelPath,
      }));
    });
    const detachModel = api?.onModelConfigUpdated?.((payload) => {
      set((state) => ({
        modelConfig: payload?.config ?? state.modelConfig,
        envOverrides: payload?.envOverrides ?? state.envOverrides,
        activeModelPath: payload?.modelPath ?? state.activeModelPath,
      }));
    });
    if (typeof window !== 'undefined') {
      // 卸载时清理监听器
      window.addEventListener('beforeunload', () => {
        detachGlobal?.();
        detachModel?.();
      });
    }
  }

  return {
    globalConfig: snapshot?.global ?? null,
    modelConfig: snapshot?.modelConfig ?? null,
    activeModelPath: snapshot?.activeModelPath ?? null,
    envOverrides: snapshot?.envOverrides ?? {},
    hydrated: Boolean(snapshot),
    refresh: async () => {
      const api = window.petAPI;
      const [globalConfig, modelBundle] = await Promise.all([
        api?.getGlobalConfig?.(),
        api?.getModelConfig?.(),
      ]);
      set({
        globalConfig: globalConfig ?? snapshot?.global ?? null,
        modelConfig: modelBundle?.config ?? snapshot?.modelConfig ?? null,
        activeModelPath: modelBundle?.modelPath
          ?? globalConfig?.CURRENT_PATH
          ?? snapshot?.activeModelPath
          ?? null,
        envOverrides: modelBundle?.envOverrides ?? snapshot?.envOverrides ?? {},
        hydrated: true,
      });
    },
  };
});
