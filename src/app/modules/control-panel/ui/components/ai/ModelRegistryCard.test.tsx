import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ModelRegistryCard } from './ModelRegistryCard';

const model = (id: string): PetLlmModel => ({ id, efforts: [], effortsSource: 'none', probedAt: 0 });
const remote = (id: string) => ({ id, ownedBy: '', created: 0, efforts: [], declaresReasoning: false });

const render = (models: PetLlmModel[]) => renderToStaticMarkup(<ModelRegistryCard
  models={models}
  available={[remote('a-1'), remote('b-2'), remote('c-3')]}
  canFetch
  fetching={false}
  onFetch={vi.fn()}
  onToggle={vi.fn()}
  onProbe={vi.fn()} />);

const inOrder = (markup: string) => {
  const [first, second, third] = ['a-1', 'b-2', 'c-3'].map((id) => markup.indexOf(id));
  return first < second && second < third;
};

describe('model list ordering', () => {
  it('follows the endpoint order regardless of which models are enabled', () => {
    expect(inOrder(render([]))).toBe(true);
    expect(inOrder(render([model('b-2')]))).toBe(true);
    expect(inOrder(render([model('c-3'), model('a-1')]))).toBe(true);
  });

  it('does not float an enabled model to the top', () => {
    const markup = render([model('c-3')]);
    expect(markup.indexOf('c-3')).toBeGreaterThan(markup.indexOf('a-1'));
    expect(markup.indexOf('c-3')).toBeGreaterThan(markup.indexOf('b-2'));
  });
});
