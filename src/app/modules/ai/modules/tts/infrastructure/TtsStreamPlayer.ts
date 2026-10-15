import { AudioLevelObserver, type AudioLevelListener } from './AudioLevelObserver';
import type { TtsPlaybackOptions, TtsPlaybackResult } from '../domain/types';

const OGG_OPUS_MIME = 'audio/ogg; codecs=opus';

const isAbortError = (error: unknown): boolean => {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  return String(error).includes('AbortError');
};

const trimText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const parseMimeFromContentType = (contentType: string | null): string | null => {
  if (!contentType) return null;
  const clean = contentType.split(';')[0]?.trim().toLowerCase();
  return clean || null;
};

const isJsonMime = (mimeType: string | null): boolean => {
  return Boolean(mimeType && (mimeType.includes('application/json') || mimeType.includes('text/json')));
};

const safeAtob = (input: string): string => {
  if (typeof atob === 'function') return atob(input);
  throw new Error('当前环境不支持 atob，无法解析 base64 音频');
};

const decodeBase64ToBlob = (base64: string, mimeType: string): Blob => {
  const binary = safeAtob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let idx = 0; idx < binary.length; idx += 1) {
    bytes[idx] = binary.charCodeAt(idx);
  }
  return new Blob([bytes], { type: mimeType });
};

const pickMimeCandidates = (contentType: string | null): string[] => {
  const candidates: string[] = [];
  const parsed = parseMimeFromContentType(contentType);
  if (parsed) {
    candidates.push(parsed);
    if (parsed === 'audio/x-wav') candidates.push('audio/wav');
  }

  candidates.push(OGG_OPUS_MIME, 'audio/ogg');

  return Array.from(new Set(candidates));
};

const selectMediaSourceMime = (contentType: string | null): string | null => {
  if (typeof MediaSource === 'undefined' || typeof MediaSource.isTypeSupported !== 'function') return null;
  const candidates = pickMimeCandidates(contentType);
  for (const item of candidates) {
    if (MediaSource.isTypeSupported(item)) return item;
  }
  return null;
};

const createAbortError = (): DOMException => new DOMException('The operation was aborted', 'AbortError');

const toArrayBufferChunk = (chunk: Uint8Array): ArrayBuffer => {
  const sliced = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
  return sliced as ArrayBuffer;
};

export class TtsStreamPlayer {
  private observer: AudioLevelObserver | null = null;
  private cancelPlayback: (() => void) | null = null;
  private didStart = false;
  private requestController: AbortController | null = null;
  private readonly onAudioLevel?: AudioLevelListener;

  constructor(onAudioLevel?: AudioLevelListener) { this.onAudioLevel = onAudioLevel; }

  private activeAudio: HTMLAudioElement | null = null;

  private activeObjectUrl: string | null = null;

  stop(): void {
    this.requestController?.abort();
    this.requestController = null;
    this.clearAudio();
  }

  private clearAudio(): void {
    this.cancelPlayback?.();
    this.cancelPlayback = null;
    const audio = this.activeAudio;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    this.observer?.dispose();
    this.observer = null;
    this.activeAudio = null;

    if (this.activeObjectUrl) {
      URL.revokeObjectURL(this.activeObjectUrl);
      this.activeObjectUrl = null;
    }
  }

  dispose(): void {
    this.stop();
  }

  async playResponse(response: Response, options: TtsPlaybackOptions): Promise<TtsPlaybackResult> {
    if (options.signal?.aborted) throw createAbortError();

    this.stop();
    this.didStart = false;
    const controller = new AbortController();
    this.requestController = controller;
    options = { ...options, signal: options.signal
      ? AbortSignal.any([options.signal, controller.signal]) : controller.signal };
    const contentType = response.headers.get('content-type');
    const mimeType = parseMimeFromContentType(contentType);
    try {
      if (isJsonMime(mimeType)) return await this.playJsonResponse(response, options, mimeType);
      const streamMime = selectMediaSourceMime(contentType);
      if (streamMime && response.body) {
        const fallbackResponse = response.clone();
        try {
          return await this.playWithMediaSource(response, options, streamMime);
        } catch (error) {
          // An older task unwinding must never stop or replace a newer playback.
          if (controller.signal.aborted) throw createAbortError();
          const started = this.didStart;
          this.clearAudio();
          if (isAbortError(error) || started) throw error;
          return await this.playBuffered(fallbackResponse, options, mimeType ?? OGG_OPUS_MIME);
        }
      }
      return await this.playBuffered(response, options, mimeType ?? OGG_OPUS_MIME);
    } finally {
      if (this.requestController === controller) this.requestController = null;
    }
  }

  private async playJsonResponse(
    response: Response,
    options: TtsPlaybackOptions,
    defaultMimeType: string | null,
  ): Promise<TtsPlaybackResult> {
    const payload = await response.json();
    if (options.signal?.aborted) throw createAbortError();

    const audioUrl = trimText((payload as { audio_url?: unknown; url?: unknown }).audio_url)
      || trimText((payload as { audio_url?: unknown; url?: unknown }).url);
    if (audioUrl) {
      await this.playByUrl(audioUrl, options);
      return { streamed: false, bytesReceived: 0, mimeType: defaultMimeType };
    }

    const audioBase64 = trimText((payload as { audio_base64?: unknown; audioBase64?: unknown; data?: unknown }).audio_base64)
      || trimText((payload as { audio_base64?: unknown; audioBase64?: unknown; data?: unknown }).audioBase64)
      || trimText((payload as { audio_base64?: unknown; audioBase64?: unknown; data?: unknown }).data);
    if (!audioBase64) {
      throw new Error('TTS JSON 响应未包含可播放音频字段');
    }

    const mimeType = trimText((payload as { mime_type?: unknown; mimeType?: unknown }).mime_type)
      || trimText((payload as { mime_type?: unknown; mimeType?: unknown }).mimeType)
      || defaultMimeType
      || OGG_OPUS_MIME;

    const blob = decodeBase64ToBlob(audioBase64, mimeType);
    await this.playByBlob(blob, options);
    return {
      streamed: false,
      bytesReceived: blob.size,
      mimeType,
    };
  }

  private async playBuffered(
    response: Response,
    options: TtsPlaybackOptions,
    mimeType: string,
  ): Promise<TtsPlaybackResult> {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (options.signal?.aborted) throw createAbortError();

    options.onChunk?.(bytes.byteLength);
    const blob = new Blob([bytes], { type: mimeType });
    await this.playByBlob(blob, options);
    return {
      streamed: false,
      bytesReceived: bytes.byteLength,
      mimeType,
    };
  }

  private async playWithMediaSource(
    response: Response,
    options: TtsPlaybackOptions,
    sourceBufferMime: string,
  ): Promise<TtsPlaybackResult> {
    const body = response.body;
    if (!body) {
      throw new Error('TTS 响应不包含可流式读取的 body');
    }

    const mediaSource = new MediaSource();
    const objectUrl = URL.createObjectURL(mediaSource);
    const audio = new Audio();
    audio.preload = 'auto';
    audio.src = objectUrl;
    this.activeAudio = audio;
    this.activeObjectUrl = objectUrl;

    const playback = this.observePlayback(audio, options);
    let sourceBuffer: SourceBuffer | null = null;
    const appendQueue: ArrayBuffer[] = [];
    let streamEnded = false;
    let bytesReceived = 0;
    let playStarted = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const flushQueue = () => {
      try {
        if (!sourceBuffer || sourceBuffer.updating) return;
        const chunk = appendQueue.shift();
        if (chunk) sourceBuffer.appendBuffer(chunk);
        else if (streamEnded && mediaSource.readyState === 'open') mediaSource.endOfStream();
      } catch (error) { playback.fail(error); }
    };
    const onBufferError = () => playback.fail(new Error('TTS 音频缓冲失败'));
    try {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          mediaSource.removeEventListener('sourceopen', onOpen);
          mediaSource.removeEventListener('error', onError);
        };
        const onOpen = () => {
          cleanup();
          try {
            sourceBuffer = mediaSource.addSourceBuffer(sourceBufferMime);
            sourceBuffer.mode = 'sequence';
            sourceBuffer.addEventListener('updateend', flushQueue);
            sourceBuffer.addEventListener('error', onBufferError);
            resolve();
          } catch (error) { reject(error); }
        };
        const onError = () => { cleanup(); reject(new Error('MediaSource 打开失败')); };
        mediaSource.addEventListener('sourceopen', onOpen, { once: true });
        mediaSource.addEventListener('error', onError, { once: true });
        void playback.done.catch((error) => { cleanup(); reject(error); });
      });
      reader = body.getReader();
      void playback.done.catch(() => reader?.cancel().catch(() => undefined));
      const startPlayback = () => {
        if (playStarted) return;
        playStarted = true;
        // Reading must continue while play() waits for enough buffered audio.
        void audio.play().catch(playback.fail);
      };
      while (true) {
        if (options.signal?.aborted) throw createAbortError();
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.byteLength) continue;
        bytesReceived += value.byteLength;
        appendQueue.push(toArrayBufferChunk(value));
        flushQueue();
        options.onChunk?.(bytesReceived);
        startPlayback();
      }
      streamEnded = true;
      flushQueue();
      startPlayback();
      await playback.done;
      return { streamed: true, bytesReceived, mimeType: sourceBufferMime };
    } finally {
      const finalBuffer = sourceBuffer as SourceBuffer | null;
      finalBuffer?.removeEventListener('updateend', flushQueue);
      finalBuffer?.removeEventListener('error', onBufferError);
      if (reader) {
        await reader.cancel();
        reader.releaseLock();
      }
      playback.cleanup();
    }
  }

  private observePlayback(audio: HTMLAudioElement, options: TtsPlaybackOptions) {
    let settle!: (error?: unknown) => void;
    let settled = false;
    const done = new Promise<void>((resolve, reject) => {
      settle = (error) => {
        if (settled) return;
        settled = true;
        if (error) reject(error); else resolve();
      };
    });
    // Cancellation/error may arrive while a response is still being read.
    void done.catch(() => undefined);
    const onPlaying = () => {
      if (settled || options.signal?.aborted || this.didStart) return;
      this.didStart = true;
      options.onStarted?.();
    };
    const onEnded = () => settle();
    const onError = () => settle(new Error('TTS 音频播放失败'));
    const onAbort = () => settle(createAbortError());
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    this.cancelPlayback = onAbort;
    if (options.signal?.aborted) onAbort();
    const observer = this.onAudioLevel ? new AudioLevelObserver(this.onAudioLevel) : null;
    this.observer = observer;
    observer?.observeElement(audio);
    return {
      done, fail: (error: unknown) => settle(error),
      cleanup: () => {
        audio.removeEventListener('playing', onPlaying);
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
        options.signal?.removeEventListener('abort', onAbort);
        if (this.cancelPlayback === onAbort) this.cancelPlayback = null;
        audio.pause();
        observer?.dispose();
        if (this.observer === observer) this.observer = null;
        if (this.activeAudio === audio) {
          this.activeAudio = null;
          if (this.activeObjectUrl) {
            URL.revokeObjectURL(this.activeObjectUrl);
            this.activeObjectUrl = null;
          }
        }
      },
    };
  }

  private async playAudio(audio: HTMLAudioElement, options: TtsPlaybackOptions): Promise<void> {
    this.activeAudio = audio;
    const playback = this.observePlayback(audio, options);
    try { await Promise.all([audio.play(), playback.done]); }
    finally { playback.cleanup(); }
  }

  private async playByBlob(blob: Blob, options: TtsPlaybackOptions): Promise<void> {
    options.signal?.throwIfAborted();
    const objectUrl = URL.createObjectURL(blob);
    this.activeObjectUrl = objectUrl;
    const audio = new Audio();
    audio.preload = 'auto';
    audio.src = objectUrl;
    await this.playAudio(audio, options);
  }

  private async playByUrl(url: string, options: TtsPlaybackOptions): Promise<void> {
    options.signal?.throwIfAborted();
    const audio = new Audio();
    audio.preload = 'auto';
    audio.src = url;
    await this.playAudio(audio, options);
  }
}
