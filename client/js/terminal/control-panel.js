// Control Panel — 플로팅 버튼 + 미니 대시보드 패널
const CONTROL_PORT = 3001;
let controlWs = null;
let panelOpen = false;
const floatingBtn = document.getElementById('control-floating-btn');
const controlPanel = document.getElementById('control-panel');
const cpBadge = document.getElementById('cp-badge');
const cpUptime = document.getElementById('cp-uptime');
const cpSessions = document.getElementById('cp-sessions');
const cpCpu = document.getElementById('cp-cpu');
const cpMemory = document.getElementById('cp-memory');
const cpBtnStop = document.getElementById('cp-btn-stop');
const cpBtnRestart = document.getElementById('cp-btn-restart');
const cpBtnLogs = document.getElementById('cp-btn-logs');

function formatUptime(ms) {
  if (!ms) return '—';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}
function formatBytes(b) {
  if (!b) return '—';
  return (b / 1024 / 1024).toFixed(0) + 'MB';
}

function connectControlWS() {
  controlWs = new WebSocket(`ws://127.0.0.1:${CONTROL_PORT}/ws`);
  controlWs.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'status') {
      updatePanel(msg);
    }
  };
  controlWs.onclose = () => setTimeout(connectControlWS, 5000);
  controlWs.onerror = () => controlWs.close();
}

function updatePanel(s) {
  if (!cpBadge) return;
  cpBadge.textContent = s.running ? 'ON' : s.starting ? 'STARTING' : 'OFF';
  cpBadge.className = `cp-badge ${s.running ? 'on' : s.starting ? 'starting' : 'off'}`;
  cpUptime.textContent = formatUptime(s.uptime);
  cpSessions.textContent = s.sessions || 0;
  cpCpu.textContent = s.cpu ? s.cpu + '%' : '—';
  cpMemory.textContent = formatBytes(s.memory);
}

function togglePanel() {
  panelOpen = !panelOpen;
  controlPanel.classList.toggle('open', panelOpen);
}

async function controlApiCall(endpoint) {
  try {
    const res = await fetch(`http://127.0.0.1:${CONTROL_PORT}/api/${endpoint}`, { method: 'POST' });
    if (!res.ok) {
      const d = await res.json();
      console.error('[control]', d.error);
    }
  } catch (err) {
    console.error('[control]', err.message);
  }
}

// 이벤트 바인딩
if (floatingBtn) {
  floatingBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePanel();
  });
}
if (cpBtnStop) cpBtnStop.addEventListener('click', () => controlApiCall('stop'));
if (cpBtnRestart) cpBtnRestart.addEventListener('click', () => controlApiCall('restart'));
if (cpBtnLogs) cpBtnLogs.addEventListener('click', () => {
  window.open(`http://127.0.0.1:${CONTROL_PORT}`, '_blank');
});

// 패널 밖 클릭 시 닫기
document.addEventListener('click', (e) => {
  if (panelOpen && controlPanel && !controlPanel.contains(e.target) && e.target !== floatingBtn) {
    panelOpen = false;
    controlPanel.classList.remove('open');
  }
});

export function initControlPanel() {
  connectControlWS();
}
