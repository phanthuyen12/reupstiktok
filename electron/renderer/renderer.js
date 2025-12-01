const selectFileBtn = document.getElementById('selectFileBtn');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const stopAllBtn = document.getElementById('stopAllBtn');
const clearLogsBtn = document.getElementById('clearLogsBtn');
const fileInfo = document.getElementById('fileInfo');
const profilesList = document.getElementById('profilesList');
const logStream = document.getElementById('logStream');
const uploadLog = document.getElementById('uploadLog');
const logTabs = document.querySelectorAll('.log-tab');
const toggleAll = document.getElementById('toggleAll');

const state = {
  filePath: null,
  profiles: [],
  running: new Set(),
  selected: new Set(),
  uploads: []
};

function formatChannels(channels) {
  if (!channels.length) return 'Không có channel nào';
  if (channels.length <= 3) return channels.join(', ');
  return `${channels.slice(0, 3).join(', ')} +${channels.length - 3} kênh`;
}

function refreshButtons() {
  const hasSelection = state.selected.size > 0;
  startBtn.disabled = !hasSelection;
  stopBtn.disabled = !hasSelection;
  stopAllBtn.disabled = state.running.size === 0;
}

function renderProfiles() {
  profilesList.innerHTML = '';
  if (!state.profiles.length) {
    profilesList.innerHTML =
      '<div class="file-info">Hãy chọn file profiles.txt để hiển thị danh sách.</div>';
    return;
  }

  state.profiles.forEach(profile => {
    const card = document.createElement('div');
    card.classList.add('profile-card');
    const running = state.running.has(profile.profileId);
    if (running) {
      card.classList.add('running');
    }

    const left = document.createElement('div');
    left.classList.add('profile-info');
    left.innerHTML = `
      <h3>${profile.profileId}</h3>
      <p>API Key: ${profile.apiKey.substring(0, 8)}... | Channels: ${formatChannels(profile.channels)}</p>
    `;

    const right = document.createElement('div');
    right.classList.add('profile-meta');
    right.innerHTML = `
      <label class="checkbox">
        <input type="checkbox" data-profile="${profile.profileId}" ${state.selected.has(profile.profileId) ? 'checked' : ''}/>
      </label>
      <span class="status-pill ${running ? 'running' : 'idle'}">${running ? 'Đang chạy' : 'Idle'}</span>
    `;

    card.appendChild(left);
    card.appendChild(right);
    profilesList.appendChild(card);
  });
}

function appendLog({ profileId, message, timestamp }) {
  const entry = document.createElement('div');
  entry.classList.add('log-entry');
  entry.innerHTML = `
    <span class="meta">${new Date(timestamp).toLocaleTimeString()}</span>
    <span class="profile-tag">[${profileId}]</span>
    <span class="content">${message}</span>
  `;
  logStream.appendChild(entry);
  logStream.scrollTop = logStream.scrollHeight;
}

function renderUploadHistory() {
  uploadLog.innerHTML = '';
  if (!state.uploads.length) {
    uploadLog.innerHTML =
      '<div class="log-entry">Chưa có video nào được upload trong phiên này.</div>';
    return;
  }

  state.uploads.forEach(item => {
    const wrapper = document.createElement('div');
    wrapper.classList.add('upload-entry');

    const header = document.createElement('div');
    header.classList.add('upload-entry-header');
    header.innerHTML = `
      <span>${new Date(item.timestamp).toLocaleTimeString()}</span>
      <span class="tag">Uploaded · [${item.profileId}]</span>
    `;

    const body = document.createElement('div');
    body.classList.add('upload-entry-body');
    body.innerHTML = `
      <div>${item.summary}</div>
      ${item.file ? `<div class="file">${item.file}</div>` : ''}
    `;

    wrapper.appendChild(header);
    wrapper.appendChild(body);
    uploadLog.appendChild(wrapper);
  });
}

function handleUploadMessage(payload) {
  const { profileId, message, timestamp } = payload;

  // Chỉ bắt các log có nội dung upload thành công
  if (!message.includes('✅ Upload xong')) {
    return;
  }

  // Message ví dụ: `[25141883] ✅ Upload xong: title → /path/to/file.mp4`
  const parts = message.split('✅ Upload xong:');
  let summary = message.trim();
  let file = null;

  if (parts.length > 1) {
    summary = parts[1].trim();
    const arrowIdx = summary.lastIndexOf('→');
    if (arrowIdx !== -1) {
      file = summary.slice(arrowIdx + 1).trim();
      summary = summary.slice(0, arrowIdx).trim();
    }
  }

  state.uploads.push({ profileId, timestamp, summary, file });
  renderUploadHistory();
}

profilesList.addEventListener('change', event => {
  const checkbox = event.target;
  if (checkbox.dataset.profile) {
    const profileId = checkbox.dataset.profile;
    if (checkbox.checked) {
      state.selected.add(profileId);
    } else {
      state.selected.delete(profileId);
    }
    refreshButtons();
  }
});

toggleAll.addEventListener('change', event => {
  if (!state.profiles.length) return;
  if (event.target.checked) {
    state.profiles.forEach(profile => state.selected.add(profile.profileId));
  } else {
    state.selected.clear();
  }
  renderProfiles();
  refreshButtons();
});

selectFileBtn.addEventListener('click', async () => {
  const result = await window.controlApi.selectProfileFile();
  if (result.canceled) return;
  state.filePath = result.filePath;
  state.profiles = result.profiles || [];
  state.selected.clear();
  state.running.clear();
  fileInfo.textContent = `Đã chọn: ${state.filePath}`;
  renderProfiles();
  refreshButtons();
});

startBtn.addEventListener('click', async () => {
  if (!state.selected.size) return;
  const ids = Array.from(state.selected);
  await window.controlApi.startWorkers(ids);
});

stopBtn.addEventListener('click', async () => {
  if (!state.selected.size) return;
  const ids = Array.from(state.selected);
  await window.controlApi.stopWorkers(ids);
});

stopAllBtn.addEventListener('click', async () => {
  await window.controlApi.stopAllWorkers();
});

clearLogsBtn.addEventListener('click', () => {
  logStream.innerHTML = '';
  uploadLog.innerHTML = '';
  state.uploads = [];
});

window.controlApi.onLogMessage(payload => {
  appendLog(payload);
  handleUploadMessage(payload);
});

window.controlApi.onWorkerState(payload => {
  state.running = new Set(payload.filter(p => p.running).map(p => p.profileId));
  refreshButtons();
  renderProfiles();
});

async function bootstrap() {
  const session = await window.controlApi.getSessionState();
  if (session.filePath) {
    state.filePath = session.filePath;
    fileInfo.textContent = `Đã chọn: ${state.filePath}`;
  }
  if (session.profiles) {
    state.profiles = session.profiles;
  }
  if (session.running) {
    state.running = new Set(session.running);
  }
  renderProfiles();
  refreshButtons();
  renderUploadHistory();
}

bootstrap();

// Tabs chuyển đổi giữa log realtime và lịch sử upload
logTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    logTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    const target = tab.dataset.tab;
    document.querySelectorAll('.log-view').forEach(view => {
      if (view.id === 'logStream' && target === 'realtime') {
        view.classList.add('active');
      } else if (view.id === 'uploadLog' && target === 'uploads') {
        view.classList.add('active');
      } else {
        view.classList.remove('active');
      }
    });
  });
});

