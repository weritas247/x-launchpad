import { S, connDot, connLabel } from './state.js';
import { showToast } from './toast.js';

// ─── Latency UI elements ────────────────────────────
const _signalBars = document.querySelector('.signal-bars');
const _latencyValue = document.getElementById('latency-value');

let _onInputSend = null;
export function setOnInputSend(fn) {
  _onInputSend = fn;
}

// ─── Input batching ─────────────────────────────────
// Accumulate keystrokes within BATCH_WINDOW ms and send as a single frame
const INPUT_BATCH_WINDOW = 10; // ms
const _inputBatch = new Map(); // sessionId → { data: string, timer: number }

// ─── Input buffering (offline queue) ────────────────
// Queue input while disconnected, flush on reconnect
const _inputQueue = []; // { type, sessionId, data }
const INPUT_QUEUE_MAX = 200; // prevent unbounded growth

// ─── Connection health tracking ─────────────────────
let _heartbeatTimer = null;
let _pongTimer = null;
let _lastPong = 0;
let _wasConnected = false;
let _disconnectTime = 0;
const HEARTBEAT_INTERVAL = 5000; // ping every 5s
const PONG_TIMEOUT = 8000; // no pong within 8s = dead

function updateLatencyUI(rtt) {
  if (!_signalBars || !_latencyValue) return;
  let level;
  if (rtt < 50)
    level = 4; // excellent
  else if (rtt < 150)
    level = 3; // good
  else if (rtt < 300)
    level = 2; // fair
  else level = 1; // poor
  _signalBars.className = 'signal-bars level-' + level;
  _latencyValue.textContent = rtt + 'ms';
}

function resetLatencyUI() {
  if (_signalBars) _signalBars.className = 'signal-bars';
  if (_latencyValue) _latencyValue.textContent = '—';
}

export function setWsStatus(online) {
  connDot.className = 'meta-dot' + (online ? ' live' : ' dead');
  connLabel.textContent = online ? 'ONLINE' : 'OFFLINE';
  if (!online) resetLatencyUI();
}

function alertDisconnect(reason) {
  _disconnectTime = Date.now();
  showToast(`서버 연결 끊김: ${reason}`, 'error', 10000);
  console.error(`[WS] 연결 끊김 — ${reason} (${new Date().toLocaleTimeString()})`);
}

function alertReconnect() {
  const downSec = _disconnectTime ? ((Date.now() - _disconnectTime) / 1000).toFixed(1) : '?';
  showToast(`서버 재연결 성공 (${downSec}s 동안 끊김)`, 'success', 5000);
  console.log(`[WS] 재연결 성공 — ${downSec}s downtime (${new Date().toLocaleTimeString()})`);
  _disconnectTime = 0;
}

function startHeartbeat() {
  stopHeartbeat();
  _lastPong = Date.now();
  _heartbeatTimer = setInterval(() => {
    if (!S.ws || S.ws.readyState !== WebSocket.OPEN) return;
    S.ws.send(JSON.stringify({ type: 'ping', t: Date.now() }));
    // Check if server responded to previous ping
    if (Date.now() - _lastPong > PONG_TIMEOUT) {
      alertDisconnect('서버 응답 없음 (heartbeat timeout)');
      S.ws.close();
    }
  }, HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
  if (_heartbeatTimer) {
    clearInterval(_heartbeatTimer);
    _heartbeatTimer = null;
  }
  if (_pongTimer) {
    clearTimeout(_pongTimer);
    _pongTimer = null;
  }
}

function _rawSend(obj) {
  if (S.ws && S.ws.readyState === WebSocket.OPEN) {
    S.ws.send(JSON.stringify(obj));
    return true;
  }
  return false;
}

function _flushBatch(sessionId) {
  const batch = _inputBatch.get(sessionId);
  if (!batch) return;
  _inputBatch.delete(sessionId);
  if (!batch.data) return; // nothing accumulated — first key was already sent
  const msg = { type: 'input', sessionId, data: batch.data };
  if (!_rawSend(msg)) {
    _enqueueInput(msg);
  }
}

function _enqueueInput(msg) {
  if (_inputQueue.length >= INPUT_QUEUE_MAX) {
    _inputQueue.shift(); // drop oldest to stay bounded
  }
  _inputQueue.push(msg);
}

function _flushInputQueue() {
  while (_inputQueue.length > 0) {
    const msg = _inputQueue.shift();
    if (!_rawSend(msg)) {
      _inputQueue.unshift(msg); // put it back, still offline
      break;
    }
  }
}

export function wsSend(obj) {
  if (obj.type === 'input' && obj.sessionId && _onInputSend) _onInputSend(obj.sessionId);

  // Input messages: send first immediately, batch subsequent within window
  if (obj.type === 'input' && obj.sessionId) {
    if (S.ws && S.ws.readyState === WebSocket.OPEN) {
      const existing = _inputBatch.get(obj.sessionId);
      if (existing) {
        // Subsequent keystrokes within batch window — accumulate
        existing.data += obj.data;
      } else {
        // First keystroke — send immediately for responsiveness
        _rawSend(obj);
        // Open batch window for any rapid follow-up keystrokes
        _inputBatch.set(obj.sessionId, { data: '' });
        setTimeout(() => _flushBatch(obj.sessionId), INPUT_BATCH_WINDOW);
      }
    } else {
      // Offline: queue for later
      _enqueueInput(obj);
      console.warn(`[WS] 입력 버퍼링 (연결 안됨, 큐: ${_inputQueue.length})`);
    }
    return;
  }

  // Non-input messages: send directly
  if (!_rawSend(obj)) {
    console.warn(`[WS] 메시지 전송 실패 (연결 안됨): ${obj.type}`);
  }
}

const _textDecoder = new TextDecoder();

export function getAuthToken() {
  const urlParams = new URLSearchParams(location.search);
  return urlParams.get('token') || localStorage.getItem('super-terminal-token') || '';
}

export function apiFetch(url, options = {}) {
  const token = getAuthToken();
  if (token) {
    options.headers = { Authorization: `Bearer ${token}`, ...options.headers };
  }
  return fetch(url, options);
}

export function requestScrollback(sessionId) {
  if (S.ws && S.ws.readyState === WebSocket.OPEN) {
    S.ws.send(JSON.stringify({ type: 'scrollback_request', sessionId }));
  }
}

export function connect(messageHandler) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  // Pass auth token to WebSocket if present
  const urlParams = new URLSearchParams(location.search);
  const token = urlParams.get('token') || localStorage.getItem('super-terminal-token') || '';
  const wsUrl = token
    ? `${proto}//${location.host}?token=${encodeURIComponent(token)}`
    : `${proto}//${location.host}`;
  S.ws = new WebSocket(wsUrl);

  S.ws.onopen = () => {
    setWsStatus(true);
    S.wsJustReconnected = true;
    if (_wasConnected) {
      alertReconnect();
      // Flush any input that was queued while disconnected
      if (_inputQueue.length > 0) {
        console.log(`[WS] 재연결 — 버퍼된 입력 ${_inputQueue.length}건 전송`);
        setTimeout(() => _flushInputQueue(), 100); // slight delay to let session reattach
      }
    }
    _wasConnected = true;
    startHeartbeat();
  };

  S.ws.onmessage = (event) => {
    // Control WS only receives JSON — terminal I/O goes through per-session data WS
    if (event.data instanceof ArrayBuffer) return; // ignore binary on control WS
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    // Handle pong from server — measure RTT
    if (msg.type === 'pong') {
      _lastPong = Date.now();
      if (msg.t) {
        const rtt = Date.now() - msg.t;
        updateLatencyUI(rtt);
      }
      return;
    }
    messageHandler(msg);
  };

  S.ws.onclose = (e) => {
    stopHeartbeat();
    setWsStatus(false);
    if (_wasConnected && !_disconnectTime) {
      alertDisconnect(`연결 종료 (code: ${e.code})`);
    }
    setTimeout(() => connect(messageHandler), S.wsReconnectInterval);
  };

  S.ws.onerror = (e) => {
    setWsStatus(false);
    console.error(`[WS] 에러 발생:`, e);
    if (_wasConnected && !_disconnectTime) {
      alertDisconnect('WebSocket 에러');
    }
  };
}
