import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('petAPI', {
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
