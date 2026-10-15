import { describe, expect, it } from 'vitest';
import { normalizeModelConfig } from './globalConfig.js';
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
