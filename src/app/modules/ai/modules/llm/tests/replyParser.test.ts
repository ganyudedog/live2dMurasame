import { describe, expect, it, vi } from 'vitest';
import { parseStage2Reply, SentenceStreamParser, type SentenceStreamEvent } from '../domain/replyParser';

describe('complete reply parsing', () => {
  const first = JSON.stringify({ speak_text: 'こんばんは。', display_text: '晚上好。',
    action_intent: { action_id: ['wink_left'] } });
  const second = JSON.stringify({ speak_text: '今日はどうだった？', display_text: '今天过得怎么样？' });

  it.each([
    ['plain JSON Lines', `${first}\n${second}`],
    ['CRLF and blank lines', ` \r\n${first}\r\n\r\n${second}\r\n `],
    ['fenced JSON Lines', `\x60\x60\x60json\n${first}\n${second}\n\x60\x60\x60`],
  ])('merges every sentence from %s after streaming completes', (_name, rawText) => {
    const diagnose = vi.fn();
    expect(parseStage2Reply(rawText, diagnose)).toMatchObject({
      speak_text: 'こんばんは。今日はどうだった？',
      display_text: '晚上好。\n今天过得怎么样？',
      action_intent: { actionId: ['wink_left'] },
    });
    expect(diagnose).toHaveBeenCalledExactlyOnceWith({ state: 'json-lines', recordCount: 2, skippedLineCount: 0 });
  });

  it('preserves metadata on a single formatted JSON object', () => {
    const reply = { speak_text: 'hello', display_text: '你好', request_id: 'chat', meta: { model: 'model' } };
    expect(parseStage2Reply(JSON.stringify(reply, null, 2))).toEqual(reply);
  });

  it('keeps valid JSON Lines when another record is malformed', () => {
    const diagnose = vi.fn();
    expect(parseStage2Reply(`${first}\n{"speak_text":\n${second}`, diagnose)).toMatchObject({
      speak_text: 'こんばんは。今日はどうだった？', display_text: '晚上好。\n今天过得怎么样？',
    });
    expect(diagnose).toHaveBeenCalledWith({ state: 'dropped', lineNumber: 2, reason: 'invalid-json', message: expect.any(String) });
    expect(diagnose).toHaveBeenLastCalledWith({ state: 'json-lines', recordCount: 2, skippedLineCount: 1 });
  });

  it.each(['not JSON', '{"speak_text":', '{"speak_text":42}'])('rejects unusable replies: %s', (rawText) => {
    expect(() => parseStage2Reply(rawText, vi.fn())).toThrow('LLM 输出不是合法 JSON');
  });

  it('retains the original parse failure when no usable reply exists', () => {
    let failure: unknown;
    try { parseStage2Reply('{"speak_text":', vi.fn()); }
    catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).cause).toBeInstanceOf(SyntaxError);
  });

  it('reports a broken diagnostic subscriber without losing valid sentences', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const error = new Error('logger unavailable');
      expect(parseStage2Reply(`${first}\n${second}`, () => { throw error; }))
        .toMatchObject({ display_text: '晚上好。\n今天过得怎么样？' });
      expect(warn).toHaveBeenCalledWith(expect.any(String),
        { state: 'json-lines', recordCount: 2, skippedLineCount: 0 }, error);
    } finally { warn.mockRestore(); }
  });
});

describe('unified sentence streaming parser', () => {
  it('diagnoses standalone, malformed and truncated actions without consuming sentence IDs', () => {
    const diagnose = vi.fn();
    const parser = new SentenceStreamParser(diagnose);
    const actionId = 'smile';
    const events = parser.push(JSON.stringify({ action_intent: { action_id: actionId } }) + '\n'
      + JSON.stringify({ speak_text: 'voice', action_intent: { action_id: actionId } }) + '\n'
      + '{"display_text":"text","action_intent":{"action_id":42}}\n'
      + '{"speak_text":"truncated","action_intent":{"action_id":"');
    parser.finish();
    expect(diagnose.mock.calls.map(([diagnostic]) => diagnostic)).toEqual([
      { state: 'dropped', reason: 'missing-sentence-text', actionId },
      { state: 'parsed', sentenceIndex: 0, actionId },
      { state: 'dropped', reason: 'invalid-action', sentenceIndex: 1 },
      { state: 'dropped', reason: 'incomplete-json', sentenceIndex: 2 },
    ]);
    expect(events.filter((event) => event.type === 'sentence-complete').map((event) => event.sentence.sentenceIndex)).toEqual([0, 1]);
  });

  it('keeps speech streaming even when the diagnostic subscriber fails', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const error = new Error('logging unavailable');
      const parser = new SentenceStreamParser(() => { throw error; });
      expect(parser.push('{"speak_text":"voice","action_intent":{"action_id":"smile"}}'))
        .toMatchObject([{ type: 'speech-ready' }, { type: 'sentence-complete', sentence: { speakText: 'voice' } }]);
      expect(warn).toHaveBeenCalledWith(expect.any(String), error);
    } finally { warn.mockRestore(); }
  });

  it('accepts valid text without an action and isolates malformed action fields', () => {
    expect(parseStage2Reply('{"speak_text":"voice","display_text":"text"}').action_intent).toBeUndefined();
    for (const action of [null, "bad", { action_id: 42 }]) {
      const source = JSON.stringify({ speak_text: 'voice', display_text: 'text', action_intent: action });
      expect(parseStage2Reply(source)).toMatchObject({ speak_text: 'voice', display_text: 'text', action_intent: undefined });
      expect(new SentenceStreamParser().push(source).at(-1)).toMatchObject({
        type: 'sentence-complete', sentence: { speakText: 'voice', actionIntent: undefined },
      });
    }
  });

  it('drops an action with an invalid action ID', () => {
    expect(parseStage2Reply('{"speak_text":"voice","action_intent":{"action_id":42}}').action_intent).toBeUndefined();
  });
  it('reports closed speech, closed translation and completed sentence separately with one id', () => {
    const parser = new SentenceStreamParser();
    expect(parser.push('{"speak_text":"Japanese","display_text":"Chi')).toEqual([
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
    const events = parser.push('```json\n\n{}\n{"action_intent":{"action_id":"turn-head"}}\n'
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
      action_intent: { action_id: [['turn-head', 'blush'], 'blink'], reason: 'nested } text' } }, null, 2)
      + '\n\n' + JSON.stringify({ displayText: 'second', speakText: 'voice' }) + '\n```';
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
