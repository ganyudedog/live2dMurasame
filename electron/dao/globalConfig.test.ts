import { describe, expect, it } from 'vitest';
import { normalizeModelConfig, normalizeGlobalModelConfig } from './globalConfig.js';
import { headAction } from '../../src/test/fixtures/actionCatalog';

describe('model action configuration persistence contract', () => {
  it('preserves parameter trajectories and removes obsolete aliases on disk load', () => {
    const config = normalizeModelConfig({ actions: [
      { ...headAction, legacyField: 'discard-me' },
      { ...headAction, label: 'duplicate' },
      { id: 'old', label: '旧别名', category: 'head', source: { group: 'Talk', index: 0 } },
    ] });
    expect(config.actions).toEqual([headAction]);
    expect(config.actions[0].tracks[0].keyframes[1].value).toBe(20);
  });

  it('retains an explicit empty table', () => {
    expect(normalizeModelConfig({ actions: [] }).actions).toEqual([]);
  });
});

describe('llm model registry persistence contract', () => {
  it('migrates the legacy single model field into the registry', () => {
    const config = normalizeGlobalModelConfig({ model: 'deepseek-chat' });
    expect(config.llmModels).toEqual([{ id: 'deepseek-chat', efforts: [], effortsSource: 'none', probedAt: 0 }]);
    expect(config).not.toHaveProperty('model');
    // 旧 model 只做迁移来源，不会自动变成记忆整理模型。
    expect(config.memoryModel).toBe('deepseek-chat');
  });

  it('keeps declared effort order, deduplicates, and keeps protocol-external tiers', () => {
    const config = normalizeGlobalModelConfig({
      llmModels: [{ id: ' reasoner ', efforts: ['high', 'low', 'high', 'ultra', 'max'], effortsSource: 'probe',
        probedAt: 1712345678.9 }],
    });
    // 顺序 = 接口给出的顺序（第一项是默认档），值域开放：ultra/max 不能被裁掉。
    expect(config.llmModels).toEqual([
      { id: 'reasoner', efforts: ['high', 'low', 'ultra', 'max'], effortsSource: 'probe', probedAt: 1712345678 },
    ]);
  });

  it('drops effort values that are not identifier-shaped', () => {
    const config = normalizeGlobalModelConfig({
      llmModels: [{ id: 'a', efforts: ['low', '', '__probe_effort__', 'a'.repeat(40), 42, null, 'high'] }],
    });
    expect(config.llmModels[0].efforts).toEqual(['low', 'high']);
  });

  it('drops duplicate and empty model identifiers', () => {
    const config = normalizeGlobalModelConfig({
      llmModels: [{ id: 'a' }, { id: ' a ' }, { id: '   ' }, { id: 'b' }],
    });
    expect(config.llmModels.map((model) => model.id)).toEqual(['a', 'b']);
  });

  it('never keeps a memory model that is not registered', () => {
    const config = normalizeGlobalModelConfig({ llmModels: [{ id: 'a' }], memoryModel: 'ghost', memoryReasoningEffort: 'high' });
    expect(config.memoryModel).toBe('');
    expect(config.memoryReasoningEffort).toBe('');
  });

  it('falls back to the first supported effort of the memory model instead of an interface default', () => {
    const config = normalizeGlobalModelConfig({
      llmModels: [{ id: 'a', efforts: ['low', 'high'], effortsSource: 'probe', probedAt: 1 }],
      memoryModel: 'a',
      memoryReasoningEffort: 'medium',
    });
    expect(config.memoryReasoningEffort).toBe('low');
  });

  it('drops the removed action reasoning field', () => {
    const config = normalizeGlobalModelConfig({ actionReasoningEffort: 'high' });
    expect(config).not.toHaveProperty('actionReasoningEffort');
  });
});
