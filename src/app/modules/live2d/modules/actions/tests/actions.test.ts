import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Live2dActionService } from '../service/Live2dActionService';
import { attachActionRuntime } from '../infrastructure/attachActionRuntime';
import { LogService } from '@app/shared/logging/LogService';
import type { BootstrapContext } from '@app/core/bootstrapContext';
import type { ActionDefinition } from '../domain/types';

const createCore = () => {
  const ids = ['ParamAngleX', 'ParamAngleY', 'ParamEyeBallX', 'ParamEyeBallY', 'ParamCheek', 'ParamMouthOpenY', 'ParamBreath', 'Custom'];
  const defaults = [0, 0, 0, 0, 0, 0.2, 0, 0];
  const values = new Map(ids.map((id, index) => [id, defaults[index]]));
  return {
    values,
    getModel: () => ({ parameters: { ids } }),
    getParameterCount: () => ids.length,
    getParameterMinimumValue: (index: number) => index < 4 ? -30 : 0,
    getParameterMaximumValue: (index: number) => index < 4 ? 30 : 1,
    getParameterDefaultValue: (index: number) => defaults[index],
    getParameterValueById: (id: string) => values.get(id) ?? 0,
    setParameterValueById: (id: string, value: number) => { values.set(id, value); },
    reset: () => ids.forEach((id, index) => values.set(id, defaults[index])),
  };
};

const actionDefinitions: ActionDefinition[] = [
  { id: 'cheek', label: '脸红', category: 'emotion' as const, targets: { ParamCheek: 0.4 } },
  { id: 'cheek-half', label: '轻微脸红', category: 'emotion' as const, targets: { ParamCheek: 0.5 } },
  { id: 'angle-x-4', label: '向右看', category: 'head' as const, targets: { ParamAngleX: 4 } },
  { id: 'angle-x-3', label: '轻微向右看', category: 'head' as const, targets: { ParamAngleX: 3 } },
  { id: 'angle-x-10', label: '向右转头', category: 'head' as const, targets: { ParamAngleX: 10 } },
  { id: 'angle-x-neg10', label: '向左转头', category: 'head' as const, targets: { ParamAngleX: -10 } },
  { id: 'angle-x-large', label: '大幅向右看', category: 'head' as const, targets: { ParamAngleX: 999, Custom: 1 } },
  { id: 'angle-x-large-cheek', label: '大幅向右看并脸红', category: 'emotion' as const,
    targets: { ParamAngleX: 999, ParamCheek: 0.3, Custom: 1 } },
  { id: 'gaze-cheek', label: '看向一侧并脸红', category: 'emotion' as const,
    targets: { ParamEyeBallX: -0.5, ParamCheek: 0.4 } },
].map(({ targets, ...action }) => ({ ...action, durationMs: 900, enterMs: 200, returnMs: 250,
  tracks: Object.entries(targets).map(([parameterId, value]) => ({ parameterId, keyframes: [{ timeMs: 0, value: value! }] })),
}));

const configureActions = (service: Live2dActionService) => service.setActionCatalog(actionDefinitions);

describe('parameter actions and native local behavior', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('pauses the entire mouse source through remote return, then restores its weight smoothly', () => {
    const actions = new Live2dActionService();
    const core = createCore();
    configureActions(actions);
    actions.attach(core);
    expect(actions.getMouseFollowWeight()).toBe(1);
    // 即便远程只控制脸红，鼠标对头部与眼球的整路输入也暂停。
    actions.dispatch({ action_id: 'cheek' });
    expect(actions.getMouseFollowWeight()).toBe(0);
    vi.advanceTimersByTime(1200);
    expect(actions.getMouseFollowWeight()).toBe(0);
    vi.advanceTimersByTime(150);
    expect(actions.getMouseFollowWeight()).toBe(0);
    vi.advanceTimersByTime(150);
    expect(actions.getMouseFollowWeight()).toBeCloseTo(0.5);
    actions.dispatch({ action_id: 'angle-x-4' });
    expect(actions.getMouseFollowWeight()).toBe(0);
    actions.release('interrupted');
    vi.advanceTimersByTime(249);
    expect(actions.getMouseFollowWeight()).toBe(0);
    vi.advanceTimersByTime(1);
    expect(actions.getMouseFollowWeight()).toBe(0);
    vi.advanceTimersByTime(300);
    expect(actions.getMouseFollowWeight()).toBe(1);
    actions.attach(core);
    expect(actions.getMouseFollowWeight()).toBe(1);
    actions.dispose();
  });

  it('emits visible correlated diagnostics with bounded frame logs and actual parameter values', () => {
    const output = vi.spyOn(console, 'info').mockImplementation(() => {});
    const log = new LogService({ configSnapshot: null } as BootstrapContext);
    const core = createCore();
    const actions = new Live2dActionService(log);
    configureActions(actions);
    actions.attach(core);
    actions.dispatch({ action_id: 'angle-x-large' }, actions.getCapability().modelVersion,
      { conversationId: 'turn', requestId: 's0' });
    for (let i = 0; i < 100; i++) { vi.advanceTimersByTime(16); core.reset(); actions.tick(); }
    const records = output.mock.calls.map(([, payload]) => payload);
    const chain = records.find((record) => record.operation === 'action.execute');
    expect(chain.timeline.find((event: { event: string }) => event.event === 'action.accepted').data).toMatchObject({
      conversationId: 'turn', requestId: 's0', targets: { ParamAngleX: 30, Custom: 1 },
      droppedTargetIds: [], clampedTargetIds: ['ParamAngleX'],
    });
    expect(chain.timeline.find((event: { event: string }) => event.event === 'render.timelineStarted').data.values).toEqual({ ParamAngleX: 30, Custom: 1 });
    expect(chain.data).toMatchObject({
      requestId: 's0', reason: 'returned', timelineObserved: true, lastValues: { ParamAngleX: 0, Custom: 0 },
      observedRanges: { ParamAngleX: { min: 0, max: 30 }, Custom: { min: 0, max: 1 } },
    });
    // 一百帧只输出模型、接受、首帧、保持、完成等边界记录，不按帧刷屏。
    expect(records.filter((record) => record.operation === 'action.execute')).toHaveLength(1);
    expect(records.length).toBeLessThan(4);
    actions.dispose();
  });

  it('reveals accepted actions that never reach rendering and isolates a broken logger', () => {
    const output = vi.spyOn(console, 'info').mockImplementation(() => {});
    const log = new LogService({ configSnapshot: null } as BootstrapContext);
    const actions = new Live2dActionService(log);
    configureActions(actions);
    actions.attach(createCore());
    actions.dispatch({ action_id: 'cheek' });
    actions.attach(null);
    expect(output.mock.calls.find(([, payload]) => payload.operation === 'action.execute')?.[1].data)
      .toMatchObject({ reason: 'model-detached', frames: 0, firstFrameDelayMs: null, timelineObserved: false });
    vi.spyOn(log.contextRegistry, 'register').mockImplementation(() => { throw new Error('broken logger'); });
    const core = createCore();
    actions.attach(core);
    expect(actions.dispatch({ action_id: 'cheek' }).ok).toBe(true);
    vi.advanceTimersByTime(200); core.reset(); actions.tick();
    expect(core.values.get('ParamCheek')).toBe(0.4);
    actions.dispose();
  });

  it('reports render failures once without throwing out of the SDK update callback', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const failure = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = new LogService({ configSnapshot: null } as BootstrapContext);
    const core = createCore();
    const actions = new Live2dActionService(log);
    configureActions(actions);
    actions.attach(core);
    const handlers = new Map<string, () => void>();
    const off = attachActionRuntime({
      on: (event, handler) => { handlers.set(event, handler); },
      off: (event) => { handlers.delete(event); },
    }, actions);
    core.setParameterValueById = () => { throw new Error('invalid model'); };
    actions.dispatch({ action_id: 'cheek' });
    expect(() => { handlers.get('beforeModelUpdate')?.(); handlers.get('beforeModelUpdate')?.(); }).not.toThrow();
    expect(failure).toHaveBeenCalledOnce();
    expect(failure.mock.calls[0][1]).toMatchObject({ operation: 'action.execute', status: 'failed' });
    off(); actions.dispose();
  });

  it('reads real Cubism ranges, supports model parameters and leaves breath local', () => {
    const core = createCore();
    const service = new Live2dActionService();
    configureActions(service);
    service.attach(core);
    expect(service.getCapability().actions.map((action) => action.id)).toEqual(actionDefinitions.map((action) => action.id));
    service.dispatch({ action_id: 'angle-x-large-cheek' });
    vi.advanceTimersByTime(200);
    core.reset(); service.tick();
    expect(core.values.get('ParamAngleX')).toBe(30);
    expect(core.values.get('ParamCheek')).toBe(0.3);
    expect(core.values.get('ParamBreath')).toBe(0);
    expect(core.values.get('Custom')).toBe(1);
    service.dispose();
  });

  it('gives remote priority per parameter, preserves upward protection and returns to the live baseline', () => {
    const core = createCore();
    const service = new Live2dActionService();
    configureActions(service);
    service.attach(core);
    service.setUpwardLimits({ eye: (value) => Math.min(value, 0.25), head: (value) => Math.min(value, 4) });
    const localFrame = () => {
      core.reset();
      core.values.set('ParamEyeBallX', 1);
      core.values.set('ParamEyeBallY', 1);
      core.values.set('ParamAngleX', 20);
    };
    service.dispatch({ action_id: 'gaze-cheek' });
    vi.advanceTimersByTime(250);
    localFrame(); service.tick();
    expect(core.values.get('ParamEyeBallX')).toBe(-0.5);
    expect(core.values.get('ParamAngleX')).toBe(20);
    expect(core.values.get('ParamEyeBallY')).toBe(0.25);
    expect(core.values.get('ParamCheek')).toBe(0.4);
    core.values.set('Custom', 2);
    service.tick();
    expect(core.values.get('Custom')).toBe(2);
    service.release();
    vi.advanceTimersByTime(125);
    localFrame(); service.tick();
    expect(core.values.get('ParamEyeBallX')).toBeCloseTo(0.25);
    expect(core.values.get('ParamCheek')).toBeCloseTo(0.2);
    vi.advanceTimersByTime(125);
    localFrame(); service.tick();
    expect(core.values.get('ParamEyeBallX')).toBe(1);
    service.dispose();
  });

  it('starts replacement poses at the visible pose and discards old-model actions', () => {
    const core = createCore();
    const service = new Live2dActionService();
    configureActions(service);
    service.attach(core);
    const version = service.getCapability().modelVersion;
    service.dispatch({ action_id: 'angle-x-10' }, version);
    vi.advanceTimersByTime(100);
    core.reset(); service.tick();
    expect(core.values.get('ParamAngleX')).toBe(5);
    service.dispatch({ action_id: 'angle-x-neg10' }, version);
    core.reset(); service.tick();
    expect(core.values.get('ParamAngleX')).toBe(5);
    vi.advanceTimersByTime(100);
    core.reset(); service.tick();
    expect(core.values.get('ParamAngleX')).toBeCloseTo(-2.5);
    service.attach(core);
    expect(service.dispatch({ action_id: 'angle-x-10' }, version).reason).toBe('stale');
    core.reset(); service.tick();
    expect(core.values.get('ParamAngleX')).toBe(0);
    service.dispose();
  });

  it('restores normal mouth on observation failure rather than closing or freezing it', () => {
    const core = createCore();
    const service = new Live2dActionService();
    service.attach(core);
    service.setAudioLevel(1);
    for (let i = 0; i < 30; i++) { vi.advanceTimersByTime(16); core.reset(); service.tick(); }
    expect(core.values.get('ParamMouthOpenY')).toBeGreaterThan(0.9);
    service.setAudioLevel(null);
    for (let i = 0; i < 50; i++) { vi.advanceTimersByTime(16); core.reset(); service.tick(); }
    expect(core.values.get('ParamMouthOpenY')).toBeCloseTo(0.2, 3);
    service.dispose();
  });

  it('plays visible keyframe turns and rejects unavailable parameters as a whole action', () => {
    const core = createCore();
    const service = new Live2dActionService();
    const turn: ActionDefinition = { id: 'turn', label: '转头', category: 'head', durationMs: 800, enterMs: 100, returnMs: 100,
      tracks: [{ parameterId: 'ParamAngleX', keyframes: [
        { timeMs: 0, value: 0 }, { timeMs: 400, value: 25 }, { timeMs: 800, value: -20 },
      ] }] };
    service.setActionCatalog([turn]); service.attach(core);
    service.dispatch({ actionId: 'turn' });
    vi.advanceTimersByTime(500); core.reset(); service.tick();
    expect(core.values.get('ParamAngleX')).toBe(25);
    // 同表广播不得打断正在执行的动画。
    service.setActionCatalog([turn]);
    vi.advanceTimersByTime(200); core.reset(); service.tick();
    expect(core.values.get('ParamAngleX')).toBeCloseTo(2.5);
    vi.advanceTimersByTime(200); core.reset(); service.tick();
    expect(core.values.get('ParamAngleX')).toBe(-20);
    vi.advanceTimersByTime(100); core.reset(); service.tick();
    expect(core.values.get('ParamAngleX')).toBe(0);
    service.setActionCatalog([{ ...turn, tracks: [...turn.tracks, { parameterId: 'Missing', keyframes: [{ timeMs: 0, value: 1 }] }] }]);
    expect(service.getCapability().actions).toEqual([]);
    expect(service.dispatch({ actionId: 'turn' })).toMatchObject({ ok: false, reason: 'no-capability' });
    expect(() => service.setActionCatalog([{ ...turn, tracks: [{ parameterId: 'ParamMouthOpenY', keyframes: [{ timeMs: 0, value: 1 }] }] }])).toThrow();
    service.dispose();
  });

  it('composes before render while preserving native idle, breath and the initial motion', () => {
    const actions = new Live2dActionService();
    const core = createCore();
    configureActions(actions);
    actions.attach(core);
    const handlers = new Map<string, () => void>();
    const parameters = [{ parameterId: 'ParamAngleX' }, { parameterId: 'ParamBreath' }];
    let breath = parameters;
    const originalIdle = () => true;
    const runtime = {
      coreModel: core,
      breath: { getParameters: () => breath, setParameters: (next: typeof parameters) => { breath = next; } },
      motionManager: { stopAllMotions: vi.fn(), state: { shouldRequestIdleMotion: originalIdle } },
      on: (event: string, handler: () => void) => { handlers.set(event, handler); },
      off: (event: string) => { handlers.delete(event); },
    };
    const off = attachActionRuntime(runtime, actions);
    expect(breath).toBe(parameters);
    expect(runtime.motionManager.state.shouldRequestIdleMotion).toBe(originalIdle);
    expect(runtime.motionManager.state.shouldRequestIdleMotion()).toBe(true);
    expect(runtime.motionManager.stopAllMotions).not.toHaveBeenCalled();
    core.values.set('ParamAngleX', 18);
    core.values.set('ParamAngleY', -15);
    core.values.set('ParamEyeBallX', -0.8);
    core.values.set('ParamBreath', 0.7);
    handlers.get('beforeModelUpdate')?.();
    expect(core.values.get('ParamAngleX')).toBe(18);
    expect(core.values.get('ParamAngleY')).toBe(-15);
    expect(core.values.get('ParamEyeBallX')).toBe(-0.8);
    expect(core.values.get('ParamBreath')).toBe(0.7);
    actions.dispatch({ action_id: 'cheek-half' });
    vi.advanceTimersByTime(200);
    handlers.get('beforeModelUpdate')?.();
    expect(core.values.get('ParamCheek')).toBe(0.5);
    off();
    expect(handlers.size).toBe(0);
    expect(breath).toBe(parameters);
    expect(runtime.motionManager.state.shouldRequestIdleMotion).toBe(originalIdle);
    actions.dispose();
  });
});

describe('best-effort sentence scheduling', () => {
  it('combines scheduling, real writes, return and later speech completion into one trace', () => {
    vi.useFakeTimers();
    const output = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const log = new LogService({ configSnapshot: null } as BootstrapContext);
      const actions = new Live2dActionService(log);
      const core = createCore();
      configureActions(actions);
      actions.attach(core);
      const scheduler = actions.sentenceActionScheduler;
      scheduler.begin('turn');
      const event = { conversationId: 'turn', requestId: 's0', modelVersion: actions.getCapability().modelVersion,
        hasSpeech: true, intent: { actionId: 'cheek' } };
      scheduler.receive(event);
      scheduler.playback('turn', 's0', 'started');
      actions.setAudioLevel(0.6);
      for (let i = 0; i < 100; i++) { vi.advanceTimersByTime(16); core.reset(); actions.tick(); }
      expect(output.mock.calls.filter(([, payload]) => payload.operation === 'action.execute')).toHaveLength(0);
      // 同一句语音还在播放，动作已回退；完整日志应同时保留这两个结束时机。
      vi.advanceTimersByTime(3000);
      scheduler.playback('turn', 's0', 'finished');
      scheduler.playback('turn', 'no-action', 'started');
      scheduler.playback('turn', 'no-action', 'finished');
      const chains = output.mock.calls.map(([, payload]) => payload).filter((record) => record.operation === 'action.execute');
      expect(chains).toHaveLength(1);
      expect(chains[0].data).toMatchObject({
        requestId: 's0', reason: 'returned', releaseReason: 'timeline-complete',
        playback: { state: 'finished' }, mouth: { peakLevel: 0.6 },
      });
      expect(chains[0].timeline.map((item: { event: string }) => item.event)).toEqual([
        'schedule.received', 'schedule.waiting', 'speech.playback', 'schedule.dispatch', 'action.accepted',
        'render.firstFrame', 'render.timelineStarted', 'action.finished', 'speech.playback', 'trace.end',
      ]);
      expect(chains[0].timeline.find((item: { event: string }) => item.event === 'render.timelineStarted').data.values)
        .toEqual({ ParamCheek: expect.closeTo(0.4) });
      scheduler.clear(); actions.dispose();
    } finally { output.mockRestore(); vi.useRealTimers(); }
  });

  it('retains playback observed before the action and explains late drops in a single trace', () => {
    const output = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const log = new LogService({ configSnapshot: null } as BootstrapContext);
      const actions = new Live2dActionService(log);
      configureActions(actions);
      actions.attach(createCore());
      const scheduler = actions.sentenceActionScheduler;
      scheduler.begin('turn');
      scheduler.playback('turn', 'late', 'started');
      scheduler.playback('turn', 'late', 'finished');
      scheduler.receive({ conversationId: 'turn', requestId: 'late', modelVersion: actions.getCapability().modelVersion,
        hasSpeech: true, intent: { actionId: 'cheek' } });
      const chains = output.mock.calls.map(([, payload]) => payload).filter((record) => record.operation === 'action.execute');
      expect(chains).toHaveLength(1);
      expect(chains[0].data).toMatchObject({ outcome: 'dropped', reason: 'sentence-ended' });
      expect(chains[0].timeline.map((item: { event: string }) => item.event)).toEqual([
        'speech.playback', 'speech.playback', 'schedule.received', 'action.dropped', 'trace.end',
      ]);
      scheduler.clear(); actions.dispose();
    } finally { output.mockRestore(); }
  });

  const setup = () => {
    const actions = new Live2dActionService();
    configureActions(actions);
    actions.attach(createCore());
    const dispatch = vi.spyOn(actions, 'dispatch');
    const release = vi.spyOn(actions, 'release');
    const scheduler = actions.sentenceActionScheduler;
    scheduler.begin('turn');
    const event = { conversationId: 'turn', requestId: 's0', modelVersion: actions.getCapability().modelVersion,
      hasSpeech: true, intent: { actionId: 'cheek' } };
    return { actions, dispatch, release, scheduler, event };
  };

  it('waits for start, applies once and ignores ended or cancelled sentences', () => {
    const { actions, dispatch, scheduler, event } = setup();
    scheduler.receive(event);
    expect(dispatch).not.toHaveBeenCalled();
    scheduler.playback('turn', 's0', 'started');
    expect(dispatch).toHaveBeenCalledOnce();
    scheduler.receive(event);
    scheduler.playback('turn', 's0', 'finished');
    scheduler.receive(event);
    scheduler.playback('turn', 's1', 'finished');
    scheduler.receive({ ...event, requestId: 's1' });
    scheduler.clear();
    scheduler.receive({ ...event, requestId: 's2' });
    expect(dispatch).toHaveBeenCalledOnce();
    actions.dispose();
  });

  it('applies during playback or for text, but does not treat synthesis failure as text', () => {
    const { actions, dispatch, scheduler, event } = setup();
    scheduler.playback('turn', 's0', 'started');
    scheduler.receive(event);
    scheduler.receive({ ...event, requestId: 'text', hasSpeech: false });
    scheduler.playback('turn', 'disabled', 'skipped', 'tts-disabled');
    scheduler.receive({ ...event, requestId: 'disabled' });
    scheduler.playback('turn', 'failed', 'error');
    scheduler.receive({ ...event, requestId: 'failed' });
    expect(dispatch).toHaveBeenCalledTimes(3);
    actions.dispose();
  });

  it('never applies a pending old-model pose to a newly attached model', () => {
    const { actions, dispatch, scheduler, event } = setup();
    scheduler.receive(event);
    actions.attach(createCore());
    scheduler.playback('turn', 's0', 'started');
    expect(dispatch).not.toHaveBeenCalled();
    expect(actions.sentenceActionScheduler).toBe(scheduler);
    scheduler.begin('next-turn');
    scheduler.receive({ ...event, conversationId: 'next-turn', modelVersion: actions.getCapability().modelVersion });
    scheduler.playback('next-turn', 's0', 'started');
    expect(dispatch).toHaveReturnedWith(expect.objectContaining({ ok: true }));
    actions.dispose();
  });

  it('parent disposal closes pending traces and prevents playback from dispatching an old sentence', () => {
    const output = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const actions = new Live2dActionService(new LogService({ configSnapshot: null } as BootstrapContext));
      configureActions(actions);
      actions.attach(createCore());
      const scheduler = actions.sentenceActionScheduler;
      const dispatch = vi.spyOn(actions, 'dispatch');
      scheduler.begin('turn');
      scheduler.receive({ conversationId: 'turn', requestId: 's0', modelVersion: actions.getCapability().modelVersion,
        hasSpeech: true, intent: { actionId: 'cheek' } });
      actions.dispose();
      scheduler.playback('turn', 's0', 'started');
      expect(dispatch).not.toHaveBeenCalled();
      const chains = output.mock.calls.map(([, payload]) => payload).filter((record) => record.operation === 'action.execute');
      expect(chains).toHaveLength(1);
      expect(chains[0].data).toMatchObject({ outcome: 'dropped', reason: 'model-detached', requestId: 's0' });
      actions.dispose();
      expect(output.mock.calls.filter(([, payload]) => payload.operation === 'action.execute')).toHaveLength(1);
    } finally { output.mockRestore(); }
  });

  it('an earlier sentence finishing cannot release the next sentence pose', () => {
    const { actions, release, scheduler, event } = setup();
    scheduler.playback('turn', 's0', 'started');
    scheduler.receive(event);
    scheduler.playback('turn', 's1', 'started');
    scheduler.receive({ ...event, requestId: 's1' });
    release.mockClear();
    scheduler.playback('turn', 's0', 'finished');
    expect(release).not.toHaveBeenCalled();
    scheduler.playback('turn', 's1', 'finished');
    expect(release).toHaveBeenCalledOnce();
    actions.dispose();
  });
});

