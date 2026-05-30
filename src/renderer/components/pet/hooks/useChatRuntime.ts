import { useCallback, useEffect, useRef } from 'react';
import { createStage2Runtime, type Stage2Runtime } from '../../../../AI/core/stage2Runtime';
import { createFrontendTtsRuntime, type FrontendTtsRuntime } from '../../../../AI/tts/runtime';
import type { PlaybackFeedbackReporter } from '../../../../AI/tts/runtime';
import { sharedStoreClient } from '../../../shared/sharedStoreClient';
import type { ChatConfig, ChatRequest, ChatResponse } from '../../../shared/sharedStateTypes';
import { info, warn, error } from '../../../utils/log';
import { useTtsQueue, type UseTtsQueueResult } from './useTtsQueue';

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
 *   ② processChatRequest：调 LLM（JSON Lines 流式）→ 逐句 dispatch chat.response → 逐句 TTS
 */
export const useChatRuntime = (options: UseChatRuntimeOptions): UseChatRuntimeResult => {
  const { reportPlaybackFeedback } = options;
  const stage2Ref = useRef<Stage2Runtime | null>(null);
  const ttsRef = useRef<FrontendTtsRuntime | null>(null);
  const processingRef = useRef(false);
  const ttsQueue = useTtsQueue();

  useEffect(() => {
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

  /**
   * TTS 消费轮询：边进边出，不等待 LLM 流式结束。
   * 有句子时立即发送 → 等待后端反馈 → 立刻检查下一个；
   * 无句子时 50ms 轮询。
   */
  const startTtsConsumer = useCallback((requestId: string, queue: UseTtsQueueResult, done: { current: boolean }) => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const pump = async () => {
      const tts = ttsRef.current;
      if (!tts) return;

      const next = queue.getNextSpeak();
      if (next) {
        try {
          await tts.speakFromQwenReply({
            requestId: `${requestId}_s${next.index}`,
            speakText: next.speakText,
            displayText: next.displayText,
          });
          queue.advanceSend();
          // 后端反馈后立刻尝试下一个（无延迟）
          pump();
          return;
        } catch (e) {
          warn('pet.chat', 'tts.sentence.failed', { requestId, index: next.index, err: String(e) });
          queue.advanceSend();
        }
      }

      // 无句子 → 50ms 轮询
      if (!done.current) {
        timer = setTimeout(pump, 50);
      }
    };

    pump();

    return () => {
      if (timer != null) clearTimeout(timer);
    };
  }, []);
  
  const processChatRequest = useCallback(
    async (request: ChatRequest, config: ChatConfig): Promise<void> => {
      if (processingRef.current) return;
      const text = String(request.text ?? '').trim();
      if (!text) return;

      const stage2 = stage2Ref.current;
      if (!stage2) return;

      processingRef.current = true;

      sharedStoreClient.dispatchPatch([{
        path: 'chat.request',
        value: { ...request, status: 'processing' } satisfies ChatRequest,
      }]);

      info('pet.chat', 'request.processing', { id: request.id, source: request.source });

      let accumulatedDisplay = '';
      const ttsDoneRef = { current: false };
      const stopConsumer = startTtsConsumer(request.id, ttsQueue, ttsDoneRef);

      try {
        const result = await stage2.ask(text, {
          apiKey: config.apiKey,
          baseURL: config.baseURL,
          onSentenceStreaming: (sentence) => {
            // 累积 displayText
            accumulatedDisplay = accumulatedDisplay
              ? `${accumulatedDisplay}\n${sentence.displayText}`
              : sentence.displayText;

            // 流式更新 chat.response
            sharedStoreClient.dispatchPatch([{
              path: 'chat.response',
              value: {
                id: request.id, displayText: accumulatedDisplay,
                status: 'streaming', error: null, updatedAt: Date.now(),
              } satisfies ChatResponse,
            }]);

            // speakText → TTS 队列（门控发送）
            ttsQueue.pushSentence(sentence.speakText, sentence.displayText);
          },
        });

        // LLM 流式结束
        ttsQueue.finishStreaming();

        if (!result?.ok) {
          const message = result?.error ?? '对话请求失败';
          warn('pet.chat', 'request.failed', { id: request.id, err: message });
          sharedStoreClient.dispatchPatch([
            { path: 'chat.request', value: { ...request, status: 'error' } satisfies ChatRequest },
            { path: 'chat.response', value: { id: request.id, displayText: message, status: 'error', error: message, updatedAt: Date.now() } satisfies ChatResponse },
          ]);
          processingRef.current = false;
          return;
        }

        // 最终响应
        if (accumulatedDisplay) {
          sharedStoreClient.dispatchPatch([
            { path: 'chat.request', value: { ...request, status: 'done' } satisfies ChatRequest },
            { path: 'chat.response', value: { id: request.id, displayText: accumulatedDisplay, status: 'done', error: null, updatedAt: Date.now() } satisfies ChatResponse },
          ]);
        }

        info('pet.chat', 'request.done', { id: request.id });

      } catch (e) {
        const message = String(e instanceof Error ? e.message : e);
        error('pet.chat', 'request.exception', { id: request.id, err: message });
        sharedStoreClient.dispatchPatch([
          { path: 'chat.request', value: { ...request, status: 'error' } satisfies ChatRequest },
          { path: 'chat.response', value: { id: request.id, displayText: message, status: 'error', error: message, updatedAt: Date.now() } satisfies ChatResponse },
        ]);
      } finally {
        processingRef.current = false;
        ttsDoneRef.current = true;
        stopConsumer();
      }
    },
    [startTtsConsumer, ttsQueue],
  );

  return { processChatRequest };
};
