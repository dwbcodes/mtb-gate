// PAGE NAVIGATION (hash-based)
const PAGES = ['results', 'riders', 'files', 'config-network', 'config-gate', 'config-reset', 'docs', 'peer-tools'];
let currentRole = null;
let currentFilePath = '/';

async function apiJson(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

function jsonOptions(method, payload) {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  };
}

function navigateTo(page) {
  if (!PAGES.includes(page)) page = 'results';
  if (currentRole && !isStartGate() && pageRequiresStart(page)) page = 'results';

  PAGES.forEach(p => {
    const el = document.getElementById('page-' + p);
    if (el) el.classList.toggle('active', p === page);
  });

  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.toggle('active', link.dataset.page === page);
  });

  if (page === 'docs') {
    loadSelectedDoc();
  } else if (page === 'files') {
    loadFiles(currentFilePath);
  }
}

function isStartGate() {
  return currentRole === 'start';
}

function pageRequiresStart(page) {
  const el = document.getElementById('page-' + page);
  return Boolean(el?.hasAttribute('data-start-only'));
}

function applyRoleUi(role) {
  currentRole = String(role || 'unknown').toLowerCase();
  const start = isStartGate();
  document.body.dataset.role = currentRole;

  document.querySelectorAll('[data-start-only]').forEach((el) => {
    if (start) {
      el.removeAttribute('data-role-hidden');
    } else {
      el.setAttribute('data-role-hidden', '');
    }
  });

  const roleNotice = document.getElementById('roleNotice');
  if (roleNotice) roleNotice.hidden = start;

  const activePage = window.location.hash.slice(1);
  if (!start && activePage && pageRequiresStart(activePage)) {
    window.location.hash = 'results';
    navigateTo('results');
  }
}

window.addEventListener('hashchange', () => {
  navigateTo(window.location.hash.slice(1));
});

document.querySelectorAll('.nav-link, .brand').forEach(link => {
  link.addEventListener('click', (e) => {
    const page = link.dataset.page;
    if (page) {
      e.preventDefault();
      window.location.hash = page;
      navigateTo(page);
    }
  });
});

// RESULTS PAGE
async function loadStatus() {
  try {
    const status = await apiJson('/api/status');
    applyRoleUi(status.role);

    document.getElementById('deviceLabel').textContent = status.deviceLabel || 'Gate Control';
    document.getElementById('deviceRole').textContent = (status.role || 'unknown') + ' gate';
    document.getElementById('topRole').textContent = (status.role || 'unknown') + ' gate';

    document.getElementById('statusDeviceId').textContent = status.deviceId;
    document.getElementById('statusMac').textContent = status.mac;
    document.getElementById('statusApSsid').textContent = status.apSsid;
    document.getElementById('statusApIp').textContent = status.apIp;
    document.getElementById('statusStaSsid').textContent = status.staSsid || 'Not configured';
    document.getElementById('statusStaIp').textContent = status.staIp;

    const espNow = status.espNow || {};
    document.getElementById('statusPeerMac').textContent = espNow.peerMac || 'Not configured';
    const reachable = espNow.reachable;
    const configured = espNow.configured;
    const connLabel = reachable ? '✓ Connected' : (configured ? '✗ Not reachable' : '— Not configured');
    document.getElementById('statusConnected').textContent = connLabel;
    const rttLabel = espNow.lastRttMs > 0 ? ` (RTT ${espNow.lastRttMs}ms, ch${espNow.wifiChannel})` : '';
    document.getElementById('topConnection').textContent = reachable
      ? 'Peer connected' + rttLabel
      : (configured ? 'Peer NOT reachable' : 'No peer configured');
    const peerToolMac = document.getElementById('peerToolMac');
    const peerToolStatus = document.getElementById('peerToolStatus');
    if (peerToolMac) peerToolMac.textContent = espNow.peerMac || 'Not configured';
    if (peerToolStatus) peerToolStatus.textContent = reachable
      ? 'Connected (RTT ' + espNow.lastRttMs + 'ms)'
      : (configured ? 'Not reachable' : 'Not configured');

    // On non-start gates, the peer is the auto-discovered Start Gate.
    const gate1MacEl = document.getElementById('gate1Mac');
    if (gate1MacEl) gate1MacEl.value = status.role === 'start'
      ? (status.mac || '—')
      : (espNow.peerMac || 'Not yet discovered');

    const navId = document.getElementById('navDeviceId');
    if (navId) navId.textContent = status.deviceId || '';

    const isStart = status.role === 'start';
    document.getElementById('sectionConnectedGates').style.display = isStart ? 'none' : '';
    if (!isStart) {
      document.getElementById('connectedStartMac').textContent = espNow.peerMac || 'Not yet discovered';
    }

    // Fetch merged results (live queue + persisted)
    let results = [];
    try {
      results = await apiJson('/api/results?limit=20');
    } catch (_) { /* ignore if not available */ }

    renderResults(results);
  } catch (err) {
    console.error('Failed to load status:', err);
  }
}

function renderResults(results) {
  const container = document.getElementById('attempts');
  container.replaceChildren();

  if (results.length === 0) {
    const p = document.createElement('p');
    p.style.cssText = 'color: var(--muted); padding: 20px 0; text-align: center;';
    p.textContent = 'No attempts yet';
    container.appendChild(p);
    return;
  }

  for (const run of results) {
    const name = run.riderName || run.riderId || '—';
    const status = run.status || (run.falseStart ? 'False Start' : 'Finished');
    const reactionMs = run.reactionMs ?? (run.metrics?.reactionMs ?? null);
    const courseMs = run.courseMs ?? (run.metrics?.courseMs ?? null);
    const falseStart = run.falseStart || false;

    container.appendChild(renderAttemptCard(
      name, status, reactionMs, courseMs, falseStart, run.runId, run.live
    ));
  }
}

function renderAttemptCard(name, status, reactionMs, courseMs, falseStart, runId, live) {
  const article = document.createElement('article');
  article.className = 'attempt';

  const info = document.createElement('div');
  const h3 = document.createElement('h3');
  h3.textContent = name;
  const statusP = document.createElement('p');
  statusP.textContent = status;
  if (falseStart) statusP.style.color = '#e74c3c';
  info.appendChild(h3);
  info.appendChild(statusP);

  // Gate Time: reaction from GO to start trigger
  let gateTimeMs = reactionMs;
  let gateLabel = 'Gate Time';
  let gateDisplay = formatMs(gateTimeMs);
  if (falseStart && gateTimeMs != null) {
    gateDisplay = '+5.000s';
    gateLabel = 'Penalty';
  }

  // Course Time: trigger to finish (sensor-to-sensor)
  const courseDisplay = formatMs(courseMs);

  // Total: with penalty → trigger-to-finish only; without → GO-to-finish
  let totalMs = null;
  if (falseStart && courseMs != null) {
    totalMs = courseMs;
  } else if (reactionMs != null && courseMs != null) {
    totalMs = reactionMs + courseMs;
  }

  // Potential: without penalty → trigger-to-finish; with penalty → GO-to-finish (what it could have been)
  let potentialMs = null;
  if (falseStart && reactionMs != null && courseMs != null) {
    potentialMs = reactionMs + courseMs;
  } else if (!falseStart && courseMs != null) {
    potentialMs = courseMs;
  }

  const metricsDiv = document.createElement('div');
  metricsDiv.className = 'metrics';
  for (const [label, value, display] of [
    [gateLabel, gateTimeMs, gateDisplay],
    ['Course', courseMs, courseDisplay],
    ['Total', totalMs, formatMs(totalMs)],
    ['Potential', potentialMs, formatMs(potentialMs)]
  ]) {
    const cell = document.createElement('div');
    const span = document.createElement('span');
    span.textContent = label;
    const strong = document.createElement('strong');
    strong.textContent = display;
    if (falseStart && label === 'Penalty') strong.style.color = '#e74c3c';
    cell.appendChild(span);
    cell.appendChild(strong);
    metricsDiv.appendChild(cell);
  }

  // Action buttons
  if (runId && isStartGate()) {
    const actions = document.createElement('div');
    actions.className = 'attempt-actions';
    if (live && status !== 'Finished' && status !== 'Cancelled') {
      const stopBtn = document.createElement('button');
      stopBtn.className = 'btn-danger btn-small';
      stopBtn.textContent = 'Stop';
      stopBtn.addEventListener('click', () => stopRun());
      actions.appendChild(stopBtn);
    }
    if (live) {
      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn-danger btn-small';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => removeRun(runId));
      actions.appendChild(removeBtn);
    } else {
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-secondary btn-small';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => deleteRun(runId));
      actions.appendChild(delBtn);
    }
    info.appendChild(actions);
  }

  article.appendChild(info);
  article.appendChild(metricsDiv);
  return article;
}

function formatMs(value) {
  if (value == null) return 'Pending';
  return (value / 1000).toFixed(3) + 's';
}

async function stopRun() {
  try {
    await apiJson('/api/results/stop', { method: 'POST' });
    loadStatus();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function removeRun(runId) {
  try {
    await apiJson('/api/results', jsonOptions('DELETE', { runId }));
    loadStatus();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function deleteRun(runId) {
  if (!confirm('Delete this result?')) return;
  try {
    await apiJson('/api/results', jsonOptions('DELETE', { runId }));
    loadStatus();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// RIDERS PAGE
async function loadRiders() {
  try {
    const riders = await apiJson('/api/riders');
    renderRidersList(riders);
  } catch (err) {
    console.error('Failed to load riders:', err);
  }
}

function renderRidersList(riders) {
  const list = document.getElementById('rosterList');
  list.replaceChildren();

  if (riders.length === 0) {
    const p = document.createElement('p');
    p.style.color = 'var(--muted)';
    p.textContent = 'No riders registered yet';
    list.appendChild(p);
    return;
  }

  for (const rider of [...riders].reverse()) {
    const item = document.createElement('div');
    item.className = 'roster-item';

    const inner = document.createElement('div');
    inner.style.flex = '1';

    const name = document.createElement('strong');
    name.textContent = rider.displayName;

    const id = document.createElement('span');
    id.textContent = 'ID: ' + rider.tagId;

    inner.appendChild(name);
    inner.appendChild(document.createElement('br'));
    inner.appendChild(id);
    item.appendChild(inner);
    list.appendChild(item);
  }
}

async function startNfcListen() {
  const btn = document.getElementById('tapNfc');
  const statusEl = document.getElementById('nfcStatus');

  btn.disabled = true;
  btn.textContent = 'Listening for 15s...';
  statusEl.textContent = 'Hold card near device...';

  try {
    await apiJson('/api/nfc/listen', { method: 'POST' });

    let tagId = null;
    const pollInterval = setInterval(async () => {
      try {
        const data = await apiJson('/api/nfc/tag');
        if (data.ok && data.tagId) {
          tagId = data.tagId;
          clearInterval(pollInterval);
          btn.disabled = false;
          btn.textContent = 'Tap NFC';
          statusEl.textContent = 'Card detected!';

          const displayName = prompt('Enter rider name for this card:');
          if (displayName && displayName.trim()) {
            registerRider(displayName.trim(), tagId);
            statusEl.textContent = '✓ Rider registered';
          } else {
            statusEl.textContent = 'Cancelled';
          }
        }
      } catch (err) {
        console.error('Error checking for NFC tag:', err);
      }
    }, 500);

    setTimeout(() => {
      clearInterval(pollInterval);
      btn.disabled = false;
      btn.textContent = 'Tap NFC';
      if (!tagId) {
        statusEl.textContent = 'No card detected';
      }
    }, 15000);
  } catch (err) {
    console.error('Failed to start NFC listen:', err);
    btn.disabled = false;
    btn.textContent = 'Tap NFC';
    statusEl.textContent = 'Error: ' + err.message;
  }
}

async function registerRider(displayName, tagId) {
  try {
    await apiJson('/api/riders', jsonOptions('POST', { tagId, displayName }));
    document.getElementById('nfcStatus').textContent = '✓ Registered: ' + displayName;
    loadRiders();
  } catch (err) {
    console.error('Failed to register rider:', err);
    document.getElementById('nfcStatus').textContent = 'Error: ' + err.message;
  }
}

// FILES PAGE
function normalizeUiPath(path) {
  let value = String(path || '/').trim();
  if (!value.startsWith('/')) value = '/' + value;
  value = value.replace(/\/+/g, '/');
  if (value.length > 1 && value.endsWith('/')) value = value.slice(0, -1);
  return value || '/';
}

function parentPath(path) {
  const normalized = normalizeUiPath(path);
  if (normalized === '/') return '/';
  const slash = normalized.lastIndexOf('/');
  return slash <= 0 ? '/' : normalized.slice(0, slash);
}

function basename(path) {
  const normalized = normalizeUiPath(path);
  if (normalized === '/') return '/';
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

function setFilesMessage(message, error = false) {
  const el = document.getElementById('filesMessage');
  if (!el) return;
  el.textContent = message || '';
  el.style.color = error ? 'var(--danger)' : 'var(--muted)';
}

function renderFileBreadcrumbs(path) {
  const container = document.getElementById('fileBreadcrumbs');
  container.replaceChildren();

  const rootButton = document.createElement('button');
  rootButton.className = 'file-crumb';
  rootButton.textContent = '/';
  rootButton.addEventListener('click', () => loadFiles('/'));
  container.appendChild(rootButton);

  const parts = normalizeUiPath(path).split('/').filter(Boolean);
  let built = '';
  for (const part of parts) {
    built += '/' + part;
    const crumbPath = built;
    const button = document.createElement('button');
    button.className = 'file-crumb';
    button.textContent = part;
    button.addEventListener('click', () => loadFiles(crumbPath));
    container.appendChild(button);
  }
}

function renderFileList(data) {
  const list = document.getElementById('fileList');
  list.replaceChildren();

  const path = normalizeUiPath(data.path || '/');
  if (path !== '/') {
    list.appendChild(renderFileRow({
      name: '..',
      path: parentPath(path),
      type: 'dir',
      size: 0
    }));
  }

  const entries = Array.isArray(data.entries) ? data.entries : [];
  if (entries.length === 0 && path === '/') {
    const empty = document.createElement('p');
    empty.className = 'file-empty';
    empty.textContent = 'LittleFS is empty.';
    list.appendChild(empty);
    return;
  }

  for (const entry of entries) {
    list.appendChild(renderFileRow(entry));
  }
}

function renderFileRow(entry) {
  const row = document.createElement('button');
  row.className = 'file-row';
  row.type = 'button';

  const name = document.createElement('strong');
  name.textContent = entry.name || basename(entry.path);

  const meta = document.createElement('span');
  const isDir = entry.type === 'dir';
  meta.textContent = isDir ? 'Directory' : formatBytes(entry.size || 0);

  row.appendChild(name);
  row.appendChild(meta);
  row.addEventListener('click', () => {
    if (isDir) {
      loadFiles(entry.path);
    } else {
      viewFile(entry.path);
    }
  });
  return row;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return value + ' B';
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
  return (value / (1024 * 1024)).toFixed(1) + ' MB';
}

async function loadFiles(path = currentFilePath) {
  const nextPath = normalizeUiPath(path);
  currentFilePath = nextPath;
  const input = document.getElementById('filePath');
  if (input) input.value = nextPath;
  renderFileBreadcrumbs(nextPath);
  setFilesMessage('Loading...');

  try {
    const data = await apiJson('/api/files?path=' + encodeURIComponent(nextPath));
    currentFilePath = normalizeUiPath(data.path || nextPath);
    if (input) input.value = currentFilePath;
    renderFileBreadcrumbs(currentFilePath);
    renderFileList(data);
    setFilesMessage((data.entries || []).length + ' item(s)');
  } catch (err) {
    document.getElementById('fileList').replaceChildren();
    setFilesMessage('Error: ' + err.message, true);
  }
}

async function viewFile(path) {
  const viewer = document.getElementById('fileViewer');
  const meta = document.getElementById('fileViewerMeta');
  viewer.textContent = 'Loading...';
  meta.textContent = normalizeUiPath(path);

  try {
    const response = await fetch('/api/files/view?path=' + encodeURIComponent(normalizeUiPath(path)));
    const text = await response.text();
    if (!response.ok) {
      let message = text;
      try {
        message = JSON.parse(text).error || message;
      } catch (_) { /* keep raw text */ }
      throw new Error(message || 'HTTP ' + response.status);
    }
    viewer.textContent = text || '(empty file)';
    const size = response.headers.get('X-File-Size');
    const truncated = response.headers.get('X-File-Truncated') === 'true';
    meta.textContent = normalizeUiPath(path) + (size ? ' · ' + formatBytes(size) : '') + (truncated ? ' · truncated' : '');
  } catch (err) {
    viewer.textContent = 'Error: ' + err.message;
  }
}

// NETWORK CONFIG PAGE
async function loadNetworkConfig() {
  try {
    const config = await apiJson('/api/config');

    document.getElementById('apSsid').value = config.deviceId || '';
    document.getElementById('staSsid').value = config.staSsid || '';
    document.getElementById('wifiChannel').value = config.wifiChannel || 1;
    document.getElementById('peerMac').value = config.peerMac || '';
    document.getElementById('gateNumber').value = String(config.gateNumber ?? 1);
  } catch (err) {
    console.error('Failed to load config:', err);
  }
}

async function saveJsonConfig(endpoint, payload, messageElementId, successText, afterSuccess) {
  const messageEl = document.getElementById(messageElementId);
  try {
    await apiJson(endpoint, jsonOptions('PUT', payload));
    messageEl.textContent = successText;
    if (afterSuccess) afterSuccess();
  } catch (err) {
    messageEl.textContent = '✗ Error: ' + err.message;
  }
}

async function saveWifiConfig() {
  const config = {
    apPassword: document.getElementById('apPassword').value,
    staSsid: document.getElementById('staSsid').value,
    staPassword: document.getElementById('staPassword').value,
    wifiChannel: parseInt(document.getElementById('wifiChannel').value)
  };

  await saveJsonConfig(
    '/api/config/wifi',
    config,
    'wifiMessage',
    '✓ Saved! Device restarting Wi-Fi...',
    () => {
      document.getElementById('apPassword').value = '';
      document.getElementById('staPassword').value = '';
    }
  );
}

async function savePeerConfig() {
  const config = {
    gateNumber: parseInt(document.getElementById('gateNumber').value, 10),
    peerMac: document.getElementById('peerMac').value
  };

  await saveJsonConfig('/api/config/mac', config, 'peerMessage', '✓ Saved!');
}

// RESET PAGE
async function rebootDevice() {
  if (!confirm('Reboot the device? Settings will be preserved.')) return;
  try {
    await fetch('/api/reboot', { method: 'POST' });
    alert('Device is rebooting...');
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function factoryReset() {
  if (!confirm('Factory reset will erase ALL settings and riders. This cannot be undone. Continue?')) return;
  if (!confirm('Really? This will erase everything.')) return;
  try {
    await fetch('/api/factory-reset', { method: 'POST' });
    alert('Device is factory resetting...');
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function clearAllRiders() {
  if (!confirm('Delete all riders? Settings will be preserved.')) return;
  try {
    const riders = await fetch('/api/riders').then(r => r.json());
    for (const rider of riders) {
      await fetch('/api/riders', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagId: rider.tagId })
      });
    }
    loadRiders();
    alert('All riders cleared!');
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function downloadConfig() {
  try {
    const response = await fetch('/api/config');
    const config = await response.json();
    const json = JSON.stringify(config, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mtb-gate-config-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function restoreConfig(file) {
  const msgEl = document.getElementById('restoreMessage');
  try {
    const text = await file.text();
    const config = JSON.parse(text);

    if (!confirm('Restore configuration from backup? The device will reboot after applying settings.')) return;

    msgEl.textContent = 'Restoring...';

    // Apply wifi config
    const wifiPayload = {};
    if (config.staSsid !== undefined) wifiPayload.staSsid = config.staSsid;
    if (config.wifiChannel !== undefined) wifiPayload.wifiChannel = config.wifiChannel;
    // Passwords are masked in export, only restore if not masked
    if (config.apPassword && config.apPassword !== '***') wifiPayload.apPassword = config.apPassword;
    if (config.staPassword && config.staPassword !== '***') wifiPayload.staPassword = config.staPassword;

    if (Object.keys(wifiPayload).length > 0) {
      await apiJson('/api/config/wifi', jsonOptions('PUT', wifiPayload));
    }

    // Apply active baseline-relative sensor calibration.
    const timePayload = {};
    if (config.triggerDelta !== undefined) timePayload.triggerDelta = config.triggerDelta;

    if (Object.keys(timePayload).length > 0) {
      await apiJson('/api/config/time', jsonOptions('PUT', timePayload));
    }

    // Apply gate/mac config (triggers reboot)
    const macPayload = {};
    if (config.gateNumber !== undefined) macPayload.gateNumber = config.gateNumber;
    if (config.peerMac !== undefined) macPayload.peerMac = config.peerMac;
    if (config.deviceLabel !== undefined) macPayload.deviceLabel = config.deviceLabel;

    if (Object.keys(macPayload).length > 0) {
      await apiJson('/api/config/mac', jsonOptions('PUT', macPayload));
      msgEl.textContent = 'Config restored. Device is rebooting...';
    } else {
      msgEl.textContent = 'Config restored.';
    }
  } catch (err) {
    msgEl.textContent = 'Error: ' + err.message;
  }
}

// API DOCS PAGE
let loadedDocUrl = null;

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<span>$1</span>');
}

function renderMarkdownTable(lines) {
  const rows = lines
    .filter((line, index) => index !== 1)
    .map((line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => renderInlineMarkdown(cell.trim())));
  if (rows.length === 0) return '';

  const [headers, ...bodyRows] = rows;
  const head = '<thead><tr>' + headers.map((cell) => '<th>' + cell + '</th>').join('') + '</tr></thead>';
  const body = '<tbody>' + bodyRows.map((row) => '<tr>' + row.map((cell) => '<td>' + cell + '</td>').join('') + '</tr>').join('') + '</tbody>';
  return '<div class="doc-table-wrap"><table>' + head + body + '</table></div>';
}

function renderMarkdown(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let paragraph = [];
  let list = [];
  let code = [];
  let inCode = false;

  function flushParagraph() {
    if (paragraph.length === 0) return;
    html.push('<p>' + renderInlineMarkdown(paragraph.join(' ')) + '</p>');
    paragraph = [];
  }

  function flushList() {
    if (list.length === 0) return;
    html.push('<ul>' + list.map((item) => '<li>' + renderInlineMarkdown(item) + '</li>').join('') + '</ul>');
    list = [];
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (line.startsWith('```')) {
      if (inCode) {
        html.push('<pre><code>' + escapeHtml(code.join('\n')) + '</code></pre>');
        code = [];
        inCode = false;
      } else {
        flushParagraph();
        flushList();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      code.push(line);
      continue;
    }

    if (/^\|.+\|$/.test(line) && /^\|[-:\s|]+\|$/.test(lines[index + 1] || '')) {
      flushParagraph();
      flushList();
      const tableLines = [line, lines[index + 1]];
      index += 2;
      while (index < lines.length && /^\|.+\|$/.test(lines[index])) {
        tableLines.push(lines[index]);
        index += 1;
      }
      index -= 1;
      html.push(renderMarkdownTable(tableLines));
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length + 1;
      html.push('<h' + level + '>' + renderInlineMarkdown(heading[2]) + '</h' + level + '>');
      continue;
    }

    const bullet = /^-\s+(.+)$/.exec(line);
    if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  if (inCode && code.length > 0) {
    html.push('<pre><code>' + escapeHtml(code.join('\n')) + '</code></pre>');
  }

  return html.join('');
}

async function loadDoc(button) {
  const targetButton = button || document.querySelector('.doc-tab.active') || document.querySelector('.doc-tab');
  if (!targetButton) return;
  if (loadedDocUrl === targetButton.dataset.docUrl) return;

  const titleEl = document.getElementById('docTitle');
  const statusEl = document.getElementById('docStatus');
  const contentEl = document.getElementById('docContent');

  loadedDocUrl = targetButton.dataset.docUrl;
  document.querySelectorAll('.doc-tab').forEach((tab) => tab.classList.toggle('active', tab === targetButton));
  titleEl.textContent = targetButton.dataset.docTitle || targetButton.textContent;
  statusEl.textContent = 'Loading...';
  contentEl.textContent = '';

  try {
    const response = await fetch(targetButton.dataset.docUrl);
    if (!response.ok) {
      throw new Error('HTTP ' + response.status + ' ' + response.statusText);
    }

    const text = await response.text();
    if (targetButton.dataset.docType === 'json') {
      const formatted = JSON.stringify(JSON.parse(text), null, 2);
      contentEl.innerHTML = '<pre><code>' + escapeHtml(formatted) + '</code></pre>';
    } else {
      contentEl.innerHTML = renderMarkdown(text);
    }
    statusEl.textContent = targetButton.dataset.docUrl;
  } catch (err) {
    loadedDocUrl = null;
    statusEl.textContent = 'Error';
    contentEl.textContent = 'Failed to load documentation: ' + err.message;
  }
}

function loadSelectedDoc() {
  loadDoc();
}

async function testApiEndpoint(endpoint) {
  const resultEl = document.getElementById('apiTestResult');
  resultEl.style.display = 'block';
  resultEl.textContent = 'Testing...';

  try {
    const options = endpoint === 'ping' ? { method: 'POST' } : {};
    const response = await fetch('/api/' + endpoint, options);
    if (!response.ok) {
      resultEl.textContent = 'Error: ' + response.status + ' ' + response.statusText;
      return;
    }
    const data = await response.json();
    resultEl.textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    resultEl.textContent = 'Error: ' + err.message;
  }
}

// PEER COMMANDS PAGE
async function refreshPeerStatus() {
  try {
    const status = await apiJson('/api/status');
    const espNow = status.espNow || {};
    const peerToolMac = document.getElementById('peerToolMac');
    const peerToolStatus = document.getElementById('peerToolStatus');
    if (peerToolMac) peerToolMac.textContent = espNow.peerMac || 'Not configured';
    if (peerToolStatus) peerToolStatus.textContent = espNow.reachable
      ? 'Connected (RTT ' + espNow.lastRttMs + 'ms, ch' + espNow.wifiChannel + ')'
      : (espNow.configured ? 'Not reachable' : 'Not configured');
  } catch (_) { /* ignore */ }

  try {
    const clock = await apiJson('/api/peer/clock');
    const rttEl = document.getElementById('peerRtt');
    const offsetEl = document.getElementById('peerClockOffset');
    if (rttEl) rttEl.textContent = clock.lastRttMs > 0 ? clock.lastRttMs + 'ms' : 'Not measured';
    if (offsetEl) {
      if (clock.peerClockSynced) {
        offsetEl.textContent = clock.peerClockOffset + 'ms';
      } else {
        offsetEl.textContent = 'Not synced';
      }
    }
  } catch (_) { /* ignore */ }
}

async function sendPeerCommand(endpoint, button) {
  const resultEl = document.getElementById('peerResult');

  resultEl.style.display = 'block';
  resultEl.textContent = 'Sending...';

  if (button) button.disabled = true;

  try {
    const response = await fetch(endpoint, { method: 'POST' });
    const data = await response.json().catch(() => ({}));
    resultEl.textContent = 'HTTP ' + response.status + ' ' + response.statusText + '\n\n' + JSON.stringify(data, null, 2);
    await refreshPeerStatus();
  } catch (err) {
    resultEl.textContent = 'Error: ' + err.message;
  } finally {
    if (button) button.disabled = false;
  }
}

// EVENT LISTENERS
document.getElementById('tapNfc').addEventListener('click', startNfcListen);
document.getElementById('refreshRiders').addEventListener('click', loadRiders);
document.getElementById('refreshResults').addEventListener('click', loadStatus);
document.getElementById('refreshFiles').addEventListener('click', () => loadFiles(currentFilePath));
document.getElementById('browseFilePath').addEventListener('click', () => loadFiles(document.getElementById('filePath').value));
document.getElementById('filePath').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') loadFiles(event.target.value);
});

document.getElementById('saveWifiConfig').addEventListener('click', saveWifiConfig);
document.getElementById('savePeerConfig').addEventListener('click', savePeerConfig);

document.getElementById('testStatus').addEventListener('click', () => testApiEndpoint('status'));
document.getElementById('testRiders').addEventListener('click', () => testApiEndpoint('riders'));
document.getElementById('testPing').addEventListener('click', () => testApiEndpoint('ping'));
document.querySelectorAll('.doc-tab').forEach((button) => {
  button.addEventListener('click', () => loadDoc(button));
});

document.getElementById('rebootBtn').addEventListener('click', rebootDevice);
document.getElementById('factoryResetBtn').addEventListener('click', factoryReset);
document.getElementById('clearRidersBtn').addEventListener('click', clearAllRiders);
document.getElementById('downloadConfig').addEventListener('click', downloadConfig);
document.getElementById('restoreConfigFile').addEventListener('change', (e) => {
  if (e.target.files.length > 0) restoreConfig(e.target.files[0]);
  e.target.value = '';  // allow re-selecting same file
});
document.querySelectorAll('[data-peer-command]').forEach((button) => {
  button.addEventListener('click', () => sendPeerCommand(button.dataset.peerCommand, button));
});

// Initialize
const initialPage = window.location.hash.slice(1);
if (initialPage && PAGES.includes(initialPage)) {
  navigateTo(initialPage);
}

loadStatus();
loadRiders();
loadNetworkConfig();

Object.assign(globalThis, {
  loadStatus,
  loadRiders,
  loadFiles,
  loadNetworkConfig,
  sendPeerCommand
});
