# AstrBot QQ bridge

This renderer plugin owns the QQ conversation settings. The control-panel page stores them in Electron under `live2d.astrbot-bridge`. The pet window opens one WebSocket to the Python bridge.

## Who is speaking

QQ user ids are strings. The owner QQ is saved here and is never guessed from a nickname. Every person's QQ relationship, including the owner's, is configured in this plugin. It does not read or follow the desktop character relationship, and it does not sync when the desktop relationship changes. Nothing here promotes a relationship automatically. A person with no QQ relationship set is addressed as 认识.

Address order for the current message is: scene override, that person's default, then nickname. A mentioned person keeps their own id and their own address for this scene. Mentioning someone does not make them the sender. Group and private archives stay separate (`episode/<groupId>` and `episode/user/<userId>`).

Remote tool grants stay in the local Agent settings. Binding a QQ id does not grant tools.

## When the bot replies

A message is forwarded only when it @s this bot, or when its own text starts with a wake word from this page. Wake words are pushed on hello and on `config.update`, so the Python process does not keep a second list. Changing them does not reconnect the socket. Changing nicknames, addresses, or relationships does not either.

Quote-only messages, @全体成员, @ of someone else, and the bot's own messages do not start a reply. Private chats use the same rules. There is no follow-up window and no mode that answers every message.

ASCII wake words are case-insensitive and must end on a space or punctuation. A Chinese wake word matches the start of the text. The wake word itself, with nothing after it, does not trigger. An @ of this bot uses the remaining text; if nothing remains, it does not trigger.

## Quotes and failures

The bridge sends `messageId`, the sender, mentions, and `replyTo` (`messageId`, `sender`, `text`, `resolved`). Mention text keeps each other person's id in place, for example `@冰霓(user_id=2904725137)`. This plugin resolves those ids in its own directory, then calls the existing conversation API. The current speaker's alias and QQ relationship go in `systemPrompt`. The mention target's id and address, and the quote, go in the user text. A quote is labeled as someone else's earlier message and is not a system instruction. If the quoted body cannot be loaded, `resolved` is false and the text is empty. Tool authorization still uses only `sender.id`.

Public failures are a stable code plus `diagnosticId`. The QQ message stays empty unless AstrBot's `reply_on_error` is turned on, in which case the notice is the fixed sentence in the Python plugin. Delivery failure does not generate another reply.

Protocol version is 3. A mismatch is logged and the hello is rejected.

## Layout

This folder is the renderer plugin. The Python AstrBot plugin is the ignored local directory `infra/astrbot-napcat/data/plugins/astrbot_plugin_live2d_bridge`. The astrbot service mounts `./data` at `/AstrBot/data`, so that directory is what the container loads. There is no second source folder and no extra bind mount.
