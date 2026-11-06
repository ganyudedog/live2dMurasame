import { describe, expect, it } from 'vitest';
import { isAstrBotQqMessage, normalizeAstrBotMentions, normalizeAstrBotSender, toConversationQuote } from './protocol';
import type { AstrBotQqMessage } from './protocol';

describe('AstrBot sender identity', () => {
  it.each(['2655314552', 2655314552])('retains QQ id %s from the bridge payload', (user_id) => {
    expect(normalizeAstrBotSender({ user_id, nickname: '南柯一梦' }))
      .toEqual({ id: '2655314552', displayName: '南柯一梦' });
  });
  it('accepts canonical ids and skips empty aliases', () => {
    expect(normalizeAstrBotSender({ id: '', user_id: 2655314552 })).toEqual({ id: '2655314552' });
    expect(normalizeAstrBotSender({ id: '2655314552' })).toEqual({ id: '2655314552' });
  });
  it('keeps mention ids, drops the bot, and dedupes', () => {
    const mentions = [
      { id: '3983762587', name: '机器人' },
      { id: '2904725137', name: '冰霓' },
      { id: '2904725137', name: '重复' },
      { id: '12', name: '短' },
      { id: 2655314552, name: '南柯一梦' },
    ];
    expect(normalizeAstrBotMentions(mentions, '3983762587')).toEqual([
      { id: '2904725137', name: '冰霓' },
      { id: '2655314552', name: '南柯一梦' },
    ]);
    const overflow = Array.from({ length: 9 }, (_, index) => ({ id: String(2904725130 + index), name: '人' }));
    expect(normalizeAstrBotMentions(overflow, '3983762587')).toHaveLength(8);
  });

  it('does not invent missing or unsafe identifiers', () => {
    expect(normalizeAstrBotSender(undefined)).toBeUndefined();
    expect(normalizeAstrBotSender({ user_id: Number.MAX_SAFE_INTEGER + 1 })).toBeUndefined();
  });

  it('accepts protocol 3 and separates a quote from the current message', () => {
    const message = {
      type: 'qq.message', version: 3, requestId: 'qq_1', conversationId: 'qq:group:30003',
      interactionKey: 'qq:group:30003', memoryArchive: 'episode/30003', source: 'qq.group',
      messageId: '42', accountId: '20002', text: '看这句',
      replyTo: { messageId: '9', sender: { id: '10086', nickname: '前人' }, text: '原话', resolved: true },
    };
    expect(isAstrBotQqMessage(message)).toBe(true);
    expect(isAstrBotQqMessage({ ...message, version: 2 })).toBe(false);
    expect(toConversationQuote(message as AstrBotQqMessage)).toEqual({
      speaker: { id: '10086', displayName: '前人' }, text: '原话', available: true,
    });
    expect(toConversationQuote({ ...message, replyTo: { messageId: '9', text: '秘密', resolved: false } } as AstrBotQqMessage))
      .toEqual({ text: '', available: false });
  });
});
