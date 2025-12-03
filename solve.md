# PetCanvas 拆分方案（保留现有调试能力）

- 目标：将 `src/renderer/components/PetCanvas.tsx` 按职责拆分为多个小型模块，降低耦合，便于定位与修复 bug，同时完整保留现有调试日志、红线可视化与环境变量开关。

## 模块总览
- `components/PetCanvasRoot.tsx`：顶层容器组件，负责挂载 Pixi 应用、模型加载生命周期、跨模块状态桥接，仅组合子组件与 hooks。
- `components/bubble/BubbleManager.tsx`：气泡渲染与定位的纯组件（接收位置、对齐、尾巴 Y、宽度上限等），不含业务决策。
- `logic/bubble/placementEngine.ts`：气泡放置决策引擎（评分、边缘惩罚、裁剪计算、兜底策略、对称/严格模式）；导出纯函数，入参为模型视觉矩形、容器尺寸、环境变量与当前缩放。
- `logic/visual/visualFrame.ts`：`getVisualFrameDom` 及相关“视觉矩形”算法，支持 `ignoreOffset`/`face center`/`padding` 等；提供渲染用和判定用两套输出。
- `logic/contextZone/contextZoneEngine.ts`：上下文区域（菜单区）定位与对齐决策，含“边缘闩锁”与指针穿透的时序逻辑；输出样式与对齐。
- `hooks/usePixiApp.ts`：Pixi `Application` 创建、销毁与 ticker 管理；暴露 `appRef` 与 `screen`。
- `hooks/useLive2DModel.ts`：模型加载与引用管理（`loadModel`/`Live2DModel`），读取 `MODEL_PATH` 与 baseUrl，封装 `getBounds` 读法。
- `hooks/usePointerStates.ts`：统一管理指针命中状态（模型/气泡/拖拽手柄/上下文区），对外暴露布尔值与坐标；内部节流。
- `components/DragHandle.tsx`：拖拽手柄组件，接收位置与可见性，内部只处理 hover/active UI；位置计算放入 `logic/dragHandle/dragHandleEngine.ts`。
- `logic/dragHandle/dragHandleEngine.ts`：根据模型 bounds、屏幕与容器尺寸计算手柄位置与可见性；保留 `LIVE2D_DRAG_HANDLE_OFFSET` 支持。
- `logic/window/resizeManager.ts`：窗口尺寸请求节流（`requestResize`）、备份与回退；暴露简单 API。
- `state/usePetStore.ts`：沿用现有 zustand store，不改动；新模块以最小读取/写入方式衔接。
- `debug/RedLine.tsx`：红线可视化组件，接收 `left` 像素位置，内部仅渲染；逻辑在 `visualFrame.ts`。
- `utils/env.ts`：统一封装环境变量读取助手，兼容 `import.meta.env` 与 `process.env`。
- `utils/math.ts`：`clamp`、`clampAngleY`、`clampEyeBallY` 等数学工具。

## 目录结构建议
```
src/renderer/
	components/
		PetCanvasRoot.tsx
		DragHandle.tsx
		debug/RedLine.tsx
		bubble/
			BubbleManager.tsx
	hooks/
		usePixiApp.ts
		useLive2DModel.ts
		usePointerStates.ts
	logic/
		bubble/placementEngine.ts
		visual/visualFrame.ts
		contextZone/contextZoneEngine.ts
		dragHandle/dragHandleEngine.ts
		window/resizeManager.ts
	utils/
		env.ts
		math.ts
```

## 拆分边界与数据流
- `PetCanvasRoot`：
	- 依赖：`usePixiApp`、`useLive2DModel`、`usePointerStates`、`visualFrame.ts`、`placementEngine.ts`、`contextZoneEngine.ts`、`dragHandleEngine.ts`、`resizeManager.ts`。
	- 输出：将位置、对齐与样式传给 `BubbleManager`、`DragHandle`、`RedLine`。
	- 保留：`debugLog` 调用点与调试开关；当 `VITE_BUBBLE_SYMMETRIC`、`VITE_BUBBLE_STRICT_SYMMETRY` 等开关启用时，调用 `placementEngine` 对应分支。

- `visualFrame.ts`：
	- 提供 `getVisualFrameDom(bounds, screen, canvasRect, opts)`，其中 `opts.ignoreOffset` 用于“几何判定参考系”；`opts.faceAreaId` 保留面部中心估计。
	- 导出：`getVisibleFrame()` 与 `getBaseFrame()` 两个包装，以减少重复参数。
	- 保留：红线位置以 `visible.centerDomX` 输出；日志调用仍在 `Root`，便于统一开关。

- `placementEngine.ts`：
	- 入参：`baseFrame`、`visibleFrame`、`containerRect`、`scale`、`envOptions`（权重、阈值、开关）。
	- 出参：`side: 'left'|'right'`、`maxWidthPx`、`positionX`、`positionY`、`tailY`、`flags`（`severeOverlap` 等）。
	- 规则：保留当前“评分+兜底”策略；严格对称模式下以 `visible.centerDomX` 为基准进行镜像 clamp。
	- 保留：debug 日志字段（scores、penalties、chosen 等）。

- `contextZoneEngine.ts`：
	- 入参：容器尺寸、屏幕与窗口边缘空间、指针位置与时间戳。
	- 出参：`style {left,top,width,height}` 与 `alignment`、`activeUntil` 等。
	- 保留：`CONTEXT_ZONE_LATCH_MS` 闩锁与定时器外部触发接口（`scheduleContextZoneLatchCheck`）。

- `dragHandleEngine.ts`：
	- 入参：模型 bounds、screen、containerRect、`LIVE2D_DRAG_HANDLE_OFFSET`。
	- 出参：`position {left,top,width}` 与可见性建议。
	- 保留：与指针状态联动的显隐逻辑仍在 `PetCanvasRoot`，避免组件内部引入副作用。

- `BubbleManager.tsx`：
	- 接口：`props {left, top, alignment, tailY, maxWidth}`；内部仅渲染 `ChatBubble` 并设置 `--bubble-max-width`、`pointer-events`。
	- 保留：现有 `pointer-events: none` 以避免遮挡点击；高度变化后由 `Root` 触发一次 `placementEngine` 复算。

## 调试与兼容保留
- 保留所有现有 `debugLog(...)` 调用点；将其封装至 `utils/env.ts` 暴露 `debugEnabled()` 与 `log()`，便于统一开关。
- 红线：保留 `RedLine` 组件与 `setRedLineLeft(next)` 更新路径；计算依据 `visibleFrame.centerDomX`。
- 环境变量：保留 `VISUAL_FRAME_*`、`VITE_BUBBLE_*`、`LIVE2D_*` 等全部开关；读取由 `utils/env.ts` 提供。
- 性能：节流窗口请求（`RESIZE_THROTTLE_MS`）、布局计算帧率限制（`last*UpdateRef`）；保持原语义。

## 迁移步骤（增量，可分 PR）
1. 提取 `utils/env.ts` 与 `utils/math.ts`；将 `PetCanvas.tsx` 引用替换为新工具。
2. 抽取 `visualFrame.ts` 并在 `PetCanvas` 中改为双帧（base/visible）调用；保持原日志。
3. 抽取 `placementEngine.ts`：将 `updateBubblePosition` 的决策段迁移为纯函数；`BubbleManager` 只接收结果。
4. 抽取 `contextZoneEngine.ts` 与 `dragHandleEngine.ts`；将样式与显隐状态计算迁移；`PetCanvasRoot` 负责副作用（定时器、窗口穿透）。
5. 引入 `PetCanvasRoot.tsx`，将原 `PetCanvas.tsx` 逐段迁移组件与 hooks；保留对 `usePetStore` 的读写路径不变。
6. 最后将 `PetCanvas.tsx` 过渡为 `PetCanvasRoot.tsx` 的薄包装或直接替换导出，维持外部 API 与路径稳定。

## 风险与回滚
- 风险：布局计算跨模块后时序问题；用单一 `update` 调度函数串联（先视觉帧，后放置/上下文/手柄）。
- 回滚：按迁移步骤，每步保持旧路径可选；若出现问题，可以逐步回退至上一步的单文件实现。

## 备注
- 当前调试内容（日志、红线、环境开关、评分细节）全部保留。
- 严格对称模式与未偏移参考系的分离，已在 `visualFrame.ts`/`placementEngine.ts` 设计中体现，便于后续 bug 修复与 A/B 验证。

