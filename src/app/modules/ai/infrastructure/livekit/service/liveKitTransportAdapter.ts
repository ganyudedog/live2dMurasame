export type LiveKitTransportMode = 'loopback' | 'network';

export type LiveKitTransportProfile = {
  mode: LiveKitTransportMode;
  lowWaterMs: number;
  targetWaterMs: number;
  highWaterMs: number;
};

const LOOPBACK_PROFILE: LiveKitTransportProfile = {
  mode: 'loopback',
  lowWaterMs: 0,
  targetWaterMs: 0,
  highWaterMs: 0,
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

  const lowLatencyReceiver = receiver as RTCRtpReceiver & {
    playoutDelayHint?: number;
    jitterBufferTarget?: number;
  };

  try {
    lowLatencyReceiver.playoutDelayHint = 0;
  } catch {
    // Older Chromium builds may expose a read-only implementation.
  }
  try {
    lowLatencyReceiver.jitterBufferTarget = 0;
  } catch {
    // jitterBufferTarget is not available in every Chromium version.
  }
};
