import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BootstrapContext } from '@app/core/bootstrapContext';
import { LogService, TracedError } from './LogService';

const bootstrap = (debugModeEnabled = false): BootstrapContext => ({
  windowKind: 'pet',
  configSnapshot: {
    globalModelConfig: { debugModeEnabled },
  } as BootstrapContext['configSnapshot'],
  startedAt: Date.now(),
});

describe('LogService trace output', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps intermediate records silent and emits the full data set at end', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const log = new LogService(bootstrap());
    const context = log.contextRegistry.register('Live2dLayoutService', {
      relation: 'scale',
      params: { modelId: 'murasame', scale: 1 },
      behavior: '重新计算布局并同步窗口尺寸',
    });
    const trace = context.beginTrace('scale.apply');

    trace.record('scale.changed', {
      previous: { scale: 1, revision: 10 },
      next: { scale: 1.2, revision: 11 },
    });
    expect(info).not.toHaveBeenCalled();

    trace.end({ actual: { width: 1200, height: 900 } });

    expect(info).toHaveBeenCalledTimes(1);
    const [summary, payload] = info.mock.calls[0] as [string, {
      status: string;
      data: Record<string, unknown>;
      timeline: Array<{ event: string; data?: Record<string, unknown> }>;
      source?: { file?: string; line?: number };
    }];
    expect(summary).toContain('INFO [Live2dLayoutService.scale]');
    expect(payload.status).toBe('completed');
    expect(payload.data).toEqual({ actual: { width: 1200, height: 900 } });
    expect(payload.timeline.map((event) => event.event)).toEqual(['scale.changed', 'trace.end']);
    expect(payload.source?.file).toBeTruthy();
    expect(payload.source?.line).toBeTypeOf('number');
  });

  it('emits a traced error with expected data, cause and redacted fields', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = new LogService(bootstrap(true));
    const context = log.contextRegistry.register('Live2dLayoutService', {
      relation: 'scale',
      params: { scale: 1 },
      behavior: '校验缩放结果',
    });
    const trace = context.beginTrace('scale.validate');
    const cause = new Error('native acknowledgement missing');
    const circular: Record<string, unknown> = { token: 'secret', value: 1 };
    circular.self = circular;

    const traced = trace.fail('scale invariant violated', {
      expected: { windowUpdate: true },
      actual: { windowUpdate: false, circular },
    }, cause);

    expect(traced).toBeInstanceOf(TracedError);
    expect(traced.traceId).toBe(trace.traceId);
    expect(error).toHaveBeenCalledTimes(1);
    const [, payload] = error.mock.calls[0] as [string, {
      status: string;
      data: Record<string, unknown>;
      timeline: Array<{ event: string; data?: Record<string, unknown> }>;
    }];
    expect(payload.status).toBe('failed');
    expect(payload.data.expected).toEqual({ windowUpdate: true });
    expect(payload.data.actual).toEqual({
      windowUpdate: false,
      circular: { token: '[redacted]', value: 1, self: '[Circular]' },
    });
    expect(payload.timeline.at(-1)?.event).toBe('trace.fail');
  });

  it('preserves shared action arrays without mistaking sibling references for cycles', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const log = new LogService(bootstrap());
    const context = log.contextRegistry.register('Live2dActionService', { relation: 'action.execute' });
    const actionId = [['a', 'b'], 'c'];
    context.beginTrace('action.execute').end({ requestedActionId: actionId, actionId });
    expect(info.mock.calls[0][1].data).toEqual({ requestedActionId: [['a', 'b'], 'c'], actionId: [['a', 'b'], 'c'] });
    context.dispose();
  });

  it('does not print a second error when a traced error reaches the global handler', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = new LogService(bootstrap());
    const context = log.contextRegistry.register('TestService', {
      relation: 'request',
      params: { requestId: 'r-1' },
    });
    const trace = context.beginTrace('request.run');
    const traced = trace.fail('request failed');

    log.captureException(traced, { origin: 'window.unhandledrejection' });

    expect(error).toHaveBeenCalledTimes(1);
  });

  it('shows numeric token usage while continuing to redact credentials and invalid usage values', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const log = new LogService(bootstrap());
    const context = log.contextRegistry.register('LlmService', { relation: 'usage' });
    context.beginTrace('usage').end({ promptTokens: 2000, cachedTokens: 1500, uncachedTokens: 500,
      completionTokens: 12, accessToken: 12345, apiKey: 'secret', invalid: { cachedTokens: 'secret' } });
    expect(info.mock.calls[0][1].data).toEqual({ promptTokens: 2000, cachedTokens: 1500, uncachedTokens: 500,
      completionTokens: 12, accessToken: '[redacted]', apiKey: '[redacted]', invalid: { cachedTokens: '[redacted]' } });
    context.dispose();
  });
});
