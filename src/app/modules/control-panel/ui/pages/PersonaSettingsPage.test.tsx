import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import PersonaSettingsPage from './PersonaSettingsPage';
import type { ModelConfig } from '../../domain/types';

/** 这个页面只读 persona，其余字段用一份占位配置即可。 */
const config = (persona: Partial<ModelConfig['persona']>): ModelConfig => ({
  persona: { name: '', userAddress: '', voice: '', examples: '', boundaries: '', notes: '', ...persona },
} as ModelConfig);

// React 会在相邻文本节点之间插入注释占位符，断言前先清掉。
const render = (persona: Partial<ModelConfig['persona']>) => renderToStaticMarkup(
  <PersonaSettingsPage modelConfig={config(persona)} modelPath={null} onModelConfigChange={async () => {}} />,
).replaceAll('<!-- -->', '');

it('显示已填写的字段、计数与拼装后的段落', () => {
  const html = render({ name: '丛雨', voice: '傲娇', examples: '你：早\n丛雨：嗯。' });
  expect(html).toContain('丛雨');
  expect(html).toContain('3 / 6 项已填写');
  expect(html).toContain('[名字]');
  expect(html).toContain('[性格与口吻]');
  expect(html).toContain('[示例对话]');
  expect(html).not.toContain('[边界]');
  expect(html).toContain('提示词预览');
});

it('全空时不生成任何人设段落', () => {
  const html = render({});
  expect(html).toContain('0 / 6 项已填写');
  expect(html).toContain('（暂无内容）');
  expect(html).toContain('人设这一段不会出现在系统提示词里');
});

it('关系区块只读展示，且没有编辑控件', () => {
  const html = render({ name: '丛雨' });
  expect(html).toContain('当前关系');
  expect(html).toContain('前端暂不提供修改入口');
  // 关系区块里不能出现输入控件；只读文本 + 刷新按钮。
  const relationshipCard = html.slice(html.indexOf('当前关系'), html.indexOf('每段都会成为提示词里的一节'));
  expect(relationshipCard).not.toContain('<input');
  expect(relationshipCard).not.toContain('<textarea');
  expect(relationshipCard).not.toContain('<select');
  // 只读区块里唯一的交互控件是刷新按钮。
  expect(relationshipCard.match(/<button/g)).toHaveLength(1);
  // 首帧还没读到记忆：显示读取中，不冒充任何阶段。
  expect(relationshipCard).toContain('读取中');
});
