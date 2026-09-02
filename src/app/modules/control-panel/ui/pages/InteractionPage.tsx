import { useCallback, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import type { InteractionZoneDraft, InteractionZoneManager } from '../../service/InteractionZoneManager';

const ZONE_COLORS = [
  'oklch(0.68 0.19 10  / 0.38)',
  'oklch(0.62 0.18 280 / 0.38)',
  'oklch(0.63 0.16 165 / 0.38)',
  'oklch(0.72 0.16 90  / 0.38)',
  'oklch(0.58 0.20 230 / 0.38)',
  'oklch(0.68 0.14 140 / 0.38)',
  'oklch(0.65 0.19 340 / 0.38)',
];

const ZONE_STROKES = [
  'oklch(0.60 0.25 10)',
  'oklch(0.52 0.24 280)',
  'oklch(0.55 0.20 165)',
  'oklch(0.65 0.20 90)',
  'oklch(0.48 0.26 230)',
  'oklch(0.58 0.20 140)',
  'oklch(0.58 0.24 340)',
];

function ZoneStackSVG({
  manager,
  zones,
}: {
  manager: InteractionZoneManager;
  zones: InteractionZoneDraft[];
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ boundaryIdx: number; lastClientY: number } | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Element;
      const boundary = target.closest('[data-boundary]');
      if (boundary) {
        e.preventDefault();
        svg.setPointerCapture?.(e.pointerId);
        const idx = Number((boundary as HTMLElement).dataset.boundary);
        dragRef.current = { boundaryIdx: idx, lastClientY: e.clientY };
        return;
      }

      const addBtn = target.closest('[data-add-zone]');
      if (addBtn) {
        e.preventDefault();
        e.stopPropagation();
        const idx = Number((addBtn as HTMLElement).dataset.addZone);
        manager.addZone(idx);
        return;
      }

      const delBtn = target.closest('[data-del-zone]');
      if (delBtn) {
        e.preventDefault();
        e.stopPropagation();
        const idx = Number((delBtn as HTMLElement).dataset.delZone);
        manager.removeZone(idx);
        return;
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dy = e.clientY - d.lastClientY;
      // Keep element measurement in the owning UI; the manager receives only a ratio.
      const rect = svg.getBoundingClientRect();
      if (rect.height <= 0) return;
      const delta = dy / rect.height;
      manager.resizeBoundary(d.boundaryIdx, delta);
      d.lastClientY = e.clientY;
    };

    const handlePointerUp = () => {
      dragRef.current = null;
    };

    svg.addEventListener('pointerdown', handlePointerDown);
    svg.addEventListener('pointermove', handlePointerMove);
    svg.addEventListener('pointerup', handlePointerUp);
    svg.addEventListener('pointercancel', handlePointerUp);
    svg.addEventListener('pointerleave', handlePointerUp);

    return () => {
      svg.removeEventListener('pointerdown', handlePointerDown);
      svg.removeEventListener('pointermove', handlePointerMove);
      svg.removeEventListener('pointerup', handlePointerUp);
      svg.removeEventListener('pointercancel', handlePointerUp);
      svg.removeEventListener('pointerleave', handlePointerUp);
    };
  }, [manager]);

  return (
    <div
      className="relative w-full max-w-52 mx-auto rounded-box border border-base-300 bg-base-200 overflow-hidden select-none touch-none"
      style={{ aspectRatio: '3 / 4' }}
    >
      <svg
        ref={svgRef}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full"
        style={{ display: 'block' }}
      >
        {zones.map((zone, idx) => {
          const y = zone.topRatio * 100;
          const h = zone.heightRatio * 100;
          const hasDel = zones.length > 1;
          const tooSmall = h < 6;

          return (
            <g key={zone.id} data-zone-g={idx}>
              <rect
                data-zone-rect
                x="0"
                y={y}
                width="100"
                height={h}
                style={{
                  fill: ZONE_COLORS[idx % ZONE_COLORS.length],
                  stroke: ZONE_STROKES[idx % ZONE_STROKES.length],
                  strokeWidth: '0.45',
                }}
              />

              {!tooSmall && (
                <text
                  x="50"
                  y={y + h / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  style={{ fontSize: '4px', fontWeight: 500, pointerEvents: 'none', fill: 'oklch(var(--bc) / 0.85)', userSelect: 'none' }}
                >
                  {h.toFixed(0)}%
                </text>
              )}

              {hasDel && (
                <g data-del-zone={idx} style={{ cursor: 'pointer' }}>
                  <rect
                    x="87"
                    y={y + 0.6}
                    width="11"
                    height="9"
                    rx="2.5"
                    fill="oklch(var(--b3) / 0.85)"
                  />
                  <text
                    x="92.5"
                    y={y + 5.1}
                    textAnchor="middle"
                    dominantBaseline="central"
                    style={{ fontSize: '5px', fontWeight: 600, pointerEvents: 'none' }}
                    fill="oklch(var(--er))"
                  >
                    ×
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {zones.map((zone, idx) => {
          if (idx >= zones.length - 1) return null;
          const by = (zone.topRatio + zone.heightRatio) * 100;
          return (
            <g key={`b-${idx}`}>
              <line
                x1="0" y1={by} x2="100" y2={by}
                stroke="oklch(var(--b3))"
                strokeWidth="0.7"
                strokeDasharray="3,3"
                style={{ pointerEvents: 'none' }}
              />
              <rect
                data-boundary={idx}
                x="0"
                y={by - 8}
                width="100"
                height="16"
                fill="transparent"
                style={{ cursor: 'row-resize' }}
              />
            </g>
          );
        })}

        {zones.map((zone, idx) => {
          const my = (zone.topRatio + zone.heightRatio / 2) * 100;
          const tooSmall = zone.heightRatio * 100 < 8;
          return (
            <g
              key={`add-${idx}`}
              data-add-zone={idx}
              style={{ cursor: zones.length < 10 ? 'pointer' : 'not-allowed', opacity: tooSmall ? 0 : 1 }}
            >
              <rect x="79" y={my - 9} width="18" height="18" fill="transparent" style={{ pointerEvents: 'all' }} />
              <line x1="83" y1={my} x2="93" y2={my} stroke="oklch(var(--bc) / 0.35)" strokeWidth="1.2" style={{ pointerEvents: 'none' }} />
              <line x1="88" y1={my - 5} x2="88" y2={my + 5} stroke="oklch(var(--bc) / 0.35)" strokeWidth="1.2" style={{ pointerEvents: 'none' }} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function ActionCard({ action, onRemove, draggable }: { action: string; onRemove?: () => void; draggable?: boolean }) {
  const handleDragStart = (e: React.DragEvent<HTMLSpanElement>) => {
    e.dataTransfer.setData('text/plain', action);
    e.dataTransfer.effectAllowed = 'move';
    (e.currentTarget as HTMLElement).style.opacity = '0.4';
  };
  const handleDragEnd = (e: React.DragEvent<HTMLSpanElement>) => {
    (e.currentTarget as HTMLElement).style.opacity = '1';
  };

  return (
    <span
      draggable={draggable}
      onDragStart={draggable ? handleDragStart : undefined}
      onDragEnd={draggable ? handleDragEnd : undefined}
      className={`badge badge-sm badge-outline truncate select-none ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      {action}
      {onRemove && (
        <button
          className="ml-1 inline-flex items-center hover:text-error transition-colors"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          title="取消分配"
        >
          ×
        </button>
      )}
    </span>
  );
}

const InteractionPage = observer(function InteractionPage({
  manager,
}: {
  manager: InteractionZoneManager;
}) {
  const zones = manager.zones;
  const unassigned = manager.unassignedActions;

  const [dragOverZone, setDragOverZone] = useState<number | null>(null);
  const [dragOverUnassigned, setDragOverUnassigned] = useState(false);

  const handleDropOnZone = useCallback(
    (e: React.DragEvent, zoneIdx: number) => {
      e.preventDefault();
      setDragOverZone(null);
      const action = e.dataTransfer.getData('text/plain');
      if (!action) return;
      const oldIdx = manager.zones.findIndex((zone) => zone.motions.includes(action));
      if (oldIdx >= 0 && oldIdx !== zoneIdx) {
        manager.assignAction(oldIdx, '');
      }
      manager.assignAction(zoneIdx, action);
    },
    [manager],
  );

  const handleDropOnUnassigned = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOverUnassigned(false);
      const action = e.dataTransfer.getData('text/plain');
      if (!action) return;
      const zoneIdx = manager.zones.findIndex((zone) => zone.motions.includes(action));
      if (zoneIdx >= 0) manager.assignAction(zoneIdx, '');
    },
    [manager],
  );

  const handleUnassign = useCallback(
    (zoneIdx: number) => {
      manager.assignAction(zoneIdx, '');
    },
    [manager],
  );

  const handleAddZone = useCallback(() => {
    manager.addZone(manager.zones.length - 1);
  }, [manager]);

  const handleRemoveLastZone = useCallback(() => {
    manager.removeZone(manager.zones.length - 1);
  }, [manager]);

  return (
    <div className="p-4 space-y-4">
      <div>
        <h1 className="text-lg font-semibold">交互设置</h1>
        <p className="text-xs text-base-content/60">动作由模型 Motions 自动解析；拖拽卡片到区域行完成分配</p>
      </div>

      <section
        className={`rounded-box border p-4 transition-colors ${
          dragOverUnassigned ? 'border-dashed border-primary bg-primary/5' : 'border-base-300 bg-base-100'
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDragOverUnassigned(true);
        }}
        onDragLeave={() => setDragOverUnassigned(false)}
        onDrop={handleDropOnUnassigned}
      >
        <div className="text-sm font-medium mb-3">
          未分配动作
          <span className="text-xs text-base-content/40 ml-2 font-normal">拖入此处取消分配</span>
        </div>
        <div className="flex flex-wrap gap-2 min-h-7 items-center">
          {unassigned.length === 0 ? (
            <span className="text-xs text-base-content/40">所有动作均已分配</span>
          ) : (
            unassigned.map((action) => <ActionCard key={action} action={action} draggable />)
          )}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-4 items-start">
        <section className="rounded-box border border-base-300 bg-base-100 p-4">
          <div className="text-sm font-medium mb-3">
            已分配动作
            <span className="text-xs text-base-content/40 ml-2 font-normal">拖拽卡片到目标行</span>
          </div>
          {zones.length === 0 ? (
            <div className="text-xs text-base-content/40">暂无交互区域</div>
          ) : (
            <div className="space-y-1">
              {zones.map((zone, idx) => {
                const end = zone.topRatio + zone.heightRatio;
                const action = zone.motions[0] ?? '';
                const hasAction = Boolean(action);
                const hovered = dragOverZone === idx;

                return (
                  <div
                    key={zone.id}
                    className={`flex items-center gap-2 py-1.5 px-2 rounded-md transition-colors ${
                      hovered ? 'bg-primary/10 border border-dashed border-primary' : 'border border-transparent'
                    }`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      setDragOverZone(idx);
                    }}
                    onDragLeave={() => setDragOverZone(null)}
                    onDrop={(e) => handleDropOnZone(e, idx)}
                  >
                    <span className="text-xs text-base-content/60 w-7 tabular-nums shrink-0 text-right">
                      {idx + 1}
                    </span>
                    <span className="text-xs text-base-content/50 w-18 tabular-nums shrink-0">
                      {zone.topRatio.toFixed(2)}–{end.toFixed(2)}
                    </span>
                    <div className="flex-1 min-w-0 flex items-center">
                      {hasAction ? (
                        <ActionCard action={action} draggable onRemove={() => handleUnassign(idx)} />
                      ) : (
                        <span className="text-xs text-base-content/25 italic">投放动作至此</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <div className="flex flex-col items-center gap-2">
          <span className="text-xs text-base-content/50">拖拽虚线边界 ⇅ 调整高度</span>
          <ZoneStackSVG manager={manager} zones={zones} />
          <div className="flex gap-2">
            <button
              className="btn btn-xs btn-ghost"
              onClick={handleAddZone}
              disabled={zones.length >= 10}
            >
              ＋ 添加区域
            </button>
            <button
              className="btn btn-xs btn-ghost text-error"
              onClick={handleRemoveLastZone}
              disabled={zones.length <= 1}
            >
              － 删除末区域
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

export default InteractionPage;
