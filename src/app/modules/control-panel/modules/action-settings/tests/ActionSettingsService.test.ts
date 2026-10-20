import { observable, runInAction } from 'mobx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@app/shared/config/ConfigService';
import type { ActionDefinition } from '@app/modules/live2d/modules/actions/domain/types';
import type { LlmService } from '@app/modules/ai/modules/llm/service/LlmService';
import { ActionCatalogService } from '@app/modules/ai/modules/llm/service/ActionCatalogService';
import { headAction as head, shyAction as shy, actionSources as sources } from '../../../../../../test/fixtures/actionCatalog';
import { ActionSettingsService } from '../service/ActionSettingsService';
import { actionMention, activeMention, referencedActionIds, replaceMentionsWithIds } from '../domain/session';
import { clearGenerationCheckpoint } from '../infrastructure/generationCache';

const services: ActionSettingsService[] = [];

async function setup() {
  const requestStructured = vi.fn<(...args: Parameters<LlmService['requestStructured']>) => Promise<string>>();
  requestStructured.mockImplementation(async (prompt) => {
    if (prompt.includes('当前任务是审查')) return '{"issues":[]}';
    throw new Error('unexpected LLM request');
  });
  const saveActionCatalog = vi.fn(async (_path: string, actions: ActionDefinition[]) => actions);
  const getActionSources = vi.fn(async () => sources);
  const previewAction = vi.fn(async () => {});
  const config = observable({ activeModelPath: 'model-a', modelConfig: { actions: [head] }, saveActionCatalog, getActionSources, previewAction });
  const service = new ActionSettingsService(new ActionCatalogService(requestStructured), config as unknown as ConfigService);
  services.push(service);
  service.start();
  await service.load();
  return { service, config, requestStructured, saveActionCatalog, getActionSources, previewAction };
}

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: { getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) },
  });
  clearGenerationCheckpoint('model-a');
  clearGenerationCheckpoint('model-b');
  clearGenerationCheckpoint('model-a', 'refine');
  clearGenerationCheckpoint('model-b', 'refine');
});
afterEach(() => { services.splice(0).forEach((service) => service.dispose()); vi.unstubAllGlobals(); });

describe('ActionSettingsService workspace', () => {
  it('saves executable reactions with remaining advice and restores that advice after reopening', async () => {
    const { service, config, requestStructured, saveActionCatalog } = await setup();
    requestStructured.mockImplementation(async (prompt) => prompt.includes('当前任务是审查')
      ? '{"issues":[{"actionId":"shy","message":"建议预览身体与脸红的衔接"}]}' : JSON.stringify({ actions: [shy] }));
    await service.generate();
    expect(service.error).toBeNull();
    expect(saveActionCatalog).toHaveBeenCalledWith('model-a', [shy]);
    expect(service.messages.at(-1)).toMatchObject({ status: 'done',
      reviewNotes: [{ actionId: 'shy', message: '建议预览身体与脸红的衔接' }] });
    expect(service.messages.at(-1)?.text).toContain('待预览');
    expect(structuredClone(service.view).messages.at(-1)?.reviewNotes).toEqual(service.messages.at(-1)?.reviewNotes);
    runInAction(() => { config.modelConfig = { actions: [shy] }; });
    service.dispose();
    const reopened = new ActionSettingsService(new ActionCatalogService(requestStructured), config as unknown as ConfigService);
    services.push(reopened);
    expect(reopened.messages.at(-1)?.reviewNotes).toEqual(service.messages.at(-1)?.reviewNotes);
    expect(reopened.messages.at(-1)?.task?.issues).toEqual(service.messages.at(-1)?.task?.issues);
    expect(reopened.messages.at(-1)?.task?.plan.length).toBeGreaterThan(0);
    requestStructured.mockResolvedValueOnce('{"message":"先预览再决定"}');
    await reopened.refine('刚才的建议是什么意思？');
    expect(JSON.parse(requestStructured.mock.calls.at(-1)![1]).history.at(-1).text).toContain('建议预览身体与脸红的衔接');
  });

  it('keeps hard protection violations from reaching persistence', async () => {
    const { service, requestStructured, saveActionCatalog, getActionSources } = await setup();
    const blocked = { ...sources, parameters: [...sources.parameters,
      { id: 'ParamAngleY', observedMin: -40, observedMax: 40 }] };
    const invalid = { ...head, tracks: [{ parameterId: 'ParamAngleY', keyframes: [{ timeMs: 0, value: 30 }] }] };
    getActionSources.mockResolvedValue(blocked);
    requestStructured.mockImplementation(async (prompt) => prompt.includes('当前任务是审查')
      ? '{"issues":[]}' : JSON.stringify({ actions: [invalid] }));
    await service.generate();
    expect(service.error).toContain('执行约束仍未满足');
    expect(saveActionCatalog).not.toHaveBeenCalled();
    expect(service.actions).toEqual([head]);
  });

  it('cancels a pending generation, preserves completed analysis and prevents late saves', async () => {
    const { service, requestStructured, saveActionCatalog } = await setup();
    let finish!: (text: string) => void;
    let entered!: () => void;
    const composing = new Promise<void>((resolve) => { entered = resolve; });
    requestStructured.mockResolvedValueOnce(JSON.stringify({ actions: [shy] }));
    requestStructured.mockImplementationOnce(() => { entered(); return new Promise((resolve) => { finish = resolve; }); });
    const task = service.generate();
    await composing;
    expect(service.messages.at(-1)?.text).toContain('编排');
    expect(service.view.canCancel).toBe(true);
    service.cancel();
    expect(service.busy).toBe(false);
    finish(JSON.stringify({ actions: [shy] }));
    await task;
    expect(saveActionCatalog).not.toHaveBeenCalled();
    expect(service.actions).toEqual([head]);
    requestStructured.mockClear();
    requestStructured.mockResolvedValueOnce(JSON.stringify({ actions: [shy] }));
    await service.generate();
    expect(requestStructured.mock.calls[0][0]).toContain('彻底重建');
    expect(saveActionCatalog).toHaveBeenCalledTimes(1);
    // 成功后删除检查点，下一次明确重建会重新分析。
    requestStructured.mockClear();
    requestStructured.mockResolvedValueOnce(JSON.stringify({ actions: [head] })).mockResolvedValueOnce(JSON.stringify({ actions: [head] }));
    await service.generate();
    expect(requestStructured.mock.calls[0][0]).toContain('分析当前联合窗口');
  });

  it('keeps the table on failed review and disables cancellation once persistence starts', async () => {
    const { service, requestStructured, saveActionCatalog } = await setup();
    requestStructured.mockResolvedValueOnce(JSON.stringify({ actions: [shy] }))
      .mockResolvedValueOnce(JSON.stringify({ actions: [shy] })).mockResolvedValueOnce('{"message":"looks good"}');
    await service.generate();
    expect(service.error).toContain('审查结果无效');
    expect(saveActionCatalog).not.toHaveBeenCalled();
    expect(service.actions).toEqual([head]);
    let complete!: (actions: ActionDefinition[]) => void;
    let entered!: () => void;
    const saving = new Promise<void>((resolve) => { entered = resolve; });
    saveActionCatalog.mockImplementationOnce(() => { entered(); return new Promise((resolve) => { complete = resolve; }); });
    requestStructured.mockResolvedValueOnce('{"issues":[]}');
    const task = service.generate();
    await saving;
    expect(service.canCancel).toBe(false);
    service.cancel();
    expect(service.busy).toBe(true);
    complete([shy]);
    await task;
    expect(service.actions).toEqual([shy]);
    expect(service.busy).toBe(false);
  });

  it('edits metadata without calling LLM, preserves trajectories and allows clearing the description', async () => {
    const { service, requestStructured, saveActionCatalog } = await setup();
    expect(await service.updateMetadata('head', ' 侧头倾听 ', ' 表示认真听对方说话 ')).toBe(true);
    expect(saveActionCatalog).toHaveBeenLastCalledWith('model-a', [{ ...head, label: '侧头倾听', description: '表示认真听对方说话' }]);
    expect(service.actions[0].tracks).toEqual(head.tracks);
    expect(requestStructured).not.toHaveBeenCalled();
    expect(await service.updateMetadata('head', '侧头倾听', '')).toBe(true);
    expect(service.view.actions[0]).not.toHaveProperty('description');
    expect(await service.updateMetadata('head', ' ', '无效')).toBe(false);
    expect(saveActionCatalog).toHaveBeenCalledTimes(2);
  });

  it('keeps saved metadata after an error and ignores late save results after switching models', async () => {
    const { service, config, saveActionCatalog } = await setup();
    saveActionCatalog.mockRejectedValueOnce(new Error('磁盘不可写'));
    expect(await service.updateMetadata('head', '新名称', '新描述')).toBe(false);
    expect(service.actions).toEqual([head]);
    expect(service.error).toBe('磁盘不可写');
    let complete!: (actions: ActionDefinition[]) => void;
    saveActionCatalog.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const pending = service.updateMetadata('head', '新名称', '新描述');
    runInAction(() => { config.activeModelPath = 'model-b'; config.modelConfig = { actions: [shy] }; });
    complete([{ ...head, label: '新名称' }]);
    expect(await pending).toBe(false);
    expect(service.actions).toEqual([shy]);
  });
  it('regenerates from native sources without old rules, replaces the table and resets chat context', async () => {
    const { service, requestStructured, saveActionCatalog } = await setup();
    requestStructured.mockResolvedValueOnce('{"message":"旧规则：只要转头"}');
    await service.refine('旧规则：只要转头');
    requestStructured.mockResolvedValueOnce(JSON.stringify({ actions: [shy] })).mockResolvedValueOnce(JSON.stringify({ actions: [shy] }));
    await service.generate();
    expect(requestStructured.mock.calls[1][1]).not.toContain('旧规则');
    expect(requestStructured.mock.calls[1][1]).not.toContain('currentActions');
    expect(saveActionCatalog).toHaveBeenLastCalledWith('model-a', [shy]);
    expect(service.actions).toEqual([shy]);
    expect(service.messages).toHaveLength(3);
    expect(service.messages.at(-1)?.text).toContain('旧动作表已替换');
    requestStructured.mockResolvedValueOnce('{"message":"新的上下文"}');
    await service.refine('怎么调整？');
    expect(requestStructured.mock.calls.at(-1)![1]).not.toContain('旧规则');
  });

  it('sends exact mentioned definitions, native sources for adding actions and separate chat history', async () => {
    const { service, requestStructured } = await setup();
    requestStructured.mockResolvedValueOnce('{"message":"可以新增害羞动作"}');
    await service.refine('可以增加什么？');
    requestStructured.mockResolvedValueOnce(JSON.stringify({ message: '已新增害羞动作', actions: [head, shy] }));
    service.setDraft('@action:head 保留，新增一个害羞动作');
    await service.submit();
    const context = JSON.parse(requestStructured.mock.calls[1][1]);
    expect(context.referencedIds).toEqual([head.id]);
    expect(context.actions).toEqual([head]);
    expect(context.parameters).toEqual(sources.parameters);
    expect(context.evidence.windows[0].curves[0].samples).toEqual([[0, -20], [1000, 20]]);
    expect(context.history).toEqual([{ role: 'user', text: '可以增加什么？' }, { role: 'assistant', text: '可以新增害羞动作' }]);
    expect(service.actions).toEqual([head, shy]);
    expect(service.messages.at(-1)?.text).toContain('已新增害羞动作');
    expect(service.messages.at(-1)?.status).toBe('done');
  });

  it('allows removing the last action through conversation and through the delete button', async () => {
    const { service, requestStructured, saveActionCatalog } = await setup();
    await service.deleteAction('head');
    expect(service.actions).toEqual([]);
    expect(saveActionCatalog).toHaveBeenCalledWith('model-a', []);
    requestStructured.mockResolvedValueOnce(JSON.stringify({ actions: [head] }));
    await service.refine('新增一个转头动作');
    requestStructured.mockResolvedValueOnce('{"message":"已删除全部动作","actions":[]}');
    await service.refine('删除全部动作');
    expect(service.actions).toEqual([]);
    expect(service.error).toBeNull();
  });

  it('keeps the old table and restores the draft on invalid or duplicate parameter definitions', async () => {
    const { service, requestStructured, saveActionCatalog } = await setup();
    requestStructured.mockResolvedValueOnce(JSON.stringify({ actions: [head, { ...shy, tracks: [{ parameterId: 'Missing', keyframes: [{ timeMs: 0, value: 1 }] }] }] }));
    await service.refine('增加害羞动作');
    expect(saveActionCatalog).not.toHaveBeenCalled();
    expect(service.actions).toEqual([head]);
    expect(service.draft).toBe('增加害羞动作');
    expect(service.messages.at(-1)?.status).toBe('error');
    requestStructured.mockResolvedValueOnce(JSON.stringify({ actions: [head, head] }));
    await service.refine('调整转头动作');
    expect(saveActionCatalog).not.toHaveBeenCalled();
    expect(service.busy).toBe(false);
  });

  it('reports missing mentions and save failures without losing the original table', async () => {
    const { service, requestStructured, saveActionCatalog } = await setup();
    await service.refine('@action:gone 改名');
    expect(requestStructured).not.toHaveBeenCalled();
    expect(service.error).toContain('引用的动作不存在');
    requestStructured.mockResolvedValueOnce(JSON.stringify({ actions: [shy] }));
    saveActionCatalog.mockRejectedValueOnce(new Error('保存失败'));
    await service.refine('新增害羞动作');
    expect(service.error).toBe('保存失败');
    expect(service.actions).toEqual([head]);
    expect(service.messages.at(-1)?.status).toBe('error');
  });

  it('does not rebuild from stale motion data when refreshing the native catalog fails', async () => {
    const { service, requestStructured, saveActionCatalog, getActionSources } = await setup();
    getActionSources.mockRejectedValueOnce(new Error('模型文件不可读'));
    await service.generate();
    expect(requestStructured).not.toHaveBeenCalled();
    expect(saveActionCatalog).not.toHaveBeenCalled();
    expect(service.actions).toEqual([head]);
    expect(service.error).toContain('模型文件不可读');
    expect(service.messages.at(-1)?.status).toBe('error');
    expect(service.busy).toBe(false);
  });

  it('restores cached chat and draft when reopened and keeps each model isolated', async () => {
    const { service, config, requestStructured } = await setup();
    requestStructured.mockResolvedValueOnce('{"message":"可以预览后调整"}');
    await service.refine('如何微调？');
    service.setDraft('@action:head 调整');
    service.dispose();
    const reopened = new ActionSettingsService(new ActionCatalogService(requestStructured),
      config as unknown as ConfigService);
    services.push(reopened);
    reopened.start();
    expect(reopened.draft).toBe('@action:head 调整');
    expect(reopened.messages.at(-1)?.text).toBe('可以预览后调整');
    runInAction(() => { config.activeModelPath = 'model-b'; config.modelConfig = { actions: [shy] }; });
    expect(reopened.draft).toBe('');
    expect(reopened.messages).toEqual([]);
    reopened.setDraft('模型 B 草稿');
    runInAction(() => { config.activeModelPath = 'model-a'; config.modelConfig = { actions: [head] }; });
    expect(reopened.draft).toBe('@action:head 调整');
    expect(reopened.messages.at(-1)?.text).toBe('可以预览后调整');
  });

  it('retries backend persistence without paying to regenerate an already reviewed refinement', async () => {
    const { service, requestStructured, saveActionCatalog } = await setup();
    const revised = { ...head, returnMs: 700 };
    requestStructured.mockResolvedValueOnce(JSON.stringify({ actions: [revised] }));
    saveActionCatalog.mockRejectedValueOnce(new Error('disk failed'));
    await service.refine('把回退调慢');
    expect(service.error).toBe('disk failed');
    const calls = requestStructured.mock.calls.length;
    await service.refine('把回退调慢');
    expect(service.error).toBeNull();
    expect(service.actions).toEqual([revised]);
    expect(requestStructured).toHaveBeenCalledTimes(calls);
    expect(saveActionCatalog).toHaveBeenCalledTimes(2);
  });

  it('aborts editing on model switch and discards late LLM replies', async () => {
    const { service, config, requestStructured, saveActionCatalog } = await setup();
    let resolveReply!: (value: string) => void;
    requestStructured.mockImplementationOnce(() => new Promise((resolve) => { resolveReply = resolve; }));
    const pending = service.refine('@head 调整');
    await vi.waitFor(() => expect(requestStructured).toHaveBeenCalledOnce());
    const signal = requestStructured.mock.calls[0][2];
    runInAction(() => { config.activeModelPath = 'model-b'; config.modelConfig = { actions: [shy] }; });
    expect(signal?.aborted).toBe(true);
    resolveReply(JSON.stringify({ actions: [head] }));
    await pending;
    expect(saveActionCatalog).not.toHaveBeenCalled();
    expect(service.actions).toEqual([shy]);
    expect(service.messages).toEqual([]);
    expect(service.busy).toBe(false);
    runInAction(() => { config.activeModelPath = 'model-a'; config.modelConfig = { actions: [head] }; });
    expect(service.messages.at(-1)?.status).toBe('error');
  });
});

describe('action mentions', () => {
  it('recognizes stable IDs next to Chinese text and deduplicates references', () => {
    expect(referencedActionIds('把@action:head改名，@shy 更明显，@action:head 保留')).toEqual(['head', 'shy']);
    expect(referencedActionIds('someone@example.com')).toEqual([]);
    expect(activeMention('调整 @action:sh', 13)).toEqual({ start: 3, query: 'sh' });
    expect(activeMention('@害羞', 3)).toEqual({ start: 0, query: '害羞' });
    expect(activeMention('把@害羞', 4)).toEqual({ start: 1, query: '害羞' });
  });

  it('inserts one name tag without the @ trigger and resolves it back to the stable ID', () => {
    const actions = [{ id: 'head', label: '转头' }, { id: 'shy', label: '害羞' }];
    expect(actionMention({ id: 'head', label: '转头' })).toBe('转头');
    // 标签里是名称，发送前按名称回填稳定 ID，再交给模型时还原成动作目录写法。
    expect(referencedActionIds('把转头幅度调大，害羞 更明显', actions)).toEqual(['head', 'shy']);
    expect(replaceMentionsWithIds('把转头幅度调大，害羞 更明显', actions))
      .toBe('把@action:head幅度调大，@action:shy 更明显');
    // 未知名称不会凭空生成引用，仍由服务层按 ID 校验。
    expect(referencedActionIds('不存在的动作', actions)).toEqual([]);
  });
});
