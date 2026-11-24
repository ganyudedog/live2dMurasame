import {afterEach, expect, it, vi} from 'vitest';

const bindings = vi.hoisted(() => ({ registerTicker: vi.fn(), from: vi.fn(async () => ({})) }));
vi.mock('pixi.js', () => ({ Ticker: class {} }));
vi.mock('./runtime', () => {
  if (!window.Live2DCubismCore) throw new Error('Cubism Core evaluated too early');
  return { Live2DModel: bindings };
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); vi.resetModules(); });

it('waits for one Core script before importing the runtime for concurrent models', async () => {
  vi.stubGlobal('window', {});
  const scripts: HTMLScriptElement[] = [];
  vi.stubGlobal('document', { createElement: () => ({}), head: { appendChild: (s: HTMLScriptElement) => scripts.push(s) } });
  const { loadModel } = await import('./loader');
  const models = [loadModel('file:///first'), loadModel('file:///second')];
  expect(scripts.map(s => s.src)).toEqual(['/live2dcubismcore.min.js']);
  expect(bindings.from).not.toHaveBeenCalled();
  window.Live2DCubismCore = {};
  scripts[0].onload!(new Event('load'));
  await Promise.all(models);
  expect(bindings.registerTicker).toHaveBeenCalledTimes(1);
  expect(bindings.from.mock.calls).toHaveLength(2);
});
