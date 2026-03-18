import { S, terminalMap, customCssTag, settingsOverlay, escHtml } from './state.js';
import { confirmModal } from './confirm-modal.js';
import { THEMES, KB_DEFS, normalizeKey } from './constants.js';
import { applyTheme, updateSwatches } from './themes.js';
import { apiFetch } from './websocket.js';

export async function loadSettings() {
  try {
    const r = await apiFetch('/api/settings');
    S.settings = r.ok ? await r.json() : null;
  } catch {
    S.settings = null;
  }
  if (S.settings) applySettings(S.settings);
}

export async function saveSettingsToServer(s) {
  await apiFetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(s),
  });
}

export function applySettings(s) {
  S.settings = s;

  const t = THEMES.find(x => x.id === s.appearance.theme) || THEMES[0];
  applyTheme(t);

  applyEffects(s.appearance);
  applySectionFontSizes(s.appearance);

  customCssTag.textContent = s.advanced?.customCss || '';

  S.wsReconnectInterval = s.advanced?.wsReconnectInterval || 3000;

  terminalMap.forEach(({ term, fitAddon }) => {
    applyTerminalOptions(term, s);
    fitAddon.fit();
  });
}

export function applyEffects(ap) {
  const scanlines = ap.crtScanlines !== false;
  const intensity = ap.crtScanlinesIntensity ?? 0.07;
  document.body.style.setProperty('--scanline-intensity', intensity);
  const beforeRule = scanlines
    ? `repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,${intensity}) 2px,rgba(0,0,0,${intensity}) 4px)`
    : 'none';
  let scanlineStyle = document.getElementById('scanline-style');
  if (!scanlineStyle) { scanlineStyle = document.createElement('style'); scanlineStyle.id='scanline-style'; document.head.appendChild(scanlineStyle); }
  scanlineStyle.textContent = `body::before { background: ${beforeRule} !important; }`;

  const vig = ap.vignette !== false;
  let vigStyle = document.getElementById('vignette-style');
  if (!vigStyle) { vigStyle = document.createElement('style'); vigStyle.id='vignette-style'; document.head.appendChild(vigStyle); }
  vigStyle.textContent = vig ? '' : 'body::after { display: none !important; }';

  const flicker = ap.crtFlicker !== false;
  let flickerStyle = document.getElementById('flicker-style');
  if (!flickerStyle) { flickerStyle = document.createElement('style'); flickerStyle.id='flicker-style'; document.head.appendChild(flickerStyle); }
  flickerStyle.textContent = flicker ? '' : '#terminal-wrapper { animation: none !important; }';

  const dimOpacity = ap.screenDimOpacity ?? 0;
  let dimStyle = document.getElementById('dim-style');
  if (!dimStyle) {
    dimStyle = document.createElement('style');
    dimStyle.id = 'dim-style';
    document.head.appendChild(dimStyle);
  }
  dimStyle.textContent = `#screen-dim { opacity: ${dimOpacity}; }`;
}

export function applyTerminalOptions(term, s) {
  const ap = s.appearance;
  term.options.fontSize = ap.fontSize || 14;
  term.options.lineHeight = ap.lineHeight || 1.2;
  term.options.fontFamily = ap.fontFamily || '"JetBrains Mono",monospace';
  term.options.cursorStyle = ap.cursorStyle || 'block';
  term.options.cursorBlink = ap.cursorBlink !== false;
  term.options.scrollback = s.terminal?.scrollback || 5000;
  term.options.theme = S.currentTheme.term;
}

export function applySectionFontSizes(ap) {
  const root = document.documentElement;
  root.style.setProperty('--sidebar-font-size', (ap.sidebarFontSize ?? 12) + 'px');
  root.style.setProperty('--statusbar-font-size', (ap.statusBarFontSize ?? 11) + 'px');
  root.style.setProperty('--tabbar-font-size', (ap.tabBarFontSize ?? 12) + 'px');
  root.style.setProperty('--input-panel-font-size', (ap.inputPanelFontSize ?? 11) + 'px');
  root.style.setProperty('--file-viewer-font-size', (ap.fileViewerFontSize ?? 13) + 'px');
  root.style.setProperty('--git-graph-font-size', (ap.gitGraphFontSize ?? 12) + 'px');
}

export function openSettings() {
  S.pendingSettings = JSON.parse(JSON.stringify(S.settings || {}));
  populateForm(S.pendingSettings);
  settingsOverlay.classList.add('open');
  activateNavPanel('appearance');
}

export function closeSettings() {
  settingsOverlay.classList.remove('open');
  S.pendingSettings = null;
}

function buildThemeGrid(selectedId) {
  const grid = document.getElementById('theme-grid');
  grid.innerHTML = '';
  THEMES.forEach(t => {
    const card = document.createElement('div');
    card.className = 'theme-card' + (t.id === selectedId ? ' active' : '');
    card.dataset.themeId = t.id;
    card.innerHTML = `
      <div class="theme-card-swatch" style="background:linear-gradient(135deg,${t.colors[0]} 40%,${t.colors[1]})"></div>
      <div class="theme-card-name">${t.label}</div>
      <span class="theme-card-check">✓</span>
    `;
    card.addEventListener('click', () => {
      grid.querySelectorAll('.theme-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      S.pendingSettings.appearance.theme = t.id;
      applyTheme(t);
      updateSwatches();
    });
    grid.appendChild(card);
  });
}

function buildKbList(kb) {
  const list = document.getElementById('kb-list');
  list.innerHTML = '';
  KB_DEFS.forEach(def => {
    const row = document.createElement('div');
    row.className = 'kb-row';
    const input = document.createElement('input');
    input.className = 'kb-input';
    input.readOnly = true;
    input.value = kb[def.key] || '';
    input.title = 'Click to record shortcut';

    input.addEventListener('click', () => {
      input.classList.add('recording');
      input.value = 'Press keys...';
      const handler = (e) => {
        e.preventDefault();
        const parts = [];
        if (e.ctrlKey) parts.push('Ctrl');
        if (e.shiftKey) parts.push('Shift');
        if (e.altKey) parts.push('Alt');
        if (e.metaKey) parts.push('Meta');
        if (!['Control','Shift','Alt','Meta'].includes(e.key)) {
          parts.push(normalizeKey(e));
        }
        if (parts.length > 0 && !['Control','Shift','Alt','Meta'].includes(e.key)) {
          const combo = parts.join('+');
          input.value = combo;
          S.pendingSettings.keybindings[def.key] = combo;
          input.classList.remove('recording');
          document.removeEventListener('keydown', handler, true);
        }
      };
      document.addEventListener('keydown', handler, true);
      input.addEventListener('blur', () => {
        input.classList.remove('recording');
        document.removeEventListener('keydown', handler, true);
        if (input.value === 'Press keys...') input.value = kb[def.key] || '';
      }, { once: true });
    });

    row.innerHTML = `<span class="kb-label">${def.label}</span>`;
    row.appendChild(input);
    list.appendChild(row);
  });
}

function buildEnvList(env) {
  const list = document.getElementById('env-list');
  list.innerHTML = '';
  Object.entries(env || {}).forEach(([k, v]) => addEnvRow(k, v));
}

function addEnvRow(k='', v='') {
  const list = document.getElementById('env-list');
  const row = document.createElement('div');
  row.className = 'env-row';
  row.innerHTML = `
    <input class="env-key" placeholder="KEY" value="${escHtml(k)}"/>
    <input class="env-val" placeholder="value" value="${escHtml(v)}"/>
    <button class="env-remove">✕</button>
  `;
  row.querySelector('.env-remove').addEventListener('click', () => {
    row.remove();
    syncEnvToPending();
  });
  row.querySelector('.env-key').addEventListener('input', syncEnvToPending);
  row.querySelector('.env-val').addEventListener('input', syncEnvToPending);
  list.appendChild(row);
}

function syncEnvToPending() {
  const env = {};
  document.querySelectorAll('.env-row').forEach(row => {
    const k = row.querySelector('.env-key').value.trim();
    const v = row.querySelector('.env-val').value;
    if (k) env[k] = v;
  });
  if (S.pendingSettings) S.pendingSettings.shell.env = env;
}

function populateForm(s) {
  const ap = s.appearance;
  const te = s.terminal;
  const sh = s.shell;
  const kb = s.keybindings;
  const adv = s.advanced;

  buildThemeGrid(ap.theme);
  setSelectValue('s-fontFamily', ap.fontFamily);
  setRangeValue('s-fontSize', ap.fontSize, 'px');
  setRangeValue('s-lineHeight', ap.lineHeight, '');
  setSelectValue('s-cursorStyle', ap.cursorStyle);
  document.getElementById('s-cursorBlink').checked = ap.cursorBlink !== false;
  document.getElementById('s-crtScanlines').checked = ap.crtScanlines !== false;
  setRangeValue('s-crtScanlinesIntensity', ap.crtScanlinesIntensity, '');
  document.getElementById('s-crtFlicker').checked = ap.crtFlicker !== false;
  document.getElementById('s-vignette').checked = ap.vignette !== false;
  setRangeValue('s-glowIntensity', ap.glowIntensity, '');
  setRangeValue('s-backgroundOpacity', ap.backgroundOpacity, '');
  setRangeValue('s-screenDimOpacity', ap.screenDimOpacity ?? 0, '');
  updateFontPreview(ap.fontFamily, ap.fontSize);

  setRangeValue('s-sidebarFontSize', ap.sidebarFontSize ?? 12, 'px');
  setRangeValue('s-statusBarFontSize', ap.statusBarFontSize ?? 11, 'px');
  setRangeValue('s-tabBarFontSize', ap.tabBarFontSize ?? 12, 'px');
  setRangeValue('s-inputPanelFontSize', ap.inputPanelFontSize ?? 11, 'px');
  setRangeValue('s-fileViewerFontSize', ap.fileViewerFontSize ?? 13, 'px');
  setRangeValue('s-gitGraphFontSize', ap.gitGraphFontSize ?? 12, 'px');

  document.getElementById('s-scrollback').value = te.scrollback;
  setSelectValue('s-bellStyle', te.bellStyle);
  document.getElementById('s-copyOnSelect').checked = te.copyOnSelect;
  document.getElementById('s-rightClickPaste').checked = te.rightClickPaste;
  document.getElementById('s-trimCopied').checked = te.trimCopied;
  document.getElementById('s-wordSeparators').value = te.wordSeparators;
  setSelectValue('s-renderer', te.renderer);

  document.getElementById('s-shellPath').value = sh.shellPath;
  document.getElementById('s-startDirectory').value = sh.startDirectory;
  document.getElementById('s-sessionNameFormat').value = sh.sessionNameFormat;
  document.getElementById('s-autoReconnect').checked = sh.autoReconnect;
  buildEnvList(sh.env);

  buildKbList(kb);

  document.getElementById('s-customCss').value = adv.customCss || '';
  document.getElementById('s-wsReconnectInterval').value = adv.wsReconnectInterval;
  setSelectValue('s-logLevel', adv.logLevel);
}

function setSelectValue(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  for (let i = 0; i < el.options.length; i++) {
    if (el.options[i].value === String(val)) { el.selectedIndex = i; return; }
  }
}

function setRangeValue(id, val, _unit) {
  const range = document.getElementById(id);
  const display = document.getElementById(id + '-val');
  const numInput = document.getElementById(id + '-num');
  if (!range) return;
  range.value = val;
  if (display) display.textContent = parseFloat(val).toFixed(val < 1 ? 2 : (val % 1 === 0 ? 0 : 1));
  if (numInput) numInput.value = val;
}

function updateFontPreview(fontFamily, fontSize) {
  const preview = document.getElementById('font-preview');
  if (preview) {
    preview.style.fontFamily = fontFamily;
    preview.style.fontSize = (fontSize || 13) + 'px';
  }
}

function readForm() {
  const s = S.pendingSettings;

  s.appearance.fontFamily = document.getElementById('s-fontFamily').value;
  const fontSizeNumEl = document.getElementById('s-fontSize-num');
  s.appearance.fontSize = parseInt(fontSizeNumEl ? fontSizeNumEl.value : document.getElementById('s-fontSize').value) || 14;
  s.appearance.lineHeight = parseFloat(document.getElementById('s-lineHeight').value);
  s.appearance.cursorStyle = document.getElementById('s-cursorStyle').value;
  s.appearance.cursorBlink = document.getElementById('s-cursorBlink').checked;
  s.appearance.crtScanlines = document.getElementById('s-crtScanlines').checked;
  s.appearance.crtScanlinesIntensity = parseFloat(document.getElementById('s-crtScanlinesIntensity').value);
  s.appearance.crtFlicker = document.getElementById('s-crtFlicker').checked;
  s.appearance.vignette = document.getElementById('s-vignette').checked;
  s.appearance.glowIntensity = parseFloat(document.getElementById('s-glowIntensity').value);
  s.appearance.backgroundOpacity = parseFloat(document.getElementById('s-backgroundOpacity').value);
  s.appearance.screenDimOpacity = parseFloat(document.getElementById('s-screenDimOpacity').value);

  s.appearance.sidebarFontSize = parseInt(document.getElementById('s-sidebarFontSize')?.value) || 12;
  s.appearance.statusBarFontSize = parseInt(document.getElementById('s-statusBarFontSize')?.value) || 11;
  s.appearance.tabBarFontSize = parseInt(document.getElementById('s-tabBarFontSize')?.value) || 12;
  s.appearance.inputPanelFontSize = parseInt(document.getElementById('s-inputPanelFontSize')?.value) || 11;
  s.appearance.fileViewerFontSize = parseInt(document.getElementById('s-fileViewerFontSize')?.value) || 13;
  s.appearance.gitGraphFontSize = parseInt(document.getElementById('s-gitGraphFontSize')?.value) || 12;

  s.terminal.scrollback = parseInt(document.getElementById('s-scrollback').value);
  s.terminal.bellStyle = document.getElementById('s-bellStyle').value;
  s.terminal.copyOnSelect = document.getElementById('s-copyOnSelect').checked;
  s.terminal.rightClickPaste = document.getElementById('s-rightClickPaste').checked;
  s.terminal.trimCopied = document.getElementById('s-trimCopied').checked;
  s.terminal.wordSeparators = document.getElementById('s-wordSeparators').value;
  s.terminal.renderer = document.getElementById('s-renderer').value;

  s.shell.shellPath = document.getElementById('s-shellPath').value;
  s.shell.startDirectory = document.getElementById('s-startDirectory').value;
  s.shell.sessionNameFormat = document.getElementById('s-sessionNameFormat').value;
  s.shell.autoReconnect = document.getElementById('s-autoReconnect').checked;
  syncEnvToPending();

  s.advanced.customCss = document.getElementById('s-customCss').value;
  s.advanced.wsReconnectInterval = parseInt(document.getElementById('s-wsReconnectInterval').value);
  s.advanced.logLevel = document.getElementById('s-logLevel').value;

  return s;
}

function activateNavPanel(panelId) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.panel === panelId));
  document.querySelectorAll('.settings-panel').forEach(el => el.classList.toggle('active', el.id === `panel-${panelId}`));
}

export function initSettingsUI() {
  document.getElementById('settings-nav').addEventListener('click', e => {
    const item = e.target.closest('.nav-item');
    if (!item) return;
    activateNavPanel(item.dataset.panel);
  });

  document.querySelectorAll('.s-range').forEach(range => {
    range.addEventListener('input', () => {
      const valEl = document.getElementById(range.id + '-val');
      const numInput = document.getElementById(range.id + '-num');
      if (valEl) {
        const v = parseFloat(range.value);
        valEl.textContent = v.toFixed(v < 1 ? 2 : (v % 1 === 0 ? 0 : 1));
      }
      if (numInput) numInput.value = range.value;
      if (range.id === 's-fontSize' || range.id === 's-lineHeight') {
        updateFontPreview(document.getElementById('s-fontFamily').value, document.getElementById('s-fontSize').value);
      }
    });
  });

  const fontSizeNum = document.getElementById('s-fontSize-num');
  if (fontSizeNum) {
    fontSizeNum.addEventListener('input', () => {
      const v = Math.min(32, Math.max(8, parseInt(fontSizeNum.value) || 14));
      document.getElementById('s-fontSize').value = v;
      updateFontPreview(document.getElementById('s-fontFamily').value, v);
    });
  }

  document.getElementById('s-fontFamily').addEventListener('change', e => {
    updateFontPreview(e.target.value, document.getElementById('s-fontSize').value);
  });

  document.getElementById('btn-save-settings').addEventListener('click', async () => {
    const s = readForm();
    await saveSettingsToServer(s);
    applySettings(s);
    S.settings = s;
    const statusEl = document.getElementById('save-status');
    statusEl.classList.add('visible');
    setTimeout(() => statusEl.classList.remove('visible'), 2000);
    closeSettings();
  });

  document.getElementById('btn-cancel-settings').addEventListener('click', closeSettings);
  document.getElementById('settings-close').addEventListener('click', closeSettings);
  settingsOverlay.addEventListener('click', e => { if (e.target === settingsOverlay) closeSettings(); });

  document.getElementById('btn-reset-settings').addEventListener('click', async () => {
    if (!await confirmModal('Reset ALL settings to defaults? This cannot be undone.', 'Reset')) return;
    const r = await apiFetch('/api/settings/default');
    const def = await r.json();
    S.pendingSettings = def;
    populateForm(def);
    applySettings(def);
    S.settings = def;
    await saveSettingsToServer(def);
  });

  document.getElementById('btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(S.settings, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'super-terminal-settings.json';
    a.click();
  });

  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('import-file-input').click();
  });
  document.getElementById('import-file-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const imported = JSON.parse(ev.target.result);
        S.pendingSettings = imported;
        populateForm(imported);
        applySettings(imported);
        S.settings = imported;
        await saveSettingsToServer(imported);
        const statusEl = document.getElementById('import-status');
        statusEl.textContent = '✓ Settings imported successfully';
        statusEl.style.display = 'block';
        setTimeout(() => statusEl.style.display = 'none', 3000);
      } catch {
        alert('Failed to parse settings file. Make sure it is a valid JSON.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  document.getElementById('btn-add-env').addEventListener('click', () => {
    addEnvRow('', '');
  });

  document.getElementById('btn-settings').addEventListener('click', openSettings);
}
