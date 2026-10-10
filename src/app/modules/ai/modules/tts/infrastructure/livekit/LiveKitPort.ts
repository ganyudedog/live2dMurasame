import type {
  ensureLiveKitSession, ensureLiveKitRoomConnected, getCachedLiveKitSession,
  disconnectLiveKitRoom, getLiveKitPlaybackSnapshot, publishLiveKitPlaybackFeedback,
  subscribeLiveKitV3Events, subscribeLiveKitShadowPcm, subscribeLiveKitDecodedAudio,
  publishLiveKitV3Event,
  setLiveKitPlaybackMuted,
} from './LiveKitGateway';

export interface LiveKitPort {
  getCachedSession: typeof getCachedLiveKitSession;
  ensureSession: typeof ensureLiveKitSession;
  ensureRoomConnected: typeof ensureLiveKitRoomConnected;
  disconnectRoom: typeof disconnectLiveKitRoom;
  getPlaybackSnapshot: typeof getLiveKitPlaybackSnapshot;
  publishPlaybackFeedback: typeof publishLiveKitPlaybackFeedback;
  subscribeEvents: typeof subscribeLiveKitV3Events;
  subscribeShadowPcm: typeof subscribeLiveKitShadowPcm;
  subscribeDecodedAudio: typeof subscribeLiveKitDecodedAudio;
  publishEvent: typeof publishLiveKitV3Event;
  setPlaybackMuted?: typeof setLiveKitPlaybackMuted;
}
