import {
  getJson,
  normalizeBaseUrl,
  postRequest,
  toModelSwitchServer,
  toTtsCancelServer,
  toTtsSpeakServer,
} from '@app/modules/ai/infrastructure/livekit/service/liveKitService';
import {
  disconnectLiveKitRoom,
  ensureLiveKitRoomConnected,
  ensureLiveKitSession,
  publishLiveKitV3Event,
  subscribeLiveKitV3Events,
  type LiveKitV3EventEnvelopeServer,
} from '@app/modules/ai/infrastructure/livekit/service/liveKitRealtime';
import type {
  LiveKitModelSwitchRequest,
  LiveKitModelSwitchResponseServer,
  LiveKitTtsSpeakRequest,
} from '@app/modules/ai/infrastructure/livekit/model/liveKitModel';
import type { TtsCancelRequest, TtsSynthesisRequest } from './types';
import toast from 'react-hot-toast';
import { info, warn } from '@app/shared/logging/compat';

type V3RuntimeState = {
  sessionId: string;
  expiresAt: number;
  configVersion: string;
  modelReady: boolean;
};

type RealtimeSpeakTerminalState = 'tts.finished' | 'tts.canceled' | 'tts.error';

type RealtimeSpeakResult = {
  state: RealtimeSpeakTerminalState;
  rawEvent: LiveKitV3EventEnvelopeServer;
};

const stateByBaseUrl = new Map<string, V3RuntimeState>();
const FALLBACK_FAKE_AUDIO_BYTES = 160;
const REALTIME_TTS_TIMEOUT_MS = 45_000;

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

// 确保与后端的实时连接已建立，部分后端实现会在模型切换前校验连接状态与 participant identity
const ensureRealtimeConnected = async (baseUrl: string, reason: string, signal?: AbortSignal): Promise<boolean> => {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!normalizedBaseUrl) return false;
  try {
    await ensureLiveKitRoomConnected(normalizedBaseUrl, {
      signal,
      reason,
      eventTopic: 'v3.event',
    });
    return true;
  } catch (e) {
    // 连接失败时不直接 toast，由上层决定是否降级/提示。
    warn('ai.tts.v3', 'livekit.connect.failed', {
      baseUrl: normalizedBaseUrl,
      reason,
      err: String(e instanceof Error ? e.message : e),
    });
    return false;
  }
};

const ensureSession = async (baseUrl: string, signal?: AbortSignal): Promise<string> => {
  const cached = stateByBaseUrl.get(baseUrl);
  if (cached && cached.expiresAt > Date.now() + 5000) {
    return cached.sessionId;
  }

  const session = await ensureLiveKitSession(
    baseUrl,
    {
      client: 'desktop',
      version: '0.1.0',
      capabilities: {
        livekit: true,
        audioDownlink: true,
      },
    },
    signal,
  );

  const expiresInMs = Math.max(30, session.livekit.expiresIn) * 1000;
  const nextState: V3RuntimeState = {
    sessionId: session.sessionId,
    expiresAt: Date.now() + expiresInMs,
    configVersion: cached?.configVersion ?? '',
    modelReady: cached?.modelReady ?? false,
  };
  stateByBaseUrl.set(baseUrl, nextState);

  // 关键：v3 链路可能依赖 LiveKit participant identity。
  // 这里做“尽力而为”的 room connect：失败只记日志，避免阻塞 HTTP fallback。
  await ensureRealtimeConnected(baseUrl, 'session-created', signal);

  return session.sessionId;
};

const createAbortError = (): DOMException => new DOMException('The operation was aborted', 'AbortError');

const waitRealtimeSpeakTerminalEvent = async (
  baseUrl: string,
  requestId: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<RealtimeSpeakResult> => {
  return new Promise<RealtimeSpeakResult>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error(`实时 TTS 等待超时（${REALTIME_TTS_TIMEOUT_MS}ms）`));
    }, REALTIME_TTS_TIMEOUT_MS);

    const onAbort = () => {
      cleanup();
      reject(createAbortError());
    };

    const off = subscribeLiveKitV3Events(baseUrl, (event) => {
      if (event.request_id !== requestId) return;
      if (event.session_id && event.session_id !== sessionId) return;

      const eventType = trimText(event.type);
      if (eventType !== 'tts.finished' && eventType !== 'tts.canceled' && eventType !== 'tts.error') {
        return;
      }

      cleanup();
      resolve({
        state: eventType,
        rawEvent: event,
      });
    });

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      try {
        off();
      } catch {
        // ignore
      }
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    };

    if (signal?.aborted) {
      cleanup();
      reject(createAbortError());
      return;
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
};

const buildRealtimeTtsEventEnvelope = (
  requestId: string,
  sessionId: string,
  speakPayload: ReturnType<typeof buildTtsPayload>,
): LiveKitV3EventEnvelopeServer<Record<string, unknown>> => {
  return {
    type: 'tts.speak',
    session_id: sessionId,
    request_id: requestId,
    ts: Date.now(),
    payload: speakPayload.payload as unknown as Record<string, unknown>,
  };
};

const createRealtimeSyntheticResponse = (payload: RealtimeSpeakResult): Response => {
  const body = JSON.stringify({
    ok: payload.state === 'tts.finished',
    state: payload.state,
    request_id: payload.rawEvent.request_id,
    payload: payload.rawEvent.payload ?? {},
    // 兼容现有播放器：返回可解码的 base64 音频占位，避免 JSON 响应被判定为错误。
    // 主音频播放由 LiveKit 下行音轨承担，此处只用于打通现有运行时返回结构。
    audio_base64: 'AA==',
    mime_type: 'audio/wav',
  });

  return new Response(body, {
    status: payload.state === 'tts.error' ? 500 : 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-LiveKit-Realtime': '1',
      'X-Tts-Realtime-State': payload.state,
      'X-Tts-Realtime-Bytes': String(FALLBACK_FAKE_AUDIO_BYTES),
    },
  });
};

// 取消tts.speak的实时链路，通知后端中断合成并清理房间状态，避免残留音轨叠加导致回声/金属音。
const cancelRealtimeSpeakBestEffort = async (
  baseUrl: string,
  sessionId: string,
  requestId: string,
): Promise<void> => {
  try {
    await publishLiveKitV3Event(baseUrl, {
      type: 'tts.cancel',
      session_id: sessionId,
      request_id: requestId,
      ts: Date.now(),
      payload: {
        reason: 'realtime-fallback-http',
      },
    }, {
      eventTopic: 'v3.event',
      reason: 'tts.speak.fallback-cancel',
    });

    info('ai.tts.v3', 'realtime.speak.fallbackCancel.ok', {
      requestId,
      sessionId,
    });
  } catch (e) {
    warn('ai.tts.v3', 'realtime.speak.fallbackCancel.failed', {
      requestId,
      sessionId,
      err: String(e instanceof Error ? e.message : e),
    });
  }
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

  // 先确保 LiveKit 已连接（部分后端实现会在模型切换前校验 identity 是否入房）。
  await ensureRealtimeConnected(baseUrl, 'model-switch', signal);

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
      promptLang: trimText(config.promptLang) || 'auto',
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

// 模型预热
export const warmupTtsModel = async (
  config: TtsSynthesisRequest['config'],
  options?: { reason?: string; signal?: AbortSignal },
): Promise<void> => {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  if (!baseUrl) return;

  info('ai.tts.v3', 'warmup.connect.start', { baseUrl, reason: options?.reason });
  const connected = await ensureRealtimeConnected(baseUrl, `warmup:${options?.reason || 'auto'}`, options?.signal);
  if (connected) info('ai.tts.v3', 'warmup.connect.ok', { baseUrl, reason: options?.reason });

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
      textLang: trimText(config.textLang) || 'auto',
      promptLang: trimText(config.promptLang) || 'auto',
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
export const requestTtsSynthesis = async ({
  requestId,
  speakText,
  displayText,
  config,
  signal,
  preferRealtime = true,
}: TtsSynthesisRequest): Promise<Response> => {
  const cleanSpeakText = trimText(speakText);
  if (!cleanSpeakText) {
    throw new Error('TTS 文本为空，无法发起合成');
  }

  const baseUrl = normalizeBaseUrl(config.baseUrl);
  if (!baseUrl) {
    throw new Error('TTS 服务地址为空，请先在 TTS 设置中配置');
  }

  // speak 前确保 room 已连接，保证 identity 门禁通过。
  await ensureRealtimeConnected(baseUrl, 'tts.speak', signal);

  const sessionId = await ensureSession(baseUrl, signal);
  await ensureModelReady(baseUrl, sessionId, requestId, config, undefined, signal);

  const payload = buildTtsPayload(requestId, cleanSpeakText, trimText(displayText) || cleanSpeakText, sessionId, config);

  // LiveKit 主链路：通过 DataChannel 发 tts.speak，并等待后端终态事件。
  // 注意：真实音频播放由 livekit.realtime 中的 TrackSubscribed 自动处理。
  const realtimeEnvelope = buildRealtimeTtsEventEnvelope(requestId, sessionId, payload);
  const realtimeEnabled = preferRealtime
    ? await ensureRealtimeConnected(baseUrl, 'tts.speak.realtime', signal)
    : false;
  if (realtimeEnabled) {
    info('ai.tts.v3', 'realtime.speak.publish.start', {
      requestId,
      sessionId,
      eventTopic: 'v3.event',
    });

    try {
      const terminalPromise = waitRealtimeSpeakTerminalEvent(baseUrl, requestId, sessionId, signal);
      await publishLiveKitV3Event(baseUrl, realtimeEnvelope, {
        signal,
        eventTopic: 'v3.event',
        reason: 'tts.speak',
      });

      const terminal = await terminalPromise;
      info('ai.tts.v3', 'realtime.speak.terminal', {
        requestId,
        state: terminal.state,
      });

      if (terminal.state === 'tts.error') {
        throw new Error('实时 TTS 返回错误终态（tts.error）');
      }

      return createRealtimeSyntheticResponse(terminal);
    } catch (e) {
      warn('ai.tts.v3', 'realtime.speak.failed.fallbackHttp', {
        requestId,
        err: String(e instanceof Error ? e.message : e),
      });

      // 实时链路异常后，后端仍可能继续推送音轨。
      // fallback 到 HTTP 前先尝试 cancel 并断开本地房间，避免双路同播导致回音/金属音。
      await cancelRealtimeSpeakBestEffort(baseUrl, sessionId, requestId);
      disconnectLiveKitRoom(baseUrl);
      // 继续走 HTTP fallback
    }
  } else {
    // 直接走 HTTP 时，主动清理旧的 LiveKit 播放通道，避免残留音轨叠播。
    disconnectLiveKitRoom(baseUrl);
    if (!preferRealtime) {
      info('ai.tts.v3', 'realtime.speak.skippedByCaller', { requestId, reason: 'preferRealtime=false' });
    }
    warn('ai.tts.v3', 'realtime.speak.disabled.fallbackHttp', { requestId });
  }

  const endpoint = `${baseUrl}/v3/tts/speak`;

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

  // cancel 优先走 LiveKit DataChannel，确保实时链路可即时中断。
  const realtimeEnabled = await ensureRealtimeConnected(baseUrl, 'tts.cancel.realtime', signal);
  if (realtimeEnabled) {
    try {
      await publishLiveKitV3Event(baseUrl, {
        type: 'tts.cancel',
        session_id: cached.sessionId,
        request_id: requestId,
        ts: Date.now(),
        payload: {
          reason: trimText(reason) || 'user-cancel',
        },
      }, {
        signal,
        eventTopic: 'v3.event',
        reason: 'tts.cancel',
      });

      info('ai.tts.v3', 'realtime.cancel.ok', { requestId });
      return;
    } catch (e) {
      warn('ai.tts.v3', 'realtime.cancel.failed.fallbackHttp', {
        requestId,
        err: String(e instanceof Error ? e.message : e),
      });
      // fallback 到 HTTP cancel
    }
  }

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
