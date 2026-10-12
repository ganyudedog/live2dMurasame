import { describe, expect, it, vi } from 'vitest';
import { bindAiBubble } from './bindAiBubble';
import { BubbleDialogueService } from '@app/modules/live2d/modules/bubble/service/BubbleDialogueService';
import type { AiDialogueEvent } from '@app/modules/ai/types';
import type { TtsPlaybackEvent } from '@app/modules/ai/modules/tts/domain/types';
import type { AiService } from '@app/modules/ai/service/AiService';
import type { TtsService } from '@app/modules/ai/modules/tts/service/TtsService';
import type { Live2dService } from '@app/modules/live2d/service/Live2dService';

describe('AI bubble binding', () => {
  it('isolates conversations, forwards only matching playback and releases both subscriptions', () => {
    let aiEvent!: (event: AiDialogueEvent) => void;
    let ttsEvent!: (event: TtsPlaybackEvent) => void;
    const offAi = vi.fn();
    const offTts = vi.fn();
    const ai = { onDialogue: (listener: typeof aiEvent) => { aiEvent = listener; return offAi; } };
    const tts = { onPlayback: (listener: typeof ttsEvent) => { ttsEvent = listener; return offTts; } };
    const dialogue = new BubbleDialogueService();
    const playback = vi.spyOn(dialogue, 'onPlayback');
    const live2d = { dialogue, setMotionText: vi.fn() };
    const off = bindAiBubble(ai as unknown as AiService, tts as unknown as TtsService, live2d as unknown as Live2dService);
    aiEvent({ type: 'started', conversationId: 'chat' });
    expect(live2d.setMotionText).toHaveBeenCalledWith(null);
    aiEvent({ type: 'cancelled', conversationId: 'old' });
    expect(dialogue.conversationId).toBe('chat');
    ttsEvent({ requestId: 'old_s0', queueGroupId: 'old', state: 'started', transport: 'livekit' });
    expect(playback).not.toHaveBeenCalled();
    ttsEvent({ requestId: 'chat_s0', queueGroupId: 'chat', state: 'started', transport: 'livekit' });
    expect(playback).toHaveBeenCalledWith('chat_s0', 'started');
    off();
    expect(offAi).toHaveBeenCalledOnce();
    expect(offTts).toHaveBeenCalledOnce();
    expect(dialogue.conversationId).toBeNull();
  });
});
