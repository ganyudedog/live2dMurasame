# NapCat QQ

桌宠窗口作为 OneBot 11 正向 WebSocket 客户端。控制面板的「NapCat QQ → 连接与触发」设置地址和访问令牌。对应的 NapCat WebSocket 服务端应启用数组消息段。本地 Compose 将 3001 和 WebUI 的 6099 仅发布到回环地址。插件沿用 `live2d.napcat-bridge` 存储标识，保留原有的目录、配置、授权和提醒来源。

群聊需要 @ 本账号或以唤醒词开头，并有当前消息内容。私聊只允许已绑定主人及明确加入私聊白名单的人。引用用 `get_msg` 获取，原文缺失时保留未取得标记。消息按账号、会话和 `message_id` 去重。每个会话的排队、打断和并发策略可在连接页设置。

只有发送者 QQ 号决定主人身份。插件将人物档案、场景、语言、引用和可选收藏表情说明交给现有 channel。连接就绪时从 NapCat 的生命周期事件取得账号，直接查询 `fetch_custom_face`，保留已编辑的表情词。文本和选中的图片作为同一条 OneBot 消息发送。

回复和提醒保存在插件发件箱。回复的 `plugin.runtime` 发送 span 与 `cli.invoke` 同属这轮 `plugin.conversation`，提醒发送独立起一条 trace。只有对应 `echo` 返回 `status: ok` 才确认。回执失败或断线保留记录，恢复连接后为每条未确认记录重新发送一次。若发送已被 NapCat 接收但回执在断线时丢失，重新发送可能产生重复 QQ 消息。回执仅证明 NapCat 接受发送。

协议、人物规则及交付的离线验证使用 `pnpm exec vitest run plugins/napcat test/napcat.delivery.test.ts`。
