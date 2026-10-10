import type { LogService } from '@app/shared/logging/LogService';
import type { LiveKitSessionCreateResponse, LiveKitSessionCreatePayload, LiveKitPlaybackFeedbackRequest } from '../infrastructure/livekit/protocol';
import {
  configureLiveKitLogging, disposeLiveKitGateway, getCachedLiveKitSession,
  ensureLiveKitSession, ensureLiveKitRoomConnected, disconnectLiveKitRoom,
  getLiveKitPlaybackSnapshot, publishLiveKitPlaybackFeedback, subscribeLiveKitV3Events,
  subscribeLiveKitShadowPcm, subscribeLiveKitDecodedAudio, publishLiveKitV3Event,
  setLiveKitPlaybackMuted,
} from '../infrastructure/livekit/LiveKitGateway';
import type {
  LiveKitPlaybackFeedbackSnapshot, LiveKitV3EventHandler, LiveKitShadowPcmHandler,
  LiveKitDecodedAudioHandler, LiveKitV3EventEnvelopeServer, RoomCache,
} from '../infrastructure/livekit/LiveKitGateway';
import type { LiveKitPort } from '../infrastructure/livekit/LiveKitPort';

export class LiveKitService implements LiveKitPort {
  constructor(log: LogService) {
    configureLiveKitLogging(log);
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

  setPlaybackMuted(baseUrl: string, muted: boolean): void {
    setLiveKitPlaybackMuted(baseUrl, muted);
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

  subscribeShadowPcm(baseUrl: string, handler: LiveKitShadowPcmHandler): () => void {
    return subscribeLiveKitShadowPcm(baseUrl, handler);
  }

  subscribeDecodedAudio(baseUrl: string, handler: LiveKitDecodedAudioHandler): () => void {
    return subscribeLiveKitDecodedAudio(baseUrl, handler);
  }

  publishEvent(baseUrl: string, envelope: LiveKitV3EventEnvelopeServer, options?: {
    signal?: AbortSignal;
    eventTopic?: string;
    reason?: string;
  }): Promise<void> {
    return publishLiveKitV3Event(baseUrl, envelope, options);
  }

  dispose(): void {
    disposeLiveKitGateway();
  }
}
