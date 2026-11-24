import { isBoundaryName, type BoundaryName } from '../../../shared/logging/boundaryTrace.js';
import { exportBoundaryCall, exportSpan, flushSpans } from '../../../shared/logging/exportBoundaryTrace.js';
import { spanAttributes, type SpanRecord } from '../../../shared/logging/spanContext.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LineageEntry = {
  traceId: string;
  boundary: BoundaryName;
  event: string;
  scope: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeLevel = (value: unknown): LogLevel =>
  value === 'debug' || value === 'info' || value === 'warn' || value === 'error' ? value : 'info';

export class BackendLogService {
  rendererEntries = 0;
  backendEntries = 0;
  /** 测试或诊断时接走血缘。生产路径只转发，不在进程里累积。 */
  onLineage?: (entry: LineageEntry) => void;
  onSpan?: (span: SpanRecord) => void;

  recordSpan(span: SpanRecord): void {
    this.onSpan?.(span);
    exportSpan(span);
  }

  flush(): Promise<void> | undefined {
    return flushSpans();
  }

  /** 单个事件只用于进程内血缘；没有调用区间，不生成 span。 */
  lineage(traceId: string, boundary: string, event: string, scope = 'backend'): void {
    if (!traceId || !isBoundaryName(boundary)) return;
    const entry: LineageEntry = { traceId, boundary, event, scope };
    this.onLineage?.(entry);
  }

  /** 主进程自己发起的边界。traceId 由这里生成，再交给后续日志。 */
  open(scope: string, boundary: BoundaryName): { traceId: string; event: (name: string) => void } {
    const traceId = crypto.randomUUID().replaceAll('-', '');
    return { traceId, event: (name: string) => this.lineage(traceId, boundary, name, scope) };
  }

  error(scope: string, event: string, data: Record<string, unknown> = {}, context: Record<string, unknown> = {}): void {
    this.backendEntries += 1;
    console.error(JSON.stringify({ ns: 'live2d.backend', level: 'error', scope, event, data, context, ts: Date.now() }));
  }

  mirrorRenderer(event: { sender?: { id?: number } } | null | undefined, payload: Record<string, unknown> = {}): void {
    if (!isRecord(payload) || payload.kind === 'policy.patch') return;
    if (payload.kind === 'boundary' && typeof payload.traceId === 'string' && isBoundaryName(payload.boundary) && Array.isArray(payload.events)) {
      const events: Array<{ event: string; at: number }> = [];
      for (const item of payload.events) {
        if (!isRecord(item) || typeof item.event !== 'string') continue;
        this.lineage(payload.traceId, payload.boundary, item.event, 'renderer');
        if (typeof item.at === 'number' && Number.isFinite(item.at)) events.push({ event: item.event, at: item.at });
      }
      const { startedAt, endedAt, spanId } = payload;
      if (typeof startedAt === 'number' && Number.isFinite(startedAt) && typeof endedAt === 'number' && Number.isFinite(endedAt) && endedAt >= startedAt) {
        if (typeof spanId === 'string') {
          const attributes = spanAttributes(payload.attributes);
          this.recordSpan({
            traceId: payload.traceId, spanId, name: payload.boundary, startedAt, endedAt,
            ...(typeof payload.parentSpanId === 'string' ? { parentSpanId: payload.parentSpanId } : {}),
            status: payload.failed === true ? 'error' : 'ok',
            ...(Object.keys(attributes).length ? { attributes } : {}),
            events: events.map((item) => ({ name: item.event, at: item.at })),
          });
        } else {
          exportBoundaryCall({ traceId: payload.traceId, boundary: payload.boundary, startedAt, endedAt, events, failed: payload.failed === true });
        }
      }
      return;
    }
    const level = normalizeLevel(payload.level);
    const renderer = isRecord(payload.renderer)
      ? { ...payload.renderer, webContentsId: event?.sender?.id }
      : payload.renderer;
    this.rendererEntries += 1;
    const entry = { ns: 'live2d.renderer', level, renderer, ts: Date.now() };
    if (level === 'error') console.error(JSON.stringify(entry));
    else if (level === 'warn') console.warn(JSON.stringify(entry));
    else if (level === 'info') console.info(JSON.stringify(entry));
  }

  getStats(): { rendererEntries: number; backendEntries: number } {
    return { rendererEntries: this.rendererEntries, backendEntries: this.backendEntries };
  }

  setDebugPolicy(_enabled?: unknown): void {
    // 后端只输出错误；renderer 镜像由 mirrorRenderer 按级别输出。
  }
}

export const createBackendLogService = (): BackendLogService => new BackendLogService();
