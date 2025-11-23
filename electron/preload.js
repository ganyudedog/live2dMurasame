import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('petAPI', {
  getSettings: () => ipcRenderer.invoke('pet:getSettings'),
  updateSettings: (patch) => ipcRenderer.invoke('pet:updateSettings', patch),
  launchControlPanel: (open) => ipcRenderer.invoke('pet:launchControlPanel',open),
  onSettingsUpdated: (callback) => {
    if (typeof callback !== 'function') return () => undefined;
    const listener = (_event, payload) => {
      try {
        callback(payload);
      } catch (err) {
        console.error('[petAPI] settings listener error', err);
      }
    };
    ipcRenderer.on('pet:settingsUpdated', listener);
    return () => {
      ipcRenderer.removeListener('pet:settingsUpdated', listener);
    };
  },
  reportState: (state) => {
    ipcRenderer.send('pet:stateUpdate', state);
  },
  requestState: () => ipcRenderer.invoke('pet:requestState'),
  onStateUpdate: (callback) => {
    if (typeof callback !== 'function') return () => undefined;
    const listener = (_event, payload) => {
      try {
        callback(payload);
      } catch (error) {
        console.error('[petAPI] state listener error', error);
      }
    };
    ipcRenderer.on('pet:stateUpdate', listener);
    return () => {
      ipcRenderer.removeListener('pet:stateUpdate', listener);
    };
  },
  dispatchAction: (action) => ipcRenderer.invoke('pet:dispatchAction', action),
  onAction: (callback) => {
    if (typeof callback !== 'function') return () => undefined;
    const listener = (_event, payload) => {
      try {
        callback(payload);
      } catch (error) {
        console.error('[petAPI] action listener error', error);
      }
    };
    ipcRenderer.on('pet:action', listener);
    return () => {
      ipcRenderer.removeListener('pet:action', listener);
    };
  },
});
