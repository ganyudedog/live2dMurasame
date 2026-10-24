import { describe, expect, it } from 'vitest';
import { normalizeAstrBotSender } from './protocol';

describe('AstrBot sender identity', () => {
  it.each(['2655314552', 2655314552])('retains QQ id %s from the bridge payload', (user_id) => {
    expect(normalizeAstrBotSender({ user_id, nickname: '南柯一梦' }))
      .toEqual({ id: '2655314552', displayName: '南柯一梦' });
  });
  it('accepts canonical ids and skips empty aliases', () => {
    expect(normalizeAstrBotSender({ id: '', user_id: 2655314552 })).toEqual({ id: '2655314552' });
    expect(normalizeAstrBotSender({ id: '2655314552' })).toEqual({ id: '2655314552' });
  });
  it('does not invent missing or unsafe identifiers', () => {
    expect(normalizeAstrBotSender(undefined)).toBeUndefined();
    expect(normalizeAstrBotSender({ user_id: Number.MAX_SAFE_INTEGER + 1 })).toBeUndefined();
  });
});
