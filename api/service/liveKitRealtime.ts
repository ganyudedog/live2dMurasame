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
import type { LiveKitSessionCreatePayload, LiveKitSessionCreateResponse, LiveKitSessionCreateResponseServer } from '../model/liveKitModel';
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
  handlers: Set<LiveKitV3EventHandler>;
};

const DEFAULT_EVENT_TOPIC = 'v3.event';

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
    }

    cache.attachedAudioTrackSid = publication.trackSid;
    cache.attachedAudioTrack = track;
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

  try {
    cache.audioEl.remove();
  } catch {
    // ignore
  }

  roomByBaseUrl.delete(key);
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
