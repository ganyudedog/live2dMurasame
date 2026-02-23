
# Renderer 日志系统设计（DevTools-only / 智能去重聚合 / 采样）

本文档定义 live2dMurasame 渲染进程（renderer）新的日志系统目标、数据结构与算法策略。

本轮对齐结论（用户选择）：

- 去重聚合输出：A（窗口结束时输出 1 条汇总，包含 count + last data）
- 高频采样周期：B（500ms）
- debug 开关来源：A（以 `debugModeEnabled` 为主开关；UI 开启后才允许 debug/高频日志）

## 1. 背景与目标

### 背景

桌宠项目涉及 Live2D/Pixi 布局与交互调试，事件频率高（tick / resize / bounds broadcast / mousemove）。
直接 `console.log` 会产生大量冗余，关键事件被淹没；简单防抖又可能丢掉“突然跳变”这类关键帧。

### 目标（必须）

1) **DevTools-only**：日志仅输出到 `console.*`，不需要上报、不需要回放。
2) **结构化**：日志统一为可展开对象，便于在 DevTools 中筛选/搜索。
3) **去重聚合**：同类高频事件不逐条刷屏，而是在窗口结束时输出汇总。
4) **上下文关联**：自动携带关键上下文（scale、activeModelPath、window bounds、debugModeEnabled 等）。
5) **可开关**：debug 调试开关由 `debugModeEnabled` 控制（控制面板切换，并同步到 `live2denv.json`）。
6) **采样但不丢关键**：对高频参数采用时间窗口聚合与阈值触发，避免遗漏异常跳变。

### 非目标（本轮不做）

- 不做远端采集/上传
- 不做会话回放
- 不做复杂 UI（例如控制面板新增多开关面板）；开关只使用现有 `debugModeEnabled`

## 2. 总体方案

在 renderer 新增一个轻量 logger（推荐实现位置：`src/renderer/utils/log.ts`），提供：

- `log.*`：输出结构化日志（error/warn/info/debug）
- `log.agg`：去重聚合（窗口结束输出汇总）
- `log.sample`：采样聚合（固定周期输出 min/max/last，并支持阈值触发立即输出）
- `log.setContextProvider(fn)`：注入动态上下文（ctx）
- `log.setEnabledProvider(fn)`：以 `debugModeEnabled` 作为 debug/高频日志的总开关

所有模块不再直接 `console.log`，而是产出标准事件：`ns + event + data`。

## 3. 日志事件模型（结构化格式）

### 3.1 基础字段

每条日志输出为一个对象，字段建议如下（可增减，但应保持稳定）：

```ts
type LogLevel = 'debug' | 'info' | 'warn' | 'error'

type LogEntry = {
	t: number;             // performance.now()，用于相对时间排序
	level: LogLevel;
	ns: string;            // 命名空间，例如 'pet.canvas' / 'pet.model' / 'pet.layout'
	event: string;         // 事件名，例如 'bounds.changed'
	msg?: string;          // 可选简短消息（避免堆叠长文本）
	data?: Record<string, unknown>; // 本次关键参数（结构化）
	ctx?: Record<string, unknown>;  // 自动注入上下文（见 4.1）

	// 聚合/采样相关（可选）
	agg?: {
		kind: 'dedupe' | 'sample';
		key: string;
		count: number;
		firstT: number;
		lastT: number;
		windowMs: number;
	};
}
```

### 3.2 输出样式

输出使用：

- `console.error(entry)`
- `console.warn(entry)`
- `console.info(entry)` 或 `console.log(entry)`
- `console.debug(entry)` 或 `console.log(entry)`（取决于团队习惯；但建议 `console.debug`）

注意：为了 DevTools 搜索方便，`ns/event` 必须稳定且短。

## 4. 上下文（ctx）关联

### 4.1 ctx 的建议字段

ctx 由 logger 自动注入，不要求调用点重复拼装。

建议 ctx 最少包含：

- `activeModelPath`: string | null
- `scale`: number | null
- `debugModeEnabled`: boolean
- `modelLoadStatus`: 'idle' | 'loading' | 'loaded' | 'error' | null
- `windowBounds`: { x: number; y: number; width: number; height: number; requestId?: string } | null
- `devToolsOpened`: boolean | null（如果可获取主进程真值）

### 4.2 ctx 获取方式

logger 提供：

```ts
log.setContextProvider(() => ({ /* dynamic ctx */ }))
```

实现上建议：

- store（例如 `usePetStore` / `useConfigStore`）更新时，把关键值写入一个 module-level 的 `currentCtx`，contextProvider 直接返回它。
- `windowBounds` 这类 ref（例如 `windowBoundsRef.current`）也可以在事件处理处同步写入 `currentCtx.windowBounds`。

## 5. 开关策略（debugModeEnabled）

本轮要求：**日志输出按钮/调试开关使用 `debugModeEnabled`**。

### 5.1 推荐规则

- `error` / `warn`：始终输出（不受 debugModeEnabled 影响）
- `info`：**更克制**。默认只允许低频、强语义的生命周期信息（例如 model load start/finish、关键状态切换）。任何可能高频的 info 一律改用 `log.agg` / `log.sample`，或直接不输出。
- `debug`：只有当 `debugModeEnabled === true` 时才允许输出

说明：本阶段**不做细粒度开关**；唯一开关即 `debugModeEnabled`。

## 6. 去重聚合（Dedup + Window-end Summary）

### 6.1 适用场景

- 同一个事件短时间内重复出现（例如 bounds changed、同类 warn、同类 layout decision）
- 你不需要每一条细节，只需要知道“发生了多少次 + 最后一次参数”

### 6.2 API 设计（建议）

```ts
log.agg({
	level: 'info' | 'warn' | 'error' | 'debug',
	ns: string,
	event: string,
	key: string,          // dedupeKey（同类归并）
	windowMs?: number,    // 默认 800ms
	msg?: string,
	data?: Record<string, unknown>,
})
```

### 6.3 算法规则（A：窗口结束输出汇总）

对每个 `aggKey = ns + '|' + event + '|' + key`，维护缓存条目：

- `count`：窗口内累计次数
- `firstT / lastT`
- `lastData / lastMsg`

当第一次进入窗口时启动一个 `setTimeout(windowMs)`：

- timeout 到期时输出 1 条汇总日志：
	- `agg.kind = 'dedupe'`
	- `agg.count / firstT / lastT / windowMs`
	- `data` 使用最后一次的 data，并可附加 `count` / `duration`

这样：

- 高频不会刷屏
- 你仍能看到“这段时间发生了多少次 + 最后状态”

## 7. 高频采样（500ms Sample Aggregation）

### 7.1 适用场景

用于像 scale、窗口宽度、预测值、偏移量等频繁变化的数值。

目标：

- 保留变化范围（min/max）
- 保留最后值（last）
- 遇到突变（跨阈值）立即输出，不等到周期结束

### 7.2 API 设计（建议）

```ts
log.sample({
	level: 'info' | 'debug',
	ns: string,
	event: string,
	key: string,              // sampleKey（同类采样归并）
	intervalMs?: number,      // 默认 500ms
	value?: number,           // 单值采样
	values?: Record<string, number>, // 多值采样
	thresholds?: {
		// 任意 value/values 字段超过阈值 => 立即 flush
		// 示例：{ width: 8, left: 10 }
		[field: string]: number;
	},
	msg?: string,
	data?: Record<string, unknown>,  // 附加非数值数据（例如 requestId）
})
```

### 7.3 聚合输出内容

对每个数值字段维护：

- `min/max/last`
- `first/last timestamp`

到周期结束输出 1 条：

- `agg.kind = 'sample'`
- `data` 内包含：每个字段的 `{ min, max, last }` 或压缩形式

### 7.4 阈值触发（避免丢关键）

当新值与上一次 `last` 的差值超过阈值时：

- 立即 flush 当前聚合（输出 1 条），并开启新的周期

阈值建议（后续可在实践中调整）：

- `scale`: 0.05
- `bounds.width/height`: 6~12 px
- `bounds.x/y`: 8~16 px
- `anchorCenter` 或 `predictedLeft`: 10~20 px

## 8. 命名空间（ns）与事件（event）建议清单

### 8.1 推荐命名空间

- `pet.model`：模型加载/生命周期（load/dispose/runtime patch）
- `pet.canvas`：canvas/interaction（pointer/mouse passthrough）
- `pet.layout`：布局、缩放、baseline、resize/bounds
- `pet.motion`：motion/eye guard/patch（高频 debug 必须走聚合/采样）
- `pet.ipc`：来自 preload/petAPI 的事件（bounds broadcast 等）

### 8.2 针对“scale 抖动”排查的最小事件集

这些事件优先实现（噪声低但信息密度高）：

1) `pet.layout` / `scale.update`
- data: `{ from: 'worker'|'controlPanel'|'init', prev, next }`

2) `pet.layout` / `baseline.set`
- data: `{ reason: 'init'|'afterBubbleDismiss'|'boundsChanged', baselineCenter }`

3) `pet.layout` / `resize.request`（建议使用 `log.agg`）
- key: `'main'` 或 requestId
- data: `{ width, height, anchorCenter, preserveCenterLine, requestId }`

4) `pet.ipc` / `bounds.changed`（建议使用 `log.sample`）
- values: `{ x, y, width, height }`
- data: `{ requestId, source: 'broadcast' }`

5) `pet.layout` / `bounds.delta`（建议使用 `log.sample` + thresholds）
- values: `{ dx, dy, dWidth, dHeight, dCenter }`
- 用于快速看“预测 vs 实际”的偏差是否突然变大

## 9. 调用范式（示例）

### 9.1 普通结构化日志

```ts
log.info('pet.model', 'load.start', { modelPath })
log.warn('pet.model', 'load.failed', { modelPath, error })
```

### 9.2 去重聚合（窗口结束汇总）

```ts
log.agg({
	level: 'info',
	ns: 'pet.layout',
	event: 'resize.request',
	key: 'main',
	windowMs: 800,
	data: { width, height, requestId, anchorCenter },
})
```

输出示例（单条汇总）：

```js
{
	level: 'info',
	ns: 'pet.layout',
	event: 'resize.request',
	agg: { kind: 'dedupe', key: 'pet.layout|resize.request|main', count: 17, windowMs: 800, firstT: 1200, lastT: 1980 },
	data: { width: 420, height: 680, requestId: '...', anchorCenter: 512 }
}
```

### 9.3 高频采样（500ms）

```ts
log.sample({
	level: 'debug',
	ns: 'pet.ipc',
	event: 'bounds.changed',
	key: 'mainWindow',
	intervalMs: 500,
	values: { x, y, width, height },
	thresholds: { x: 12, y: 12, width: 10, height: 10 },
	data: { requestId },
})
```

## 10. 迁移策略（不一次性重写）

为降低风险，建议分阶段迁移：

1) 先实现 logger 与 ctx 注入（不改业务逻辑）
2) 将高频/噪声最大的 `console.log` 迁移到 `log.agg` / `log.sample`
3) 将少量关键生命周期/错误日志迁移到 `log.info/warn/error`
4) 确认在 `debugModeEnabled=false` 时，DevTools 输出明显“干净”

## 11. 验收标准

1) `debugModeEnabled=false`：无高频刷屏；仅保留必要 warn/error 和少量关键 info
2) `debugModeEnabled=true`：可以看到结构化事件；高频事件以汇总/采样形式输出
3) scale 抖动问题排查时，能在 DevTools 里通过筛选 `ns=pet.layout` / `event=bounds.delta` 快速定位异常跳变

