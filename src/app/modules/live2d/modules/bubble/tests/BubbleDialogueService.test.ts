import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BubbleDialogueService } from '../service/BubbleDialogueService';
import { layoutBubbleText } from '../domain/textLayout';
import { resolveBubbleTypography } from '../domain/constants';

const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
const measurePending = async (service: BubbleDialogueService) => {
  await flush();
  for (let index = 0; service.measurementRequest && index < 20; index++) {
    const request = service.measurementRequest;
    const layout = layoutBubbleText(request.text, request.maxWidth, resolveBubbleTypography(request.scale),
      (text) => Array.from(text).length * 16, Number.POSITIVE_INFINITY);
    service.submitMeasurement({ ...request, width: layout.width, height: layout.bodyHeight, lineCount: layout.lineCount });
    await flush();
  }
};

describe('speech-driven bubble pages', () => {
  let service: BubbleDialogueService;
  beforeEach(() => { vi.useFakeTimers(); service = new BubbleDialogueService(); service.begin('chat'); });
  afterEach(() => { service.dispose(); expect(vi.getTimerCount()).toBe(0); vi.useRealTimers(); });

  it('prepares without displaying and appends a complete sentence only when its request starts', async () => {
    service.prepare({ requestId: 'chat_s0', text: 'first' });
    service.prepare({ requestId: 'chat_s1', text: 'second' });
    await measurePending(service);
    expect(service.text).toBeNull();
    service.onPlayback('chat_s0', 'started');
    expect(service.text).toBe('first');
    expect(service.displayedText).toBe('');
    await vi.advanceTimersByTimeAsync(89);
    expect(service.displayedText).toBe('');
    await vi.advanceTimersByTimeAsync(1);
    expect(service.displayedText).toBe('f');
    service.onPlayback('chat_s1', 'started');
    expect(service.text).toBe('first\nsecond');
    expect(service.displayedText).toBe('first\n');
    service.onPlayback('chat_s0', 'finished');
    expect(service.activeRequestId).toBe('chat_s1');
    service.onPlayback('chat_s1', 'finished');
    expect(service.displayedText).toBe('first\nsecond');
    expect(service.measurement?.height).toBe(resolveBubbleTypography(1).verticalInset * 2 + 2 * resolveBubbleTypography(1).lineHeight);
  });

  it('maps playback received before multiline text and keeps that mapping after resize', async () => {
    service.onPlayback('chat_s0', 'started');
    service.prepare({ requestId: 'chat_s0', text: 'first\nsecond' });
    await measurePending(service);
    expect(service.text).toBe('first');
    service.configure(240, 1);
    await measurePending(service);
    service.onPlayback('chat_s0', 'finished');
    service.complete();
    expect(service.text).toBe('second');
    await vi.advanceTimersByTimeAsync(8800);
    expect(service.text).toBeNull();
  });

  it('moves the entire next sentence to a new page when the candidate exceeds four lines', async () => {
    const first = 'a'.repeat(35);
    const second = 'b'.repeat(20);
    service.prepare({ requestId: 'chat_s0', text: first });
    service.prepare({ requestId: 'chat_s1', text: second });
    await measurePending(service);
    service.onPlayback('chat_s0', 'started');
    service.onPlayback('chat_s0', 'finished');
    expect(service.text).toBe(first);
    service.onPlayback('chat_s1', 'started');
    expect(service.text).toBe(second);
    expect(service.measurement?.lineCount).toBe(2);
  });

  it('handles playback preceding the translation and measurement without replaying stale sentences', async () => {
    service.onPlayback('chat_s0', 'started');
    service.onPlayback('chat_s0', 'finished');
    service.onPlayback('chat_s1', 'started');
    service.prepare({ requestId: 'chat_s0', text: 'first' });
    service.prepare({ requestId: 'chat_s1', text: 'second' });
    await measurePending(service);
    expect(service.activeRequestId).toBe('chat_s1');
    expect(service.text).toBe('first\nsecond');
  });

  it('does not switch backwards when an older finish arrives after the latest sentence finishes', async () => {
    service.prepare({ requestId: 'chat_s0', text: 'first' });
    service.prepare({ requestId: 'chat_s1', text: 'second' });
    await measurePending(service);
    service.onPlayback('chat_s0', 'started');
    service.onPlayback('chat_s1', 'started');
    service.onPlayback('chat_s1', 'finished');
    service.onPlayback('chat_s0', 'finished');
    expect(service.activeRequestId).toBe('chat_s1');
    expect(service.displayedText).toBe('first\nsecond');
  });

  it('expands an oversized first sentence and isolates the next sentence', async () => {
    const oversized = 'a'.repeat(60);
    service.prepare({ requestId: 'chat_s0', text: oversized });
    service.prepare({ requestId: 'chat_s1', text: 'next' });
    await measurePending(service);
    service.onPlayback('chat_s0', 'started');
    expect(service.measurement?.lineCount).toBeGreaterThan(4);
    expect(service.measurement?.height).toBe(service.measurement!.lineCount * resolveBubbleTypography(1).lineHeight
      + 2 * resolveBubbleTypography(1).verticalInset);
    expect(service.text).toBe(oversized);
    service.onPlayback('chat_s1', 'started');
    expect(service.text).toBe('next');
  });

  it('rejects stale measurements and cancels typing on interruption', async () => {
    service.prepare({ requestId: 'chat_s0', text: 'old' });
    await flush();
    const old = service.measurementRequest!;
    service.begin('new');
    service.prepare({ requestId: 'new_s0', text: 'new' });
    await flush();
    service.submitMeasurement({ ...old, width: 200, height: 50, lineCount: 1 });
    expect(service.measurementRequest?.text).toBe('new');
    await measurePending(service);
    service.onPlayback('new_s0', 'started');
    service.clear();
    await vi.advanceTimersByTimeAsync(500);
    expect(service.text).toBeNull();
    expect(service.displayedText).toBe('');
  });

  it('remeasures on committed scale changes and preserves the active request', async () => {
    service.prepare({ requestId: 'chat_s0', text: 'first' });
    await measurePending(service);
    service.onPlayback('chat_s0', 'started');
    service.configure(160, 0.3);
    await flush();
    expect(service.measurementRequest).toMatchObject({ scale: 0.3, maxWidth: 160 });
    await measurePending(service);
    expect(service.activeRequestId).toBe('chat_s0');
    expect(service.measurement?.scale).toBe(0.3);
  });

  it('reuses a layout sample and dismisses only after the conversation and speech finish', async () => {
    service.prepare({ requestId: 'chat_s0', text: 'repeat' });
    await measurePending(service);
    service.onPlayback('chat_s0', 'started');
    service.complete();
    await vi.advanceTimersByTimeAsync(8000);
    expect(service.text).toBe('repeat');
    service.onPlayback('chat_s0', 'finished');
    await vi.advanceTimersByTimeAsync(9000);
    expect(service.text).toBeNull();
    service.begin('new');
    service.prepare({ requestId: 'new_s0', text: 'repeat' });
    await flush();
    expect(service.measurementRequest).toBeNull();
    service.onPlayback('new_s0', 'started');
    expect(service.text).toBe('repeat');
  });

  it('uses reading-paced presentation when TTS is disabled instead of leaving the bubble empty', async () => {
    service.prepare({ requestId: 'chat_s0', text: 'first' });
    service.prepare({ requestId: 'chat_s1', text: 'second' });
    service.onPlayback('chat_s0', 'skipped');
    service.onPlayback('chat_s1', 'skipped');
    service.complete();
    await measurePending(service);
    expect(service.activeRequestId).toBe('chat_s0');
    await vi.advanceTimersByTimeAsync(1800);
    expect(service.activeRequestId).toBe('chat_s1');
    await vi.advanceTimersByTimeAsync(1800);
    expect(service.displayedText).toBe('first\nsecond');
  });

  it('presents a sentence without a playback subscription', async () => {
    service.setPlaybackRequired(false);
    service.prepare({ requestId: 'chat_s0', text: 'text only' });
    service.complete();
    await measurePending(service);
    expect(service.activeRequestId).toBe('chat_s0');
    expect(service.text).toBe('text only');
    await vi.advanceTimersByTimeAsync(9000);
    expect(service.conversationId).toBeNull();
  });

  it('turns explicit line breaks into forced next-page segments', async () => {
    service.prepare({ requestId: 'chat_s0', text: 'first\nsecond' });
    await measurePending(service);
    service.onPlayback('chat_s0', 'started');
    expect(service.text).toBe('first');
    service.onPlayback('chat_s0#1', 'started');
    expect(service.text).toBe('second');
  });

  it('recovers terminal-only events and presents text when speech fails before starting', async () => {
    service.prepare({ requestId: 'chat_s0', text: 'first' });
    service.prepare({ requestId: 'chat_s1', text: 'second' });
    await measurePending(service);
    service.onPlayback('chat_s0', 'finished');
    service.onPlayback('chat_s1', 'finished');
    expect(service.activeRequestId).toBe('chat_s1');
    expect(service.displayedText).toBe('first\nsecond');
    service.begin('failed');
    service.prepare({ requestId: 'failed_s0', text: 'still readable' });
    service.onPlayback('failed_s0', 'error');
    await measurePending(service);
    expect(service.activeRequestId).toBe('failed_s0');
    await vi.advanceTimersByTimeAsync(1800);
    expect(service.displayedText).toBe('still readable');
  });
});
