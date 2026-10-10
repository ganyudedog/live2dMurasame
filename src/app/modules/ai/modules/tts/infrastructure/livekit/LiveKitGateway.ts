import type { LiveKitSessionCreateResponse, LiveKitSessionCreatePayload, LiveKitSessionCreateResponseServer } from './protocol';
import { normalizeBaseUrl, postRequest } from './httpClient';
import { toSessionCreateServer, fromSessionCreateServer } from './protocolMapper';


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

import type { LogService } from '@app/shared/logging/LogService';
import { createDecodedAudioTap, type DecodedAudioTap } from './decodedAudioTap';
import { ReceiverBufferPolicy } from '../../domain/livekit/ReceiverBufferPolicy';
import type {
  LiveKitPlaybackFeedbackPayload,
  LiveKitPlaybackFeedbackRequest,
  LiveKitPlaybackFeedbackState,
} from './protocol';
import {
  applyReceiverBufferingProfile,
  applyReceiverBufferingTarget,
  detectTtsTransportMode,
  resolveLiveKitTransportProfile,
  type LiveKitTransportMode,
  type LiveKitTransportProfile,
} from './transportAdapter';

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

export type LiveKitShadowPcmFrame = {
  requestId: string;
  traceId: string;
  frameIndex: number;
  startSample: number;
  samplesPerChannel: number;
  sampleRate: number;
  channels: number;
  pcm: Int16Array;
};

export type LiveKitShadowPcmHandler = (frame: LiveKitShadowPcmFrame) => void;

export type LiveKitDecodedAudioFrame = {
  samples: Float32Array;
  sampleRate: number;
};

export type LiveKitDecodedAudioHandler = (frame: LiveKitDecodedAudioFrame) => void;

type SessionCache = {
  session: LiveKitSessionCreateResponse;
  expiresAt: number;
};

export type RoomCache = {
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
  adaptiveBufferTargetMs: number;
  receiverBufferController: ReceiverBufferPolicy;
  handlers: Set<LiveKitV3EventHandler>;
  shadowPcmHandlers: Set<LiveKitShadowPcmHandler>;
  decodedAudioHandlers: Set<LiveKitDecodedAudioHandler>;
  decodedAudioTap?: DecodedAudioTap;
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
const SHADOW_PCM_TOPIC = 'tts.shadow.pcm';
const isAudioControlEvent = (type: unknown): boolean => typeof type === 'string'
  && (type.startsWith('tts.') || type.startsWith('playback.') || type === 'sentence_done');
const SHADOW_PCM_MAGIC = new TextEncoder().encode('TTSSHADOW1\0');
const sessionByBaseUrl = new Map<string, SessionCache>();
const roomByBaseUrl = new Map<string, RoomCache>();

export const setLiveKitPlaybackMuted = (baseUrl: string, muted: boolean): void => {
  const cache = roomByBaseUrl.get(normalizeBaseUrl(baseUrl));
  if (cache) cache.audioEl.muted = muted;
};
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
  if (!activeLogService?.debugModeEnabled) return;
  emitLiveKitLog('debug', namespace, event, data);
};
const info = (namespace: string, event: string, data?: Record<string, unknown>): void => {
  emitLiveKitLog('info', namespace, event, data);
};
const warn = (namespace: string, event: string, data?: Record<string, unknown>, cause?: unknown): void => {
  emitLiveKitLog('warn', namespace, event, data, cause);
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

const parseShadowPcmFrame = (payload: Uint8Array): LiveKitShadowPcmFrame | null => {
  const magicLength = SHADOW_PCM_MAGIC.byteLength;
  if (payload.byteLength < magicLength + 4) return null;
  for (let idx = 0; idx < magicLength; idx += 1) {
    if (payload[idx] !== SHADOW_PCM_MAGIC[idx]) return null;
  }

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const headerLength = view.getUint32(magicLength, true);
  const headerStart = magicLength + 4;
  const pcmStart = headerStart + headerLength;
  if (pcmStart > payload.byteLength || (payload.byteLength - pcmStart) % 2 !== 0) return null;

  const header = safeJsonParse(safeDecodeText(payload.slice(headerStart, pcmStart)));
  if (!header || typeof header !== 'object') return null;
  const data = header as Record<string, unknown>;
  const asString = (value: unknown): string => typeof value === 'string' ? value : '';
  const asInt = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : -1;
  const pcmBytes = payload.slice(pcmStart);
  const pcmBuffer = pcmBytes.buffer.slice(pcmBytes.byteOffset, pcmBytes.byteOffset + pcmBytes.byteLength);
  const frame: LiveKitShadowPcmFrame = {
    requestId: asString(data.request_id),
    traceId: asString(data.trace_id),
    frameIndex: asInt(data.frame_index),
    startSample: asInt(data.start_sample),
    samplesPerChannel: asInt(data.samples_per_channel),
    sampleRate: asInt(data.sample_rate),
    channels: asInt(data.channels),
    pcm: new Int16Array(pcmBuffer),
  };
  if (!frame.requestId || frame.frameIndex < 1 || frame.samplesPerChannel < 1 || frame.sampleRate < 1 || frame.channels < 1) {
    return null;
  }
  return frame;
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
  packetsLost: number;
  packetsDiscarded: number;
  concealedSamples: number;
  silentConcealedSamples: number;
  concealmentEvents: number;
  totalSamplesReceived: number;
  totalSamplesDurationMs: number;
  statsId: string;
  packetsReceived: number;
  insertedSamplesForDeceleration: number;
  removedSamplesForAcceleration: number;
  jitterBufferDelayMs: number;
  jitterBufferEmittedCount: number;
  jitterBufferTargetDelayMs: number;
  statsTimestampMs: number;
  lastPacketReceivedTimestampMs: number;
  bytesReceived: number;
} => {
  type InboundAudioStats = {
    timestamp?: number;
    lastPacketReceivedTimestamp?: number;
    bytesReceived?: number;
    jitterBufferTargetDelay?: number;
    id?: string;
    packetsReceived?: number;
    insertedSamplesForDeceleration?: number;
    removedSamplesForAcceleration?: number;
    jitter?: number;
    jitterBufferDelay?: number;
    jitterBufferEmittedCount?: number;
    packetsLost?: number;
    packetsDiscarded?: number;
    concealedSamples?: number;
    silentConcealedSamples?: number;
    concealmentEvents?: number;
    totalSamplesReceived?: number;
    totalSamplesDuration?: number;
  };

  let inboundAudioStats: InboundAudioStats | null = null;

  stats.forEach((item) => {
    if (item.type !== 'inbound-rtp') return;
    const typedItem = item as {
      timestamp?: number;
      lastPacketReceivedTimestamp?: number;
      bytesReceived?: number;
      jitterBufferTargetDelay?: number;
      id?: string;
      packetsReceived?: number;
      insertedSamplesForDeceleration?: number;
      removedSamplesForAcceleration?: number;
      kind?: string;
      mediaType?: string;
      jitter?: number;
      jitterBufferDelay?: number;
      jitterBufferEmittedCount?: number;
      packetsLost?: number;
      packetsDiscarded?: number;
      concealedSamples?: number;
      silentConcealedSamples?: number;
      concealmentEvents?: number;
      totalSamplesReceived?: number;
      totalSamplesDuration?: number;
    };
    if (typedItem.kind !== 'audio' && typedItem.mediaType !== 'audio') return;
    inboundAudioStats = typedItem;
  });

  if (!inboundAudioStats) {
    return {
      jitterMs: -1,
      jitterBufferMs: -1,
      packetsLost: -1,
      packetsDiscarded: -1,
      concealedSamples: -1,
      silentConcealedSamples: -1,
      concealmentEvents: -1,
      totalSamplesReceived: -1,
      totalSamplesDurationMs: -1,
      statsId: '',
      packetsReceived: -1,
      insertedSamplesForDeceleration: -1,
      removedSamplesForAcceleration: -1,
      jitterBufferDelayMs: -1,
      jitterBufferEmittedCount: -1,
      jitterBufferTargetDelayMs: -1,
      statsTimestampMs: -1,
      lastPacketReceivedTimestampMs: -1,
      bytesReceived: -1,
    };
  }

  const {
    jitter,
    jitterBufferDelay,
    jitterBufferEmittedCount,
    packetsLost,
    packetsDiscarded,
    concealedSamples,
    silentConcealedSamples,
    concealmentEvents,
    totalSamplesReceived,
    totalSamplesDuration,
    id,
    packetsReceived,
    insertedSamplesForDeceleration,
    removedSamplesForAcceleration,
    timestamp,
    lastPacketReceivedTimestamp,
    bytesReceived,
    jitterBufferTargetDelay,
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

  const finiteCounter = (value: unknown): number => (
    typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : -1
  );

  return {
    jitterMs,
    jitterBufferMs,
    packetsLost: finiteCounter(packetsLost),
    packetsDiscarded: finiteCounter(packetsDiscarded),
    concealedSamples: finiteCounter(concealedSamples),
    silentConcealedSamples: finiteCounter(silentConcealedSamples),
    concealmentEvents: finiteCounter(concealmentEvents),
    totalSamplesReceived: finiteCounter(totalSamplesReceived),
    totalSamplesDurationMs,
    statsId: id ?? '',
    packetsReceived: finiteCounter(packetsReceived),
    insertedSamplesForDeceleration: finiteCounter(insertedSamplesForDeceleration),
    removedSamplesForAcceleration: finiteCounter(removedSamplesForAcceleration),
    jitterBufferDelayMs: typeof jitterBufferDelay === 'number' ? jitterBufferDelay * 1000 : -1,
    jitterBufferEmittedCount: finiteCounter(jitterBufferEmittedCount),
    jitterBufferTargetDelayMs: typeof jitterBufferTargetDelay === 'number' ? jitterBufferTargetDelay * 1000 : -1,
    statsTimestampMs: typeof timestamp === 'number' ? timestamp : -1,
    lastPacketReceivedTimestampMs: typeof lastPacketReceivedTimestamp === 'number' ? lastPacketReceivedTimestamp : -1,
    bytesReceived: finiteCounter(bytesReceived),
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
    highWaterMs,
  } = cache.transportProfile;
  const hasAudioTrack = Boolean(cache.attachedAudioTrackSid);
  if (!hasAudioTrack) return null;

  const nowMs = Date.now();
  const bufferFromAudioElementMs = getBufferedMilliseconds(audioEl);
  let jitterMs = -1;
  let jitterBufferMs = -1;
  let packetsLost = -1;
  let packetsDiscarded = -1;
  let concealedSamples = -1;
  let silentConcealedSamples = -1;
  let concealmentEvents = -1;
  let totalSamplesReceived = -1;
  let totalSamplesDurationMs = -1;
  let receiverDiagnostics: Partial<LiveKitPlaybackFeedbackPayload> = {};
  let producedDeltaMs = 0;
  let consumedDeltaMs = 0;

  const audioTrack = cache.attachedAudioTrack;
  if (audioTrack && typeof (audioTrack as RemoteTrack & { receiver?: RTCRtpReceiver }).receiver?.getStats === 'function') {
    try {
      const receiverStats = await (audioTrack as RemoteTrack & { receiver: RTCRtpReceiver }).receiver!.getStats();
      const extracted = extractInboundAudioStats(receiverStats);
      jitterMs = extracted.jitterMs;
      jitterBufferMs = extracted.jitterBufferMs;
      packetsLost = extracted.packetsLost;
      packetsDiscarded = extracted.packetsDiscarded;
      concealedSamples = extracted.concealedSamples;
      silentConcealedSamples = extracted.silentConcealedSamples;
      concealmentEvents = extracted.concealmentEvents;
      totalSamplesReceived = extracted.totalSamplesReceived;
      totalSamplesDurationMs = extracted.totalSamplesDurationMs;
      receiverDiagnostics = {
        statsId: extracted.statsId,
        packetsReceived: extracted.packetsReceived,
        insertedSamplesForDeceleration: extracted.insertedSamplesForDeceleration,
        removedSamplesForAcceleration: extracted.removedSamplesForAcceleration,
        jitterBufferDelayMs: extracted.jitterBufferDelayMs,
        jitterBufferEmittedCount: extracted.jitterBufferEmittedCount,
        jitterBufferTargetDelayMs: extracted.jitterBufferTargetDelayMs,
        statsTimestampMs: extracted.statsTimestampMs,
        lastPacketReceivedTimestampMs: extracted.lastPacketReceivedTimestampMs,
        bytesReceived: extracted.bytesReceived,
      };
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

  const resolvedBufferMs = transportMode === 'loopback' ? -1 : estimator.estimatedQueueMs > 0
    ? Math.round(estimator.estimatedQueueMs)
    : jitterBufferMs > 0
      ? jitterBufferMs
      : bufferFromAudioElementMs > 0
        ? bufferFromAudioElementMs
        : -1;

  if (transportMode === 'loopback') {
    const adjustment = cache.receiverBufferController.observe({
      ...receiverDiagnostics, concealedSamples, silentConcealedSamples,
    }, !audioEl.paused && !audioEl.ended);
    if (adjustment) {
      cache.adaptiveBufferTargetMs = adjustment.targetMs;
      applyReceiverBufferingTarget(
        (audioTrack as RemoteTrack & { receiver?: RTCRtpReceiver })?.receiver,
        adjustment.targetMs,
      );
      debug('livekit.service', 'audio.adaptiveBufferTarget', {
        transportMode,
        ...adjustment,
      });
    }
  }

  const targetWaterMs = cache.adaptiveBufferTargetMs;

  const snapshot: LiveKitPlaybackFeedbackSnapshot = {
    ...receiverDiagnostics,
    state: classifyPlaybackState(audioEl, resolvedBufferMs, lowWaterMs, highWaterMs, transportMode),
    bufferMs: resolvedBufferMs,
    lowWaterMs,
    targetWaterMs,
    highWaterMs,
    transportMode,
    source: 'frontend',
    latencyMs: -1,
    jitterMs,
    packetsLost,
    packetsDiscarded,
    concealedSamples,
    silentConcealedSamples,
    concealmentEvents,
    totalSamplesReceived,
    totalSamplesDurationMs,
    producedDeltaMs,
    consumedDeltaMs,
    estimatedQueueMs: transportMode === 'loopback' ? -1 : Math.round(estimator.estimatedQueueMs),
    estimatorVersion: transportMode === 'loopback' ? 'receiver-concealment-v2' : 'jitter-delta-v1',
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
  cache.adaptiveBufferTargetMs = cache.transportProfile.targetWaterMs;
  cache.receiverBufferController = new ReceiverBufferPolicy(cache.transportProfile.targetWaterMs);
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

    disposeDecodedAudioTap(cache);
    cache.attachedAudioTrackSid = publication.trackSid;
    cache.attachedAudioTrack = track;
    resetPlaybackEstimator(cache);
    cache.playbackEstimator.trackSid = publication.trackSid;
    applyReceiverBufferingProfile(
      (track as RemoteTrack & { receiver?: RTCRtpReceiver }).receiver,
      cache.transportProfile,
    );
    track.attach(cache.audioEl);
    ensureDecodedAudioTap(cache);
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
      if (topic === SHADOW_PCM_TOPIC) {
        if (cache.shadowPcmHandlers.size === 0) return;
        const frame = parseShadowPcmFrame(payload);
        if (!frame) return;
        cache.shadowPcmHandlers.forEach((handler) => {
          try {
            handler(frame);
          } catch {
            // Recording must never affect the LiveKit playback path.
          }
        });
        return;
      }
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
      if (!isAudioControlEvent(envelope.type)) debug('livekit.service', 'event.received', loopbackData);

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
      disposeDecodedAudioTap(cache);
      resetPlaybackEstimator(cache);
      info('livekit.service', 'audio.track.detached', { trackSid: publication.trackSid });
    });
};

const disposeDecodedAudioTap = (cache: RoomCache): void => {
  const tap = cache.decodedAudioTap;
  if (!tap) return;
  tap.dispose();
  cache.decodedAudioTap = undefined;
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
      disposeDecodedAudioTap(existing);
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
      adaptiveBufferTargetMs: transportProfile.targetWaterMs,
      receiverBufferController: new ReceiverBufferPolicy(transportProfile.targetWaterMs),
      handlers: reuseHandlers,
      shadowPcmHandlers: existing?.shadowPcmHandlers ?? new Set(),
      decodedAudioHandlers: existing?.decodedAudioHandlers ?? new Set(),
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

  disposeDecodedAudioTap(cache);
  cache.decodedAudioHandlers.clear();
  cache.shadowPcmHandlers.clear();

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
      target_water_ms: request.payload.targetWaterMs,
      high_water_ms: request.payload.highWaterMs,
      transport_mode: request.payload.transportMode,
      source: request.payload.source ?? 'frontend',
      latency_ms: request.payload.latencyMs ?? -1,
      jitter_ms: request.payload.jitterMs ?? -1,
      packets_lost: request.payload.packetsLost ?? -1,
      packets_discarded: request.payload.packetsDiscarded ?? -1,
      concealed_samples: request.payload.concealedSamples ?? -1,
      silent_concealed_samples: request.payload.silentConcealedSamples ?? -1,
      concealment_events: request.payload.concealmentEvents ?? -1,
      total_samples_received: request.payload.totalSamplesReceived ?? -1,
      total_samples_duration_ms: request.payload.totalSamplesDurationMs ?? -1,
      stats_id: request.payload.statsId ?? '',
      packets_received: request.payload.packetsReceived ?? -1,
      inserted_samples_for_deceleration: request.payload.insertedSamplesForDeceleration ?? -1,
      removed_samples_for_acceleration: request.payload.removedSamplesForAcceleration ?? -1,
      jitter_buffer_delay_ms: request.payload.jitterBufferDelayMs ?? -1,
      jitter_buffer_emitted_count: request.payload.jitterBufferEmittedCount ?? -1,
      jitter_buffer_target_delay_ms: request.payload.jitterBufferTargetDelayMs ?? -1,
      stats_timestamp_ms: request.payload.statsTimestampMs ?? -1,
      last_packet_received_timestamp_ms: request.payload.lastPacketReceivedTimestampMs ?? -1,
      bytes_received: request.payload.bytesReceived ?? -1,
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
    adaptiveBufferTargetMs: 50,
    receiverBufferController: new ReceiverBufferPolicy(50),
    handlers: new Set<LiveKitV3EventHandler>(),
    shadowPcmHandlers: new Set<LiveKitShadowPcmHandler>(),
    decodedAudioHandlers: new Set<LiveKitDecodedAudioHandler>(),
  };

  lazy.handlers.add(handler);
  roomByBaseUrl.set(key, lazy);

  return () => {
    const latest = roomByBaseUrl.get(key);
    latest?.handlers.delete(handler);
  };
};

export const subscribeLiveKitShadowPcm = (baseUrl: string, handler: LiveKitShadowPcmHandler): (() => void) => {
  const key = normalizeBaseUrl(baseUrl);
  const cache = roomByBaseUrl.get(key);
  if (!cache) return () => undefined;
  cache.shadowPcmHandlers.add(handler);
  return () => {
    cache.shadowPcmHandlers.delete(handler);
  };
};

const ensureDecodedAudioTap = (cache: RoomCache): void => {
  if (cache.decodedAudioTap || !cache.attachedAudioTrack || cache.decodedAudioHandlers.size === 0) return;
  const AudioContextCtor = window.AudioContext
    ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return;

  try {
    cache.decodedAudioTap = createDecodedAudioTap(cache.attachedAudioTrack.mediaStreamTrack, AudioContextCtor, (frame) => {
      cache.decodedAudioHandlers.forEach((handler) => {
        try {
          handler(frame);
        } catch {
          // Recording must never interrupt audio playback.
        }
      });
    });
  } catch (error) {
    warn('livekit.service', 'audio.observation.unavailable', { reason: String(error) });
  }
};

export const subscribeLiveKitDecodedAudio = (
  baseUrl: string,
  handler: LiveKitDecodedAudioHandler,
): (() => void) => {
  const key = normalizeBaseUrl(baseUrl);
  const cache = roomByBaseUrl.get(key);
  if (!cache) return () => undefined;
  cache.decodedAudioHandlers.add(handler);
  ensureDecodedAudioTap(cache);
  return () => {
    cache.decodedAudioHandlers.delete(handler);
    if (cache.decodedAudioHandlers.size === 0) disposeDecodedAudioTap(cache);
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
  if (!isAudioControlEvent(envelope.type)) debug('livekit.service', 'event.publish', eventData);

  await cache.room.localParticipant.publishData(bytes, {
    reliable: true,
    topic: cache.eventTopic,
  });
};

export const configureLiveKitLogging = (log: LogService): void => { activeLogService = log; };
export const disposeLiveKitGateway = (): void => {
  for (const baseUrl of [...roomByBaseUrl.keys()]) disconnectLiveKitRoom(baseUrl);
  sessionByBaseUrl.clear();
  connectPromiseByBaseUrl.clear();
};
