# AstrBot QQ bridge

This renderer plugin owns the QQ conversation settings. The control panel shows them as three pages under **AstrBot QQ** (`连接与触发`, `回复设置`, `QQ 用户`). Settings are stored in Electron under `live2d.astrbot-bridge`. The pet window opens one WebSocket to the Python bridge.

## Who is speaking

QQ user ids are strings. The owner QQ is saved here and is never guessed from a nickname. The bound owner shares the desktop relationship and growth. Only that sender's own messages enter shared memory; group IDs, mentions and quoted speakers never establish ownership. Other people's QQ relationships are manual only. A person with no QQ relationship set is addressed as 认识.

Address order for the current message is: scene override, that person's default, then nickname. A mentioned person keeps their own id and their own address for this scene. Mentioning someone does not make them the sender. Group and private archives stay separate (`episode/<groupId>` and `episode/user/<userId>`).

Remote tool grants stay in the local Agent settings. Binding a QQ id does not grant tools.

## When the bot replies

A message is forwarded only when it @s this bot, or when its own text starts with a wake word from `连接与触发`. Wake words are pushed on hello and on `config.update`, so the Python process does not keep a second list. Changing them does not reconnect the socket. Changing nicknames, addresses, or relationships does not either.

Quote-only messages, @全体成员, @ of someone else, and the bot's own messages do not start a reply. Private chats use the same rules. There is no follow-up window and no mode that answers every message.

ASCII wake words are case-insensitive and must end on a space or punctuation. A Chinese wake word matches the start of the text. The wake word itself, with nothing after it, does not trigger. An @ of this bot uses the remaining text; if nothing remains, it does not trigger.

## Quotes and failures

The bridge sends `messageId`, the sender, mentions, and `replyTo` (`messageId`, `sender`, `text`, `resolved`). Mention text keeps each other person's id in place, for example `@冰霓(user_id=2904725137)`. This plugin resolves those ids in its own directory, then calls the existing conversation API. The current speaker's alias and QQ relationship go in `systemPrompt`, together with the relevant people's manually configured profiles resolved by QQ id. Mention metadata and the quoted message remain in the user text. A quote is labeled as someone else's earlier message and is not a system instruction. If the quoted body cannot be loaded, `resolved` is false and the text is empty. Tool authorization still uses only `sender.id`.

Public failures are a stable code plus `diagnosticId`. The QQ message stays empty unless AstrBot's `reply_on_error` is turned on, in which case the notice is the fixed sentence in the Python plugin. Delivery failure does not generate another reply.

Protocol version is 3. A mismatch is logged and the hello is rejected.

## Layout

This folder is the renderer plugin. The Python AstrBot plugin is the ignored local directory `infra/astrbot-napcat/data/plugins/astrbot_plugin_live2d_bridge`. The astrbot service mounts `./data` at `/AstrBot/data`, so that directory is what the container loads. There is no second source folder and no extra bind mount.

## 人物档案与模块

QQ 用户新增「人物描述」，由用户手动填写并沿用插件后端存储。每轮按发送者、被 @ 的人、引用发送者及引用中的 `user_id` 标记去重召回档案。昵称仅用于展示，不作为身份依据；未填写的资料不会推测。当前消息的结构化 @ 上限为 32 人。

- `ui/PeopleEditor.tsx`：人物编辑界面；`AstrBotPeopleSection.tsx`：读取和保存。
- `profiles/recall.ts`：按 QQ ID 汇集本轮人物档案。
- `turn.ts`：组合场景、人物档案、消息及引用。
- `stickers/prompt.ts`：可选表情提示词；桥接客户端只负责对接。
- Python `messages.py`：QQ 消息解析；`stickers.py`：收藏表情和发送；`main.py`：事件及连接生命周期。

## QQ 收藏表情

复用 NapCat 收藏接口与 AstrBot 图片发送。连接及收到 QQ 消息时同步图片；页面展示图片和简短表情词，失焦保存。无需启用开关或发送条件，填好表情词即可参与匹配；允许不发送。

回复中的 `[恶心]` 按表情词精确匹配，移除标记后先发文本，再单独发送图片。后端只存 `stickerLabel: { QQ号: { 图片ID: { url, description } } }`。每次连接同步收藏，删除已移除图片、加入新图片、更新 URL，保留已有表情词。旧 stickerCatalog/stickerRules/stickerLabels 自动迁移并删除，不保留内部 id、sendWhen 或 enabled。

Python 桥接在 Git 忽略目录 `infra/astrbot-napcat/data/plugins/astrbot_plugin_live2d_bridge`，迁移时需一起复制。
