import type { PluginConversationExecutor } from './PluginConversationHost';
import type { ConfigService } from '@app/shared/config/ConfigService';
import type { LogService } from '@app/shared/logging/LogService';
import { parseStage2Reply, SentenceStreamParser } from '../../modules/ai/modules/llm/domain/replyParser';
import { requestStage2LLM } from '../../modules/ai/modules/llm/infrastructure/llmClient';
import { buildMemoryContext, normalizePersona } from '../../modules/ai/modules/llm/domain/memory/memoryContext';

/** Default host implementation. Plugins only see the public channel contract. */
export const createDefaultConversationExecutor = (
  config: ConfigService,
  log: LogService,
): PluginConversationExecutor => async (options, request, context) => {
  const global = config.globalModelConfig;
  const model = options.model?.trim();
  const scenePrompt = request.systemPrompt?.trim() || options.systemPrompt?.trim()
    || '请结合当前对话场景和用户消息自然作答。';
  // Read the active character for each request; plugin settings only describe the scene.
  const persona = buildMemoryContext(normalizePersona(config.modelConfig?.persona), null);
  const systemPrompt = [
    persona ? '以下角色人设由宿主提供。保持角色身份、个性、说话风格与设定边界；场景说明用于调整当前交流方式，不替换角色人设。' : '',
    persona,
    `[当前对话场景]\n${scenePrompt}`,
  ].filter(Boolean).join('\n\n');
  const speakLang = request.speakLang === undefined ? options.speakLang : request.speakLang;
  const speechEnabled = speakLang != null;
  let displayText = '';
  let speakText = '';
  const parser = new SentenceStreamParser();
  const traceContext = log.contextRegistry.register('PluginConversation', {
    relation: 'conversation.request',
    params: { channelId: context.channelId, requestId: context.requestId, source: options.source, model, textLength: request.text.length },
    behavior: '通过插件独立通道执行文本模型请求',
  });
  const trace = traceContext.beginTrace('request');

  try {
    context.signal.throwIfAborted();
    if (!model) throw new Error('请在插件设置中选择对话模型');
    if (!global?.apiKey?.trim()) throw new Error('请先在 AI 设置中配置模型 API Key');
    const response = await requestStage2LLM({
      apiKey: global.apiKey,
      baseURL: global.baseURL,
      model,
    }, {
      userText: request.text,
      model,
      systemPrompt,
      displayLang: request.displayLang ?? options.displayLang,
      speakLang,
      speechEnabled,
      ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
      stream: true,
      signal: context.signal,
      onStreamDelta: ({ deltaText }) => {
        for (const event of parser.push(deltaText)) {
          if (event.type !== 'sentence-complete') continue;
          displayText = appendText(displayText, event.sentence.displayText);
          if (speechEnabled) speakText = appendText(speakText, event.sentence.speakText);
          context.emit({ text: displayText, ...(speakText ? { speakText } : {}), status: 'streaming' });
        }
      },
    });
    context.signal.throwIfAborted();
    parser.finish();
    const reply = parseStage2Reply(response.rawText);
    displayText ||= reply.display_text?.trim() ?? '';
    if (speechEnabled) speakText ||= reply.speak_text?.trim() ?? '';
    context.emit({ text: displayText, ...(speakText ? { speakText } : {}), status: 'done' });
    trace.end({ status: 'done', model, responseLength: displayText.length, speechEnabled });
  } catch (error) {
    const cancelled = context.signal.aborted;
    const message = cancelled ? undefined : error instanceof Error ? error.message : String(error);
    context.emit({ text: displayText, status: cancelled ? 'cancelled' : 'error', ...(message ? { error: message } : {}) });
    if (cancelled) trace.end({ status: 'cancelled' });
    else trace.fail('插件对话请求失败', { model, error: message }, error);
  } finally {
    traceContext.dispose();
  }
};

const appendText = (current: string, next: string): string => current ? `${current}\n${next}` : next;
