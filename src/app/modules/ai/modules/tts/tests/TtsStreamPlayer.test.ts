import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TtsStreamPlayer } from '../infrastructure/TtsStreamPlayer';
import { AudioLevelObserver } from '../infrastructure/AudioLevelObserver';

class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = [];
  src = '';
  preload = '';
  paused = true;
  ended = false;
  muted = false;
  volume = 1;
  constructor() { super(); FakeAudio.instances.push(this); }
  play = vi.fn(async () => { this.paused = false; });
  pause = vi.fn(() => { this.paused = true; });
  removeAttribute = vi.fn();
  load = vi.fn();
}

class FakeSourceBuffer extends EventTarget {
  mode = '';
  updating = false;
  appendBuffer = vi.fn(() => { queueMicrotask(() => this.dispatchEvent(new Event('updateend'))); });
}

class FakeMediaSource extends EventTarget {
  static instance: FakeMediaSource;
  static isTypeSupported = () => true;
  readyState = 'open';
  buffer = new FakeSourceBuffer();
  ended = false;
  constructor() {
    super(); FakeMediaSource.instance = this;
    queueMicrotask(() => this.dispatchEvent(new Event('sourceopen')));
  }
  addSourceBuffer = () => this.buffer;
  endOfStream = () => { this.ended = true; this.readyState = 'ended'; };
}

describe('actual HTTP playback boundaries', () => {
  beforeEach(() => {
    FakeAudio.instances = [];
    vi.stubGlobal('Audio', FakeAudio);
    vi.stubGlobal('MediaSource', undefined);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('does not finish on play() resolution and only reports actual playing', async () => {
    const player = new TtsStreamPlayer();
    const onStarted = vi.fn();
    let finished = false;
    const task = player.playResponse(new Response('audio', { headers: { 'content-type': 'audio/wav' } }),
      { requestId: 's0', onStarted }).then(() => { finished = true; });
    await vi.waitFor(() => expect(FakeAudio.instances).toHaveLength(1));
    const audio = FakeAudio.instances[0];
    await Promise.resolve();
    expect(audio.play).toHaveBeenCalledOnce();
    expect(onStarted).not.toHaveBeenCalled();
    expect(finished).toBe(false);
    audio.dispatchEvent(new Event('playing'));
    expect(onStarted).toHaveBeenCalledOnce();
    audio.ended = true;
    audio.dispatchEvent(new Event('ended'));
    await task;
    expect(finished).toBe(true);
    player.dispose();
  });

  it('keeps MSE playback open after all chunks arrive, until audio ends', async () => {
    vi.stubGlobal('MediaSource', FakeMediaSource);
    let allowPlay!: () => void;
    const playReady = new Promise<void>((resolve) => { allowPlay = resolve; });
    vi.stubGlobal('Audio', class extends FakeAudio {
      play = vi.fn(() => playReady);
    });
    const player = new TtsStreamPlayer();
    let finished = false;
    const onStarted = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.enqueue(new Uint8Array([4, 5]));
      controller.close();
    } });
    const task = player.playResponse(new Response(body, { headers: { 'content-type': 'audio/ogg' } }),
      { requestId: 's0', onStarted }).then((result) => { finished = true; return result; });
    await vi.waitFor(() => expect(FakeMediaSource.instance.ended).toBe(true));
    expect(FakeMediaSource.instance.buffer.appendBuffer).toHaveBeenCalledTimes(2);
    expect(finished).toBe(false);
    const audio = FakeAudio.instances[0];
    allowPlay();
    audio.dispatchEvent(new Event('playing'));
    expect(onStarted).toHaveBeenCalledOnce();
    audio.dispatchEvent(new Event('ended'));
    expect(await task).toMatchObject({ streamed: true, bytesReceived: 5 });
    player.dispose();
  });

  it('cancels while waiting for MediaSource to open', async () => {
    vi.stubGlobal('MediaSource', class extends FakeMediaSource {
      constructor() {
        super();
        this.dispatchEvent = () => false;
      }
    });
    const player = new TtsStreamPlayer();
    const controller = new AbortController();
    const task = player.playResponse(new Response(new Uint8Array([1, 2])),
      { requestId: 's0', signal: controller.signal });
    const rejected = expect(task).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(FakeAudio.instances).toHaveLength(1));
    controller.abort();
    await rejected;
    player.dispose();
  });

  it('cannot dispose the next HTTP observer when the cancelled MSE task unwinds', async () => {
    vi.stubGlobal('MediaSource', FakeMediaSource);
    const observers: AudioLevelObserver[] = [];
    vi.spyOn(AudioLevelObserver.prototype, 'observeElement').mockImplementation(function (this: AudioLevelObserver) { observers.push(this); });
    const dispose = vi.spyOn(AudioLevelObserver.prototype, 'dispose');
    const player = new TtsStreamPlayer(vi.fn());
    const response = () => new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'audio/ogg' } });
    const first = player.playResponse(response(), { requestId: 'first' });
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(FakeMediaSource.instance.ended).toBe(true));
    const second = player.playResponse(response(), { requestId: 'second' });
    await rejected;
    await vi.waitFor(() => expect(observers).toHaveLength(2));
    expect(dispose.mock.contexts).not.toContain(observers[1]);
    await vi.waitFor(() => expect(FakeMediaSource.instance.ended).toBe(true));
    FakeAudio.instances[1].dispatchEvent(new Event('ended'));
    await second;
    expect(dispose.mock.contexts).toContain(observers[1]);
    player.dispose();
  });

  it('settles an interrupted playback immediately without waiting for ended', async () => {
    const player = new TtsStreamPlayer();
    const controller = new AbortController();
    const task = player.playResponse(new Response('audio'), { requestId: 's0', signal: controller.signal });
    const rejected = expect(task).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(FakeAudio.instances[0]?.play).toHaveBeenCalled());
    controller.abort();
    player.stop();
    await rejected;
    expect(FakeAudio.instances[0].pause).toHaveBeenCalled();
    player.dispose();
  });
});
