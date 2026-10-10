import { describe, expect, it } from 'vitest';
import { normalizeAsrConfig } from '../domain/config';

describe('ASR endpoint configuration', () => {
  it('migrates the old default pair but preserves custom values and updated presets', () => {
    const legacy = { rule1MinTrailingSilence: 2.4, rule2MinTrailingSilence: 1.2 };
    expect(normalizeAsrConfig(legacy)).toMatchObject({ endpointPresetVersion: 1, rule1MinTrailingSilence: 1.2, rule2MinTrailingSilence: 0.7 });
    expect(normalizeAsrConfig({ ...legacy, endpointPresetVersion: 1 })).toMatchObject(legacy);
    const custom = { rule1MinTrailingSilence: 1.4, rule2MinTrailingSilence: 0.8 };
    expect(normalizeAsrConfig(custom)).toMatchObject(custom);
  });
});
