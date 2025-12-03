/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PetCanvasRoot
 *
 * 顶层容器组件：当前作为薄包装，后续用于承载副作用与跨模块桥接。
 * - 目的：逐步将 `PetCanvas.tsx` 中的副作用（定时器、窗口穿透、生命周期）迁移到 Root，
 *   保持 `PetCanvas` 更纯粹地负责渲染与位置更新调用。
 * - 现状：为了最小改动，此处仅包装渲染，并留出注释与占位位点。
 */

import React, { useEffect } from 'react';
import PetCanvasEntry from './PetCanvasEntry';

const PetCanvasRoot: React.FC = () => {
    // 预留：全局初始化/销毁钩子（如日志开关、全局快捷键、窗口穿透策略等）
    useEffect(() => {
        // Root 级副作用管理：将窗口穿透与光标轮询统一托管为全局管理器
        const mgr = {
            startCursorPoll() {
                const api = (window as any).petAPI;
                if (!api?.getCursorScreenPoint) return;
                const loop = () => {
                    Promise.all([
                        api.getCursorScreenPoint(),
                        typeof api.getWindowBounds === 'function' ? api.getWindowBounds() : Promise.resolve(null),
                    ]).then(([point, bounds]) => {
                        if (!point) return;
                        const originX = bounds?.x ?? (window.screenX ?? window.screenLeft ?? 0);
                        const originY = bounds?.y ?? (window.screenY ?? window.screenTop ?? 0);
                        const localX = point.x - originX;
                        const localY = point.y - originY;
                        // 下发到 PetCanvas 的 pointerX/pointerY：通过事件触发
                        window.dispatchEvent(new CustomEvent('pet:pointer', { detail: { x: localX, y: localY } }));
                    }).finally(() => {
                        if ((window as any).__petCursorPollActive) {
                            (window as any).__petCursorPollId = window.requestAnimationFrame(loop);
                        }
                    });
                };
                (window as any).__petCursorPollActive = true;
                loop();
            },
            stopCursorPoll() {
                (window as any).__petCursorPollActive = false;
                const id = (window as any).__petCursorPollId;
                if (id) window.cancelAnimationFrame(id);
                (window as any).__petCursorPollId = null;
            },
            setMousePassthrough(passthrough: boolean) {
                const bridge = (window as any).petAPI?.setMousePassthrough?.(passthrough);
                if (bridge && typeof bridge.then === 'function') {
                    bridge.catch(() => { /* swallow */ });
                }
                if (passthrough) this.startCursorPoll(); else this.stopCursorPoll();
            },
            recomputeWindowPassthrough(payload: any) {
                const now = performance?.now ? performance.now() : Date.now();
                const contextZoneActive = (payload?.contextZoneActiveUntil ?? 0) > now;
                if (!contextZoneActive && typeof payload?.clearContextZoneLatchTimer === 'function') {
                    payload.clearContextZoneLatchTimer();
                }
                const shouldCapture = contextZoneActive || (!payload?.ignoreMouse && (
                    payload?.pointerInsideModel || payload?.pointerInsideBubble || payload?.pointerInsideHandle || payload?.dragHandleHover || payload?.dragHandleActive
                ));
                this.setMousePassthrough(!shouldCapture);
            },
        };
        (window as any).petWindowManager = mgr;
        return () => {
            // 清理 Root 级副作用
            try { (window as any).petWindowManager?.stopCursorPoll?.(); } catch { /* empty */ }
            (window as any).petWindowManager = undefined;
        };
    }, []);

    return (
        // Root 保持简单包装，未来可以在此组合 BubbleManager/DragHandle/RedLine 等拆分组件
        <PetCanvasEntry />
    );
};

export default PetCanvasRoot;
