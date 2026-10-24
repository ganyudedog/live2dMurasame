import { describe, expect, it } from 'vitest';
import { buildRecentConversation, distinctRecallText } from '../domain/memory/recentConversation';

const turn = (n: number): PetMemoryTurn => ({ date: '2026-10-23', time: '12:00', conversationCount: n,
  userText: `问题${n}`, assistantText: `回复${n}`, sender: { id: String(n) } });

describe('recent conversation window', () => {
  it('keeps ten turns and their speakers in chronological order', () => {
    const recent = buildRecentConversation(Array.from({ length: 12 }, (_, n) => turn(n)));
    expect(recent.turns.map((item) => item.conversationCount)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(recent.historyMessages).toHaveLength(20);
    expect(recent.historyMessages[0].content).toContain('"id":"2"');
    expect(recent.historyMessages[1]).toEqual({ role: 'assistant', content: '回复2' });
  });
  it('drops oldest complete pairs to fit the budget and deduplicates recalled episodes', () => {
    const one = buildRecentConversation([turn(1)]);
    const budget = one.historyMessages.reduce((sum, item) => sum + item.content.length, 0);
    const recent = buildRecentConversation([turn(0), turn(1)], budget);
    expect(recent.turns).toEqual([turn(1)]);
    expect(recent.omittedTurns).toBe(1);
    const text = distinctRecallText({ text: 'duplicate', matches: [turn(0), turn(1)] }, recent.turns);
    expect(text).toContain('问题0');
    expect(text).not.toContain('问题1');
  });
});
