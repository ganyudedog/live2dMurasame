import toast from 'react-hot-toast';
import type { TtsMediaType, TtsPlaybackOptions, TtsPlaybackResult } from './types';

const isAbortError = (error: unknown): boolean => {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  return String(error).includes('AbortError');
};

const trimText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const mapMediaTypeToMime = (mediaType: TtsMediaType): string => {
  if (mediaType === 'ogg') return 'audio/ogg';
  if (mediaType === 'aac') return 'audio/aac';
  return 'audio/wav';
};

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

const pickMimeCandidates = (contentType: string | null, preferred: TtsMediaType): string[] => {
  const candidates: string[] = [];
  const parsed = parseMimeFromContentType(contentType);
  if (parsed) {
    candidates.push(parsed);
    if (parsed === 'audio/x-wav') candidates.push('audio/wav');
  }

  if (preferred === 'ogg') {
    candidates.push('audio/ogg; codecs=opus', 'audio/ogg');
  } else if (preferred === 'aac') {
    candidates.push('audio/mp4; codecs="mp4a.40.2"', 'audio/aac');
  } else {
    candidates.push('audio/wav', 'audio/wave', 'audio/x-wav', 'audio/mpeg');
  }

  return Array.from(new Set(candidates));
};

const selectMediaSourceMime = (contentType: string | null, preferred: TtsMediaType): string | null => {
  if (typeof MediaSource === 'undefined' || typeof MediaSource.isTypeSupported !== 'function') return null;
  const candidates = pickMimeCandidates(contentType, preferred);
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
  private activeAudio: HTMLAudioElement | null = null;

  private activeObjectUrl: string | null = null;

  stop(): void {
    const audio = this.activeAudio;
    if (audio) {
      try {
        audio.pause();
      } catch {
        // ignore
      }
      try {
        audio.removeAttribute('src');
        audio.load();
      } catch {
        // ignore
      }
    }
    this.activeAudio = null;

    if (this.activeObjectUrl) {
      try {
        URL.revokeObjectURL(this.activeObjectUrl);
      } catch {
        // ignore
      }
      this.activeObjectUrl = null;
    }
  }

  dispose(): void {
    this.stop();
  }

  async playResponse(response: Response, options: TtsPlaybackOptions): Promise<TtsPlaybackResult> {
    if (options.signal?.aborted) throw createAbortError();

    this.stop();

    const contentType = response.headers.get('content-type');
    const mimeType = parseMimeFromContentType(contentType);

    if (isJsonMime(mimeType)) {
      return this.playJsonResponse(response, options, mimeType);
    }

    const streamMime = options.streamingMode
      ? selectMediaSourceMime(contentType, options.preferredMediaType)
      : null;

    if (streamMime && response.body) {
      const fallbackResponse = response.clone();
      try {
        return await this.playWithMediaSource(response, options, streamMime);
      } catch (error) {
        if (isAbortError(error)) throw error;
        return this.playBuffered(
          fallbackResponse,
          options,
          mimeType ?? mapMediaTypeToMime(options.preferredMediaType),
        );
      }
    }

    return this.playBuffered(response, options, mimeType ?? mapMediaTypeToMime(options.preferredMediaType));
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
      await this.playByUrl(audioUrl, options.signal);
      return { streamed: false, bytesReceived: 0, mimeType: defaultMimeType };
    }

    const audioBase64 = trimText((payload as { audio_base64?: unknown; audioBase64?: unknown; data?: unknown }).audio_base64)
      || trimText((payload as { audio_base64?: unknown; audioBase64?: unknown; data?: unknown }).audioBase64)
      || trimText((payload as { audio_base64?: unknown; audioBase64?: unknown; data?: unknown }).data);
    if (!audioBase64) {
      toast.error('TTS 响应的 JSON 中未找到有效的音频数据字段');
      throw new Error('TTS JSON 响应未包含可播放音频字段');
    }

    const mimeType = trimText((payload as { mime_type?: unknown; mimeType?: unknown }).mime_type)
      || trimText((payload as { mime_type?: unknown; mimeType?: unknown }).mimeType)
      || defaultMimeType
      || mapMediaTypeToMime(options.preferredMediaType);

    const blob = decodeBase64ToBlob(audioBase64, mimeType);
    await this.playByBlob(blob, options.signal);
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
    await this.playByBlob(blob, options.signal);
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

    let sourceBuffer: SourceBuffer | null = null;
    const appendQueue: ArrayBuffer[] = [];
    let streamEnded = false;
    let bytesReceived = 0;
    let playStarted = false;

    const flushQueue = () => {
      if (!sourceBuffer) return;
      if (sourceBuffer.updating) return;
      if (appendQueue.length > 0) {
        const chunk = appendQueue.shift();
        if (chunk) sourceBuffer.appendBuffer(chunk);
        return;
      }
      if (streamEnded && mediaSource.readyState === 'open') {
        try {
          mediaSource.endOfStream();
        } catch {
          // ignore
        }
      }
    };

    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        try {
          sourceBuffer = mediaSource.addSourceBuffer(sourceBufferMime);
          sourceBuffer.mode = 'sequence';
          sourceBuffer.addEventListener('updateend', flushQueue);
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      const onError = () => reject(new Error('MediaSource 打开失败'));
      mediaSource.addEventListener('sourceopen', onOpen, { once: true });
      mediaSource.addEventListener('error', onError, { once: true });
    });

    const reader = body.getReader();
    const onAbort = () => {
      try {
        reader.cancel();
      } catch {
        // ignore
      }
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      while (true) {
        if (options.signal?.aborted) throw createAbortError();
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.byteLength <= 0) continue;

        bytesReceived += value.byteLength;
        appendQueue.push(toArrayBufferChunk(value));
        flushQueue();
        options.onChunk?.(bytesReceived);

        if (!playStarted) {
          playStarted = true;
          await audio.play();
        }
      }

      streamEnded = true;
      flushQueue();
      if (!playStarted) {
        await audio.play();
      }

      return {
        streamed: true,
        bytesReceived,
        mimeType: sourceBufferMime,
      };
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
      try {
        reader.releaseLock();
      } catch {
        // ignore
      }
    }
  }

  private async playByBlob(blob: Blob, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw createAbortError();

    const objectUrl = URL.createObjectURL(blob);
    this.activeObjectUrl = objectUrl;

    const audio = new Audio();
    audio.preload = 'auto';
    audio.src = objectUrl;
    this.activeAudio = audio;
    await audio.play();
  }

  private async playByUrl(url: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw createAbortError();

    const audio = new Audio();
    audio.preload = 'auto';
    audio.src = url;
    this.activeAudio = audio;
    await audio.play();
  }
}
