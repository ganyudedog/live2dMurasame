import { observable, observableRef, runInAction } from 'mobx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindAiPresentation } from './bindAiPresentation';
import { BubbleDialogueService } from '@app/modules/live2d/modules/bubble/service/BubbleDialogueService';
import { Live2dActionService } from '@app/modules/live2d/modules/actions/service/Live2dActionService';
import type { AiService } from '@app/modules/ai/service/AiService';
import type { AiDialogueEvent, AiActionEvent } from '@app/modules/ai/types';
import type { Live2dService } from '@app/modules/live2d/service/Live2dService';
import type { TtsService } from '@app/modules/ai/modules/tts/service/TtsService';
import type { TtsPlaybackEvent } from '@app/modules/ai/modules/tts/domain/types';

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const setup = (speech = true, warmupFailed = false) => {
  const dialogues = new Set<(event: AiDialogueEvent) => void>();
  const intents = new Set<(event: AiActionEvent) => void>();
  const subscribe = <T,>(set: Set<T>, listener: T) => { set.add(listener); return () => { set.delete(listener); }; };
  const ai = { onDialogue: (listener: (event: AiDialogueEvent) => void) => subscribe(dialogues, listener),
    onAction: (listener: (event: AiActionEvent) => void) => subscribe(intents, listener) };
  const tts = observable({ warmupFailed,
    playbackEvent: null as TtsPlaybackEvent | null,
    onAudioLevel: () => () => undefined }, { playbackEvent: observableRef, onAudioLevel: false });
  const dialogue = new BubbleDialogueService();
  const actions = new Live2dActionService();
  const dispatch = vi.spyOn(actions, 'dispatch').mockReturnValue({ ok: true, state: 'started' });
  const off = bindAiPresentation(ai as unknown as AiService,
    { dialogue, actions, setMotionText: vi.fn() } as unknown as Live2dService,
    speech ? tts as unknown as TtsService : undefined);
  const emit = (event: AiDialogueEvent) => dialogues.forEach((listener) => listener(event));
  const play = (requestId: string, state: TtsPlaybackEvent['state'], queueGroupId = 'chat') =>
    runInAction(() => { tts.playbackEvent = { requestId, state, queueGroupId, transport: 'livekit' }; });
  const sentence = (requestId: string, text = requestId) => {
    emit({ type: 'sentence', conversationId: 'chat', requestId, text, hasSpeech: speech });
    intents.forEach((listener) => listener({ conversationId: 'chat', requestId, hasSpeech: speech,
      intent: { actionId: requestId } }));
  };
  const measure = async () => {
    await flush();
    while (dialogue.measurementRequest) {
      const request = dialogue.measurementRequest;
      dialogue.submitMeasurement({ ...request, width: 200, height: 60, lineCount: 2 });
      await flush();
    }
  };
  emit({ type: 'started', conversationId: 'chat' });
  return { dialogue, dispatch, emit, play, sentence, measure,
    recover: () => runInAction(() => { tts.warmupFailed = false; }),
    dispose: () => { off(); off(); actions.dispose(); dialogue.dispose();
      expect([dialogues.size, intents.size]).toEqual([0, 0]); } };
};

describe('shared sentence presentation lifecycle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { expect(vi.getTimerCount()).toBe(0); vi.useRealTimers(); });

  it('keeps actions and text waiting after LLM completion until their TTS starts', async () => {
    const s = setup();
    s.sentence('s0'); s.sentence('s1');
    s.emit({ type: 'completed', conversationId: 'chat' });
    await s.measure();
    await vi.advanceTimersByTimeAsync(20000);
    expect(s.dialogue.text).toBeNull(); expect(s.dispatch).not.toHaveBeenCalled();
    s.play('s0', 'started');
    expect(s.dialogue.activeRequestId).toBe('s0'); expect(s.dispatch).toHaveBeenCalledTimes(1);
    s.dialogue.configure(240, 1);
    await s.measure();
    expect(s.dispatch).toHaveBeenCalledTimes(1);
    s.play('s0', 'finished'); s.play('s1', 'started');
    expect(s.dialogue.activeRequestId).toBe('s1'); expect(s.dispatch).toHaveBeenCalledTimes(2);
    s.play('s1', 'finished');
    await vi.advanceTimersByTimeAsync(7000);
    expect(s.dialogue.text).toBeNull();
    s.dispose();
  });

  it.each([false, true])('paces text and actions together without usable TTS (runtime=%s)', async (speech) => {
    const s = setup(speech, true);
    s.sentence('s0'); s.sentence('s1');
    s.emit({ type: 'completed', conversationId: 'chat' });
    await s.measure();
    expect(s.dialogue.activeRequestId).toBe('s0'); expect(s.dispatch).toHaveBeenCalledTimes(1);
    s.recover(); s.play('s1', 'started');
    await vi.advanceTimersByTimeAsync(1799);
    expect(s.dialogue.activeRequestId).toBe('s0');
    await vi.advanceTimersByTimeAsync(1);
    expect(s.dialogue.activeRequestId).toBe('s1'); expect(s.dispatch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(8800);
    expect(s.dialogue.text).toBeNull(); s.dispose();
  });

  it('falls back on failure before start, preserves order, and ignores late events after cancellation', async () => {
    const s = setup(); s.sentence('s0'); s.sentence('s1'); await s.measure();
    s.play('s1', 'error');
    expect(s.dialogue.text).toBeNull();
    s.play('s0', 'error');
    expect(s.dialogue.activeRequestId).toBe('s0'); expect(s.dispatch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1800);
    expect(s.dialogue.activeRequestId).toBe('s1'); expect(s.dispatch).toHaveBeenCalledTimes(2);
    s.emit({ type: 'cancelled', conversationId: 'chat' });
    s.emit({ type: 'started', conversationId: 'next' });
    s.play('s0', 'started'); s.play('s1', 'error');
    expect(s.dialogue.text).toBeNull(); expect(s.dialogue.conversationId).toBe('next');
    s.dispose();
  });
});
