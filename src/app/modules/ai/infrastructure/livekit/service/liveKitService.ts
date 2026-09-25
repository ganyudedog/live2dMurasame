import {
  LiveKitApiError,
  type HttpRequestOptions,
  type LiveKitModelSwitchRequest,
  type LiveKitModelSwitchRequestServer,
  type LiveKitModelSwitchResponse,
  type LiveKitModelSwitchResponseServer,
  type LiveKitSessionCreatePayload,
  type LiveKitSessionCreatePayloadServer,
  type LiveKitSessionCreateResponse,
  type LiveKitSessionCreateResponseServer,
  type LiveKitTtsCancelRequest,
  type LiveKitTtsCancelRequestServer,
  type LiveKitTtsPreheatRequest,
  type LiveKitTtsPreheatRequestServer,
  type LiveKitTtsPreheatResponse,
  type LiveKitTtsPreheatResponseServer,
  type LiveKitTtsSpeakRequest,
  type LiveKitTtsSpeakRequestServer,
} from "../model/liveKitModel";

import {
  ConnectionState,
  DataPacket_Kind,
  Room,
  RoomEvent,
  type Participant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteParticipant,
} from 'livekit-client';

import type { LogService, TraceScope } from '@app/shared/logging/LogService';
import type {
  LiveKitPlaybackFeedbackPayload,
  LiveKitPlaybackFeedbackRequest,
  LiveKitPlaybackFeedbackState,
} from '../model/liveKitModel';
import {
  applyReceiverBufferingProfile,
  detectTtsTransportMode,
  resolveLiveKitTransportProfile,
  type LiveKitTransportMode,
  type LiveKitTransportProfile,
} from './liveKitTransportAdapter';

export type LiveKitV3EventEnvelopeServer<TPayload = unknown> = {
  type: string;
  session_id?: string;
  request_id?: string;
  ts?: number;
  payload?: TPayload;
};

export type LiveKitV3EventHandler = (event: LiveKitV3EventEnvelopeServer, ctx: {
  topic?: string;
  participant?: Participant;
  kind?: DataPacket_Kind;
}) => void;

type SessionCache = {
  session: LiveKitSessionCreateResponse;
  expiresAt: number;
};

type RoomCache = {
  room: Room;
  baseUrl: string;
  wsUrl: string;
  token: string;
  connectedAt: number;
  eventTopic: string;
  audioEl: HTMLAudioElement;
  attachedAudioTrackSid: string | null;
  attachedAudioTrack: RemoteTrack | null;
  transportProfile: LiveKitTransportProfile;
  playbackEstimator: {
    trackSid: string | null;
    lastTickAt: number;
    lastProducedTotalMs: number;
    estimatedQueueMs: number;
  };
  handlers: Set<LiveKitV3EventHandler>;
  requestTraces: Map<string, TraceScope>;
};

export type LiveKitPlaybackFeedbackSnapshot = LiveKitPlaybackFeedbackPayload & {
  updatedAt: number;
  playing: boolean;
  ended: boolean;
  paused: boolean;
  hasAudioTrack: boolean;
  trackSid: string | null;
};

const DEFAULT_EVENT_TOPIC = 'v3.event';
const sessionByBaseUrl = new Map<string, SessionCache>();
const roomByBaseUrl = new Map<string, RoomCache>();
const connectPromiseByBaseUrl = new Map<string, Promise<RoomCache>>();

const now = () => Date.now();
let activeLogService: LogService | null = null;

const emitLiveKitLog = (
  level: 'debug' | 'info' | 'warn',
  namespace: string,
  event: string,
  data?: Record<string, unknown>,
  cause?: unknown,
): void => {
  if (!activeLogService) return;
  const context = activeLogService.contextRegistry.register('LiveKitService', {
    relation: namespace,
    params: data,
    behavior: '记录 LiveKit HTTP、房间、事件和后端回环链路',
  });
  const trace = context.beginTrace(event, data);
  if (level === 'warn') trace.fail(event, data, cause);
  else trace.end(data);
  context.dispose();
};

const debug = (namespace: string, event: string, data?: Record<string, unknown>): void => {
  emitLiveKitLog('debug', namespace, event, data);
};
const info = (namespace: string, event: string, data?: Record<string, unknown>): void => {
  emitLiveKitLog('info', namespace, event, data);
};
const warn = (namespace: string, event: string, data?: Record<string, unknown>, cause?: unknown): void => {
  emitLiveKitLog('warn', namespace, event, data, cause);
};

const beginLiveKitTrace = (operation: string, data: Record<string, unknown>): TraceScope | null => {
  if (!activeLogService) return null;
  const context = activeLogService.contextRegistry.register('LiveKitService', {
    relation: 'backend.loopback',
    params: data,
    behavior: '关联 LiveKit 前端请求和后端回环事件',
  });
  const trace = context.beginTrace(operation, data);
  context.dispose();
  return trace;
};

const ensureHiddenAudioElement = (baseUrl: string): HTMLAudioElement => {
  const el = document.createElement('audio');
  el.autoplay = true;
  el.controls = false;
  el.muted = false;
  el.volume = 1;
  el.preload = 'auto';
  el.setAttribute('data-livekit-audio', normalizeBaseUrl(baseUrl));
  el.style.display = 'none';
  try {
    document.body?.appendChild(el);
  } catch {
    // ignore
  }
  return el;
};

const safeDecodeText = (payload: Uint8Array): string => {
  try {
    return new TextDecoder().decode(payload);
  } catch {
    try {
      return String.fromCharCode(...payload);
    } catch {
      return '';
    }
  }
};

const safeJsonParse = (text: string): unknown => {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const getBufferedMilliseconds = (audioEl: HTMLAudioElement): number => {
  try {
    if (!audioEl.buffered || audioEl.buffered.length === 0) return 0;

    const currentTime = Number.isFinite(audioEl.currentTime) ? audioEl.currentTime : 0;
    for (let idx = 0; idx < audioEl.buffered.length; idx += 1) {
      const start = audioEl.buffered.start(idx);
      const end = audioEl.buffered.end(idx);
      if (currentTime >= start && currentTime <= end) {
        return Math.max(0, Math.round((end - currentTime) * 1000));
      }
    }

    const lastEnd = audioEl.buffered.end(audioEl.buffered.length - 1);
    return Math.max(0, Math.round((lastEnd - currentTime) * 1000));
  } catch {
    return -1;
  }
};

const extractInboundAudioStats = (stats: RTCStatsReport): {
  jitterMs: number;
  jitterBufferMs: number;
  totalSamplesDurationMs: number;
} => {
  type InboundAudioStats = {
    jitter?: number;
    jitterBufferDelay?: number;
    jitterBufferEmittedCount?: number;
    totalSamplesDuration?: number;
  };

  let inboundAudioStats: InboundAudioStats | null = null;

  stats.forEach((item) => {
    if (item.type !== 'inbound-rtp') return;
    const typedItem = item as {
      kind?: string;
      mediaType?: string;
      jitter?: number;
      jitterBufferDelay?: number;
      jitterBufferEmittedCount?: number;
      totalSamplesDuration?: number;
    };
    if (typedItem.kind !== 'audio' && typedItem.mediaType !== 'audio') return;
    inboundAudioStats = typedItem;
  });

  if (!inboundAudioStats) {
    return {
      jitterMs: -1,
      jitterBufferMs: -1,
      totalSamplesDurationMs: -1,
    };
  }

  const {
    jitter,
    jitterBufferDelay,
    jitterBufferEmittedCount,
    totalSamplesDuration,
  } = inboundAudioStats;

  const jitterMs = typeof jitter === 'number' && Number.isFinite(jitter)
    ? Math.round(jitter * 1000)
    : -1;

  const jitterBufferMs = typeof jitterBufferDelay === 'number'
    && Number.isFinite(jitterBufferDelay)
    && typeof jitterBufferEmittedCount === 'number'
    && jitterBufferEmittedCount > 0
    ? Math.round((jitterBufferDelay / jitterBufferEmittedCount) * 1000)
    : -1;

  const totalSamplesDurationMs = typeof totalSamplesDuration === 'number'
    && Number.isFinite(totalSamplesDuration)
    ? Math.round(totalSamplesDuration * 1000)
    : -1;

  return {
    jitterMs,
    jitterBufferMs,
    totalSamplesDurationMs,
  };
};

const classifyPlaybackState = (
  audioEl: HTMLAudioElement,
  bufferMs: number,
  lowWaterMs: number,
  highWaterMs: number,
  transportMode: LiveKitTransportMode,
): LiveKitPlaybackFeedbackState => {
  if (audioEl.ended) return 'draining';
  if (audioEl.paused && !audioEl.ended) return 'paused';
  if (bufferMs < 0) return 'unknown';
  if (transportMode === 'loopback') return 'ok';
  if (bufferMs <= lowWaterMs) return 'low';
  if (bufferMs >= highWaterMs) return 'high';
  return 'ok';
};

const readPlaybackSnapshot = async (cache: RoomCache): Promise<LiveKitPlaybackFeedbackSnapshot | null> => {
  const { audioEl } = cache;
  if (!audioEl) return null;

  const {
    mode: transportMode,
    lowWaterMs,
    targetWaterMs,
    highWaterMs,
  } = cache.transportProfile;
  const hasAudioTrack = Boolean(cache.attachedAudioTrackSid);
  if (!hasAudioTrack) return null;

  const nowMs = Date.now();
  const bufferFromAudioElementMs = getBufferedMilliseconds(audioEl);
  let jitterMs = -1;
  let jitterBufferMs = -1;
  let totalSamplesDurationMs = -1;
  let producedDeltaMs = 0;
  let consumedDeltaMs = 0;

  const audioTrack = cache.attachedAudioTrack;
  if (audioTrack && typeof (audioTrack as RemoteTrack & { receiver?: RTCRtpReceiver }).receiver?.getStats === 'function') {
    try {
      const receiverStats = await (audioTrack as RemoteTrack & { receiver: RTCRtpReceiver }).receiver!.getStats();
      const extracted = extractInboundAudioStats(receiverStats);
      jitterMs = extracted.jitterMs;
      jitterBufferMs = extracted.jitterBufferMs;
      totalSamplesDurationMs = extracted.totalSamplesDurationMs;
    } catch (e) {
      warn('livekit.service', 'audio.receiverStats.failed', {
        trackSid: cache.attachedAudioTrackSid,
        err: String(e instanceof Error ? e.message : e),
      });
    }
  }

  const estimator = cache.playbackEstimator;
  if (estimator.trackSid !== cache.attachedAudioTrackSid) {
    resetPlaybackEstimator(cache);
    estimator.trackSid = cache.attachedAudioTrackSid;
  }

  const tickElapsedMs = estimator.lastTickAt > 0
    ? Math.max(0, nowMs - estimator.lastTickAt)
    : 0;
  estimator.lastTickAt = nowMs;

  const playbackRate = Number.isFinite(audioEl.playbackRate)
    ? Math.max(0, audioEl.playbackRate)
    : 1;
  consumedDeltaMs = !audioEl.paused && !audioEl.ended
    ? Math.round(tickElapsedMs * playbackRate)
    : 0;

  if (totalSamplesDurationMs >= 0 && estimator.lastProducedTotalMs >= 0) {
    producedDeltaMs = Math.max(0, Math.round(totalSamplesDurationMs - estimator.lastProducedTotalMs));
  }
  if (totalSamplesDurationMs >= 0) {
    estimator.lastProducedTotalMs = totalSamplesDurationMs;
  }

  if (estimator.estimatedQueueMs <= 0) {
    if (jitterBufferMs > 0) {
      estimator.estimatedQueueMs = jitterBufferMs;
    } else if (bufferFromAudioElementMs > 0) {
      estimator.estimatedQueueMs = bufferFromAudioElementMs;
    }
  }

  estimator.estimatedQueueMs = Math.max(
    0,
    estimator.estimatedQueueMs + producedDeltaMs - consumedDeltaMs,
  );

  const resolvedBufferMs = estimator.estimatedQueueMs > 0
    ? Math.round(estimator.estimatedQueueMs)
    : jitterBufferMs > 0
      ? jitterBufferMs
      : bufferFromAudioElementMs > 0
        ? bufferFromAudioElementMs
        : -1;

  const snapshot: LiveKitPlaybackFeedbackSnapshot = {
    state: classifyPlaybackState(audioEl, resolvedBufferMs, lowWaterMs, highWaterMs, transportMode),
    bufferMs: resolvedBufferMs,
    lowWaterMs,
    targetWaterMs,
    highWaterMs,
    transportMode,
    source: 'frontend',
    latencyMs: -1,
    jitterMs,
    producedDeltaMs,
    consumedDeltaMs,
    estimatedQueueMs: Math.round(estimator.estimatedQueueMs),
    estimatorVersion: 'jitter-delta-v1',
    updatedAt: Date.now(),
    playing: !audioEl.paused && !audioEl.ended,
    ended: audioEl.ended,
    paused: audioEl.paused,
    hasAudioTrack,
    trackSid: cache.attachedAudioTrackSid,
  };

  return snapshot;
};

const resetPlaybackEstimator = (cache: RoomCache): void => {
  cache.playbackEstimator.trackSid = null;
  cache.playbackEstimator.lastTickAt = 0;
  cache.playbackEstimator.lastProducedTotalMs = -1;
  cache.playbackEstimator.estimatedQueueMs = 0;
};

export const getCachedLiveKitSession = (baseUrl: string): LiveKitSessionCreateResponse | null => {
  const key = normalizeBaseUrl(baseUrl);
  const cached = sessionByBaseUrl.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= now() + 2000) return null;
  return cached.session;
};

export const ensureLiveKitSession = async (
  baseUrl: string,
  payload?: LiveKitSessionCreatePayload,
  signal?: AbortSignal,
): Promise<LiveKitSessionCreateResponse> => {
  const key = normalizeBaseUrl(baseUrl);
  const cached = sessionByBaseUrl.get(key);
  if (cached && cached.expiresAt > now() + 5000) {
    return cached.session;
  }

  const body = toSessionCreateServer(
    payload ?? {
      client: 'desktop',
      version: '0.1.0',
      capabilities: {
        livekit: true,
        audioDownlink: true,
        transportMode: detectTtsTransportMode(key),
      },
    },
  );

  info('livekit.service', 'session.create.start', { baseUrl: key, client: body.client });

  let raw: LiveKitSessionCreateResponseServer;
  try {
    raw = await postRequest<LiveKitSessionCreateResponseServer>(key, '/v3/session/create', body, signal);
  } catch (e) {
    // 注意：这里用 warn，避免在自动连接场景弹 toast。
    warn('livekit.service', 'session.create.failed', {
      baseUrl: key,
      err: String(e instanceof Error ? e.message : e),
    });
    throw e;
  }

  const session = fromSessionCreateServer(raw);
  const expiresAt = now() + Math.max(30, session.livekit.expiresIn) * 1000;
  sessionByBaseUrl.set(key, { session, expiresAt });

  info('livekit.service', 'session.create.ok', {
    baseUrl: key,
    sessionId: session.sessionId,
    roomName: session.roomName,
    identity: session.participantIdentity,
    expiresIn: session.livekit.expiresIn,
  });

  return session;
};

const attachAudioTrack = (
  cache: RoomCache,
  track: RemoteTrack,
  publication: RemoteTrackPublication,
  participant: RemoteParticipant,
) => {
  if (track.kind !== 'audio') return;

  try {
    // 某些重连/重复订阅场景会重复触发 TrackSubscribed，
    // 同一个 trackSid 已附着时直接跳过，避免同轨叠加导致金属音/回声感。
    if (cache.attachedAudioTrackSid === publication.trackSid && cache.attachedAudioTrack === track) {
      debug('livekit.service', 'audio.track.attachSkipSameTrack', {
        trackSid: publication.trackSid,
        participant: participant.identity,
      });
      return;
    }

    if (cache.attachedAudioTrackSid === publication.trackSid && cache.attachedAudioTrack && cache.attachedAudioTrack !== track) {
      debug('livekit.service', 'audio.track.replaceSameSid', {
        trackSid: publication.trackSid,
        participant: participant.identity,
      });

      cache.attachedAudioTrack.detach(cache.audioEl);
      cache.attachedAudioTrack = null;
      cache.attachedAudioTrackSid = null;
      resetPlaybackEstimator(cache);
    }

    if (cache.attachedAudioTrackSid && cache.attachedAudioTrackSid !== publication.trackSid) {
      debug('livekit.service', 'audio.track.replace', {
        prev: cache.attachedAudioTrackSid,
        next: publication.trackSid,
      });
      try {
        cache.attachedAudioTrack?.detach(cache.audioEl);
      } catch {
        // ignore
      }
      resetPlaybackEstimator(cache);
    }

    cache.attachedAudioTrackSid = publication.trackSid;
    cache.attachedAudioTrack = track;
    resetPlaybackEstimator(cache);
    cache.playbackEstimator.trackSid = publication.trackSid;
    applyReceiverBufferingProfile(
      (track as RemoteTrack & { receiver?: RTCRtpReceiver }).receiver,
      cache.transportProfile,
    );
    track.attach(cache.audioEl);
    void cache.audioEl.play().catch(() => {
      // 浏览器/系统可能限制 autoplay；这里只记日志不抛错。
      warn('livekit.service', 'audio.play.blocked', { trackSid: publication.trackSid });
    });

    info('livekit.service', 'audio.track.attached', {
      trackSid: publication.trackSid,
      participant: participant.identity,
      transportMode: cache.transportProfile.mode,
    });
  } catch (e) {
    warn('livekit.service', 'audio.track.attachFailed', {
      trackSid: publication.trackSid,
      err: String(e instanceof Error ? e.message : e),
    });
  }
};

const bindRoomLoggingAndHandlers = (cache: RoomCache) => {
  const { room } = cache;

  room
    .on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
      info('livekit.service', 'room.state', { state, baseUrl: cache.baseUrl });
    })
    .on(RoomEvent.Reconnecting, () => {
      warn('livekit.service', 'room.reconnecting', { baseUrl: cache.baseUrl });
    })
    .on(RoomEvent.Reconnected, () => {
      info('livekit.service', 'room.reconnected', { baseUrl: cache.baseUrl });
    })
    .on(RoomEvent.Disconnected, (reason?: unknown) => {
      warn('livekit.service', 'room.disconnected', {
        baseUrl: cache.baseUrl,
        reason: String(reason ?? ''),
      });
    })
    .on(RoomEvent.DataReceived, (payload, participant, kind, topic) => {
      if (topic && topic !== cache.eventTopic) return;

      const text = safeDecodeText(payload);
      const parsed = safeJsonParse(text);
      if (!parsed || typeof parsed !== 'object') {
        warn('livekit.service', 'event.parseFailed', { topic, sample: text.slice(0, 200) });
        return;
      }

      const envelope = parsed as LiveKitV3EventEnvelopeServer;
      const loopbackData = {
        topic,
        type: envelope.type,
        sessionId: envelope.session_id,
        requestId: envelope.request_id,
        payload: envelope.payload,
        direction: 'inbound',
      };
      debug('livekit.service', 'event.received', loopbackData);
      const requestTrace = envelope.request_id ? cache.requestTraces.get(envelope.request_id) : undefined;
      requestTrace?.record('backend.event.received', loopbackData);
      if (requestTrace && envelope.type === 'tts.error') {
        requestTrace.fail('LiveKit 后端返回 TTS 错误', loopbackData);
        cache.requestTraces.delete(envelope.request_id!);
      } else if (requestTrace && (envelope.type === 'tts.finished' || envelope.type === 'tts.canceled')) {
        requestTrace.end(loopbackData);
        cache.requestTraces.delete(envelope.request_id!);
      }

      cache.handlers.forEach((handler) => {
        try {
          handler(envelope, { topic, participant: participant ?? undefined, kind });
        } catch (e) {
          warn('livekit.service', 'event.handlerFailed', {
            err: String(e instanceof Error ? e.message : e),
            type: envelope.type,
          });
        }
      });
    })
    .on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      attachAudioTrack(cache, track as RemoteTrack, publication, participant);
    })
    .on(RoomEvent.TrackUnsubscribed, (track, publication) => {
      if (track.kind !== 'audio') return;
      if (cache.attachedAudioTrackSid !== publication.trackSid) return;
      try {
        cache.attachedAudioTrack?.detach(cache.audioEl);
      } catch {
        // ignore
      }
      cache.attachedAudioTrack = null;
      cache.attachedAudioTrackSid = null;
      resetPlaybackEstimator(cache);
      info('livekit.service', 'audio.track.detached', { trackSid: publication.trackSid });
    });
};

export const ensureLiveKitRoomConnected = async (
  baseUrl: string,
  options?: {
    signal?: AbortSignal;
    eventTopic?: string;
    sessionPayload?: LiveKitSessionCreatePayload;
    reason?: string;
  },
): Promise<RoomCache> => {
  const key = normalizeBaseUrl(baseUrl);
  const existing = roomByBaseUrl.get(key);
  const desiredTopic = options?.eventTopic?.trim() || DEFAULT_EVENT_TOPIC;

  if (existing) {
    const sameSession = existing.eventTopic === desiredTopic;
    const connected = existing.room.state === ConnectionState.Connected;
    if (sameSession && connected) return existing;
  }

  const inflight = connectPromiseByBaseUrl.get(key);
  if (inflight) return inflight;

  const promise = (async () => {
    if (options?.signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');

    const session = await ensureLiveKitSession(key, options?.sessionPayload, options?.signal);
    const wsUrl = session.livekit.wsUrl;
    const token = session.livekit.token;

    info('livekit.service', 'room.connect.start', {
      baseUrl: key,
      wsUrl,
      roomName: session.roomName,
      identity: session.participantIdentity,
      reason: options?.reason,
    });

    // 若已有 room（但断开/topic 不同），先清理（复用 audio 元素与 handlers，避免泄漏）。
    const reuseHandlers = existing?.handlers ?? new Set<LiveKitV3EventHandler>();
    const reuseAudioEl = existing?.audioEl ?? ensureHiddenAudioElement(key);

    if (existing) {
      try {
        existing.attachedAudioTrack?.detach(reuseAudioEl);
      } catch {
        // ignore
      }
      try {
        existing.room.disconnect();
      } catch {
        // ignore
      }
      roomByBaseUrl.delete(key);
    }

    const room = new Room();
    const audioEl = reuseAudioEl;
    const transportProfile = resolveLiveKitTransportProfile(key, wsUrl, session.transportMode);

    const cache: RoomCache = {
      room,
      baseUrl: key,
      wsUrl,
      token,
      connectedAt: now(),
      eventTopic: desiredTopic,
      audioEl,
      attachedAudioTrackSid: null,
      attachedAudioTrack: null,
      transportProfile,
      playbackEstimator: {
        trackSid: null,
        lastTickAt: 0,
        lastProducedTotalMs: -1,
        estimatedQueueMs: 0,
      },
      handlers: reuseHandlers,
      requestTraces: existing?.requestTraces ?? new Map<string, TraceScope>(),
    };

    bindRoomLoggingAndHandlers(cache);

    // connect 不支持 AbortSignal，这里做一次 race + 事后 disconnect。
    const abortPromise = new Promise<never>((_, reject) => {
      if (!options?.signal) return;
      const onAbort = () => reject(new DOMException('The operation was aborted', 'AbortError'));
      options.signal.addEventListener('abort', onAbort, { once: true });
    });

    try {
      await Promise.race([
        room.connect(wsUrl, token, {
          autoSubscribe: true,
        }),
        abortPromise,
      ]);
    } catch (e) {
      try {
        room.disconnect();
      } catch {
        // ignore
      }
      warn('livekit.service', 'room.connect.failed', {
        baseUrl: key,
        err: String(e instanceof Error ? e.message : e),
      });
      throw e;
    }

    info('livekit.service', 'room.connect.ok', {
      baseUrl: key,
      state: room.state,
      identity: room.localParticipant?.identity,
      transportMode: transportProfile.mode,
    });

    roomByBaseUrl.set(key, cache);
    return cache;
  })().finally(() => {
    connectPromiseByBaseUrl.delete(key);
  });

  connectPromiseByBaseUrl.set(key, promise);
  return promise;
};

export const disconnectLiveKitRoom = (baseUrl: string): void => {
  const key = normalizeBaseUrl(baseUrl);
  const cache = roomByBaseUrl.get(key);
  if (!cache) return;

  info('livekit.service', 'room.disconnect', { baseUrl: key });
  try {
    cache.room.disconnect();
  } catch {
    // ignore
  }

  try {
    cache.attachedAudioTrack?.detach(cache.audioEl);
  } catch {
    // ignore
  }

  resetPlaybackEstimator(cache);

  try {
    cache.audioEl.remove();
  } catch {
    // ignore
  }

  roomByBaseUrl.delete(key);
  for (const [requestId, trace] of cache.requestTraces) {
    trace.end({ requestId, status: 'room-disconnected' });
  }
  cache.requestTraces.clear();
};

export const getLiveKitPlaybackSnapshot = async (baseUrl: string): Promise<LiveKitPlaybackFeedbackSnapshot | null> => {
  const key = normalizeBaseUrl(baseUrl);
  const cache = roomByBaseUrl.get(key);
  if (!cache) return null;
  return readPlaybackSnapshot(cache);
};

export const publishLiveKitPlaybackFeedback = async (
  baseUrl: string,
  request: LiveKitPlaybackFeedbackRequest,
  options?: { signal?: AbortSignal; eventTopic?: string; reason?: string },
): Promise<void> => {
  await publishLiveKitV3Event(baseUrl, {
    type: 'playback.feedback',
    session_id: request.sessionId,
    request_id: request.requestId,
    ts: request.ts ?? Date.now(),
    payload: {
      state: request.payload.state,
      buffer_ms: request.payload.bufferMs,
      low_water_ms: request.payload.lowWaterMs,
      target_water_ms: request.payload.targetWaterMs,
      high_water_ms: request.payload.highWaterMs,
      transport_mode: request.payload.transportMode,
      source: request.payload.source ?? 'frontend',
      latency_ms: request.payload.latencyMs ?? -1,
      jitter_ms: request.payload.jitterMs ?? -1,
      produced_delta_ms: request.payload.producedDeltaMs ?? 0,
      consumed_delta_ms: request.payload.consumedDeltaMs ?? 0,
      estimated_queue_ms: request.payload.estimatedQueueMs ?? request.payload.bufferMs,
      estimator_version: request.payload.estimatorVersion ?? 'jitter-delta-v1',
    },
  }, {
    signal: options?.signal,
    eventTopic: options?.eventTopic ?? DEFAULT_EVENT_TOPIC,
    reason: options?.reason ?? 'tts-playback-feedback',
  });
};

export const subscribeLiveKitV3Events = (baseUrl: string, handler: LiveKitV3EventHandler): (() => void) => {
  const key = normalizeBaseUrl(baseUrl);
  const cache = roomByBaseUrl.get(key);
  if (cache) {
    cache.handlers.add(handler);
    return () => {
      cache.handlers.delete(handler);
    };
  }

  // 未连接时也允许提前订阅：先挂到一个惰性容器里。
  const lazy: RoomCache = roomByBaseUrl.get(key) ?? {
    room: new Room(),
    baseUrl: key,
    wsUrl: '',
    token: '',
    connectedAt: 0,
    eventTopic: DEFAULT_EVENT_TOPIC,
    audioEl: ensureHiddenAudioElement(key),
    attachedAudioTrackSid: null,
    attachedAudioTrack: null,
    transportProfile: resolveLiveKitTransportProfile(key, '', 'network'),
    playbackEstimator: {
      trackSid: null,
      lastTickAt: 0,
      lastProducedTotalMs: -1,
      estimatedQueueMs: 0,
    },
    handlers: new Set<LiveKitV3EventHandler>(),
    requestTraces: new Map<string, TraceScope>(),
  };

  lazy.handlers.add(handler);
  roomByBaseUrl.set(key, lazy);

  return () => {
    const latest = roomByBaseUrl.get(key);
    latest?.handlers.delete(handler);
  };
};

export const publishLiveKitV3Event = async (
  baseUrl: string,
  envelope: LiveKitV3EventEnvelopeServer,
  options?: { signal?: AbortSignal; eventTopic?: string; reason?: string },
): Promise<void> => {
  const cache = await ensureLiveKitRoomConnected(baseUrl, {
    signal: options?.signal,
    eventTopic: options?.eventTopic,
    reason: options?.reason ?? 'publish',
  });

  const payloadText = JSON.stringify(envelope);
  const bytes = new TextEncoder().encode(payloadText);

  const eventData = {
    type: envelope.type,
    sessionId: envelope.session_id,
    requestId: envelope.request_id,
    topic: cache.eventTopic,
    payload: envelope.payload,
    direction: 'outbound',
  };
  debug('livekit.service', 'event.publish', eventData);
  if (envelope.request_id && envelope.type === 'tts.speak') {
    const trace = beginLiveKitTrace('tts.speak.roundtrip', eventData);
    trace?.record('frontend.event.publishing', eventData);
    if (trace) cache.requestTraces.set(envelope.request_id, trace);
  } else if (envelope.request_id) {
    cache.requestTraces.get(envelope.request_id)?.record('frontend.event.publishing', eventData);
  }

  await cache.room.localParticipant.publishData(bytes, {
    reliable: true,
    topic: cache.eventTopic,
  });
  if (envelope.request_id) {
    cache.requestTraces.get(envelope.request_id)?.record('frontend.event.published', eventData);
  }
};

const defaultBaseUrl = "http://127.0.0.1:9881";

export const normalizeBaseUrl = (baseUrl?: string): string => {
  const raw = (baseUrl ?? defaultBaseUrl).trim();
  return raw.replace(/\/+$/, "");
};

const readResponseByType = async (
  response: Response,
  responseType: NonNullable<HttpRequestOptions["responseType"]>,
) => {
  if (responseType === "blob") return response.blob();
  if (responseType === "text") return response.text();
  if (responseType === "arrayBuffer") return response.arrayBuffer();

  const contentType = response.headers.get("content-type") || "";
  if (
    contentType.includes("application/json") ||
    contentType.includes("text/json")
  ) {
    return response.json();
  }

  const rawText = await response.text();
  if (!rawText) return null;

  try {
    return JSON.parse(rawText);
  } catch {
    return rawText;
  }
};

// 使用 fetch 作为统一请求底层，支持 json/blob 与 AbortSignal。
export const requestViaFetch = async <T>({
  method,
  url,
  body,
  responseType = "json",
  signal,
}: HttpRequestOptions): Promise<T> => {
  try {
    const response = await fetch(url, {
      method,
      headers: {
        Accept: "application/json, audio/*;q=0.9, */*;q=0.8",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    const rawResponse = await readResponseByType(response, responseType);

    if (!response.ok) {
      const maybeErr = rawResponse as {
        error?: { code?: string; message?: string };
      } | null;
      const message = maybeErr?.error?.message || `HTTP ${response.status}`;
      const code = maybeErr?.error?.code;
      throw new LiveKitApiError(message, response.status, code, rawResponse);
    }
    return await (rawResponse as T);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err;
    }

    if (err instanceof LiveKitApiError) {
      throw err;
    }

    throw new LiveKitApiError(
      String(err instanceof Error ? err.message : err),
      0,
    );
  }
};

export const toSessionCreateServer = (
  payload?: LiveKitSessionCreatePayload,
): LiveKitSessionCreatePayloadServer => {
  return {
    client: payload?.client?.trim() || "desktop",
    version: payload?.version?.trim() || "0.1.0",
    capabilities: {
      livekit: payload?.capabilities?.livekit !== false,
      audio_downlink: payload?.capabilities?.audioDownlink !== false,
      transport_mode: payload?.capabilities?.transportMode === 'loopback' ? 'loopback' : 'network',
    },
  };
};

export const fromSessionCreateServer = (
  raw: LiveKitSessionCreateResponseServer,
): LiveKitSessionCreateResponse => {
  return {
    sessionId: raw.session_id,
    roomName: raw.room_name,
    participantIdentity: raw.participant_identity,
    livekit: {
      wsUrl: raw.livekit.ws_url,
      token: raw.livekit.token,
      expiresIn: raw.livekit.expires_in,
    },
    serverTime: raw.server_time,
    transportMode: raw.transport_mode === 'loopback' ? 'loopback' : 'network',
  };
};

export const toModelSwitchServer = (
  request: LiveKitModelSwitchRequest,
): LiveKitModelSwitchRequestServer => {
  return {
    session_id: request.sessionId,
    request_id: request.requestId,
    payload: {
      reason: request.payload.reason,
      config_version: request.payload.configVersion,
      model_id: request.payload.modelId,
      gpt_weights_path: request.payload.gptWeightsPath,
      sovits_weights_path: request.payload.sovitsWeightsPath,
      ref_audio_path: request.payload.refAudioPath,
      prompt_text: request.payload.promptText,
      prompt_lang: request.payload.promptLang,
    },
  };
};

export const fromModelSwitchServer = (
  raw: LiveKitModelSwitchResponseServer,
): LiveKitModelSwitchResponse => {
  return {
    ok: raw.ok,
    requestId: raw.request_id,
    state: raw.state,
    modelReady: raw.model_ready,
  };
};

export const toTtsSpeakServer = (
  request: LiveKitTtsSpeakRequest,
): LiveKitTtsSpeakRequestServer => {
  return {
    session_id: request.sessionId,
    request_id: request.requestId,
    ts: request.ts,
    payload: {
      display_text: request.payload.displayText,
      speak_text: request.payload.speakText,
      text_lang: request.payload.textLang,
      prompt_lang: request.payload.promptLang,
      ref_audio_path: request.payload.refAudioPath,
      prompt_text: request.payload.promptText,
      text_split_method: request.payload.textSplitMethod,
      speed_factor: request.payload.speedFactor,
      fragment_interval: request.payload.fragmentInterval,
      top_k: request.payload.topK,
      top_p: request.payload.topP,
      temperature: request.payload.temperature,
    },
  };
};

export const toTtsCancelServer = (
  request: LiveKitTtsCancelRequest,
): LiveKitTtsCancelRequestServer => {
  return {
    session_id: request.sessionId,
    request_id: request.requestId,
    ts: request.ts,
    payload: {
      reason: request.payload?.reason,
    },
  };
};

// 构建预热请求的服务器结构，和构建语音合成请求类似，但参数更少一些。
export const toTtsPreheatServer = (
  request: LiveKitTtsPreheatRequest,
): LiveKitTtsPreheatRequestServer => {
  return {
    session_id: request.sessionId,
    request_id: request.requestId,
    ts: request.ts,
    payload: {
      text_lang: request.payload.textLang,
      prompt_lang: request.payload.promptLang,
      ref_audio_path: request.payload.refAudioPath,
      prompt_text: request.payload.promptText,
    },
  };
};

export const fromTtsPreheatServer = (
  raw: LiveKitTtsPreheatResponseServer,
): LiveKitTtsPreheatResponse => {
  return {
    ok: raw.ok,
    requestId: raw.request_id,
    state: raw.state || (raw.ok ? "tts.preheat.finished" : "tts.preheat.failed"),
    warmed: raw.warmed ?? Boolean(raw.ok),
  };
};

export const postRequest = async <T>(
  baseUrl: string,
  path: string,
  body: unknown,
  signal?: AbortSignal,
  responseType: NonNullable<HttpRequestOptions["responseType"]> = "json",
): Promise<T> => {
  const url = `${normalizeBaseUrl(baseUrl)}${path}`;
  return requestViaFetch<T>({
    method: "POST",
    url,
    body,
    responseType,
    signal,
  });
};

export const getJson = async <T>(
  baseUrl: string,
  path: string,
  signal?: AbortSignal,
): Promise<T> => {
  const url = `${normalizeBaseUrl(baseUrl)}${path}`;
  return requestViaFetch<T>({
    method: "GET",
    url,
    responseType: "json",
    signal,
  });
};

export class LiveKitService {
  constructor(log: LogService) {
    activeLogService = log;
  }

  getCachedSession(baseUrl: string): LiveKitSessionCreateResponse | null {
    return getCachedLiveKitSession(baseUrl);
  }

  ensureSession(baseUrl: string, payload?: LiveKitSessionCreatePayload, signal?: AbortSignal): Promise<LiveKitSessionCreateResponse> {
    return ensureLiveKitSession(baseUrl, payload, signal);
  }

  ensureRoomConnected(baseUrl: string, options?: {
    signal?: AbortSignal;
    eventTopic?: string;
    sessionPayload?: LiveKitSessionCreatePayload;
    reason?: string;
  }): Promise<RoomCache> {
    return ensureLiveKitRoomConnected(baseUrl, options);
  }

  disconnectRoom(baseUrl: string): void {
    disconnectLiveKitRoom(baseUrl);
  }

  getPlaybackSnapshot(baseUrl: string): Promise<LiveKitPlaybackFeedbackSnapshot | null> {
    return getLiveKitPlaybackSnapshot(baseUrl);
  }

  publishPlaybackFeedback(baseUrl: string, request: LiveKitPlaybackFeedbackRequest, options?: {
    signal?: AbortSignal;
    eventTopic?: string;
    reason?: string;
  }): Promise<void> {
    return publishLiveKitPlaybackFeedback(baseUrl, request, options);
  }

  subscribeEvents(baseUrl: string, handler: LiveKitV3EventHandler): () => void {
    return subscribeLiveKitV3Events(baseUrl, handler);
  }

  publishEvent(baseUrl: string, envelope: LiveKitV3EventEnvelopeServer, options?: {
    signal?: AbortSignal;
    eventTopic?: string;
    reason?: string;
  }): Promise<void> {
    return publishLiveKitV3Event(baseUrl, envelope, options);
  }

  dispose(): void {
    for (const baseUrl of [...roomByBaseUrl.keys()]) disconnectLiveKitRoom(baseUrl);
    sessionByBaseUrl.clear();
    connectPromiseByBaseUrl.clear();
  }
}
