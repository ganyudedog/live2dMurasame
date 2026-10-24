# Renderer plugins

Plugins are bundled renderer extensions registered from this directory. Business plugins live in their own folders and import contracts only from `src/app/core/plugin`; they must not import internal services or other application implementations.

Each plugin exports a default definition from `index.ts`. The host validates its manifest, activates it for the current renderer window, grants only requested host capabilities, tracks disposable subscriptions, and removes UI/command contributions when it stops. UI contributions can be cards in an existing slot or dedicated control-panel pages. Plugin data is namespaced in Electron storage and synchronized between renderer windows.

The public API describes capabilities, not implementation details. Add new host functionality as a typed capability in `src/app/core/plugin`, then register its host-side provider and permission in the core composition root. Keep plugin-specific protocols, configuration views, and business rules in that plugin's folder.

Bundled renderer plugins execute in the application renderer and are trusted application code; manifest permissions limit accidental capability use but are not a sandbox for untrusted third-party code.

All discovered plugins are activated by default. Configure connections through the control panel; no plugin environment variables or enable/disable controls are used yet.

To archive a conversation, pass `memoryArchive: { platform, scope, id }` with `sendText` (`scope` is `group` or `private`). These are logical identifiers, not paths; platform and ID accept 1–80 ASCII letters, digits, underscores or hyphens (Windows device names are rejected). Platform names are normalized to lowercase. The host captures the active character at request start, recalls matching episodes with BM25, and saves a completed text exchange under that character's `memory/episodes/<platform>/<scope>/<id>/<date>.md`. Omitting the archive disables this behavior. Archives use the existing seven-day retention rule and do not feed desktop core-memory consolidation. Persistence failures are logged as `memory.persist.failed` without discarding a generated reply. This records model completion, not confirmation that an external platform delivered the reply.

### 最近对话与发送者

配置 `memoryArchive` 的对话会从对应归档读取最近 10 轮完整交互，按时间顺序作为 user/assistant 消息发送；保留期为七天，历史消息总预算为 24,000 字符，超限裁减较早的完整轮次。排队请求在实际执行时读取历史，并发请求只看到已经落盘的回复。

`ConversationRequest.sender` 可携带 `{ id: string, displayName?: string }`。AstrBot 桥接支持 `sender.id` 或 `sender.user_id`，名称读取 `displayName`、`nickname` 或 `name`。QQ 号支持字符串或安全整数，宿主统一转换为字符串；旧消息未携带身份时不会推测群成员身份。`conversationId` 与发送者一并存入 episode 元数据，归档隔离仍由 `memoryArchive` 决定。

群聊保留同群不同发送者的上下文；私聊使用独立归档。插件对话不参与桌面核心记忆整理，也不注入动作表。

归档的 `turn-meta` 使用明文 JSON，发送者仅保存 `sender.id`，不保存昵称；`conversationId` 一并保留。读取端只接受此格式，不兼容早期 URI 编码元数据。
