import type { ChatConfig } from '@app/shared/state-bus/sharedStateTypes';
import { normalizePersona } from '@app/modules/ai/modules/llm/domain/memory/memoryContext';
import type { ChatMessage, ModelConfig } from './types';

/** 模型与思考深度来自前端缓存（llmSelectionCache），其余来自后端全局配置。 */
export const toChatConfig = (
  config: PetGlobalModelConfig | null | undefined,
  selection?: { model?: string; effort?: PetReasoningEffort | '' },
): ChatConfig => ({
  model: typeof selection?.model === 'string' ? selection.model : '',
  apiKey: typeof config?.apiKey === 'string' ? config.apiKey : '',
  baseURL: typeof config?.baseURL === 'string' ? config.baseURL : '',
  displayLang: config?.displayLang === 'en' || config?.displayLang === 'ja' || config?.displayLang === 'ko'
    ? config.displayLang
    : 'zh',
  reasoningEffort: selection?.effort ?? '',
});

export const buildPersonaConfig = (persisted: unknown, defaults: ModelConfig['persona']): ModelConfig['persona'] => {
  const persona = normalizePersona(persisted);
  return { ...defaults, ...persona };
};

export const trimText = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
export const createId = (): string => `chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
export const createMessage = (
  role: ChatMessage['role'],
  text: string,
  requestId: string,
  createdAt: number,
  source: ChatMessage['source'],
  status: ChatMessage['status'],
  error?: string,
): ChatMessage => ({ id: createId(), role, text, requestId, createdAt, source, status, error });
