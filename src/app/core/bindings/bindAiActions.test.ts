import { describe, expect, it, vi } from 'vitest';
import { bindAiActions } from './bindAiActions';
import { Live2dActionService } from '@app/modules/live2d/modules/actions/service/Live2dActionService';
import type { AiService } from '@app/modules/ai/service/AiService';
import type { AiActionEvent, AiDialogueEvent } from '@app/modules/ai/types';
import type { TtsService } from '@app/modules/ai/modules/tts/service/TtsService';
import type { TtsPlaybackEvent } from '@app/modules/ai/modules/tts/domain/types';
import type { Live2dService } from '@app/modules/live2d/service/Live2dService';

describe('AI action composition binding', () => {
  it('connects events, rejects old-model audio and releases every subscription', () => {
    let dialogue!: (event: AiDialogueEvent) => void;
    let action!: (event: AiActionEvent) => void;
    let playback!: (event: TtsPlaybackEvent) => void;
    let audio!: (level: number | null) => void;
    const disposers = Array.from({ length: 4 }, () => vi.fn());
    const ai = {
      onDialogue: (listener: typeof dialogue) => { dialogue = listener; return disposers[0]; },
      onAction: (listener: typeof action) => { action = listener; return disposers[1]; },
    };
    const tts = {
      onPlayback: (listener: typeof playback) => { playback = listener; return disposers[2]; },
      onAudioLevel: (listener: typeof audio) => { audio = listener; return disposers[3]; },
    };
    const actions = new Live2dActionService();
    const scheduler = actions.sentenceActionScheduler;
    const begin = vi.spyOn(scheduler, 'begin');
    const receive = vi.spyOn(scheduler, 'receive');
    const observePlayback = vi.spyOn(scheduler, 'playback');
    const clear = vi.spyOn(scheduler, 'clear');
    const dispatch = vi.spyOn(actions, 'dispatch').mockReturnValue({ ok: true, state: 'started' });
    const setLevel = vi.spyOn(actions, 'setAudioLevel');
    const off = bindAiActions(ai as unknown as AiService,
      tts as unknown as TtsService, { actions } as Live2dService);
    dialogue({ type: 'started', conversationId: 'turn' });
    expect(begin).toHaveBeenCalledWith('turn');
    action({ conversationId: 'turn', requestId: 's0', modelVersion: 0, hasSpeech: true,
      intent: { actionId: 'cheek' } });
    expect(receive).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalled();
    playback({ queueGroupId: 'turn', requestId: 's0', state: 'started', transport: 'livekit' });
    expect(observePlayback).toHaveBeenCalledWith('turn', 's0', 'started', undefined);
    expect(dispatch).toHaveBeenCalledOnce();
    audio(0.4);
    expect(setLevel).toHaveBeenLastCalledWith(0.4);
    actions.attach(null);
    expect(clear).toHaveBeenLastCalledWith('model-detached');
    audio(0.5);
    expect(setLevel).toHaveBeenLastCalledWith(null);
    off();
    expect(clear).toHaveBeenLastCalledWith('binding-disposed');
    expect(actions.sentenceActionScheduler).toBe(scheduler);
    disposers.forEach((dispose) => expect(dispose).toHaveBeenCalledOnce());
    actions.dispose();
  });
});

