export const createIpcEventBridge = ({ ipcRenderer }) => {
  const allowedIpcEvents = new Set([
    'pet:windowBoundsChanged',
    'pet:windowFact',
    'pet:windowIntentAck',
  ]);

  const ipcEventListenerRegistry = new Map();

  const getChannelRegistry = (channel) => {
    let reg = ipcEventListenerRegistry.get(channel);
    if (!reg) {
      reg = new WeakMap();
      ipcEventListenerRegistry.set(channel, reg);
    }
    return reg;
  };

  const on = (channel, callback) => {
    if (!allowedIpcEvents.has(channel)) return;
    if (typeof callback !== 'function') return;

    const reg = getChannelRegistry(channel);
    if (reg.has(callback)) return;

    const wrapped = (_event, ...args) => {
      try {
        callback(...args);
      } catch (error) {
        console.error('[WindowAPI] ipc listener error', channel, error);
      }
    };
    reg.set(callback, wrapped);
    ipcRenderer.on(channel, wrapped);
  };

  const off = (channel, callback) => {
    if (!allowedIpcEvents.has(channel)) return;
    if (typeof callback !== 'function') return;
    const reg = ipcEventListenerRegistry.get(channel);
    const wrapped = reg?.get(callback);
    if (!wrapped) return;
    ipcRenderer.removeListener(channel, wrapped);
    reg.delete(callback);
  };

  return { on, off };
};