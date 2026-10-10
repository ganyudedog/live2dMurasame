import { RagService } from './RagService';
import { readLlmSnapshot, readRemoteLlmConfig, readGlobalConfigFallback } from '../infrastructure/configRepository';
import { isString, normalizeReplyText, normalizeDisplayLang, normalizeSpeakLang } from '../domain/config';
import type { TraceScope } from '@app/shared/logging/LogService';
import { requestStage2LLM } from '../infrastructure/llmClient';
import { parseStage2Reply, parseStage2StreamPreview, parseSentenceStreamPreview, type ParsedSentence } from '../domain/replyParser';
import type { ActionCapability, ActionDispatchResult, ActionIntentInput } from '../../../../live2d/modules/actions/domain/types';
import type { Stage2AskResult, Stage2LLMConfig } from '../domain/types';

interface Stage2AskOptions {
  signal?: AbortSignal;
  trace: TraceScope;
  model?: string;
  temperature?: number;
  apiKey?: string;
  baseURL?: string;
  // 流式显示回调：仅用于 UI 文本实时更新，不触发语音。
  onDisplayTextStreaming?: (displayText: string) => void;
  // 流式句子回调：JSON Lines 中每行 JSON 解析完成后立即触发
  onSentenceStreaming?: (sentence: ParsedSentence) => void;
}

interface LlmServiceOptions {
  dispatchAction: (input: ActionIntentInput, source?: string) => ActionDispatchResult;
  getActionCapability?: () => ActionCapability;
  defaultConfig?: Stage2LLMConfig;
  getConfigSnapshot?: () => PetConfigSnapshot | null | undefined;
}

interface RuntimeBridgeConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  temperature: number;
}

interface Stage2LanguageProfile {
  displayLang: 'zh' | 'en' | 'ja' | 'ko';
  speakLang: 'all_zh' | 'all_en' | 'all_ja' | 'all_ko' | 'all_yue' | 'auto';
}

// 发送对话请求，获取模型回复，并根据当前的 RAG 配置和记忆状态构建上下文信息，同时处理动作意图的分发和记忆的持久化更新。
export class LlmService {
  private readonly dispatchAction: LlmServiceOptions['dispatchAction'];
  private readonly getActionCapability?: LlmServiceOptions['getActionCapability'];
  private config: Stage2LLMConfig;
  private readonly getConfigSnapshot?: LlmServiceOptions['getConfigSnapshot'];
  private readonly rag: RagService;

  constructor(options: LlmServiceOptions) {
    this.dispatchAction = options.dispatchAction;
    this.getActionCapability = options.getActionCapability;
    this.getConfigSnapshot = options.getConfigSnapshot;
    this.config = options.defaultConfig ?? {};
    this.rag = new RagService(() => readLlmSnapshot(this.getConfigSnapshot), this.getActionCapability);
  }

  setConfig(patch: Partial<RuntimeBridgeConfig>): RuntimeBridgeConfig {
    const next: Stage2LLMConfig = { ...this.config };
    if (isString(patch.apiKey)) next.apiKey = patch.apiKey.trim();
    if (isString(patch.baseURL)) next.baseURL = patch.baseURL.trim();
    if (isString(patch.model)) next.model = patch.model.trim();
    if (typeof patch.temperature === 'number' && Number.isFinite(patch.temperature)) {
      next.temperature = Math.max(0, Math.min(1.5, patch.temperature));
    }
    this.config = next;
    return this.getConfig();
  }

  getConfig(): RuntimeBridgeConfig {
    const fallback = readGlobalConfigFallback(this.getConfigSnapshot);
    return {
      apiKey: this.config.apiKey ?? fallback.apiKey ?? '',
      baseURL: this.config.baseURL ?? fallback.baseURL ?? '',
      model: this.config.model ?? fallback.model ?? '',
      temperature: typeof this.config.temperature === 'number' ? this.config.temperature : 0.4,
    };
  }

  async ask(userText: string, options: Stage2AskOptions): Promise<Stage2AskResult> {
    const cleanText = String(userText ?? '').trim();
    if (!cleanText) {
      return { ok: false, error: '请输入有效文本' };
    }

    try {
      options.signal?.throwIfAborted();
      const resolved = await this.resolveConfig(options);
      options.signal?.throwIfAborted();
      const ragRuntime = await this.rag.resolve(cleanText, options.trace);
      options.signal?.throwIfAborted();
      const languageProfile = this.resolveLanguageProfile();
      const start = performance.now();
      let firstDeltaLatencyMs = -1;
      let streamedDisplayText = '';
      let processedSentenceCount = 0;

      // 发起对话
      const llmResult = await requestStage2LLM(
        {
          apiKey: resolved.apiKey,
          baseURL: resolved.baseURL,
          model: resolved.model,
          temperature: resolved.temperature,
        },
        {
          userText: cleanText,
          model: resolved.model,
          temperature: resolved.temperature,
          ragContext: ragRuntime.contextText,
          displayLang: languageProfile.displayLang,
          speakLang: languageProfile.speakLang,
          stream: true,
          signal: options.signal,
          onStreamDelta: ({ deltaText, aggregateText }) => {
            if (options.signal?.aborted) return;
            if (firstDeltaLatencyMs < 0 && String(deltaText).trim()) {
              firstDeltaLatencyMs = Math.round(performance.now() - start);
              options.trace.record('ask.stream.firstDelta', {
                latencyMs: firstDeltaLatencyMs,
              });
            }

            // JSON Lines 句子解析：每行 JSON 完整后立即回调
            const sentences = parseSentenceStreamPreview(aggregateText, processedSentenceCount);
            if (sentences.length > 0) {
              processedSentenceCount += sentences.length;
              for (const s of sentences) {
                options.onSentenceStreaming?.(s);
              }
            }

            // 兼容旧路径：单对象 JSON 的 display_text 预览
            const preview = parseStage2StreamPreview(aggregateText);
            const nextDisplay = normalizeReplyText(preview.display_text);
            if (!nextDisplay || nextDisplay === streamedDisplayText) return;
            streamedDisplayText = nextDisplay;
            options.onDisplayTextStreaming?.(nextDisplay);
          },
        },
      );

      options.signal?.throwIfAborted();

      // 解析回复
      const reply = parseStage2Reply(llmResult.rawText);
      if (!reply.meta) reply.meta = {};
      reply.meta.model = reply.meta.model ?? llmResult.usedModel;
      reply.meta.latency_ms = Math.round(performance.now() - start);
      if (firstDeltaLatencyMs >= 0) {
        reply.meta.first_delta_ms = firstDeltaLatencyMs;
      }
      reply.meta.provider = reply.meta.provider ?? 'openai-compatible';

      // 双文本协议：display_text 用于前端展示，speak_text 用于 TTS。
      const displayText = normalizeReplyText(reply.display_text);
      const speakText = normalizeReplyText(reply.speak_text);
      reply.display_text = displayText;
      reply.speak_text = speakText;


      const actionResult = this.dispatchAction(reply.action_intent, 'stage2.llm');

      await this.rag.persistConversation(ragRuntime, cleanText, displayText, options.trace);

      options.trace.record('ask.ok', {
        model: reply.meta.model,
        latencyMs: reply.meta.latency_ms,
        firstDeltaMs: firstDeltaLatencyMs >= 0 ? firstDeltaLatencyMs : undefined,
        actionState: actionResult.state,
        actionKind: reply.action_intent.kind,
        hasDisplayText: Boolean(displayText),
        hasSpeakText: Boolean(speakText),
        displayLang: languageProfile.displayLang,
        speakLang: languageProfile.speakLang,
        ragChunks: ragRuntime.chunkCount,
        memoryMessages: ragRuntime.memoryState?.recent?.messages?.length ?? 0,
      });

      return {
        ok: true,
        reply,
        rag: {
          contextText: ragRuntime.contextText,
          chunkCount: ragRuntime.chunkCount,
        },
        actionResult,
        rawText: llmResult.rawText,
      };
    } catch (e) {
      const message = String(e instanceof Error ? e.message : e);
      options.trace.record('ask.failed', { err: message });
      return {
        ok: false,
        error: message,
      };
    }
  }

  dispose(): void {
    this.rag.dispose();
  }

  async previewRag(userText: string): Promise<{ contextText: string; chunkCount: number }> {
    const cleanText = String(userText ?? '').trim();
    if (!cleanText) {
      return { contextText: '', chunkCount: 0 };
    }
    return this.rag.resolve(cleanText);
  }

  private async resolveConfig(options: Stage2AskOptions): Promise<RuntimeBridgeConfig> {
    const merged: Stage2LLMConfig = {
      ...this.config,
      ...options,
    };

    if (!isString(merged.apiKey) || !isString(merged.baseURL) || !isString(merged.model)) {
      try {
        const globalCfg = await readRemoteLlmConfig();
        if (isString(globalCfg?.apiKey)) {
          merged.apiKey = globalCfg.apiKey.trim();
        }
        if (!isString(merged.baseURL) && isString(globalCfg?.baseURL)) {
          merged.baseURL = globalCfg.baseURL.trim();
        }
        if (!isString(merged.model) && isString(globalCfg?.model)) {
          merged.model = globalCfg.model.trim();
        }
      } catch {
        // ignore runtime config probe errors
      }
    }

    if (!isString(merged.model)) throw new Error('未配置 AI 模型，请先在控制面板 AI 页填写');

    const temperature = typeof merged.temperature === 'number' && Number.isFinite(merged.temperature)
      ? Math.max(0, Math.min(1.5, merged.temperature))
      : 0.4;

    if (!isString(merged.apiKey)) {
      throw new Error('未检测到 API Key，请先在控制面板 AI 页填写');
    }

    return {
      apiKey: merged.apiKey,
      baseURL: isString(merged.baseURL) ? merged.baseURL : '',
      model: merged.model,
      temperature,
    };
  }

  private resolveLanguageProfile(): Stage2LanguageProfile {
    try {
      const snapshot = readLlmSnapshot(this.getConfigSnapshot);
      const displayLang = normalizeDisplayLang(snapshot?.globalModelConfig?.displayLang);
      // speakText 语言直接跟随模型 TTS 配置（textLang）。
      const speakLang = normalizeSpeakLang(snapshot?.modelConfig?.tts?.textLang);
      return { displayLang, speakLang };
    } catch {
      return {
        displayLang: 'zh',
        speakLang: 'all_ja',
      };
    }
  }
}
