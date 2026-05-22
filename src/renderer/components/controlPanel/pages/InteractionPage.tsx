import { useMemo } from 'react';
import type { ModelConfig } from '../types';

const buildSegments = (zones: { heightRange: [number, number] }[]) => {
  return zones.map((zone, i) => ({
    start: zone.heightRange[0] ?? 0,
    end: zone.heightRange[1] ?? 1,
    index: i,
  }));
};

function TouchMapVisualizer({
  modelConfig,
  segmentActions,
}: {
  modelConfig: ModelConfig;
  segmentActions: string[];
}) {
  const zones = modelConfig.interactionZones?.zones ?? [];
  const segments = useMemo(() => buildSegments(zones), [zones]);

  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-4">
      <div className="text-sm font-medium">交互区域可视化</div>
      <div className="text-xs text-base-content/60 mt-1">自上而下按交互区域堆叠（0~1）</div>

      <div className="mt-4 flex justify-center">
        <div className="w-full max-w-130">
            <div className="relative w-full aspect-3/4 rounded-box border border-base-300 bg-base-200 overflow-hidden">
            {segments.map((seg) => {
              const top = `${seg.start * 100}%`;
              const height = `${(seg.end - seg.start) * 100}%`;
              const action = segmentActions[seg.index] ?? '';
              return (
                <div
                  key={seg.index}
                  className="absolute left-0 right-0 border-t border-base-300"
                  style={{ top }}
                >
                  <div
                    className="absolute left-0 right-0 flex items-center justify-center px-2"
                    style={{ top: 0, height }}
                  >
                    <span className="text-xs text-base-content/70 truncate">{action || `段 ${seg.index + 1}`}</span>
                  </div>
                </div>
              );
            })}
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute inset-0 border border-base-300 rounded-box" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function InteractionPage({
  modelConfig,
  segmentActions,
  onSegmentActionChange,
  actions,
  onActionsChange,
}: {
  modelConfig: ModelConfig;
  segmentActions: string[];
  onSegmentActionChange: (segmentIndex: number, action: string) => void;
  actions: string[];
  onActionsChange: (next: string[]) => void;
}) {
  void onActionsChange; // unused in current iteration, kept for API compatibility
  const zones = modelConfig.interactionZones?.zones ?? [];
  const segments = useMemo(() => buildSegments(zones), [zones]);
  const showTouchMapVisualizer = false;

  return (
    <div className="p-4 space-y-4">
      <div>
        <h1 className="text-lg font-semibold">交互设置</h1>
        <p className="text-xs text-base-content/60">动作列表由模型 Motions 自动解析；区域自上而下堆叠</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <section className="rounded-box border border-base-300 bg-base-100 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">可用动作</div>
              <div className="text-xs text-base-content/60">来自模型 model3.json 的 Motions</div>
            </div>
          </div>

          <div className="mt-3 space-y-2">
            {(modelConfig.interactionZones?.actions ?? []).map((action, idx) => (
              <div key={`${idx}-${action}`} className="flex gap-2">
                <input
                  className="input input-sm input-bordered flex-1"
                  value={action}
                  readOnly
                />
              </div>
            ))}
            {!(modelConfig.interactionZones?.actions?.length) && (
              <div className="text-xs text-base-content/60">暂无动作数据（请选择包含 Motions 的模型）。</div>
            )}
          </div>
        </section>

        <section className="rounded-box border border-base-300 bg-base-100 p-4">
          <div className="text-sm font-medium">交互区域</div>
          <div className="text-xs text-base-content/60 mt-1">自上而下堆叠，与配置的 zones 对应</div>

          <div className="mt-3 space-y-2">
            {segments.map((seg) => (
              <div key={seg.index} className="flex items-center gap-3">
                <div className="w-20 text-xs text-base-content/70">区域 {seg.index + 1}</div>
                <select
                  className="select select-sm select-bordered flex-1"
                  value={segmentActions[seg.index] ?? ''}
                  onChange={(e) => onSegmentActionChange(seg.index, e.target.value)}
                >
                  <option value="">（未选择）</option>
                  {actions.map((action) => (
                    <option key={action} value={action}>
                      {action}
                    </option>
                  ))}
                </select>
                <div className="w-28 text-right text-xs text-base-content/60 tabular-nums">
                  {seg.start.toFixed(2)}~{seg.end.toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {showTouchMapVisualizer ? (
        <TouchMapVisualizer modelConfig={modelConfig} segmentActions={segmentActions} />
      ) : (
        <section className="rounded-box border border-base-300 bg-base-100 p-4">
          <div className="text-sm font-medium">交互区域可视化（后续迭代）</div>
          <div className="text-xs text-base-content/60 mt-1">将展示人形轮廓 + 自上而下堆叠的矩形交互区域</div>
        </section>
      )}
    </div>
  );
}
