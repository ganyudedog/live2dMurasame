export type LiveKitTransportMode = 'loopback' | 'network';

export type LiveKitTransportProfile = {
  mode: LiveKitTransportMode;
  lowWaterMs: number;
  targetWaterMs: number;
  highWaterMs: number;
};

const LOOPBACK_PROFILE: LiveKitTransportProfile = {
  mode: 'loopback',
  // A zero jitter target minimizes latency but makes short sender stalls turn
  // into discarded RTP packets. Keep a small receiver cushion instead.
  lowWaterMs: 40,
  targetWaterMs: 50,
  highWaterMs: 200,
};

const NETWORK_PROFILE: LiveKitTransportProfile = {
  mode: 'network',
  lowWaterMs: 300,
  targetWaterMs: 420,
  highWaterMs: 900,
};

const normalizeHostname = (hostname: string): string => (
  hostname.trim().toLowerCase().replace(/^\[|\]$/g, '')
);

const isLoopbackHostname = (hostname: string): boolean => {
  const normalized = normalizeHostname(hostname);
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true;
  if (normalized === '::1') return true;
  if (normalized.startsWith('::ffff:127.')) return true;

  const ipv4 = normalized.split('.');
  if (ipv4.length !== 4 || ipv4.some((part) => !/^\d+$/.test(part))) return false;
  const octets = ipv4.map(Number);
  return octets[0] === 127 && octets.every((octet) => octet >= 0 && octet <= 255);
};

export const isLoopbackUrl = (value: string): boolean => {
  try {
    return isLoopbackHostname(new URL(value).hostname);
  } catch {
    return false;
  }
};

export const detectTtsTransportMode = (baseUrl: string): LiveKitTransportMode => (
  isLoopbackUrl(baseUrl) ? 'loopback' : 'network'
);

export const resolveLiveKitTransportProfile = (
  baseUrl: string,
  wsUrl: string,
  serverMode?: LiveKitTransportMode,
): LiveKitTransportProfile => {
  const loopback = serverMode !== 'network'
    && isLoopbackUrl(baseUrl)
    && isLoopbackUrl(wsUrl);
  return loopback ? LOOPBACK_PROFILE : NETWORK_PROFILE;
};

export const applyReceiverBufferingProfile = (
  receiver: RTCRtpReceiver | undefined,
  profile: LiveKitTransportProfile,
): void => {
  if (!receiver || profile.mode !== 'loopback') return;

  applyReceiverBufferingTarget(receiver, profile.targetWaterMs);
};

export const applyReceiverBufferingTarget = (
  receiver: RTCRtpReceiver | undefined,
  targetMs: number,
): void => {
  if (!receiver) return;

  const lowLatencyReceiver = receiver as RTCRtpReceiver & {
    playoutDelayHint?: number;
    jitterBufferTarget?: number;
  };

  try {
    // playoutDelayHint is expressed in seconds.
    const targetSeconds = Math.max(0.04, targetMs / 1000);
    lowLatencyReceiver.playoutDelayHint = targetSeconds;
  } catch {
    // Older Chromium builds may expose a read-only implementation.
  }
  try {
    // jitterBufferTarget follows the WebRTC API and is expressed in milliseconds.
    const targetMilliseconds = Math.max(40, targetMs);
    lowLatencyReceiver.jitterBufferTarget = targetMilliseconds;
  } catch {
    // jitterBufferTarget is not available in every Chromium version.
  }
};
