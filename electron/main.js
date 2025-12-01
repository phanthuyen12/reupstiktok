const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');

let mainWindow;
let profilesFilePath = null;
let loadedProfiles = [];
let isQuitting = false;
const workers = new Map(); // profileId -> worker instance

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#1f1f1f',
    title: 'ReUp TikTok Control Center',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function parseProfiles(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));

  return lines
    .map(line => {
      const parts = line.split('|').map(p => p.trim());
      if (parts.length < 3) {
        logToRenderer(`❌ Sai cấu trúc dòng (thiếu profileId|apiKey|channels): ${line}`, 'system');
        return null;
      }
      return {
        profileId: parts[0],
        apiKey: parts[1],
        channels: parts[2] ? parts[2].split(',').map(c => c.trim()).filter(Boolean) : []
      };
    })
    .filter(Boolean);
}

function logToRenderer(message, profileId = 'system') {
  if (!mainWindow) return;
  mainWindow.webContents.send('log-message', {
    profileId,
    message,
    timestamp: new Date().toISOString()
  });
}

function broadcastWorkerState() {
  if (!mainWindow) return;
  const state = loadedProfiles.map(profile => ({
    profileId: profile.profileId,
    running: workers.has(profile.profileId)
  }));
  mainWindow.webContents.send('worker-state', state);
}

function startWorker(profile) {
  if (workers.has(profile.profileId)) {
    return;
  }

  const workerPath = path.join(app.getAppPath(), 'worker.js');
  const worker = new Worker(workerPath, { workerData: profile });

  workers.set(profile.profileId, worker);
  logToRenderer(`🚀 Worker started`, profile.profileId);
  broadcastWorkerState();

  worker.on('message', msg => logToRenderer(msg, profile.profileId));
  worker.on('error', err => {
    logToRenderer(`❌ Worker error: ${err.message}`, profile.profileId);
  });
  worker.on('exit', code => {
    logToRenderer(`⚠️ Worker exited with code ${code}`, profile.profileId);
    workers.delete(profile.profileId);
    broadcastWorkerState();
  });
}

async function stopWorker(profileId) {
  const worker = workers.get(profileId);
  if (!worker) return;
  await worker.terminate();
  logToRenderer(`⛔ Worker stopped`, profileId);
  workers.delete(profileId);
  broadcastWorkerState();
}

async function stopAllWorkers() {
  const stops = Array.from(workers.keys()).map(id => stopWorker(id));
  await Promise.allSettled(stops);
}

ipcMain.handle('select-profile-file', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Chọn file profiles.txt',
    filters: [
      { name: 'Text files', extensions: ['txt'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  });

  if (result.canceled || !result.filePaths.length) {
    return { canceled: true };
  }

  try {
    profilesFilePath = result.filePaths[0];
    loadedProfiles = parseProfiles(profilesFilePath);
    logToRenderer(`📄 Loaded ${loadedProfiles.length} profiles từ ${profilesFilePath}`);
    broadcastWorkerState();
    return {
      canceled: false,
      filePath: profilesFilePath,
      profiles: loadedProfiles
    };
  } catch (err) {
    logToRenderer(`❌ Không thể đọc file: ${err.message}`);
    return { canceled: true, error: err.message };
  }
});

ipcMain.handle('start-workers', (_event, profileIds) => {
  if (!loadedProfiles.length) {
    return { ok: false, message: 'Chưa load profiles.txt' };
  }
  profileIds.forEach(id => {
    const profile = loadedProfiles.find(p => p.profileId === id);
    if (profile) {
      startWorker(profile);
    }
  });
  return { ok: true };
});

ipcMain.handle('stop-workers', async (_event, profileIds) => {
  await Promise.all(profileIds.map(id => stopWorker(id)));
  return { ok: true };
});

ipcMain.handle('stop-all-workers', async () => {
  await stopAllWorkers();
  return { ok: true };
});

ipcMain.handle('get-session-state', () => {
  return {
    profilesFilePath,
    profiles: loadedProfiles,
    running: Array.from(workers.keys())
  };
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', async event => {
  if (isQuitting || workers.size === 0) {
    return;
  }
  event.preventDefault();
  isQuitting = true;
  await stopAllWorkers();
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

