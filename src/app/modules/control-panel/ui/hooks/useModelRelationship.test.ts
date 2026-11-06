import { expect, it } from 'vitest';
import { DEFAULT_RELATIONSHIP_LINE, RELATIONSHIP_STAGES } from '@app/modules/ai/modules/llm/domain/memory/memoryContext';
import { isKnownStage, readRelationshipView } from './useModelRelationship';

const coreWith = (stageLine: string) => [
  '# 核心记忆',
  '',
  '## 当前关系',
  `- ${stageLine}`,
  '',
  '## 事件',
  '- 2026-01-01 一起吃了饭。',
].join('\n');

it('没有记忆文本时按未记录处理，行文用默认阶段', () => {
  const view = readRelationshipView('');
  expect(view.recorded).toBe(false);
  expect(view.stage).toBe('');
  expect(view.line).toBe(DEFAULT_RELATIONSHIP_LINE);
});

it('有「当前关系」一节时取里面的阶段与那一行', () => {
  const view = readRelationshipView(coreWith('阶段：信赖。可以直接吐槽，也会主动关心。'));
  expect(view.recorded).toBe(true);
  expect(view.stage).toBe('信赖');
  expect(view.line).toContain('阶段：信赖');
  expect(view.coreChars).toBeGreaterThan(0);
});

it('非预设阶段原样展示，不静默改写成默认值', () => {
  const view = readRelationshipView(coreWith('阶段：友好。'));
  expect(view.recorded).toBe(true);
  expect(view.stage).toBe('友好');
  expect(isKnownStage(view.stage)).toBe(false);
});

it('预设阶段都能被识别', () => {
  for (const stage of RELATIONSHIP_STAGES) {
    const view = readRelationshipView(coreWith(`阶段：${stage}。`));
    expect(view.stage).toBe(stage);
    expect(isKnownStage(view.stage)).toBe(true);
  }
});
