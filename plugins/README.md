# Renderer plugins

Plugins are bundled renderer extensions registered from this directory. Business plugins live in their own folders and import contracts only from `src/app/core/plugin`; they must not import internal services or other application implementations.

Each plugin exports a default definition from `index.ts`. The host validates its manifest, activates it for the current renderer window, grants only requested host capabilities, tracks disposable subscriptions, and removes UI/command contributions when it stops. UI contributions can be cards in an existing slot or dedicated control-panel pages. Slot contributions are wrapped in a titled host card; dedicated pages are rendered without a wrapper, so the plugin lays out its own sections. A page may set `icon` (a component such as a lucide-react icon) and `description` (shown under the page title). Pages of one plugin that share the same `group` text become one collapsible navigation group, ordered by `order`; pages without a group are listed under the host's plugin group. Plugin data is namespaced in Electron storage and synchronized between renderer windows.

The public API describes capabilities, not implementation details. Add new host functionality as a typed capability in `src/app/core/plugin`, then register its host-side provider and permission in the core composition root. Keep plugin-specific protocols, configuration views, and business rules in that plugin's folder.

Bundled renderer plugins execute in the application renderer and are trusted application code; manifest permissions limit accidental capability use but are not a sandbox for untrusted third-party code.

All discovered plugins are activated by default. Configure connections through the control panel; no plugin environment variables or enable/disable controls are used yet.

To archive a conversation, pass `memoryArchive: { platform, scope, id }` with `sendText` (`scope` is `group` or `private`). These are logical identifiers, not paths; platform and ID accept 1–80 ASCII letters, digits, underscores or hyphens (Windows device names are rejected). Platform names are normalized to lowercase. The host pins the active character when the request is accepted and discards the request if that character changes before execution starts. It adds that character's own name, voice, examples, boundaries, and notes. It does not add the desktop user address or the desktop relationship. A plugin that needs a relationship or a form of address puts them in `systemPrompt`; message-specific data belongs in `text`. The host recalls matching episodes with BM25, and saves a completed text exchange under that character's `memory/episodes/<platform>/<scope>/<id>/<date>.md`. Omitting the archive disables this behavior. Archives use the existing seven-day retention rule and, by default, do not feed desktop core-memory consolidation. Persistence failures are logged as `memory.persist.failed` without discarding a generated reply. This records model completion, not confirmation that an external platform delivered the reply.

### 最近对话与发送者

配置 `memoryArchive` 的对话会从对应归档读取最近 10 轮完整交互，按时间顺序作为 user/assistant 消息发送；保留期为七天，历史消息总预算为 24,000 字符，超限裁减较早的完整轮次。排队请求在实际执行时读取历史，并发请求只看到已经落盘的回复。

`ConversationRequest.sender` 可携带 `{ id: string, displayName?: string }`。AstrBot 桥接支持 `sender.id` 或 `sender.user_id`，名称读取 `displayName`、`nickname` 或 `name`。QQ 号支持字符串或安全整数，宿主统一转换为字符串；旧消息未携带身份时不会推测群成员身份。`conversationId` 与发送者一并存入 episode 元数据，归档隔离仍由 `memoryArchive` 决定。

群聊保留同群不同发送者的上下文；私聊使用独立归档。插件对话默认不参与桌面核心记忆整理，也不注入动作表。

归档的 `turn-meta` 使用明文 JSON，发送者仅保存 `sender.id`，不保存昵称；`conversationId` 一并保留。读取端只接受此格式，不兼容早期 URI 编码元数据。

### 个人记忆与关系成长

`host.ai.getRelationship()` 可读取当前角色的关系。插件自行判断发言人身份；只有确定当前消息应作为桌面用户的输入时，才在 `sendText` 中设置 `personalMemory: { userText }`，其中原文不包含引用、转发和人物档案。其他人省略这个参数。

AI 模块在回复成功后，复用桌面的 `MemoryService.persistConversation` 和 `consolidateIfNeeded`。参数与 `memoryArchive` 独立：会话可以仅归档、仅进入个人记忆，或同时执行两者。未传参数、失败、取消和工具处理的轮次不会进入个人记忆。是否符合成长条件仍遵循普通成长规则。

此选项只存在于 AI 请求入口，不传到 Electron。Electron 不识别插件身份、不读取插件设置、不验证主人绑定，也不自动复制归档。删除插件不影响桌面原有的记忆与成长流程。

### CLI 插件白名单存储

控制面板按已注册插件勾选授权，保存到 Electron 用户数据目录的 `config/globalModelConfig.json`：

```json
{
  "pluginCliWhitelist": [
    { "pluginId": "live2d.astrbot-bridge", "cliEnabled": true }
  ]
}
```

界面读取和后端鉴权都以此文件为准。未勾选的插件从数组移除；空数组表示禁止所有插件调用 CLI。首次升级会迁移旧 `cli/tasks.json` 中的授权，已有全局白名单（包括空数组）不被旧值覆盖。项目和任务记录仍保存在 CLI 任务文件中。
