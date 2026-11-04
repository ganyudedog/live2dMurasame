# CLI 与 Agent 首版使用与验证

更新：2026-10-28。实现方案见同目录《CLI与Agent模式第一阶段实施方案》。本文件描述当前代码实际行为。

## 1. 启用本地开发任务

1. 使用 pnpm install 安装锁文件中的依赖；本次新增 @openai/codex-sdk 0.165.0。
2. 重启 Electron，使主进程和 preload 的新接口生效，只有刷新 Vite 页面不够。
3. 在控制面板 → AI 设置 → 文字 AI → Agent · Codex 中添加项目标识和本机项目绝对路径，保存。
4. 使用本机已有 Codex 登录配置。任务工作区必须存在；保留 SDK 的 Git 仓库检查，不隐式跳过。
5. 在现有聊天中输入“请在项目 project-a 中检查并修复构建错误”。ASR 最终文本使用相同本地入口。

模型会自行决定是否加载 development Skill；加载后继续调用 agent.workspaces、agent.run 等工具，工具结果回填到下一次模型请求。模型缺少项目等必要信息时应询问用户，不猜路径。

启动任务返回 taskId，不等待开发任务完成。控制面板首页与 Agent 设置卡展示状态、摘要及取消按钮。可在聊天中要求查询、续接或取消指定任务。

同项目任务串行；续接使用明确的 Codex 会话 ID。开始另一轮聊天、停止语音、关闭任务卡不等于取消任务。关闭整个应用会停止其受控执行进程；重启不自动重跑未完成任务。

## 2. 配置修改

自然语言示例：

- “把桌宠缩放设成 0.8。”
- “把显示语言切换成英文。”
- “关闭当前模型的 TTS。”
- “把字幕停留时间改成 3 秒。”

settings Skill 引导模型先读 config.get，再携带 revision 和最小 patch 调用 config.update。修改持久化后通过现有快照通知窗口；缩放由 pet 侧单向投影到 StateBus，避免仅修改磁盘而不改变展示。

可用范围以命令的 schema 为准。凭据不进入普通查询结果，也不能通过这组通用配置命令修改。当前对话模型与思考深度继续使用原 UI 的前端选择缓存；本阶段没有将它们改为后端持久化设置。

“保存成功”仅表示配置已生效到权威存储与快照，不代表 TTS 预热、ASR 或其他外部服务已经就绪。

## 3. 远程插件 Channel

Channel 仅作为远程插件入口，本地 AiService 不经过它。本地与远程执行器共享 Skill/tool loop，不共享对话身份或重复消费同一请求。

默认远程来源无权修改配置或启动本机任务，仍可普通聊天。需要使用时在本机 Agent 设置中增加允许的来源，例如现有插件：

```text
plugin:live2d.astrbot-bridge
```

来源由 PluginRuntime 根据插件 ID 注入，覆盖插件自报 source。授权这个来源意味着允许该可信插件携带的发送者请求操作本机；群成员筛选等平台策略仍由插件/桥接端负责。

插件请求须携带 sender.id；任务按来源、conversationId 和 senderId 隔离。其他用户不能仅凭 taskId 读取或取消任务。

公开 Channel 增量接口：

```ts
const stop = channel.onTask?.(({ task, sequence }) => {
  // 把状态映射到自己的平台消息；不要把它再次当作用户输入。
});
channel.watchTasks?.({ conversationId, senderId }); // 重连后恢复观察，不发起新聊天
```

- onResponse 保持原来的 streaming / done / error / cancelled 聊天语义。
- onTask 独立发送后端任务变化，聊天 done 后仍可更新。
- Channel.cancel 只取消聊天；用户明确调用 agent.cancel 才取消开发任务。
- Channel.dispose 清理订阅，已接受的后台任务继续运行。
- 连接插件负责保存/恢复需要观察的会话身份；watchTasks 恢复当前快照，不重放一轮聊天。
- TUN、穿透、平台协议和连接方式属于插件，不是 cli module 的固定组成。

## 4. 现有 AstrBot 适配

保留原来的 WebSocket v2 对话协议。前端插件声明 agent 能力并增加独立事件：

```json
{
  "type": "agent.task",
  "version": 2,
  "requestId": "原消息请求ID",
  "conversationId": "原会话ID",
  "taskId": "task_...",
  "status": "succeeded",
  "sequence": 4,
  "text": "结果摘要"
}
```

外部 AstrBot 桥接端需要处理 agent.task 才能主动推送结果；本仓库不包含那个外部服务，不能声称其协议已经同步升级。不识别新事件的桥接端仍可通过原聊天询问任务状态。

当前连接实例在 WebSocket 重连时恢复已观察会话。整个插件重新加载后，下一条带身份的消息会恢复该会话快照。投递去重使用任务序号；没有外部平台确认机制时不保证“恰好投递一次”。

## 5. 本机 CLI 与 HTTP/SSE

Electron 启动后在随机 loopback 端口提供结构化接口，并在 Electron userData/cli/connection.json 中保存 URL 与访问凭据。该文件不应提供给任意插件或未经授权的外部客户端。

```text
pnpm live2d --connection "<userData>/cli/connection.json" agent workspaces
pnpm live2d --connection "<userData>/cli/connection.json" agent run --workspace project-a --prompt "检查构建错误"
pnpm live2d --connection "<userData>/cli/connection.json" agent get --task task_...
pnpm live2d --connection "<userData>/cli/connection.json" agent continue --task task_... --prompt "继续修复测试"
pnpm live2d --connection "<userData>/cli/connection.json" config get --scope global
```

也可设置 LIVE2D_CLI_CONNECTION 环境变量，避免每次指定路径。复杂配置通过 --json 传入对象，不执行 shell 字符串、变量替换或管道。

CLI 输出包含 invocationId、issuedAt 和 result。重试保留原 ID、时间与参数：--id 与 --issued-at；相同 ID 不同参数返回冲突。保护期为 24 小时，过期信封拒绝执行。回收全部去重记录后不能识别一个伪装成新时间的旧请求，因此调用方必须遵守稳定信封协议。

接口：

| 接口 | 行为 |
| --- | --- |
| POST /commands | 提交结构化命令，必须带 Bearer 凭据 |
| GET /tasks | 查询本机调用身份的最近任务 |
| GET /tasks/:taskId | 查询指定任务 |
| GET /events | SSE：先 snapshot，再 task 事件；每任务 sequence 去重 |

服务只监听 127.0.0.1，不实现 TUN 或公网暴露。该凭据授予本机命令能力，不替代远程插件 Channel 的按会话授权。现有 AstrBot 不需要改用这个 HTTP 入口。

## 6. 状态与持久化

userData/cli/tasks.json 为单主进程写入的原子替换账本：

- 活跃 SDK/连接/取消控制器只放内存。
- 调用去重与工作流结果保留 24 小时。
- 终态任务摘要和外部会话映射保留 7 天。
- 每小时回收过期记录，活动任务不按终态时间删除。
- 重启将未终态任务标为 interrupted；不根据不确定记录自动重跑。
- 完整代码上下文与执行过程由 Codex 管理，不写入角色长期记忆。

Codex 由单独受控子进程承载；取消等待进程树退出，不是仅关闭前端订阅。执行权限固定为 workspace-write、非交互审批策略，遇到实际环境限制返回失败，不自动放宽。

## 7. 验证记录与回归入口

- pnpm build：构建通过；本次修改涉及的 TypeScript 与定向 ESLint 检查通过。
- 新增后端集成测试覆盖配置修订、敏感字段、幂等、工作区串行、续接 ID、取消、重启保留记录、HTTP 授权和 SSE 快照恢复。
- 进程生命周期测试使用隔离 fixture，验证取消后子孙进程退出、无结果退出不伪报成功。
- LLM 测试覆盖 loadSkill → 工具执行 → 回填 → 后续模型调用、上下文隔离、轮数限制和缓存工作流。
- 本地 LlmService 与另一个模拟远程平台的执行器都验证了工具路径跳过记忆归档。
- 真实 @openai/codex-sdk 在隔离的空临时 Git 仓库完成一次只回复 READY 的冒烟任务，返回有效会话 ID；未要求它读写用户项目。
- 全量测试：439 项中 436 项通过。三项记忆失败已在原始 HEAD 的隔离副本中复现，属于原有失败：modelMemoryDao.test.js 两项、registerMemoryIpc.test.js 一项。

建议人工回归：重启 Electron → 配置一个测试项目 → 本地聊天改缩放 → 本地启动开发任务 → 继续聊天 → 查询与取消 → 已授权远程 Channel 重复投递同一消息 → 断开并恢复连接 → 检查没有重复执行和跨会话结果泄漏。

尚未代替人工完成的验证：真实桌面窗口下的完整聊天/TTS交互，以及外部 AstrBot 服务对新增 agent.task 事件的消费。
