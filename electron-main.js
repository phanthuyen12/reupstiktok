const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');
const puppeteer = require('puppeteer-core');

let mainWindow;
const workers = new Map(); // profileId -> { worker, status, logs, stats }
const profiles = [];
const profileBrowsers = new Map(); // profileId -> { browser, page, wsEndpoint, logInterval, ready }
const systemLogs = []; // Tất cả logs của hệ thống

// Hàm helper để log tất cả hành động
function logSystem(message, level = 'info', source = 'system') {
  const logEntry = {
    timestamp: new Date().toISOString(),
    message,
    level,
    source
  };
  
  systemLogs.push(logEntry);
  
  // Giới hạn logs để tránh memory leak
  if (systemLogs.length > 10000) {
    systemLogs.splice(0, 5000);
  }
  
  // Gửi log đến renderer
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('system-log', logEntry);
  }
  
  // Console log cho debugging
  console.log(`[${level.toUpperCase()}] [${source}] ${message}`);
}

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
    // Tự động load profiles khi app mở
    loadProfilesOnStart();
  });

  // mainWindow.webContents.openDevTools();
}

// Tự động load profiles khi app mở
async function loadProfilesOnStart() {
  try {
    const profilesPath = path.join(__dirname, 'profiles.txt');
    if (!fs.existsSync(profilesPath)) {
      logSystem('File profiles.txt không tồn tại', 'warning', 'system');
      return;
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

    logSystem(`Đã tự động load ${profiles.length} profiles từ profiles.txt`, 'success', 'system');
    
    // Gửi profiles đến renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('profiles-loaded', { profiles });
    }
  } catch (error) {
    logSystem(`Lỗi khi load profiles: ${error.message}`, 'error', 'system');
  }
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
  // Clear tất cả monitoring intervals
  for (const [profileId, browserData] of profileBrowsers.entries()) {
    if (browserData.logInterval) {
      clearInterval(browserData.logInterval);
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
    logSystem('Đang load profiles từ file...', 'info', 'system');
    const profilesPath = path.join(__dirname, 'profiles.txt');
    if (!fs.existsSync(profilesPath)) {
      logSystem('File profiles.txt không tồn tại', 'error', 'system');
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

    logSystem(`Đã load ${profiles.length} profiles thành công`, 'success', 'system');
    return { success: true, profiles };
  } catch (error) {
    logSystem(`Lỗi khi load profiles: ${error.message}`, 'error', 'system');
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
  return profiles.map(p => {
    const profileId = p.profileId;
    let status = 'stopped';
    
    // Kiểm tra status từ profileBrowsers trước
    if (profileBrowsers.has(profileId)) {
      const browserData = profileBrowsers.get(profileId);
      status = browserData.status || 'opened';
    }
    
    // Nếu có worker đang chạy, status là running
    if (workers.has(profileId)) {
      const workerData = workers.get(profileId);
      if (workerData.status === 'running') {
        status = 'running';
      }
    }
    
    return {
      profileId: profileId,
      channels: p.channels,
      status: status,
      workerPid: workers.has(profileId) ? workers.get(profileId).worker.threadId : null,
      stats: workers.has(profileId) ? workers.get(profileId).stats : {
        totalVideos: 0,
        videosToday: 0,
        avgProcessingTime: 0
      }
    };
  });
});

// Start worker cho profile
ipcMain.handle('start-worker', async (event, profileId) => {
  logSystem(`Bắt đầu start worker cho profile ${profileId}`, 'info', 'worker');
  const profile = profiles.find(p => p.profileId === profileId);
  if (!profile) {
    logSystem(`Profile ${profileId} không tồn tại`, 'error', 'worker');
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
    
    // Gửi vào system logs
    logSystem(msg, 'info', `worker-${profileId}`);

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
  
  logSystem(`Worker đã được start thành công cho profile ${profileId}`, 'success', 'worker');

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

// Mở profile và điều hướng đến TikTok upload, tìm input file (theo testdow.js)
ipcMain.handle('open-profile-tiktok', async (event, profileId) => {
  logSystem(`Bắt đầu mở profile ${profileId} trong Genlogin`, 'info', 'genlogin');
  const Genlogin = require('./Genlogin');
  const gen = new Genlogin('');
  
  try {
    // Gửi log bắt đầu
    logSystem(`Đang mở profile ${profileId} trong Genlogin...`, 'info', 'genlogin');
    mainWindow.webContents.send('profile-log', {
      profileId,
      log: {
        timestamp: new Date().toISOString(),
        message: `🔄 Đang mở profile ${profileId} trong Genlogin...`
      }
    });

    // Lấy wsEndpoint theo testdow.js (retry 15 lần)
    let wsEndpoint;
    for (let i = 0; i < 15; i++) {
      const profile = await gen.runProfile(profileId);
      wsEndpoint = profile.wsEndpoint;
      if (wsEndpoint) break;
      logSystem(`⏳ Chờ profile ${profileId} chạy... retry ${i + 1}`, 'info', 'genlogin');
      await new Promise(r => setTimeout(r, 1000));
    }
    
    if (!wsEndpoint) {
      logSystem(`Profile ${profileId} chưa chạy sau 15 lần retry`, 'error', 'genlogin');
      mainWindow.webContents.send('profile-log', {
        profileId,
        log: {
          timestamp: new Date().toISOString(),
          message: `❌ Không thể mở profile trong Genlogin`
        }
      });
      return { success: false, error: 'Không thể mở profile trong Genlogin' };
    }

    if (!wsEndpoint) {
      mainWindow.webContents.send('profile-log', {
        profileId,
        log: {
          timestamp: new Date().toISOString(),
          message: `❌ Không thể mở profile trong Genlogin`
        }
      });
      return { success: false, error: 'Không thể mở profile trong Genlogin' };
    }

    mainWindow.webContents.send('profile-log', {
      profileId,
      log: {
        timestamp: new Date().toISOString(),
        message: `✅ Profile đã được mở trong Genlogin`
      }
    });

    // Kết nối với browser (theo testdow.js)
    const browser = await puppeteer.connect({
      browserWSEndpoint: wsEndpoint,
      ignoreHTTPSErrors: true,
      defaultViewport: null,
      args: ["--disable-gpu", "--disable-infobars", "--mute-audio", "--window-size=584,716"]
    });

    const pages = await browser.pages();
    const page = pages[0];

    // Điều hướng đến TikTok upload
    mainWindow.webContents.send('profile-log', {
      profileId,
      log: {
        timestamp: new Date().toISOString(),
        message: `🌐 Đang truy cập TikTok upload page...`
      }
    });

    await page.goto("https://www.tiktok.com/tiktokstudio/upload?from=webapp", {
      waitUntil: "networkidle2"
    });

    mainWindow.webContents.send('profile-log', {
      profileId,
      log: {
        timestamp: new Date().toISOString(),
        message: `✅ Đã truy cập TikTok upload page`
      }
    });

    // Tìm input file
    mainWindow.webContents.send('profile-log', {
      profileId,
      log: {
        timestamp: new Date().toISOString(),
        message: `🔍 Đang tìm input file...`
      }
    });

    try {
      const input = await page.waitForSelector('input[type="file"]', { timeout: 15000 });
      
      if (input) {
        mainWindow.webContents.send('profile-log', {
          profileId,
          log: {
            timestamp: new Date().toISOString(),
            message: `✅ Đã tìm thấy input file! Sẵn sàng upload.`
          }
        });

        // Thông báo tím (notification)
        mainWindow.webContents.send('profile-notification', {
          profileId,
          message: `✅ Profile ${profileId}: Đã tìm thấy input file, sẵn sàng upload!`,
          type: 'success'
        });
      }
    } catch (error) {
      mainWindow.webContents.send('profile-log', {
        profileId,
        log: {
          timestamp: new Date().toISOString(),
          message: `❌ Không tìm thấy input file: ${error.message}`
        }
      });
      return { success: false, error: `Không tìm thấy input file: ${error.message}` };
    }

    // Bắt đầu gửi log từng giây (chỉ monitoring, không start worker)
    const logInterval = setInterval(async () => {
      try {
        const url = await page.url();
        const title = await page.title();
        const inputExists = await page.$('input[type="file"]').then(el => !!el).catch(() => false);
        
        mainWindow.webContents.send('profile-log', {
          profileId,
          log: {
            timestamp: new Date().toISOString(),
            message: `📊 [Log theo dõi] URL: ${url} | Title: ${title} | Input file: ${inputExists ? '✅ Có' : '❌ Không'}`
          }
        });
      } catch (error) {
        mainWindow.webContents.send('profile-log', {
          profileId,
          log: {
            timestamp: new Date().toISOString(),
            message: `⚠️ Lỗi khi lấy thông tin: ${error.message}`
          }
        });
      }
    }, 1000); // Mỗi giây

    // Lưu browser instance và logInterval (chưa start worker)
    profileBrowsers.set(profileId, { 
      browser, 
      page, 
      wsEndpoint, 
      logInterval, 
      ready: true,
      status: 'opened'
    });
    
    // Cập nhật status
    if (workers.has(profileId)) {
      workers.get(profileId).status = 'opened';
    }
    
    logSystem(`Profile ${profileId} đã được mở thành công và sẵn sàng upload`, 'success', 'genlogin');
    
    // Gửi status update
    mainWindow.webContents.send('profile-status-update', {
      profileId,
      status: 'opened'
    });

    return { success: true, wsEndpoint };
  } catch (error) {
    logSystem(`Lỗi khi mở profile ${profileId}: ${error.message}`, 'error', 'genlogin');
    mainWindow.webContents.send('profile-log', {
      profileId,
      log: {
        timestamp: new Date().toISOString(),
        message: `❌ Lỗi: ${error.message}`
      }
    });
    return { success: false, error: error.message };
  }
});

// Bắt đầu theo dõi kênh YouTube và upload (sau khi đã mở profile)
ipcMain.handle('start-monitoring', async (event, profileId) => {
  logSystem(`Bắt đầu monitoring cho profile ${profileId}`, 'info', 'worker');
  const profile = profiles.find(p => p.profileId === profileId);
  if (!profile) {
    logSystem(`Profile ${profileId} không tồn tại`, 'error', 'worker');
    return { success: false, error: 'Profile không tồn tại' };
  }

  // Kiểm tra xem profile đã được mở chưa
  if (!profileBrowsers.has(profileId)) {
    logSystem(`Profile ${profileId} chưa được mở. Vui lòng mở profile trước.`, 'error', 'worker');
    return { success: false, error: 'Vui lòng mở profile trước khi bắt đầu theo dõi' };
  }

  const browserData = profileBrowsers.get(profileId);
  if (!browserData || !browserData.ready) {
    logSystem(`Profile ${profileId} chưa sẵn sàng. Browser data: ${JSON.stringify(browserData)}`, 'error', 'worker');
    return { success: false, error: 'Profile chưa sẵn sàng. Vui lòng đợi profile mở xong.' };
  }
  
  if (!browserData.wsEndpoint) {
    logSystem(`Profile ${profileId} không có wsEndpoint`, 'error', 'worker');
    return { success: false, error: 'Profile chưa có wsEndpoint. Vui lòng mở lại profile.' };
  }

  // Kiểm tra xem worker đã chạy chưa
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

  // Start worker với wsEndpoint đã có sẵn
  const wsEndpoint = browserData.wsEndpoint;
  
  // Log thông tin profile trước khi start worker
  logSystem(`Bắt đầu worker cho profile ${profileId} với API Key: ${profile.apiKey ? profile.apiKey.substring(0, 10) + '...' + profile.apiKey.substring(profile.apiKey.length - 5) : 'KHÔNG CÓ'}`, 'info', 'worker');
  logSystem(`Profile ${profileId} có ${profile.channels ? profile.channels.length : 0} kênh YouTube: ${profile.channels ? profile.channels.join(', ') : 'KHÔNG CÓ'}`, 'info', 'worker');
  
  const worker = new Worker(path.join(__dirname, 'worker.js'), {
    workerData: {
      profileId: profile.profileId,
      apiKey: profile.apiKey,
      channels: profile.channels || [],
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
    
    // Gửi vào system logs
    logSystem(msg, 'info', `worker-${profileId}`);

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
  
  // Cập nhật status
  browserData.status = 'monitoring';
  if (workers.has(profileId)) {
    workers.get(profileId).status = 'running';
  }

  mainWindow.webContents.send('profile-log', {
    profileId,
    log: {
      timestamp: new Date().toISOString(),
      message: `🚀 Đã bắt đầu theo dõi kênh YouTube và upload tự động 24/7`
    }
  });
  
  // Gửi status update
  mainWindow.webContents.send('profile-status-update', {
    profileId,
    status: 'running'
  });
  
  logSystem(`Đã bắt đầu monitoring thành công cho profile ${profileId}`, 'success', 'worker');

  return { success: true, workerId: worker.threadId };
});

// Dừng theo dõi (stop monitoring nhưng giữ profile mở)
ipcMain.handle('stop-monitoring', async (event, profileId) => {
  logSystem(`Dừng monitoring cho profile ${profileId}`, 'info', 'worker');
  
  if (!workers.has(profileId)) {
    return { success: false, error: 'Worker không đang chạy' };
  }

  const workerData = workers.get(profileId);
  if (workerData.worker) {
    await workerData.worker.terminate();
  }

  workerData.status = 'stopped';
  
  // Cập nhật status trong profileBrowsers
  if (profileBrowsers.has(profileId)) {
    profileBrowsers.get(profileId).status = 'opened';
  }
  
  // Gửi status update
  mainWindow.webContents.send('profile-status-update', {
    profileId,
    status: 'opened'
  });
  
  logSystem(`Đã dừng monitoring cho profile ${profileId}`, 'success', 'worker');
  
  return { success: true };
});

// Đóng profile (đóng browser và dừng monitoring)
ipcMain.handle('close-profile', async (event, profileId) => {
  logSystem(`Đóng profile ${profileId}`, 'info', 'genlogin');
  
  // Dừng worker nếu đang chạy
  if (workers.has(profileId)) {
    const workerData = workers.get(profileId);
    if (workerData.worker) {
      await workerData.worker.terminate();
    }
    workerData.status = 'stopped';
  }
  
  // Đóng browser và clear monitoring
  if (profileBrowsers.has(profileId)) {
    const browserData = profileBrowsers.get(profileId);
    
    // Clear log interval
    if (browserData.logInterval) {
      clearInterval(browserData.logInterval);
    }
    
    // Disconnect browser
    try {
      if (browserData.browser) {
        await browserData.browser.disconnect();
      }
    } catch (error) {
      logSystem(`Lỗi khi disconnect browser: ${error.message}`, 'warning', 'genlogin');
    }
    
    profileBrowsers.delete(profileId);
  }
  
  // Stop profile trong Genlogin
  try {
    const Genlogin = require('./Genlogin');
    const gen = new Genlogin('');
    await gen.stopProfile(profileId);
  } catch (error) {
    logSystem(`Lỗi khi stop profile trong Genlogin: ${error.message}`, 'warning', 'genlogin');
  }
  
  // Gửi status update
  mainWindow.webContents.send('profile-status-update', {
    profileId,
    status: 'stopped'
  });
  
  logSystem(`Đã đóng profile ${profileId}`, 'success', 'genlogin');
  
  return { success: true };
});

// Dừng theo dõi profile (giữ lại để tương thích)
ipcMain.handle('stop-profile-monitoring', async (event, profileId) => {
  if (profileBrowsers.has(profileId)) {
    const browserData = profileBrowsers.get(profileId);
    if (browserData.logInterval) {
      clearInterval(browserData.logInterval);
    }
    // Không disconnect browser vì có thể đang được worker sử dụng
    profileBrowsers.delete(profileId);
    return { success: true };
  }
  return { success: false, error: 'Profile không đang được theo dõi' };
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

// Lấy tất cả system logs
ipcMain.handle('get-system-logs', () => {
  return systemLogs;
});

// Clear system logs
ipcMain.handle('clear-system-logs', () => {
  systemLogs.length = 0;
  logSystem('Đã xóa tất cả system logs', 'info', 'system');
  return { success: true };
});

