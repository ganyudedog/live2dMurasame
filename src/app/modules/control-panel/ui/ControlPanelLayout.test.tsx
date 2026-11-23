import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import ControlPanelLayout from './ControlPanelLayout';

const render = (activeTab: string) => renderToStaticMarkup(
  <ControlPanelLayout activeTab={activeTab} onTabChange={() => {}} theme="light" onToggleTheme={() => {}}
    pluginGroups={[
      { key: 'plugin-group:astrbot/AstrBot QQ', title: 'AstrBot QQ', pages: [
        { tabId: 'plugin:astrbot/astrbot.connection', title: '连接与触发' },
        { tabId: 'plugin:astrbot/astrbot.reply', title: '回复设置' },
      ] },
      { key: 'plugin-group:feishu/飞书', title: '飞书', pages: [{ tabId: 'plugin:feishu/feishu.settings', title: '连接设置' }] },
    ]}
    pluginPages={[{ tabId: 'plugin:demo/demo.page', title: '独立页' }]}>
    <p>内容</p>
  </ControlPanelLayout>,
).replaceAll('<!-- -->', '');

it('插件自己的页面挂在插件列表下面，不和内置分组并列', () => {
  const html = render('home');
  const pluginGroup = html.slice(html.indexOf('>插件<'));
  expect(html.indexOf('AstrBot QQ')).toBeGreaterThan(html.indexOf('>插件<'));
  expect(pluginGroup.indexOf('插件列表')).toBeLessThan(pluginGroup.indexOf('aria-label="插件页面"'));
  for (const label of ['AstrBot QQ', '连接与触发', '回复设置', '飞书', '连接设置', '独立页']) {
    expect(pluginGroup).toContain(label);
  }
});

it('当前页面所在的插件分支会标出来', () => {
  const html = render('plugin:astrbot/astrbot.reply');
  const branch = html.slice(html.indexOf('aria-label="AstrBot QQ"'));
  expect(branch).toMatch(/aria-current="page"[^>]*>(?:(?!<\/button>).)*回复设置/);
});
