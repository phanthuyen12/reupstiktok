// State
let profiles = [];
let filteredProfiles = [];
let selectedProfiles = new Set();
let currentPage = 1;
let itemsPerPage = 25;
let sortColumn = null;
let sortDirection = 'asc';
let currentLogProfileId = null;

// DOM Elements
const profilesTbody = document.getElementById('profiles-tbody');
const searchInput = document.getElementById('search-input');
const statusFilter = document.getElementById('status-filter');
const selectAllCheckbox = document.getElementById('select-all');
const runningCountEl = document.getElementById('running-count');
const totalVideosEl = document.getElementById('total-videos');
const profileDrawer = document.getElementById('profile-drawer');
const logPanel = document.getElementById('log-panel');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  loadProfiles();
  setupIPCListeners();
  updateStats();
});

// Event Listeners
function setupEventListeners() {
  // Navigation
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      // Handle navigation if needed
    });
  });

  // Action buttons
  document.getElementById('btn-load-profiles').addEventListener('click', handleLoadProfiles);
  document.getElementById('btn-analytics').addEventListener('click', showAnalytics);
  document.getElementById('btn-open-profiles').addEventListener('click', handleOpenProfilesBatch);
  document.getElementById('btn-start-workers').addEventListener('click', handleStartWorkers);
  document.getElementById('btn-stop-all').addEventListener('click', handleStopAll);

  // Table controls
  searchInput.addEventListener('input', handleSearch);
  statusFilter.addEventListener('change', handleFilter);
  selectAllCheckbox.addEventListener('change', handleSelectAll);

  // Table sorting
  document.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => handleSort(th.dataset.sort));
  });

  // Pagination
  document.getElementById('prev-page').addEventListener('click', () => changePage(-1));
  document.getElementById('next-page').addEventListener('click', () => changePage(1));

  // Drawer
  document.getElementById('close-drawer').addEventListener('click', closeDrawer);

  // Log panel
  document.getElementById('close-log-panel').addEventListener('click', closeLogPanel);
  document.getElementById('copy-logs').addEventListener('click', copyLogs);
  document.getElementById('clear-logs').addEventListener('click', clearLogs);

  // Modals
  document.getElementById('close-analytics').addEventListener('click', closeModal);
  document.getElementById('close-batch-open').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', closeModal);
}

// IPC Listeners
function setupIPCListeners() {
  window.electronAPI.onWorkerLog((data) => {
    if (data.profileId === currentLogProfileId) {
      addLogEntry(data.log);
    }
    // Update table if needed
    refreshProfiles();
  });

  window.electronAPI.onWorkerStatsUpdate((data) => {
    updateProfileStats(data.profileId, data.stats);
    updateStats();
  });

  window.electronAPI.onWorkerError((data) => {
    if (data.profileId === currentLogProfileId) {
      addLogEntry({
        timestamp: new Date().toISOString(),
        message: `❌ Error: ${data.error}`
      }, 'error');
    }
    refreshProfiles();
  });

  window.electronAPI.onWorkerExit((data) => {
    refreshProfiles();
    updateStats();
  });
}

// Load Profiles
async function loadProfiles() {
  try {
    const result = await window.electronAPI.loadProfiles();
    if (result.success) {
      profiles = result.profiles;
      filteredProfiles = [...profiles];
      renderTable();
      updateStats();
    } else {
      showNotification('Error loading profiles: ' + result.error, 'error');
    }
  } catch (error) {
    showNotification('Failed to load profiles: ' + error.message, 'error');
  }
}

async function handleLoadProfiles() {
  try {
    const result = await window.electronAPI.selectProfilesFile();
    if (result.success) {
      profiles = result.profiles;
      filteredProfiles = [...profiles];
      renderTable();
      updateStats();
      showNotification('Profiles loaded successfully!', 'success');
    } else if (!result.canceled) {
      showNotification('Error loading profiles: ' + result.error, 'error');
    }
  } catch (error) {
    showNotification('Failed to load profiles: ' + error.message, 'error');
  }
}

// Render Table
async function renderTable() {
  // Get current profiles with status
  const profilesWithStatus = await Promise.all(
    filteredProfiles.map(async (profile) => {
      const allProfiles = await window.electronAPI.getProfiles();
      const profileData = allProfiles.find(p => p.profileId === profile.profileId);
      return {
        ...profile,
        status: profileData?.status || 'stopped',
        workerPid: profileData?.workerPid || null,
        stats: profileData?.stats || { totalVideos: 0, videosToday: 0, avgProcessingTime: 0 }
      };
    })
  );

  // Sort
  if (sortColumn) {
    profilesWithStatus.sort((a, b) => {
      let aVal = a[sortColumn];
      let bVal = b[sortColumn];

      if (sortColumn === 'channels') {
        aVal = a.channels.length;
        bVal = b.channels.length;
      }

      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = bVal.toLowerCase();
      }

      if (sortDirection === 'asc') {
        return aVal > bVal ? 1 : -1;
      } else {
        return aVal < bVal ? 1 : -1;
      }
    });
  }

  // Paginate
  const start = (currentPage - 1) * itemsPerPage;
  const end = start + itemsPerPage;
  const paginatedProfiles = profilesWithStatus.slice(start, end);

  // Render
  if (paginatedProfiles.length === 0) {
    profilesTbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="8">
          <div class="empty-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
            <p>No profiles found</p>
          </div>
        </td>
      </tr>
    `;
  } else {
    profilesTbody.innerHTML = paginatedProfiles.map(profile => {
      const isSelected = selectedProfiles.has(profile.profileId);
      const statusClass = `status-${profile.status}`;
      return `
        <tr class="${statusClass} ${isSelected ? 'selected' : ''}" data-profile-id="${profile.profileId}">
          <td>
            <input type="checkbox" class="profile-checkbox" data-profile-id="${profile.profileId}" ${isSelected ? 'checked' : ''}>
          </td>
          <td>
            <span class="status-badge ${profile.status}">
              <span class="status-dot"></span>
              ${profile.status}
            </span>
          </td>
          <td>${profile.profileId}</td>
          <td>
            <span class="api-key" onclick="copyToClipboard('${profile.apiKey}')" title="Click to copy">
              ${maskApiKey(profile.apiKey)}
            </span>
          </td>
          <td>
            <div class="channel-badges">
              ${profile.channels.slice(0, 3).map(ch => `<span class="channel-badge">${ch}</span>`).join('')}
              ${profile.channels.length > 3 ? `<span class="channel-badge">+${profile.channels.length - 3}</span>` : ''}
            </div>
          </td>
          <td>${profile.stats.videosToday || 0}</td>
          <td>${profile.workerPid || '-'}</td>
          <td>
            <div class="action-buttons">
              <button class="btn-icon" onclick="viewProfile('${profile.profileId}')" title="View Details">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
              </button>
              <button class="btn-icon" onclick="viewLogs('${profile.profileId}')" title="View Logs">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                </svg>
              </button>
              ${profile.status === 'running' 
                ? `<button class="btn-icon" onclick="stopWorker('${profile.profileId}')" title="Stop Worker">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="6" y="6" width="12" height="12"></rect>
                    </svg>
                  </button>`
                : `<button class="btn-icon" onclick="startWorker('${profile.profileId}')" title="Start Worker">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polygon points="5 3 19 12 5 21 5 3"></polygon>
                    </svg>
                  </button>`
              }
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Add checkbox listeners
    document.querySelectorAll('.profile-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const profileId = e.target.dataset.profileId;
        if (e.target.checked) {
          selectedProfiles.add(profileId);
        } else {
          selectedProfiles.delete(profileId);
        }
        updateSelectAllState();
      });
    });
  }

  updatePagination();
}

function maskApiKey(key) {
  if (!key || key.length < 8) return '••••';
  return key.substring(0, 4) + '•'.repeat(key.length - 8) + key.substring(key.length - 4);
}

// Search & Filter
function handleSearch() {
  const query = searchInput.value.toLowerCase();
  filteredProfiles = profiles.filter(profile => {
    const matchesId = profile.profileId.toLowerCase().includes(query);
    const matchesChannel = profile.channels.some(ch => ch.toLowerCase().includes(query));
    return matchesId || matchesChannel;
  });
  currentPage = 1;
  renderTable();
}

function handleFilter() {
  const status = statusFilter.value;
  if (status === 'all') {
    filteredProfiles = [...profiles];
  } else {
    // Need to check actual status
    window.electronAPI.getProfiles().then(allProfiles => {
      const statusMap = new Map(allProfiles.map(p => [p.profileId, p.status]));
      filteredProfiles = profiles.filter(p => statusMap.get(p.profileId) === status);
      currentPage = 1;
      renderTable();
    });
    return;
  }
  currentPage = 1;
  renderTable();
}

// Sorting
function handleSort(column) {
  if (sortColumn === column) {
    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    sortColumn = column;
    sortDirection = 'asc';
  }

  // Update UI
  document.querySelectorAll('th[data-sort]').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
  });
  const th = document.querySelector(`th[data-sort="${column}"]`);
  if (th) {
    th.classList.add(`sort-${sortDirection}`);
  }

  renderTable();
}

// Selection
function handleSelectAll(e) {
  const checked = e.target.checked;
  document.querySelectorAll('.profile-checkbox').forEach(checkbox => {
    checkbox.checked = checked;
    const profileId = checkbox.dataset.profileId;
    if (checked) {
      selectedProfiles.add(profileId);
    } else {
      selectedProfiles.delete(profileId);
    }
  });
}

function updateSelectAllState() {
  const checkboxes = document.querySelectorAll('.profile-checkbox');
  const checked = Array.from(checkboxes).filter(cb => cb.checked);
  selectAllCheckbox.checked = checkboxes.length > 0 && checked.length === checkboxes.length;
  selectAllCheckbox.indeterminate = checked.length > 0 && checked.length < checkboxes.length;
}

// Pagination
function updatePagination() {
  const total = filteredProfiles.length;
  const start = (currentPage - 1) * itemsPerPage + 1;
  const end = Math.min(currentPage * itemsPerPage, total);

  document.getElementById('showing-from').textContent = total > 0 ? start : 0;
  document.getElementById('showing-to').textContent = end;
  document.getElementById('total-count').textContent = total;
  document.getElementById('current-page').textContent = currentPage;

  const totalPages = Math.ceil(total / itemsPerPage);
  document.getElementById('prev-page').disabled = currentPage === 1;
  document.getElementById('next-page').disabled = currentPage >= totalPages;
}

function changePage(delta) {
  const totalPages = Math.ceil(filteredProfiles.length / itemsPerPage);
  const newPage = currentPage + delta;
  if (newPage >= 1 && newPage <= totalPages) {
    currentPage = newPage;
    renderTable();
  }
}

// Worker Actions
async function startWorker(profileId) {
  try {
    showNotification(`Đang mở profile ${profileId} trong Genlogin...`, 'info');
    const result = await window.electronAPI.startWorker(profileId);
    if (result.success) {
      showNotification(`✅ Đã mở profile và bắt đầu theo dõi: ${profileId}`, 'success');
      refreshProfiles();
    } else {
      showNotification(`❌ Không thể bắt đầu theo dõi: ${result.error}`, 'error');
    }
  } catch (error) {
    showNotification(`❌ Lỗi: ${error.message}`, 'error');
  }
}

async function stopWorker(profileId) {
  try {
    const result = await window.electronAPI.stopWorker(profileId);
    if (result.success) {
      showNotification(`Worker stopped for ${profileId}`, 'success');
      refreshProfiles();
    } else {
      showNotification(`Failed to stop worker: ${result.error}`, 'error');
    }
  } catch (error) {
    showNotification(`Error: ${error.message}`, 'error');
  }
}

async function handleStartWorkers() {
  if (selectedProfiles.size === 0) {
    showNotification('Vui lòng chọn ít nhất một profile', 'warning');
    return;
  }

  const profileIds = Array.from(selectedProfiles);
  showNotification(`Đang mở ${profileIds.length} profile(s) trong Genlogin và bắt đầu theo dõi...`, 'info');
  
  let success = 0;
  let failed = 0;

  for (const profileId of profileIds) {
    try {
      const result = await window.electronAPI.startWorker(profileId);
      if (result.success) {
        success++;
      } else {
        failed++;
        console.error(`Failed to start ${profileId}:`, result.error);
      }
      // Delay nhỏ giữa các profile để tránh quá tải
      await new Promise(r => setTimeout(r, 500));
    } catch (error) {
      failed++;
      console.error(`Error starting ${profileId}:`, error);
    }
  }

  if (success > 0) {
    showNotification(`✅ Đã mở và bắt đầu theo dõi ${success} profile(s)${failed > 0 ? `, ${failed} thất bại` : ''}`, 'success');
  } else {
    showNotification(`❌ Không thể bắt đầu theo dõi. Vui lòng kiểm tra Genlogin đã chạy chưa.`, 'error');
  }
  refreshProfiles();
}

async function handleStopAll() {
  if (!confirm('Stop all running workers?')) return;

  try {
    const result = await window.electronAPI.stopAllWorkers();
    if (result.success) {
      showNotification('All workers stopped', 'success');
      refreshProfiles();
    }
  } catch (error) {
    showNotification(`Error: ${error.message}`, 'error');
  }
}

// Profile Details
async function viewProfile(profileId) {
  const profile = profiles.find(p => p.profileId === profileId);
  if (!profile) return;

  const allProfiles = await window.electronAPI.getProfiles();
  const profileData = allProfiles.find(p => p.profileId === profileId);

  const content = `
    <div class="profile-detail">
      <div class="detail-section">
        <label>Profile ID</label>
        <div class="detail-value">${profile.profileId}</div>
      </div>
      <div class="detail-section">
        <label>API KEY</label>
        <div class="detail-value api-key" onclick="copyToClipboard('${profile.apiKey}')">
          ${maskApiKey(profile.apiKey)} (click to copy)
        </div>
      </div>
      <div class="detail-section">
        <label>Channel IDs</label>
        <div class="channel-list">
          ${profile.channels.map(ch => `<div class="channel-badge">${ch}</div>`).join('')}
        </div>
      </div>
      <div class="detail-section">
        <label>Status</label>
        <div class="detail-value">
          <span class="status-badge ${profileData?.status || 'stopped'}">
            ${profileData?.status || 'stopped'}
          </span>
        </div>
      </div>
      <div class="detail-section">
        <label>Statistics</label>
        <div class="stats-grid">
          <div class="stat-box">
            <div class="stat-label">Total Videos</div>
            <div class="stat-number">${profileData?.stats?.totalVideos || 0}</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">Videos Today</div>
            <div class="stat-number">${profileData?.stats?.videosToday || 0}</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">Avg Processing</div>
            <div class="stat-number">${(profileData?.stats?.avgProcessingTime || 0).toFixed(2)}s</div>
          </div>
        </div>
      </div>
      <div class="detail-actions">
        <button class="btn btn-primary" onclick="openProfileInGenlogin('${profile.profileId}')">
          Open in Genlogin
        </button>
        <button class="btn btn-secondary" onclick="viewLogs('${profile.profileId}')">
          View Logs
        </button>
      </div>
    </div>
  `;

  document.getElementById('drawer-content').innerHTML = content;
  profileDrawer.classList.add('open');
}

function closeDrawer() {
  profileDrawer.classList.remove('open');
}

// Logs
async function viewLogs(profileId) {
  currentLogProfileId = profileId;
  document.getElementById('log-profile-id').textContent = profileId;
  
  const logs = await window.electronAPI.getWorkerLogs(profileId);
  const logContent = document.getElementById('log-content');
  logContent.innerHTML = logs.map(log => formatLogEntry(log)).join('');
  logContent.scrollTop = logContent.scrollHeight;
  
  logPanel.classList.add('open');
}

function addLogEntry(log, type = 'info') {
  if (currentLogProfileId) {
    const logContent = document.getElementById('log-content');
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = formatLogEntry(log, type);
    logContent.appendChild(entry);
    logContent.scrollTop = logContent.scrollHeight;
  }
}

function formatLogEntry(log, type = 'info') {
  const time = new Date(log.timestamp).toLocaleTimeString();
  const message = log.message;
  let messageClass = 'log-message';
  
  if (message.includes('❌') || message.includes('ERROR')) {
    messageClass += ' error';
  } else if (message.includes('⚠️') || message.includes('WARNING')) {
    messageClass += ' warning';
  } else if (message.includes('✅') || message.includes('SUCCESS')) {
    messageClass += ' success';
  }

  return `
    <div class="log-entry">
      <span class="log-timestamp">[${time}]</span>
      <span class="${messageClass}">${escapeHtml(message)}</span>
    </div>
  `;
}

function closeLogPanel() {
  logPanel.classList.remove('open');
  currentLogProfileId = null;
}

function copyLogs() {
  const logContent = document.getElementById('log-content').textContent;
  navigator.clipboard.writeText(logContent);
  showNotification('Logs copied to clipboard', 'success');
}

function clearLogs() {
  document.getElementById('log-content').innerHTML = '';
}

// Analytics
async function showAnalytics() {
  const analytics = await window.electronAPI.getAnalytics();
  
  const content = `
    <div class="analytics-dashboard">
      <div class="analytics-grid">
        <div class="analytics-card">
          <div class="analytics-label">Total Profiles</div>
          <div class="analytics-value">${analytics.totalProfiles}</div>
        </div>
        <div class="analytics-card">
          <div class="analytics-label">Running Workers</div>
          <div class="analytics-value" style="color: var(--success)">${analytics.runningWorkers}</div>
        </div>
        <div class="analytics-card">
          <div class="analytics-label">Total Videos</div>
          <div class="analytics-value" style="color: var(--accent)">${analytics.totalVideos}</div>
        </div>
        <div class="analytics-card">
          <div class="analytics-label">Videos Today</div>
          <div class="analytics-value" style="color: var(--accent)">${analytics.videosToday}</div>
        </div>
        <div class="analytics-card">
          <div class="analytics-label">Avg Processing Time</div>
          <div class="analytics-value">${analytics.avgProcessingTime.toFixed(2)}s</div>
        </div>
      </div>
      <div class="analytics-profiles">
        <h3>Profile Statistics</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th>Profile ID</th>
              <th>Status</th>
              <th>Total Videos</th>
              <th>Videos Today</th>
              <th>Avg Time</th>
            </tr>
          </thead>
          <tbody>
            ${analytics.profiles.map(p => `
              <tr>
                <td>${p.profileId}</td>
                <td><span class="status-badge ${p.status}">${p.status}</span></td>
                <td>${p.stats.totalVideos}</td>
                <td>${p.stats.videosToday}</td>
                <td>${p.stats.avgProcessingTime.toFixed(2)}s</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('analytics-content').innerHTML = content;
  showModal('analytics-modal');
}

// Batch Open Profiles
async function handleOpenProfilesBatch() {
  if (selectedProfiles.size === 0) {
    showNotification('Please select at least one profile', 'warning');
    return;
  }

  const profileIds = Array.from(selectedProfiles);
  showModal('batch-open-modal');
  
  const progressEl = document.getElementById('batch-open-progress');
  progressEl.innerHTML = '<div class="loading-line"></div><p>Opening profiles...</p>';

  const results = await window.electronAPI.openProfilesBatch(profileIds);
  
  progressEl.innerHTML = results.map(r => `
    <div class="batch-result ${r.success ? 'success' : 'error'}">
      <strong>${r.profileId}</strong>: ${r.success ? '✅ Opened' : '❌ ' + (r.error || 'Failed')}
    </div>
  `).join('');

  setTimeout(() => {
    closeModal();
  }, 3000);
}

// Utility Functions
async function refreshProfiles() {
  renderTable();
  updateStats();
}

async function updateStats() {
  const allProfiles = await window.electronAPI.getProfiles();
  const running = allProfiles.filter(p => p.status === 'running').length;
  const totalVideos = allProfiles.reduce((sum, p) => sum + (p.stats?.totalVideos || 0), 0);
  
  runningCountEl.textContent = running;
  totalVideosEl.textContent = totalVideos;
}

function showModal(modalId) {
  document.getElementById('modal-overlay').classList.add('show');
  document.getElementById(modalId).classList.add('show');
}

function closeModal() {
  document.querySelectorAll('.modal').forEach(m => m.classList.remove('show'));
  document.getElementById('modal-overlay').classList.remove('show');
}

function showNotification(message, type = 'info') {
  // Simple notification - can be enhanced
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  
  let bgColor = 'var(--bg-secondary)';
  let borderColor = 'var(--border-color)';
  let textColor = 'var(--text-primary)';
  
  if (type === 'success') {
    bgColor = 'rgba(0, 255, 136, 0.15)';
    borderColor = 'var(--success)';
    textColor = 'var(--success)';
  } else if (type === 'error') {
    bgColor = 'rgba(255, 68, 68, 0.15)';
    borderColor = 'var(--error)';
    textColor = 'var(--error)';
  } else if (type === 'warning') {
    bgColor = 'rgba(255, 170, 0, 0.15)';
    borderColor = 'var(--warning)';
    textColor = 'var(--warning)';
  } else if (type === 'info') {
    bgColor = 'rgba(0, 224, 255, 0.15)';
    borderColor = 'var(--accent)';
    textColor = 'var(--accent)';
  }
  
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    background: ${bgColor};
    border: 1px solid ${borderColor};
    border-radius: 8px;
    color: ${textColor};
    z-index: 10000;
    animation: fadeIn 0.2s ease;
    max-width: 400px;
    box-shadow: 0 4px 12px var(--shadow);
  `;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = 'fadeOut 0.2s ease';
    setTimeout(() => notification.remove(), 200);
  }, type === 'info' ? 2000 : 4000);
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text);
  showNotification('Copied to clipboard', 'success');
}

async function openProfileInGenlogin(profileId) {
  try {
    const result = await window.electronAPI.openProfile(profileId);
    if (result.success) {
      showNotification(`Profile ${profileId} opened in Genlogin`, 'success');
    } else {
      showNotification(`Failed to open profile: ${result.error}`, 'error');
    }
  } catch (error) {
    showNotification(`Error: ${error.message}`, 'error');
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function updateProfileStats(profileId, stats) {
  // Update stats in real-time if profile is visible
  const row = document.querySelector(`tr[data-profile-id="${profileId}"]`);
  if (row) {
    const videosTodayCell = row.querySelector('td:nth-child(6)');
    if (videosTodayCell) {
      videosTodayCell.textContent = stats.videosToday || 0;
    }
  }
}

// Make functions available globally for onclick handlers
window.startWorker = startWorker;
window.stopWorker = stopWorker;
window.viewProfile = viewProfile;
window.viewLogs = viewLogs;
window.copyToClipboard = copyToClipboard;
window.openProfileInGenlogin = openProfileInGenlogin;

