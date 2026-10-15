import { observable, runInAction } from 'mobx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@app/shared/config/ConfigService';
import type { ActionDefinition } from '@app/modules/live2d/modules/actions/domain/types';
import type { LlmService } from '@app/modules/ai/modules/llm/service/LlmService';
import { ActionCatalogService } from '@app/modules/ai/modules/llm/service/ActionCatalogService';
import { headAction as head, shyAction as shy, actionSources as sources } from '../../../../../../test/fixtures/actionCatalog';
import { ActionSettingsService } from '../service/ActionSettingsService';
import { activeMention, referencedActionIds } from '../domain/session';

const services: ActionSettingsService[] = [];

async function setup() {
  const requestStructured = vi.fn<(...args: Parameters<LlmService['requestStructured']>) => Promise<string>>();
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
      setItem: (key: string, value: string) => store.set(key, value) },
  });
});
afterEach(() => { services.splice(0).forEach((service) => service.dispose()); vi.unstubAllGlobals(); });

describe('ActionSettingsService workspace', () => {
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
    requestStructured.mockResolvedValueOnce(JSON.stringify({ actions: [shy] }));
    await service.generate();
    expect(requestStructured.mock.calls[1][1]).not.toContain('旧规则');
    expect(requestStructured.mock.calls[1][1]).not.toContain('currentActions');
    expect(saveActionCatalog).toHaveBeenLastCalledWith('model-a', [shy]);
    expect(service.actions).toEqual([shy]);
    expect(service.messages).toHaveLength(3);
    expect(service.messages.at(-1)?.text).toContain('旧动作表已替换');
    requestStructured.mockResolvedValueOnce('{"message":"新的上下文"}');
    await service.refine('怎么调整？');
    expect(requestStructured.mock.calls[2][1]).not.toContain('旧规则');
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
    expect(context.evidence.curves[0].samples).toEqual([[0, -20], [1000, 20]]);
    expect(context.history).toEqual([{ role: 'user', text: '可以增加什么？' }, { role: 'assistant', text: '可以新增害羞动作' }]);
    expect(service.actions).toEqual([head, shy]);
    expect(service.messages.at(-1)).toMatchObject({ text: '已新增害羞动作', status: 'done' });
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

  it('aborts editing on model switch and discards late LLM replies', async () => {
    const { service, config, requestStructured, saveActionCatalog } = await setup();
    let resolveReply!: (value: string) => void;
    requestStructured.mockImplementationOnce(() => new Promise((resolve) => { resolveReply = resolve; }));
    const pending = service.refine('@head 调整');
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
});
