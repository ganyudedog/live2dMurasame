import type { ContextRegistration, LogService, TraceScope } from '@app/shared/logging/LogService';

/** 同一句动作共用一个 trace，调度与渲染只追加事件，在动作和语音均结束时输出一次。 */
export class ActionDiagnosticTrace {
  private context?: ContextRegistration;
  private trace?: TraceScope;
  private closed = false;
  private execution?: Record<string, unknown>;
  private playback?: Record<string, unknown>;
  private readonly waitForPlayback: boolean;
  private readonly data: Record<string, unknown>;

  constructor(log: LogService | undefined, data: Record<string, unknown>, waitForPlayback: boolean,
    serviceName: string) {
    this.data = { ...data };
    this.waitForPlayback = waitForPlayback;
    try {
      this.context = log?.contextRegistry.register(serviceName, {
        relation: 'action', params: data, behavior: '同一句动作从调度、播放到渲染与回退的完整链路',
      });
      this.trace = this.context?.beginTrace('action.execute');
    } catch { this.disposeContext(); }
  }

  record(event: string, data: Record<string, unknown>): void {
    if (this.closed) return;
    this.trace?.record(event, data);
  }

  finishExecution(data: Record<string, unknown>, force = false): void {
    this.execution = data;
    if (force || !this.waitForPlayback || this.playback) this.end(data);
  }

  finishPlayback(data: Record<string, unknown>): void {
    this.playback = data;
    if (this.execution) this.end(this.execution);
  }

  drop(reason: string, data: Record<string, unknown> = {}): void {
    this.record('action.dropped', { ...data, reason });
    this.end({ ...data, outcome: 'dropped', reason });
  }

  fail(error: unknown, data: Record<string, unknown>): void {
    if (this.closed) return;
    this.closed = true;
    this.trace?.fail('Live2D 动作渲染失败', { ...this.data, ...data }, error);
    this.disposeContext();
  }

  private end(data: Record<string, unknown>): void {
    if (this.closed) return;
    this.closed = true;
    this.trace?.end({ ...this.data, ...data, playback: this.playback });
    this.disposeContext();
  }

  private disposeContext(): void {
    this.context?.dispose();
    this.context = undefined;
    this.trace = undefined;
  }
}

/** 模型与音量观察生命周期仍独立记录；每句动作使用 begin 创建共享链路。 */
export class ActionDiagnostics {
  private readonly log?: LogService;
  private readonly serviceName: string;

  constructor(log?: LogService, serviceName = 'Live2dActionService') {
    this.log = log;
    this.serviceName = serviceName;
  }

  begin(data: Record<string, unknown>, waitForPlayback = false): ActionDiagnosticTrace {
    return new ActionDiagnosticTrace(this.log, data, waitForPlayback, this.serviceName);
  }

  record(operation: string, data: Record<string, unknown>, error?: unknown): void {
    if (!this.log) return;
    try {
      const context = this.log.contextRegistry.register(this.serviceName, {
        relation: operation, params: data, behavior: 'Live2D 模型或音量观察生命周期',
      });
      const trace = context.beginTrace(operation);
      if (error !== undefined) trace.fail('Live2D 动作渲染失败', data, error);
      else trace.end(data);
      context.dispose();
    } catch {
      // 诊断链路是旁路能力，日志实现故障不能中断模型绑定或动作执行。
    }
  }
}
