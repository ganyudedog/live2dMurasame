## PetCanvas 副作用拆分方案

1. **现状分析**：梳理 `PetCanvas` 中所有 `useEffect`、`useLayoutEffect`、`useCallback` 等附带副作用的逻辑，归类为模型加载、布局调整、气泡管理、拖拽手柄、鼠标穿透、指针轮询、上下文菜单等功能块。
2. **抽象目标**：为每一类副作用设计对应的自定义 Hook（如 `usePetModel`, `useBubblePlacement`, `useDragHandle`, `useMousePassthrough`, `useContextZone`, `useCursorPolling` 等），确保 Hook 拥有明确的输入/输出与职责边界。
3. **依赖整理**：列出各功能块对 store、引用对象、实用函数的依赖，确定通过参数传入或在 Hook 内部创建哪些引用，避免循环依赖与重复状态。
4. **Hook 接口设计**：先编写每个 Hook 的 TypeScript 接口草图（参数、返回值、需要暴露的回调），确保能够替换组件内原有逻辑而不破坏组件对外行为。
5. **分步迁移**：按照功能块分批迁移副作用逻辑：
	- 首先迁移与外部通信强相关的逻辑（如模型加载、事件订阅），验证 Hook 返回值可支撑当前组件状态。
	- 之后迁移布局与交互逻辑（拖拽手柄、气泡、上下文区），逐步替换组件内部实现。
	- 最后迁移鼠标穿透、指针轮询等系统级逻辑，确保互相之间引用的 `ref` 和回调仍然能正确工作。
6. **组件精简**：在 Hook 完成迁移后，保留 `PetCanvas` 负责状态组合、渲染 JSX 与调用 Hook，移除不再需要的 `useRef`/`useState` 声明并调整导入。
7. **验证与重构**：在每次迁移完成后运行相关逻辑检查（如调试日志、手动运行），最终对新 Hook 进行注释/文档补充，并检查是否需要共享工具函数进一步抽象。
8. **阶段性提交建议**：每个功能块迁移完成后进行一次小范围提交，方便回滚与审查。

> 审查通过后，按上述步骤逐步实施代码拆分与重构。

## Hook 设计草图

- `usePetSettings(options)`
	- **输入**：`loadSettings` 回调。
	- **输出**：返回卸载清理函数引用，内部负责注册/注销设置监听。
	- **副作用覆盖**：当前 `useLayoutEffect` 中的设置加载逻辑。
- `usePetModel(params)`
	- **输入**：`canvasRef`、`setModel`、`setModelLoadStatus`、`updateBubblePosition`、`updateDragHandlePosition` 等依赖。
	- **输出**：暴露 `modelRef`、`appRef`、`attachEyeFollow` 等必要引用，返回清理函数。
	- **副作用覆盖**：Pixi 初始化、模型加载及事件绑定。
- `usePetLayout({ scale, applyLayoutDeps })`
	- **输入**：`scale`、`applyLayout` 或等价回调。
	- **输出**：布局应用调度函数。
	- **副作用覆盖**：缩放变化触发布局、窗口基线初始化等。
- `useEyeReset({ ignoreMouse, modelRef })`
	- **输入**：`ignoreMouse` 状态、`modelRef`。
	- **输出**：无，纯副作用。
	- **副作用覆盖**：忽略鼠标时的眼球与角度复位。
- `useMousePassthrough(options)`
	- **输入**：`ignoreMouse`、指针状态引用、`recomputeWindowPassthrough` 回调。
	- **输出**：`setWindowMousePassthrough`、`startCursorPoll`、`stopCursorPoll` 等操作句柄。
	- **副作用覆盖**：穿透状态同步、卸载清理等。
- `useDragHandleController(params)`
	- **输入**：`showDragHandleOnHover`、拖拽相关引用、`recomputeWindowPassthrough`、`updateBubblePosition`。
	- **输出**：手柄显隐控制方法、事件处理函数。
	- **副作用覆盖**：手柄显示策略、事件绑定。
- `usePointerTapHandler(params)`
	- **输入**：命中测试函数、`handlePointerTap`。
	- **输出**：无。
	- **副作用覆盖**：全局 pointerdown 监听。
- `useBubbleLifecycle(params)`
	- **输入**：`motionText`、`motionSound`、气泡状态 setters、`resolveSoundUrl` 等。
	- **输出**：`bubbleReady` 等驱动状态（或直接由外部 `useState` 提供）。
	- **副作用覆盖**：气泡位置更新、音频元数据处理、定时器管理。
- `useContextZoneController(params)`
	- **输入**：上下文区域相关 `ref`、`recomputeWindowPassthrough`。
	- **输出**：上下文区域样式与活动态信息。
	- **副作用覆盖**：基准线刷新、延迟 latch 逻辑等。
- `useCursorTracking(params)`
	- **输入**：`mousePassthroughRef`、`petAPI` 代理。
	- **输出**：启动/停止指针轮询的回调。
	- **副作用覆盖**：当前 `pollCursorPosition`、`startCursorPoll`、`stopCursorPoll` 所需的副作用封装。

## 功能块依赖清单

- **布局基线 / usePetLayout**
	- 引用：`rightEdgeBaselineRef`、`pendingResizeRef`、`pendingResizeIssuedAtRef`。
	- 工具：`getWindowRightEdge`、`debugLog`、`window.setTimeout`。
	- 触发：初始挂载、气泡关闭时重新记录基线。
- **设置加载 / usePetSettings**
	- 依赖：`loadSettings`（来自 `usePetStore`）。
	- 行为：调用返回的注销函数，组件卸载时执行。
- **模型初始化 / usePetModel**
	- 引用：`canvasRef`、`modelRef`、`appRef`、`hitAreasRef`、`modelBaseUrlRef`、`frameCountRef`、`paramCacheRef`、`pointerX/Y`、`contextZone` 与拖拽相关 ref。
	- 状态接口：`setModel`、`setModelLoadStatus`、`updateDragHandlePositionRef`、`recomputeWindowPassthroughRef`。
	- 工具：`Application`、`Ticker`、`loadModel`、`Live2DModel`、`updateHitAreas`、`applyLayout`、`updateBubblePosition`、`updateDragHandlePosition`、`requestResize`、`debugLog`。
	- 全局事件：`window.resize`、`window.mousemove`、`petAPI` 的 `setMousePassthrough`、`getCursorScreenPoint`、`getWindowBounds`、`pet:windowBoundsChanged` 订阅。
- **布局响应 / usePetLayout**
	- 输入：`scale`、`applyLayout`。
	- 工具：`requestAnimationFrame`。
- **眼球重置 / useEyeReset**
	- 引用：`modelRef`。
	- 工具：模型内部的 `coreModel.setParameterValueById`。
- **鼠标穿透 / useMousePassthrough**
	- 引用：`ignoreMouseRef`、`pointerInsideModelRef`、`pointerInsideHandleRef`、`pointerInsideBubbleRef`、`pointerInsideContextZoneRef`、`dragHandleHoverRef`、`dragHandleActiveRef`、`contextZoneActiveUntilRef`、`contextZoneReleaseTimerRef`、`mousePassthroughRef`。
	- 方法：`setWindowMousePassthrough`、`startCursorPoll`、`stopCursorPoll`、`pollCursorPosition`。
	- 接口：`recomputeWindowPassthroughRef`。
	- 全局访问：`window.petAPI`。
- **拖拽手柄控制 / useDragHandleController**
	- 引用：`dragHandleRef`、`dragHandleVisibleRef`、`dragHandleHideTimerRef`、`dragHandleActiveRef`、`dragHandleHoverRef`。
	- 状态：`setDragHandleVisibility`、`setDragHandlePosition`、`showDragHandleOnHover`、`dragHandlePosition`。
	- 工具：`scheduleDragHandleHide`、`cancelDragHandleHide`、`triggerDragHandleReveal`、`hideDragHandleImmediately`、`recomputeWindowPassthrough`、`updateBubblePosition`。
- **指针命中 / usePointerTapHandler**
	- 引用：`handlePointerTap`（内部避开拖拽手柄区域）。
	- 全局事件：`window.pointerdown`。
- **气泡生命周期 / useBubbleLifecycle**
	- 状态：`motionText`、`motionSound`、`setMotionText`、`setBubblePosition`、`setBubbleAlignment`、`setBubbleReady`、`setBubbleTailY`。
	- 引用：`bubbleRef`、`bubbleTimerRef`、`motionTextRef`、`bubblePositionRef`、`bubbleAlignmentRef`、`bubbleReadyRef`、`autoResizeBackupRef`、`pendingResizeRef`、`pendingResizeIssuedAtRef`、`suppressResizeForBubbleRef`。
	- 工具：`updateBubblePosition`、`updateDragHandlePosition`、`resolveSoundUrl`、`scheduleBubbleDismiss`、`clearBubbleTimer`、`requestResize`、`debugLog`。
	- 媒体：运行时音频 (`motionMgr._currentAudio`) 与替代 `Audio`。
- **上下文区域控制 / useContextZoneController**
	- 引用：`contextZoneStyleRef`、`contextZoneAlignmentRef`、`contextZoneActiveUntilRef`、`contextZoneReleaseTimerRef`、`contextZoneStyle`、`contextZoneAlignment`。
	- 工具：`computeContextZone`、`scheduleContextZoneLatchCheck`、`clearContextZoneLatchTimer`、`recomputeWindowPassthrough`。
- **指针跟踪 / useCursorTracking**
	- 引用：`cursorPollRafRef`、`pointerX`、`pointerY`、`windowBoundsRef`。
	- 接口：`startCursorPoll`、`stopCursorPoll`、`pollCursorPosition`。
	- 全局：`window.petAPI` 内的 `getCursorScreenPoint`、`getWindowBounds`。

## 进度记录

- ✅ 拆分 `usePetSettings`，统一管理设置订阅生命周期。
- ✅ 拆分 `usePetModel`，封装 Pixi 初始化、模型加载与相关事件。
- ✅ 拆分 `usePetLayout`，负责缩放触发布局与窗口基线初始化。
- ✅ 拆分 `useEyeReset`，在忽略鼠标时重置模型参数。
- ✅ 拆分 `useMousePassthrough`，统一管理窗口穿透与光标轮询逻辑。
- ✅ 拆分 `useDragHandleController`，封装拖拽手柄显隐策略与事件绑定。
- ✅ 拆分 `usePointerTapHandler`，抽离全局 pointerdown 命中逻辑。
- ✅ 拆分 `useBubbleLifecycle`，统一管理气泡展示与音频定时。
- ✅ 拆分 `useContextZoneController`，集中管理上下文区域状态与指针热区。
- ✅ 拆分 `useCursorTracking`，抽离桌面指针轮询与基线更新。
