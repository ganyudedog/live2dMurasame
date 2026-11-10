import { afterEach, expect, it, vi } from 'vitest';
import { LlmMemoryRepository } from './LlmMemoryRepository';

afterEach(() => vi.unstubAllGlobals());

it('forwards a stage adjustment and consolidation evidence, without an undo API', async () => {
  const adjustRelationship = vi.fn(async () => ({ relationship: { revision: 2 } }));
  const consolidate = vi.fn(async () => ({ relationship: { revision: 2 } }));
  vi.stubGlobal('window', { MemoryAPI: { adjustRelationship, consolidate } });
  const repository = new LlmMemoryRepository();
  await repository.adjustRelationship({ modelPath: 'model-a', expectedRevision: 1, stage: '信赖' });
  await repository.consolidate({
    modelPath: 'model-a', content: '# 核心记忆', processedThroughCount: 1,
    relationshipEvents: [{ kind: 'shared-experience', experienceId: 'lake', summary: '一起看过西湖' }],
  });
  expect(adjustRelationship).toHaveBeenCalledWith({
    modelPath: 'model-a', expectedRevision: 1, stage: '信赖',
  });
  expect(consolidate).toHaveBeenCalledWith(expect.objectContaining({
    relationshipEvents: [expect.objectContaining({ experienceId: 'lake' })],
  }));
  expect(repository).not.toHaveProperty('undoRelationshipAdjustment');
  expect(repository).not.toHaveProperty('relationshipHistory');
});
