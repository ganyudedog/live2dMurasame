import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import PersonaSettingsPage, { RelationshipCard } from './PersonaSettingsPage';
import type { RelationshipView } from '../hooks/useModelRelationship';
import type { ModelConfig } from '../../domain/types';

/** 这个页面只读 persona，其余字段用一份占位配置即可。 */
const config = (persona: Partial<ModelConfig['persona']>): ModelConfig => ({
  persona: { name: '', userAddress: '', voice: '', examples: '', boundaries: '', notes: '', ...persona },
} as ModelConfig);

// React 会在相邻文本节点之间插入注释占位符，断言前先清掉。
const render = (persona: Partial<ModelConfig['persona']>) => renderToStaticMarkup(
  <PersonaSettingsPage modelConfig={config(persona)} modelPath={null} onModelConfigChange={async () => {}} />,
).replaceAll('<!-- -->', '');

it('关系还在读取时不冒充阶段', () => {
  const html = render({ name: '丛雨' });
  expect(html).toContain('当前关系');
  const relationshipCard = html.slice(html.indexOf('当前关系'), html.indexOf('每段都会成为提示词里的一节'));
  expect(relationshipCard).toContain('读取中');
  expect(relationshipCard).toContain('正在读取关系');
  expect(relationshipCard).not.toContain('好感');
  expect(relationshipCard).not.toContain('progressbar');
  expect(relationshipCard).not.toContain('<select');
});

const loadedView = (patch: Partial<RelationshipView> = {}): RelationshipView => ({
  stage: '信赖',
  line: '阶段：信赖。可以提起一起经历过的事，也会主动关心。',
  needsSelection: false,
  revision: 2,
  ...patch,
});

it('关系卡片显示当前阶段，并只提供阶段选择', () => {
  const html = renderToStaticMarkup(<RelationshipCard view={loadedView()} loading={false} busy={false}
    error="" actionError="" onReload={() => {}} onApply={async () => true} />).replaceAll('<!-- -->', '');
  expect(html).toContain('阶段：信赖');
  expect(html).toContain('应用这个阶段');
  expect(html).toContain('<select');
});

it('迁移不了的旧说明会明确要求先选择，而不是显示成某个阶段', () => {
  const html = renderToStaticMarkup(<RelationshipCard view={loadedView({
    stage: '', needsSelection: true,
    line: '阶段待选择。原先的说明仍保留，但不能当作已经确定的阶段：阶段：讨厌。别说话。',
  })} loading={false} busy={false} error="" actionError="关系刚刚在另一处更新了，请再看一眼现在的阶段，然后重新调整。"
    onReload={() => {}} onApply={async () => false} />)
    .replaceAll('<!-- -->', '');
  expect(html).toContain('待选择');
  expect(html).toContain('别说话');
  expect(html).toContain('请选择阶段');
  expect(html).toContain('关系刚刚在另一处更新了');
  expect(html).not.toContain('阶段：亲近');
});
