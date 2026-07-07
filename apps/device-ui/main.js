// PAGE NAVIGATION (hash-based)
const PAGES = ['results', 'riders', 'config-network', 'config-gate', 'config-reset', 'docs', 'peer-tools'];
let currentRole = null;

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
  if (activePage && pageRequiresStart(activePage)) {
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
    document.getElementById('statusConnected').textContent = espNow.connected ? '✓ Yes' : '✗ No';
    document.getElementById('topConnection').textContent = espNow.connected ? 'Peer connected' : 'Peer not connected';
    const peerToolMac = document.getElementById('peerToolMac');
    const peerToolStatus = document.getElementById('peerToolStatus');
    if (peerToolMac) peerToolMac.textContent = espNow.peerMac || 'Not configured';
    if (peerToolStatus) peerToolStatus.textContent = espNow.connected ? 'Connected' : 'Not connected';

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

    // Fetch persisted completed runs from LittleFS
    let recentRuns = [];
    try {
      recentRuns = await apiJson('/api/runs?limit=10');
    } catch (_) { /* ignore if not available */ }

    renderAttempts(status.queue || [], recentRuns);
  } catch (err) {
    console.error('Failed to load status:', err);
  }
}

function renderAttempts(liveQueue, recentRuns) {
  const container = document.getElementById('attempts');
  container.replaceChildren();

  // Show active/queued runs from live queue (non-finished)
  const activeRuns = liveQueue.filter(a => String(a.status).toLowerCase() !== 'finished');
  // Finished runs from live queue (just completed, not yet persisted)
  const liveFinished = liveQueue.filter(a => String(a.status).toLowerCase() === 'finished');

  // Merge: live finished + persisted runs, dedup by runId, newest first, cap at 10
  const seenIds = new Set();
  const completedRuns = [];
  for (const run of liveFinished) {
    if (!seenIds.has(run.runId)) {
      seenIds.add(run.runId);
      completedRuns.push({
        riderName: run.riderName || run.riderId,
        status: 'Finished',
        reactionMs: run.metrics?.reactionMs ?? null,
        launchMs: run.metrics?.launchMs ?? null,
        courseMs: run.metrics?.courseMs ?? null,
        falseStart: false
      });
    }
  }
  // Persisted runs are newest-last from the API; reverse to get newest first
  for (const run of [...recentRuns].reverse()) {
    if (!seenIds.has(run.runId)) {
      seenIds.add(run.runId);
      completedRuns.push(run);
    }
  }
  // Cap at 10
  completedRuns.splice(10);

  if (activeRuns.length === 0 && completedRuns.length === 0) {
    const p = document.createElement('p');
    p.style.cssText = 'color: var(--muted); padding: 20px 0; text-align: center;';
    p.textContent = 'No attempts yet';
    container.appendChild(p);
    return;
  }

  // Render active runs first
  for (const attempt of activeRuns) {
    container.appendChild(renderAttemptCard(
      attempt.riderName || attempt.riderId,
      attempt.status,
      attempt.metrics?.reactionMs,
      attempt.metrics?.launchMs,
      attempt.metrics?.courseMs,
      false
    ));
  }

  // Render completed runs
  for (const run of completedRuns) {
    container.appendChild(renderAttemptCard(
      run.riderName || run.riderId || '—',
      run.falseStart ? 'False Start' : 'Finished',
      run.reactionMs,
      run.launchMs,
      run.courseMs,
      run.falseStart
    ));
  }
}

function renderAttemptCard(name, status, reactionMs, launchMs, courseMs, falseStart) {
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

  // Gate Time: reaction from GO to start trigger (negative if false start)
  let gateTimeMs = reactionMs;
  let gateLabel = 'Gate Time';
  let gateDisplay = formatMs(gateTimeMs);
  if (falseStart && gateTimeMs != null) {
    gateDisplay = '+5.000s';
    gateLabel = 'Penalty';
  }

  // Course Time: start trigger to finish (pure sensor-to-sensor)
  const courseDisplay = formatMs(courseMs);

  // Total: GO to finish with penalties
  let totalMs = null;
  if (reactionMs != null && courseMs != null) {
    totalMs = reactionMs + courseMs + (falseStart ? 5000 : 0);
  }
  const totalDisplay = formatMs(totalMs);

  const metricsDiv = document.createElement('div');
  metricsDiv.className = 'metrics';
  for (const [label, value, display] of [
    [gateLabel, gateTimeMs, gateDisplay],
    ['Course', courseMs, courseDisplay],
    ['Total', totalMs, totalDisplay]
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

  article.appendChild(info);
  article.appendChild(metricsDiv);
  return article;
}

function formatMs(value) {
  if (value == null) return 'Pending';
  return (value / 1000).toFixed(3) + 's';
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

// NETWORK CONFIG PAGE
async function loadNetworkConfig() {
  try {
    const config = await apiJson('/api/config');

    document.getElementById('apSsid').value = config.deviceId || '';
    document.getElementById('staSsid').value = config.staSsid || '';
    document.getElementById('wifiChannel').value = config.wifiChannel || 1;
    document.getElementById('startThreshold').value = config.startThreshold || 0.85;
    document.getElementById('line2Threshold').value = config.line2Threshold || 0.85;
    document.getElementById('finishThreshold').value = config.finishThreshold || 0.85;
    document.getElementById('peerMac').value = config.peerMac || '';
    document.getElementById('gateNumber').value = String(config.gateNumber ?? 1);

    const deltaEl = document.getElementById('currentDelta');
    if (deltaEl && config.triggerDelta != null) deltaEl.textContent = config.triggerDelta.toFixed(2);

    updateSliderValues();
  } catch (err) {
    console.error('Failed to load config:', err);
  }
}

function updateSliderValues() {
  document.getElementById('startThresholdValue').textContent =
    document.getElementById('startThreshold').value;
  document.getElementById('line2ThresholdValue').textContent =
    document.getElementById('line2Threshold').value;
  document.getElementById('finishThresholdValue').textContent =
    document.getElementById('finishThreshold').value;
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

async function startSensorCalibration() {
  const btn = document.getElementById('calibrateAllBtn');
  const statusEl = document.getElementById('calibrationStatus');
  const msgEl = document.getElementById('calMessage');
  btn.disabled = true;
  statusEl.style.display = 'block';
  msgEl.textContent = 'Starting calibration...';

  try {
    await fetch('/api/calibrate', { method: 'POST' });
  } catch (err) {
    msgEl.textContent = 'Error: ' + err.message;
    btn.disabled = false;
    return;
  }

  const poll = setInterval(async () => {
    try {
      const res = await fetch('/api/calibrate/status');
      const data = await res.json();
      msgEl.textContent = data.message;
      const deltaEl = document.getElementById('currentDelta');
      if (deltaEl && data.triggerDelta != null) deltaEl.textContent = data.triggerDelta.toFixed(2);
      if (data.phase === 'done' || data.phase === 'idle') {
        clearInterval(poll);
        btn.disabled = false;
        setTimeout(() => { statusEl.style.display = 'none'; }, 5000);
      }
    } catch (_) { /* ignore transient fetch errors */ }
  }, 1000);
}

async function saveSensorConfig() {
  const config = {
    startThreshold: parseFloat(document.getElementById('startThreshold').value),
    line2Threshold: parseFloat(document.getElementById('line2Threshold').value),
    finishThreshold: parseFloat(document.getElementById('finishThreshold').value)
  };

  await saveJsonConfig('/api/config/time', config, 'sensorMessage', '✓ Saved!');
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

    // Apply sensor thresholds
    const timePayload = {};
    if (config.startThreshold !== undefined) timePayload.startThreshold = config.startThreshold;
    if (config.finishThreshold !== undefined) timePayload.finishThreshold = config.finishThreshold;
    if (config.line2Threshold !== undefined) timePayload.line2Threshold = config.line2Threshold;

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
async function sendPeerCommand(endpoint, button) {
  const resultEl = document.getElementById('peerResult');

  resultEl.style.display = 'block';
  resultEl.textContent = 'Sending...';

  if (button) button.disabled = true;

  try {
    const response = await fetch(endpoint, { method: 'POST' });
    const data = await response.json().catch(() => ({}));
    resultEl.textContent = 'HTTP ' + response.status + ' ' + response.statusText + '\n\n' + JSON.stringify(data, null, 2);
    await loadStatus();
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

document.getElementById('saveWifiConfig').addEventListener('click', saveWifiConfig);
document.getElementById('saveSensorConfig').addEventListener('click', saveSensorConfig);
document.getElementById('savePeerConfig').addEventListener('click', savePeerConfig);

document.getElementById('startThreshold').addEventListener('input', updateSliderValues);
document.getElementById('line2Threshold').addEventListener('input', updateSliderValues);
document.getElementById('finishThreshold').addEventListener('input', updateSliderValues);

document.getElementById('calibrateAllBtn').addEventListener('click', startSensorCalibration);

document.getElementById('testStatus').addEventListener('click', () => testApiEndpoint('status'));
document.getElementById('testRiders').addEventListener('click', () => testApiEndpoint('riders'));
document.getElementById('testPing').addEventListener('click', () => testApiEndpoint('ping'));

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
  loadNetworkConfig,
  sendPeerCommand
});
