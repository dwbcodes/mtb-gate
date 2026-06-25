// TAB NAVIGATION
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const tabName = e.target.dataset.tab;

    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(tab => {
      tab.classList.remove('active');
    });
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.remove('active');
    });

    // Show selected tab
    document.getElementById(tabName + '-tab').classList.add('active');
    e.target.classList.add('active');
  });
});

// RIDERS TAB
async function loadRiders() {
  try {
    const response = await fetch('/api/riders');
    const riders = await response.json();
    renderRidersList(riders);
  } catch (err) {
    console.error('Failed to load riders:', err);
  }
}

function renderRidersList(riders) {
  const list = document.querySelector("#rosterList");
  list.innerHTML = "";
  if (riders.length === 0) {
    const p = document.createElement("p");
    p.style.color = "var(--muted)";
    p.textContent = "No riders registered yet";
    list.appendChild(p);
    return;
  }
  for (const rider of riders) {
    const item = document.createElement("div");
    item.className = "roster-item";
    const inner = document.createElement("div");
    inner.style.flex = "1";
    const name = document.createElement("strong");
    name.textContent = rider.displayName;
    const id = document.createElement("div");
    id.style.cssText = "font-family: monospace; font-size: 0.85em; color: var(--muted); margin-top: 4px;";
    id.textContent = "ID: " + rider.tagId;
    inner.appendChild(name);
    inner.appendChild(id);
    item.appendChild(inner);
    list.appendChild(item);
  }
}

async function startNfcListen() {
  const btn = document.getElementById("tapNfc");
  const statusEl = document.getElementById("nfcStatus");

  btn.disabled = true;
  btn.textContent = "Listening for 15s...";
  statusEl.textContent = "Hold card near device...";

  try {
    // Tell device to start listening for NFC tags
    const listenResponse = await fetch('/api/nfc/listen', { method: 'POST' });
    if (!listenResponse.ok) {
      const errorData = await listenResponse.json().catch(() => ({}));
      throw new Error(errorData.error || `Failed to start NFC listening (${listenResponse.status})`);
    }

    // Poll for scanned tag
    let tagId = null;
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch('/api/nfc/tag');
        const data = await response.json();
        if (data.ok && data.tagId) {
          tagId = data.tagId;
          clearInterval(pollInterval);
          btn.disabled = false;
          btn.textContent = "📱 Tap NFC";
          statusEl.textContent = "Card detected!";
          
          // Prompt for rider name only
          const displayName = prompt('Enter rider name for this card:');
          if (displayName && displayName.trim()) {
            registerRider(displayName.trim(), tagId);
            statusEl.textContent = "✓ Rider registered";
          } else {
            statusEl.textContent = "Cancelled";
          }
        }
      } catch (err) {
        console.error('Error checking for NFC tag:', err);
      }
    }, 500);

    // Stop listening after 15 seconds
    setTimeout(() => {
      clearInterval(pollInterval);
      btn.disabled = false;
      btn.textContent = "📱 Tap NFC";
      if (!tagId) {
        statusEl.textContent = "No card detected";
      }
    }, 15000);
  } catch (err) {
    console.error('Failed to start NFC listen:', err);
    btn.disabled = false;
    btn.textContent = "📱 Tap NFC";
    statusEl.textContent = "Error: " + err.message;
  }
}

async function registerRider(displayName, tagId) {
  try {
    const response = await fetch('/api/riders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tagId, displayName })
    });

    if (response.ok) {
      document.getElementById("nfcStatus").textContent = `✓ Registered: ${displayName}`;
      loadRiders();
    } else {
      const error = await response.json();
      document.getElementById("nfcStatus").textContent = `Error: ${error.error}`;
    }
  } catch (err) {
    console.error('Failed to register rider:', err);
    document.getElementById("nfcStatus").textContent = "Error registering rider";
  }
}

// RESULTS TAB
async function loadStatus() {
  try {
    const response = await fetch('/api/status');
    const status = await response.json();

    // Update headline
    document.getElementById("deviceLabel").textContent = status.deviceLabel || "Gate Control";
    document.getElementById("deviceRole").textContent = `${status.role || 'unknown'} gate`;

    // Update network status
    document.getElementById("statusDeviceId").textContent = status.deviceId;
    document.getElementById("statusMac").textContent = status.mac;
    document.getElementById("statusApSsid").textContent = status.apSsid;
    document.getElementById("statusApIp").textContent = status.apIp;
    document.getElementById("statusStaSsid").textContent = status.staSsid || "Not configured";
    document.getElementById("statusStaIp").textContent = status.staIp;
    const espNow = status.espNow || {};
    document.getElementById("statusPeerMac").textContent = espNow.peerMac || "Not configured";
    document.getElementById("statusConnected").textContent = espNow.connected ? "✓ Yes" : "✗ No";

    renderAttempts(status.queue || []);
  } catch (err) {
    console.error('Failed to load status:', err);
  }
}

function renderAttempts(attempts) {
  const container = document.querySelector("#attempts");
  container.innerHTML = "";
  if (attempts.length === 0) {
    const p = document.createElement("p");
    p.style.cssText = "color: var(--muted); padding: 20px 0; text-align: center;";
    p.textContent = "No attempts yet";
    container.appendChild(p);
    return;
  }
  for (const attempt of attempts) {
    const article = document.createElement("article");
    article.className = "attempt";

    const info = document.createElement("div");
    const h3 = document.createElement("h3");
    h3.textContent = attempt.riderName || attempt.riderId;
    const statusP = document.createElement("p");
    statusP.textContent = attempt.status;
    info.appendChild(h3);
    info.appendChild(statusP);

    const metrics = attempt.metrics || {};
    const metricsDiv = document.createElement("div");
    metricsDiv.className = "metrics";
    for (const [label, value] of [["Reaction", metrics.reactionMs], ["Launch", metrics.launchMs], ["Course", metrics.courseMs]]) {
      const cell = document.createElement("div");
      const span = document.createElement("span");
      span.textContent = label;
      const strong = document.createElement("strong");
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
  if (value == null) return "Pending";
  return `${(value / 1000).toFixed(3)}s`;
}

// NETWORK TAB - Wi-Fi Config
async function loadNetworkConfig() {
  try {
    const response = await fetch('/api/config');
    const config = await response.json();

    document.getElementById("staSsid").value = config.staSsid || "";
    document.getElementById("wifiChannel").value = config.wifiChannel || 1;
    document.getElementById("startThreshold").value = config.startThreshold || 0.85;
    document.getElementById("line2Threshold").value = config.line2Threshold || 0.85;
    document.getElementById("finishThreshold").value = config.finishThreshold || 0.85;
    document.getElementById("peerMac").value = config.peerMac || "";
    document.getElementById("gateNumber").value = config.gateNumber ?? 1;
    document.getElementById("peerDeviceLabel").value = config.deviceLabel || "";

    updateSliderValues();
  } catch (err) {
    console.error('Failed to load config:', err);
  }
}

function updateSliderValues() {
  document.getElementById("startThresholdValue").textContent =
    document.getElementById("startThreshold").value;
  document.getElementById("line2ThresholdValue").textContent =
    document.getElementById("line2Threshold").value;
  document.getElementById("finishThresholdValue").textContent =
    document.getElementById("finishThreshold").value;
}

async function saveWifiConfig() {
  const config = {
    apPassword: document.getElementById("apPassword").value,
    staSsid: document.getElementById("staSsid").value,
    staPassword: document.getElementById("staPassword").value,
    wifiChannel: parseInt(document.getElementById("wifiChannel").value)
  };

  try {
    const response = await fetch('/api/config/wifi', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });

    if (response.ok) {
      document.getElementById("wifiMessage").textContent = "✓ Saved! Device restarting Wi-Fi...";
      document.getElementById("apPassword").value = "";
      document.getElementById("staPassword").value = "";
    } else {
      const error = await response.json();
      document.getElementById("wifiMessage").textContent = `✗ Error: ${error.error}`;
    }
  } catch (err) {
    document.getElementById("wifiMessage").textContent = "✗ Failed to save";
  }
}

async function saveSensorConfig() {
  const config = {
    startThreshold: parseFloat(document.getElementById("startThreshold").value),
    line2Threshold: parseFloat(document.getElementById("line2Threshold").value),
    finishThreshold: parseFloat(document.getElementById("finishThreshold").value)
  };

  try {
    const response = await fetch('/api/config/time', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });

    if (response.ok) {
      document.getElementById("sensorMessage").textContent = "✓ Saved!";
    } else {
      const error = await response.json();
      document.getElementById("sensorMessage").textContent = `✗ Error: ${error.error}`;
    }
  } catch (err) {
    document.getElementById("sensorMessage").textContent = "✗ Failed to save";
  }
}

async function savePeerConfig() {
  const config = {
    peerMac: document.getElementById("peerMac").value,
    gateNumber: parseInt(document.getElementById("gateNumber").value, 10),
    deviceLabel: document.getElementById("peerDeviceLabel").value
  };

  try {
    const response = await fetch('/api/config/mac', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });

    if (response.ok) {
      document.getElementById("peerMessage").textContent = "✓ Saved!";
    } else {
      const error = await response.json();
      document.getElementById("peerMessage").textContent = `✗ Error: ${error.error}`;
    }
  } catch (err) {
    document.getElementById("peerMessage").textContent = "✗ Failed to save";
  }
}

// DOCUMENTS TAB
async function testApiEndpoint(endpoint) {
  const resultEl = document.getElementById("apiTestResult");
  resultEl.style.display = "block";
  resultEl.textContent = "Testing...";

  try {
    const options = endpoint === "ping" ? { method: 'POST' } : {};
    const response = await fetch(`/api/${endpoint}`, options);
    if (!response.ok) {
      resultEl.textContent = `Error: ${response.status} ${response.statusText}`;
      return;
    }
    const data = await response.json();
    resultEl.textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    resultEl.textContent = `Error: ${err.message}`;
  }
}

// RESET TAB
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
  if (!confirm('⚠️ Factory reset will erase ALL settings and riders. This cannot be undone. Continue?')) return;
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
    a.download = `mtb-gate-config-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// EVENT LISTENERS
document.getElementById("tapNfc").addEventListener("click", startNfcListen);
document.getElementById("refreshRiders").addEventListener("click", loadRiders);
document.getElementById("refreshResults").addEventListener("click", loadStatus);

// Network tab listeners
document.getElementById("saveWifiConfig").addEventListener("click", saveWifiConfig);
document.getElementById("saveSensorConfig").addEventListener("click", saveSensorConfig);
document.getElementById("savePeerConfig").addEventListener("click", savePeerConfig);

// Slider value updates
document.getElementById("startThreshold").addEventListener("input", updateSliderValues);
document.getElementById("line2Threshold").addEventListener("input", updateSliderValues);
document.getElementById("finishThreshold").addEventListener("input", updateSliderValues);

// Docs tab listeners
document.getElementById("testStatus").addEventListener("click", () => testApiEndpoint("status"));
document.getElementById("testRiders").addEventListener("click", () => testApiEndpoint("riders"));
document.getElementById("testPing").addEventListener("click", () => testApiEndpoint("ping"));

// Reset tab listeners
document.getElementById("rebootBtn").addEventListener("click", rebootDevice);
document.getElementById("factoryResetBtn").addEventListener("click", factoryReset);
document.getElementById("clearRidersBtn").addEventListener("click", clearAllRiders);
document.getElementById("downloadConfig").addEventListener("click", downloadConfig);

// Initialize on page load
loadStatus();
loadRiders();
loadNetworkConfig();

Object.assign(globalThis, {
  loadStatus,
  loadRiders,
  loadNetworkConfig
});
