# 引入虚拟矩形与缩放修复方案

## 核心目标
- 使用虚拟矩形保证左右对称，避免模型视觉中心偏移带来的气泡漂移。
- 调整缩放逻辑，使模型在窗口缩放、控制面板打开等场景下仍保持稳定尺寸，不再无限放大或下沉。
- 保留现有的气泡布局、拖拽手柄与上下文区功能，确保交互体验不倒退。

## 实施步骤
1. **虚拟矩形工具抽象**
	 - 在 [src/renderer/lib/getVisualFrameDom.ts](src/renderer/lib/getVisualFrameDom.ts)（若尚未存在则新增）集中定义视觉矩形计算：
		 - 基于模型 `getBounds` 结果，结合面部 hitArea 修正左右偏移。
		 - 提供 `ignoreOffset` 参数，分别输出“用于对称”的视觉矩形与“用于空间判断”的基础矩形。
	 - 在 [src/renderer/components/PetCanvas.tsx](src/renderer/components/PetCanvas.tsx) 中统一引用该工具，移除散落的视觉中心计算代码。

2. **气泡布局改造**
	 - 在 `updateBubblePosition` 中使用虚拟矩形：
		 - 取 `visibleFrame` 作为对称边界，更新红线与气泡朝向判断。
		 - 取 `baseFrame` 作为真实可用区域，保证左右空间判定不受偏移干扰。
	 - 以红线为唯一对称轴：
		 - 始终从 `visibleFrame` 推导虚拟矩形中心与尺寸，使虚拟矩形渲染与红线完全重合。
		 - 左右气泡区宽度基于虚拟矩形中心对半拆分，若空间不足则两侧同步收缩并记录“空间不足”状态，保障对称不被打破。
		 - 虚拟矩形仅参与气泡布局与可视调试，不参与窗口尺寸估算或模型垂直定位，避免放大时触发额外扩窗或模型下沉。
	 - 分离“打分区域”和“放置区域”，使用已有的 `computeBubblePlacement` 纯函数；必要时在 [src/renderer/lib/placementEngine.ts](src/renderer/lib/placementEngine.ts) 内补充参数说明与测试入口。
	 - 保持现有的重排逻辑：当检测到严重遮挡时缩窄气泡并触发下一帧复算。

3. **缩放与窗口期望尺寸管理**
	 - 在 `applyLayout` 中引入“参考窗口尺寸”缓存 `baseWindowSizeRef`：
		 - 初次布局时写入当前窗口尺寸；当计算得出更大的期望尺寸时，仅更新缓存，不立即依赖真实窗口。
		 - 使用 `estimateScale(targetHeight)` 以缓存的参考高度推导模型缩放，防止因等待窗口扩容导致的压缩或无限放大。
	 - 计算 `requiredWidth/Height` 时加入气泡安全边距，并与真实窗口比较：
		 - 若实际窗口小于期望值，调用 `requestResize`，但继续使用参考尺寸完成本次布局，避免提前 return。
	 - 在模型缩放并定位后，记录最终的 `finalScaledW/H`、`targetX/Y` 等日志，便于验证。

4. **日志与诊断**
	 - 统一使用 `debugLog('[PetCanvas] applyLayout', {...})` 和 `debugLog('[PetCanvas] bubble place', {...})` 输出关键指标：
		 - 当前窗口尺寸、参考尺寸、模型缩放比、目标坐标、气泡宽高与对齐侧。
	 - 当触发窗口扩容请求时输出 `requestResize` 日志，带上节流状态，方便排查卡死或重复放大的原因。

5. **回归与验证**
	 - 手动验证场景：
		 1. 常规启动后缩放模型（0.8×～1.4×），观察气泡是否保持左右对称。
		 2. 打开/关闭控制面板或其他顶层窗口，确认模型尺寸稳定且不会再出现逐帧放大。
		 3. 拖拽窗口大小，确保布局在 `resize` 回调到达前后均表现一致。
	 - 补充自动化：若条件允许，在 `__test__` 目录增加视觉矩形和气泡放置的单元测试，校验关键输入输出。

6. **风险缓释与回滚点**
	 - 所有修改集中在 `PetCanvas` 与相关工具函数，方便通过 git revert 快速回退。
	 - 新增或调整的工具函数确保纯函数化，便于单独测试与复用。
	 - 保留原始布局代码副本于分支备注或 gist，必要时可对照差异定位问题。

## 后续讨论点
- 若仍存在控制面板引起的窗口尺寸震荡，可考虑在主进程层面加入窗口尺寸锁或最小尺寸约束。
- 结合日志评估是否需要引入布局状态机（例如区分“等待扩容”“恢复稳定”），以进一步减小边界条件的意外行为。

## 方案调整：以红线为锚点扩窗
- **目标**：移除“右缘锚定”导致的左右跳动，改为围绕红线（视觉中心）对称扩窗，让模型在扩缩过程中保持居中。
- **核心修改**：
	1. 在 [src/renderer/components/PetCanvas.tsx](src/renderer/components/PetCanvas.tsx) 中新增 `centerBaselineRef`，记录红线相对全局窗口的中心位置；在初次布局和窗口拖动事件中同步刷新。
	2. 调整 `requestResize` 逻辑，不再传递右缘坐标，而是根据 `centerBaselineRef` 计算 `targetX = center - desiredWidth / 2`，通过 `petAPI.setBounds` 向两侧对称扩展。
	3. 将 `alignWindowToRightEdge` 更名或重构为 `alignWindowToCenterLine`，在接收 `pet:windowBoundsChanged` 时校正窗口中心偏差，并在阈值内提前结束对齐，避免重复抖动。
	4. 移除仅服务于右缘锚定的状态位（如 `rightEdgeBaselineRef`、`lastAlignAttemptRef` 等），用新的中心锚定变量取代，确保旧逻辑不会反向影响窗口。
	5. 在 Electron 主进程 [electron/main.js](electron/main.js) 的 `pet:resizeMainWindow` 与 `pet:setMainWindowBounds` 中保持对 `x`、`width` 的组合写入，避免只修改宽度造成中心漂移。
	6. 扩窗/还原的调试日志更新为输出中心值与最终 `x`，方便验证“左右平均扩展”。
- **边界考虑**：
	- 若窗口已贴近屏幕边缘，评分系统会自动收紧触墙一侧的气泡，因此无需再为扩容添加额外安全余量。
	- 仍保留扩容节流，避免连续触发多次 `setBounds` 造成窗口闪烁。

