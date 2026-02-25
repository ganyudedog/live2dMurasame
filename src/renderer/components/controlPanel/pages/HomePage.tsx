import { useEffect, useMemo, useReducer, useRef } from 'react';
import type { GlobalUiSettings, ModelConfig, ModelEntry } from '../types';
import { sharedStoreClient } from '../../../shared/sharedStoreClient';

const BOOLEAN_COMMIT_DEBOUNCE_MS = 280;
const SCALE_PERSIST_DEBOUNCE_MS = 250;

const useOptimisticBoolean = (options: {
  remoteValue: boolean;
  onCommit: (next: boolean) => Promise<void>;
}) => {
  const { remoteValue, onCommit } = options;

  type State = {
    draft: boolean;
    desired: boolean;
    pending: boolean;
    pendingRequestId: number | null;
  };

  type Action =
    | { type: 'commit'; next: boolean; requestId: number }
    | { type: 'ack' }
    | { type: 'rollback'; rollback: boolean; requestId: number };

  const reducer = (state: State, action: Action): State => {
    if (action.type === 'commit') {
      return {
        draft: action.next,
        desired: action.next,
        pending: true,
        pendingRequestId: action.requestId,
      };
    }
    if (action.type === 'ack') {
      return {
        ...state,
        pending: false,
        pendingRequestId: null,
      };
    }
    if (action.type === 'rollback') {
      if (state.pendingRequestId !== action.requestId) return state;
      return {
        draft: action.rollback,
        desired: action.rollback,
        pending: false,
        pendingRequestId: null,
      };
    }
    return state;
  };

  const [state, dispatch] = useReducer(reducer, remoteValue, (initial) => ({
    draft: initial,
    desired: initial,
    pending: false,
    pendingRequestId: null,
  }));

  const remoteRef = useRef(remoteValue);
  const requestIdRef = useRef(0);

  // 去抖合并：连续点击时只提交最后一次，避免 IPC/写盘/广播风暴导致卡顿。
  const commitTimerRef = useRef<number | null>(null);
  const latestCommitRef = useRef<{ next: boolean; requestId: number } | null>(null);

  useEffect(() => {
    remoteRef.current = remoteValue;
  }, [remoteValue]);

  useEffect(() => {
    return () => {
      // 卸载时尽量把最后一次变更落盘。
      if (commitTimerRef.current == null) return;

      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
      const latest = latestCommitRef.current;
      if (!latest) return;
      latestCommitRef.current = null;
      onCommit(latest.next).catch(() => {
        // ignore
      });
    };
  }, [onCommit]);

  useEffect(() => {
    if (!state.pending) return;

    // 只把“远端值 == 我期望值”当作 ACK；其他远端更新先不覆盖本地输入。
    if (remoteValue === state.desired) {
      // 用微任务调度，避免在 effect 中同步触发 reducer 更新导致级联渲染。
      queueMicrotask(() => dispatch({ type: 'ack' }));
    }
  }, [remoteValue, state.desired, state.pending]);

  const commit = (next: boolean) => {
    const requestId = ++requestIdRef.current;
    dispatch({ type: 'commit', next, requestId });

    latestCommitRef.current = { next, requestId };
    if (commitTimerRef.current != null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }

    commitTimerRef.current = window.setTimeout(() => {
      commitTimerRef.current = null;
      const latest = latestCommitRef.current;
      if (!latest) return;
      latestCommitRef.current = null;
      onCommit(latest.next).catch(() => {
        // 只处理最新一次提交的失败；更旧的失败不回滚，避免乱序回弹。
        if (requestIdRef.current !== latest.requestId) return;
        const rollback = remoteRef.current;
        dispatch({ type: 'rollback', rollback, requestId: latest.requestId });
      });
    }, BOOLEAN_COMMIT_DEBOUNCE_MS);
  };

  // pending 时展示本地 draft；否则展示远端值（避免 stale state 覆盖外部更新）。
  const draft = state.pending ? state.draft : remoteValue;
  return { draft, commit };
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
  onModelConfigChange: (next: ModelConfig) => void;
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
  const ignoreMouse = useOptimisticBoolean({
    remoteValue: globalSettings.ignoreMouse,
    onCommit: (next) => onGlobalSettingsChange({ ignoreMouse: next }),
  });
  const showDragHandleOnHover = useOptimisticBoolean({
    remoteValue: globalSettings.showDragHandleOnHover,
    onCommit: (next) => onGlobalSettingsChange({ showDragHandleOnHover: next }),
  });
  const autoLaunch = useOptimisticBoolean({
    remoteValue: globalSettings.autoLaunch,
    onCommit: (next) => onGlobalSettingsChange({ autoLaunch: next }),
  });
  const debugModeEnabled = useOptimisticBoolean({
    remoteValue: globalSettings.debugModeEnabled,
    onCommit: (next) => onGlobalSettingsChange({ debugModeEnabled: next }),
  });
  const forcedFollow = useOptimisticBoolean({
    remoteValue: globalSettings.forcedFollow,
    onCommit: (next) => onGlobalSettingsChange({ forcedFollow: next }),
  });

  const touchMapKey = useMemo(() => modelConfig.touchMap.join(', '), [modelConfig.touchMap]);
  const touchMapDraftRef = useRef(touchMapKey);
  useEffect(() => {
    touchMapDraftRef.current = touchMapKey;
  }, [touchMapKey]);

  const commitTouchMap = () => {
    const parts = touchMapDraftRef.current.split(/[\s,]+/).filter(Boolean);
    const next = parts
      .map((value) => Number.parseFloat(value))
      .filter((value) => Number.isFinite(value));
    if (!next.length) return;
    onModelConfigChange({
      ...modelConfig,
      touchMap: next,
    });
  };

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
              <div className="text-xs text-base-content/60">缩放：SharedWorker 实时联动（阶段 1）</div>
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
            <div className="text-sm font-medium">模型参数（概览）</div>
            <span className="badge badge-ghost">模型配置</span>
          </header>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="form-control">
              <div className="label py-0">
                <span className="label-text text-xs">显示框比例</span>
              </div>
              <input
                className="input input-sm input-bordered"
                type="number"
                step={0.01}
                value={modelConfig.visualFrame.ratio}
                onChange={(e) =>
                  onModelConfigChange({
                    ...modelConfig,
                    visualFrame: {
                      ...modelConfig.visualFrame,
                      ratio: Number.parseFloat(e.target.value || '0'),
                    },
                  })
                }
              />
            </label>

            <label className="form-control">
              <div className="label py-0">
                <span className="label-text text-xs">显示框最小像素</span>
              </div>
              <input
                className="input input-sm input-bordered"
                type="number"
                step={1}
                value={modelConfig.visualFrame.minPx}
                onChange={(e) =>
                  onModelConfigChange({
                    ...modelConfig,
                    visualFrame: {
                      ...modelConfig.visualFrame,
                      minPx: Number.parseFloat(e.target.value || '0'),
                    },
                  })
                }
              />
            </label>

            <label className="form-control">
              <div className="label py-0">
                <span className="label-text text-xs">显示框内边距像素</span>
              </div>
              <input
                className="input input-sm input-bordered"
                type="number"
                step={1}
                value={modelConfig.visualFrame.paddingPx}
                onChange={(e) =>
                  onModelConfigChange({
                    ...modelConfig,
                    visualFrame: {
                      ...modelConfig.visualFrame,
                      paddingPx: Number.parseFloat(e.target.value || '0'),
                    },
                  })
                }
              />
            </label>

            <label className="form-control">
              <div className="label py-0">
                <span className="label-text text-xs">显示框中心点</span>
              </div>
              <input
                className="input input-sm input-bordered"
                value={modelConfig.visualFrame.center}
                placeholder="face"
                onChange={(e) =>
                  onModelConfigChange({
                    ...modelConfig,
                    visualFrame: {
                      ...modelConfig.visualFrame,
                      center: e.target.value,
                    },
                  })
                }
              />
            </label>

            <label className="form-control">
              <div className="label py-0">
                <span className="label-text text-xs">显示框偏移比例</span>
              </div>
              <input
                className="input input-sm input-bordered"
                type="number"
                step={0.01}
                value={modelConfig.visualFrame.offsetRatio}
                onChange={(e) =>
                  onModelConfigChange({
                    ...modelConfig,
                    visualFrame: {
                      ...modelConfig.visualFrame,
                      offsetRatio: Number.parseFloat(e.target.value || '0'),
                    },
                  })
                }
              />
            </label>

            <label className="form-control">
              <div className="label py-0">
                <span className="label-text text-xs">显示框偏移像素</span>
              </div>
              <input
                className="input input-sm input-bordered"
                type="number"
                step={1}
                value={modelConfig.visualFrame.offsetPx}
                onChange={(e) =>
                  onModelConfigChange({
                    ...modelConfig,
                    visualFrame: {
                      ...modelConfig.visualFrame,
                      offsetPx: Number.parseFloat(e.target.value || '0'),
                    },
                  })
                }
              />
            </label>

            <label className="form-control">
              <div className="label py-0">
                <span className="label-text text-xs">气泡左右对称</span>
              </div>
              <select
                className="select select-sm select-bordered"
                value={modelConfig.bubble.symmetric ? '1' : '0'}
                onChange={(e) =>
                  onModelConfigChange({
                    ...modelConfig,
                    bubble: { ...modelConfig.bubble, symmetric: e.target.value === '1' },
                  })
                }
              >
                <option value="1">是</option>
                <option value="0">否</option>
              </select>
            </label>

            <label className="form-control">
              <div className="label py-0">
                <span className="label-text text-xs">气泡头部比例</span>
              </div>
              <input
                className="input input-sm input-bordered"
                type="number"
                step={0.01}
                value={modelConfig.bubble.headRatio ?? ''}
                placeholder="null"
                onChange={(e) => {
                  const raw = e.target.value;
                  const nextValue = raw === '' ? null : Number.parseFloat(raw);
                  onModelConfigChange({
                    ...modelConfig,
                    bubble: {
                      ...modelConfig.bubble,
                      headRatio: Number.isFinite(nextValue as number) ? (nextValue as number) : null,
                    },
                  });
                }}
              />
            </label>

            <label className="form-control sm:col-span-2">
              <div className="label py-0">
                <span className="label-text text-xs">触摸分段（touchMap）</span>
              </div>
              <textarea
                className="textarea textarea-sm textarea-bordered w-full"
                rows={2}
                key={touchMapKey}
                defaultValue={touchMapKey}
                onChange={(e) => {
                  touchMapDraftRef.current = e.target.value;
                }}
                onBlur={commitTouchMap}
                placeholder="0.1, 0.19, 0.39, 0.53, 1"
              />
            </label>
          </div>

          <div className="text-xs text-base-content/60">分段数：{modelConfig.touchMap.length}（动作分配在「交互设置」中）</div>
        </section>
      </div>
    </div>
  );
}
