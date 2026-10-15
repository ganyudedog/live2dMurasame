import { describe, expect, it, vi } from 'vitest';
import { ActionCatalogService } from '../service/ActionCatalogService';
import { LlmService } from '../service/LlmService';
import { headAction, actionSources } from '../../../../../../test/fixtures/actionCatalog';
import { sourceContexts } from '../domain/action-catalog/sourceContext';

describe('LLM parameter animation generation', () => {
  it('is owned by LlmService and sends actual curves through the shared request channel', async () => {
    const llm = new LlmService({ getConfigSnapshot: () => null });
    const request = vi.spyOn(llm, 'requestStructured').mockResolvedValue(JSON.stringify({ actions: [headAction] }));
    expect(await llm.actionCatalog.generate(actionSources)).toEqual([headAction]);
    const input = JSON.parse(request.mock.calls[0][1]);
    expect(input.sources.curves[0].samples).toEqual([[0, -20], [1000, 20]]);
    expect(request.mock.calls[0][0]).toContain('keyframes');
    llm.dispose();
  });

  it('refuses native aliases and unknown parameter tracks instead of returning a partial table', async () => {
    const request = vi.fn().mockResolvedValueOnce(JSON.stringify({ actions: [
      { id: 'head', label: '转头', category: 'head', source: { group: 'Talk', index: 0 } },
    ] })).mockResolvedValueOnce(JSON.stringify({ actions: [headAction, {
      ...headAction, id: 'unknown', tracks: [{ parameterId: 'NotInModel', keyframes: [{ timeMs: 0, value: 1 }] }],
    }] }));
    const generator = new ActionCatalogService(request);
    await expect(generator.generate(actionSources)).rejects.toThrow();
    await expect(generator.generate(actionSources)).rejects.toThrow('NotInModel');
  });

  it('preserves separate edit history and supports a conversational reply without a save', async () => {
    const request = vi.fn().mockResolvedValue('{"message":"可以增大头部轨迹幅度"}');
    const generator = new ActionCatalogService(request);
    const result = await generator.refine({ sources: actionSources, actions: [headAction],
      referencedIds: ['head'], instruction: '@head 幅度太小', history: [] });
    expect(result).toEqual({ message: '可以增大头部轨迹幅度', actions: undefined });
    expect(JSON.parse(request.mock.calls[0][1]).actions[0].tracks).toEqual(headAction.tracks);
  });

  it('analyzes every oversized source batch before consolidation and honors cancellation', async () => {
    const sources = { ...actionSources, motions: Array.from({ length: 220 }, (_, index) => ({
      ...actionSources.motions[0], index,
    })) };
    const contexts = sourceContexts(sources);
    expect(contexts.length).toBeGreaterThan(1);
    const request = vi.fn().mockResolvedValue(JSON.stringify({ actions: [headAction] }));
    const generator = new ActionCatalogService(request);
    const progress = vi.fn();
    expect(await generator.generate(sources, undefined, progress)).toEqual([headAction]);
    expect(request).toHaveBeenCalledTimes(contexts.length + 1);
    const analyzed = request.mock.calls.slice(0, -1).flatMap((call) => JSON.parse(call[1]).sources.curves);
    expect(analyzed).toHaveLength(440);
    expect(analyzed.at(-1).index).toBe(219);
    expect(progress).toHaveBeenLastCalledWith(contexts.length, contexts.length);
    const controller = new AbortController();
    request.mockClear();
    await expect(generator.generate(sources, controller.signal, (completed) => {
      if (completed === 1) controller.abort();
    })).rejects.toThrow('取消');
    expect(request).toHaveBeenCalledTimes(1);
  });
});
