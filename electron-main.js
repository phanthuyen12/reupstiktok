const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');

let mainWindow;
const workers = new Map(); // profileId -> { worker, status, logs, stats }
const profiles = [];

// Tạo cửa sổ chính
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    titleBarStyle: 'hiddenInset',
    frame: true,
    show: false
  });

  mainWindow.loadFile('renderer/index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Dừng tất cả workers trước khi thoát
  for (const [profileId, workerData] of workers.entries()) {
    if (workerData.worker) {
      workerData.worker.terminate();
    }
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers

// Load profiles từ file
ipcMain.handle('load-profiles', async () => {
  try {
    const profilesPath = path.join(__dirname, 'profiles.txt');
    if (!fs.existsSync(profilesPath)) {
      return { success: false, error: 'File profiles.txt không tồn tại' };
    }

    const raw = fs.readFileSync(profilesPath, 'utf8');
    const lines = raw
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));

    profiles.length = 0;
    for (const line of lines) {
      const parts = line.split('|').map(p => p.trim());
      if (parts.length < 3) {
        console.error('❌ Sai cấu trúc dòng:', line);
        continue;
      }

      const profileId = parts[0];
      const apiKey = parts[1];
      const channels = parts[2] ? parts[2].split(',').map(c => c.trim()).filter(Boolean) : [];

      profiles.push({ profileId, apiKey, channels });
    }

    return { success: true, profiles };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Chọn file profiles.txt
ipcMain.handle('select-profiles-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Text Files', extensions: ['txt'] }]
  });

  if (!result.canceled && result.filePaths.length > 0) {
    try {
      const filePath = result.filePaths[0];
      const raw = fs.readFileSync(filePath, 'utf8');
      const lines = raw
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#'));

      profiles.length = 0;
      for (const line of lines) {
        const parts = line.split('|').map(p => p.trim());
        if (parts.length < 3) continue;

        const profileId = parts[0];
        const apiKey = parts[1];
        const channels = parts[2] ? parts[2].split(',').map(c => c.trim()).filter(Boolean) : [];

        profiles.push({ profileId, apiKey, channels });
      }

      // Copy vào profiles.txt trong project
      fs.writeFileSync(path.join(__dirname, 'profiles.txt'), raw);

      return { success: true, profiles };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  return { success: false, canceled: true };
});

// Lấy danh sách profiles
ipcMain.handle('get-profiles', () => {
  return profiles.map(p => ({
    profileId: p.profileId,
    channels: p.channels,
    status: workers.has(p.profileId) ? workers.get(p.profileId).status : 'stopped',
    workerPid: workers.has(p.profileId) ? workers.get(p.profileId).worker.threadId : null,
    stats: workers.has(p.profileId) ? workers.get(p.profileId).stats : {
      totalVideos: 0,
      videosToday: 0,
      avgProcessingTime: 0
    }
  }));
});

// Start worker cho profile
ipcMain.handle('start-worker', async (event, profileId) => {
  const profile = profiles.find(p => p.profileId === profileId);
  if (!profile) {
    return { success: false, error: 'Profile không tồn tại' };
  }

  if (workers.has(profileId)) {
    const workerData = workers.get(profileId);
    if (workerData.status === 'running') {
      return { success: false, error: 'Worker đã đang chạy' };
    }
    // Terminate worker cũ nếu có
    if (workerData.worker) {
      workerData.worker.terminate();
    }
  }

  // Bước 1: Mở profile trong Genlogin trước
  const Genlogin = require('./Genlogin.js');
  const gen = new Genlogin('');
  
  let wsEndpoint;
  try {
    // Gửi thông báo đang mở profile
    mainWindow.webContents.send('worker-log', {
      profileId,
      log: {
        timestamp: new Date().toISOString(),
        message: `[${profileId}] 🔄 Đang mở profile trong Genlogin...`
      }
    });
    
    // Thử lấy wsEndpoint (có thể profile đã mở sẵn)
    const endpointResult = await gen.getWsEndpoint(profileId);
    if (endpointResult?.data?.wsEndpoint) {
      wsEndpoint = endpointResult.data.wsEndpoint;
    } else {
      // Nếu chưa mở, mở profile
      const result = await gen.runProfile(profileId);
      if (result.success && result.wsEndpoint) {
        wsEndpoint = result.wsEndpoint;
      } else {
        // Retry với delay
        for (let i = 0; i < 15; i++) {
          const retryResult = await gen.runProfile(profileId);
          if (retryResult.success && retryResult.wsEndpoint) {
            wsEndpoint = retryResult.wsEndpoint;
            break;
          }
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }

    if (!wsEndpoint) {
      return { success: false, error: 'Không thể mở profile trong Genlogin. Vui lòng kiểm tra Genlogin đã chạy chưa.' };
    }

    // Gửi thông báo mở profile thành công
    mainWindow.webContents.send('worker-log', {
      profileId,
      log: {
        timestamp: new Date().toISOString(),
        message: `[${profileId}] ✅ Profile đã được mở trong Genlogin`
      }
    });
  } catch (error) {
    return { success: false, error: `Lỗi khi mở profile: ${error.message}` };
  }

  // Bước 2: Start worker với wsEndpoint
  const worker = new Worker(path.join(__dirname, 'worker.js'), {
    workerData: {
      ...profile,
      wsEndpoint: wsEndpoint
    }
  });

  const workerDataObj = {
    worker,
    status: 'running',
    logs: [],
    stats: {
      totalVideos: 0,
      videosToday: 0,
      avgProcessingTime: 0,
      processingTimes: []
    },
    startTime: Date.now(),
    wsEndpoint: wsEndpoint
  };

  worker.on('message', (msg) => {
    workerDataObj.logs.push({
      timestamp: new Date().toISOString(),
      message: msg
    });

    // Giới hạn logs để tránh memory leak
    if (workerDataObj.logs.length > 1000) {
      workerDataObj.logs = workerDataObj.logs.slice(-500);
    }

    // Parse stats từ messages
    if (msg.includes('✅ Upload xong')) {
      workerDataObj.stats.totalVideos++;
      workerDataObj.stats.videosToday++;
    }

    if (msg.includes('Tổng thời gian')) {
      const match = msg.match(/(\d+\.?\d*)s/);
      if (match) {
        const time = parseFloat(match[1]);
        workerDataObj.stats.processingTimes.push(time);
        if (workerDataObj.stats.processingTimes.length > 100) {
          workerDataObj.stats.processingTimes = workerDataObj.stats.processingTimes.slice(-50);
        }
        const sum = workerDataObj.stats.processingTimes.reduce((a, b) => a + b, 0);
        workerDataObj.stats.avgProcessingTime = sum / workerDataObj.stats.processingTimes.length;
      }
    }

    // Gửi log đến renderer
    mainWindow.webContents.send('worker-log', {
      profileId,
      log: {
        timestamp: new Date().toISOString(),
        message: msg
      }
    });

    // Gửi stats update
    mainWindow.webContents.send('worker-stats-update', {
      profileId,
      stats: workerDataObj.stats
    });
  });

  worker.on('error', (err) => {
    workerDataObj.status = 'error';
    workerDataObj.logs.push({
      timestamp: new Date().toISOString(),
      message: `❌ Worker error: ${err.message}`
    });

    mainWindow.webContents.send('worker-error', {
      profileId,
      error: err.message
    });
  });

  worker.on('exit', (code) => {
    if (code !== 0) {
      workerDataObj.status = 'error';
    } else {
      workerDataObj.status = 'stopped';
    }

    mainWindow.webContents.send('worker-exit', {
      profileId,
      code
    });
  });

  workers.set(profileId, workerDataObj);

  return { success: true, workerId: worker.threadId };
});

// Stop worker
ipcMain.handle('stop-worker', async (event, profileId) => {
  if (!workers.has(profileId)) {
    return { success: false, error: 'Worker không tồn tại' };
  }

  const workerData = workers.get(profileId);
  if (workerData.worker) {
    await workerData.worker.terminate();
  }

  workerData.status = 'stopped';
  return { success: true };
});

// Stop all workers
ipcMain.handle('stop-all-workers', async () => {
  const promises = [];
  for (const [profileId, workerData] of workers.entries()) {
    if (workerData.worker) {
      promises.push(workerData.worker.terminate());
    }
    workerData.status = 'stopped';
  }
  await Promise.all(promises);
  return { success: true };
});

// Lấy logs của worker
ipcMain.handle('get-worker-logs', (event, profileId) => {
  if (!workers.has(profileId)) {
    return [];
  }
  return workers.get(profileId).logs;
});

// Mở profile trong Genlogin
ipcMain.handle('open-profile', async (event, profileId) => {
  const Genlogin = require('./Genlogin');
  const gen = new Genlogin('');
  
  try {
    const result = await gen.runProfile(profileId);
    return { success: result.success || !!result.wsEndpoint, wsEndpoint: result.wsEndpoint };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Mở nhiều profiles
ipcMain.handle('open-profiles-batch', async (event, profileIds) => {
  const Genlogin = require('./Genlogin');
  const gen = new Genlogin('');
  const results = [];

  for (const profileId of profileIds) {
    try {
      const result = await gen.runProfile(profileId);
      results.push({
        profileId,
        success: result.success || !!result.wsEndpoint,
        wsEndpoint: result.wsEndpoint
      });
      // Delay giữa các profile
      await new Promise(r => setTimeout(r, 1000));
    } catch (error) {
      results.push({
        profileId,
        success: false,
        error: error.message
      });
    }
  }

  return results;
});

// Lấy stats tổng hợp
ipcMain.handle('get-analytics', () => {
  const analytics = {
    totalProfiles: profiles.length,
    runningWorkers: 0,
    totalVideos: 0,
    videosToday: 0,
    avgProcessingTime: 0,
    profiles: []
  };

  for (const [profileId, workerData] of workers.entries()) {
    if (workerData.status === 'running') {
      analytics.runningWorkers++;
    }
    analytics.totalVideos += workerData.stats.totalVideos;
    analytics.videosToday += workerData.stats.videosToday;

    analytics.profiles.push({
      profileId,
      status: workerData.status,
      stats: workerData.stats
    });
  }

  // Tính avg processing time
  const allTimes = [];
  for (const workerData of workers.values()) {
    allTimes.push(...workerData.stats.processingTimes);
  }
  if (allTimes.length > 0) {
    analytics.avgProcessingTime = allTimes.reduce((a, b) => a + b, 0) / allTimes.length;
  }

  return analytics;
});

