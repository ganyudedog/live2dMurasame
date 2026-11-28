// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createImageThumbnail } from '@app/shared/images/createImageThumbnail';
import type { ChatMessage } from '../../../domain/types';
import { readChatSessionCache, writeChatSessionCache } from './chatSessionCache';

const message = (id: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id, role: 'user', text: id, status: 'done', source: 'text', createdAt: 1, ...extra,
});
const thumb = (size: number) => `data:image/webp;base64,${'A'.repeat(size)}`;

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('chat session cache images', () => {
  it.each(['image/webp', 'image/jpeg'])('resizes oversized %s previews until they survive a cache round trip', async format => {
    class TestImage {
      naturalWidth = 640;
      naturalHeight = 320;
      onload?: () => void;
      set src(_src: string) { this.onload?.(); }
    }
    vi.stubGlobal('Image', TestImage);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    const widths: number[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (this: HTMLCanvasElement, mime) {
      if (mime !== format) return 'data:image/png;base64,AA==';
      widths.push(this.width);
      return `data:${format};base64,${'A'.repeat(this.width * this.height * 2)}`;
    });
    const preview = await createImageThumbnail('test-image');
    expect(widths).toEqual([320, 240]);
    expect(preview).toBeTruthy();
    writeChatSessionCache('m', { draftText: '', updatedAt: 1, messages: [message('a', { thumbnails: [preview!] })] });
    expect(readChatSessionCache('m').messages[0].thumbnails).toEqual([preview]);
  });

  it('persists thumbnails and the image count but never the full images', () => {
    writeChatSessionCache('m', { draftText: '', updatedAt: 1, messages: [
      message('a', { imageCount: 2, images: [thumb(10), thumb(10)], thumbnails: [thumb(100), thumb(200 * 1024)] }),
    ] });
    const [cached] = readChatSessionCache('m').messages;
    expect(cached.images).toBeUndefined();
    expect(cached.thumbnails).toEqual([thumb(100)]);
    expect(cached.imageCount).toBe(2);
  });

  it('keeps thumbnails of the newest messages within the budget and only the count for older ones', () => {
    const big = thumb(60 * 1024);
    const messages = Array.from({ length: 20 }, (_, index) =>
      message(`m${index}`, { imageCount: 1, thumbnails: [big] }));
    writeChatSessionCache('m', { draftText: '', updatedAt: 1, messages });
    const cached = readChatSessionCache('m').messages;
    expect(cached.at(-1)!.thumbnails).toEqual([big]);
    expect(cached[0].thumbnails).toBeUndefined();
    expect(cached[0].imageCount).toBe(1);
  });

  it('drops thumbnails instead of the text when storage is full', () => {
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (value.includes('data:image')) throw new DOMException('full', 'QuotaExceededError');
      setItem.call(this, key, value);
    });
    writeChatSessionCache('m', { draftText: '', updatedAt: 1, messages: [message('a', { imageCount: 1, thumbnails: [thumb(10)] })] });
    const [cached] = readChatSessionCache('m').messages;
    expect(cached.text).toBe('a');
    expect(cached.thumbnails).toBeUndefined();
    expect(cached.imageCount).toBe(1);
  });
});
