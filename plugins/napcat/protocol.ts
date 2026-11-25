import { isQqUserId } from './directory';

export interface NapCatQuote {
  speaker?: { id: string; displayName?: string };
  text: string;
  available: boolean;
}
export interface Segment {
  type: string;
  data: Record<string, unknown>;
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown) =>
  typeof value === 'string' || Number.isSafeInteger(value) ? String(value) : '';
const cleanName = (value: unknown) =>
  typeof value === 'string'
    ? value
        .replace(/[\r\n]/g, ' ')
        .trim()
        .slice(0, 80)
    : '';
const separators = /^[\s,，.。!！?？:：、~～]+/u;

function readSegments(value: unknown, self: string) {
  if (!Array.isArray(value)) return;
  let text = '',
    body = false,
    atSelf = false,
    replyId = '';
  const images: Record<string, unknown>[] = [];
  const mentions = new Map<string, { id: string; name?: string }>();
  for (const segment of value) {
    if (!record(segment) || !record(segment.data)) continue;
    const d = segment.data;
    if (segment.type === 'text' && typeof d.text === 'string') {
      text += d.text;
      body ||= !!d.text.trim();
    }
    if (segment.type === 'at') {
      const qq = id(d.qq);
      if (qq === self) atSelf = true;
      else if (isQqUserId(qq)) {
        const name = cleanName(d.name);
        if (mentions.size < 32) mentions.set(qq, { id: qq, name });
        text += `@${name || qq}(user_id=${qq})`;
      }
    }
    if (segment.type === 'reply' && !replyId) replyId = id(d.id);
    if (segment.type === 'face' || segment.type === 'image') {
      if (segment.type === 'image') images.push(d);
      body = true;
      text += segment.type === 'face' ? `[表情 ${id(d.id)}]` : '[图片]';
    }
  }
  return { text: text.trim(), images, body, mentions: [...mentions.values()], atSelf, replyId };
}
export function readQuote(value: unknown, self: string): NapCatQuote {
  const message = record(value) ? readSegments(value.message, self) : undefined;
  if (!record(value) || !message?.text) return { available: false, text: '' };
  const sender = record(value.sender) ? value.sender : {};
  const qq = id(sender.user_id);
  return {
    available: true,
    text: message.text,
    ...(isQqUserId(qq)
      ? { speaker: { id: qq, displayName: cleanName(sender.card || sender.nickname) } }
      : {}),
  };
}

export function readMessage(value: unknown, wakeWords: readonly string[], privateUsers: readonly string[]) {
  if (
    !record(value) ||
    value.post_type !== 'message' ||
    (value.message_type !== 'private' && value.message_type !== 'group')
  )
    return;
  const self = id(value.self_id),
    user = id(value.user_id),
    messageId = id(value.message_id);
  const group = value.message_type === 'group',
    target = group ? id(value.group_id) : user;
  if (
    !isQqUserId(self) ||
    !isQqUserId(user) ||
    !isQqUserId(target) ||
    self === user ||
    !/^-?\d{1,20}$/.test(messageId)
  )
    return;
  if (!group && !privateUsers.includes(user)) return;
  const parsed = readSegments(value.message, self);
  if (!parsed?.body) return;
  let text = parsed.text;
  if (group && !parsed.atSelf) {
    const word = wakeWords.find((w) =>
      /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(w)
        ? text.startsWith(w)
        : text.toLowerCase().startsWith(w.toLowerCase()) &&
          (text.length === w.length || separators.test(text.slice(w.length))),
    );
    if (!word) return;
    text = text.slice(word.length).replace(separators, '');
  }
  if (!text) return;
  const sender = record(value.sender) ? value.sender : {};
  const conversationId = `qq:${group ? 'group' : 'user'}:${target}`;
  return {
    self,
    messageId,
    conversationId,
    requestId: `${self}:${conversationId}:${messageId}`,
    text,
    sender: { id: user, displayName: cleanName(sender.card || sender.nickname) },
    images: parsed.images,
    mentions: parsed.mentions,
    replyId: parsed.replyId,
    archive: { platform: 'qq', scope: group ? ('group' as const) : ('private' as const), id: target },
    sceneKey: group ? `group:${target}` : 'private',
  };
}

export function sendAction(conversationId: string, message: Segment[]) {
  const match = /^qq:(group|user):([1-9]\d{4,19})$/.exec(conversationId);
  if (!match) throw new Error('Invalid QQ conversation');
  const group = match[1] === 'group';
  return {
    action: group ? 'send_group_msg' : 'send_private_msg',
    params: { [group ? 'group_id' : 'user_id']: match[2], message },
  };
}
