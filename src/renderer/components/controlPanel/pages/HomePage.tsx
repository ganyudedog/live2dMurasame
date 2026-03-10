import { useEffect, useMemo, useRef } from 'react';
import type { GlobalUiSettings, ModelEntry } from '../types';
import { sharedStoreClient } from '../../../shared/sharedStoreClient';

const SCALE_PERSIST_DEBOUNCE_MS = 250;

export default function HomePage({
  model,
  globalSettings,
  onGlobalSettingsChange,
  onGotoModels,
}: {
  model: ModelEntry;
  globalSettings: GlobalUiSettings;
  onGlobalSettingsChange: (patch: Partial<GlobalUiSettings>) => Promise<void>;
  onGotoModels: () => void;
}) {
  const scaleLabel = useMemo(() => globalSettings.scale.toFixed(2), [globalSettings.scale]);

  const scalePersistTimerRef = useRef<number | null>(null);
  const latestScaleRef = useRef(globalSettings.scale);

  useEffect(() => {
    latestScaleRef.current = globalSettings.scale;
  }, [globalSettings.scale]);

  useEffect(() => {
    return () => {
      if (scalePersistTimerRef.current == null) return;
      window.clearTimeout(scalePersistTimerRef.current);
      scalePersistTimerRef.current = null;
      const last = latestScaleRef.current;
      onGlobalSettingsChange({ scale: last }).catch(() => {});
    };
  }, [onGlobalSettingsChange]);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">首页</h1>
          <p className="text-xs text-base-content/60">当前模型与基本操作</p>
        </div>
        <button type="button" className="btn btn-sm btn-outline" onClick={onGotoModels}>
          切换模型
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {/* 当前模型 */}
        <section className="rounded-box border border-base-300 bg-base-100 p-4 space-y-3">
          <header className="flex items-center justify-between">
            <div className="text-sm font-medium">当前模型</div>
            <span className="badge badge-outline">{model.id}</span>
          </header>
          <div className="text-sm">名称：{model.name}</div>
          <div className="text-xs text-base-content/60 break-all">路径：{model.path}</div>
        </section>

        {/* Scale 调整 */}
        <section className="rounded-box border border-base-300 bg-base-100 p-4 space-y-3">
          <header className="flex items-center justify-between">
            <div className="text-sm font-medium">缩放</div>
            <span className="text-xs text-base-content/60">{scaleLabel}</span>
          </header>
          <input
            type="range"
            min={0.3}
            max={2}
            step={0.01}
            value={globalSettings.scale}
            onChange={(e) => {
              const nextScale = Number.parseFloat(e.target.value);
              sharedStoreClient.dispatchPatch([{ path: 'global.scale', value: nextScale }]);

              latestScaleRef.current = nextScale;
              if (scalePersistTimerRef.current != null) {
                window.clearTimeout(scalePersistTimerRef.current);
                scalePersistTimerRef.current = null;
              }
              scalePersistTimerRef.current = window.setTimeout(() => {
                scalePersistTimerRef.current = null;
                onGlobalSettingsChange({ scale: latestScaleRef.current }).catch(() => {});
              }, SCALE_PERSIST_DEBOUNCE_MS);
            }}
            className="range range-xs"
          />
        </section>

        {/* 文字对话框 */}
        <section className="rounded-box border border-base-300 bg-base-100 p-4 space-y-3">
          <header className="flex items-center justify-between">
            <div className="text-sm font-medium">对话</div>
            <span className="badge badge-ghost">功能开发中</span>
          </header>
          <div className="space-y-2">
            <textarea
              className="textarea textarea-bordered w-full"
              rows={4}
              placeholder="在这里与 AI 对话...（功能暂未实现）"
              disabled
            />
            <button type="button" className="btn btn-sm btn-primary" disabled>
              发送
            </button>
          </div>
          <div className="text-xs text-base-content/60">
            说明：文字对话功能将在后续开发中接入 AI 运行时。
          </div>
        </section>
      </div>
    </div>
  );
}
