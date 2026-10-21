import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadLlmSelection, saveLlmSelection } from './llmSelectionCache';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('window', { localStorage: { getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) } });
});
afterEach(() => vi.unstubAllGlobals());

const model = (id: string, efforts: PetReasoningEffort[] = []): PetLlmModel =>
  ({ id, efforts, effortsSource: efforts.length ? 'probe' : 'error', probedAt: 1 });

const models = [model('gpt-a', ['low', 'medium']), model('gpt-b', [])];

describe('frontend-owned chat and action model/depth selection', () => {
  it('seeds the first registered model once and then keeps the user choice', () => {
    // 首次没有缓存：落到列表第一项，并把深度落到该模型的第一档。
    expect(loadLlmSelection(models, 'chat')).toEqual({ model: 'gpt-a', effort: 'low' });
    expect(saveLlmSelection(models, 'chat', { effort: 'medium' })).toEqual({ model: 'gpt-a', effort: 'medium' });
    // 用户选择优先于列表顺序。
    expect(loadLlmSelection(models, 'chat')).toEqual({ model: 'gpt-a', effort: 'medium' });
    expect(saveLlmSelection(models, 'chat', { model: 'gpt-b' })).toEqual({ model: 'gpt-b', effort: '' });
  });

  it('keeps chat and action selections independent', () => {
    saveLlmSelection(models, 'chat', { model: 'gpt-a', effort: 'medium' });
    saveLlmSelection(models, 'action', { model: 'gpt-b' });
    expect(loadLlmSelection(models, 'chat')).toEqual({ model: 'gpt-a', effort: 'medium' });
    // 动作表选了没有档位的模型，对话不受影响。
    expect(loadLlmSelection(models, 'action')).toEqual({ model: 'gpt-b', effort: '' });
    saveLlmSelection(models, 'action', { model: 'gpt-a', effort: 'low' });
    expect(loadLlmSelection(models, 'chat')).toEqual({ model: 'gpt-a', effort: 'medium' });
    expect(loadLlmSelection(models, 'action')).toEqual({ model: 'gpt-a', effort: 'low' });
  });

  it('migrates the flat v1 chat cache without touching the action scope', () => {
    store.set('pet:llm:selection', JSON.stringify({ chatModel: 'gpt-b', chatEffort: 'low' }));
    expect(loadLlmSelection(models, 'chat')).toEqual({ model: 'gpt-b', effort: '' });
    // 动作表没有历史值，就地补成第一项而不是空着。
    expect(loadLlmSelection(models, 'action')).toEqual({ model: 'gpt-a', effort: 'low' });
  });

  it('drops a cached choice that no longer exists in the registry', () => {
    saveLlmSelection(models, 'chat', { model: 'gpt-b' });
    saveLlmSelection(models, 'action', { model: 'gpt-b' });
    const shrunk = [model('gpt-c', ['high'])];
    expect(loadLlmSelection(shrunk, 'chat')).toEqual({ model: 'gpt-c', effort: 'high' });
    expect(loadLlmSelection(shrunk, 'action')).toEqual({ model: 'gpt-c', effort: 'high' });
    // 注册表为空时不伪造一个模型。
    expect(loadLlmSelection([], 'chat')).toEqual({ model: '', effort: '' });
    expect(loadLlmSelection([], 'action')).toEqual({ model: '', effort: '' });
  });

  it('never keeps a depth the model does not declare', () => {
    saveLlmSelection(models, 'chat', { model: 'gpt-a', effort: 'high' });
    // high 不在 gpt-a 的档位里，收敛到第一档而不是原样发送。
    expect(loadLlmSelection(models, 'chat').effort).toBe('low');
    // 没有档位的模型不发送该参数。
    expect(saveLlmSelection(models, 'chat', { model: 'gpt-b', effort: 'low' }))
      .toEqual({ model: 'gpt-b', effort: '' });
  });

  it('tolerates unreadable cache values', () => {
    store.set('pet:llm:selection', '{not json');
    expect(loadLlmSelection(models, 'chat')).toEqual({ model: 'gpt-a', effort: 'low' });
    store.set('pet:llm:selection', 'null');
    expect(loadLlmSelection(models, 'chat')).toEqual({ model: 'gpt-a', effort: 'low' });
  });
});
