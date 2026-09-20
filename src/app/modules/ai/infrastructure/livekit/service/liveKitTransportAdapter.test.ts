import { describe, expect, it } from 'vitest';
import {
  detectTtsTransportMode,
  isLoopbackUrl,
  resolveLiveKitTransportProfile,
} from './liveKitTransportAdapter';

describe('LiveKit transport adapter', () => {
  it.each([
    'http://localhost:9881',
    'http://pet.localhost:9881',
    'http://127.0.0.1:9881',
    'http://127.42.0.8:9881',
    'http://[::1]:9881',
  ])('recognizes loopback endpoint %s', (url) => {
    expect(isLoopbackUrl(url)).toBe(true);
    expect(detectTtsTransportMode(url)).toBe('loopback');
  });

  it('keeps network buffering when either endpoint crosses the network', () => {
    expect(resolveLiveKitTransportProfile('http://127.0.0.1:9881', 'wss://voice.example.com'))
      .toMatchObject({ mode: 'network', lowWaterMs: 300, highWaterMs: 900 });
    expect(resolveLiveKitTransportProfile('https://voice.example.com', 'ws://127.0.0.1:7880'))
      .toMatchObject({ mode: 'network', lowWaterMs: 300, highWaterMs: 900 });
  });

  it('disables artificial watermarks only for an end-to-end loopback route', () => {
    expect(resolveLiveKitTransportProfile('http://localhost:9881', 'ws://127.0.0.1:7880'))
      .toEqual({ mode: 'loopback', lowWaterMs: 0, targetWaterMs: 0, highWaterMs: 0 });
  });
});
