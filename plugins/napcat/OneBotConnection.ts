import type { PluginLogger } from './types';

/** One set of echo waiters per socket. Close settles only attempts on that socket. */
export class OneBotConnection {
  private socket?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private delay = 1000;
  private stopped = false;
  private readonly waiters = new Map<string, (ok: boolean, data?: unknown) => void>();
  private url: string;
  private token: string;
  private readonly logger: PluginLogger;
  private readonly onMessage: (frame: unknown) => void;
  private readonly onReady: () => void;
  private readonly onState: (state: 'ready' | 'closed' | 'connecting') => void;
  constructor(
    url: string,
    token: string,
    logger: PluginLogger,
    onMessage: OneBotConnection['onMessage'],
    onReady: OneBotConnection['onReady'],
    onState: OneBotConnection['onState'],
  ) {
    this.url = url;
    this.token = token;
    this.logger = logger;
    this.onMessage = onMessage;
    this.onReady = onReady;
    this.onState = onState;
  }

  get ready() {
    return this.socket?.readyState === WebSocket.OPEN;
  }
  start() {
    if (this.stopped || this.socket) return;
    this.onState('connecting');
    let socket: WebSocket;
    try {
      const url = new URL(this.url);
      if (!['ws:', 'wss:'].includes(url.protocol)) throw Error();
      if (this.token) url.searchParams.set('access_token', this.token);
      socket = new WebSocket(url.toString());
    } catch {
      this.onState('closed');
      this.schedule();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.delay = 1000;
      this.onState('ready');
      this.onReady();
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket || typeof event.data !== 'string') return;
      let frame;
      try {
        frame = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!frame || typeof frame !== 'object') return;
      if ('echo' in frame) {
        if (typeof frame.echo === 'string')
          this.waiters.get(frame.echo)?.(
            frame.status === 'ok' && (frame.retcode === undefined || frame.retcode === 0),
            frame.data,
          );
      } else this.onMessage(frame);
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.disconnect();
      this.onState('closed');
      this.logger.warn('websocket.closed', { code: event.code });
      this.schedule();
    };
  }
  private schedule() {
    if (this.stopped || this.retry) return;
    this.retry = setTimeout(() => {
      this.retry = undefined;
      this.start();
    }, this.delay);
    this.delay = Math.min(this.delay * 2, 30000);
  }
  private disconnect() {
    const socket = this.socket;
    this.socket = undefined;
    if (socket) {
      socket.onclose = socket.onmessage = socket.onopen = null;
      if (socket.readyState < 2) socket.close();
    }
    for (const resolve of this.waiters.values()) resolve(false);
    if (this.retry) clearTimeout(this.retry);
    this.retry = undefined;
  }
  configure(url: string, token: string) {
    if (url === this.url && token === this.token) return;
    this.url = url;
    this.token = token;
    this.disconnect();
    this.start();
  }
  dispose() {
    this.stopped = true;
    this.disconnect();
  }
  request(
    action: string,
    params: Record<string, unknown>,
    timeout?: number,
  ): Promise<{ ok: boolean; data?: unknown }> {
    const socket = this.socket;
    if (!socket || !this.ready) return Promise.resolve({ ok: false });
    const echo = crypto.randomUUID();
    return new Promise((resolve) => {
      const finish = (ok: boolean, data?: unknown) => {
        if (timer) clearTimeout(timer);
        this.waiters.delete(echo);
        resolve({ ok, data });
      };
      const timer = timeout ? setTimeout(() => finish(false), timeout) : undefined;
      this.waiters.set(echo, finish);
      try {
        socket.send(JSON.stringify({ action, params, echo }));
      } catch {
        finish(false);
      }
    });
  }
}
