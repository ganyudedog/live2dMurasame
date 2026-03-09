import { useEffect, useMemo, useRef } from 'react';
import type { GlobalUiSettings, ModelConfig, ModelEntry } from '../types';
import { sharedStoreClient } from '../../../shared/sharedStoreClient';
import { useDebouncedRemoteDraft } from '../hooks/useDebouncedRemoteDraft';

const SCALE_PERSIST_DEBOUNCE_MS = 250;

const isSameRagProfile = (left: ModelConfig['rag']['profile'], right: ModelConfig['rag']['profile']) => {
  return left.personal === right.personal
    && left.speakingStyle === right.speakingStyle
    && left.relation === right.relation
    && left.banned === right.banned
    && left.world === right.world;
};

export default function HomePage({
  model,
  globalSettings,
  onGlobalSettingsChange,
  modelConfig,
  onModelConfigChange,
  onGotoModels,
}: {
  model: ModelEntry;
  globalSettings: GlobalUiSettings;
  onGlobalSettingsChange: (patch: Partial<GlobalUiSettings>) => Promise<void>;
  modelConfig: ModelConfig;
  onModelConfigChange: (next: ModelConfig) => Promise<void>;
  onGotoModels: () => void;
  }) {
  // 接入了sharedWorked，无需使用本地ref来防止ipc抖动
  const scaleLabel = useMemo(() => globalSettings.scale.toFixed(2), [globalSettings.scale]);

  // scale 的实时联动走 SharedWorker；持久化走去抖，避免拖动时频繁 IPC。
  const scalePersistTimerRef = useRef<number | null>(null);
  const latestScaleRef = useRef(globalSettings.scale);

  useEffect(() => {
    latestScaleRef.current = globalSettings.scale;
  }, [globalSettings.scale]);

  const modelConfigRef = useRef(modelConfig);

  useEffect(() => {
    modelConfigRef.current = modelConfig;
  }, [modelConfig]);

  useEffect(() => {
    return () => {
      // 没有 pending 的持久化任务则不需要 flush，避免切页/卸载时多余 IPC。
      if (scalePersistTimerRef.current == null) return;

      window.clearTimeout(scalePersistTimerRef.current);
      scalePersistTimerRef.current = null;
      const last = latestScaleRef.current;
      onGlobalSettingsChange({ scale: last }).catch(() => {
        // ignore
      });
    };
  }, [onGlobalSettingsChange]);

  // 使用本地state来避免 ipc 抖动导致的输入体验不佳（并且避免远端回写覆盖本地输入）。
  const ignoreMouse = useDebouncedRemoteDraft({
    remoteValue: globalSettings.ignoreMouse,
    onCommit: (next) => onGlobalSettingsChange({ ignoreMouse: next }),
  });
  const showDragHandleOnHover = useDebouncedRemoteDraft({
    remoteValue: globalSettings.showDragHandleOnHover,
    onCommit: (next) => onGlobalSettingsChange({ showDragHandleOnHover: next }),
  });
  const autoLaunch = useDebouncedRemoteDraft({
    remoteValue: globalSettings.autoLaunch,
    onCommit: (next) => onGlobalSettingsChange({ autoLaunch: next }),
  });
  const debugModeEnabled = useDebouncedRemoteDraft({
    remoteValue: globalSettings.debugModeEnabled,
    onCommit: (next) => onGlobalSettingsChange({ debugModeEnabled: next }),
  });
  const forcedFollow = useDebouncedRemoteDraft({
    remoteValue: globalSettings.forcedFollow,
    onCommit: (next) => onGlobalSettingsChange({ forcedFollow: next }),
  });
  const ragProfileDraft = useDebouncedRemoteDraft<ModelConfig['rag']['profile']>({
    remoteValue: modelConfig.rag.profile,
    debounceMs: 260,
    isEqual: isSameRagProfile,
    onCommit: (nextProfile) => {
      const current = modelConfigRef.current;
      return onModelConfigChange({
        ...current,
        rag: {
          ...current.rag,
          profile: nextProfile,
        },
      });
    },
  });

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">首页</h1>
          <p className="text-xs text-base-content/60">当前模型与常用参数</p>
        </div>
        <button type="button" className="btn btn-sm btn-outline" onClick={onGotoModels}>
          切换模型
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="rounded-box border border-base-300 bg-base-100 p-4 space-y-3">
          <header className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">当前模型</div>
            </div>
            <span className="badge badge-outline">{model.id}</span>
          </header>
          <div className="text-sm">名称：{model.name}</div>
          <div className="text-xs text-base-content/60 break-all">路径：{model.path}</div>
        </section>

        <section className="rounded-box border border-base-300 bg-base-100 p-4 space-y-3">
          <header className="flex items-center justify-between">
            <div className="text-sm font-medium">展示设置</div>
          </header>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm">缩放</span>
              <span className="text-xs text-base-content/60">{scaleLabel}</span>
            </div>
            <input
              type="range"
              min={0.3}
              max={2}
              step={0.01}
              value={globalSettings.scale}
              onChange={(e) => {
                const nextScale = Number.parseFloat(e.target.value);
                // 每次拖动都直接发 patch，模型窗口会实时响应。
                sharedStoreClient.dispatchPatch([{ path: 'global.scale', value: nextScale }]);

                // 持久化去抖：只写入最后一次 scale。
                latestScaleRef.current = nextScale;
                if (scalePersistTimerRef.current != null) {
                  window.clearTimeout(scalePersistTimerRef.current);
                  scalePersistTimerRef.current = null;
                }
                scalePersistTimerRef.current = window.setTimeout(() => {
                  scalePersistTimerRef.current = null;
                  onGlobalSettingsChange({ scale: latestScaleRef.current }).catch(() => {
                    // ignore
                  });
                }, SCALE_PERSIST_DEBOUNCE_MS);
              }}
              className="range range-xs"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="label cursor-pointer justify-between p-0">
              <span className="label-text text-sm">忽略鼠标</span>
              <input
                type="checkbox"
                className="toggle toggle-sm"
                checked={ignoreMouse.draft}
                onChange={(e) => {
                  ignoreMouse.commit(e.target.checked);
                }}
              />
            </label>
            <label className="label cursor-pointer justify-between p-0">
              <span className="label-text text-sm">悬浮显示拖动</span>
              <input
                type="checkbox"
                className="toggle toggle-sm"
                checked={showDragHandleOnHover.draft}
                onChange={(e) => {
                  showDragHandleOnHover.commit(e.target.checked);
                }}
              />
            </label>
            <label className="label cursor-pointer justify-between p-0">
              <span className="label-text text-sm">开机自启动</span>
              <input
                type="checkbox"
                className="toggle toggle-sm"
                checked={autoLaunch.draft}
                onChange={(e) => {
                  autoLaunch.commit(e.target.checked);
                }}
              />
            </label>
            <label className="label cursor-pointer justify-between p-0">
              <span className="label-text text-sm">调试模式</span>
              <input
                type="checkbox"
                className="toggle toggle-sm"
                checked={debugModeEnabled.draft}
                onChange={(e) => {
                  debugModeEnabled.commit(e.target.checked);
                }}
              />
            </label>
            <label className="label cursor-pointer justify-between p-0">
              <span className="label-text text-sm">强制跟随</span>
              <input
                type="checkbox"
                className="toggle toggle-sm"
                checked={forcedFollow.draft}
                onChange={(e) => {
                  forcedFollow.commit(e.target.checked);
                }}
              />
            </label>
          </div>
        </section>

        <section className="rounded-box border border-base-300 bg-base-100 p-4 space-y-3">
          <header className="flex items-center justify-between">
            <div className="text-sm font-medium">RAG 与角色设定</div>
            <span className="badge badge-ghost">阶段 3 预设</span>
          </header>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="form-control sm:col-span-2">
              <div className="label py-0">
                <span className="label-text text-xs">角色个性（常改）</span>
              </div>
              <textarea
                className="textarea textarea-sm textarea-bordered w-full"
                rows={3}
                value={ragProfileDraft.draft.personal}
                placeholder="例如：傲娇但礼貌，偏短句，喜欢吐槽"
                onChange={(e) =>
                  ragProfileDraft.commit({
                    ...ragProfileDraft.draft,
                    personal: e.target.value,
                  })
                }
              />
            </label>

            <label className="form-control sm:col-span-2">
              <div className="label py-0">
                <span className="label-text text-xs">说话风格（常改）</span>
              </div>
              <textarea
                className="textarea textarea-sm textarea-bordered w-full"
                rows={2}
                value={ragProfileDraft.draft.speakingStyle}
                placeholder="例如：口语化、每句不超过25字、少用书面词"
                onChange={(e) =>
                  ragProfileDraft.commit({
                    ...ragProfileDraft.draft,
                    speakingStyle: e.target.value,
                  })
                }
              />
            </label>

            <label className="form-control sm:col-span-2">
              <div className="label py-0">
                <span className="label-text text-xs">关系设定（relation）</span>
              </div>
              <textarea
                className="textarea textarea-sm textarea-bordered w-full"
                rows={2}
                value={ragProfileDraft.draft.relation}
                placeholder="例如：青梅竹马、略傲娇但会照顾人"
                onChange={(e) =>
                  ragProfileDraft.commit({
                    ...ragProfileDraft.draft,
                    relation: e.target.value,
                  })
                }
              />
            </label>

            <label className="form-control sm:col-span-2">
              <div className="label py-0">
                <span className="label-text text-xs">禁忌/禁止内容（banned）</span>
              </div>
              <textarea
                className="textarea textarea-sm textarea-bordered w-full"
                rows={2}
                value={ragProfileDraft.draft.banned}
                placeholder="例如：禁止人身攻击、禁止编造事实"
                onChange={(e) =>
                  ragProfileDraft.commit({
                    ...ragProfileDraft.draft,
                    banned: e.target.value,
                  })
                }
              />
            </label>

            <label className="form-control sm:col-span-2">
              <div className="label py-0">
                <span className="label-text text-xs">世界观（world）</span>
              </div>
              <textarea
                className="textarea textarea-sm textarea-bordered w-full"
                rows={3}
                value={ragProfileDraft.draft.world}
                placeholder="例如：故事发生在架空近未来学园都市"
                onChange={(e) =>
                  ragProfileDraft.commit({
                    ...ragProfileDraft.draft,
                    world: e.target.value,
                  })
                }
              />
            </label>
          </div>

          <div className="text-xs text-base-content/60">
            说明：当前先完成配置层，检索与文件读取在阶段 3 实装。
          </div>
        </section>
      </div>
    </div>
  );
}
