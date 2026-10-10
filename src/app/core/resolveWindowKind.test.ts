import { describe, expect, it } from 'vitest';
import { resolveWindowKind } from './resolveWindowKind';

describe('renderer window selection', () => {
  it('selects the control panel', () => {
    expect(resolveWindowKind('?window=control-panel')).toBe('control-panel');
  });

  it.each(['', '?window=pet', '?window=demo', '?window=test', '?window=unknown', '?ttsAudioArtifacts=1'])(
    'falls back to the pet window for %s', (search) => {
      expect(resolveWindowKind(search)).toBe('pet');
    },
  );
});
