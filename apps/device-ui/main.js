// PAGE NAVIGATION (hash-based)
const PAGES = ['results', 'riders', 'config-network', 'config-gate', 'config-reset', 'docs', 'peer-tools'];

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

  PAGES.forEach(p => {
    const el = document.getElementById('page-' + p);
    if (el) el.classList.toggle('active', p === page);
  });

  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.toggle('active', link.dataset.page === page);
  });
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

    document.getElementById('deviceLabel').textContent = status.deviceLabel || 'Gate Control';
    document.getElementById('deviceRole').textContent = (status.role || 'unknown') + ' gate';

    document.getElementById('statusDeviceId').textContent = status.deviceId;
    document.getElementById('statusMac').textContent = status.mac;
    document.getElementById('statusApSsid').textContent = status.apSsid;
    document.getElementById('statusApIp').textContent = status.apIp;
    document.getElementById('statusStaSsid').textContent = status.staSsid || 'Not configured';
    document.getElementById('statusStaIp').textContent = status.staIp;

    const espNow = status.espNow || {};
    document.getElementById('statusPeerMac').textContent = espNow.peerMac || 'Not configured';
    document.getElementById('statusConnected').textContent = espNow.connected ? '✓ Yes' : '✗ No';

    const navId = document.getElementById('navDeviceId');
    if (navId) navId.textContent = status.deviceId || '';

    const isStart = status.role === 'start';
    document.getElementById('sectionConnectedGates').style.display = isStart ? 'none' : '';
    if (!isStart) {
      document.getElementById('connectedStartMac').textContent = espNow.peerMac || 'Not yet discovered';
    }

    renderAttempts(status.queue || []);
  } catch (err) {
    console.error('Failed to load status:', err);
  }
}

function renderAttempts(attempts) {
  const container = document.getElementById('attempts');
  container.replaceChildren();

  if (attempts.length === 0) {
    const p = document.createElement('p');
    p.style.cssText = 'color: var(--muted); padding: 20px 0; text-align: center;';
    p.textContent = 'No attempts yet';
    container.appendChild(p);
    return;
  }

  for (const attempt of attempts) {
    const article = document.createElement('article');
    article.className = 'attempt';

    const info = document.createElement('div');
    const h3 = document.createElement('h3');
    h3.textContent = attempt.riderName || attempt.riderId;
    const statusP = document.createElement('p');
    statusP.textContent = attempt.status;
    info.appendChild(h3);
    info.appendChild(statusP);

    const metrics = attempt.metrics || {};
    const metricsDiv = document.createElement('div');
    metricsDiv.className = 'metrics';
    for (const [label, value] of [['Reaction', metrics.reactionMs], ['Launch', metrics.launchMs], ['Course', metrics.courseMs]]) {
      const cell = document.createElement('div');
      const span = document.createElement('span');
      span.textContent = label;
      const strong = document.createElement('strong');
      strong.textContent = formatMs(value);
      cell.appendChild(span);
      cell.appendChild(strong);
      metricsDiv.appendChild(cell);
    }

    article.appendChild(info);
    article.appendChild(metricsDiv);
    container.appendChild(article);
  }
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

  for (const rider of riders) {
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
          btn.textContent = '📱 Tap NFC';
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
      btn.textContent = '📱 Tap NFC';
      if (!tagId) {
        statusEl.textContent = 'No card detected';
      }
    }, 15000);
  } catch (err) {
    console.error('Failed to start NFC listen:', err);
    btn.disabled = false;
    btn.textContent = '📱 Tap NFC';
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

// PEER TOOLS PAGE
function fillPeerForm(method, path, body) {
  const urlInput = document.getElementById('peerUrl');
  const current = urlInput.value;
  // Preserve the base URL (origin) if already set, else default to empty origin
  let base = '';
  try {
    if (current) {
      const parsed = new URL(current);
      base = parsed.origin;
    }
  } catch (_) { /* ignore */ }

  document.getElementById('peerMethod').value = method;
  urlInput.value = base + path;
  document.getElementById('peerBody').value = body;
  urlInput.focus();
}

async function sendPeerRequest() {
  const method = document.getElementById('peerMethod').value;
  const url = document.getElementById('peerUrl').value.trim();
  const body = document.getElementById('peerBody').value.trim();
  const resultEl = document.getElementById('peerResult');

  if (!url) {
    resultEl.style.display = 'block';
    resultEl.textContent = 'Error: Target URL is required';
    return;
  }

  resultEl.style.display = 'block';
  resultEl.textContent = 'Sending...';

  const options = { method };
  if (body && (method === 'POST' || method === 'PUT')) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = body;
  }

  try {
    const response = await fetch(url, options);
    let text;
    const ct = response.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const data = await response.json();
      text = JSON.stringify(data, null, 2);
    } else {
      text = await response.text();
    }
    resultEl.textContent = 'HTTP ' + response.status + ' ' + response.statusText + '\n\n' + text;
  } catch (err) {
    resultEl.textContent = 'Error: ' + err.message +
      '\n\nNote: Cross-origin requests require both gates to be on the same station network, ' +
      'or the peer gate to send CORS headers.';
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

document.getElementById('testStatus').addEventListener('click', () => testApiEndpoint('status'));
document.getElementById('testRiders').addEventListener('click', () => testApiEndpoint('riders'));
document.getElementById('testPing').addEventListener('click', () => testApiEndpoint('ping'));

document.getElementById('rebootBtn').addEventListener('click', rebootDevice);
document.getElementById('factoryResetBtn').addEventListener('click', factoryReset);
document.getElementById('clearRidersBtn').addEventListener('click', clearAllRiders);
document.getElementById('downloadConfig').addEventListener('click', downloadConfig);
document.getElementById('sendPeerRequest').addEventListener('click', sendPeerRequest);

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
  fillPeerForm
});
