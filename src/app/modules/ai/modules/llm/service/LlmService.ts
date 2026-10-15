import { ActionCatalogService } from './ActionCatalogService';
import { RagService } from './RagService';
import { isString, normalizeReplyText, normalizeDisplayLang, normalizeSpeakLang } from '../domain/config';
import type { TraceScope, LogService } from '@app/shared/logging/LogService';
import { requestStage2LLM, requestStructuredLLM } from '../infrastructure/llmClient';
import { parseStage2Reply, SentenceStreamParser, type ParsedSentence } from '../domain/replyParser';
import type { ActionCapability } from '../../../../live2d/modules/actions/domain/types';
import type { Stage2AskResult, Stage2LLMConfig } from '../domain/types';

interface Stage2AskOptions {
  signal?: AbortSignal;
  trace: TraceScope;
  model?: string;
  temperature?: number;
  apiKey?: string;
  baseURL?: string;
  // 同一解析器分别报告字段就绪和整句完成，共享连续的业务句子编号。
  onSentenceStreaming?: (sentence: ParsedSentence) => void;
  onSentenceSpeechReady?: (sentence: { sentenceIndex: number; speakText: string }) => void;
  onSentenceDisplayReady?: (sentence: { sentenceIndex: number; displayText: string }) => void;
}

interface LlmServiceOptions {
  log?: LogService;
  getActionModelVersion?: () => number;
  defaultConfig?: Stage2LLMConfig;
  getConfigSnapshot: () => PetConfigSnapshot | null | undefined;
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

// 发送对话请求，获取模型回复，并根据当前的 RAG 配置和记忆状态构建上下文信息，同时输出逐句动作目标和持久化记忆。
export class LlmService {
  readonly actionCatalog: ActionCatalogService;
  private readonly getActionModelVersion?: LlmServiceOptions['getActionModelVersion'];
  private config: Stage2LLMConfig;
  private readonly getConfigSnapshot: LlmServiceOptions['getConfigSnapshot'];
  private readonly rag: RagService;
  private readonly log?: LogService;

  constructor(options: LlmServiceOptions) {
    this.log = options.log;
    this.actionCatalog = new ActionCatalogService((system, user, signal) => this.requestStructured(system, user, signal));
    this.getActionModelVersion = options.getActionModelVersion;
    this.getConfigSnapshot = options.getConfigSnapshot;
    this.config = options.defaultConfig ?? {};
    this.rag = new RagService(this.getConfigSnapshot);
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
    const globalConfig = this.getConfigSnapshot()?.globalModelConfig;
    return {
      apiKey: this.config.apiKey ?? globalConfig?.apiKey?.trim() ?? '',
      baseURL: this.config.baseURL ?? globalConfig?.baseURL?.trim() ?? '',
      model: this.config.model ?? globalConfig?.model?.trim() ?? '',
      temperature: typeof this.config.temperature === 'number' ? this.config.temperature : 0.4,
    };
  }

  async requestStructured(systemPrompt: string, userPrompt: string, signal?: AbortSignal): Promise<string> {
    const config = this.resolveConfig();
    const context = this.log?.contextRegistry.register('LlmService', {
      relation: 'actionCatalog.request', params: { model: config.model }, behavior: '动作表配置请求及缓存用量',
    });
    const trace = context?.beginTrace('requestStructured');
    try {
      const result = await requestStructuredLLM(config, { systemPrompt, userPrompt, signal, temperature: 0.2 });
      const usage = { ...(result.usage ?? { cacheStatus: 'unreported' }) };
      trace?.record('prompt-cache.usage', usage);
      trace?.end({ model: result.usedModel, ...usage });
      return result.rawText;
    } catch (error) {
      trace?.fail('动作表配置请求失败', { model: config.model }, error);
      throw error;
    } finally { context?.dispose(); }
  }

  async ask(userText: string, options: Stage2AskOptions): Promise<Stage2AskResult> {
    const cleanText = String(userText ?? '').trim();
    if (!cleanText) {
      return { ok: false, error: '请输入有效文本' };
    }

    // 已保存动作表以 Electron 下发的配置快照为准，不依赖渲染器挂载或后置事件绑定。
    // 只投影语义目录给日常对话；轨迹留给执行器，运行时版本仅用于丢弃切模后的旧回复。
    const snapshot = this.getConfigSnapshot();
    const actionCapability: ActionCapability = {
      modelVersion: this.getActionModelVersion?.() ?? 0,
      actions: (snapshot?.modelConfig?.actions ?? []).map(({ id, label, category, description }) => ({
        id, label, category, ...(description === undefined ? {} : { description }),
      })),
    };
    options.trace.record('action.capabilitySnapshot', {
      source: 'model-config-snapshot', modelPath: snapshot?.activeModelPath,
      modelVersion: actionCapability.modelVersion, actionCount: actionCapability.actions.length,
      actions: actionCapability.actions,
    });
    try {
      options.signal?.throwIfAborted();
      const resolved = this.resolveConfig(options);
      options.signal?.throwIfAborted();
      const ragRuntime = await this.rag.resolve(cleanText, options.trace);
      options.signal?.throwIfAborted();
      const languageProfile = this.resolveLanguageProfile(snapshot);
      const start = performance.now();
      let firstDeltaLatencyMs = -1;
      let streamedRawText = '';
      const parser = new SentenceStreamParser((diagnostic) => options.trace.record('action.stream', {
        ...diagnostic, modelVersion: actionCapability.modelVersion,
      }));
      const publishSentences = (rawText: string) => {
        if (options.signal?.aborted) return;
        // 网络返回的最终文本会 trim；与已消费流相同则不重复提交。
        if (rawText.trim() === streamedRawText.trim()) return;
        if (!rawText.startsWith(streamedRawText)) throw new Error('LLM 流式输出不是追加文本');
        const events = parser.push(rawText.slice(streamedRawText.length));
        streamedRawText = rawText;
        for (const event of events) {
          if (options.signal?.aborted) return;
          if (event.type === 'speech-ready') {
            options.onSentenceSpeechReady?.({ sentenceIndex: event.sentenceIndex, speakText: event.speakText });
          } else if (event.type === 'display-ready') {
            options.onSentenceDisplayReady?.({ sentenceIndex: event.sentenceIndex, displayText: event.displayText });
          } else {
            options.onSentenceStreaming?.({ ...event.sentence, modelVersion: actionCapability.modelVersion });
          }
        }
      };

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
          actionCapability,
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

            publishSentences(aggregateText);
          },
        },
      );

      options.signal?.throwIfAborted();

      options.trace.record('ask.usage', { ...(llmResult.usage ?? { cacheStatus: 'unreported' }) });
      publishSentences(llmResult.rawText);
      parser.finish();

      // 解析回复
      const reply = parseStage2Reply(llmResult.rawText, (diagnostic) => options.trace.record('reply.parse', diagnostic));
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



      await this.rag.persistConversation(ragRuntime, cleanText, displayText, options.trace);

      options.trace.record('ask.ok', {
        model: reply.meta.model,
        latencyMs: reply.meta.latency_ms,
        firstDeltaMs: firstDeltaLatencyMs >= 0 ? firstDeltaLatencyMs : undefined,
        actionId: reply.action_intent?.actionId,
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
        modelVersion: actionCapability.modelVersion,
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

  private resolveConfig(options: Stage2LLMConfig = {}): RuntimeBridgeConfig {
    const merged: Stage2LLMConfig = {
      ...this.getConfig(),
      ...options,
    };

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

  private resolveLanguageProfile(snapshot: PetConfigSnapshot | null | undefined): Stage2LanguageProfile {
    const displayLang = normalizeDisplayLang(snapshot?.globalModelConfig?.displayLang);
    // speakText 语言直接跟随模型 TTS 配置（textLang）。
    const speakLang = normalizeSpeakLang(snapshot?.modelConfig?.tts?.textLang);
    return { displayLang, speakLang };
  }
}
