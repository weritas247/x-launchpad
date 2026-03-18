import { S, connDot, connLabel, sbWs } from './state.js';
import { showToast } from './toast.js';

let _onInputSend = null;
export function setOnInputSend(fn) { _onInputSend = fn; }

// ─── Connection health tracking ─────────────────────
let _heartbeatTimer = null;
let _pongTimer = null;
let _lastPong = 0;
let _wasConnected = false;
let _disconnectTime = 0;
const HEARTBEAT_INTERVAL = 5000;   // ping every 5s
const PONG_TIMEOUT = 8000;         // no pong within 8s = dead

export function setWsStatus(online) {
  connDot.className = 'meta-dot' + (online ? ' live' : ' dead');
  connLabel.textContent = online ? 'ONLINE' : 'OFFLINE';
  sbWs.textContent = online ? 'WS LIVE' : 'WS OFFLINE';
  sbWs.className = 'sb-item' + (online ? ' sb-ok' : ' sb-warn');
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
  if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
  if (_pongTimer) { clearTimeout(_pongTimer); _pongTimer = null; }
}

export function wsSend(obj) {
  if (obj.type === 'input' && obj.sessionId && _onInputSend) _onInputSend(obj.sessionId);
  if (S.ws && S.ws.readyState === WebSocket.OPEN) {
    S.ws.send(JSON.stringify(obj));
  } else {
    console.warn(`[WS] 메시지 전송 실패 (연결 안됨): ${obj.type}`);
  }
}

export function connect(messageHandler) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  S.ws = new WebSocket(`${proto}//${location.host}`);

  S.ws.onopen = () => {
    setWsStatus(true);
    S.wsJustReconnected = true;
    if (_wasConnected) alertReconnect();
    _wasConnected = true;
    startHeartbeat();
  };

  S.ws.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    // Handle pong from server
    if (msg.type === 'pong') {
      _lastPong = Date.now();
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
