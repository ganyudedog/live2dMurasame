import { describe, expect, it, vi } from 'vitest';

const modelJson = {
  HitAreas: [
    { Name: 'Head', Id: 'HitAreaHead', Motion: 'TapHead' },
    { Name: 'Body', Id: 'HitAreaBody' },
  ],
  FileReferences: {
    Motions: {
      Idle: [{ File: 'motions/idle.motion3.json' }],
      TapHead: [
        { File: 'motions/tap-1.motion3.json', Text: 'hello' },
        { File: 'motions/tap-2.motion3.json', Sound: 'sounds/tap.wav' },
      ],
    },
  },
};

vi.mock('node:fs', () => ({
  default: {
    readdirSync: vi.fn(() => ['sample.model3.json']),
    readFileSync: vi.fn(() => JSON.stringify(modelJson)),
  },
}));
vi.mock('node:path', () => ({ default: { join: (...parts) => parts.join('/') } }));

const { parseModelInteractionCatalog } = await import('./ModelConfigParser.js');

describe('parseModelInteractionCatalog', () => {
  it('lists every concrete motion and derives HitArea defaults from Motion', () => {
    expect(parseModelInteractionCatalog('/model')).toEqual({
      hitAreas: [
        { name: 'Head', motions: [
          { group: 'TapHead', index: 0, weight: 100 },
          { group: 'TapHead', index: 1, weight: 100 },
        ] },
        { name: 'Body', motions: [] },
      ],
      motions: [
        { group: 'Idle', index: 0, file: 'motions/idle.motion3.json' },
        { group: 'TapHead', index: 0, file: 'motions/tap-1.motion3.json', text: 'hello' },
        { group: 'TapHead', index: 1, file: 'motions/tap-2.motion3.json', sound: 'sounds/tap.wav' },
      ],
    });
  });
});
