import { S, escHtml } from '../core/state';
import { getNotificationConfig, playNotificationSound, getOrCreateToastZone } from './notification-config';
import { showToast } from './toast';

const $el = (id: string) => document.getElementById(id);
const $input = (id: string) => document.getElementById(id) as HTMLInputElement;
const $select = (id: string) => document.getElementById(id) as HTMLSelectElement;

const NOTIF_TYPES = [
  { key: 'success',    icon: '✓', label: 'Success' },
  { key: 'error',      icon: '✕', label: 'Error' },
  { key: 'info',       icon: 'ℹ', label: 'Info' },
  { key: 'aiDone',     icon: '✦', label: 'AI Done' },
  { key: 'aiQuestion', icon: '?', label: 'AI Question' },
];

const OVERRIDE_FIELDS: Array<{ key: string; label: string; type: string; min?: number; max?: number; step?: number; options?: Array<string | number> }> = [
  { key: 'volume',         label: 'Volume',          type: 'range',  min: 0, max: 100, step: 1 },
  { key: 'soundEnabled',   label: 'Sound',           type: 'toggle' },
  { key: 'osNotification', label: 'OS Notification',  type: 'toggle' },
  { key: 'position',       label: 'Position',        type: 'select', options: ['top-right','top-left','bottom-right','bottom-left'] },
  { key: 'duration',       label: 'Duration',        type: 'select', options: [3000,5000,8000,10000,15000,30000] },
];

const MAX_SOUND_SIZE = 500 * 1024;
const MAX_TOTAL_SOUND = 2 * 1024 * 1024;

function durationLabel(ms: number): string {
  return (ms / 1000) + 's';
}

function buildOverrideRow(typeKey: string, icon: string, label: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'notif-type-row';
  wrapper.dataset.type = typeKey;

  const header = document.createElement('div');
  header.className = 'notif-type-header';
  header.innerHTML = `
    <span class="notif-type-icon">${icon}</span>
    <span class="notif-type-label">${label}</span>
    <label class="switch switch-sm"><input type="checkbox" class="notif-type-enabled" data-type="${typeKey}" /><span class="slider"></span></label>
    <span class="notif-type-status">(using defaults)</span>
    <span class="notif-type-arrow">▸</span>
  `;

  const body = document.createElement('div');
  body.className = 'notif-type-body';
  body.style.display = 'none';

  for (const field of OVERRIDE_FIELDS) {
    const row = document.createElement('div');
    row.className = 'notif-override-row';

    let controlHtml = '';
    if (field.type === 'range') {
      controlHtml = `<input type="range" class="s-range notif-override-input" data-type="${typeKey}" data-field="${field.key}" min="${field.min}" max="${field.max}" step="${field.step}" /> <span class="notif-override-val"></span>%`;
    } else if (field.type === 'toggle') {
      controlHtml = `<label class="switch switch-sm"><input type="checkbox" class="notif-override-input" data-type="${typeKey}" data-field="${field.key}" /><span class="slider"></span></label>`;
    } else if (field.type === 'select') {
      const opts = field.options!.map(o => {
        const lbl = typeof o === 'number' ? durationLabel(o) : o;
        return `<option value="${o}">${lbl}</option>`;
      }).join('');
      controlHtml = `<select class="s-select notif-override-input" data-type="${typeKey}" data-field="${field.key}">${opts}</select>`;
    }

    row.innerHTML = `
      <label class="notif-override-check">
        <input type="checkbox" class="notif-override-enabled" data-type="${typeKey}" data-field="${field.key}" />
        <span>${field.label}</span>
      </label>
      <div class="notif-override-control">${controlHtml}</div>
    `;
    body.appendChild(row);
  }

  // Custom sound row
  const soundRow = document.createElement('div');
  soundRow.className = 'notif-override-row';
  soundRow.innerHTML = `
    <label class="notif-override-check">
      <span>Custom Sound</span>
    </label>
    <div class="notif-override-control" style="display:flex;align-items:center;gap:6px;">
      <button class="btn-sm notif-sound-upload" data-type="${typeKey}">Choose</button>
      <input type="file" class="notif-sound-file" data-type="${typeKey}" accept="audio/*" style="display:none;" />
      <span class="notif-sound-name" data-type="${typeKey}" style="font-size:10px;color:var(--text-dim);">None</span>
      <button class="btn-sm notif-sound-reset" data-type="${typeKey}" style="display:none;">Reset</button>
      <button class="btn-sm notif-sound-test" data-type="${typeKey}" title="Test">🔊</button>
    </div>
  `;
  body.appendChild(soundRow);

  header.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.switch')) return;
    const expanded = body.style.display !== 'none';
    body.style.display = expanded ? 'none' : 'block';
    wrapper.querySelector('.notif-type-arrow')!.textContent = expanded ? '▸' : '▾';
  });

  wrapper.appendChild(header);
  wrapper.appendChild(body);
  return wrapper;
}

function updateOverrideStatus(typeKey: string) {
  const row = document.querySelector(`.notif-type-row[data-type="${typeKey}"]`);
  if (!row) return;
  const checks = row.querySelectorAll<HTMLInputElement>('.notif-override-enabled:checked');
  const soundName = row.querySelector<HTMLElement>(`.notif-sound-name[data-type="${typeKey}"]`);
  const hasCustom = checks.length > 0 || (soundName && soundName.textContent !== 'None');
  row.querySelector('.notif-type-status')!.textContent = hasCustom ? '(custom)' : '(using defaults)';
}

function setupOverrideToggle() {
  document.querySelectorAll<HTMLInputElement>('.notif-override-enabled').forEach(cb => {
    cb.addEventListener('change', () => {
      const control = cb.closest('.notif-override-row')?.querySelector<HTMLElement>('.notif-override-control');
      if (control) {
        const inputs = control.querySelectorAll<HTMLInputElement | HTMLSelectElement>('.notif-override-input');
        inputs.forEach(inp => (inp as any).disabled = !cb.checked);
      }
      updateOverrideStatus(cb.dataset.type!);
    });
  });

  document.querySelectorAll<HTMLInputElement>('.notif-override-input[type="range"]').forEach(range => {
    const valEl = range.nextElementSibling as HTMLElement;
    range.addEventListener('input', () => {
      if (valEl) valEl.textContent = range.value;
    });
  });
}

function getTotalCustomSoundSize(): number {
  const notif = S.pendingSettings?.notifications;
  if (!notif) return 0;
  let total = 0;
  if (notif.global?.customSound) total += notif.global.customSound.length;
  for (const t of Object.values(notif.types || {})) {
    if ((t as any)?.customSound) total += (t as any).customSound.length;
  }
  return total;
}

function setupSoundUpload(idPrefix: string, getSet: { get: () => string | null, set: (v: string | null) => void }, nameEl: HTMLElement, resetBtn: HTMLElement, fileInput: HTMLInputElement) {
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (file.size > MAX_SOUND_SIZE) {
      alert(`File too large (${(file.size / 1024).toFixed(0)}KB). Max 500KB.`);
      fileInput.value = '';
      return;
    }
    const estimatedB64Size = Math.ceil(file.size * 1.37);
    const currentTotal = getTotalCustomSoundSize() - (getSet.get()?.length || 0);
    if (currentTotal + estimatedB64Size > MAX_TOTAL_SOUND) {
      alert(`Total custom sound size exceeds 2MB limit. Remove other custom sounds first.`);
      fileInput.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      getSet.set(ev.target!.result as string);
      nameEl.textContent = file.name;
      resetBtn.style.display = '';
    };
    reader.readAsDataURL(file);
    fileInput.value = '';
  });
  resetBtn.addEventListener('click', () => {
    getSet.set(null);
    nameEl.textContent = idPrefix === 'global' ? 'Default (alert.m4a)' : 'None';
    resetBtn.style.display = 'none';
  });
}

export function initNotificationSettings() {
  const container = $el('notif-type-overrides');
  if (!container) return;
  for (const nt of NOTIF_TYPES) {
    container.appendChild(buildOverrideRow(nt.key, nt.icon, nt.label));
  }

  setupOverrideToggle();

  // Global volume slider
  const volSlider = $input('s-notif-volume');
  const volVal = $el('s-notif-volume-val');
  if (volSlider && volVal) {
    volSlider.addEventListener('input', () => { volVal.textContent = volSlider.value; });
  }

  // Global test button
  $el('btn-notif-test-global')?.addEventListener('click', () => {
    const g = S.pendingSettings?.notifications?.global;
    if (!g || !g.soundEnabled) return;
    const audio = g.customSound ? new Audio(g.customSound) : new Audio('/alert.m4a');
    audio.volume = (g.volume ?? 80) / 100;
    audio.play().catch(() => {});
  });

  // Global sound upload
  const globalFileInput = $input('notif-sound-file');
  const globalNameEl = $el('notif-sound-name')!;
  const globalResetBtn = $el('btn-notif-sound-reset')!;
  $el('btn-notif-sound-upload')?.addEventListener('click', () => globalFileInput.click());
  setupSoundUpload('global', {
    get: () => S.pendingSettings?.notifications?.global?.customSound,
    set: (v) => { if (S.pendingSettings) S.pendingSettings.notifications.global.customSound = v; },
  }, globalNameEl, globalResetBtn, globalFileInput);

  // OS Notification permission
  $el('btn-notif-request-perm')?.addEventListener('click', () => {
    Notification.requestPermission().then(updatePermUI);
  });

  // Per-type sound upload/test buttons
  document.querySelectorAll<HTMLButtonElement>('.notif-sound-upload').forEach(btn => {
    btn.addEventListener('click', () => {
      const fileInput = btn.parentElement!.querySelector<HTMLInputElement>('.notif-sound-file')!;
      fileInput.click();
    });
  });

  document.querySelectorAll<HTMLInputElement>('.notif-sound-file').forEach(fileInput => {
    const typeKey = fileInput.dataset.type!;
    const nameEl = fileInput.parentElement!.querySelector<HTMLElement>(`.notif-sound-name[data-type="${typeKey}"]`)!;
    const resetBtn = fileInput.parentElement!.querySelector<HTMLElement>(`.notif-sound-reset[data-type="${typeKey}"]`)!;
    setupSoundUpload(typeKey, {
      get: () => S.pendingSettings?.notifications?.types?.[typeKey]?.customSound,
      set: (v) => { if (S.pendingSettings) S.pendingSettings.notifications.types[typeKey].customSound = v; },
    }, nameEl, resetBtn, fileInput);
  });

  document.querySelectorAll<HTMLButtonElement>('.notif-sound-test').forEach(btn => {
    btn.addEventListener('click', () => {
      const typeKey = btn.dataset.type!;
      playNotificationSound(typeKey);
      const sampleMessages: Record<string, string> = { success: 'Sample success', error: 'Sample error', info: 'Sample info', aiDone: 'AI task done (sample)', aiQuestion: 'AI needs input (sample)' };
      if (['success', 'error', 'info'].includes(typeKey)) {
        showToast(sampleMessages[typeKey] || 'Test notification', typeKey as any);
      } else {
        // AI types — show a lightweight sample toast in the configured zone
        showSampleAiToast(typeKey, sampleMessages[typeKey] || 'Test notification');
      }
    });
  });
}

function showSampleAiToast(typeKey: string, message: string) {
  const cfg = getNotificationConfig(typeKey);
  const zone = getOrCreateToastZone(cfg.position);
  const t = document.createElement('div');
  t.className = 'toast';
  const icon = typeKey === 'aiDone' ? '✦' : '?';
  t.innerHTML = `
    <div class="toast-title">${icon} ${escHtml(message)}</div>
    <div class="toast-body">This is a sample notification</div>
    <button class="toast-close">✕</button>
  `;
  t.querySelector('.toast-close')!.addEventListener('click', () => t.remove());
  zone.appendChild(t);
  const duration = cfg.duration;
  setTimeout(() => t.classList.add('toast-hide'), duration);
  setTimeout(() => { if (t.parentNode) t.remove(); }, duration + 700);
}

function updatePermUI() {
  const permBtn = $el('btn-notif-request-perm');
  const deniedMsg = $el('notif-perm-denied');
  const osToggle = $input('s-notif-os');
  if (!permBtn || !deniedMsg) return;

  if (Notification.permission === 'granted') {
    permBtn.style.display = 'none';
    deniedMsg.style.display = 'none';
    if (osToggle) osToggle.disabled = false;
  } else if (Notification.permission === 'denied') {
    permBtn.style.display = 'none';
    deniedMsg.style.display = '';
    if (osToggle) { osToggle.disabled = true; osToggle.checked = false; }
  } else {
    permBtn.style.display = '';
    deniedMsg.style.display = 'none';
    if (osToggle) osToggle.disabled = false;
  }
}

export function populateNotificationForm(s: any) {
  const notif = s.notifications;
  if (!notif) return;
  const g = notif.global;

  // Global
  const volSlider = $input('s-notif-volume');
  const volVal = $el('s-notif-volume-val');
  if (volSlider) { volSlider.value = String(g.volume); if (volVal) volVal.textContent = String(g.volume); }
  const soundCb = $input('s-notif-sound');
  if (soundCb) soundCb.checked = g.soundEnabled;
  const osCb = $input('s-notif-os');
  if (osCb) osCb.checked = g.osNotification;
  const posSel = $select('s-notif-position');
  if (posSel) posSel.value = g.position;
  const durSel = $select('s-notif-duration');
  if (durSel) durSel.value = String(g.duration);

  const globalNameEl = $el('notif-sound-name');
  const globalResetBtn = $el('btn-notif-sound-reset');
  if (g.customSound) {
    if (globalNameEl) globalNameEl.textContent = 'Custom';
    if (globalResetBtn) globalResetBtn.style.display = '';
  } else {
    if (globalNameEl) globalNameEl.textContent = 'Default (alert.m4a)';
    if (globalResetBtn) globalResetBtn.style.display = 'none';
  }

  // Per-type
  for (const nt of NOTIF_TYPES) {
    const t = notif.types[nt.key];
    if (!t) continue;

    const enabledCb = document.querySelector<HTMLInputElement>(`.notif-type-enabled[data-type="${nt.key}"]`);
    if (enabledCb) enabledCb.checked = t.enabled !== false;

    for (const field of OVERRIDE_FIELDS) {
      const checkEl = document.querySelector<HTMLInputElement>(`.notif-override-enabled[data-type="${nt.key}"][data-field="${field.key}"]`);
      const inputEl = document.querySelector<HTMLInputElement | HTMLSelectElement>(`.notif-override-input[data-type="${nt.key}"][data-field="${field.key}"]`);
      if (!checkEl || !inputEl) continue;

      const hasOverride = t[field.key] !== null && t[field.key] !== undefined;
      checkEl.checked = hasOverride;
      (inputEl as any).disabled = !hasOverride;

      if (hasOverride) {
        if (field.type === 'toggle') {
          (inputEl as HTMLInputElement).checked = t[field.key];
        } else {
          inputEl.value = String(t[field.key]);
        }
      } else {
        const gVal = g[field.key];
        if (field.type === 'toggle') {
          (inputEl as HTMLInputElement).checked = gVal;
        } else {
          inputEl.value = String(gVal);
        }
      }

      if (field.type === 'range') {
        const valEl = inputEl.nextElementSibling as HTMLElement;
        if (valEl) valEl.textContent = inputEl.value;
      }
    }

    const soundNameEl = document.querySelector<HTMLElement>(`.notif-sound-name[data-type="${nt.key}"]`);
    const soundResetBtn = document.querySelector<HTMLElement>(`.notif-sound-reset[data-type="${nt.key}"]`);
    if (t.customSound) {
      if (soundNameEl) soundNameEl.textContent = 'Custom';
      if (soundResetBtn) soundResetBtn.style.display = '';
    } else {
      if (soundNameEl) soundNameEl.textContent = 'None';
      if (soundResetBtn) soundResetBtn.style.display = 'none';
    }

    updateOverrideStatus(nt.key);
  }

  updatePermUI();
}

export function readNotificationForm(): any {
  const g = {
    volume: parseInt($input('s-notif-volume')?.value) || 80,
    soundEnabled: $input('s-notif-sound')?.checked ?? true,
    osNotification: $input('s-notif-os')?.checked ?? true,
    position: $select('s-notif-position')?.value || 'top-right',
    duration: parseInt($select('s-notif-duration')?.value) || 5000,
    customSound: S.pendingSettings?.notifications?.global?.customSound ?? null,
  };

  const types: any = {};
  for (const nt of NOTIF_TYPES) {
    const enabledCb = document.querySelector<HTMLInputElement>(`.notif-type-enabled[data-type="${nt.key}"]`);
    const typeObj: any = {
      enabled: enabledCb?.checked ?? true,
      customSound: S.pendingSettings?.notifications?.types?.[nt.key]?.customSound ?? null,
    };

    for (const field of OVERRIDE_FIELDS) {
      const checkEl = document.querySelector<HTMLInputElement>(`.notif-override-enabled[data-type="${nt.key}"][data-field="${field.key}"]`);
      const inputEl = document.querySelector<HTMLInputElement | HTMLSelectElement>(`.notif-override-input[data-type="${nt.key}"][data-field="${field.key}"]`);
      if (!checkEl || !inputEl) {
        typeObj[field.key] = null;
        continue;
      }

      if (checkEl.checked) {
        if (field.type === 'toggle') {
          typeObj[field.key] = (inputEl as HTMLInputElement).checked;
        } else if (field.type === 'range') {
          typeObj[field.key] = parseInt(inputEl.value);
        } else {
          const v = inputEl.value;
          typeObj[field.key] = isNaN(Number(v)) ? v : parseInt(v);
        }
      } else {
        typeObj[field.key] = null;
      }
    }

    types[nt.key] = typeObj;
  }

  return { global: g, types };
}
