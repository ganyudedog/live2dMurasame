import { describe, expect, it } from 'vitest';
import { resolveEpisodeQuery } from '../domain/memory/episodeQuery';

const now = new Date('2026-10-20T12:00:00+08:00').getTime();

describe('episode query resolver', () => {
  it('searches retained history without inventing a date for vague references', () => {
    const result = resolveEpisodeQuery('之前说过旅行计划吗', now);
    expect(result).toMatchObject({ status: 'resolved', query: '旅行计划', approximate: true });
    expect(result.dates).toHaveLength(8);
    expect(result.dates.at(-1)).toBe('2026-10-13');
    expect(resolveEpisodeQuery('我之前说了什么', now).query).toBe('');
  });
  it('resolves exact relative dates without an LLM call', () => {
    expect(resolveEpisodeQuery('我前天说了什么', now)).toMatchObject({
      status: 'resolved', dates: ['2026-10-18'], query: '', approximate: false,
    });
    expect(resolveEpisodeQuery('我两天前提到过生日吗', now)).toMatchObject({
      status: 'resolved', dates: ['2026-10-18'], query: '生日', speaker: 'user',
    });
    expect(resolveEpisodeQuery('昨天发生了什么', now)).toMatchObject({
      status: 'resolved', dates: ['2026-10-19'], query: '', approximate: false,
    });
  });

  it('resolves approximate ranges and keeps them inside seven days', () => {
    expect(resolveEpisodeQuery('前几天我说过旅行计划吗', now)).toMatchObject({
      status: 'resolved', dates: ['2026-10-19', '2026-10-18', '2026-10-17'], query: '旅行计划', approximate: true,
    });
  });

  it('does not treat ordinary conversation as an episode query', () => {
    expect(resolveEpisodeQuery('今天好累，想休息一下', now).status).toBe('none');
    expect(resolveEpisodeQuery('两周前我说了什么', now)).toMatchObject({ status: 'expired', dates: [] });
  });
});
