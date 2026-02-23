
# SharedWorker 实时同步方案（控制面板 ↔ 模型窗口）

目标：控制面板的任何高频拖动（如 `scale`、各种滑条）都要“每次变化都实时影响模型”，同时避免主进程 IPC 带来的明显防抖/延迟体感，并为未来扩展更多配置项保留清晰的结构。

本方案不要求两个窗口共享同一个 JS 虚拟机（做不到），而是通过 **SharedWorker 作为“前端实时状态中枢”** 来实现“像同一个 store 一样”的体验。

---

## 1. 总体架构

**实时层（SharedWorker）：**
- 维护一份权威内存状态 `state`（包含 `GLOBAL`、`modelConfig`、当前模型选择等）。
- 接收来自控制面板/模型窗口的 patch/action。
- 采用“按帧合并（~16ms）”的 flush 策略，将高频更新合并后广播给所有窗口。

**窗口层（两个 renderer）：**
- 每个窗口都维护一份“镜像 store”（可以用 Zustand，也可以用 React state），但其数据来源是 SharedWorker。
- UI 的写入不再直接改本地权威 store：改为 `dispatchToWorker(patch/action)`。
- 模型窗口收到 Worker 广播后立刻应用到渲染（PIXI/Live2D 参数），实现实时预览。

**持久化/系统副作用层（Electron main，可后续接入）：**
- SharedWorker 不负责写文件/系统行为。
- 控制面板（或任一窗口）可以低频把最新 `GLOBAL` 写回 `live2denv.json`（例如 800ms 无变化再写盘）。
- `autoLaunch`、鼠标穿透等系统副作用由 main 进程处理（可立即或合并执行）。

---

## 2. 为什么选 SharedWorker（并且能做到“实时不抖”）

SharedWorker 的优势不只是“通信”，而是：
- **单一权威状态**：天然避免 BroadcastChannel 的“多副本互相回写”和回环问题。
- **高频更新友好**：Worker 内可以统一做按帧合并，最大广播频率约 60 次/秒；拖动条体感实时，但不会消息风暴。
- **扩展性强**：未来新增更多滑条/参数，只要走同一套 patch 协议，不会把主进程 IPC 打爆。

关键点：
- **不做 200ms 级别防抖**（用户可感知）。
- 只做 **16ms 级别合帧**（几乎不可感知，且能显著减少广播次数）。

---

## 3. 共享前提（Electron/Vite 注意事项）

SharedWorker 是否共享取决于：
- 同源（origin）：dev 下两个窗口都是 `VITE_DEV_SERVER_URL`，只差 query，仍同源。
- 同 session/partition：两个窗口默认同一 session，一般可共享。
- Worker 脚本 URL 相同：使用同一 `new URL('./worker.ts', import.meta.url)`。

如果未来引入不同 partition（例如不同 `webPreferences.partition`），SharedWorker 将不再共享，需要改为 `MessageChannelMain` 方案（备选）。

---

## 4. 建议的项目结构（可拓展）

新增/调整建议（路径仅建议，最终以实现为准）：

- src/renderer/shared/
	- sharedStateTypes.ts
		- Worker 的 State/Action/Patch 类型定义（跨窗口复用）
	- sharedStore.worker.ts
		- SharedWorker 入口：保存权威 state、处理连接、合帧广播
	- sharedStoreClient.ts
		- renderer 侧 client：连接 worker、发送 patch、订阅广播
	- patch.ts
		- 通用 patch 工具：applyPatch、deep set、合并逻辑（保持最小复杂度）

- src/renderer/stores/
	- sharedStateStore.ts
		- 每个窗口的“镜像 store”（可 Zustand），数据来源 worker

- src/renderer/components/controlPanel/
	- ControlPanel.tsx
		- 把原先本地 state 的 GLOBAL/modelConfig 写入改为 dispatchToWorker

- src/renderer/components/PetCanvas.tsx（或相关渲染入口）
	- 订阅 sharedStateStore，实时应用 scale 等到模型渲染

后续（可选）：
- electron/main.js
	- 新增低频落盘 handler（或复用现有 updateGlobalModelConfig），从 renderer 侧定时提交

---

## 5. State 设计（建议字段）

最小可用 `SharedState`（示意）：

```ts
type SharedState = {
	rev: number; // 版本号，worker 内自增
	global: {
		scale: number;
		ignoreMouse: boolean;
		autoLaunch: boolean;
		showDragHandleOnHover: boolean;
		forcedFollow: boolean;
		debugModeEnabled: boolean;
	};
	activeModelPath: string | null;
	modelConfig: {
		touchMap: number[];
		visualFrame: {
			ratio: number;
			minPx: number;
			paddingPx: number;
			center: string;
			offsetPx: number;
			offsetRatio: number;
		};
		bubble: {
			symmetric: boolean;
			headRatio: number | null;
		};
	};
};
```

说明：
- `rev` 用于调试/一致性判断。
- 后续可加入更多模块（例如 AI 设置、动作库等），按同样模式扩展。

---

## 6. 消息协议（可拓展、可演进）

建议使用“动作/patch”协议，而不是每次传全量对象。

### 6.1 基础消息

```ts
type HelloMsg = { type: 'hello'; sourceId: string };

type FullStateMsg = { type: 'state'; state: SharedState };

type PatchOp =
	| { path: 'global.scale'; value: number }
	| { path: 'global.ignoreMouse'; value: boolean }
	| { path: 'global.autoLaunch'; value: boolean }
	| { path: 'modelConfig.visualFrame.ratio'; value: number }
	// ... 后续扩展
	;

type PatchMsg = {
	type: 'patch';
	sourceId: string;
	ops: PatchOp[];
};

type PatchedMsg = {
	type: 'patched';
	sourceId: string; // worker 广播时带上，renderer 可用于忽略 echo（可选）
	rev: number;
	ops: PatchOp[];   // 广播合并后的 ops（推荐）
	// 或广播 fullState：{ state }
};
```

### 6.2 为什么广播 ops 而非全量 state

- `ops` 体积小，适合高频；并且能在 renderer 侧做“局部更新”，减少不必要的重渲染。
- 全量 `state` 仍然需要：首次连接、热重载重连、或协议版本升级时兜底。

---

## 7. Worker 端合帧策略（核心）

要求：**拖动条每次变化都要实时影响模型**。

实现要点：
- Worker 收到 patch：立即 apply 到内存 `state`，并把 ops 追加到 `pendingOps`。
- 只要当前没有安排 flush，就安排一次 `flush()`（例如 16ms 后）。
- `flush()` 时：
	- 合并/去重 `pendingOps`（同一路径保留最后一次）
	- `rev++`
	- 广播 `patched` 给所有 ports
	- 清空 `pendingOps`

这样：拖动条每秒可能触发上百次 onChange，但广播频率会被限制在约 60fps，体感实时。

---

## 8. Renderer 侧接入方式（控制面板 & 模型窗口）

### 8.1 worker client

统一封装 `sharedStoreClient`：
- `connect(): Promise<state>`
- `subscribe(listener)`
- `dispatchPatch(ops)`

让组件不直接接触 MessagePort，避免散落难维护。

### 8.2 控制面板写入（实时）

控制面板 slider 的 `onChange`：
- 立刻 `dispatchPatch([{path:'global.scale', value: next}])`
- 不做 200ms 防抖

### 8.3 模型窗口应用（实时）

模型窗口订阅到 `patched`：
- 更新镜像 store
- 立即把 `global.scale`、`modelConfig.*` 应用到渲染逻辑

应用侧如果某些计算昂贵，也可在渲染层再做一次 `requestAnimationFrame` 合并（可选），但默认先不加复杂度。

---

## 9. 与 globalModelConfig.json 对接策略（先实时，后持久化）

阶段 1（先跑通实时）：
- Worker 的初始 `global` 从 renderer 默认值或从 main 拉取一次（二选一）。
- 不写盘。

阶段 2（接入真实 globalModelConfig 并落盘，仍不影响实时）：
- 启动时：renderer 调用 main 的 `getGlobalModelConfig` 取全局模型设置，作为 worker 初始 state。
- 实时变更：仍走 worker。
- 落盘：控制面板（或任一窗口）监听 worker 的变更，做 800ms 左右的低频提交到 main：
	- `updateGlobalModelConfig(fullOrPatch)`
	- main 负责写入 `globalModelConfig.json`

说明：落盘慢一点不会影响模型实时预览。

---

## 10. 可扩展性约束（未来加更多滑条/配置不崩）

为保证可维护性，建议遵守：
- 所有跨窗口同步都通过 worker client API（禁止组件里直接操作 port）。
- patch 的 `path` 采用受控枚举（TS union），避免字符串拼错。
- worker 端只负责“状态 + 合帧 + 广播”，不夹杂 UI 逻辑。
- main 只负责“持久化/系统行为”，不参与高频同步。

---

## 11. 备选方案（SharedWorker 不可用时）

如果某些环境 SharedWorker 不共享（极少见，常见原因是不同 session/partition）：
- 使用 `MessageChannelMain`：main 进程只负责把 port 分发给两个窗口；之后两窗口通过 port 直连通信。
- 依然可以做“按帧合并”，性能与结构接近 SharedWorker。

