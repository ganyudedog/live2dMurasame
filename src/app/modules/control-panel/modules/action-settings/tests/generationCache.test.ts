import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearGenerationCheckpoint, generationKey, readGenerationCheckpoint, writeGenerationCheckpoint } from '../infrastructure/generationCache';
import { headAction } from '../../../../../../test/fixtures/actionCatalog';
import type { GenerationCheckpoint } from '@app/modules/ai/modules/llm/domain/action-catalog/generation';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('window', { localStorage: { getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) } });
  clearGenerationCheckpoint('model-a');
});
afterEach(() => vi.unstubAllGlobals());

describe('generation checkpoints owned by the settings workspace', () => {
  it('restores task identity, partial review and the actual best version after a workspace restart', () => {
    const issues = [{ actionId: headAction.id, issueId: 'issue-1-1', code: 'review', severity: 'warning' as const, message: '调整衔接' }];
    const checkpoint: GenerationCheckpoint = {
      batches: { 0: [headAction] },
      composition: { version: 'reaction-plan-v1', completed: {}, draft: [headAction] },
      task: { schemaVersion: 1, taskId: 'task-persisted', revision: 2, currentVersionId: 'v2', bestVersionId: 'v1',
        calls: 7, startedAt: 100, run: 1, runCalls: 7, elapsedMs: 5000,
        budget: { maxCalls: 48, maxDurationMs: 900000, maxNoProgress: 2 }, status: 'paused', stopReason: 'budget',
        noProgressCount: 1, openIssueIds: ['issue-1-1'], plan: ['编排转头回应'], issues,
        history: [{ versionId: 'v1', summary: '改善衔接', issueIds: ['issue-1-1'] }] },
      review: { round: 1, previousIssues: issues, reviewIds: [headAction.id], completedIds: [headAction.id], issues,
        best: { versionId: 'v1', actions: [headAction], issues, score: 1 }, seen: ['trajectory-1'] },
      lastResponse: { key: 'paid-response', text: '{"issues":[]}' },
      refinement: { message: '保留已完成调整', actions: [headAction] },
    };
    expect(writeGenerationCheckpoint('model-a', 'key', checkpoint, 'refine')).toBe(true);
    const disk = store.get('pet:action-generation:model-a:refine')!;
    clearGenerationCheckpoint('model-a', 'refine');
    store.set('pet:action-generation:model-a:refine', disk);
    expect(readGenerationCheckpoint('model-a', 'key', 'refine')).toEqual(checkpoint);
    expect(readGenerationCheckpoint('model-a', 'key')).toBeUndefined();
    clearGenerationCheckpoint('model-a', 'refine');
  });

  it('reads legacy disk batches and preserves them if only the composition checkpoint is invalid', () => {
    const batches = { 0: [headAction] };
    store.set('pet:action-generation:model-a', JSON.stringify({ key: 'key', checkpoint: { batches } }));
    expect(readGenerationCheckpoint('model-a', 'key')).toEqual({ batches });
    store.set('pet:action-generation:model-a', JSON.stringify({ key: 'key', checkpoint: { batches,
      composition: { version: 'reaction-plan-v1', plans: [], completed: {} } } }));
    expect(readGenerationCheckpoint('model-a', 'key')).toEqual({ batches });
  });

  it('restores a partial composition from disk as well as analysis', () => {
    const checkpoint = { batches: { 0: [headAction] }, composition: { version: 'reaction-plan-v1',
      plans: [{ id: 'head', label: '转头回应', description: '肯定回应', candidateIndexes: [0] }],
      completed: { head: headAction } } };
    store.set('pet:action-generation:model-a', JSON.stringify({ key: 'key', checkpoint }));
    expect(readGenerationCheckpoint('model-a', 'key')).toEqual(checkpoint);
  });

  it('invalidates changed evidence or configuration and never stores credentials', async () => {
    const key = await generationKey({ sources: 'v1', apiKey: 'secret' });
    const checkpoint = { batches: { 0: [headAction] } };
    writeGenerationCheckpoint('model-a', key, checkpoint);
    expect(readGenerationCheckpoint('model-a', key)).toEqual(checkpoint);
    expect([...store.values()].join('')).not.toContain('secret');
    expect(readGenerationCheckpoint('model-b', key)).toBeUndefined();
    expect(readGenerationCheckpoint('model-a', await generationKey({ sources: 'v2', apiKey: 'secret' }))).toBeUndefined();
    expect(readGenerationCheckpoint('model-a', await generationKey({ sources: 'v1', apiKey: 'changed' }))).toBeUndefined();
    clearGenerationCheckpoint('model-a');
    expect(readGenerationCheckpoint('model-a', key)).toBeUndefined();
  });

  it('tolerates malformed and unavailable cache storage', () => {
    store.set('pet:action-generation:model-a', '{broken');
    expect(readGenerationCheckpoint('model-a', 'key')).toBeUndefined();
    store.set('pet:action-generation:model-a', JSON.stringify({ key: 'key', checkpoint: { batches: { 0: ['broken'] } } }));
    expect(readGenerationCheckpoint('model-a', 'key')).toBeUndefined();
    vi.stubGlobal('window', { localStorage: { setItem: () => { throw new Error('quota'); } } });
    expect(writeGenerationCheckpoint('model-a', 'key', { batches: {} })).toBe(false);
    expect(readGenerationCheckpoint('model-a', 'key')).toEqual({ batches: {} });
    expect(() => clearGenerationCheckpoint('model-a')).not.toThrow();
  });
});
