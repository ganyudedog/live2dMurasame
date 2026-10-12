import { describe, expect, it } from 'vitest';
import { SentenceStreamParser, type SentenceStreamEvent } from '../domain/replyParser';

describe('unified sentence streaming parser', () => {
  it('reports closed speech, closed translation and completed sentence separately with one id', () => {
    const parser = new SentenceStreamParser();
    expect(parser.push('{"speak_text":"Japanese","display_text":"Chi')).toEqual([
      { type: 'speech-ready', sentenceIndex: 0, speakText: 'Japanese' },
    ]);
    expect(parser.push('nese",')).toEqual([
      { type: 'display-ready', sentenceIndex: 0, displayText: 'Chinese' },
    ]);
    expect(parser.push('"action_intent":{"kind":"blink"}}')).toEqual([
      { type: 'sentence-complete', sentence: { sentenceIndex: 0, speakText: 'Japanese', displayText: 'Chinese',
        actionIntent: { kind: 'blink' } } },
    ]);
    expect(parser.push('')).toEqual([]);
  });

  it('waits for complete escapes and decodes Unicode and quoted content correctly', () => {
    const parser = new SentenceStreamParser();
    expect(parser.push('{"speak_text":"say \\"hello')).toEqual([]);
    expect(parser.push('\\"","display_text":"\\u4f')).toEqual([
      { type: 'speech-ready', sentenceIndex: 0, speakText: 'say "hello"' },
    ]);
    expect(parser.push('60\\u597d"}')).toMatchObject([
      { type: 'display-ready', sentenceIndex: 0, displayText: '你好' },
      { type: 'sentence-complete', sentence: { sentenceIndex: 0, displayText: '你好' } },
    ]);
  });

  it('numbers business sentences continuously across fences, blank lines and records without text', () => {
    const parser = new SentenceStreamParser();
    const events = parser.push('```json\n\n{}\n{"action_intent":{"kind":"blink"}}\n'
      + '{"speak_text":"first"}\n\n{"speak_text":"second"}\n```');
    expect(events.filter((event) => event.type === 'speech-ready').map((event) => event.sentenceIndex)).toEqual([0, 1]);
    expect(events.filter((event) => event.type === 'sentence-complete').map((event) => event.sentence.sentenceIndex)).toEqual([0, 1]);
  });

  it('ignores nested fields and field-like content inside strings', () => {
    const parser = new SentenceStreamParser();
    const speakText = 'literal {"display_text":"fake"}';
    const events = parser.push(JSON.stringify({ meta: { speak_text: 'wrong', display_text: 'wrong' },
      speak_text: speakText, display_text: 'correct' }));
    expect(events).toMatchObject([
      { type: 'speech-ready', sentenceIndex: 0, speakText },
      { type: 'display-ready', sentenceIndex: 0, displayText: 'correct' },
      { type: 'sentence-complete', sentence: { sentenceIndex: 0, speakText, displayText: 'correct' } },
    ]);
  });

  it('produces identical ordered events at every possible chunk boundary, including formatted JSON', () => {
    const source = '\n```json\n' + JSON.stringify({ speak_text: 'say "hello" \\ 你好', display_text: '译文',
      action_intent: { kind: 'blink', reason: 'nested } text' } }, null, 2)
      + '\n\n' + JSON.stringify({ displayText: 'second', speakText: 'voice' }) + '\n```';
    const expected = new SentenceStreamParser().push(source);
    expect(expected).toHaveLength(6);
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
