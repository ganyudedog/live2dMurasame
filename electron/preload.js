import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('petAPI', {
  setSize: (width, height, options = {}) => {
    if (width && typeof width === 'object') {
      return ipcRenderer.invoke('pet:resizeMainWindow', width);
    }
    const payload = {
      width,
      height,
      ...options,
    };
    return ipcRenderer.invoke('pet:resizeMainWindow', payload);
  },
  setBounds: (bounds) => ipcRenderer.invoke('pet:setMainWindowBounds', bounds),
  setMousePassthrough: (enabled) => ipcRenderer.invoke('pet:setMousePassthrough', enabled),
  getCursorScreenPoint: () => ipcRenderer.invoke('pet:getCursorScreenPoint'),
  getWindowBounds: () => ipcRenderer.invoke('pet:getWindowBounds'),
  getSettings: () => ipcRenderer.invoke('pet:getSettings'),
  updateSettings: (patch) => ipcRenderer.invoke('pet:updateSettings', patch),
  onSettingsUpdated: (callback) => {
    const listener = (_event, settings) => {
      try {
        callback(settings);
      } catch (err) {
        console.error('[petAPI] settings listener error', err);
      }
    };

    ipcRenderer.on('pet:settingsUpdated', listener);
    return () => ipcRenderer.removeListener('pet:settingsUpdated', listener);
  },
});
