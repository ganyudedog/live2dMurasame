import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomEvent } from 'livekit-client';
import { postRequest } from '../infrastructure/livekit/httpClient';
import { disposeLiveKitGateway, ensureLiveKitRoomConnected, subscribeLiveKitV3Events } from '../infrastructure/livekit/LiveKitGateway';

vi.mock('../infrastructure/livekit/httpClient', async (original) => ({
  ...await original<typeof import('../infrastructure/livekit/httpClient')>(), postRequest: vi.fn(),
}));
vi.mock('livekit-client', async (original) => {
  const actual = await original<typeof import('livekit-client')>();
  class Room {
    state = actual.ConnectionState.Disconnected;
    handlers = new Map<string, (...args: unknown[]) => void>();
    localParticipant = { identity: 'desktop', publishData: vi.fn() };
    on(event: string, listener: (...args: unknown[]) => void) { this.handlers.set(event, listener); return this; }
    connect = vi.fn(async () => { this.state = actual.ConnectionState.Connected; });
    disconnect = vi.fn(() => { this.state = actual.ConnectionState.Disconnected; });
  }
  return { ...actual, Room };
});
const response = (id: string) => ({ session_id: id, room_name: 'pet', participant_identity: id,
  livekit: { ws_url: 'ws://127.0.0.1:7880', token: id, expires_in: 600 } });
const deliver = (room: unknown) => {
  const handlers = (room as { handlers: Map<string, (...args: unknown[]) => void> }).handlers;
  handlers.get(RoomEvent.DataReceived)!(new TextEncoder().encode(JSON.stringify({
    type: 'tts.finished', request_id: 'request', session_id: 'new',
  })), undefined, undefined, 'v3.event');
};

describe('LiveKit session and event subscription lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.clearAllMocks();
    vi.stubGlobal('document', { createElement: () => ({ style: {}, setAttribute: vi.fn(), remove: vi.fn() }),
      body: { appendChild: vi.fn() } });
  });
  afterEach(() => { disposeLiveKitGateway(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('reconnects with the renewed identity and retains subscriptions', async () => {
    vi.mocked(postRequest).mockResolvedValueOnce(response('old')).mockResolvedValueOnce(response('new'));
    const first = await ensureLiveKitRoomConnected('http://127.0.0.1:9881');
    const listener = vi.fn();
    const off = subscribeLiveKitV3Events('http://127.0.0.1:9881', listener);
    await vi.advanceTimersByTimeAsync(601000);
    const second = await ensureLiveKitRoomConnected('http://127.0.0.1:9881');
    expect(second.room).not.toBe(first.room);
    expect(first.room.disconnect).toHaveBeenCalledOnce();
    expect(second.room.connect).toHaveBeenCalledWith('ws://127.0.0.1:7880', 'new', { autoSubscribe: true });
    deliver(second.room); expect(listener).toHaveBeenCalledOnce();
    off(); deliver(second.room); expect(listener).toHaveBeenCalledOnce();
  });

  it('preserves a subscription added while initial session creation is pending', async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(postRequest).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const connecting = ensureLiveKitRoomConnected('http://127.0.0.1:9881');
    const listener = vi.fn();
    const off = subscribeLiveKitV3Events('http://127.0.0.1:9881', listener);
    resolve(response('new'));
    const connected = await connecting;
    deliver(connected.room); expect(listener).toHaveBeenCalledOnce();
    off(); deliver(connected.room); expect(listener).toHaveBeenCalledOnce();
  });
});
