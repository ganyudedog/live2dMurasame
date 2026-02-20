# Live2D Pet：PetCanvas 渲染链路与交互系统详解

本文档只做“解释与解耦设计”，不要求你立刻改代码。

目标：
- 讲清楚 `PetCanvas` 的渲染链路（React → Pixi → Live2D → DOM Overlay）
- 讲清楚所有相关 hooks/纯函数引擎的职责、输入输出和副作用边界
- 讲清楚布局算法（红线/视觉矩形/三分区/对称气泡区/窗口宽度策略）
- 讲清楚交互系统（点击触发动作、拖拽手柄、鼠标穿透、ContextZone、气泡生命周期）
- 解释 Pixi.js 与 Live2D(Cubism4) 的渲染方式、关键概念与坐标空间
- 给出“移除 IPC 与控制面板对 Pet 干扰”的解耦方案（设计层面，先不改代码）

## 1. 模块与文件地图（你看代码时的导航入口）

主组件：
- `src/renderer/components/pet/PetCanvas.tsx`

Hooks（副作用与状态粘合层）：
- `src/renderer/components/pet/hooks/usePetSettings.ts`
- `src/renderer/components/pet/hooks/usePetLayout.ts`
- `src/renderer/components/pet/hooks/usePetModel.ts`
- `src/renderer/components/pet/hooks/useMousePassthrough.ts`
- `src/renderer/components/pet/hooks/useCursorTracking.ts`
- `src/renderer/components/pet/hooks/useDragHandleController.ts`
- `src/renderer/components/pet/hooks/useContextZoneController.ts`
- `src/renderer/components/pet/hooks/usePointerTapHandler.ts`
- `src/renderer/components/pet/hooks/useBubbleLifecycle.ts`
- `src/renderer/components/pet/hooks/useEyeReset.ts`

纯函数“引擎”（可视/布局/策略计算，尽量无副作用）：
- `src/renderer/components/pet/logic/visual/getVisualFrameDom.ts`
- `src/renderer/components/pet/logic/bubble/placementEngine.ts`
- `src/renderer/components/pet/logic/dragHandle/dragHandleEngine.ts`
- `src/renderer/components/pet/logic/contextZone/contextZoneEngine.ts`

Live2D 管理层（加载、运行时绑定、动作播放策略）：
- `src/renderer/components/pet/live2dManage/loader.ts`
- `src/renderer/components/pet/live2dManage/runtime.ts`
- `src/renderer/components/pet/live2dManage/motionManager.ts`

全局状态（Pet 侧主要来自这里）：
- `src/renderer/store/usePetStore.ts`

UI 组件（DOM overlay）：
- `src/renderer/components/pet/UI/ChatBubble.tsx`
- 调试组件：`src/renderer/components/pet/UI/Debug*.tsx`（当前很多调试层在 `PetCanvas.tsx` 内联实现）

与 Electron 的桥接（文档只解释，不改代码）：
- `electron/preload.js`：向 renderer 暴露 `window.petAPI`
- `electron/main.js`：主进程 IPC 处理、窗口 bounds 广播等

## 2. 总体架构：一张脑图

把 `PetCanvas` 看成“多层渲染 + 多源输入”的系统：

1) **PIXI/Live2D 图形层**：WebGL 画布（透明背景），负责模型的实时渲染
2) **DOM Overlay 层**：气泡、红线/可视框、拖拽手柄、ContextZone 等（绝对定位 div）
3) **输入层**：鼠标位置、点击、窗口 resize、窗口 bounds 广播、SharedWorker scale、设置加载
4) **状态层**：Zustand `usePetStore` 统一保存 scale/ignoreMouse/动作文本/模型引用
5) **桥接层（IPC/petAPI）**：取窗口 bounds、设置鼠标穿透、取系统光标坐标、读写持久化设置等

`PetCanvas` 的核心职责：
- 把上述 5 层粘合成一个“每帧更新”的、稳定的渲染与交互体验。

## 3. 关键数据与状态来源（谁在驱动谁）

### 3.1 Zustand：usePetStore 的职责

`usePetStore.ts` 里主要有几类状态：
- **视觉/布局输入**：`scale`、`ignoreMouse`、`showDragHandleOnHover`
- **模型生命周期**：`model`、`modelLoadStatus`、`modelLoadError`
- **动作与气泡**：`availableMotions`、`playingMotion`、`playingMotionText`、`playingMotionSound`
- **设置加载门闩**：`settingsLoaded`

动作播放策略由 `MotionManager` 托管：
- `playMotion(group)`：直接播放
- `interruptMotion(group)`：尝试 stopAllMotions + 播放 idle 再强制播放目标（兼容多签名）
- `MotionManager.getMotionMeta()`：给 `PetCanvas` 的气泡文本与音频路径

与 IPC/控制面板耦合点（你要“移除干扰”的根源就在这里）：
- `loadSettings()`：通过 `petAPI.getLive2denvGlobal()` 从主进程加载持久化设置（scale/ignoreMouse/...）
- `setIgnoreMouse/setShowDragHandleOnHover/...`：调用 `petAPI.updateLive2denvGlobal()` 写回主进程
- `setScale()`：**不直接 IPC**，而是 `sharedStoreClient.dispatchPatch([{ path: 'global.scale', value }])`
- `connectSharedWorkerScale()`：订阅 SharedWorker 的 scale 广播并写入 store

结论：
- **控制面板对 Pet 的“实时干扰”主要通过 SharedWorker 的 `global.scale` patch 进入**。
- **IPC 更多承担“设置持久化/系统能力（鼠标穿透/窗口 bounds/光标坐标）”**。

### 3.2 PetCanvas 自己维护的 Ref 状态（重要）

`PetCanvas.tsx` 内有大量 `useRef`，用于避免高频更新触发 React 重新渲染。常见类别：

1) **模型/渲染对象**
- `appRef`：PIXI Application
- `modelRef`：Live2DModel

2) **布局缓存**
- `baseWindowSizeRef`：记录“参考窗口尺寸”（用于高度缩放时避免 reference 抖动）
- `centerBaselineRef`：屏幕坐标系下的“视觉中心基线”（红线所代表的对称轴）

3) **窗口 resize 管理**
- `targetWindowWidthRef`：算法希望的目标窗口宽度
- `pendingResizeRef`：已发起但未确认的 resize 请求
- `pendingBoundsPredictionRef`：基于 anchorCenter 预测的 bounds（等待主进程广播期间用于布局）

4) **交互与穿透**
- `pointerX/pointerY`：指针在“窗口内局部坐标”的位置
- `pointerInsideModelRef/pointerInsideBubbleRef/...`：用于决定是否启用鼠标穿透
- `contextZoneActiveUntilRef`：ContextZone 的“滞留时间”（离开后短时间仍保持可交互）

5) **气泡与拖拽手柄**
- `bubbleRef/bubblePositionRef/bubbleAlignmentRef/bubbleTailY` 等
- `dragHandleRef/dragHandlePositionRef` 等

结论：
- React state 只用于“需要渲染 DOM 的部分”（位置、可见性、文本等）。
- 高频、每帧变化的内容都尽量留在 ref 中，减少 re-render 压力。

## 4. 渲染链路：从 React 到 Live2D（逐步走一遍）

### 4.1 PetCanvas 挂载阶段（初始化）

初始化顺序大致是：

1) `usePetSettings(loadSettings)`
- 触发 `usePetStore.loadSettings()`
- 从主进程拉取 `live2denvGlobal`（若可用）
- 最终把 `settingsLoaded` 置为 true

2) `connectSharedWorkerScale()`
- `PetCanvas` 挂载时会订阅 SharedWorker 的 state/patch
- 控制面板改 scale，会立即影响模型窗口的 `scale`

3) `usePetModel({ settingsLoaded, canvasRef, ... })`
- `settingsLoaded` 变为 true 后，创建 PIXI Application：
  - `new Application({ backgroundAlpha: 0, resizeTo: container, autoStart: true, antialias: true })`
  - `app.view`（canvas）插入 DOM
- 注册 `pixi-live2d-display` 的 ticker（Cubism 需要一个 tick 驱动）
- `loadModel(modelPath)`：确保 CubismCore 已加载（动态插 script），再 `Live2DModel.from(modelPath, { autoInteract: false })`
- 加载成功：`app.stage.addChild(model)`，然后调用 `applyLayout` 定位并缩放

### 4.2 每帧渲染与参数更新（关键：PIXI Ticker）

在 `usePetModel` 内部：
- `app.ticker.add(onTick)`
- 每一帧 onTick 做的事（高度概括）：
  1) 读取当前 `model.getBounds()`
  2) 用 `pointerX/pointerY` 计算归一化目标（-1..1）
  3) 写入 Live2D 核心参数（`coreModel.setParameterValueById`）：
	  - `ParamEyeBallX/Y`（眼球）
	  - `ParamAngleX/Y`（头部角度）
  4) 调用 `updateBubblePosition()` 与 `updateDragHandlePosition()` 更新 DOM overlay

注意：
- 眼球追踪不是“纯粹把目标值写进去”，而是有 blend（平滑）
- `isIdleState(motionManager)` 为 true 时 blend 可能提升（idle 时更“跟手”）
- ignoreMouse=true 时会把参数直接归零

### 4.3 Live2D 内部更新与“护眼补丁”

你这里做了两层“补丁”，防止 motion 覆盖眼球/角度参数：

1) patch motionManager 的 update 方法（`installMotionEyeGuard`）
- 在 motion 更新前记录眼球/角度参数
- motion 更新后，根据当前指针再写回一次（带 blend）

2) patch internalModel.update（`installInternalAfterUpdatePatch`）
- 在 internal update 结束后，再次按 forceAlways/blendOverride 条件写回参数

3) 额外：`model.on('update', ...)`
- 在模型 update 事件后也会做一次“forceAlways”写回

这三层的意义：
- Live2D motion 通常会驱动大量参数（包括头、眼等），如果你希望“眼睛永远跟随鼠标”，必须在某个时序点把你的参数覆盖回去。
- 多层补丁是为了兼容不同版本 `pixi-live2d-display` / Cubism 的调用链差异。

## 5. 布局系统：红线、视觉矩形、三分区、对称气泡区

布局系统本质是：
- Live2D 模型在 PIXI 里渲染（画布坐标）
- 气泡/拖拽手柄/调试框在 DOM 里渲染（DOM 像素坐标）
- 你需要在两套坐标之间做映射，并维持“视觉对称轴”（红线）稳定

### 5.1 坐标空间（非常重要）

至少有四种坐标：

1) **屏幕坐标（Screen / Desktop）**
- 主进程 bounds：`{ x, y, width, height }`（通常是“窗口外框/outer bounds”）
- renderer 可见区位置：`window.screenX/screenY`（大致是窗口左上角的屏幕位置）

2) **窗口内 DOM 坐标（Client）**
- 指针事件的 `clientX/clientY`
- `getBoundingClientRect()` 的 `left/top/width/height`

3) **PIXI renderer 坐标（Renderer Screen）**
- `app.renderer.screen.width/height`
- 常见原点左上角，y 向下

4) **Live2D 模型局部/世界坐标（Model bounds）**
- `model.getBounds()` 给的是模型在 PIXI 世界坐标系下的包围盒

任何“对齐/气泡/点击命中”都需要显式说明自己在哪个坐标系下计算。

### 5.2 applyLayout：模型如何缩放与定位

`applyLayout()` 做了这些关键步骤：

1) 取 `winW=innerWidth`、`winH=innerHeight`
2) 维护 `baseWindowSizeRef`：把 reference 尺寸收敛为“历史最小值”（避免某些 resize 扩大 reference）
3) 以 `referenceHeight * 0.95` 作为目标高度 `targetH`
4) 用 `model.getLocalBounds()` 得到原始模型高度
5) 计算缩放因子 `base = targetH / lb.height`，然后 `model.scale = base * scale`
6) `pivot` 设为 local bounds 中心，实现“围绕自身中心缩放”
7) 计算 `scaledW/scaledH`，确定 bottom margin（`marginBottom=40`）
8) 计算 “视觉中心基线” `baselineScreen`：
	- 来自 `centerBaselineRef.current`（若没有则用 `getWindowCenter()` 初始化）
9) 将屏幕基线转换为窗口内局部中心：
	- 先拿到 `windowLeft`（尽量用主进程广播/预测 bounds 的 x）
	- `rawCenterLocal = baselineScreen - windowLeft`
10) 将中心 clamp 到安全边距：
	- `minCenter = halfWidth + horizontalMargin`
	- `maxCenter = winW - horizontalMargin - halfWidth`
11) 最终模型位置：
	- `x = targetCenterLocal`
	- `y = winH - scaledH/2 - marginBottom`

这一套的关键点：
- `centerBaselineRef` 是“屏幕坐标系下的绝对中心”，它不随窗口宽度变化。
- 模型实际渲染时用的是“窗口内局部坐标”，所以必须用 `windowLeft` 做转换。
- clamp 防止窗口太窄导致模型被裁切。

### 5.3 视觉矩形（VisualFrame）与红线

`getVisualFrameDom.ts` 负责把“模型 bounds → DOM 像素的可视矩形”，它有两种输出：
- `getVisibleFrame(...)`：包含 offset（用于展示与红线绘制）
- `getBaseFrame(...)`：忽略 offset（用于计算左右空间与对称容量）

关键策略：
- `VISUAL_FRAME_RATIO`：可视矩形宽度是模型 DOM 宽度的某个比例（≥MIN_PX）
- `VISUAL_FRAME_CENTER_MODE`：默认用 bounds 中心，也可尝试用 face hitTest 扫描得到“脸的中心”
- `VISUAL_FRAME_OFFSET_*`：用于把视觉矩形整体偏移（例如模型视觉重心偏左/偏右的补偿）

`PetCanvas.updateBubblePosition()` 会：
- 用 `visibleFrame.centerDomX` 画红线（对称轴）
- 用 `baseFrame` 估算左右空间（更稳定，不受 offset 干扰）

### 5.4 三分区 / 对称气泡区 / placementEngine

`updateBubblePosition()` 的核心思想是：
- 以红线为对称轴，将窗口分成：左气泡区 | 模型区 | 右气泡区
- 通过对称区的“短板”决定气泡最大宽度与放置侧（left/right）
- 用 `computeBubblePlacement()` 决定：side、bubbleWidth、targetX、targetY、tailY

`computeBubblePlacement()` 的输入：
- scale（用于 gap、最小宽度等）
- baseFrame / visibleFrame
- containerRect（DOM 容器尺寸）
- bubbleEl（实际 DOM，用于测量）
- symmetry（可选：对称中心与 zoneWidth）

它会做几件事：
1) 估算左右可用宽度（离模型 + padding + gap 之后）
2) 若启用 symmetry，就强制左右 zoneWidth 一致
3) 给左右候选位置算“裁切像素 + 屏幕边缘惩罚”（EDGE_SAFE）
4) 选择 side（左/右）
5) 写入 `--bubble-max-width` 并测量真实 bubbleRect
6) 计算 targetX（clamp 到容器内部）
7) 计算 targetY：以 headAnchorRatio 为锚点，尽量让气泡在头部上方且不遮挡头部
8) 计算 tailY：把尾巴尖端对齐 headAnchorDomY

### 5.5 ContextZone（右键菜单区域）的布局

ContextZone 的布局由纯函数 `computeContextZone()` 负责：
- 输入：容器尺寸、模型的 top/height、屏幕可用空间、窗口全局 left/width
- 输出：
  - alignment（left/right）
  - style（left/top/width/height，容器内坐标）
  - rectAbs（绝对屏幕坐标，用于命中判断）

对齐决策大致是：
1) 优先保证“容器内部能放下”
2) 再根据“窗口靠屏幕边缘空间”决定向左/向右
3) top 会跟随模型上方 20% 附近，并 clamp 在容器内

## 6. 交互系统：点击、动作、气泡、拖拽手柄、鼠标穿透

### 6.1 点击触发动作（Tap 分区 + hitTest）

链路：
- `usePointerTapHandler` 全局监听 `pointerdown`（左键）
- 忽略来自拖拽手柄的事件（`closest('[data-live2d-drag-handle="true"]')`）
- 调用 `handlePointerTap(clientX, clientY)`

`handlePointerTap` 做的事：
1) 将 client 坐标映射到 PIXI renderer 坐标：
	- `x = ((clientX - rect.left) / rect.width) * app.renderer.screen.width`
2) 用 `model.getBounds()` 归一化得到 (nx, ny)
3) 根据 `ny` 落在哪个分段决定 group：
	- 默认 `VITE_TOUCH_MAP` 或 `window.LIVE2D_TOUCH_MAP`（hair/face/xiongbu/qunzi/leg）
	- 生成 group 名：`Taphair/Tapface/...`
4) 若能找到 hitArea id（来自 `updateHitAreas` 从 model settings 读 hitAreas）
	- 先 `model.hitTest(id, x, y)` 精确判断
5) 最终调用 store 的 `interruptMotion(group)`

### 6.2 MotionManager：动作播放与打断

`MotionManager` 的特点：
- attach 时扫描所有 motions group
- 定时随机播放 idle（idleMinMs~idleMaxMs）
- `interruptAndPlay(target)`：
  - 判断是否正在播放（优先 `mm.isFinished()`）
  - `stopAllMotions` + 停掉当前音频
  - 尝试多种“强制播放”签名（兼容不同版本）
  - 先播放 idle（可选），再 60ms 后播放目标

### 6.3 气泡生命周期（文本出现/消失/自动关闭/音频元数据）

`useBubbleLifecycle` 绑定的是 store 的 `playingMotionText/playingMotionSound`：

当 `motionText` 变为 null：
- 立刻 schedule 一次 `updateBubblePosition(true)` 让布局回收
- 清理 surrogateAudio 与 timer

当 `motionText` 有值：
- `commitBubbleReady(false)` 以便下一帧重新测量
- 下一帧调用 `updateBubblePosition(true)` 与 `updateDragHandlePosition(true)`
- 处理音频时长：
  - 若 internal motionManager 提供 `_currentAudio`，直接读 `duration/ended`
  - 否则用 surrogate Audio 只加载 metadata，估算关闭时间
- 根据 duration 设置 bubble 自动关闭（bufferMs=400）

### 6.4 拖拽手柄（WebkitAppRegion: drag）

拖拽手柄是一个 DOM 元素：
- 设置 `WebkitAppRegion: 'drag'`，让 Electron 原生拖拽窗口
- 可配置“悬停显示”策略（store: showDragHandleOnHover）

`useDragHandleController` 负责：
- pointerenter/pointerleave 控制显隐
- pointerdown/up/cancel 进入 active 状态，避免拖动时被隐藏
- 每次状态变化会触发 `recomputeWindowPassthrough()` 重新计算鼠标穿透

拖拽手柄位置由 `computeDragHandlePosition()` 根据模型 bounds 映射到 DOM，给出 left/top/width。

### 6.5 鼠标穿透（最像“桌宠”的系统）

设计目标：
- 鼠标不在模型/气泡/手柄/ContextZone 上时，窗口应穿透，让用户操作桌面
- 鼠标在可交互区域上时，窗口应接收鼠标

链路：
- `useMousePassthrough` 内部维护一堆“是否在区域内”的 ref
- `recomputeWindowPassthrough()` 决定 shouldCapture：
  - ContextZone active（含滞留时间）
  - 或 pointerInsideModel/bubble/handle/dragHandleHover/dragHandleActive
  - 并且 ignoreMouseRef 也会影响
- 最终调用 `petAPI.setMousePassthrough(!shouldCapture)`

当窗口穿透启用时，普通 mousemove 可能收不到，所以 `useCursorTracking` 会轮询：
- `petAPI.getCursorScreenPoint()` 取系统光标屏幕坐标
- `petAPI.getWindowBounds()` 取窗口外框位置
- 把屏幕坐标换算成“窗口内局部坐标”，写入 pointerX/pointerY

重要：这就是为什么 Pet 在“穿透时仍能眼睛跟随鼠标”。

### 6.6 ContextZone 的交互状态（滞留）

`useContextZoneController` 做两件事：
1) `applyContextZoneDecision`：
	- 更新 alignment/style（差异阈值 0.5px）
	- 判断 pointer 是否在 rectAbs 内
	- 若在：延长 activeUntil（latchDurationMs）并安排 timer
2) `updateInteractiveZones`：
	- bubble 的 rect 命中
	- handle 的 rect 命中
	- pointerInsideModel 的边缘条件（同时控制拖拽手柄 reveal/hide）

## 7. Pixi.js 与 Live2D（Cubism4）渲染原理速览

### 7.1 Pixi.js：你用到的核心抽象

- `Application`：封装 renderer + ticker + stage
- `stage`：场景图根节点
- `ticker`：每帧回调（可与 requestAnimationFrame 绑定）
- `resizeTo: container`：自动跟随 DOM 容器尺寸改变

你的模型渲染流程可近似理解为：

1) 每帧 ticker：更新模型参数（眼睛/角度）
2) Cubism 内部根据参数计算：
	- 部件的变形（warp/deform）
	- 网格顶点位置
	- 部件透明度与 draw order
3) Pixi renderer 把所有 mesh 走 WebGL pipeline 画到 canvas

### 7.2 Live2D Cubism4：核心概念

（以下是概念解释，不依赖特定实现细节）

- **CoreModel**：Cubism 核心数据与参数容器
- **Parameters**：用 id 表示（如 ParamAngleX、ParamEyeBallY）
- **Motions**：对多个参数随时间变化的曲线（动画）
- **Physics**：对参数的二次动态响应（头发/裙摆摆动等）
- **Parts / Drawables**：可绘制部件；每个部件可以是网格 + 纹理

为什么 motion 会覆盖你写的眼睛参数？
- motion 本质上就是“参数随时间的写入”。如果 motion 曲线里包含眼睛/角度参数，它必然会在更新阶段写进去。
- 所以你要实现“永远跟随鼠标”，必须在 motion 更新之后再写回一次（这也是你多层补丁的动机）。

### 7.3 计算机图形学相关（足够理解当前代码所需）

- 2D 角色依然是“网格”渲染：纹理贴到三角形网格上
- 参数驱动的主要是：
  - 顶点位移（deform）
  - 部件透明度（opacity）
  - 绘制顺序（draw order）
- 你看到的“眨眼/转头/看向鼠标”都是参数变化驱动的形变

## 8. “移除 IPC 与控制面板对 Pet 的干扰”：设计级解耦方案

你当前的耦合面主要有两条：

1) **控制面板 → SharedWorker → PetStore.scale → PetCanvas.scale → applyLayout**
- 这是“实时干扰”的主路径

2) **Pet → petAPI(IPC) → 主进程**
- 设置持久化（live2denvGlobal）
- 鼠标穿透/光标轮询/窗口 bounds 等系统能力

你说的“先移除干扰”，可以拆成两个不同目标：

### 8.1 目标 A：控制面板不再实时影响 Pet（Scale 解耦）

建议把 scale 的来源抽象成“可插拔输入源”，而不是默认连接 SharedWorker：

**抽象概念（不改代码先写清楚）**
- `ScaleSource`：输出一个数字 scale，可能来自：
  - Local（本窗口自己的 UI 或热键）
  - SharedWorker（跨窗口同步）
  - Persisted（主进程持久化）

**落地策略（未来要改代码时的最小切口）**
- 将 `PetCanvas` 中 `connectSharedWorkerScale()` 的调用变为可选（比如由一个“启动配置”决定是否连接）
- 或在 store 中把 `connectSharedWorkerScale()` 改成“默认不订阅，只有控制面板窗口才订阅并广播”，模型窗口只读持久化

文档层面的验收标准：
- 你可以在不启动控制面板的情况下，Pet 仍能独立运行
- 控制面板 scale 改动不会立刻影响 Pet（除非你显式启用同步）

### 8.2 目标 B：IPC 对 Pet 逻辑的侵入最小化（Bridge 解耦）

你很难完全移除 IPC，因为：
- 鼠标穿透、系统光标坐标、窗口 bounds 这些能力在 Electron 里天生需要主进程/预加载桥接

但可以把它“封装成边界清晰的接口”，避免扩散到业务逻辑：

**建议定义的桥接接口（概念）**
```ts
interface PetPlatformBridge {
  // Window & desktop
  getWindowBounds(): Promise<{ x:number;y:number;width:number;height:number } | null>;
  onWindowBoundsChanged(cb: (b:{x:number;y:number;width:number;height:number})=>void): () => void;
  setWindowMousePassthrough(enabled: boolean): Promise<void> | void;
  getCursorScreenPoint(): Promise<{x:number;y:number} | null>;

  // Settings persistence
  getPersistedSettings(): Promise<any>;
  updatePersistedSettings(patch: any): Promise<void>;
}
```

`PetCanvas`/hooks 不直接依赖 `window.petAPI`，而依赖 `bridge`。这样：
- 你可以在“无 IPC 环境”（纯浏览器）用 mock bridge 跑起来
- 也可以在“调试模式”用 no-op bridge，验证纯渲染逻辑

### 8.3 “如果需要展示再加开关”怎么做

目前项目里已经存在两类开关：

1) 运行时全局开关（window.*）
- `window.LIVE2D_MOTION_DEBUG`
- `window.LIVE2D_EYE_DEBUG`
- `window.LIVE2D_EYE_FORCE_ALWAYS`
- `window.LIVE2D_EYE_BLEND` / `window.LIVE2D_EYE_BLEND_GUARD`
- `window.LIVE2D_TOUCH_MAP`

2) 环境变量开关（VITE_*，见 `env()`）
- `VITE_TOUCH_MAP`
- `VITE_BUBBLE_HEAD_RATIO`
- `VITE_VISUAL_FRAME_*`
- `VITE_BUBBLE_SYMMETRIC`

当你需要“把某个调试层展示开关化”时，建议统一收敛到：
- `debugModeEnabled`（store 已有）作为总开关
- 细分功能开关作为二级（例如 showRedLine/showFrames/showZones）

## 9. 一句话总结（你以后调这个系统的抓手）

- 图形渲染：`usePetModel` 创建 PIXI + Live2D，并用 ticker 每帧写参数
- 布局核心：`applyLayout` 把屏幕基线转换成窗口内中心并 clamp，模型落底
- 视觉对称：红线来自 `getVisibleFrame`，左右空间判断来自 `getBaseFrame`
- 气泡定位：`updateBubblePosition` + `computeBubblePlacement` 负责测量与放置
- 交互：tap → MotionManager → store 更新 → bubble lifecycle 驱动气泡显示
- 穿透：`useMousePassthrough` 决定是否穿透，穿透时 `useCursorTracking` 轮询系统光标
- 解耦方向：把 scale 来源与 platform bridge 抽象出来，控制面板不应默认干扰 Pet
