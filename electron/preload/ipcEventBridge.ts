type IpcCallback = (...args: unknown[]) => void;

interface RendererEvents {
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
}

export const createIpcEventBridge = ({ ipcRenderer }: { ipcRenderer: RendererEvents }) => {
  const allowedIpcEvents = new Set([
    'ddd:window:drag',
    'ddd:window:bounds-changed',
    'ddd:window:fact',
    'ddd:window:intent-ack',
    'ddd:live2denv:asr:event',
  ]);

  const ipcEventListenerRegistry = new Map<string, { callbacks: Set<IpcCallback>; dispatcher: (event: unknown, ...args: unknown[]) => void }>();

  const getChannelRegistry = (channel: string) => {
    let reg = ipcEventListenerRegistry.get(channel);
    if (reg) return reg;

    const callbacks = new Set<IpcCallback>();
    const dispatcher = (_event: unknown, ...args: unknown[]) => {
      for (const callback of callbacks) {
        try {
          callback(...args);
        } catch (error: unknown) {
          console.error('[WindowAPI] ipc listener error', channel, error);
        }
      }
    };

    reg = { callbacks, dispatcher };
    ipcEventListenerRegistry.set(channel, reg);
    ipcRenderer.on(channel, dispatcher);
    return reg;
  };

  const off = (channel: string, callback: unknown): void => {
    if (!allowedIpcEvents.has(channel)) return;
    if (typeof callback !== 'function') return;
    const reg = ipcEventListenerRegistry.get(channel);
    if (!reg) return;
    reg.callbacks.delete(callback as IpcCallback);
    if (reg.callbacks.size > 0) return;
    ipcRenderer.removeListener(channel, reg.dispatcher);
    ipcEventListenerRegistry.delete(channel);
  };

  const on = (channel: string, callback: unknown): (() => void) => {
    if (!allowedIpcEvents.has(channel)) return () => {};
    if (typeof callback !== 'function') return () => {};

    const reg = getChannelRegistry(channel);
    const listener = callback as IpcCallback;
    if (reg.callbacks.has(listener)) return () => off(channel, callback);
    reg.callbacks.add(listener);
    return () => off(channel, callback);
  };

  return { on, off };
};
