import { describe, expect, it } from 'vitest';
import { parseStage2Reply, SentenceStreamParser, type SentenceStreamEvent } from '../domain/replyParser';

describe('complete reply parsing', () => {
  const first = JSON.stringify({ speak_text: 'こんばんは。', display_text: '晚上好。',
    action_intent: { action_id: ['wink_left'] } });
  const second = JSON.stringify({ speak_text: '今日はどうだった？', display_text: '今天过得怎么样？' });

  it('joins all sentences and keeps the last action', () => {
    expect(parseStage2Reply(`{"sentences":[${first},${second}]}`)).toMatchObject({
      speak_text: 'こんばんは。今日はどうだった？', display_text: '晚上好。\n今天过得怎么样？',
      action_intent: { actionId: ['wink_left'] },
    });
  });

  it.each([first, `${first}\n${second}`, `{"sentences":[${first},`, 'plain text', '{}',
    '{"sentences":[]}', '{"sentences":[{"speak_text":"voice"}]}', '{"sentences":[null]}'])('rejects %s', raw => {
    expect(() => parseStage2Reply(raw)).toThrow();
  });
  it('reports closed speech, closed translation and completed sentence separately with one id', () => {
    const parser = new SentenceStreamParser();
    expect(parser.push('{"sentences":[{"speak_text":"Japanese","display_text":"Chi')).toEqual([
      { type: 'speech-ready', sentenceIndex: 0, speakText: 'Japanese' },
    ]);
    expect(parser.push('nese",')).toEqual([
      { type: 'display-ready', sentenceIndex: 0, displayText: 'Chinese' },
    ]);
    expect(parser.push('"action_intent":{"action_id":"turn-head"}}')).toEqual([
      { type: 'sentence-complete', sentence: { sentenceIndex: 0, speakText: 'Japanese', displayText: 'Chinese',
        actionIntent: { actionId: 'turn-head' } } },
    ]);
    expect(parser.push('')).toEqual([]);
  });

  it('waits for complete escapes and decodes Unicode and quoted content correctly', () => {
    const parser = new SentenceStreamParser();
    expect(parser.push('{"sentences":[{"speak_text":"say \\"hello')).toEqual([]);
    expect(parser.push('\\"","display_text":"\\u4f')).toEqual([
      { type: 'speech-ready', sentenceIndex: 0, speakText: 'say "hello"' },
    ]);
    expect(parser.push('60\\u597d"}')).toMatchObject([
      { type: 'display-ready', sentenceIndex: 0, displayText: '你好' },
      { type: 'sentence-complete', sentence: { sentenceIndex: 0, displayText: '你好' } },
    ]);
  });

  it('ignores nested fields and field-like content inside strings', () => {
    const parser = new SentenceStreamParser();
    const speakText = 'literal {"display_text":"fake"}';
    const events = parser.push(JSON.stringify({ sentences: [{ meta: { speak_text: 'wrong', display_text: 'wrong' },
      speak_text: speakText, display_text: 'correct' }] }));
    expect(events).toMatchObject([
      { type: 'speech-ready', sentenceIndex: 0, speakText },
      { type: 'display-ready', sentenceIndex: 0, displayText: 'correct' },
      { type: 'sentence-complete', sentence: { sentenceIndex: 0, speakText, displayText: 'correct' } },
    ]);
  });

  it('produces identical ordered events at every possible chunk boundary, including formatted JSON', () => {
    const source = JSON.stringify({ sentences: [{ speak_text: 'say "hello" 你好', display_text: '译文',
      action_intent: { action_id: [['turn-head', 'blush'], 'blink'], reason: 'nested } text' } },
      { display_text: 'second', speak_text: 'voice' }] }, null, 2);
    const expected = new SentenceStreamParser().push(source);
    expect(expected).toHaveLength(6);
    expect(expected[2]).toMatchObject({ type: 'sentence-complete', sentence: {
      actionIntent: { actionId: [['turn-head', 'blush'], 'blink'] },
    } });
    for (let split = 0; split <= source.length; split++) {
      const parser = new SentenceStreamParser();
      expect([...parser.push(source.slice(0, split)), ...parser.push(source.slice(split))]).toEqual(expected);
    }
    const parser = new SentenceStreamParser();
    const characterEvents: SentenceStreamEvent[] = [];
    for (const char of source) characterEvents.push(...parser.push(char));
    expect(characterEvents).toEqual(expected);
  });
});
