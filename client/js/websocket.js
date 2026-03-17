import { S, connDot, connLabel, sbWs } from './state.js';

let _onInputSend = null;
export function setOnInputSend(fn) { _onInputSend = fn; }

export function setWsStatus(online) {
  connDot.className = 'meta-dot' + (online ? ' live' : ' dead');
  connLabel.textContent = online ? 'ONLINE' : 'OFFLINE';
  sbWs.textContent = online ? 'WS LIVE' : 'WS OFFLINE';
  sbWs.className = 'sb-item' + (online ? ' sb-ok' : ' sb-warn');
}

export function wsSend(obj) {
  if (obj.type === 'input' && obj.sessionId && _onInputSend) _onInputSend(obj.sessionId);
  if (S.ws && S.ws.readyState === WebSocket.OPEN) S.ws.send(JSON.stringify(obj));
}

export function connect(messageHandler) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  S.ws = new WebSocket(`${proto}//${location.host}`);

  S.ws.onopen = () => { setWsStatus(true); S.wsJustReconnected = true; };

  S.ws.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    messageHandler(msg);
  };

  S.ws.onclose = () => {
    setWsStatus(false);
    setTimeout(() => connect(messageHandler), S.wsReconnectInterval);
  };

  S.ws.onerror = () => setWsStatus(false);
}
