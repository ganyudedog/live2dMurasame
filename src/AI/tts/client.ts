import {
  fromSessionCreateServer,
  getJson,
  normalizeBaseUrl,
  postRequest,
  toModelSwitchServer,
  toSessionCreateServer,
  toTtsCancelServer,
  toTtsSpeakServer,
} from '../../../api/service/liveKitService';
import type {
  LiveKitModelSwitchRequest,
  LiveKitModelSwitchResponseServer,
  LiveKitSessionCreateResponseServer,
  LiveKitTtsSpeakRequest,
} from '../../../api/model/liveKitModel';
import type { TtsCancelRequest, TtsSynthesisRequest } from './types';
import toast from 'react-hot-toast';

type V3RuntimeState = {
  sessionId: string;
  expiresAt: number;
  configVersion: string;
  modelReady: boolean;
};

const stateByBaseUrl = new Map<string, V3RuntimeState>();

const trimText = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
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

const buildConfigVersion = (config: TtsSynthesisRequest['config']): string => {
  const seed = [
    trimText(config.gptWeightsPath),
    trimText(config.sovitsWeightsPath),
    trimText(config.refAudioPath),
    trimText(config.refAudioText),
    trimText(config.textLang),
    trimText(config.promptLang),
    normalizeTextSplitMethod(config.textSplitMode),
  ].join('|');

  let hash = 2166136261;
  for (let idx = 0; idx < seed.length; idx += 1) {
    hash ^= seed.charCodeAt(idx);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return `cfg_${(hash >>> 0).toString(16)}`;
};

const ensureSession = async (baseUrl: string, signal?: AbortSignal): Promise<string> => {
  const cached = stateByBaseUrl.get(baseUrl);
  if (cached && cached.expiresAt > Date.now() + 5000) {
    return cached.sessionId;
  }

  const raw = await postRequest<LiveKitSessionCreateResponseServer>(
    baseUrl,
    '/v3/session/create',
    toSessionCreateServer({
      client: 'desktop',
      version: '0.1.0',
      capabilities: {
        livekit: true,
        audioDownlink: true,
      },
    }),
    signal,
  );

  const data = fromSessionCreateServer(raw);
  const expiresInMs = Math.max(30, data.livekit.expiresIn) * 1000;
  const nextState: V3RuntimeState = {
    sessionId: data.sessionId,
    expiresAt: Date.now() + expiresInMs,
    configVersion: cached?.configVersion ?? '',
    modelReady: cached?.modelReady ?? false,
  };
  stateByBaseUrl.set(baseUrl, nextState);
  return data.sessionId;
};

const waitUntilModelReady = async (baseUrl: string, sessionId: string, signal?: AbortSignal): Promise<boolean> => {
  for (let idx = 0; idx < 8; idx += 1) {
    if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');

    const status = await getJson<{ ready?: boolean }>(
      baseUrl,
      `/v3/model/current?session_id=${encodeURIComponent(sessionId)}`,
      signal,
    ).catch(() => ({ ready: false }));
    if (status.ready) return true;

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 150);
    });
  }
  return false;
};

const ensureModelReady = async (
  baseUrl: string,
  sessionId: string,
  requestId: string,
  config: TtsSynthesisRequest['config'],
  options?: { silent?: boolean },
  signal?: AbortSignal,
): Promise<void> => {
  const configVersion = buildConfigVersion(config);
  const cached = stateByBaseUrl.get(baseUrl);
  if (cached && cached.configVersion === configVersion && cached.modelReady) {
    return;
  }

  // 构建模型切换请求，通知后端加载模型权重并准备就绪。后端接口会根据请求中的权重路径等信息判断是否需要重新加载模型。
  const request: LiveKitModelSwitchRequest = {
    sessionId,
    requestId: `${requestId}_model`,
    payload: {
      reason: cached ? 'settings_update' : 'startup',
      configVersion,
      modelId: trimText(config.gptWeightsPath) || 'default_local_model',
      gptWeightsPath: trimText(config.gptWeightsPath),
      sovitsWeightsPath: trimText(config.sovitsWeightsPath),
      refAudioPath: trimText(config.refAudioPath),
      promptText: trimText(config.refAudioText),
      promptLang: trimText(config.promptLang) || 'zh',
    },
  };

  const raw = await postRequest<LiveKitModelSwitchResponseServer>(
    baseUrl,
    '/v3/model/switch',
    toModelSwitchServer(request),
    signal,
  );

  let modelReady = Boolean(raw.model_ready);
  if (!modelReady) {
    modelReady = await waitUntilModelReady(baseUrl, sessionId, signal);
  }

  stateByBaseUrl.set(baseUrl, {
    sessionId,
    expiresAt: cached?.expiresAt ?? Date.now() + 3600_000,
    configVersion,
    modelReady,
  });

  if (!modelReady) {
    if (!options?.silent) {
      toast.error('模型加载超时，请检查后端状态与权重配置');
    }
    throw new Error('模型未就绪（MODEL_NOT_READY），请检查权重配置与后端状态');
  }
};

export const warmupTtsModel = async (
  config: TtsSynthesisRequest['config'],
  options?: { reason?: string; signal?: AbortSignal },
): Promise<void> => {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  if (!baseUrl) return;

  const sessionId = await ensureSession(baseUrl, options?.signal);
  const requestId = `warmup_${(options?.reason || 'auto').replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now().toString(36)}`;
  await ensureModelReady(baseUrl, sessionId, requestId, config, { silent: true }, options?.signal);
};

const buildTtsPayload = (
  requestId: string,
  speakText: string,
  displayText: string,
  sessionId: string,
  config: TtsSynthesisRequest['config'],
) => {
  const transport = normalizeTransport(config.mediaType, config.streamingMode);
  const request: LiveKitTtsSpeakRequest = {
    sessionId,
    requestId,
    ts: Date.now(),
    payload: {
      displayText,
      speakText,
      textLang: trimText(config.textLang) || 'ja',
      promptLang: trimText(config.promptLang) || 'ja',
      refAudioPath: trimText(config.refAudioPath),
      promptText: trimText(config.refAudioText),
      textSplitMethod: normalizeTextSplitMethod(config.textSplitMode),
      speedFactor: clampNumber(config.speedFactor, 1, 0, 2),
      fragmentInterval: clampNumber(config.fragmentInterval, 0.3, 0, 0.5),
      topK: clampInteger(config.topK, 20, 1, 100),
      topP: clampNumber(config.topP, 0.8, 0, 1),
      temperature: clampNumber(config.temperature, 0.5, 0, 1),
      streamingMode: transport.streamingMode,
      mediaType: transport.mediaType,
    },
  };

  return toTtsSpeakServer(request);
};

// 语音合成接口，返回原始 Response 以支持流式处理与多种媒体类型。
export const requestTtsSynthesis = async ({ requestId, speakText, displayText, config, signal }: TtsSynthesisRequest): Promise<Response> => {
  const cleanSpeakText = trimText(speakText);
  if (!cleanSpeakText) {
    throw new Error('TTS 文本为空，无法发起合成');
  }

  const baseUrl = normalizeBaseUrl(config.baseUrl);
  if (!baseUrl) {
    throw new Error('TTS 服务地址为空，请先在 TTS 设置中配置');
  }

  const sessionId = await ensureSession(baseUrl, signal);
  await ensureModelReady(baseUrl, sessionId, requestId, config, undefined, signal);

  const endpoint = `${baseUrl}/v3/tts/speak`;
  const payload = buildTtsPayload(requestId, cleanSpeakText, trimText(displayText) || cleanSpeakText, sessionId, config);

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

export const cancelTtsSynthesis = async ({ requestId, reason, config, signal }: TtsCancelRequest): Promise<void> => {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  if (!baseUrl) return;

  const cached = stateByBaseUrl.get(baseUrl);
  if (!cached?.sessionId) return;

  await postRequest<{ ok?: boolean }>(
    baseUrl,
    '/v3/tts/cancel',
    toTtsCancelServer({
      sessionId: cached.sessionId,
      requestId,
      ts: Date.now(),
      payload: {
        reason,
      },
    }),
    signal,
  );
};
