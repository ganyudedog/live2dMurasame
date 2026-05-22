import { useCallback, useEffect, useRef } from 'react';
import { createStage2Runtime, type Stage2Runtime } from '../../../../AI/core/stage2Runtime';
import { createFrontendTtsRuntime, type FrontendTtsRuntime } from '../../../../AI/tts/runtime';
import type { PlaybackFeedbackReporter } from '../../../../AI/tts/runtime';
import { sharedStoreClient } from '../../../shared/sharedStoreClient';
import type { ChatConfig, ChatRequest, ChatResponse } from '../../../shared/sharedStateTypes';
import { info, warn, error } from '../../../utils/log';

interface UseChatRuntimeOptions {
  reportPlaybackFeedback: PlaybackFeedbackReporter;
}

interface UseChatRuntimeResult {
  processChatRequest: (request: ChatRequest, config: ChatConfig) => Promise<void>;
}

/**
 * PetCanvas 专用 Chat 运行时 hook。
 *
 * 职责：
 *   ① 管理 Stage2Runtime + TtsRuntime 生命周期
 *   ② processChatRequest：调 LLM → 流式回写 chat.response → TTS 合成
 */
export const useChatRuntime = (options: UseChatRuntimeOptions): UseChatRuntimeResult => {
  const { reportPlaybackFeedback } = options;
  const stage2Ref = useRef<Stage2Runtime | null>(null);
  const ttsRef = useRef<FrontendTtsRuntime | null>(null);
  const processingRef = useRef(false);

  useEffect(() => {
    // PetCanvas 没有 Live2D 动作能力，LLM 回复中的 action intent 直接丢弃
    stage2Ref.current = createStage2Runtime({
      dispatchAction: () => ({ ok: false, state: 'dropped', reason: 'no-capability' }),
      getActionCapability: () => ({ canShakeHead: false, canBlink: false, canMouth: false }),
    });
    ttsRef.current = createFrontendTtsRuntime({ reportPlaybackFeedback });
    return () => {
      try { stage2Ref.current?.dispose(); } catch { /* ignore */ }
      stage2Ref.current = null;
      try { ttsRef.current?.dispose(); } catch { /* ignore */ }
      ttsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const processChatRequest = useCallback(
    async (request: ChatRequest, config: ChatConfig): Promise<void> => {
      if (processingRef.current) return;
      const text = String(request.text ?? '').trim();
      if (!text) return;

      const stage2 = stage2Ref.current;
      if (!stage2) return;

      processingRef.current = true;

      // 标记处理中
      sharedStoreClient.dispatchPatch([{
        path: 'chat.request',
        value: { ...request, status: 'processing' } satisfies ChatRequest,
      }]);

      info('pet.chat', 'request.processing', { id: request.id, source: request.source });

      try {
        // 流式 LLM 请求
        const result = await stage2.ask(text, {
          apiKey: config.apiKey,
          baseURL: config.baseURL,
          onDisplayTextStreaming: (streamingDisplayText: string) => {
            const nextText = String(streamingDisplayText ?? '').trim();
            if (!nextText) return;
            sharedStoreClient.dispatchPatch([{
              path: 'chat.response',
              value: {
                id: request.id, displayText: nextText,
                status: 'streaming', error: null, updatedAt: Date.now(),
              } satisfies ChatResponse,
            }]);
          },
        });

        if (!result?.ok || !result.reply?.speak_text) {
          const message = result?.error ?? '对话请求失败';
          warn('pet.chat', 'request.failed', { id: request.id, err: message });
          sharedStoreClient.dispatchPatch([
            { path: 'chat.request', value: { ...request, status: 'error' } satisfies ChatRequest },
            { path: 'chat.response', value: { id: request.id, displayText: message, status: 'error', error: message, updatedAt: Date.now() } satisfies ChatResponse },
          ]);
          processingRef.current = false;
          return;
        }

        const speakText = result.reply.speak_text.trim();
        const displayText = result.reply.display_text?.trim() ?? text;

        // 最终响应
        sharedStoreClient.dispatchPatch([
          { path: 'chat.request', value: { ...request, status: 'done' } satisfies ChatRequest },
          { path: 'chat.response', value: { id: request.id, displayText, status: 'done', error: null, updatedAt: Date.now() } satisfies ChatResponse },
        ]);

        info('pet.chat', 'request.done', { id: request.id, hasSpeakText: Boolean(speakText) });

        // TTS 合成 → LiveKit 播放
        const tts = ttsRef.current;
        if (tts && speakText) {
          void tts.speakFromQwenReply({ requestId: request.id, speakText, displayText })
            .then((r) => info('pet.chat', 'tts.done', { id: request.id, ok: r.ok, streamed: r.streamed }))
            .catch((e) => warn('pet.chat', 'tts.failed', { id: request.id, err: String(e) }));
        }
      } catch (e) {
        const message = String(e instanceof Error ? e.message : e);
        error('pet.chat', 'request.exception', { id: request.id, err: message });
        sharedStoreClient.dispatchPatch([
          { path: 'chat.request', value: { ...request, status: 'error' } satisfies ChatRequest },
          { path: 'chat.response', value: { id: request.id, displayText: message, status: 'error', error: message, updatedAt: Date.now() } satisfies ChatResponse },
        ]);
      } finally {
        processingRef.current = false;
      }
    },
    [],
  );

  return { processChatRequest };
};
