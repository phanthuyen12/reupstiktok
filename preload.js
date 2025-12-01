const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Profiles
  loadProfiles: () => ipcRenderer.invoke('load-profiles'),
  selectProfilesFile: () => ipcRenderer.invoke('select-profiles-file'),
  getProfiles: () => ipcRenderer.invoke('get-profiles'),

  // Workers
  startWorker: (profileId) => ipcRenderer.invoke('start-worker', profileId),
  stopWorker: (profileId) => ipcRenderer.invoke('stop-worker', profileId),
  stopAllWorkers: () => ipcRenderer.invoke('stop-all-workers'),

  // Logs
  getWorkerLogs: (profileId) => ipcRenderer.invoke('get-worker-logs', profileId),
  onWorkerLog: (callback) => {
    ipcRenderer.on('worker-log', (event, data) => callback(data));
  },
  onWorkerStatsUpdate: (callback) => {
    ipcRenderer.on('worker-stats-update', (event, data) => callback(data));
  },
  onWorkerError: (callback) => {
    ipcRenderer.on('worker-error', (event, data) => callback(data));
  },
  onWorkerExit: (callback) => {
    ipcRenderer.on('worker-exit', (event, data) => callback(data));
  },

  // Genlogin
  openProfile: (profileId) => ipcRenderer.invoke('open-profile', profileId),
  openProfilesBatch: (profileIds) => ipcRenderer.invoke('open-profiles-batch', profileIds),
  openProfileTiktok: (profileId) => ipcRenderer.invoke('open-profile-tiktok', profileId),

  startMonitoring: (profileId) => ipcRenderer.invoke('start-monitoring', profileId),
  stopMonitoring: (profileId) => ipcRenderer.invoke('stop-monitoring', profileId),
  closeProfile: (profileId) => ipcRenderer.invoke('close-profile', profileId),
  stopProfileMonitoring: (profileId) => ipcRenderer.invoke('stop-profile-monitoring', profileId),

  // Profile logs (theo dõi từng giây)
  onProfileLog: (callback) => {
    ipcRenderer.on('profile-log', (event, data) => callback(data));
  },
  onProfileNotification: (callback) => {
    ipcRenderer.on('profile-notification', (event, data) => callback(data));
  },
  onProfileStatusUpdate: (callback) => {
    ipcRenderer.on('profile-status-update', (event, data) => callback(data));
  },
  onProfilesLoaded: (callback) => {
    ipcRenderer.on('profiles-loaded', (event, data) => callback(data));
  },

  // Analytics
  getAnalytics: () => ipcRenderer.invoke('get-analytics'),

  // System Logs
  getSystemLogs: () => ipcRenderer.invoke('get-system-logs'),
  clearSystemLogs: () => ipcRenderer.invoke('clear-system-logs'),
  onSystemLog: (callback) => {
    ipcRenderer.on('system-log', (event, data) => callback(data));
  },

  // Remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});

