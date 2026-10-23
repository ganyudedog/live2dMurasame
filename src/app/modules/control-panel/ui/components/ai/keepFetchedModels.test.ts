import { describe, expect, it } from 'vitest';
import { keepFetchedModels } from './keepFetchedModels';

const model = (id: string, efforts: string[] = []): PetLlmModel => ({
  id,
  efforts,
  effortsSource: efforts.length ? 'probe' : 'none',
  probedAt: efforts.length ? 1 : 0,
});

describe('reconciling the model list with a fresh fetch', () => {
  it('drops models the endpoint no longer returns', () => {
    const { kept, dropped } = keepFetchedModels(
      [model('a', ['low', 'high']), model('b'), model('gone')],
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    );
    expect(kept.map((item) => item.id)).toEqual(['a', 'b']);
    expect(dropped).toEqual(['gone']);
  });

  it('keeps the persisted efforts of surviving models', () => {
    const { kept } = keepFetchedModels([model('a', ['low', 'high'])], [{ id: 'a' }]);
    expect(kept[0].efforts).toEqual(['low', 'high']);
  });

  it('reports nothing dropped when the endpoint still returns everything', () => {
    const { kept, dropped } = keepFetchedModels([model('a'), model('b')], [{ id: 'b' }, { id: 'a' }]);
    expect(kept).toHaveLength(2);
    expect(dropped).toEqual([]);
  });

  it('drops everything when nothing registered is returned', () => {
    const { kept, dropped } = keepFetchedModels([model('a'), model('b')], []);
    expect(kept).toEqual([]);
    expect(dropped).toEqual(['a', 'b']);
  });
});
