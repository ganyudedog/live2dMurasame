import type { TtsSynthesisRequest } from './types';

// 记录已应用的权重路径，避免重复切权请求。
type AppliedWeightsState = {
  gptWeightsPath: string;
  sovitsWeightsPath: string;
};

const appliedWeightsByBaseUrl = new Map<string, AppliedWeightsState>();

const trimText = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const normalizeBaseUrl = (baseUrl: string): string => {
  const trimmed = trimText(baseUrl);
  return trimmed.replace(/\/+$/, '');
};

const clampNumber = (value: unknown, fallback: number, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
};

const clampInteger = (value: unknown, fallback: number, min: number, max: number): number => {
  return Math.round(clampNumber(value, fallback, min, max));
};

const normalizeTransport = (
  mediaType: unknown,
  streamingMode: unknown,
): { mediaType: 'wav' | 'ogg' | 'aac'; streamingMode: boolean } => {
  const normalizedMediaType = mediaType === 'ogg' || mediaType === 'aac' ? mediaType : 'wav';
  const normalizedStreamingMode = streamingMode !== false;

  // GPT-SoVITS 在 wav + streaming_mode 下通常返回 chunked wav 片段，浏览器端难以稳定直接播放。
  // 这里在不改 Python 的前提下做兼容：wav 强制走非流式，确保最终可播放。
  if (normalizedMediaType === 'wav' && normalizedStreamingMode) {
    return {
      mediaType: normalizedMediaType,
      streamingMode: false,
    };
  }

  return {
    mediaType: normalizedMediaType,
    streamingMode: normalizedStreamingMode,
  };
};

// 映射到python该字段的定义
const normalizeTextSplitMethod = (value: unknown): string => {
  const normalized = trimText(value).toLowerCase();
  if (!normalized) return 'cut5';

  if (normalized === 'cut0' || normalized === 'cut1' || normalized === 'cut2'
    || normalized === 'cut3' || normalized === 'cut4' || normalized === 'cut5') {
    return normalized;
  }

  // 兼容历史值：旧 UI 与历史配置中的切分字段映射到 v2 API 方法名。
  if (normalized === 'none') return 'cut0';
  if (normalized === 'cut50') return 'cut2';
  if (normalized === 'cut_punc' || normalized === 'punctuation'
    || normalized === 'cut_zh_comma' || normalized === 'cut_en_comma') {
    return 'cut5';
  }

  return 'cut5';
};

// 调用后端切换权重的接口，通知后端切换到指定的权重路径。
const callSetWeightsEndpoint = async (
  baseUrl: string,
  endpoint: 'set_gpt_weights' | 'set_sovits_weights',
  weightsPath: string,
  signal?: AbortSignal,
): Promise<void> => {
  const cleanPath = trimText(weightsPath);
  if (!cleanPath) return;

  const query = `weights_path=${encodeURIComponent(cleanPath)}`;
  const requestUrl = `${baseUrl}/${endpoint}?${query}`;
  const response = await fetch(requestUrl, {
    method: 'GET',
    headers: {
      Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
    },
    signal,
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    const detail = bodyText ? `, body=${bodyText.slice(0, 240)}` : '';
    throw new Error(`切换权重失败: ${endpoint} HTTP ${response.status}${detail}`);
  }
};

// 根据当前 TTS 配置中的权重路径与已应用的权重路径对比，决定是否需要调用切换权重的接口来切换到目标权重。
const ensureDynamicWeights = async (
  baseUrl: string,
  config: TtsSynthesisRequest['config'],
  signal?: AbortSignal,
): Promise<void> => {
  const gptWeightsPath = trimText(config.gptWeightsPath);
  const sovitsWeightsPath = trimText(config.sovitsWeightsPath);

  if (!gptWeightsPath && !sovitsWeightsPath) return;

  const applied = appliedWeightsByBaseUrl.get(baseUrl) ?? {
    gptWeightsPath: '',
    sovitsWeightsPath: '',
  };

  if (gptWeightsPath && gptWeightsPath !== applied.gptWeightsPath) {
    await callSetWeightsEndpoint(baseUrl, 'set_gpt_weights', gptWeightsPath, signal);
    applied.gptWeightsPath = gptWeightsPath;
  }

  if (sovitsWeightsPath && sovitsWeightsPath !== applied.sovitsWeightsPath) {
    await callSetWeightsEndpoint(baseUrl, 'set_sovits_weights', sovitsWeightsPath, signal);
    applied.sovitsWeightsPath = sovitsWeightsPath;
  }

  appliedWeightsByBaseUrl.set(baseUrl, applied);
};

// 构建请求体
const buildTtsPayload = (text: string, config: TtsSynthesisRequest['config']) => {
  const transport = normalizeTransport(config.mediaType, config.streamingMode);
  return {
    text,
    text_lang: trimText(config.textLang) || 'ja',
    prompt_lang: trimText(config.promptLang) || 'ja',
    prompt_text: trimText(config.refAudioText),
    ref_audio_path: trimText(config.refAudioPath),
    text_split_method: normalizeTextSplitMethod(config.textSplitMode),
    speed_factor: clampNumber(config.speedFactor, 1, 0, 2),
    fragment_interval: clampNumber(config.fragmentInterval, 0.3, 0, 0.5),
    top_k: clampInteger(config.topK, 20, 1, 100),
    top_p: clampNumber(config.topP, 0.8, 0, 1),
    temperature: clampNumber(config.temperature, 0.5, 0, 1),
    media_type: transport.mediaType,
    streaming_mode: transport.streamingMode,
    use_last_generated_as_ref: Boolean(config.useLastGeneratedAsRef),
    // 兼容部分二次封装服务：若后端读取该字段也可直接生效。
    gpt_weights_path: trimText(config.gptWeightsPath),
    sovits_weights_path: trimText(config.sovitsWeightsPath),
  };
};

// 发送请求到 TTS 服务，获取合成结果的响应对象，如果请求失败则抛出相应的错误。
export const requestTtsSynthesis = async ({ text, config, signal }: TtsSynthesisRequest): Promise<Response> => {
  const cleanText = trimText(text);
  if (!cleanText) {
    throw new Error('TTS 文本为空，无法发起合成');
  }

  const baseUrl = normalizeBaseUrl(config.baseUrl);
  if (!baseUrl) {
    throw new Error('TTS 服务地址为空，请先在 TTS 设置中配置');
  }

  const endpoint = `${baseUrl}/tts`;

  // v2 API 已提供动态切权接口，这里在合成前先确保目标权重已切换。
  await ensureDynamicWeights(baseUrl, config, signal);

  const payload = buildTtsPayload(cleanText, config);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json, audio/*;q=0.9, */*;q=0.8',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    const detail = bodyText ? `, body=${bodyText.slice(0, 240)}` : '';
    throw new Error(`TTS 请求失败: HTTP ${response.status}${detail}`);
  }

  return response;
};
