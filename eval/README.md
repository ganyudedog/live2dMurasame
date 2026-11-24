# 离线对话评测

从仓库根目录用 `pnpm eval` 运行已登记的 TypeScript 案例。Windows 上依赖与当前 Node ABI 匹配的 `better-sqlite3`，安装依赖后可以用 `pnpm rebuild better-sqlite3` 重建。运行器关闭 Promptfoo 的遥测、更新检查和结果缓存，临时结果库在退出时删除。

## 离线接线回归

在 `cases` 编写入口、输入、替身和 `accept`，并在同级配置显式登记。Promptfoo 输出包含问题、工具上下文、回复、发送记录及断言结果；验收失败时仍可查看观察值。

## 从 Jaeger 生成模型 benchmark

本地开发时，`pnpm dev` 和 `pnpm electron:dev` 都会读取仓库的 `.env.development`，默认将成功的最终对话模型调用写入 Jaeger 的对话 span。采集内容包括完整 messages、模型参数、当轮工具结果、用户问题和模型原回复。Jaeger 运行时，日常桌宠和插件对话都可以作为草稿来源。`pnpm build` 的生产模式默认关闭采集。临时停采可在启动 Vite 前设置 `VITE_CAPTURE_MODEL_BENCHMARK=0`，或在启动 Electron 前设置 `CAPTURE_MODEL_BENCHMARK=0` 来停止导出正文。

`pnpm eval:draft <traceId> [spanId]` 从本机 Jaeger 读取捕获内容，生成 `benchmark/drafts/<traceId>-<spanId>.ts`。遇到多个模型 span 时显式选择一个。旧 trace 缺少原始输入时，命令会说明缺失，不生成案例。人工核对内容、添加 `accept` 后放入 `benchmark/cases` 并在 `benchmark/promptfooconfig.ts` 登记。

设置 `BENCHMARK_API_KEY` 和 `BENCHMARK_BASE_URL`，运行 `pnpm eval:benchmark`。默认重用捕获时的模型，也可以用 `BENCHMARK_MODEL` 指定对照模型。每个案例向指定端点发起一次真实、无重试的 chat completions 请求。原回复只作参考，不发送给模型。Promptfoo 输出含 `question`、`toolContext`、`reference`、`reply` 和来源，可继续添加评分断言。已登记的 ticket 示例来源于一次使用合成工单数据的实际模型调用。

## 验收出口

| 案例 | 观察值 |
| --- | --- |
| `conversation` | `AiService.processChatRequest` 提交给模型的文本和状态总线收到的回复 |
| `channel` | `sendText` 经对话执行器与真实工具循环调用的命令、最终模型收到的工具上下文，以及发送替身收到的实际会话 ID 和文本 |
| `cli` | `CliService.invoke` 调用命令替身时的参数和返回结果 |
| `reminder` | 到期发送的目标和文字、提交后待确认的记录以及确认后的队列 |

Provider 在当前 Node 进程的独立 worker 线程中加载案例。每个案例有自己的存储、命令账本和 10 秒执行上限。模型、插件命令、消息发送和日志使用替身。`accept` 中使用 TypeScript 断言；抛错会显示案例文件名和 `accept()`，超时会终止 worker。改动业务实现后重新运行相同案例即可。
