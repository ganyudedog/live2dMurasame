// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import ChatPanel from './ChatPanel';

const thumb = 'data:image/webp;base64,AAAA';
const full = 'data:image/png;base64,BBBB';

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

async function render(messages: Parameters<typeof ChatPanel>[0]['messages']) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(() => root.render(<ChatPanel title="对话" emptyMessage="空" messages={messages} draft="" busy={false}
    inputLabel="输入" placeholder="" onDraftChange={() => {}} onSubmit={() => {}} />));
  return { host, unmount: () => act(() => root.unmount()) };
}

it('shows sent images in the history and hides the image-only placeholder text', async () => {
  const { host, unmount } = await render([{ id: 'u1', role: 'user', text: '[附有 2 张图片]', status: 'done',
    imageCount: 2, images: [full, full], thumbnails: [thumb, thumb] }]);
  const log = host.querySelector('[role=log]')!;
  expect(log.querySelectorAll('img')).toHaveLength(2);
  expect(log.querySelector('img')!.getAttribute('src')).toBe(thumb);
  expect(log.textContent).not.toContain('[附有 2 张图片]');

  await act(() => { (log.querySelector('button[aria-label="查看第 1 张图片"]') as HTMLButtonElement).click(); });
  const dialog = document.querySelector('[role=dialog]')!;
  expect(dialog.querySelector('img')!.getAttribute('src')).toBe(full);
  expect(dialog.textContent).toContain('1 / 2');
  await unmount();
});

it('keeps the caption and marks images whose preview was not cached', async () => {
  const { host, unmount } = await render([{ id: 'u1', role: 'user', text: '看看这两张', status: 'done',
    imageCount: 2, thumbnails: [thumb] }]);
  const log = host.querySelector('[role=log]')!;
  expect(log.querySelectorAll('img')).toHaveLength(1);
  expect(log.textContent).toContain('图片未保存');
  expect(log.textContent).toContain('看看这两张');
  await unmount();
});
