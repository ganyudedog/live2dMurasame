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

import { debug, info, warn } from '../../src/renderer/utils/log';
import type {
  LiveKitPlaybackFeedbackPayload,
  LiveKitPlaybackFeedbackRequest,
  LiveKitPlaybackFeedbackState,
  LiveKitSessionCreatePayload,
  LiveKitSessionCreateResponse,
  LiveKitSessionCreateResponseServer,
} from '../model/liveKitModel';
import { fromSessionCreateServer, normalizeBaseUrl, postRequest, toSessionCreateServer } from './liveKitService';

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
  playbackEstimator: {
    trackSid: string | null;
    lastTickAt: number;
    lastProducedTotalMs: number;
    estimatedQueueMs: number;
  };
  handlers: Set<LiveKitV3EventHandler>;
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
const DEFAULT_FEEDBACK_LOW_WATER_MS = 300;
const DEFAULT_FEEDBACK_HIGH_WATER_MS = 900;

const sessionByBaseUrl = new Map<string, SessionCache>();
const roomByBaseUrl = new Map<string, RoomCache>();
const connectPromiseByBaseUrl = new Map<string, Promise<RoomCache>>();

const now = () => Date.now();

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
): LiveKitPlaybackFeedbackState => {
  if (audioEl.ended) return 'draining';
  if (audioEl.paused && !audioEl.ended) return 'paused';
  if (bufferMs < 0) return 'unknown';
  if (bufferMs <= lowWaterMs) return 'low';
  if (bufferMs >= highWaterMs) return 'high';
  return 'ok';
};

const readPlaybackSnapshot = async (cache: RoomCache): Promise<LiveKitPlaybackFeedbackSnapshot | null> => {
  const { audioEl } = cache;
  if (!audioEl) return null;

  const lowWaterMs = DEFAULT_FEEDBACK_LOW_WATER_MS;
  const highWaterMs = DEFAULT_FEEDBACK_HIGH_WATER_MS;
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
      warn('livekit.realtime', 'audio.receiverStats.failed', {
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
    state: classifyPlaybackState(audioEl, resolvedBufferMs, lowWaterMs, highWaterMs),
    bufferMs: resolvedBufferMs,
    lowWaterMs,
    highWaterMs,
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
      },
    },
  );

  info('livekit.realtime', 'session.create.start', { baseUrl: key, client: body.client });

  let raw: LiveKitSessionCreateResponseServer;
  try {
    raw = await postRequest<LiveKitSessionCreateResponseServer>(key, '/v3/session/create', body, signal);
  } catch (e) {
    // 注意：这里用 warn，避免在自动连接场景弹 toast。
    warn('livekit.realtime', 'session.create.failed', {
      baseUrl: key,
      err: String(e instanceof Error ? e.message : e),
    });
    throw e;
  }

  const session = fromSessionCreateServer(raw);
  const expiresAt = now() + Math.max(30, session.livekit.expiresIn) * 1000;
  sessionByBaseUrl.set(key, { session, expiresAt });

  info('livekit.realtime', 'session.create.ok', {
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
      debug('livekit.realtime', 'audio.track.attachSkipSameTrack', {
        trackSid: publication.trackSid,
        participant: participant.identity,
      });
      return;
    }

    if (cache.attachedAudioTrackSid === publication.trackSid && cache.attachedAudioTrack && cache.attachedAudioTrack !== track) {
      debug('livekit.realtime', 'audio.track.replaceSameSid', {
        trackSid: publication.trackSid,
        participant: participant.identity,
      });

      cache.attachedAudioTrack.detach(cache.audioEl);
      cache.attachedAudioTrack = null;
      cache.attachedAudioTrackSid = null;
      resetPlaybackEstimator(cache);
    }

    if (cache.attachedAudioTrackSid && cache.attachedAudioTrackSid !== publication.trackSid) {
      debug('livekit.realtime', 'audio.track.replace', {
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
    track.attach(cache.audioEl);
    void cache.audioEl.play().catch(() => {
      // 浏览器/系统可能限制 autoplay；这里只记日志不抛错。
      warn('livekit.realtime', 'audio.play.blocked', { trackSid: publication.trackSid });
    });

    info('livekit.realtime', 'audio.track.attached', {
      trackSid: publication.trackSid,
      participant: participant.identity,
    });
  } catch (e) {
    warn('livekit.realtime', 'audio.track.attachFailed', {
      trackSid: publication.trackSid,
      err: String(e instanceof Error ? e.message : e),
    });
  }
};

const bindRoomLoggingAndHandlers = (cache: RoomCache) => {
  const { room } = cache;

  room
    .on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
      info('livekit.realtime', 'room.state', { state, baseUrl: cache.baseUrl });
    })
    .on(RoomEvent.Reconnecting, () => {
      warn('livekit.realtime', 'room.reconnecting', { baseUrl: cache.baseUrl });
    })
    .on(RoomEvent.Reconnected, () => {
      info('livekit.realtime', 'room.reconnected', { baseUrl: cache.baseUrl });
    })
    .on(RoomEvent.Disconnected, (reason?: unknown) => {
      warn('livekit.realtime', 'room.disconnected', {
        baseUrl: cache.baseUrl,
        reason: String(reason ?? ''),
      });
    })
    .on(RoomEvent.DataReceived, (payload, participant, kind, topic) => {
      if (topic && topic !== cache.eventTopic) return;

      const text = safeDecodeText(payload);
      const parsed = safeJsonParse(text);
      if (!parsed || typeof parsed !== 'object') {
        warn('livekit.realtime', 'event.parseFailed', { topic, sample: text.slice(0, 200) });
        return;
      }

      const envelope = parsed as LiveKitV3EventEnvelopeServer;
      debug('livekit.realtime', 'event.received', {
        topic,
        type: envelope.type,
        requestId: envelope.request_id,
      });

      cache.handlers.forEach((handler) => {
        try {
          handler(envelope, { topic, participant: participant ?? undefined, kind });
        } catch (e) {
          warn('livekit.realtime', 'event.handlerFailed', {
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
      info('livekit.realtime', 'audio.track.detached', { trackSid: publication.trackSid });
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

    info('livekit.realtime', 'room.connect.start', {
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
      playbackEstimator: {
        trackSid: null,
        lastTickAt: 0,
        lastProducedTotalMs: -1,
        estimatedQueueMs: 0,
      },
      handlers: reuseHandlers,
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
      warn('livekit.realtime', 'room.connect.failed', {
        baseUrl: key,
        err: String(e instanceof Error ? e.message : e),
      });
      throw e;
    }

    info('livekit.realtime', 'room.connect.ok', {
      baseUrl: key,
      state: room.state,
      identity: room.localParticipant?.identity,
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

  info('livekit.realtime', 'room.disconnect', { baseUrl: key });
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
      high_water_ms: request.payload.highWaterMs,
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
    playbackEstimator: {
      trackSid: null,
      lastTickAt: 0,
      lastProducedTotalMs: -1,
      estimatedQueueMs: 0,
    },
    handlers: new Set<LiveKitV3EventHandler>(),
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

  debug('livekit.realtime', 'event.publish', {
    type: envelope.type,
    requestId: envelope.request_id,
    topic: cache.eventTopic,
  });

  await cache.room.localParticipant.publishData(bytes, {
    reliable: true,
    topic: cache.eventTopic,
  });
};
