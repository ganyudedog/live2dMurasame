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


describe('explicit action reasoning settings', () => {
  it.each(['default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh'])('preserves %s through a disk round trip', (actionReasoningEffort) => {
    const saved = JSON.stringify(normalizeGlobalModelConfig({ model: 'my-model-alias', actionReasoningEffort }));
    expect(normalizeGlobalModelConfig(JSON.parse(saved))).toMatchObject({ model: 'my-model-alias', actionReasoningEffort });
  });

  it('loads existing configurations without inventing a model capability', () => {
    expect(normalizeGlobalModelConfig({ model: 'deepseek-v4-flash' }).actionReasoningEffort).toBe('default');
    expect(normalizeGlobalModelConfig({ actionReasoningEffort: 'unexpected' }).actionReasoningEffort).toBe('default');
  });
});
