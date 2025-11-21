import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('petAPI', {
  getSettings: () => ipcRenderer.invoke('pet:getSettings'),
  updateSettings: (patch) => ipcRenderer.invoke('pet:updateSettings', patch),
  setIgnoreMouse: (ignore) => ipcRenderer.invoke('pet:setIgnoreMouse', ignore),
  moveWindow: (pos) => ipcRenderer.invoke('pet:moveWindow', pos),
  checkForUpdates: () => ipcRenderer.invoke('pet:checkForUpdates'),
  onUpdateStatus: (cb) => ipcRenderer.on('pet:updateStatus', (_e, data) => cb(data))
});
