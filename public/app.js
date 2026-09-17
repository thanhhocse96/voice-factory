const state = {
  health: null,
  jobs: [],
  assets: [],
  selectedAssetId: null,
  theme: localStorage.getItem('zc-theme') || 'dark',
  gatewayBaseUrl: localStorage.getItem('vf.gatewayBaseUrl') || '',
  gatewayToken: localStorage.getItem('vf.gatewayToken') || ''
};

const el = {
  healthStatus: document.querySelector('#healthStatus'),
  gatewayValue: document.querySelector('#gatewayValue'),
  dbValue: document.querySelector('#dbValue'),
  browserValue: document.querySelector('#browserValue'),
  workerValue: document.querySelector('#workerValue'),
  desktopValue: document.querySelector('#desktopValue'),
  connectionForm: document.querySelector('#connectionForm'),
  gatewayBaseUrlInput: document.querySelector('#gatewayBaseUrl'),
  gatewayTokenInput: document.querySelector('#gatewayToken'),
  connectionMessage: document.querySelector('#connectionMessage'),
  queueForm: document.querySelector('#queueForm'),
  content: document.querySelector('#content'),
  voiceCode: document.querySelector('#voiceCode'),
  speed: document.querySelector('#speed'),
  incognito: document.querySelector('#incognito'),
  formMessage: document.querySelector('#formMessage'),
  queueRows: document.querySelector('#queueRows'),
  assetList: document.querySelector('#assetList'),
  assetsMessage: document.querySelector('#assetsMessage'),
  assetDetail: document.querySelector('#assetDetail'),
  editAssetBin: document.querySelector('#editAssetBin'),
  refreshQueue: document.querySelector('#refreshQueue'),
  exportQueueCsv: document.querySelector('#exportQueueCsv'),
  refreshAssets: document.querySelector('#refreshAssets'),
  exportAssetsCsv: document.querySelector('#exportAssetsCsv'),
  themeToggle: document.querySelector('#themeToggle'),
  tabs: Array.from(document.querySelectorAll('.tab')),
  tabPanels: Array.from(document.querySelectorAll('.tab-panel'))
};

async function apiFetch(path, options = {}) {
  const headers = {
    'content-type': 'application/json',
    ...(options.headers || {})
  };
  if (state.gatewayToken) headers.authorization = `Bearer ${state.gatewayToken}`;

  const response = await fetch(`${state.gatewayBaseUrl}${path}`, { ...options, headers });
  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
}

async function downloadCsv(path, filename) {
  const headers = {};
  if (state.gatewayToken) headers.authorization = `Bearer ${state.gatewayToken}`;

  const response = await fetch(`${state.gatewayBaseUrl}${path}`, { headers });
  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const data = await response.json();
      if (data.error) message = data.error;
    } catch {
      // non-JSON error body
    }
    throw new Error(message);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function audioSrc(filename) {
  const url = `${state.gatewayBaseUrl}/api/audio/${encodeURIComponent(filename)}`;
  return state.gatewayToken ? `${url}?token=${encodeURIComponent(state.gatewayToken)}` : url;
}

function setMessage(message, tone = 'muted') {
  el.formMessage.textContent = message;
  el.formMessage.style.color = tone === 'error' ? 'var(--danger)' : 'var(--muted)';
}

function setAssetsMessage(message, tone = 'muted') {
  el.assetsMessage.textContent = message;
  el.assetsMessage.style.color = tone === 'error' ? 'var(--danger)' : 'var(--muted)';
}

function renderHealth() {
  const health = state.health;
  const ok = Boolean(health?.ok);
  el.healthStatus.classList.toggle('ok', ok && !health.degraded);
  el.healthStatus.classList.toggle('bad', !ok);
  el.healthStatus.querySelector('span:last-child').textContent = ok
    ? health.degraded ? 'Degraded' : 'Ready'
    : 'Unavailable';

  el.gatewayValue.textContent = health?.gateway || '-';
  el.dbValue.textContent = health?.db || '-';
  el.browserValue.textContent = health?.browserCdp || '-';
  el.workerValue.textContent = health?.worker || '-';
}

function renderQueue() {
  if (state.jobs.length === 0) {
    el.queueRows.innerHTML = '<tr><td colspan="4" class="empty">No jobs yet.</td></tr>';
    return;
  }

  el.queueRows.innerHTML = state.jobs.map((job) => `
    <tr>
      <td><span class="badge ${escapeHtml(job.status)}">${escapeHtml(job.status)}</span></td>
      <td><span class="cell-truncate">${escapeHtml(trimText(job.content, 86))}</span></td>
      <td>${escapeHtml(job.voice_code)}</td>
      <td>${escapeHtml(job.created_at)}</td>
    </tr>
  `).join('');
}

function renderAssets() {
  if (state.assets.length === 0) {
    el.assetList.innerHTML = '<p class="empty">No assets yet.</p>';
    el.assetDetail.innerHTML = 'Select an asset.';
    el.editAssetBin.innerHTML = 'Assets will be available here.';
    return;
  }

  if (!state.selectedAssetId || !state.assets.some((asset) => asset.id === state.selectedAssetId)) {
    state.selectedAssetId = state.assets[0].id;
  }

  el.assetList.innerHTML = state.assets.map((asset) => `
    <article class="asset compact-row ${asset.id === state.selectedAssetId ? 'selected' : ''}" data-asset-id="${escapeHtml(asset.id)}">
      <button class="play-button" type="button" title="Preview">&gt;</button>
      <div class="asset-main">
        <strong>${escapeHtml(trimText(asset.content || asset.filename, 70))}</strong>
        <span>${escapeHtml(asset.filename)}</span>
      </div>
      <span class="asset-duration">${formatDuration(asset.duration_ms)}</span>
    </article>
  `).join('');

  el.assetList.querySelectorAll('[data-asset-id]').forEach((row) => {
    row.addEventListener('click', () => {
      state.selectedAssetId = row.dataset.assetId;
      renderAssets();
    });
  });

  renderAssetDetail();
  renderEditAssetBin();
}

function renderAssetDetail() {
  const asset = state.assets.find((item) => item.id === state.selectedAssetId);
  if (!asset) {
    el.assetDetail.innerHTML = 'Select an asset.';
    return;
  }

  el.assetDetail.innerHTML = `
    <div class="detail-filename">${escapeHtml(asset.filename)}</div>
    <div class="detail-text">${escapeHtml(asset.content || '')}</div>
    <audio controls preload="none" src="${audioSrc(asset.filename)}"></audio>
    <button class="primary" type="button" disabled>Add to Edit</button>
  `;
}

function renderEditAssetBin() {
  el.editAssetBin.innerHTML = state.assets.map((asset) => `
    <div class="asset compact-row">
      <span class="play-button" aria-hidden="true">+</span>
      <div class="asset-main">
        <strong>${escapeHtml(trimText(asset.content || asset.filename, 52))}</strong>
        <span>${formatDuration(asset.duration_ms)}</span>
      </div>
    </div>
  `).join('');
}

async function refreshHealth() {
  try {
    state.health = await apiFetch('/health');
  } catch {
    state.health = null;
  }
  renderHealth();
}

async function refreshDesktopRuntime() {
  const invoke = window.__TAURI__?.core?.invoke;
  if (!invoke || !el.desktopValue) return;

  try {
    const runtime = await invoke('gateway_runtime_status');
    el.desktopValue.textContent = runtime.degraded ? 'Degraded' : runtime.ownedByShell ? 'Managed' : 'Reused';
  } catch {
    el.desktopValue.textContent = 'Unavailable';
  }
}

async function refreshQueue() {
  const data = await apiFetch('/api/queue');
  state.jobs = data.jobs || [];
  renderQueue();
}

async function refreshAssets() {
  const data = await apiFetch('/api/assets');
  state.assets = data.assets || [];
  renderAssets();
}

async function refreshAll() {
  await refreshHealth();
  await refreshDesktopRuntime();
  await Promise.all([refreshQueue(), refreshAssets()]);
}

async function addQueue(event) {
  event.preventDefault();
  setMessage('Adding job...');

  try {
    await apiFetch('/api/queue', {
      method: 'POST',
      body: JSON.stringify({
        content: el.content.value,
        voice_code: el.voiceCode.value,
        speed: Number(el.speed.value || 1.05),
        incognito: el.incognito.checked ? 1 : 0
      })
    });
    setMessage('Job added. Fake worker will finalize it shortly.');
    await refreshQueue();
    window.setTimeout(refreshAll, 1300);
  } catch (error) {
    setMessage(error.message, 'error');
  }
}

function saveConnectionSettings(event) {
  event.preventDefault();
  state.gatewayBaseUrl = el.gatewayBaseUrlInput.value.trim().replace(/\/+$/, '');
  state.gatewayToken = el.gatewayTokenInput.value.trim();
  localStorage.setItem('vf.gatewayBaseUrl', state.gatewayBaseUrl);
  localStorage.setItem('vf.gatewayToken', state.gatewayToken);
  el.connectionMessage.textContent = 'Saved.';
  refreshAll().catch((error) => {
    el.connectionMessage.textContent = error.message;
  });
}

function trimText(value, max) {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function formatDuration(ms) {
  if (!Number.isFinite(Number(ms))) return '-';
  return `${(Number(ms) / 1000).toFixed(1)}s`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function setActiveTab(name) {
  el.tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === name));
  el.tabPanels.forEach((panel) => panel.classList.toggle('active', panel.id === `tab-${name}`));
}

function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('zc-theme', theme);
  el.themeToggle.textContent = theme === 'dark' ? 'Light' : 'Dark';
}

el.connectionForm.addEventListener('submit', saveConnectionSettings);
el.gatewayBaseUrlInput.value = state.gatewayBaseUrl;
el.gatewayTokenInput.value = state.gatewayToken;

el.queueForm.addEventListener('submit', addQueue);
el.refreshQueue.addEventListener('click', refreshQueue);
el.exportQueueCsv.addEventListener('click', async () => {
  try {
    await downloadCsv('/api/queue.csv', 'queue.csv');
    setMessage('Queue CSV downloaded.');
  } catch (error) {
    setMessage(error.message, 'error');
  }
});
el.refreshAssets.addEventListener('click', refreshAssets);
el.exportAssetsCsv.addEventListener('click', async () => {
  try {
    await downloadCsv('/api/assets.csv', 'assets.csv');
    setAssetsMessage('Assets CSV downloaded.');
  } catch (error) {
    setAssetsMessage(error.message, 'error');
  }
});
el.themeToggle.addEventListener('click', () => {
  applyTheme(state.theme === 'dark' ? 'light' : 'dark');
});
el.tabs.forEach((tab) => {
  tab.addEventListener('click', () => setActiveTab(tab.dataset.tab));
});

applyTheme(state.theme);
refreshAll().catch((error) => {
  setMessage(error.message, 'error');
});

window.setInterval(refreshHealth, 5000);
window.setInterval(refreshDesktopRuntime, 5000);
