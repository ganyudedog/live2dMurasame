const levels = ['debug', 'info', 'warn', 'error'] as const;
type LogLevel = (typeof levels)[number];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeLevel = (value: unknown): LogLevel =>
  value === 'debug' || value === 'info' || value === 'warn' || value === 'error' ? value : 'info';

export class BackendLogService {
  rendererEntries = 0;
  backendEntries = 0;

  error(scope: string, event: string, data: Record<string, unknown> = {}, context: Record<string, unknown> = {}): void {
    this.backendEntries += 1;
    console.error(JSON.stringify({ ns: 'live2d.backend', level: 'error', scope, event, data, context, ts: Date.now() }));
  }

  mirrorRenderer(event: { sender?: { id?: number } } | null | undefined, payload: Record<string, unknown> = {}): void {
    if (!isRecord(payload) || payload.kind === 'policy.patch') return;
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
