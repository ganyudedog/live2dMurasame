import type { AiService } from '@app/modules/ai/service/AiService';
import type { TtsService } from '@app/modules/ai/modules/tts/service/TtsService';
import type { Live2dService } from '@app/modules/live2d/service/Live2dService';

export const bindAiActions = (ai: AiService, tts: TtsService | undefined, live2d: Live2dService): (() => void) => {
  const actions = live2d.actions;
  // 只取得所属动作服务的子服务，组合绑定只负责跨服务订阅，不创建业务实例。
  const scheduler = actions.sentenceActionScheduler;
  let conversationId: string | null = null;
  let conversationModelVersion = actions.getCapability().modelVersion;
  const offDialogue = ai.onDialogue((event) => {
    if (event.type === 'started') {
      conversationId = event.conversationId;
      conversationModelVersion = actions.getCapability().modelVersion;
      scheduler.begin(event.conversationId);
    }
    else if (event.type === 'cancelled' && event.conversationId === conversationId) {
      scheduler.clear('conversation-cancelled');
      conversationId = null;
    }
    // Text completion seals input; presentation owns the remaining queue.
  });
  // 运行时版本只在执行端补齐，AI 无需解析 Live2dService。
  const offAction = ai.onAction((event) => scheduler.receive({ ...event, deferUntilPresentation: true, modelVersion: conversationModelVersion }));
  // 与 TTS 共用 requestId；动作不维护第二条音频队列，也不延迟播放。
  const offPlayback = live2d.dialogue.onPresentation((event) => {
    if (event.conversationId !== conversationId) return;
    if (event.state === 'cleared') {
      scheduler.clear('presentation-cleared');
      conversationId = null;
    } else scheduler.playback(event.conversationId, event.requestId, event.state);
  });
  const offAudio = tts?.onAudioLevel((level) => {
    // 模型切换后，旧对话音轨仍可能送出尾部采样，不能驱动新模型的嘴。
    actions.setAudioLevel(conversationModelVersion === actions.getCapability().modelVersion ? level : null);
  }) ?? (() => undefined);
  return () => {
    offDialogue(); offAction(); offPlayback(); offAudio();
    scheduler.clear('binding-disposed');
    actions.setAudioLevel(null);
  };
};
