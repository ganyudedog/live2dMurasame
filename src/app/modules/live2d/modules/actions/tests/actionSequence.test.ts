import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Live2dActionService } from '../service/Live2dActionService';
import { parseActionIntent } from '../domain/schema';
import type { ActionDefinition } from '../domain/types';
import { LogService } from '@app/shared/logging/LogService';

const definition = (id: string, parameterId: string, value: number, enterMs: number,
  durationMs: number, returnMs: number): ActionDefinition => ({ id, label: id, category: 'other',
  enterMs, durationMs, returnMs, tracks: [{ parameterId, keyframes: [{ timeMs: 0, value }] }] });
const catalog = [
  definition('a', 'ParamAngleX', 10, 100, 200, 100),
  definition('b', 'ParamCheek', 0.8, 200, 600, 200),
  definition('c', 'ParamAngleY', -12, 100, 200, 100),
];
const services: Live2dActionService[] = [];
const setup = (log?: LogService) => {
  const ids = ['ParamAngleX', 'ParamCheek', 'ParamAngleY'];
  const values = new Map(ids.map((id) => [id, 0]));
  const core = { getModel: () => ({ parameters: { ids } }), getParameterCount: () => ids.length,
    getParameterMinimumValue: (index: number) => index === 1 ? 0 : -30,
    getParameterMaximumValue: (index: number) => index === 1 ? 1 : 30,
    getParameterDefaultValue: () => 0, getParameterValueById: (id: string) => values.get(id) ?? 0,
    setParameterValueById: (id: string, value: number) => { values.set(id, value); } };
  const service = new Live2dActionService(log);
  services.push(service);
  service.setActionCatalog(catalog); service.attach(core);
  const frame = (elapsed: number) => {
    vi.advanceTimersByTime(elapsed);
    ids.forEach((id) => values.set(id, 0));
    service.tick();
    return Object.fromEntries(values);
  };
  return { service, frame, core };
};
beforeEach(() => vi.useFakeTimers());
afterEach(() => { services.splice(0).forEach((service) => service.dispose()); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('sequential groups of parallel actions', () => {
  it('plays each parallel member with its own timing, waits through the longest return and then starts the next group', () => {
    const { service, frame } = setup();
    expect(service.dispatch({ action_id: [['a', 'b'], 'c'] })).toMatchObject({ ok: true });
    expect(frame(100)).toEqual({ ParamAngleX: 10, ParamCheek: 0.4, ParamAngleY: 0 });
    expect(frame(300)).toEqual({ ParamAngleX: 0, ParamCheek: 0.8, ParamAngleY: 0 });
    expect(frame(500)).toEqual({ ParamAngleX: 0, ParamCheek: 0.4, ParamAngleY: 0 });
    expect(service.getMouseFollowWeight()).toBe(0);
    expect(frame(100)).toEqual({ ParamAngleX: 0, ParamCheek: 0, ParamAngleY: 0 });
    expect(frame(50).ParamAngleY).toBe(-6);
    expect(frame(50).ParamAngleY).toBe(-12);
    expect(service.getMouseFollowWeight()).toBe(0);
    expect(frame(300)).toEqual({ ParamAngleX: 0, ParamCheek: 0, ParamAngleY: 0 });
    expect(service.getMouseFollowWeight()).toBe(0);
    vi.advanceTimersByTime(150);
    expect(service.getMouseFollowWeight()).toBe(0.5);
  });

  it('gives conflicting parameters to the later member and records the whole plan in one trace', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { service, frame } = setup(new LogService({ windowKind: 'pet', startedAt: 0, configSnapshot: null }));
    service.setActionCatalog([catalog[0], { ...catalog[1], tracks: [...catalog[1].tracks,
      { parameterId: 'ParamAngleX', keyframes: [{ timeMs: 0, value: -20 }] }] }, catalog[2]]);
    service.dispatch({ action_id: [['a', 'b'], 'c'] });
    expect(frame(100)).toEqual({ ParamAngleX: -10, ParamCheek: 0.4, ParamAngleY: 0 });
    frame(900); frame(400);
    const records = info.mock.calls.map(([, record]) => record).filter((record) => record.operation === 'action.execute');
    expect(records).toHaveLength(1);
    expect(records[0].data).toMatchObject({ actionId: [['a', 'b'], 'c'], groups: [['a', 'b'], ['c']], groupIndex: 1 });
    expect(records[0].timeline.find((event: { event: string }) => event.event === 'action.accepted').data.conflicts)
      .toEqual([{ groupIndex: 0, parameterId: 'ParamAngleX', previousActionId: 'a', actionId: 'b' }]);
    expect(records[0].timeline.filter((event: { event: string }) => event.event === 'action.groupStarted')
      .map((event: { data: { actionIds: string[] } }) => event.data.actionIds)).toEqual([['a', 'b'], ['c']]);
  });

  it.each(['interrupt', 'speech-finished', 'catalog-changed', 'model-changed', 'render-failed'])('cancels queued groups on %s', (reason) => {
    const { service, frame, core } = setup();
    const scheduler = service.sentenceActionScheduler;
    scheduler.begin('turn');
    scheduler.receive({ conversationId: 'turn', requestId: 's0', modelVersion: service.getCapability().modelVersion,
      hasSpeech: true, intent: { actionId: [['a', 'b'], 'c'] } });
    scheduler.playback('turn', 's0', 'started');
    expect(frame(200).ParamCheek).toBe(0.8);
    if (reason === 'interrupt') scheduler.clear('interrupted');
    else if (reason === 'speech-finished') scheduler.playback('turn', 's0', 'finished');
    else if (reason === 'catalog-changed') service.setActionCatalog([{ ...catalog[0], label: 'new' }, ...catalog.slice(1)]);
    else if (reason === 'model-changed') service.attach(core);
    else service.reportRuntimeFailure(new Error('render error'));
    if (reason !== 'model-changed' && reason !== 'render-failed') expect(frame(100).ParamCheek).toBeCloseTo(0.4);
    expect(frame(1500)).toEqual({ ParamAngleX: 0, ParamCheek: 0, ParamAngleY: 0 });
    expect(frame(100).ParamAngleY).toBe(0);
  });

  it('replaces a running plan without retaining its remaining groups', () => {
    const { service, frame } = setup();
    service.dispatch({ action_id: [['a', 'b'], 'c'] });
    frame(200);
    service.dispatch({ action_id: ['a'] });
    frame(2000);
    expect(frame(200)).toEqual({ ParamAngleX: 0, ParamCheek: 0, ParamAngleY: 0 });
  });

  it('validates all groups before starting and never plays a valid prefix of an invalid plan', () => {
    const { service, frame } = setup();
    expect(service.dispatch({ action_id: ['a', 'unknown'] })).toMatchObject({ ok: false, reason: 'invalid' });
    service.setActionCatalog([...catalog, definition('missing', 'Unknown', 1, 100, 100, 100)]);
    expect(service.dispatch({ action_id: ['a', 'missing'] })).toMatchObject({ ok: false, reason: 'no-capability' });
    expect(frame(100)).toEqual({ ParamAngleX: 0, ParamCheek: 0, ParamAngleY: 0 });
    expect(service.getMouseFollowWeight()).toBe(1);
  });
});

describe('action plan input bounds', () => {
  it('accepts sequential and parallel groups and keeps repeated actions in separate stages', () => {
    expect(parseActionIntent({ action_id: [[' a ', 'b'], 'a'] })).toEqual({ actionId: [['a', 'b'], 'a'] });
    expect(parseActionIntent({ actionId: ['a', 'b'] })).toEqual({ actionId: ['a', 'b'] });
  });
  it.each([[], [[]], [[['a']]], [['a', 'a']], ['a', 42], Array(9).fill('a'), [Array(5).fill('a')]]
    .map((value) => ({ value })))('rejects invalid or excessive plans: $value', ({ value }) => {
      expect(parseActionIntent({ action_id: value })).toBeUndefined();
    });
});
