import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionCatalogService } from '../service/ActionCatalogService';
import { actionSources, headAction } from '../../../../../../test/fixtures/actionCatalog';
import type { GenerationCheckpoint, GenerationReviewReport } from '../domain/action-catalog/generation';

const reply = JSON.stringify({ actions: [headAction] });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('action task budget and recovery', () => {
  it('continues beyond two repairs while the fixed issue set shrinks', async () => {
    let repairs = 0;
    let report: GenerationReviewReport | undefined;
    const request = vi.fn(async (prompt: string, input: string) => {
      const body = JSON.parse(input);
      if (prompt.includes('当前任务是审查')) return JSON.stringify({ issues: body.previousIssues.length
        ? body.previousIssues.slice(1) : Array.from({ length: 4 }, (_, i) => ({ actionId: 'head', message: '改善' + i })) });
      if (prompt.includes('只修订给定actions')) return JSON.stringify({ summary: '已改善对应时序',
        actions: [{ ...headAction, returnMs: 500 + 50 * ++repairs }] });
      return reply;
    });
    const result = await new ActionCatalogService(request).generate(actionSources, undefined, undefined, {
      onReviewReport: (value) => { report = value; },
    });
    expect(repairs).toBe(4);
    expect(report?.status).toBe('ready');
    expect(report?.task?.noProgressCount).toBe(0);
    expect(result[0].returnMs).toBe(700);
    const previousIds = request.mock.calls.filter(([prompt]) => prompt.includes('只修订给定actions'))
      .map(([, input]) => JSON.parse(input).issues.map((i: { issueId: string }) => i.issueId));
    expect(previousIds[1]).toEqual(previousIds[0].slice(1));
  });

  it('resumes after a day with fresh run budget and the same task identity', async () => {
    let checkpoint: GenerationCheckpoint | undefined;
    const request = vi.fn(async (prompt: string) => prompt.includes('当前任务是审查') ? '{"issues":[]}' : reply);
    const service = new ActionCatalogService(request);
    await expect(service.generate(actionSources, undefined, undefined, { budget: { maxCalls: 1 },
      onCheckpoint: (value) => { checkpoint = value; } })).rejects.toThrow('调用预算');
    const first = structuredClone(checkpoint!);
    expect(first.task?.status).toBe('paused');
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 86400000);
    expect(await service.generate(actionSources, undefined, undefined, { checkpoint: first, budget: { maxCalls: 2 },
      onCheckpoint: (value) => { checkpoint = value; } })).toEqual([headAction]);
    expect(checkpoint?.task).toMatchObject({ taskId: first.task!.taskId, run: 2, runCalls: 2, calls: 3, status: 'completed' });
    expect(checkpoint!.task!.elapsedMs).toBeLessThan(10000);
  });

  it('persists actual best trajectories and returns their issues after a worse revision and restart', async () => {
    let checkpoint: GenerationCheckpoint | undefined;
    let report: GenerationReviewReport | undefined;
    const revised = { ...headAction, returnMs: 800 };
    const request = vi.fn().mockResolvedValueOnce(reply).mockResolvedValueOnce(reply)
      .mockResolvedValueOnce('{"issues":[{"actionId":"head","message":"原建议"}]}')
      .mockResolvedValueOnce(JSON.stringify({ actions: [revised] })).mockRejectedValueOnce(new Error('network'));
    const service = new ActionCatalogService(request);
    await expect(service.generate(actionSources, undefined, undefined, { onCheckpoint: (value) => { checkpoint = value; } })).rejects.toThrow('network');
    expect(checkpoint?.review?.best?.actions).toEqual([headAction]);
    expect(checkpoint?.composition?.draft).toEqual([revised]);
    request.mockReset().mockResolvedValue('{"issues":[{"actionId":"head","message":"变差一"},{"actionId":"head","message":"变差二"}]}');
    const result = await service.generate(actionSources, undefined, undefined, { checkpoint, budget: { maxNoProgress: 1 },
      onReviewReport: (value) => { report = value; } });
    expect(result).toEqual([headAction]);
    expect(report?.issues.map((i) => i.message)).toEqual(['原建议']);
    expect(report?.task?.currentVersionId).toBe(report?.task?.bestVersionId);
    expect(request).toHaveBeenCalledOnce();
  });

  it('finishes with a validated best candidate when the next repair exceeds budget', async () => {
    const report = vi.fn();
    const request = vi.fn(async (prompt: string) => prompt.includes('当前任务是审查')
      ? '{"issues":[{"actionId":"head","message":"可以再调整"}]}' : reply);
    expect(await new ActionCatalogService(request).generate(actionSources, undefined, undefined, {
      budget: { maxCalls: 3 }, onReviewReport: report,
    })).toEqual([headAction]);
    expect(request).toHaveBeenCalledTimes(3);
    expect(report.mock.calls[0][0]).toMatchObject({ stopReason: 'budget', status: 'needs-preview' });
  });

  it('enforces time budget even when the provider ignores abort', async () => {
    vi.useFakeTimers();
    let checkpoint: GenerationCheckpoint | undefined;
    const request = vi.fn(() => new Promise<string>(() => {}));
    const task = new ActionCatalogService(request).generate(actionSources, undefined, undefined, {
      budget: { maxDurationMs: 20 }, onCheckpoint: (value) => { checkpoint = value; },
    });
    const assertion = expect(task).rejects.toThrow('时间预算');
    await vi.advanceTimersByTimeAsync(21);
    await assertion;
    expect(checkpoint?.task).toMatchObject({ status: 'paused', stopReason: 'budget', calls: 1 });
  });

  it('retains a paid refinement and skips regenerating it after review failure', async () => {
    let checkpoint: GenerationCheckpoint | undefined;
    const refined = { ...headAction, returnMs: 650 };
    const request = vi.fn().mockResolvedValueOnce(JSON.stringify({ actions: [refined], message: '已调整' }))
      .mockRejectedValueOnce(new Error('review failed'));
    const input = { sources: actionSources, actions: [headAction], referencedIds: ['head'], instruction: '调整回退', history: [] };
    const service = new ActionCatalogService(request);
    await expect(service.refine(input, undefined, undefined, { onCheckpoint: (value) => { checkpoint = value; } })).rejects.toThrow('review failed');
    request.mockReset().mockResolvedValue('{"issues":[]}');
    expect(await service.refine(input, undefined, undefined, { checkpoint })).toMatchObject({ actions: [refined], message: '已调整' });
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0][0]).toContain('当前任务是审查');
  });
});
