import { trimText, clampNumber, clampInteger, normalizeTextSplitMethod, buildConfigVersion } from '../domain/requestPolicy';
import { getJson, normalizeBaseUrl, postRequest } from './livekit/httpClient';
import { toModelSwitchServer, toTtsCancelServer, toTtsSpeakServer, toTtsPreheatServer, fromTtsPreheatServer } from './livekit/protocolMapper';
import {
  type LiveKitV3EventEnvelopeServer,
} from '@app/modules/ai/modules/tts/infrastructure/livekit/LiveKitGateway';
import type { LiveKitPort } from './livekit/LiveKitPort';
import type {
  LiveKitModelSwitchRequest,
  LiveKitModelSwitchResponseServer,
  LiveKitTtsSpeakRequest,
  LiveKitTtsPreheatResponseServer,
} from '@app/modules/ai/modules/tts/infrastructure/livekit/protocol';
import type { TtsCancelRequest, TtsSynthesisRequest } from '../domain/types';
import type { LogService, TraceScope } from '@app/shared/logging/LogService';
import { detectTtsTransportMode } from '@app/modules/ai/modules/tts/infrastructure/livekit/transportAdapter';

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

export type TtsClientDependencies = {
  log: LogService;
  liveKit: LiveKitPort;
};

const stateByBaseUrl = new Map<string, V3RuntimeState>();
const FALLBACK_FAKE_AUDIO_BYTES = 160;
const REALTIME_TTS_TIMEOUT_MS = 45_000;

// 确保与后端的实时连接已建立，部分后端实现会在模型切换前校验连接状态与 participant identity
const ensureRealtimeConnected = async (
  dependencies: TtsClientDependencies,
  baseUrl: string,
  reason: string,
  signal?: AbortSignal,
  trace?: TraceScope,
): Promise<boolean> => {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!normalizedBaseUrl) return false;
  try {
    await dependencies.liveKit.ensureRoomConnected(normalizedBaseUrl, {
      signal,
      reason,
      eventTopic: 'v3.event',
    });
    return true;
  } catch (e) {
    trace?.record('livekit.connect.failed', {
      baseUrl: normalizedBaseUrl,
      reason,
      err: String(e instanceof Error ? e.message : e),
    });
    return false;
  }
};

const ensureSession = async (
  dependencies: TtsClientDependencies,
  baseUrl: string,
  signal?: AbortSignal,
  trace?: TraceScope,
): Promise<string> => {
  const cached = stateByBaseUrl.get(baseUrl);
  if (cached && cached.expiresAt > Date.now() + 5000) {
    return cached.sessionId;
  }

  const session = await dependencies.liveKit.ensureSession(
    baseUrl,
    {
      client: 'desktop',
      version: '0.1.0',
      capabilities: {
        livekit: true,
        audioDownlink: true,
        transportMode: detectTtsTransportMode(baseUrl),
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
  trace?.record('session.resolved', { sessionId: session.sessionId, expiresInMs });
  await ensureRealtimeConnected(dependencies, baseUrl, 'session-created', signal, trace);

  return session.sessionId;
};

const createAbortError = (): DOMException => new DOMException('The operation was aborted', 'AbortError');

const isLiveKitUnavailableError = (error: unknown): boolean => {
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  if (!message || message.includes('timeout')) return false;
  return /livekit|room|websocket|ice|data channel|publish data|not connected|disconnected|connection/.test(message);
};

const waitRealtimeSpeakTerminalEvent = async (
  dependencies: TtsClientDependencies,
  baseUrl: string,
  requestId: string,
  sessionId: string,
  signal?: AbortSignal,
  queued = false,
): Promise<RealtimeSpeakResult> => {
  return new Promise<RealtimeSpeakResult>((resolve, reject) => {
    let timeoutId: number;
    let playbackStarted = !queued;
    const armTimeout = (timeoutMs: number) => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        cleanup();
        reject(new Error(`实时 TTS 等待超时（${timeoutMs}ms）`));
      }, timeoutMs);
    };

    const onAbort = () => {
      cleanup();
      reject(createAbortError());
    };

    const off = dependencies.liveKit.subscribeEvents(baseUrl, (event) => {
      if (event.request_id !== requestId) return;
      if (event.session_id && event.session_id !== sessionId) return;

      const eventType = trimText(event.type);
      if (eventType === 'tts.started') playbackStarted = true;
      if (eventType === 'tts.started' || (eventType === 'tts.chunk_meta' && playbackStarted)) {
        armTimeout(REALTIME_TTS_TIMEOUT_MS);
        return;
      }
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
    armTimeout(queued ? 600_000 : REALTIME_TTS_TIMEOUT_MS);
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
  dependencies: TtsClientDependencies,
  baseUrl: string,
  sessionId: string,
  requestId: string,
  trace?: TraceScope,
): Promise<void> => {
  try {
    await dependencies.liveKit.publishEvent(baseUrl, {
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

    trace?.record('realtime.speak.fallbackCancel.ok', {
      requestId,
      sessionId,
    });
  } catch (e) {
    trace?.record('realtime.speak.fallbackCancel.failed', {
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
  dependencies: TtsClientDependencies,
  baseUrl: string,
  sessionId: string,
  requestId: string,
  config: TtsSynthesisRequest['config'],
  signal?: AbortSignal,
  trace?: TraceScope,
): Promise<void> => {
  const configVersion = buildConfigVersion(config);
  const cached = stateByBaseUrl.get(baseUrl);
  if (cached && cached.configVersion === configVersion && cached.modelReady) {
    return;
  }

  // 先确保 LiveKit 已连接（部分后端实现会在模型切换前校验 identity 是否入房）。
  await ensureRealtimeConnected(dependencies, baseUrl, 'model-switch', signal, trace);

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
  trace?.record('model.switch.response', {
    requestId: request.requestId,
    configVersion,
    modelReady: Boolean(raw.model_ready),
  });

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
    throw new Error('模型未就绪（MODEL_NOT_READY），请检查权重配置与后端状态');
  }
};

// 模型预热
export const warmupTtsModel = async (
  dependencies: TtsClientDependencies,
  config: TtsSynthesisRequest['config'],
  options?: { reason?: string; signal?: AbortSignal },
): Promise<void> => {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  if (!baseUrl) return;

  const context = dependencies.log.contextRegistry.register('TtsClient', {
    relation: 'tts.warmup',
    params: { baseUrl, reason: options?.reason },
    behavior: '连接 LiveKit、创建后端会话并确保 TTS 模型可用',
  });
  const trace = context.beginTrace('warmup', { baseUrl, reason: options?.reason });
  try {
    await ensureRealtimeConnected(dependencies, baseUrl, `warmup:${options?.reason || 'auto'}`, options?.signal, trace);
    const sessionId = await ensureSession(dependencies, baseUrl, options?.signal, trace);
  const requestId = `warmup_${(options?.reason || 'auto').replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now().toString(36)}`;
    await ensureModelReady(dependencies, baseUrl, sessionId, requestId, config, options?.signal, trace);
    trace.end({ baseUrl, sessionId, requestId });
  } catch (error) {
    trace.fail('TTS 模型预热失败', { baseUrl, reason: options?.reason }, error);
    throw error;
  } finally {
    context.dispose();
  }
};

export const preheatTtsConfig = async (
  dependencies: TtsClientDependencies,
  config: TtsSynthesisRequest['config'],
  requestId: string,
) => {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  await dependencies.liveKit.ensureRoomConnected(baseUrl, { eventTopic: 'v3.event', reason: 'tts-config-preheat' });
  const session = await dependencies.liveKit.ensureSession(baseUrl, {
    client: 'desktop', version: '0.1.0', capabilities: { livekit: true, audioDownlink: true },
  });
  const body = toTtsPreheatServer({
    sessionId: session.sessionId, requestId, ts: Date.now(),
    payload: {
      textLang: trimText(config.textLang) || 'all_ja', promptLang: trimText(config.promptLang) || 'ja',
      refAudioPath: trimText(config.refAudioPath), promptText: trimText(config.refAudioText),
    },
  });
  return fromTtsPreheatServer(await postRequest<LiveKitTtsPreheatResponseServer>(baseUrl, '/v3/tts/preheat', body));
};

const buildTtsPayload = (
  requestId: string,
  traceId: string | undefined,
  speakText: string,
  displayText: string,
  sessionId: string,
  config: TtsSynthesisRequest['config'],
  queueGroupId?: string,
  sentenceIndex?: number,
) => {
  const request: LiveKitTtsSpeakRequest = {
    sessionId,
    requestId,
    ts: Date.now(),
    payload: {
      traceId: traceId || requestId,
      queueGroupId,
      sentenceIndex,
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
    },
  };

  return toTtsSpeakServer(request);
};

// 主链路固定由 LiveKit/WebRTC 传输 Opus，HTTP 回退固定为 Ogg/Opus。
export const requestTtsSynthesis = async (dependencies: TtsClientDependencies, {
  requestId,
  queueGroupId,
  sentenceIndex,
  onSubmitted,
  traceId,
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

  const context = dependencies.log.contextRegistry.register('TtsClient', {
    relation: 'tts.synthesis',
    params: { requestId, traceId: traceId || requestId, baseUrl, preferRealtime },
    behavior: '建立会话、发送 TTS 请求、等待后端终态并在需要时回退 HTTP',
  });
  const trace = context.beginTrace('requestTtsSynthesis', {
    requestId,
    traceId: traceId || requestId,
    speakLength: cleanSpeakText.length,
    preferRealtime,
  });

  try {

  // speak 前确保 room 已连接，保证 identity 门禁通过。
  await ensureRealtimeConnected(dependencies, baseUrl, 'tts.speak', signal, trace);

  const sessionId = await ensureSession(dependencies, baseUrl, signal, trace);
  await ensureModelReady(dependencies, baseUrl, sessionId, requestId, config, signal, trace);

  const payload = buildTtsPayload(
    requestId,
    traceId,
    cleanSpeakText,
    trimText(displayText) || cleanSpeakText,
    sessionId,
    config,
    queueGroupId,
    sentenceIndex,
  );

  // LiveKit 主链路：通过 DataChannel 发 tts.speak，并等待后端终态事件。
  // 注意：真实音频播放由 LiveKitService 中的 TrackSubscribed 自动处理。
  const realtimeEnvelope = buildRealtimeTtsEventEnvelope(requestId, sessionId, payload);
  const realtimeEnabled = preferRealtime
    ? await ensureRealtimeConnected(dependencies, baseUrl, 'tts.speak.realtime', signal, trace)
    : false;
  if (realtimeEnabled) {
    const terminalController = new AbortController();
    const abortTerminal = () => terminalController.abort();
    signal?.addEventListener('abort', abortTerminal, { once: true });
    if (signal?.aborted) abortTerminal();
    let backendTerminalFailure = false;
    try {
      const terminalPromise = waitRealtimeSpeakTerminalEvent(dependencies, baseUrl, requestId, sessionId,
        terminalController.signal, Boolean(queueGroupId));
      void terminalPromise.catch(() => undefined);
      await dependencies.liveKit.publishEvent(baseUrl, realtimeEnvelope, {
        signal,
        eventTopic: 'v3.event',
        reason: 'tts.speak',
      });
      onSubmitted?.();

      const terminal = await terminalPromise;
      if (terminal.state === 'tts.error') {
        backendTerminalFailure = true;
        const error = (terminal.rawEvent.payload as { error?: { code?: string; message?: string } } | undefined)?.error;
        throw new Error(`TTS 合成失败: ${error?.code || 'TTS_ENGINE_ERROR'}${error?.message ? `, ${error.message}` : ''}`);
      }

      const response = createRealtimeSyntheticResponse(terminal);
      trace.end({ requestId, sessionId, transport: 'livekit', terminalState: terminal.state });
      return response;
    } catch (e) {
      if (backendTerminalFailure || !isLiveKitUnavailableError(e)) {
        trace.record('realtime.speak.failed.noFallback', {
          requestId,
          err: String(e instanceof Error ? e.message : e),
        });
        throw e;
      }
      trace.record('realtime.speak.failed.fallbackHttp', {
        requestId,
        err: String(e instanceof Error ? e.message : e),
      });

      // 实时链路异常后，后端仍可能继续推送音轨。
      // fallback 到 HTTP 前先尝试 cancel 并断开本地房间，避免双路同播导致回音/金属音。
      await cancelRealtimeSpeakBestEffort(dependencies, baseUrl, sessionId, requestId, trace);
      dependencies.liveKit.disconnectRoom(baseUrl);
      // 继续走 HTTP fallback
    } finally {
      signal?.removeEventListener('abort', abortTerminal);
      terminalController.abort();
    }
  } else {
    // 直接走 HTTP 时，主动清理旧的 LiveKit 播放通道，避免残留音轨叠播。
    dependencies.liveKit.disconnectRoom(baseUrl);
    if (!preferRealtime) {
      trace.record('realtime.speak.skippedByCaller', { requestId, reason: 'preferRealtime=false' });
    }
    trace.record('realtime.speak.disabled.fallbackHttp', { requestId });
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

  trace.end({ requestId, sessionId, transport: 'http', status: response.status });
  return response;
  } catch (error) {
    trace.fail('TTS 合成请求失败', { requestId, baseUrl, preferRealtime }, error);
    throw error;
  } finally {
    context.dispose();
  }
};

export const cancelTtsSynthesis = async (
  dependencies: TtsClientDependencies,
  { requestId, reason, config, signal }: TtsCancelRequest,
): Promise<void> => {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  if (!baseUrl) return;

  const cached = stateByBaseUrl.get(baseUrl);
  if (!cached?.sessionId) return;

  const context = dependencies.log.contextRegistry.register('TtsClient', {
    relation: 'tts.cancel',
    params: { requestId, sessionId: cached.sessionId, reason },
    behavior: '取消实时或 HTTP TTS 请求并等待发送完成',
  });
  const trace = context.beginTrace('cancelTtsSynthesis', { requestId, reason });

  try {

  // cancel 优先走 LiveKit DataChannel，确保实时链路可即时中断。
  const realtimeEnabled = await ensureRealtimeConnected(dependencies, baseUrl, 'tts.cancel.realtime', signal, trace);
  if (realtimeEnabled) {
    try {
      await dependencies.liveKit.publishEvent(baseUrl, {
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

      trace.end({ requestId, transport: 'livekit' });
      return;
    } catch (e) {
      trace.record('realtime.cancel.failed.fallbackHttp', {
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
  trace.end({ requestId, transport: 'http' });
  } catch (error) {
    trace.fail('TTS 取消请求失败', { requestId, baseUrl }, error);
    throw error;
  } finally {
    context.dispose();
  }
};
