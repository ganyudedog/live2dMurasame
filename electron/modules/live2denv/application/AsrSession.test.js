import { describe, expect, it, vi } from 'vitest';
import { createAsrSession } from './AsrSession.js';

const frame = () => new Float32Array(512);
const setup = (options = {}) => {
  let detected = false;
  let text = '';
  let endpoint = false;
  const emit = vi.fn();
  const stream = { acceptWaveform: vi.fn(), inputFinished: vi.fn() };
  const recognizer = {
    createStream: vi.fn(() => stream), isReady: () => false, decode: vi.fn(),
    getResult: () => ({ text }), isEndpoint: () => endpoint,
    reset: vi.fn(() => { text = ''; endpoint = false; }),
  };
  let hasSegment = false;
  const vad = {
    acceptWaveform: vi.fn(), isDetected: () => detected,
    isEmpty: () => !hasSegment, pop: () => { hasSegment = false; },
    front: vi.fn(() => ({ samples: Float32Array.of(0.1, 0.2) })), reset: vi.fn(),
  };
  const session = createAsrSession({ recognizer, vad, emit, sessionId: 'session', ...options });
  return { session, emit, stream, recognizer, vad,
    feed(speech, nextText = '', isEndpoint = false) {
      if (detected && !speech) hasSegment = true;
      detected = speech;
      text = nextText;
      endpoint = isEndpoint;
      session.accept(frame());
    },
  };
};

describe('VAD-driven ASR turn state', () => {
  it('interrupts immediately on confirmed speech and waits for VAD end to publish final', () => {
    const { feed, emit, recognizer, stream } = setup();
    feed(false);
    feed(false);
    feed(true, 'hello');
    expect(emit.mock.calls[0][0]).toMatchObject({ type: 'asr.speech-start', utteranceId: 'session_0' });
    expect(stream.acceptWaveform).toHaveBeenCalledTimes(3);
    feed(true, 'hello world', true);
    expect(recognizer.reset).toHaveBeenCalledOnce();
    expect(emit.mock.calls.some(([e]) => e.type === 'asr.final')).toBe(false);
    feed(false, '!');
    expect(emit.mock.calls.filter(([e]) => e.type === 'asr.final')).toEqual([
      [expect.objectContaining({ type: 'asr.final', text: 'hello world!', refined: false })],
    ]);
    expect(stream.inputFinished).toHaveBeenCalledOnce();
  });

  it('replaces revised partial hypotheses rather than concatenating them', () => {
    const { feed, emit } = setup();
    feed(true, 'recognition A');
    feed(true, 'recognition B');
    feed(false, 'recognition B');
    expect(emit).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'asr.final', text: 'recognition B' }));
  });

  it('does not decode noise before Silero confirms speech and emits nothing after disposal', () => {
    const { feed, session, emit, stream } = setup();
    feed(false, 'noise');
    expect(stream.acceptWaveform).not.toHaveBeenCalled();
    session.dispose();
    feed(true, 'late');
    expect(emit).not.toHaveBeenCalled();
  });

  it('buffers incomplete windows without losing samples', () => {
    const { session, vad } = setup();
    session.accept(new Float32Array(300));
    expect(vad.acceptWaveform).not.toHaveBeenCalled();
    session.accept(new Float32Array(300));
    expect(vad.acceptWaveform).toHaveBeenCalledOnce();
    session.accept(new Float32Array(424));
    expect(vad.acceptWaveform).toHaveBeenCalledTimes(2);
  });

  it('requires a final refinement provider for the agent profile', () => {
    expect(() => setup({ profile: 'agent' })).toThrow('高精度');
  });

  it('holds agent input until full audio refinement succeeds', async () => {
    let resolveRefinement;
    const refineFinal = vi.fn(() => new Promise((resolve) => { resolveRefinement = resolve; }));
    const { feed, emit, vad } = setup({ profile: 'agent', refineFinal });
    feed(true, 'draft');
    feed(false, 'draft');
    await vi.waitFor(() => expect(refineFinal).toHaveBeenCalledOnce());
    expect(vad.front).toHaveBeenCalledWith(false);
    expect(refineFinal).toHaveBeenCalledWith(expect.objectContaining({ draftText: 'draft', samples: expect.any(Float32Array), sampleRate: 16000 }));
    expect(emit.mock.calls.some(([e]) => e.type === 'asr.final')).toBe(false);
    resolveRefinement({ text: 'accurate' });
    await vi.waitFor(() => expect(emit).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'asr.final', text: 'accurate', refined: true })));
  });

  it('aborts an old refinement when new speech starts', async () => {
    let resolveRefinement;
    const refineFinal = vi.fn(() => new Promise((resolve) => { resolveRefinement = resolve; }));
    const { feed, emit } = setup({ profile: 'agent', refineFinal });
    feed(true, 'first');
    feed(false, 'first');
    await vi.waitFor(() => expect(refineFinal).toHaveBeenCalledOnce());
    feed(true, 'second');
    expect(refineFinal.mock.calls[0][0].signal.aborted).toBe(true);
    resolveRefinement({ text: 'late' });
    await Promise.resolve();
    await Promise.resolve();
    expect(emit.mock.calls.some(([e]) => e.type === 'asr.final')).toBe(false);
  });

  it('reports refinement failures without submitting the draft to an agent', async () => {
    const { feed, emit } = setup({ profile: 'agent', refineFinal: async () => { throw new Error('refiner offline'); } });
    feed(true, 'draft');
    feed(false, 'draft');
    await vi.waitFor(() => expect(emit).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'asr.error', message: 'refiner offline' })));
    expect(emit.mock.calls.some(([e]) => e.type === 'asr.final')).toBe(false);
  });
});
