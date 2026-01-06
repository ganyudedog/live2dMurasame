import { useMemo } from 'react';
import type { ModelConfig } from '../types';

const buildSegments = (touchMap: number[]) => {
  const safe = Array.isArray(touchMap) ? touchMap.filter((n) => Number.isFinite(n)) : [];
  const sorted = [...safe].sort((a, b) => a - b);
  const capped = sorted.map((v) => Math.max(0, Math.min(1, v)));
  const edges = [0, ...capped];
  if (edges[edges.length - 1] !== 1) edges.push(1);

  const segments: Array<{ start: number; end: number; index: number }> = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    const start = edges[i];
    const end = edges[i + 1];
    if (end <= start) continue;
    segments.push({ start, end, index: segments.length });
  }
  return segments;
};

function TouchMapVisualizer({
  modelConfig,
  segmentActions,
}: {
  modelConfig: ModelConfig;
  segmentActions: string[];
}) {
  const segments = useMemo(() => buildSegments(modelConfig.touchMap), [modelConfig.touchMap]);

  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-4">
      <div className="text-sm font-medium">交互区域可视化</div>
      <div className="text-xs text-base-content/60 mt-1">从上到下按 touchMap 分段（0~1）</div>

      <div className="mt-4 flex justify-center">
        <div className="w-full max-w-[520px]">
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
  const segments = useMemo(() => buildSegments(modelConfig.touchMap), [modelConfig.touchMap]);

  return (
    <div className="p-4 space-y-4">
      <div>
        <h1 className="text-lg font-semibold">交互设置</h1>
        <p className="text-xs text-base-content/60">touchMap 仅用于分段；动作列表本地可修改</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <section className="rounded-box border border-base-300 bg-base-100 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">动作列表</div>
              <div className="text-xs text-base-content/60">用于分配到各段（仅本地）</div>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={() => onActionsChange([...actions, `Action${actions.length + 1}`])}
            >
              新增
            </button>
          </div>

          <div className="mt-3 space-y-2">
            {actions.map((action, idx) => (
              <div key={`${idx}-${action}`} className="flex gap-2">
                <input
                  className="input input-sm input-bordered flex-1"
                  value={action}
                  onChange={(e) => {
                    const next = [...actions];
                    next[idx] = e.target.value;
                    onActionsChange(next);
                  }}
                />
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => {
                    const next = actions.filter((_, i) => i !== idx);
                    onActionsChange(next);
                  }}
                  title="删除"
                >
                  删除
                </button>
              </div>
            ))}
            {!actions.length && (
              <div className="text-xs text-base-content/60">暂无动作，请先新增。</div>
            )}
          </div>
        </section>

        <section className="rounded-box border border-base-300 bg-base-100 p-4">
          <div className="text-sm font-medium">分段动作分配</div>
          <div className="text-xs text-base-content/60 mt-1">段数由 touchMap 决定</div>

          <div className="mt-3 space-y-2">
            {segments.map((seg) => (
              <div key={seg.index} className="flex items-center gap-3">
                <div className="w-20 text-xs text-base-content/70">段 {seg.index + 1}</div>
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

      <TouchMapVisualizer modelConfig={modelConfig} segmentActions={segmentActions} />
    </div>
  );
}
