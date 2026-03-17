export const S = {
  ws: null,
  activeSessionId: null,
  currentTheme: null,
  layoutTree: null,
  splitRoot: null,
  settings: null,
  pendingSettings: null,
  wsReconnectInterval: 3000,
  wsJustReconnected: false,
  pendingSplitQueue: [],
  ctxTargetId: null,
  folderCounter: 0,
};

export const terminalMap = new Map();
export const sessionMeta = new Map();
export const folderMap = new Map();

export const notifyBuffers = new Map();
export const notifyTimers = new Map();
export const notifyState = new Map();

export const connDot      = document.getElementById('conn-dot');
export const connLabel    = document.getElementById('conn-label');
export const hdrCount     = document.getElementById('hdr-session-count');
export const sessionList  = document.getElementById('session-list');
export const sessionEmpty = document.getElementById('session-empty');
export const tabBar       = document.getElementById('tab-bar');
export const tabAddBtn    = document.getElementById('tab-add-btn');
export const termWrapper  = document.getElementById('terminal-wrapper');
export const emptyState   = document.getElementById('empty-state');
export const dropOverlay  = document.getElementById('drop-zone-overlay');
export const dzZones      = dropOverlay.querySelectorAll('.dz');
export const sbActiveName = document.getElementById('sb-active-name');
export const sbCount      = document.getElementById('sb-count');
export const sbSize       = document.getElementById('sb-size');
export const sbWs         = document.getElementById('sb-ws');
export const sbClock      = document.getElementById('sb-clock');
export const ctxMenu      = document.getElementById('ctx-menu');
export const settingsOverlay = document.getElementById('settings-overlay');
export const customCssTag = document.getElementById('custom-css-tag');

export function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
