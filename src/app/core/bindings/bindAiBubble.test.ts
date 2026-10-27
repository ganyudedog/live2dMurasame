import { observable, observableRef, runInAction } from 'mobx';
import type { TtsService } from '@app/modules/ai/modules/tts/service/TtsService';
import type { TtsPlaybackEvent } from '@app/modules/ai/modules/tts/domain/types';
import { describe, expect, it, vi } from 'vitest';
import { bindAiBubble } from './bindAiBubble';
import { BubbleDialogueService } from '@app/modules/live2d/modules/bubble/service/BubbleDialogueService';
import type { AiDialogueEvent } from '@app/modules/ai/types';
import type { AiService } from '@app/modules/ai/service/AiService';
import type { Live2dService } from '@app/modules/live2d/service/Live2dService';

describe('AI bubble binding', () => {
  it('ignores stale cancellation and releases the active dialogue on disposal', () => {
    let aiEvent!: (event: AiDialogueEvent) => void;
    const offAi = vi.fn();
    const ai = { onDialogue: (listener: typeof aiEvent) => { aiEvent = listener; return offAi; } };
    const dialogue = new BubbleDialogueService();
    const live2d = { dialogue, setMotionText: vi.fn() };
    const off = bindAiBubble(ai as unknown as AiService, live2d as unknown as Live2dService);
    aiEvent({ type: 'started', conversationId: 'chat' });
    expect(live2d.setMotionText).toHaveBeenCalledWith(null);
    aiEvent({ type: 'cancelled', conversationId: 'old' });
    expect(dialogue.conversationId).toBe('chat');
    off();
    expect(offAi).toHaveBeenCalledOnce();
    expect(dialogue.conversationId).toBeNull();
  });

  it('observes availability and every playback transition, and detaches both observers', () => {
    let aiEvent!: (event: AiDialogueEvent) => void;
    const ai = { onDialogue: (listener: typeof aiEvent) => { aiEvent = listener; return () => undefined; } };
    const tts = observable({ warmupFailed: false, playbackEvent: null as TtsPlaybackEvent | null },
      { playbackEvent: observableRef });
    const dialogue = new BubbleDialogueService();
    const availability = vi.spyOn(dialogue, 'setPlaybackRequired');
    const playback = vi.spyOn(dialogue, 'onPlayback');
    const off = bindAiBubble(ai as unknown as AiService,
      { dialogue, setMotionText: vi.fn() } as unknown as Live2dService, tts as unknown as TtsService);
    expect(availability).toHaveBeenLastCalledWith(true);
    aiEvent({ type: 'started', conversationId: 'chat' });
    runInAction(() => {
      tts.playbackEvent = { queueGroupId: 'chat', requestId: 's0', state: 'started', transport: 'livekit' };
      tts.playbackEvent = { queueGroupId: 'chat', requestId: 's0', state: 'finished', transport: 'livekit' };
    });
    expect(playback.mock.calls).toEqual([['s0', 'started'], ['s0', 'finished']]);
    runInAction(() => { tts.warmupFailed = true; });
    expect(availability).toHaveBeenLastCalledWith(false);
    off();
    availability.mockClear(); playback.mockClear();
    runInAction(() => {
      tts.warmupFailed = false;
      tts.playbackEvent = { queueGroupId: 'chat', requestId: 's1', state: 'started', transport: 'livekit' };
    });
    expect(availability).not.toHaveBeenCalled();
    expect(playback).not.toHaveBeenCalled();
    dialogue.dispose();
  });

  it('keeps the dialogue binding usable without a TTS runtime', () => {
    let aiEvent!: (event: AiDialogueEvent) => void;
    const ai = { onDialogue: (listener: typeof aiEvent) => { aiEvent = listener; return () => undefined; } };
    const dialogue = new BubbleDialogueService();
    const live2d = { dialogue, setMotionText: vi.fn() };
    const off = bindAiBubble(ai as unknown as AiService, live2d as unknown as Live2dService);

    aiEvent({ type: 'started', conversationId: 'text-only' });
    aiEvent({ type: 'sentence', conversationId: 'text-only', requestId: 'text-only_s0', text: 'hello' });
    expect(dialogue.conversationId).toBe('text-only');

    off();
    expect(dialogue.conversationId).toBeNull();
  });
});
