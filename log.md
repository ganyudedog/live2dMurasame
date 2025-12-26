- 2025-12-25：在 [src/renderer/components/PetCanvas.tsx](src/renderer/components/PetCanvas.tsx) 引入 `getVisibleFrame`/`getBaseFrame`，让气泡布局与对称判断统一依赖虚拟矩形；同步新增虚拟矩形调试框，与原有红线一起显示。

- 2025-12-25：补充展示基础矩形与左右气泡区域占位，活跃侧高亮，记录调试日志以对齐模型与气泡布局的可视反馈。

- 2025-12-25：调整气泡区域可视化为基于安全边距与间隙的真实可用区域，避免与模型矩形重叠，同时完善日志字段以便核对起止位置。

- 2025-12-25：在 fix.md 中补充“以红线为唯一对称轴”的方案说明，明确虚拟矩形只负责气泡布局与对称，不再影响窗口估算。

- 2025-12-25：重构 [src/renderer/components/PetCanvas.tsx](src/renderer/components/PetCanvas.tsx) 的气泡区域计算，使虚拟矩形围绕红线对称并记录对称容量、短板信息，同时向 [src/renderer/logic/bubble/placementEngine.ts](src/renderer/logic/bubble/placementEngine.ts) 传递对称元数据以保持放置逻辑一致。

- 2025-12-25：引入随缩放放大的 100px 额外间隙，将对称气泡区整体外移并共享给放置引擎，使左右气泡远离模型但仍围绕红线对称。

- 2025-12-25：补充自动扩窗兜底逻辑，当放大导致对称区容量不足时请求窗口放宽并标记等待状态，避免气泡随缩放被压缩。

- 2025-12-26：在 [src/renderer/components/PetCanvas.tsx](src/renderer/components/PetCanvas.tsx) 与相关 Hook 中移除右缘锚定，新增中心基线 `centerBaselineRef` 与 `alignWindowToCenterLine`，请求扩窗时通过 `anchorCenter` 保持红线对称；同步更新 IPC 通道（[electron/preload.js](electron/preload.js)、[electron/main.js](electron/main.js)）支持中心锚定并扩充调试日志，用于验证左右平均扩展效果。

- 2025-12-26：更新 [src/renderer/hooks/usePetModel.ts](src/renderer/hooks/usePetModel.ts) 的 resize 监听，改为引用最新的 `applyLayout`，防止在自动扩窗后 scale 被回退到初始值。
- 2025-12-26：调整 [src/renderer/components/PetCanvas.tsx](src/renderer/components/PetCanvas.tsx) 的 `applyLayout`，让模型围绕红线中心布置，同时保持屏幕级锚点不被布局覆盖，并对水平安全边距做对称限位，避免因窗口扩展造成模型左右漂移。

- 2025-12-26：为程序化扩窗新增窗口 bounds 预测缓存（仅在宽度与目标一致时参与布局），并在主进程广播到达后清除，避免预测值与真实宽度不一致造成的抖动，同时扩充调试日志输出当前预测与广播数据。
- 2025-12-26：改为按 scale 直接计算“三矩形”目标宽度，并通过渲染层统一请求窗口尺寸，去除气泡出现/消失时的临时扩窗逻辑，确保窗口宽度仅随 scale 变化。