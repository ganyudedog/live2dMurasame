import { useEffect, useMemo, useRef, useState } from 'react';
import { Application, Container, Graphics } from 'pixi.js';
import { useService } from '@app/core/useService';
import { TOKENS } from '@app/core/serviceTokens';

type Snapshot = {
  container: { w: number; h: number };
  inner: { w: number; h: number };
  screen: { x: number; y: number };
  baseline: { localX: number; screenX: number };
  subject: {
    position: { x: number; y: number };
    scale: number;
    pivot: { x: number; y: number };
    localBounds: { x: number; y: number; w: number; h: number };
    worldBounds: { x: number; y: number; w: number; h: number };
  };
};

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export function PixiBasicsDemo() {
  const log = useService(TOKENS.log);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const subjectRef = useRef<Container | null>(null);
  const subjectRectRef = useRef<Graphics | null>(null);
  const boundsGfxRef = useRef<Graphics | null>(null);
  const pivotGfxRef = useRef<Graphics | null>(null);

  const [scale, setScale] = useState(1);
  const [centerPivot, setCenterPivot] = useState(true);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  const subjectSize = useMemo(() => ({ w: 220, h: 520 }), []);

  const takeSnapshot = () => {
    const app = appRef.current;
    const subject = subjectRef.current;
    const container = containerRef.current;
    if (!app || !subject || !container) return;

    // This demo owns the element, so its UI layer also owns the DOM measurement.
    const rect = container.getBoundingClientRect();
    const innerW = window.innerWidth;
    const innerH = window.innerHeight;
    const screenX = window.screenX ?? window.screenLeft ?? 0;
    const screenY = window.screenY ?? window.screenTop ?? 0;

    const baselineLocalX = rect.width / 2;
    const baselineScreenX = Math.round(screenX + baselineLocalX);

    const lb = subject.getLocalBounds();
    const wb = subject.getBounds();

    const next: Snapshot = {
      container: { w: Math.round(rect.width), h: Math.round(rect.height) },
      inner: { w: innerW, h: innerH },
      screen: { x: screenX, y: screenY },
      baseline: { localX: Math.round(baselineLocalX), screenX: baselineScreenX },
      subject: {
        position: { x: Math.round(subject.position.x), y: Math.round(subject.position.y) },
        scale: Number(subject.scale.x.toFixed(4)),
        pivot: { x: Math.round(subject.pivot.x), y: Math.round(subject.pivot.y) },
        localBounds: { x: Math.round(lb.x), y: Math.round(lb.y), w: Math.round(lb.width), h: Math.round(lb.height) },
        worldBounds: { x: Math.round(wb.x), y: Math.round(wb.y), w: Math.round(wb.width), h: Math.round(wb.height) },
      },
    };

    setSnapshot(next);
    // 教学用：在关键时刻打印一次快照（避免每帧刷屏）。
     
    log.debug('demo.pixi', 'snapshot', next);
  };

  const relayout = () => {
    const app = appRef.current;
    const subject = subjectRef.current;
    const rectGfx = subjectRectRef.current;
    const boundsGfx = boundsGfxRef.current;
    const pivotGfx = pivotGfxRef.current;
    const container = containerRef.current;
    if (!app || !subject || !rectGfx || !boundsGfx || !pivotGfx || !container) return;

    // 浏览器原生api，获取容器尺寸。
    const containerRect = container.getBoundingClientRect();
    const w = containerRect.width;
    const h = containerRect.height;

    // 1) 模拟 Live2D：一个“模型容器”，内部画一个矩形。
    // 2) 用 pivot 切换演示：中心 pivot vs 左上 pivot。
    const pivotX = centerPivot ? subjectSize.w / 2 : 0;
    const pivotY = centerPivot ? subjectSize.h / 2 : 0;
    subject.pivot.set(pivotX, pivotY);
    subject.scale.set(scale);

    // 让“模型”落底，并以红线（容器中心）为对齐目标。
    const baselineLocalX = w / 2;
    const safeMargin = 20;
    const halfW = (subjectSize.w * scale) / 2;
    const minCenter = halfW + safeMargin;
    const maxCenter = Math.max(minCenter, w - safeMargin - halfW);
    const targetCenterX = clamp(baselineLocalX, minCenter, maxCenter);

    const bottomMargin = 24;
    const targetY = h - bottomMargin - (subjectSize.h * scale) / 2;

    subject.position.set(targetCenterX, targetY);

    // 更新矩形形状（本地坐标）。
    rectGfx.clear();
    rectGfx.lineStyle(2, 0x66ccff, 1);
    rectGfx.beginFill(0x66ccff, 0.12);
    rectGfx.drawRect(0, 0, subjectSize.w, subjectSize.h);
    rectGfx.endFill();

    // world bounds（AABB）可视化：用于理解 getBounds() 与 transform 的关系。
    const wb = subject.getBounds();
    boundsGfx.clear();
    boundsGfx.lineStyle(2, 0xff3355, 1);
    boundsGfx.drawRect(wb.x, wb.y, wb.width, wb.height);

    // pivot 点可视化（世界坐标下 subject.position 即 pivot 位置）。
    pivotGfx.clear();
    pivotGfx.lineStyle(0);
    pivotGfx.beginFill(0xffff00, 1);
    pivotGfx.drawCircle(subject.position.x, subject.position.y, 4);
    pivotGfx.endFill();

    takeSnapshot();
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const app = new Application({ backgroundAlpha: 0, resizeTo: container, autoStart: true, antialias: true });
    appRef.current = app;
    container.appendChild(app.view as HTMLCanvasElement);

    const stage = app.stage;

    // 红线：用 Pixi 画一条竖线，表示 baseline（容器中心）。
    const baselineGfx = new Graphics();
    stage.addChild(baselineGfx);

    const subject = new Container();
    subjectRef.current = subject;
    stage.addChild(subject);

    const rectGfx = new Graphics();
    subjectRectRef.current = rectGfx;
    subject.addChild(rectGfx);

    const boundsGfx = new Graphics();
    boundsGfxRef.current = boundsGfx;
    stage.addChild(boundsGfx);

    const pivotGfx = new Graphics();
    pivotGfxRef.current = pivotGfx;
    stage.addChild(pivotGfx);

    const drawBaseline = () => {
      const w = app.renderer.width;
      const h = app.renderer.height;
      baselineGfx.clear();
      baselineGfx.lineStyle(2, 0xff0000, 1);
      baselineGfx.moveTo(w / 2, 0);
      baselineGfx.lineTo(w / 2, h);
    };

    const handleResize = () => {
      drawBaseline();
      relayout();
    };

    // Pixi 的 resizeTo 触发时并不一定走 window.resize，所以这里两边都监听一次。
    window.addEventListener('resize', handleResize);
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(handleResize);
    resizeObserver?.observe(container);
    app.ticker.add(() => {
      // baseline 每帧可变更（窗口拖拽尺寸时），绘制成本极低。
      drawBaseline();
    });

    // 初始布局。
    drawBaseline();
    relayout();

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver?.disconnect();
      try {
        app.destroy(true);
      } catch {
        // ignore
      }
      appRef.current = null;
      subjectRef.current = null;
      subjectRectRef.current = null;
      boundsGfxRef.current = null;
      pivotGfxRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // scale / pivot 切换时重算一次。
    relayout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, centerPivot]);

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="absolute inset-0" />

      <div
        className="absolute left-3 top-3 z-10 rounded-md bg-slate-900/70 text-slate-100 p-3 text-xs backdrop-blur"
        style={{ width: 340 }}
      >
        <div className="font-semibold mb-2">Pixi 基础教学 Demo</div>

        <div className="mb-2">
          <div className="flex items-center justify-between">
            <span>scale</span>
            <span className="tabular-nums">{scale.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={0.3}
            max={2}
            step={0.01}
            value={scale}
            onChange={(e) => setScale(parseFloat(e.target.value))}
            className="w-full"
          />
        </div>

        <label className="flex items-center gap-2 mb-2">
          <input
            type="checkbox"
            checked={centerPivot}
            onChange={(e) => setCenterPivot(e.target.checked)}
          />
          <span>pivot 设为中心（否则为左上角）</span>
        </label>

        <button
          className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600"
          onClick={takeSnapshot}
          type="button"
        >
          打印快照到控制台
        </button>

        <div className="mt-3 leading-5">
          <div className="opacity-80">说明：</div>
          <div className="opacity-80">- 红线：baseline（容器中心）</div>
          <div className="opacity-80">- 蓝框：本地矩形（模拟模型局部）</div>
          <div className="opacity-80">- 红框：getBounds()（世界坐标 AABB）</div>
          <div className="opacity-80">- 黄点：subject.position（pivot 点）</div>
        </div>

        {snapshot && (
          <div className="mt-3 border-t border-slate-700 pt-2">
            <div className="font-semibold mb-1">当前快照</div>
            <div className="tabular-nums">container: {snapshot.container.w}×{snapshot.container.h}</div>
            <div className="tabular-nums">inner: {snapshot.inner.w}×{snapshot.inner.h}</div>
            <div className="tabular-nums">screen: ({snapshot.screen.x}, {snapshot.screen.y})</div>
            <div className="tabular-nums">baseline: localX={snapshot.baseline.localX}, screenX={snapshot.baseline.screenX}</div>
            <div className="tabular-nums">pivot: ({snapshot.subject.pivot.x}, {snapshot.subject.pivot.y})</div>
            <div className="tabular-nums">pos: ({snapshot.subject.position.x}, {snapshot.subject.position.y})</div>
            <div className="tabular-nums">localBounds: x={snapshot.subject.localBounds.x} y={snapshot.subject.localBounds.y} w={snapshot.subject.localBounds.w} h={snapshot.subject.localBounds.h}</div>
            <div className="tabular-nums">worldBounds: x={snapshot.subject.worldBounds.x} y={snapshot.subject.worldBounds.y} w={snapshot.subject.worldBounds.w} h={snapshot.subject.worldBounds.h}</div>
          </div>
        )}
      </div>
    </div>
  );
}
