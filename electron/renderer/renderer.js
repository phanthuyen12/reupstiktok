const selectFileBtn = document.getElementById('selectFileBtn');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const stopAllBtn = document.getElementById('stopAllBtn');
const clearLogsBtn = document.getElementById('clearLogsBtn');
const fileInfo = document.getElementById('fileInfo');
const profilesList = document.getElementById('profilesList');
const logStream = document.getElementById('logStream');
const toggleAll = document.getElementById('toggleAll');

const state = {
  filePath: null,
  profiles: [],
  running: new Set(),
  selected: new Set()
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
});

window.controlApi.onLogMessage(payload => {
  appendLog(payload);
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
}

bootstrap();

