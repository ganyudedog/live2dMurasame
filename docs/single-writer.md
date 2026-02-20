# Single-Writer 窗口尺寸管控方案（减少 scale 调整抖动）

本文档描述一种改造方向：将“窗口尺寸/位置的写入权”收敛到 Electron 主进程（single-writer），渲染进程只负责计算并上报“需求（desired bounds）”，并通过 `requestId` 将主进程回流的 `boundsChanged` 事件转化为 ACK（确认），从而避免当前在 scale 变化时出现的多轮反馈计算与抖动。

> 范围：只讨论窗口尺寸/位置（bounds）相关闭环与 IPC 交互；不改变 Live2D 模型渲染、动作系统、气泡排版策略本身。

---

## 背景与问题

当前在调整 `scale`（或触发气泡区宽度变化）时，渲染进程会计算需要的窗口宽度并调用 IPC 去调整窗口 bounds。窗口变化随后会引起：

- `window.resize`（可能多次）
- 主进程广播 `pet:windowBoundsChanged`（可能多次）

这些回流事件会进一步触发布局、重新测量、再触发下一轮窗口调整。在窗口处于“过渡期”的几帧内，布局输入（`innerWidth`、window left、预测 bounds、基线等）不稳定，导致 `applyLayout()` 在相邻帧内计算出不同的 `m.position/m.scale`，表现为抖动。

合帧（`requestAnimationFrame` 合并布局）本质是减小同一帧的重复执行，并不是抖动的直接原因；根因是 resize/bounds 回流构成闭环，且闭环中的输入在过渡期不断变化。

---

## 目标

- 将窗口写入（`setBounds` / `setSize`）变为**单写入者**：仅主进程执行。
- 渲染进程只上报“目标尺寸/对齐基线”，不直接依据回流事件立即触发下一轮 resize。
- 通过 `requestId` 将“回流的 boundsChanged”与“本次请求”关联，让回流成为 ACK，而不是新一轮决策的触发器。
- 降低 `scale` 连续变化时的 IPC 调用频率与布局抖动。

非目标：

- 不要求严格单向通信（渲染仍需要收到最终 bounds 事实）。
- 不将“需求计算”挪到主进程（主进程缺少 Pixi/Live2D 测量数据，难以独立计算所需宽度）。

---

## 核心思想：Single-Writer + Request/Ack

### 角色划分

- 渲染进程：
	- 计算“我希望窗口变成多宽/多高，以及希望保持哪条屏幕中心线（anchorCenter）不变”。
	- 合并/节流需求更新。
	- 发送 resize 请求（带 `requestId`）。
	- 接收 boundsChanged：更新事实缓存；若为本次请求的 ACK 则解除 in-flight。

- 主进程：
	- 接收 resize 请求，执行 `setBounds` / `setSize`。
	- 在触发/完成后，广播带 `requestId` 的 boundsChanged（或单独发送 ACK 事件）。

### 状态机（渲染侧）

渲染侧引入一个“Resize 协调器”概念（不一定是新文件，可以先在现有逻辑中用若干 refs 实现）：

- `desired`: 当前最新目标（latest wins）
- `inFlight`: 当前正在等待 ACK 的请求（同一时刻最多 1 个）

规则：

1. `desired` 可被频繁更新（scale 连续变化、气泡状态变化）。
2. 只有在 `inFlight` 为空时才允许发送新的请求。
3. 任何 boundsChanged 回流都更新本地缓存；只有当 `boundsChanged.requestId === inFlight.requestId` 时视为 ACK 并清空 `inFlight`，然后尝试发送下一次（若 `desired` 已变）。
4. boundsChanged（无 requestId）不再直接触发新的 resize（避免回流驱动下一轮写入）。

---

## IPC 协议设计

### 渲染 → 主进程：ResizeRequest

建议 payload：

```ts
type ResizeReason = 'init' | 'scale' | 'bubble' | 'layout';

type ResizeRequest = {
	requestId: string;
	width: number;
	height: number;
	anchorCenter?: number; // 屏幕坐标（screen space），表示希望保持的中心线
	reason: ResizeReason;
	sentAt?: number;
};
```

关键字段解释：

- `requestId`：用于把回流事件变成 ACK（确认），避免反馈环。
- `anchorCenter`：等价于现有 preserveCenterLine 语义；主进程据此计算新的 x。
- `reason`：用于日志与调试（判断是否是 scale/bubble 引起）。

### 主进程 → 渲染：BoundsChanged / ResizeAck

两种实现都可以：

1) 复用现有 `pet:windowBoundsChanged`，扩展 payload：

```ts
type BoundsChanged = {
	x: number;
	y: number;
	width: number;
	height: number;
	requestId?: string;
	source?: 'apply-request' | 'user-move' | 'system';
};
```

2) 保持 `pet:windowBoundsChanged` 不变，新增单独 ACK 事件 `pet:windowResizeAck`：

```ts
type ResizeAck = {
	requestId: string;
	bounds: { x: number; y: number; width: number; height: number };
};
```

建议优先方案 1（更少事件类型），但需要注意区分：

- “用户移动窗口导致的 boundsChanged”应不携带 requestId（或 `source: 'user-move'`），渲染侧不应因此发起新的 resize。

---

## 主进程改造要点（概念）

主进程做“唯一写入者”：

1. 接收 `ResizeRequest`。
2. 若存在 `anchorCenter`：
	 - `x = round(anchorCenter - width / 2)`
	 - `y` 可保持当前值（或由请求携带）
3. 调用 `setBounds`/`setSize`。
4. 在后续 boundsChanged 广播中附带 `requestId`（或发送 ACK）。

主进程不要尝试自行推导“需要多宽”，它缺乏渲染侧测量（模型 bounds、气泡 DOM 测量）。

---

## preload 改造要点（概念）

1. 将 `requestId/anchorCenter/reason` 透传到 IPC handler。
2. 将主进程的 boundsChanged payload 原样透传（包含 `requestId/source`）。

---

## 渲染进程改造要点（概念）

### 1) 将“计算需求”与“执行 resize”解耦

当前常见模式是：

`updateBubblePosition / scale effect -> applyWindowWidth -> requestResize -> boundsChanged -> updateBubblePosition -> ...`

改造后变为：

- `updateBubblePosition`：只计算 `desiredWidth`，更新 `desired`（并调用 `enqueueResizeDesired`）。
- “Resize 协调器”：根据 `desired` 与 `inFlight` 决定何时发 IPC。

### 2) 发送频率：事件驱动 + 合并，而非固定心跳

不建议用 0.3s 心跳驱动 resize：

- 会引入跟手性差的滞后。
- 不增加信息量，无法从根上避免回流。

更推荐：

- scale 连续变化：80–150ms debounce（或 RAF 合并）；停止变化后立即 flush。
- 气泡出现/消失：事件触发更新 desired，并合并发送。

### 3) boundsChanged 回流只做“更新事实/ACK”，不驱动下一轮 resize

- `boundsChanged` 总是更新 `windowBoundsRef`。
- 只有匹配 `requestId` 的 boundsChanged 才清空 `inFlight`。
- 非 requestId 回流（用户拖动/系统变化）不触发新的 resize，最多触发布局刷新。

---

## 分阶段落地计划

### Phase 1：协议与 ACK（最关键、最小闭环）

- 引入 `requestId`，主进程回流时携带。
- 渲染侧加入 `inFlight` gating：同一时刻最多一个 resize 请求。

预期收益：显著减少“resize 风暴”，抑制抖动。

### Phase 2：发送合并与触发源收敛

- 将 `updateBubblePosition` 中直接调用 resize 的逻辑改为写 `desired` + enqueue。
- 为 scale 连续变化引入 debounce/flush。

### Phase 3：触发策略精简

- 进一步减少 `scale` 变化时同一轮布局执行两次带来的输入差异（例如只在 ACK/尺寸稳定时补一次布局）。

---

## 验收标准

1. 连续拖动 scale 时：
	 - IPC resize 请求频率显著降低（不再与 boundsChanged 成链式倍增）。
	 - `applyLayout()` 在过渡期不再出现多次“左右 1px 来回跳”。
2. 用户手动移动窗口时：
	 - 自动 resize 不会立刻把窗口“拉回去”（除非明确策略允许）。
3. 气泡出现/消失导致窗口需要变宽时：
	 - 能稳定收敛到目标宽度，不出现抖动/闪烁。

---

## 附：抖动回路（概念时序）

1. scale 变化 -> 触发布局
2. 计算 required width -> IPC 请求 setBounds
3. 窗口 resize/boundsChanged 多次回流
4. 渲染侧多次布局重算（输入不稳定）
5. 视觉抖动

Single-Writer + requestId/ACK 的核心作用是：把第 3 步的回流从“新一轮决策触发器”变成“确认信号”，让系统线性收敛。

