import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { MarkdownText } from './MarkdownText';

const render = (text: string) => renderToStaticMarkup(<MarkdownText text={text} />);

it('renders basic markdown as elements', () => {
  const html = render('这会儿已是 **1:28**。\n\n- 喝水\n- 睡觉\n\n`npm i`');
  expect(html).toContain('<strong class="font-semibold">1:28</strong>');
  expect(html).toContain('<ul');
  expect(html).toContain('<li');
  expect(html).toContain('<code');
  expect(html).not.toContain('**');
});

it('treats raw html as text', () => {
  const html = render('<script>alert(1)</script>');
  expect(html).not.toContain('<script>');
  expect(html).toContain('&lt;script&gt;');
});

it('only links web addresses', () => {
  expect(render('[官网](https://example.com)')).toContain('href="https://example.com"');
  const unsafe = render('[点我](javascript:alert(1))');
  expect(unsafe).not.toContain('href=');
  expect(unsafe).toContain('点我');
});

it('keeps an unfinished stream readable', () => {
  expect(render('就剩 **两分')).toContain('**两分');
});
