import { useMemo } from 'react';
import type { GlobalUiSettings, ModelConfig, ModelEntry } from '../types';

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
              <div className="text-xs text-base-content/60">仅 UI / 本地状态</div>
            </div>
            <span className="badge badge-outline">{model.id}</span>
          </header>
          <div className="text-sm">名称：{model.name}</div>
          <div className="text-xs text-base-content/60 break-all">路径：{model.path}</div>
        </section>

        <section className="rounded-box border border-base-300 bg-base-100 p-4 space-y-3">
          <header className="flex items-center justify-between">
            <div className="text-sm font-medium">展示设置</div>
            <span className="text-sm tabular-nums">{scaleLabel}</span>
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
              onChange={(e) =>
                onGlobalSettingsChange({
                  ...globalSettings,
                  scale: Number.parseFloat(e.target.value),
                })
              }
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
            <span className="badge badge-ghost">modelConfig</span>
          </header>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="form-control">
              <div className="label py-0">
                <span className="label-text text-xs">visualFrame.ratio</span>
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
                <span className="label-text text-xs">visualFrame.offsetRatio</span>
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
                <span className="label-text text-xs">bubble.symmetric</span>
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
                <option value="1">true</option>
                <option value="0">false</option>
              </select>
            </label>

            <label className="form-control">
              <div className="label py-0">
                <span className="label-text text-xs">bubble.headRatio</span>
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
          </div>

          <div className="text-xs text-base-content/60">
            touchMap 分段数：{modelConfig.touchMap.length}（交互分配在「交互设置」中）
          </div>
        </section>
      </div>
    </div>
  );
}
