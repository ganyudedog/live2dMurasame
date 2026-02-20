import { useEffect, useMemo, useRef } from 'react';
import type { GlobalUiSettings, ModelConfig, ModelEntry } from '../types';
import { sharedStoreClient } from '../../../shared/sharedStoreClient';

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
  onGlobalSettingsChange: (next: GlobalUiSettings) => void;
  modelConfig: ModelConfig;
  onModelConfigChange: (next: ModelConfig) => void;
  onGotoModels: () => void;
}) {
  const scaleLabel = useMemo(() => globalSettings.scale.toFixed(2), [globalSettings.scale]);
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
                onGlobalSettingsChange({
                  ...globalSettings,
                  scale: nextScale,
                });
                // 阶段 1：每次拖动都直接发 patch，模型窗口会实时响应。
                sharedStoreClient.dispatchPatch([{ path: 'global.scale', value: nextScale }]);
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
                checked={globalSettings.ignoreMouse}
                onChange={(e) => onGlobalSettingsChange({ ...globalSettings, ignoreMouse: e.target.checked })}
              />
            </label>
            <label className="label cursor-pointer justify-between p-0">
              <span className="label-text text-sm">悬浮显示拖动</span>
              <input
                type="checkbox"
                className="toggle toggle-sm"
                checked={globalSettings.showDragHandleOnHover}
                onChange={(e) =>
                  onGlobalSettingsChange({ ...globalSettings, showDragHandleOnHover: e.target.checked })
                }
              />
            </label>
            <label className="label cursor-pointer justify-between p-0">
              <span className="label-text text-sm">开机自启动</span>
              <input
                type="checkbox"
                className="toggle toggle-sm"
                checked={globalSettings.autoLaunch}
                onChange={(e) => onGlobalSettingsChange({ ...globalSettings, autoLaunch: e.target.checked })}
              />
            </label>
            <label className="label cursor-pointer justify-between p-0">
              <span className="label-text text-sm">调试模式</span>
              <input
                type="checkbox"
                className="toggle toggle-sm"
                checked={globalSettings.debugModeEnabled}
                onChange={(e) =>
                  onGlobalSettingsChange({ ...globalSettings, debugModeEnabled: e.target.checked })
                }
              />
            </label>
            <label className="label cursor-pointer justify-between p-0">
              <span className="label-text text-sm">强制跟随</span>
              <input
                type="checkbox"
                className="toggle toggle-sm"
                checked={globalSettings.forcedFollow}
                onChange={(e) => onGlobalSettingsChange({ ...globalSettings, forcedFollow: e.target.checked })}
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
