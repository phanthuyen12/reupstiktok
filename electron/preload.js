const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('controlApi', {
  selectProfileFile: () => ipcRenderer.invoke('select-profile-file'),
  startWorkers: profileIds => ipcRenderer.invoke('start-workers', profileIds),
  stopWorkers: profileIds => ipcRenderer.invoke('stop-workers', profileIds),
  stopAllWorkers: () => ipcRenderer.invoke('stop-all-workers'),
  getSessionState: () => ipcRenderer.invoke('get-session-state'),
  onLogMessage: callback => {
    ipcRenderer.removeAllListeners('log-message');
    ipcRenderer.on('log-message', (_event, payload) => callback(payload));
  },
  onWorkerState: callback => {
    ipcRenderer.removeAllListeners('worker-state');
    ipcRenderer.on('worker-state', (_event, payload) => callback(payload));
  }
});

