# Electron TypeScript 迁移报告

分支 `feat/cli-service-and-electron-transform-ts`。迁移前快照 `1347c8b`，原始 main 基点 `02f290b`。未提交，未打包 EXE。

## 编译边界

Electron 使用独立的 `tsconfig.electron.json`：`strict`、`NodeNext`、`rootDir: electron`、`outDir: dist-electron`、`noEmitOnError`。`useDefineForClassFields: false` 保留构造函数赋值字段的原有语义。测试使用 `tsconfig.electron.tests.json`，同样 strict，且 `noEmit`。前端 `pnpm build` 仍是 `tsc -b && vite build`，不把 Electron 编进前端工程。

开发入口是编译产物 `dist-electron/main.js`。preload 源文件是 `electron/preload.mts`，编译为 `dist-electron/preload.mjs`。Electron 只按扩展名判断 preload 是不是 ESM，不看 `package.json` 的 `"type": "module"`，所以不能用带 `import` 的 `preload.js`。控制面板、宠物窗口和字幕窗口的 `webPreferences.preload` 都指向这个 `preload.mjs`。ASR 与 Codex worker 是单独编译文件。`sherpa-onnx-node` 与 `koffi` 仍在运行时 `createRequire`。共享模块继续以仓库里的 `shared/**/*.js` 被编译结果相对引用。

## 文件职责

- `electron/main.ts`：进程入口。创建窗口、装配环境、模型、字幕、ASR、CLI，并注册 IPC。不再单独持有 Hold。
- `electron/preload.mts` 与 `electron/preload/`：渲染进程桥和快照缓存。入口编译为 `preload.mjs`。
- `electron/dao/`：全局配置与模型记忆的读写、规范化。
- `electron/infrastructure/persistence/`：环境、模型配置、记忆的 JSON 仓库。
- `electron/infrastructure/system/`：开机启动适配。
- `electron/interface/ipc/`：各 IPC 只调用对应服务，不接触任务账本。
- `electron/modules/cli/module.ts`：只装配账本、Agent 服务和命令注册。
- `electron/modules/cli/infrastructure/commands/`：命令 schema 与注册。`config.*` 委托模型/环境服务，`agent.*` 委托 Agent 任务服务。
- `electron/modules/cli/service/CliService.ts`：鉴权、幂等 claim/finish、命令调用，以及任务查询的唯一对外接口。
- `electron/modules/cli/service/AgentTaskService.ts`：任务生命周期。`electron/modules/cli/infrastructure/` 放账本、Codex 适配、worker 和本机 HTTP。
- `electron/modules/asr/`：识别会话、远程/本地适配、worker。`AsrRuntime` 内部持有 `HoldToTalkService`。Windows 按键读取留在 infrastructure 适配器。
- `electron/modules/live2denv/`、`modelenv/`、`window/`、`subtitle/`、`plugins/`：各自的环境、模型、窗口、字幕和插件存储。

## CLI 调用链与 ID

渲染进程只走 `registerCliIpc({ ipcMain, cli })`。本机命令行只走 `startCommandServer({ cli, directory })`。两边都只调用 `CliService`。`createCliModule` 创建 `TaskStore` 和 `AgentTaskService`，再由 infrastructure 注册命令。Agent 执行由 `AgentTaskService` 交给 `CodexAdapter`，适配器 fork `codexWorker.js`。

| ID | 来源与职责 |
| --- | --- |
| `source` / `conversationId` / `senderId` | IPC 里来自 `cli:open` 的请求体，不是 IPC 帧。传输层只核对打开会话的 `WebContents`：后续调用必须来自同一个 `WebContents`，且页面 URL 是 `app:` 或配置的 Vite 开发源。字段值本身由该渲染进程提供。本机 CLI 不走 `cli:open`，由命令服务固定为 `local-cli` / `desktop` |
| `local` | `source === 'local'` 时为 true。本机 HTTP 由命令服务直接设为 true |
| `owner` | 由调用者派生：`local`，或 `source + conversation + sender` 的稳定编码；任务访问键。本机 HTTP 固定为 `local` |
| IPC session id | `cli:open` 返回的随机 id，把那次 payload 绑到一个 `WebContents` |
| `invocationId` | 一次命令调用的客户端幂等键 |
| `requestId` | 工具流程的 claim/finish id。命令落在流程内时记下它，否则回退到 `invocationId` |
| `taskId` | 一次 Agent 执行，`task_` + uuid。`agent.continue` 新建一个 |
| `providerSessionId` | Codex thread id。继续执行时复用，不是任务 id |
| `parentTaskId` | continue 所接续的上一个任务 |

已注册命令：`config.get`、`config.update`、`agent.providers`、`agent.workspaces`、`agent.run`、`agent.continue`、`agent.list`、`agent.get`、`agent.cancel`、`agent.settings.get`、`agent.settings.update`。

## 命令

- `pnpm electron:typecheck`：Electron 源码与测试的 strict 检查
- `pnpm electron:compile`：输出 `dist-electron`
- `pnpm electron:dev`：先编译，再以 `dist-electron/main.js` 启动；需要已有的 Vite `http://localhost:5180`
- `pnpm test`：先编译 Electron，再运行 Vitest，确保全新检出时 preload 冒烟测试有对应产物。
- `pnpm build`：前端类型检查与 Vite 构建
- `pnpm build:cli:exe`：CLI EXE 目标仍保留。本次没有执行

## 验证

2026-10-29 基线是 `pnpm test` 58 个文件通过、12 个文件因旧 shared/ASR 路径加载失败、377 项测试通过。这些路径已改为当前 `shared/` 与 `electron/modules/asr/`。

2026-10-30 本次结果：

- `pnpm electron:typecheck` 通过
- Electron 测试 20 个文件、85 项通过
- `pnpm test` 71 个文件、440 项通过
- `pnpm build` 通过
- `pnpm electron:compile` 通过。`main.js`、`preload.mjs`、`asrWorker.js`、`codexWorker.js` 存在
- 隔离的隐藏窗口加载编译后的 `preload.mjs`，使用临时 `userData`，不读用户配置。`window.CliAPI.open`、`window.SnapshotAPI.getSnapshot` 和 `onLive2denvConfigUpdated` 都存在，且没有 `preload-error`

冒烟测试单独启动了一个隐藏的 Electron 窗口，没有进入 `main.ts`，没有加载 sherpa，也没有跑真实 Codex 任务。因此不能声称完整窗口生命周期或付费 Agent 已在运行时验证。

## 未解决与未执行

- 只对编译后的 preload 做了隐藏窗口冒烟。没有启动完整主进程，没有验证窗口关闭或 worker 生命周期，避免碰真实用户配置。
- 未执行 `pnpm build:cli:exe`，未打安装包，未发布。
- 未提交。
- 记忆保留期是 7 天。指向 2026-10-19 / 2026-10-20 的测试把 `Date.now` 固定在样本当天，避免在 2026-10-30 被正常清理逻辑删掉。保留规则本身没有放宽。
