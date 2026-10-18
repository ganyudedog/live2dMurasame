import { describe, expect, it, vi } from 'vitest';
import { ActionCatalogService } from '../service/ActionCatalogService';
import { LlmService } from '../service/LlmService';
import { headAction, actionSources } from '../../../../../../test/fixtures/actionCatalog';
import { sourceContexts } from '../domain/action-catalog/sourceContext';
import { inspectActions } from '../domain/action-catalog/quality';
import type { GenerationCheckpoint } from '../domain/action-catalog/generation';

const reply = JSON.stringify({ actions: [headAction] });
const passing = (prompt: string) => Promise.resolve(prompt.includes('当前任务是审查') ? '{"issues":[]}' : reply);

const detailedCandidates = Array.from({ length: 6 }, (_, index) => ({ ...headAction, id: `reaction_${index}`,
  tracks: actionSources.parameters.map((parameter) => ({ parameterId: parameter.id,
    keyframes: Array.from({ length: 120 }, (_, i) => ({ timeMs: i * 7, value: (Math.sin(i) + 1) / 2 })) })) }));
const reactionPlans = detailedCandidates.map((action, index) => ({ id: action.id, label: action.label,
  description: `对话反应${index}`, candidateIndexes: [index] }));

describe('composite reaction generation', () => {
  it('resumes only unfinished review groups after an interrupted large-catalog review', async () => {
    let checkpoint: GenerationCheckpoint = { batches: { 0: detailedCandidates },
      composition: { version: 'reaction-plan-v1', completed: {}, draft: detailedCandidates } };
    const request = vi.fn().mockResolvedValueOnce('{"issues":[]}').mockRejectedValueOnce(new Error('network'));
    const service = new ActionCatalogService(request);
    await expect(service.generate(actionSources, undefined, undefined, { checkpoint,
      onCheckpoint: (value) => { checkpoint = value; } })).rejects.toThrow('network');
    const approved = [...checkpoint.review!.completedIds];
    expect(approved.length).toBeGreaterThan(0);
    request.mockReset().mockResolvedValue('{"issues":[]}');
    expect(await service.generate(actionSources, undefined, undefined, { checkpoint })).toEqual(detailedCandidates);
    for (const [, input] of request.mock.calls)
      expect(JSON.parse(input).actions.every((a: { id: string }) => !approved.includes(a.id))).toBe(true);
  });
  it('plans a large catalog without demanding fewer output actions and reuses legacy analysis batches', async () => {
    expect(JSON.stringify(detailedCandidates).length).toBeGreaterThan(40000);
    const request = vi.fn().mockImplementation(async (prompt: string, input: string) => {
      if (prompt.includes('只规划语义目录')) return JSON.stringify({ plans: reactionPlans });
      if (prompt.includes('只生成计划中的一个')) {
        const { plan } = JSON.parse(input);
        return JSON.stringify({ actions: [detailedCandidates.find((a) => a.id === plan.id)] });
      }
      if (prompt.includes('当前任务是审查')) return '{"issues":[]}';
      throw new Error('must not re-analyze cached curves or merge repeatedly');
    });
    const progress = vi.fn();
    expect(await new ActionCatalogService(request).generate(actionSources, undefined, progress,
      { checkpoint: { batches: { 0: detailedCandidates } } })).toEqual(detailedCandidates);
    expect(request.mock.calls.filter(([prompt]) => prompt.includes('只生成计划中的一个'))).toHaveLength(6);
    expect(progress.mock.calls.some(([p]) => p.stage === 'analyzing' && p.reused === 1)).toBe(true);
  });

  it('resumes at the unfinished composition without rerunning analysis, planning or completed reactions', async () => {
    let checkpoint: GenerationCheckpoint = { batches: { 0: detailedCandidates } };
    const composed: string[] = [];
    const request = vi.fn().mockImplementation(async (prompt: string, input: string) => {
      if (prompt.includes('只规划语义目录')) return JSON.stringify({ plans: reactionPlans });
      const { plan } = JSON.parse(input);
      if (plan.id === 'reaction_2') throw new Error('connection lost');
      composed.push(plan.id);
      return JSON.stringify({ actions: [detailedCandidates.find((a) => a.id === plan.id)] });
    });
    const generator = new ActionCatalogService(request);
    await expect(generator.generate(actionSources, undefined, undefined,
      { checkpoint, onCheckpoint: (value) => { checkpoint = value; } })).rejects.toThrow('connection lost');
    expect(Object.keys(checkpoint.composition!.completed)).toEqual(['reaction_0', 'reaction_1']);
    request.mockClear().mockImplementation(async (prompt: string, input: string) => {
      if (prompt.includes('当前任务是审查')) return '{"issues":[]}';
      if (!prompt.includes('只生成计划中的一个')) throw new Error('unexpected repeated work');
      const { plan } = JSON.parse(input);
      composed.push(plan.id);
      return JSON.stringify({ actions: [detailedCandidates.find((a) => a.id === plan.id)] });
    });
    expect(await generator.generate(actionSources, undefined, undefined, { checkpoint })).toEqual(detailedCandidates);
    expect(composed).toEqual(reactionPlans.map((p) => p.id));
  });
  it('uses the LLM subservice and preserves correlated curves through analysis and review', async () => {
    const llm = new LlmService({ getConfigSnapshot: () => null });
    const request = vi.spyOn(llm, 'requestStructured').mockImplementation(passing);
    expect(await llm.actionCatalog.generate(actionSources)).toEqual([headAction]);
    expect(request).toHaveBeenCalledTimes(3);
    const input = JSON.parse(request.mock.calls[0][1]);
    expect(input.sources.windows[0].curves).toHaveLength(2);
    expect(input.sources.windows[0].curves[0].samples).toEqual([[0, -20], [1000, 20]]);
    expect(JSON.parse(request.mock.calls[2][1]).evidence.windows[0].curves).toHaveLength(2);
    expect(request.mock.calls[0][0]).toContain('完整对话反应');
    llm.dispose();
  });

  it('repairs structural errors with validation feedback and never accepts unknown parameters', async () => {
    const request = vi.fn().mockResolvedValueOnce(JSON.stringify({ actions: [{ id: 'head', label: '头', category: 'head' }] }))
      .mockImplementation(passing);
    expect(await new ActionCatalogService(request).generate(actionSources)).toEqual([headAction]);
    expect(JSON.parse(request.mock.calls[1][1]).validationError).toBeTruthy();
    request.mockReset().mockResolvedValue(JSON.stringify({ actions: [{ ...headAction,
      tracks: [{ parameterId: 'NotInModel', keyframes: [{ timeMs: 0, value: 1 }] }] }] }));
    await expect(new ActionCatalogService(request).generate(actionSources)).rejects.toThrow('NotInModel');
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('repairs only the flagged action and reviews it again, preserving unrelated trajectories', async () => {
    const second = { ...headAction, id: 'second', label: '另一个反应' };
    const revised = { ...headAction, description: '肯定时转头并停留' };
    const request = vi.fn().mockResolvedValueOnce(JSON.stringify({ actions: [headAction, second] }))
      .mockResolvedValueOnce(JSON.stringify({ actions: [headAction, second] }))
      .mockResolvedValueOnce('{"issues":[{"actionId":"head","message":"补充使用场景"}]}')
      .mockResolvedValueOnce(JSON.stringify({ actions: [revised] }))
      .mockResolvedValueOnce('{"issues":[]}');
    expect(await new ActionCatalogService(request).generate(actionSources)).toEqual([revised, second]);
    expect(JSON.parse(request.mock.calls[3][1]).actions.map((a: { id: string }) => a.id)).toEqual(['head']);
    const followup = JSON.parse(request.mock.calls[4][1]);
    expect(followup.actions.map((a: { id: string }) => a.id)).toEqual(['head']);
    expect(followup.previousIssues).toEqual([expect.objectContaining({ actionId: 'head', message: '补充使用场景' })]);
    expect(request.mock.calls[4][0]).toContain('首末帧不必为0');
    expect(request).toHaveBeenCalledTimes(5);
  });

  it('caps repair cycles and rejects a reviewer that names an unknown action', async () => {
    const request = vi.fn().mockImplementation((prompt: string) => Promise.resolve(prompt.includes('当前任务是审查')
      ? '{"issues":[{"actionId":"head","message":"主姿态需要改善"}]}' : reply));
    const onReviewReport = vi.fn();
    expect(await new ActionCatalogService(request).generate(actionSources, undefined, undefined, { onReviewReport })).toEqual([headAction]);
    const report = onReviewReport.mock.calls[0][0];
    expect(report.status).toBe('needs-preview');
    expect(report.rounds).toBe(1);
    expect(report.stopReason).toBe('no-progress');
    expect(report.revisionSummary).toContain('最佳版本');
    expect(report.task?.bestVersionId).toBeTruthy();
    expect(report.task?.noProgressCount).toBe(1);
    expect(report.issues).toEqual([
      expect.objectContaining({ actionId: 'head', message: '主姿态需要改善', issueId: expect.any(String) }),
    ]);
    expect(request).toHaveBeenCalledTimes(5);
    request.mockImplementation((prompt: string) => Promise.resolve(prompt.includes('当前任务是审查')
      ? '{"issues":[{"actionId":"missing","message":"改"}]}' : reply));
    await expect(new ActionCatalogService(request).generate(actionSources)).rejects.toThrow('引用无效');
  });

  it('uses a persisted task budget instead of a fixed repair-round limit', async () => {
    const request = vi.fn().mockResolvedValue(reply);
    let checkpoint: GenerationCheckpoint | undefined;
    await expect(new ActionCatalogService(request).generate(actionSources, undefined, undefined, {
      budget: { maxCalls: 1 }, onCheckpoint: (value) => { checkpoint = value; },
    })).rejects.toThrow('调用预算');
    expect(request).toHaveBeenCalledTimes(1);
    expect(checkpoint?.task?.calls).toBe(1);
    expect(checkpoint?.task?.currentVersionId).toBe('v0');
  });

  it('checkpoints repaired trajectories before the next review and resumes from that draft', async () => {
    const revised = { ...headAction, returnMs: 800 };
    let checkpoint: GenerationCheckpoint | undefined;
    const request = vi.fn().mockResolvedValueOnce(reply).mockResolvedValueOnce(reply)
      .mockResolvedValueOnce('{"issues":[{"actionId":"head","message":"回退建议更舒缓"}]}')
      .mockResolvedValueOnce(JSON.stringify({ actions: [revised] }))
      .mockRejectedValueOnce(new Error('review connection lost'));
    const service = new ActionCatalogService(request);
    await expect(service.generate(actionSources, undefined, undefined,
      { onCheckpoint: (value) => { checkpoint = structuredClone(value); } })).rejects.toThrow('review connection lost');
    expect(checkpoint?.composition?.draft).toEqual([revised]);
    request.mockReset().mockResolvedValue('{"issues":[]}');
    expect(await service.generate(actionSources, undefined, undefined, { checkpoint })).toEqual([revised]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(request.mock.calls[0][1]).actions).toEqual([revised]);
  });

  it('preserves old definitions when only answering and provides related body curves for edits', async () => {
    const request = vi.fn().mockResolvedValue('{"message":"可以增加头身配合"}');
    const result = await new ActionCatalogService(request).refine({ sources: actionSources, actions: [headAction],
      referencedIds: ['head'], instruction: '@head 增加脸红', history: [] });
    expect(result.actions).toBeUndefined();
    expect(JSON.parse(request.mock.calls[0][1]).evidence.windows[0].curves.map((c: { parameterId: string }) => c.parameterId))
      .toEqual(['ParamAngleX', 'ParamCheek']);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('analyzes all batches, checkpoints completed work, and rejects late results after cancellation', async () => {
    const sources = { ...actionSources, motions: Array.from({ length: 220 }, (_, index) => ({ ...actionSources.motions[0], index })) };
    const contexts = sourceContexts(sources);
    expect(contexts.length).toBeGreaterThan(1);
    const request = vi.fn().mockImplementation(passing);
    const progress = vi.fn();
    let checkpoint: GenerationCheckpoint | undefined;
    const controller = new AbortController();
    await expect(new ActionCatalogService(request).generate(sources, controller.signal, (p) => {
      if (p.stage === 'analyzing' && p.completed === 1) controller.abort();
    }, { onCheckpoint: (c) => { checkpoint = c; } })).rejects.toThrow('取消');
    expect(request).toHaveBeenCalledTimes(1);
    request.mockClear();
    expect(await new ActionCatalogService(request).generate(sources, undefined, progress, { checkpoint })).toEqual([headAction]);
    const analyzed = request.mock.calls.filter(([p]) => p.includes('分析当前联合窗口'));
    expect(analyzed).toHaveLength(contexts.length - 1);
    const allWindows = [...contexts[0].windows, ...analyzed.flatMap(([, data]) => JSON.parse(data).sources.windows)];
    expect(allWindows).toHaveLength(220);
    expect(allWindows.at(-1).index).toBe(219);
    const aborted = new AbortController();
    request.mockReset().mockImplementation(async () => { aborted.abort(); return reply; });
    await expect(new ActionCatalogService(request).generate(actionSources, aborted.signal)).rejects.toThrow('取消');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('rejects protected parameter values even when the reviewer approves', async () => {
    const request = vi.fn().mockImplementation(passing);
    await expect(new ActionCatalogService(request).generate(actionSources, undefined, undefined,
      { constraints: { parameterMax: { ParamAngleX: 10 } } })).rejects.toThrow('裁平');
  });

  it('does not retry network errors or accept an unstructured review as approval', async () => {
    const request = vi.fn().mockRejectedValue(new Error('network failed'));
    await expect(new ActionCatalogService(request).generate(actionSources)).rejects.toThrow('network failed');
    expect(request).toHaveBeenCalledTimes(1);
    request.mockReset().mockResolvedValue(reply);
    await expect(new ActionCatalogService(request).generate(actionSources)).rejects.toThrow('审查结果无效');
  });

  it('repairs malformed JSON and refuses repairs that replace another action ID', async () => {
    const request = vi.fn().mockResolvedValueOnce('{"actions":[').mockImplementation(passing);
    expect(await new ActionCatalogService(request).generate(actionSources)).toEqual([headAction]);
    expect(JSON.parse(request.mock.calls[1][1]).previous).toBe('{"actions":[');
    request.mockReset().mockResolvedValueOnce(reply).mockResolvedValueOnce(reply)
      .mockResolvedValueOnce('{"issues":[{"actionId":"head","message":"改善衔接"}]}')
      .mockResolvedValueOnce(JSON.stringify({ actions: [{ ...headAction, id: 'other' }] }));
    await expect(new ActionCatalogService(request).generate(actionSources)).rejects.toThrow('未授权的动作范围');
  });
});

describe('correlated evidence and checks', () => {
  it('keeps all tracks together across overlapping windows and preserves the original clock', () => {
    const sources = { ...actionSources, motions: [{ ...actionSources.motions[0], durationMs: 6000,
      curves: actionSources.motions[0].curves.map((c) => ({ ...c, samples: [[0, 0], [6000, 1]] as Array<[number, number]> })) }] };
    const windows = sourceContexts(sources).flatMap((c) => c.windows);
    expect(windows.map((w) => [w.startMs, w.endMs])).toEqual([[0, 3000], [2600, 5600], [5200, 6000]]);
    expect(windows.every((w) => w.curves.length === 2)).toBe(true);
    expect(windows[1].curves[0].samples[0]).toEqual([2600, 2600 / 6000]);
    expect(sourceContexts(actionSources, 800).every((c) => JSON.stringify(c).length <= 800)).toBe(true);
  });

  it('flags duplicate tracks and late movement as warnings, without pretending to measure visual quality', () => {
    const late = { ...headAction, enterMs: 0, durationMs: 1000,
      tracks: [{ parameterId: 'ParamAngleX', keyframes: [{ timeMs: 0, value: 0 }, { timeMs: 800, value: 0 }, { timeMs: 900, value: 20 }] }] };
    const issues = inspectActions([late, { ...late, id: 'copy' }], actionSources);
    expect(issues.map((i) => i.code)).toContain('late-pose');
    expect(issues.map((i) => i.code)).toContain('duplicate-motion');
    expect(issues.every((i) => i.severity === 'warning')).toBe(true);
    const continuous = { ...late, tracks: [{ parameterId: 'ParamAngleX',
      keyframes: [{ timeMs: 0, value: 0 }, { timeMs: 900, value: 20 }] }] };
    expect(inspectActions([continuous], actionSources).some((i) => i.code === 'late-pose')).toBe(false);
  });
});
