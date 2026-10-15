import type { AiService } from '@app/modules/ai/service/AiService';
import type { TtsService } from '@app/modules/ai/modules/tts/service/TtsService';
import type { Live2dService } from '@app/modules/live2d/service/Live2dService';

export const bindAiActions = (ai: AiService, tts: TtsService, live2d: Live2dService): (() => void) => {
  const actions = live2d.actions;
  // 只取得所属动作服务的子服务，组合绑定只负责跨服务订阅，不创建业务实例。
  const scheduler = actions.sentenceActionScheduler;
  let audioModelVersion = actions.getCapability().modelVersion;
  const offDialogue = ai.onDialogue((event) => {
    if (event.type === 'started') {
      audioModelVersion = actions.getCapability().modelVersion;
      scheduler.begin(event.conversationId);
    }
    else if (event.type === 'cancelled') scheduler.clear('conversation-cancelled');
    else if (event.type === 'completed') scheduler.complete(event.conversationId);
  });
  const offAction = ai.onAction((event) => scheduler.receive(event));
  // 与 TTS 共用 requestId；动作不维护第二条音频队列，也不延迟播放。
  const offPlayback = tts.onPlayback((event) => scheduler.playback(event.queueGroupId, event.requestId, event.state, event.reason));
  const offAudio = tts.onAudioLevel((level) => {
    // 模型切换后，旧对话音轨仍可能送出尾部采样，不能驱动新模型的嘴。
    actions.setAudioLevel(audioModelVersion === actions.getCapability().modelVersion ? level : null);
  });
  return () => {
    offDialogue(); offAction(); offPlayback(); offAudio();
    scheduler.clear('binding-disposed');
    actions.setAudioLevel(null);
  };
};
