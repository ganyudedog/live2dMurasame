import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ChatBubble } from '../ui/components/ChatBubble';
import { splitRichDialogue } from '../domain/dialogue';

const [[sentence]] = splitRichDialogue('已是 **1:28**。');

it('draws styled runs without markdown or marker characters', () => {
  const html = renderToStaticMarkup(<ChatBubble text={sentence} side="start" tail={{ y: 14 }} autoAdvance={false} />);
  expect(html).toContain('font-weight="800"');
  expect(html).toContain('1:28');
  expect(html).not.toContain('**');
  expect(html).not.toMatch(/[\uE000-\uE00F]/u);
  expect(html).toContain('aria-label="已是 1:28。"');
});

it('reveals a typing prefix by visible characters on the final layout', () => {
  // 前缀停在加粗开始的标记之后、第一个加粗字之前。
  const prefix = Array.from(sentence).slice(0, 4).join('');
  const html = renderToStaticMarkup(<ChatBubble text={sentence} displayText={prefix} side="start" tail={{ y: 14 }}
    autoAdvance={false} />);
  expect(html).toContain('已是 ');
  expect(html).not.toContain('1:28');
  expect(html).not.toMatch(/[\uE000-\uE00F]/u);
});
