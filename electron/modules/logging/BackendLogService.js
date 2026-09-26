const normalizeLevel = (value) => ['debug', 'info', 'warn', 'error'].includes(value) ? value : 'info';

export class BackendLogService {
  constructor() {
    this.rendererEntries = 0;
    this.backendEntries = 0;
  }

  error(scope, event, data = {}, context = {}) {
    this.backendEntries += 1;
    console.error(JSON.stringify({ ns: 'live2d.backend', level: 'error', scope, event, data, context, ts: Date.now() }));
  }

  mirrorRenderer(event, payload = {}) {
    if (!payload || typeof payload !== 'object' || payload.kind === 'policy.patch') return;
    const level = normalizeLevel(payload.level);
    const renderer = payload.renderer && typeof payload.renderer === 'object'
      ? { ...payload.renderer, webContentsId: event?.sender?.id }
      : payload.renderer;
    this.rendererEntries += 1;
    const entry = { ns: 'live2d.renderer', level, renderer, ts: Date.now() };
    if (level === 'error') console.error(JSON.stringify(entry));
    else if (level === 'warn') console.warn(JSON.stringify(entry));
    else if (level === 'info') console.info(JSON.stringify(entry));
  }

  getStats() {
    return { rendererEntries: this.rendererEntries, backendEntries: this.backendEntries };
  }

  setDebugPolicy() {
    // 后端只输出错误；renderer 镜像由 mirrorRenderer 按级别输出。
  }
}

export const createBackendLogService = () => new BackendLogService();
