import { isBoundaryName, type BoundaryName } from '../../../shared/logging/boundaryTrace.js';
import { exportBoundaryHop } from '../../../shared/logging/exportBoundaryTrace.js';

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

  /** 记下调用方传入的 traceId 与 boundary，并在开发环境交给唯一的导出器。 */
  lineage(traceId: string, boundary: string, event: string, scope = 'backend'): void {
    if (!traceId || !isBoundaryName(boundary)) return;
    const entry: LineageEntry = { traceId, boundary, event, scope };
    this.onLineage?.(entry);
    exportBoundaryHop({ traceId, boundary, hop: event, side: scope === 'renderer' ? 'renderer' : 'backend' });
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
      for (const item of payload.events) {
        if (isRecord(item) && typeof item.event === 'string') this.lineage(payload.traceId, payload.boundary, item.event, 'renderer');
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
