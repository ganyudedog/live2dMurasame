export const createIpcEventBridge = ({ ipcRenderer }) => {
  const allowedIpcEvents = new Set([
    'pet:windowDrag',
    'pet:windowBoundsChanged',
    'pet:windowFact',
    'pet:windowIntentAck',
  ]);

  const ipcEventListenerRegistry = new Map();

  const getChannelRegistry = (channel) => {
    let reg = ipcEventListenerRegistry.get(channel);
    if (reg) return reg;

    const callbacks = new Set();
    const dispatcher = (_event, ...args) => {
      for (const callback of callbacks) {
        try {
          callback(...args);
        } catch (error) {
          console.error('[WindowAPI] ipc listener error', channel, error);
        }
      }
    };

    reg = {
      callbacks,
      dispatcher,
    };
    ipcEventListenerRegistry.set(channel, reg);
    ipcRenderer.on(channel, dispatcher);
    return reg;
  };

  const on = (channel, callback) => {
    if (!allowedIpcEvents.has(channel)) return;
    if (typeof callback !== 'function') return;

    const reg = getChannelRegistry(channel);
    if (reg.callbacks.has(callback)) return;
    reg.callbacks.add(callback);
  };

  const off = (channel, callback) => {
    if (!allowedIpcEvents.has(channel)) return;
    if (typeof callback !== 'function') return;
    const reg = ipcEventListenerRegistry.get(channel);
    if (!reg) return;
    reg.callbacks.delete(callback);
    if (reg.callbacks.size > 0) return;
    ipcRenderer.removeListener(channel, reg.dispatcher);
    ipcEventListenerRegistry.delete(channel);
  };

  return { on, off };
};