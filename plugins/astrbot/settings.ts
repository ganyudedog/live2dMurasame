export interface AstrBotBridgeSettings {
  readonly bridgeUrl: string;
  readonly token: string;
  readonly systemPrompt: string;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly interactionMode: 'interrupt' | 'queue' | 'concurrent';
  readonly maxConcurrent: number;
  readonly maxQueued: number;
  readonly displayLang: 'zh' | 'en' | 'ja' | 'ko';
  /** Enables generation of the speak_text field; audio transport remains a separate capability. */
  readonly speakLang: '' | 'all_zh' | 'all_en' | 'all_ja' | 'all_ko' | 'all_yue' | 'auto';
}

export const DEFAULT_ASTRBOT_SETTINGS: AstrBotBridgeSettings = {
  bridgeUrl: 'ws://127.0.0.1:6198/ws', token: '', model: '', reasoningEffort: '',
  systemPrompt: '你是 QQ 群聊助手。结合收到的消息和对话上下文，自然、简洁地回复。',
  interactionMode: 'queue', maxConcurrent: 1, maxQueued: 16, displayLang: 'zh', speakLang: '',
};

export const normalizeInteractionSettings = (settings: AstrBotBridgeSettings) => {
  if (settings.interactionMode === 'interrupt') return { mode: 'interrupt' as const, maxConcurrent: clamp(settings.maxConcurrent, 1, 8), maxQueued: clamp(settings.maxQueued, 0, 100) };
  if (settings.interactionMode === 'concurrent') return { mode: 'concurrent' as const, maxConcurrent: clamp(settings.maxConcurrent, 1, 8), maxQueued: clamp(settings.maxQueued, 0, 100) };
  return { mode: 'queue' as const, maxConcurrent: 1 as const, maxQueued: clamp(settings.maxQueued, 0, 100) };
};

export const normalizeSettings = (value: unknown, defaults = DEFAULT_ASTRBOT_SETTINGS): AstrBotBridgeSettings => {
  const raw = value && typeof value === 'object' ? value as Partial<AstrBotBridgeSettings> : {};
  const modes = ['interrupt', 'queue', 'concurrent'] as const;
  const displayLangs = ['zh', 'en', 'ja', 'ko'] as const;
  const speakLangs = ['', 'all_zh', 'all_en', 'all_ja', 'all_ko', 'all_yue', 'auto'] as const;
  return {
    bridgeUrl: typeof raw.bridgeUrl === 'string' ? raw.bridgeUrl.trim() : defaults.bridgeUrl,
    token: typeof raw.token === 'string' ? raw.token : defaults.token,
    systemPrompt: typeof raw.systemPrompt === 'string' ? raw.systemPrompt : defaults.systemPrompt,
    model: typeof raw.model === 'string' ? raw.model : defaults.model,
    reasoningEffort: typeof raw.reasoningEffort === 'string' ? raw.reasoningEffort : defaults.reasoningEffort,
    interactionMode: modes.includes(raw.interactionMode as typeof modes[number]) ? raw.interactionMode as typeof modes[number] : defaults.interactionMode,
    maxConcurrent: clamp(Number(raw.maxConcurrent ?? defaults.maxConcurrent), 1, 8),
    maxQueued: clamp(Number(raw.maxQueued ?? defaults.maxQueued), 0, 100),
    displayLang: displayLangs.includes(raw.displayLang as typeof displayLangs[number]) ? raw.displayLang as typeof displayLangs[number] : defaults.displayLang,
    speakLang: speakLangs.includes(raw.speakLang as typeof speakLangs[number]) ? raw.speakLang as typeof speakLangs[number] : defaults.speakLang,
  };
};

const clamp = (value: number, min: number, max: number): number => Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : min;
