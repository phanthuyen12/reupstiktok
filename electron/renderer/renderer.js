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
const profileFilterTabs = document.querySelectorAll('.profile-filter-tab');
const toggleAll = document.getElementById('toggleAll');
const overlay = document.getElementById('globalOverlay');
const loadingMessage = document.getElementById('loadingMessage');
const modeButtons = document.querySelectorAll('.mode-btn');

const state = {
  filePath: null,
  profiles: [],
  running: new Set(),
  workerState: new Map(),
  selected: new Set(),
  uploads: [],
  mode: 'edit',
  profileFilter: 'all'
};

function normalizeWorkerEntries(entries = []) {
  return entries.map(item => ({
    profileId: item.profileId,
    running: Boolean(item.running),
    mode: item.mode || null,
    status: item.status || (item.running ? 'running' : 'stopped')
  }));
}

function formatChannels(channels) {
  if (!channels.length) return 'Không có channel nào';
  if (channels.length <= 3) return channels.join(', ');
  return `${channels.slice(0, 3).join(', ')} +${channels.length - 3} kênh`;
}

function formatModeLabel(mode) {
  if (mode === 'raw') return 'Không edit';
  return 'Edit videos';
}

function refreshButtons() {
  const hasSelection = state.selected.size > 0;
  startBtn.disabled = !hasSelection;
  stopBtn.disabled = !hasSelection;
  stopAllBtn.disabled = state.running.size === 0;
}

function setLoading(isLoading, message = 'Đang xử lý...') {
  if (!overlay) return;
  if (isLoading) {
    if (loadingMessage) loadingMessage.textContent = message;
    overlay.classList.remove('hidden');
  } else {
    overlay.classList.add('hidden');
  }
}

function getProfileStatus(profileId) {
  const workerMeta = state.workerState.get(profileId);
  if (workerMeta?.status) {
    return workerMeta.status;
  }
  return workerMeta?.running ? 'running' : 'stopped';
}

function filterProfilesByTab(list) {
  return list.filter(profile => {
    const status = getProfileStatus(profile.profileId);
    switch (state.profileFilter) {
      case 'running':
        return status === 'running';
      case 'stopped':
        return status === 'stopped';
      case 'error':
        return status === 'error';
      default:
        return true;
    }
  });
}

function renderProfiles() {
  profilesList.innerHTML = '';
  const displayProfiles = filterProfilesByTab(state.profiles);
  if (!state.profiles.length) {
    profilesList.innerHTML =
      '<div class="profiles-empty">Hãy chọn file profiles.txt để hiển thị danh sách.</div>';
    return;
  }

  if (!displayProfiles.length) {
    profilesList.innerHTML =
      '<div class="profiles-empty">Không có profile nào phù hợp với bộ lọc hiện tại.</div>';
    return;
  }

  const table = document.createElement('div');
  table.classList.add('profiles-table');
  table.innerHTML = `
    <div class="profiles-table__head">
      <div>Chọn</div>
      <div>Profile</div>
      <div>Kênh theo dõi</div>
      <div>API Key</div>
      <div>Trạng thái</div>
    </div>
  `;

  const body = document.createElement('div');
  body.classList.add('profiles-table__body');

  displayProfiles.forEach(profile => {
    const workerMeta = state.workerState.get(profile.profileId) || {};
    const status = getProfileStatus(profile.profileId);
    const running = status === 'running';
    const selected = state.selected.has(profile.profileId);
    const modeLabel = workerMeta.mode ? formatModeLabel(workerMeta.mode) : 'Chưa chạy';

    const row = document.createElement('div');
    row.className = `profiles-table__row status-${status} ${running ? 'running' : ''}`;
    row.innerHTML = `
      <div>
        <label class="checkbox">
          <input type="checkbox" data-profile="${profile.profileId}" ${selected ? 'checked' : ''}/>
        </label>
      </div>
      <div>
        <div class="profile-id">${profile.profileId}</div>
        <div class="profile-meta">
          <span class="profile-mode-badge">${modeLabel}</span>
        </div>
      </div>
      <div class="profile-channels">${formatChannels(profile.channels)}</div>
      <div class="profile-api">${profile.apiKey.substring(0, 8)}...${profile.apiKey.slice(-4)}</div>
      <div class="profile-meta">
        <span class="status-pill ${running ? 'running' : 'idle'}">${running ? 'Đang chạy' : 'Idle'}</span>
      </div>
    `;

    body.appendChild(row);
  });

  table.appendChild(body);
  profilesList.appendChild(table);
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
      <span class="tag">
        Uploaded · [${item.profileId}]${item.totalTime ? ` · ${item.totalTime}s` : ''}
      </span>
    `;

    const body = document.createElement('div');
    body.classList.add('upload-entry-body');
    const timingMeta = [];
    if (item.mode) {
      timingMeta.push(`<span>Chế độ: ${formatModeLabel(item.mode)}</span>`);
    }
    if (typeof item.totalTime === 'number') {
      timingMeta.push(`<span>Tổng thời gian: ${item.totalTime.toFixed(2)}s</span>`);
    }

    const breakdownHtml = item.breakdown
      ? `<div class="timing-grid">
          <span>Link: ${item.breakdown.link}</span>
          <span>Download: ${item.breakdown.download}</span>
          <span>Edit: ${item.breakdown.edit}</span>
          <span>Upload: ${item.breakdown.upload}</span>
        </div>`
      : '';

    body.innerHTML = `
      <div>${item.summary}</div>
      ${item.file ? `<div class="file">${item.file}</div>` : ''}
      ${timingMeta.length ? `<div class="timing-meta">${timingMeta.join('')}</div>` : ''}
      ${breakdownHtml}
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

  state.uploads.push({
    profileId,
    timestamp,
    summary,
    file,
    totalTime: null,
    mode: null,
    breakdown: null
  });
  renderUploadHistory();
}

function handleTimingMessage(payload) {
  const { profileId, message } = payload;
  if (message.includes('Tổng thời gian')) {
    const timeMatch = message.match(/:\s*(\d+\.?\d*)s/);
    const totalTime = timeMatch ? parseFloat(timeMatch[1]) : null;
    const modeMatch = message.match(/\(mode:\s*([^)]+)\)/i);
    const mode = modeMatch ? modeMatch[1].trim().toLowerCase() : null;

    for (let i = state.uploads.length - 1; i >= 0; i--) {
      const item = state.uploads[i];
      if (item.profileId === profileId && item.totalTime == null) {
        if (totalTime !== null) {
          item.totalTime = totalTime;
        }
        if (mode) {
          item.mode = mode;
        }
        break;
      }
    }
    renderUploadHistory();
    return;
  }

  if (message.includes('Chi tiết thời gian')) {
    const extract = label => {
      const regex = new RegExp(`${label}\\s([\\d.]+(?:ms|s))`, 'i');
      const match = message.match(regex);
      return match ? match[1] : '—';
    };

    const breakdown = {
      link: extract('link'),
      download: extract('download'),
      edit: extract('edit'),
      upload: extract('upload')
    };

    for (let i = state.uploads.length - 1; i >= 0; i--) {
      const item = state.uploads[i];
      if (item.profileId === profileId) {
        item.breakdown = breakdown;
        break;
      }
    }
    renderUploadHistory();
  }
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

modeButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const selectedMode = btn.dataset.mode;
    state.mode = selectedMode;
    modeButtons.forEach(b => b.classList.toggle('active', b === btn));
  });
});

profileFilterTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const filter = tab.dataset.filter;
    if (!filter || filter === state.profileFilter) return;
    state.profileFilter = filter;
    updateProfileFilterTabs();
    renderProfiles();
  });
});

function updateProfileFilterTabs() {
  profileFilterTabs.forEach(tab => {
    if (!tab.dataset.filter) return;
    tab.classList.toggle('active', tab.dataset.filter === state.profileFilter);
  });
}

selectFileBtn.addEventListener('click', async () => {
  try {
    setLoading(true, 'Đang đọc file profiles...');
    const result = await window.controlApi.selectProfileFile();
    if (result.canceled) return;
    state.filePath = result.filePath;
    state.profiles = result.profiles || [];
    state.selected.clear();
    state.running.clear();
    fileInfo.textContent = `Đã chọn: ${state.filePath}`;
    renderProfiles();
    refreshButtons();
  } finally {
    setLoading(false);
  }
});

startBtn.addEventListener('click', async () => {
  if (!state.selected.size) return;
  const ids = Array.from(state.selected);
  await window.controlApi.startWorkers({
    profileIds: ids,
    mode: state.mode
  });
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
  handleTimingMessage(payload);
});

window.controlApi.onWorkerState(payload => {
  if (!Array.isArray(payload)) return;
  const normalized = normalizeWorkerEntries(payload);
  state.workerState = new Map(normalized.map(p => [p.profileId, p]));
  state.running = new Set(normalized.filter(p => p.status === 'running').map(p => p.profileId));
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
  if (session.workerState) {
    const normalized = normalizeWorkerEntries(session.workerState);
    state.workerState = new Map(normalized.map(item => [item.profileId, item]));
    state.running = new Set(normalized.filter(item => item.status === 'running').map(item => item.profileId));
  } else if (session.running) {
    state.running = new Set(session.running);
  }
  renderProfiles();
  refreshButtons();
  renderUploadHistory();
  updateProfileFilterTabs();
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

