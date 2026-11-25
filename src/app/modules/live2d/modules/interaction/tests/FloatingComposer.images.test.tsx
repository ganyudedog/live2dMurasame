// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { FloatingComposer } from '../ui/components/FloatingComposer';
import { FloatingComposerService } from '../service/FloatingComposerService';
import type { StateBusService } from '@app/shared/state-bus/StateBusService';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
afterEach(() => vi.unstubAllGlobals());
it('selects files in the pet composer and rejects an invalid selection before publishing any part of the turn', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const bus = { composerDraft: '看图', publishChatRequest: vi.fn(), publishComposerDraft: vi.fn() };
  const service = new FloatingComposerService(bus as unknown as StateBusService);
  service.setFocused(true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() => root.render(<FloatingComposer service={service} style={{ left: 0, top: 0, width: 320, height: 64 }} onInteractivityChange={() => {}} />));
    const input = host.querySelector('input[type=file]')!;
    const textarea = host.querySelector('textarea')!;
    const photo = new File([Uint8Array.from(atob(png), c => c.charCodeAt(0))], 'test.png', { type: 'image/png' });
    async function send(files: File[], invalid = true) {
      Object.defineProperty(input, 'files', { configurable: true, value: files });
      await act(() => { input.dispatchEvent(new Event('change', { bubbles: true })); });
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
      expect(invalid ? host.querySelector('[role=alert]') : host.querySelector('img')).toBeTruthy();
      await act(() => { textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    }
    for (const files of [Array(5).fill(photo), [new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' })]]) {
      await send(files);
      expect(host.querySelector('[role=alert]')).toBeTruthy();
      expect(bus.publishChatRequest).not.toHaveBeenCalled();
    }
    const paste = new Event('paste', { bubbles: true });
    Object.defineProperty(paste, 'clipboardData', { value: { files: [photo] } });
    await act(() => { textarea.dispatchEvent(paste); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
    expect(host.querySelector('img')).toBeTruthy();
    expect(host.querySelector('button[aria-label^="移除图片"]')).toBeTruthy();
    await act(() => { (host.querySelector('button[aria-label^="移除图片"]') as HTMLButtonElement).click(); });
    expect(host.querySelector('img')).toBeNull();
    await send([photo], false);
    await act(async () => { await vi.waitFor(() => expect(bus.publishChatRequest).toHaveBeenCalledOnce()); });
    expect(bus.publishChatRequest.mock.calls[0][0]).toMatchObject({ text: '看图', images: [`data:image/png;base64,${png}`] });
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});
