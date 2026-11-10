import { expect, it } from 'vitest';
import { RELATIONSHIP_STAGES, isKnownStage, type PublicRelationship } from '@app/modules/ai/modules/llm/domain/memory/memoryContext';
import { acceptRelationshipSnapshot, canSubmitRelationshipAdjustment, readRelationshipView } from './useModelRelationship';
import { DEFAULT_RELATIONSHIP_STAGE, STAGE_LINES } from '@app/modules/ai/modules/llm/domain/memory/memoryContext';

const coreWith = (stageLine: string) => [
  '# 核心记忆',
  '',
  '## 当前关系',
  `- ${stageLine}`,
  '',
  '## 事件',
  '- 2026-01-01 一起吃了饭。',
].join('\n');

const stored = (patch: Partial<PublicRelationship>): PublicRelationship => ({
  version: 1,
  stage: '信赖',
  revision: 3,
  stageChangedAt: 1,
  needsSelection: false,
  legacyText: '',
  line: '阶段：信赖。可以提起那次。',
  progress: { interactionDays: [], experiences: [] },
  evidenceAfterCount: 0,
  knownExperiences: [],
  ...patch,
});

it('没有配置关系时阶段和行文都默认亲近', () => {
  const view = readRelationshipView('');
  expect(view.stage).toBe('亲近');
  expect(view.needsSelection).toBe(false);
  expect(view.line).toBe(STAGE_LINES[DEFAULT_RELATIONSHIP_STAGE]);
});

it('有「当前关系」一节时取里面的阶段与那一行', () => {
  const view = readRelationshipView(coreWith('阶段：信赖。可以直接吐槽，也会主动关心。'));
  expect(view.stage).toBe('信赖');
  expect(view.line).toContain('阶段：信赖');
});

it('对不上的旧阶段标成待选择，不改写成默认阶段', () => {
  const view = readRelationshipView(coreWith('阶段：友好。'));
  expect(view.needsSelection).toBe(true);
  expect(view.stage).toBe('');
  expect(view.line).not.toContain('阶段：亲近');
  expect(isKnownStage(view.stage)).toBe(false);
});

it('预设阶段都能被识别', () => {
  for (const stage of RELATIONSHIP_STAGES) {
    const view = readRelationshipView(coreWith(`阶段：${stage}。`));
    expect(view.stage).toBe(stage);
    expect(isKnownStage(view.stage)).toBe(true);
  }
});

it('权威状态盖过核心记忆里互相矛盾的阶段句子', () => {
  const view = readRelationshipView({
    coreText: coreWith('阶段：亲密。我们在一起。'),
    relationship: stored({}),
  });
  expect(view.stage).toBe('信赖');
  expect(view.line).toContain('可以提起那次');
  expect(view.line).not.toContain('亲密');
  expect(view.revision).toBe(3);
});

it('不会用上一个模型的版本号给新模型提交调整', () => {
  expect(canSubmitRelationshipAdjustment({ modelPath: 'model-a', revision: 5 }, 'model-b')).toBe(false);
  expect(canSubmitRelationshipAdjustment({ modelPath: 'model-b', revision: 1 }, 'model-b')).toBe(true);
  expect(canSubmitRelationshipAdjustment(null, 'model-b')).toBe(false);
});

it('更旧的读取或调整结果不能盖住已经广播来的新版本', () => {
  const current = { modelPath: 'model-b', revision: 4 };
  expect(acceptRelationshipSnapshot(current, 'model-b', { modelPath: 'model-b', relationship: { revision: 2 } })).toBe(false);
  expect(acceptRelationshipSnapshot(current, 'model-b', { modelPath: 'model-a', relationship: { revision: 9 } })).toBe(false);
  expect(acceptRelationshipSnapshot({ modelPath: 'model-a', revision: 5 }, 'model-b', {
    modelPath: 'model-b', relationship: { revision: 1 },
  })).toBe(true);
  expect(acceptRelationshipSnapshot(current, 'model-b', { modelPath: 'model-b', relationship: { revision: 4 } })).toBe(true);
});
