import { afterEach, expect, it, vi } from 'vitest';
import { Live2dActionService } from '../service/Live2dActionService';
import { attachActionRuntime } from '../infrastructure/attachActionRuntime';
import { attachMouseFollowRuntime } from '../../model/runtime/live2d/attachMouseFollowRuntime';
import { headAction } from '../../../../../../test/fixtures/actionCatalog';

afterEach(() => vi.useRealTimers());

it('keeps mouse writes out of the SDK baseline and pauses them throughout preview and return', () => {
  vi.useFakeTimers();
  const ids = ['ParamAngleX', 'ParamEyeBallX'];
  const values = new Map(ids.map((id) => [id, 0]));
  const core = { getModel: () => ({ parameters: { ids } }), getParameterCount: () => ids.length,
    getParameterMinimumValue: () => -30, getParameterMaximumValue: () => 30, getParameterDefaultValue: () => 0,
    getParameterValueById: (id: string) => values.get(id) ?? 0,
    setParameterValueById: (id: string, value: number) => { values.set(id, value); } };
  const listeners = new Set<() => void>();
  const runtime = { on: (_event: string, handler: () => void) => listeners.add(handler),
    off: (_event: string, handler: () => void) => listeners.delete(handler) };
  const actions = new Live2dActionService();
  actions.setActionCatalog([headAction]);
  actions.attach(core);
  const applyMouse = vi.fn((weight: number) => {
    values.set('ParamAngleX', -20 * weight);
    values.set('ParamEyeBallX', -weight);
  });
  const offMouse = attachMouseFollowRuntime(runtime, () => actions.getMouseFollowWeight(), applyMouse);
  const offActions = attachActionRuntime(runtime, actions);
  // 与 Cubism 相同：保存本地基线 → beforeModelUpdate → 顶点更新 → 恢复基线。
  const render = () => {
    const baseline = new Map(values);
    listeners.forEach((listener) => listener());
    const visible = Object.fromEntries(values);
    baseline.forEach((value, id) => values.set(id, value));
    return visible;
  };
  expect(render()).toEqual({ ParamAngleX: -20, ParamEyeBallX: -1 });
  expect(values.get('ParamAngleX')).toBe(0);
  actions.dispatch({ actionId: 'head' });
  applyMouse.mockClear();
  vi.advanceTimersByTime(600);
  expect(render()).toEqual({ ParamAngleX: 20, ParamEyeBallX: 0 });
  vi.advanceTimersByTime(600);
  render();
  expect(applyMouse).not.toHaveBeenCalled();
  vi.advanceTimersByTime(150);
  expect(render()).toEqual({ ParamAngleX: 0, ParamEyeBallX: 0 });
  vi.advanceTimersByTime(150);
  expect(render()).toEqual({ ParamAngleX: -10, ParamEyeBallX: -0.5 });
  offMouse(); offActions();
  expect(listeners.size).toBe(0);
  actions.dispose();
});
