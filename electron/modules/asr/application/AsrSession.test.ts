import { describe, expect, it, vi } from 'vitest';
import { createAsrSession } from './AsrSession.js';

const frame = () => new Float32Array(512);
const setup = () => {
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
  const session = createAsrSession({ recognizer, vad, emit, sessionId: 'session' });
  return { session, emit, stream, recognizer, vad,
    feed(speech: boolean, nextText = '', isEndpoint = false) {
      if (detected && !speech) hasSegment = true;
      detected = speech;
      text = nextText;
      endpoint = isEndpoint;
      session.accept(frame());
    },
  };
};

describe('VAD-driven ASR turn state', () => {
  it('finishes a held turn exactly once without waiting for trailing silence', () => {
    const { session, feed, emit, vad } = setup();
    feed(true, '松开前最后一句');
    session.finish(); session.finish();
    expect(emit.mock.calls.filter(([event]) => event.type === 'asr.final')).toEqual([
      [expect.objectContaining({ text: '松开前最后一句' })],
    ]);
    expect(vad.reset).toHaveBeenCalledTimes(2);
  });
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
      [expect.objectContaining({ type: 'asr.final', text: 'hello world!' })],
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

});
