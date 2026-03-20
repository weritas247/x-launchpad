# Notification Customization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settings modal에 Notifications 탭을 추가하여 토스트/AI 알림의 볼륨, 사운드, OS알림, 위치, 표시시간, 커스텀 사운드를 유형별로 커스터마이징할 수 있게 한다.

**Architecture:** 글로벌 기본값 + 유형별 오버라이드(null=상속) 패턴. `notification-settings.ts`가 Notifications 탭 UI 로직을 전담하고, `getNotificationConfig(type)`이 글로벌+오버라이드를 머지하여 `toast.ts`와 `notifications.ts`가 사용한다. 토스트 위치는 `.toast-zone-{position}` 컨테이너로 동적 관리.

**Tech Stack:** TypeScript, Vanilla DOM, HTML/CSS, Vite

**Spec:** `docs/superpowers/specs/2026-03-20-notification-customization-design.md`

---

### Task 1: DEFAULT_SETTINGS에 notifications 섹션 추가

**Files:**
- Modify: `server/config.ts:8-71`

- [ ] **Step 1: notifications 섹션 추가**

`server/config.ts`의 `DEFAULT_SETTINGS` 객체에서 `advanced` 섹션 바로 앞에 `notifications` 섹션을 추가한다:

```typescript
// server/config.ts — keybindings 뒤, advanced 앞에 추가
  notifications: {
    global: {
      volume: 80,
      soundEnabled: true,
      osNotification: true,
      position: 'top-right' as const,
      duration: 5000,
      customSound: null as string | null,
    },
    types: {
      success:    { enabled: true, volume: null as number | null, soundEnabled: false as boolean | null, osNotification: false as boolean | null, position: null as string | null, duration: 3000 as number | null, customSound: null as string | null },
      error:      { enabled: true, volume: null as number | null, soundEnabled: false as boolean | null, osNotification: false as boolean | null, position: null as string | null, duration: 5000 as number | null, customSound: null as string | null },
      info:       { enabled: true, volume: null as number | null, soundEnabled: false as boolean | null, osNotification: false as boolean | null, position: null as string | null, duration: 3000 as number | null, customSound: null as string | null },
      aiDone:     { enabled: true, volume: null as number | null, soundEnabled: null as boolean | null, osNotification: null as boolean | null, position: null as string | null, duration: null as number | null, customSound: null as string | null },
      aiQuestion: { enabled: true, volume: null as number | null, soundEnabled: null as boolean | null, osNotification: null as boolean | null, position: null as string | null, duration: null as number | null, customSound: null as string | null },
    },
  },
```

- [ ] **Step 2: 빌드 확인**

Run: `cd /Users/redpug/Dev/x-launchpad && npx tsc --noEmit`
Expected: 컴파일 성공 (또는 기존 에러만)

- [ ] **Step 3: Commit**

```bash
git add server/config.ts
git commit -m "feat(notifications): add notifications section to DEFAULT_SETTINGS"
```

---

### Task 2: getNotificationConfig 유틸리티 + toast-zone 컨테이너 관리

**Files:**
- Create: `client/js/ui/notification-config.ts`

이 파일은 다른 모듈(toast.ts, notifications.ts, notification-settings.ts)에서 공통으로 사용하는 설정 머지 로직과 토스트 존 관리를 담당한다.

- [ ] **Step 1: notification-config.ts 생성**

```typescript
// client/js/ui/notification-config.ts
import { S } from '../core/state';

export interface ResolvedNotificationConfig {
  enabled: boolean;
  volume: number;
  soundEnabled: boolean;
  osNotification: boolean;
  position: string;
  duration: number;
  customSound: string | null;
}

const NOTIF_TYPE_MAP: Record<string, string> = {
  done: 'aiDone',
  question: 'aiQuestion',
};

/** AI matched.type('done','question') → settings key('aiDone','aiQuestion') 변환 */
export function mapNotifType(internalType: string): string {
  return NOTIF_TYPE_MAP[internalType] || internalType;
}

/** 글로벌 + 유형별 오버라이드 머지 */
export function getNotificationConfig(type: string): ResolvedNotificationConfig {
  const notif = S.settings?.notifications;
  if (!notif) {
    return {
      enabled: true,
      volume: 80,
      soundEnabled: true,
      osNotification: true,
      position: 'top-right',
      duration: 5000,
      customSound: null,
    };
  }
  const g = notif.global;
  const t = notif.types?.[type];
  if (!t) {
    return { enabled: true, ...g };
  }
  return {
    enabled: t.enabled ?? true,
    volume: t.volume ?? g.volume,
    soundEnabled: t.soundEnabled ?? g.soundEnabled,
    osNotification: t.osNotification ?? g.osNotification,
    position: t.position ?? g.position,
    duration: t.duration ?? g.duration,
    customSound: t.customSound ?? g.customSound,
  };
}

const defaultAlertSound = new Audio('/alert.m4a');

/** 설정에 따라 알림 사운드 재생 */
export function playNotificationSound(type: string): void {
  const cfg = getNotificationConfig(type);
  if (!cfg.soundEnabled) return;

  let audio: HTMLAudioElement;
  if (cfg.customSound) {
    audio = new Audio(cfg.customSound);
  } else {
    audio = defaultAlertSound;
    audio.currentTime = 0;
  }
  audio.volume = cfg.volume / 100;
  audio.play().catch(() => {});
}

/** 위치별 toast-zone 컨테이너 얻기/생성 */
export function getOrCreateToastZone(position: string): HTMLElement {
  const id = `toast-zone-${position}`;
  let zone = document.getElementById(id);
  if (!zone) {
    zone = document.createElement('div');
    zone.id = id;
    zone.className = `toast-zone toast-zone-${position}`;
    document.body.appendChild(zone);
  }
  return zone;
}
```

- [ ] **Step 2: 빌드 확인**

Run: `cd /Users/redpug/Dev/x-launchpad && npx tsc --noEmit`
Expected: 컴파일 성공

- [ ] **Step 3: Commit**

```bash
git add client/js/ui/notification-config.ts
git commit -m "feat(notifications): add notification config resolver and toast-zone manager"
```

---

### Task 3: toast.ts를 설정 기반으로 리팩터

**Files:**
- Modify: `client/js/ui/toast.ts:1-48`

기존 `showToast`가 `getNotificationConfig`를 사용하도록 변경. 위치를 toast-zone으로 관리.

- [ ] **Step 1: toast.ts 리팩터**

`toast.ts`를 아래와 같이 수정:

```typescript
// client/js/ui/toast.ts — 전체 교체
import { getNotificationConfig, playNotificationSound, getOrCreateToastZone } from './notification-config';

function escText(s: string): string {
  const el = document.createElement('span');
  el.textContent = s;
  return el.innerHTML;
}

/**
 * Show a system toast notification
 * @param message - Text to display
 * @param type - 'success' | 'error' | 'info'
 * @param durationOverride - 명시적 duration 지정 시 설정값 대신 사용
 */
export function showToast(message: string, type: 'success' | 'error' | 'info' = 'info', durationOverride?: number) {
  const cfg = getNotificationConfig(type);
  if (!cfg.enabled) return;

  const duration = durationOverride ?? cfg.duration;
  const zone = getOrCreateToastZone(cfg.position);

  const toast = document.createElement('div');
  toast.className = `sys-toast sys-toast-${type}`;

  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
  toast.innerHTML = `<span class="sys-toast-icon">${icon}</span><span class="sys-toast-msg">${escText(message)}</span>`;

  zone.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));

  playNotificationSound(type);

  setTimeout(() => {
    toast.classList.remove('show');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 500);
  }, duration);
}
```

- [ ] **Step 2: 빌드 확인**

Run: `cd /Users/redpug/Dev/x-launchpad && npx tsc --noEmit`
Expected: 컴파일 성공

- [ ] **Step 3: Commit**

```bash
git add client/js/ui/toast.ts
git commit -m "feat(notifications): refactor toast.ts to use notification config"
```

---

### Task 4: notifications.ts를 설정 기반으로 리팩터

**Files:**
- Modify: `client/js/ui/notifications.ts`

AI 알림에서 설정 참조, 타입 매핑, OS 알림에 `silent: true`, toast-zone 사용.

- [ ] **Step 1: notifications.ts 리팩터**

주요 변경사항:

1. **import 추가** (파일 상단):
```typescript
import { getNotificationConfig, playNotificationSound, mapNotifType, getOrCreateToastZone } from './notification-config';
```

2. **`aiNotifyCheck` 함수** 내 `showToast` 호출 전 설정 확인 추가 (line 88 부근):
```typescript
      const notifType = mapNotifType(matched.type);
      const cfg = getNotificationConfig(notifType);
      if (!cfg.enabled) return;

      // ... 기존 title, body 생성 로직 유지 ...

      const isActiveVisible =
        sessionId === S.activeSessionId && document.visibilityState === 'visible';
      if (!isActiveVisible) {
        showToast(title, body, sessionId, notifType);
      }

      if (cfg.osNotification && (document.visibilityState === 'hidden' || !document.hasFocus())) {
        if ('Notification' in window) {
          if (Notification.permission === 'granted') {
            fireOsNotification(title, body, sessionId);
          } else if (Notification.permission === 'default') {
            Notification.requestPermission().then((p) => {
              if (p === 'granted') fireOsNotification(title, body, sessionId);
            });
          }
        }
      }
```

3. **`fireOsNotification`** — `silent: true`로 변경 (line 118):
```typescript
    silent: true,  // 인앱 사운드와 중복 방지
```

4. **`showToast` (AI용)** — 설정 기반으로 변경:
```typescript
export function showToast(title: string, body: string, sessionId: string, notifType?: string) {
  const type = notifType || 'aiDone';
  const cfg = getNotificationConfig(type);
  const zone = getOrCreateToastZone(cfg.position);

  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `
    <div class="toast-title">${escHtml(title)}</div>
    <div class="toast-body">${escHtml(body)}</div>
    <button class="toast-close">✕</button>
  `;
  t.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.toast-close')) {
      t.remove();
      return;
    }
    if (terminalMap.has(sessionId)) {
      activateSession(sessionId);
      wsSend({ type: 'session_attach', sessionId });
    }
    t.remove();
  });
  zone.appendChild(t);

  playNotificationSound(type);

  const duration = cfg.duration;
  setTimeout(() => t.classList.add('toast-hide'), duration);
  setTimeout(() => { if (t.parentNode) t.remove(); }, duration + 700);
}
```

5. **전역 `alertSound` 삭제** — `playNotificationSound`로 대체되므로 `const alertSound = new Audio(...)` 라인과 `alertSound.currentTime = 0; alertSound.play()...` 라인 삭제.

6. **전역 `toastContainer`/`getToastContainer` 삭제** — `getOrCreateToastZone`으로 대체.

- [ ] **Step 2: 빌드 확인**

Run: `cd /Users/redpug/Dev/x-launchpad && npx tsc --noEmit`
Expected: 컴파일 성공

- [ ] **Step 3: Commit**

```bash
git add client/js/ui/notifications.ts
git commit -m "feat(notifications): refactor AI notifications to use config-based settings"
```

---

### Task 5: Toast-zone CSS + 기존 컨테이너 스타일 마이그레이션

**Files:**
- Modify: `client/styles.css`

- [ ] **Step 1: toast-zone CSS 추가**

`client/styles.css` 끝에 toast-zone 위치 CSS를 추가한다:

```css
/* ─── TOAST ZONES ─────────────────────────── */
.toast-zone {
  position: fixed;
  z-index: 99999;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
  max-width: 380px;
}
.toast-zone > * { pointer-events: auto; }

.toast-zone-top-right    { top: 20px; right: 20px; }
.toast-zone-top-left     { top: 20px; left: 20px; }
.toast-zone-bottom-right { bottom: 20px; right: 20px; align-items: flex-end; }
.toast-zone-bottom-left  { bottom: 20px; left: 20px; align-items: flex-start; }
```

- [ ] **Step 2: 기존 컨테이너 CSS를 toast-zone 기반으로 마이그레이션**

**AI Toast (line 3662-3695):** `#ai-toast-container` 블록(position, fixed, top, right, z-index, display, flex-direction, gap, pointer-events)을 **삭제**한다. 이 속성들은 `.toast-zone`이 대체. 자식 셀렉터만 변경:

```css
/* BEFORE */
#ai-toast-container .toast { ... }
#ai-toast-container .toast:hover { ... }

/* AFTER */
.toast-zone .toast { ... }         /* 셀렉터만 변경, 내부 속성 동일 유지 */
.toast-zone .toast:hover { ... }   /* 셀렉터만 변경, 내부 속성 동일 유지 */
```

또한 `.toast` 안의 `pointer-events: all;` 제거 (`.toast-zone > *`에서 이미 처리).

**System Toast (line 7201-7210):** `#sys-toast-container` 블록 **삭제**. `.sys-toast`의 `pointer-events: auto;` 제거. 나머지 `.sys-toast`, `.sys-toast.show`, `.sys-toast-icon`, `.sys-toast-msg`, `.sys-toast-success/error/info` 스타일은 **그대로 유지** (셀렉터 변경 불필요 — 이미 ID가 아닌 클래스 기반).

- [ ] **Step 3: HTML에서 하드코딩된 `#ai-toast-container`와 `#sys-toast-container` 제거**

`client/index.html`에서 해당 div가 있다면 제거한다 (코드에서 동적 생성하므로).

- [ ] **Step 4: 빌드 확인**

Run: `cd /Users/redpug/Dev/x-launchpad && npx tsc --noEmit`
Expected: 컴파일 성공

- [ ] **Step 5: Commit**

```bash
git add client/styles.css client/index.html
git commit -m "feat(notifications): add toast-zone CSS and migrate container styles"
```

---

### Task 6: Notifications 탭 HTML 추가

**Files:**
- Modify: `client/index.html:753-764`

- [ ] **Step 1: nav-item 추가**

`client/index.html`에서 Keybindings nav-item(line 754-756) 뒤, Advanced nav-item(line 757) 앞에 추가:

```html
            <div class="nav-item" data-panel="notifications">
              <span class="nav-icon">🔔</span>Notifications
            </div>
```

- [ ] **Step 2: Notifications 패널 HTML 추가**

`<!-- /keybindings -->` 주석(line 1285) 뒤, `<!-- ── ADVANCED ── -->` 주석(line 1287) 앞에 추가:

```html
            <!-- ── NOTIFICATIONS ── -->
            <div class="settings-panel" id="panel-notifications">
              <!-- Global Defaults -->
              <div class="panel-section">
                <div class="section-title">Global Defaults</div>

                <div class="field-row">
                  <div class="field-label">Volume<small>0–100%</small></div>
                  <div class="field-control" style="display:flex;align-items:center;gap:8px;">
                    <input type="range" class="s-range" id="s-notif-volume" min="0" max="100" step="1" style="flex:1;" />
                    <span id="s-notif-volume-val" style="min-width:32px;text-align:right;">80</span>%
                    <button class="btn-sm" id="btn-notif-test-global" title="Test sound">🔊</button>
                  </div>
                </div>

                <div class="field-row">
                  <div class="field-label">Sound<small>Play alert sound</small></div>
                  <div class="field-control">
                    <label class="switch"><input type="checkbox" id="s-notif-sound" /><span class="slider"></span></label>
                  </div>
                </div>

                <div class="field-row">
                  <div class="field-label">OS Notification<small>Browser notification</small></div>
                  <div class="field-control" style="display:flex;align-items:center;gap:8px;">
                    <label class="switch"><input type="checkbox" id="s-notif-os" /><span class="slider"></span></label>
                    <button class="btn-sm" id="btn-notif-request-perm" style="display:none;" title="Request permission">Request Permission</button>
                    <span id="notif-perm-denied" style="display:none;font-size:10px;color:var(--danger);">Blocked in browser settings</span>
                  </div>
                </div>

                <div class="field-row">
                  <div class="field-label">Position<small>Where toasts appear</small></div>
                  <div class="field-control">
                    <select class="s-select" id="s-notif-position">
                      <option value="top-right">Top Right</option>
                      <option value="top-left">Top Left</option>
                      <option value="bottom-right">Bottom Right</option>
                      <option value="bottom-left">Bottom Left</option>
                    </select>
                  </div>
                </div>

                <div class="field-row">
                  <div class="field-label">Duration<small>Auto-dismiss time</small></div>
                  <div class="field-control">
                    <select class="s-select" id="s-notif-duration">
                      <option value="3000">3s</option>
                      <option value="5000">5s</option>
                      <option value="8000">8s</option>
                      <option value="10000">10s</option>
                      <option value="15000">15s</option>
                      <option value="30000">30s</option>
                    </select>
                  </div>
                </div>

                <div class="field-row">
                  <div class="field-label">Custom Sound<small>Upload audio file (max 500KB)</small></div>
                  <div class="field-control" style="display:flex;align-items:center;gap:8px;">
                    <button class="btn-sm" id="btn-notif-sound-upload">Choose File</button>
                    <input type="file" id="notif-sound-file" accept="audio/*" style="display:none;" />
                    <span id="notif-sound-name" style="font-size:10px;color:var(--text-dim);">Default (alert.m4a)</span>
                    <button class="btn-sm" id="btn-notif-sound-reset" style="display:none;">Reset</button>
                  </div>
                </div>
              </div>

              <!-- Per-Type Overrides -->
              <div class="panel-section">
                <div class="section-title">Per-Type Overrides</div>
                <div id="notif-type-overrides"></div>
              </div>
            </div>
            <!-- /notifications -->
```

- [ ] **Step 3: 빌드 확인**

Run: `cd /Users/redpug/Dev/x-launchpad && npx tsc --noEmit`
Expected: 컴파일 성공

- [ ] **Step 4: Commit**

```bash
git add client/index.html
git commit -m "feat(notifications): add Notifications tab HTML to settings modal"
```

---

### Task 7: notification-settings.ts — Notifications 탭 UI 로직

**Files:**
- Create: `client/js/ui/notification-settings.ts`
- Modify: `client/js/ui/settings.ts`

- [ ] **Step 1: notification-settings.ts 생성**

```typescript
// client/js/ui/notification-settings.ts
import { S } from '../core/state';
import { getNotificationConfig, playNotificationSound, getOrCreateToastZone } from './notification-config';

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

const OVERRIDE_FIELDS = [
  { key: 'volume',         label: 'Volume',          type: 'range',  min: 0, max: 100, step: 1 },
  { key: 'soundEnabled',   label: 'Sound',           type: 'toggle' },
  { key: 'osNotification', label: 'OS Notification',  type: 'toggle' },
  { key: 'position',       label: 'Position',        type: 'select', options: ['top-right','top-left','bottom-right','bottom-left'] },
  { key: 'duration',       label: 'Duration',        type: 'select', options: [3000,5000,8000,10000,15000,30000] },
];

const MAX_SOUND_SIZE = 500 * 1024; // 500KB
const MAX_TOTAL_SOUND = 2 * 1024 * 1024; // 2MB

function durationLabel(ms: number): string {
  return (ms / 1000) + 's';
}

function buildOverrideRow(typeKey: string, icon: string, label: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'notif-type-row';
  wrapper.dataset.type = typeKey;

  // Header: icon + label + enabled toggle + expand arrow
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

  // Override fields
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
        const label = typeof o === 'number' ? durationLabel(o) : o;
        return `<option value="${o}">${label}</option>`;
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

  // Toggle expand
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

  // Range value display
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
    // base64는 원본보다 ~33% 크므로 여유있게 계산
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
  // Build per-type override rows
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

  // Global test button — 글로벌 설정으로 직접 사운드 재생 (유형별 오버라이드 무시)
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
      // 샘플 토스트도 표시
      const { showToast } = await import('./toast');
      const sampleMessages = { success: 'Sample success', error: 'Sample error', info: 'Sample info', aiDone: 'AI task done (sample)', aiQuestion: 'AI needs input (sample)' };
      showToast(sampleMessages[typeKey] || 'Test notification', typeKey as any);
    });
  });
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

  // Global custom sound
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

    // Enabled toggle
    const enabledCb = document.querySelector<HTMLInputElement>(`.notif-type-enabled[data-type="${nt.key}"]`);
    if (enabledCb) enabledCb.checked = t.enabled !== false;

    // Override fields
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
        // Show global default as placeholder
        const gVal = g[field.key];
        if (field.type === 'toggle') {
          (inputEl as HTMLInputElement).checked = gVal;
        } else {
          inputEl.value = String(gVal);
        }
      }

      // Volume display
      if (field.type === 'range') {
        const valEl = inputEl.nextElementSibling as HTMLElement;
        if (valEl) valEl.textContent = inputEl.value;
      }
    }

    // Custom sound
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
```

- [ ] **Step 2: settings.ts에 연동 코드 추가**

`client/js/ui/settings.ts` 상단에 import 추가:
```typescript
import { initNotificationSettings, populateNotificationForm, readNotificationForm } from './notification-settings';
```

`populateForm` 함수(line 232) 끝에 추가:
```typescript
  populateNotificationForm(s);
```

`readForm` 함수(line 312)의 `return s;` 전에 추가:
```typescript
  s.notifications = readNotificationForm();
```

`initSettingsUI` 함수(line 377) 끝에 추가:
```typescript
  initNotificationSettings();
```

- [ ] **Step 3: 빌드 확인**

Run: `cd /Users/redpug/Dev/x-launchpad && npx tsc --noEmit`
Expected: 컴파일 성공

- [ ] **Step 4: Commit**

```bash
git add client/js/ui/notification-settings.ts client/js/ui/settings.ts
git commit -m "feat(notifications): add Notifications tab UI logic and settings integration"
```

---

### Task 8: Notifications 탭 CSS 스타일링

**Files:**
- Modify: `client/styles.css`

- [ ] **Step 1: notification-settings CSS 추가**

`client/styles.css` 끝에 Notifications 탭 전용 스타일 추가:

```css
/* ─── NOTIFICATION SETTINGS ───────────────── */
.notif-type-row {
  border: 1px solid var(--border);
  border-radius: 6px;
  margin-bottom: 8px;
  overflow: hidden;
}
.notif-type-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  background: rgba(255,255,255,0.02);
}
.notif-type-header:hover { background: rgba(255,255,255,0.05); }
.notif-type-icon { font-size: 14px; min-width: 18px; text-align: center; }
.notif-type-label { flex: 1; font-size: 12px; }
.notif-type-status { font-size: 10px; color: var(--text-dim); }
.notif-type-arrow { font-size: 10px; color: var(--text-dim); margin-left: 4px; }

.notif-type-body {
  padding: 8px 12px 12px;
  border-top: 1px solid var(--border);
  background: rgba(0,0,0,0.15);
}

.notif-override-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
  gap: 8px;
}
.notif-override-check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  min-width: 120px;
  cursor: pointer;
}
.notif-override-check input[type="checkbox"] { margin: 0; }
.notif-override-control {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  justify-content: flex-end;
}
.notif-override-control .s-range { max-width: 120px; }
.notif-override-control .s-select { max-width: 140px; }
.notif-override-val { min-width: 24px; text-align: right; font-size: 11px; }

.switch-sm { transform: scale(0.8); }

.btn-sm {
  padding: 2px 8px;
  font-size: 10px;
  border: 1px solid var(--border);
  background: rgba(255,255,255,0.05);
  color: var(--text);
  border-radius: 4px;
  cursor: pointer;
}
.btn-sm:hover { background: rgba(255,255,255,0.1); }
```

- [ ] **Step 2: 빌드 확인 및 Commit**

```bash
git add client/styles.css
git commit -m "feat(notifications): add notification settings CSS styles"
```

---

### Task 9: 수동 통합 테스트 및 최종 확인

**Files:** (none — 테스트 실행만)

- [ ] **Step 1: 서버 시작**

Run: `cd /Users/redpug/Dev/x-launchpad && npm run dev`

- [ ] **Step 2: 브라우저에서 확인 항목**

1. 설정 모달 열기 (Ctrl+,) → Notifications 탭이 보이는지
2. Global Defaults: 볼륨 슬라이더 조작, Test 버튼으로 사운드 재생
3. Global Defaults: Sound/OS Notification 토글 작동
4. Global Defaults: Position 변경 후 토스트 위치 확인
5. Global Defaults: Duration 변경 후 토스트 표시 시간 확인
6. Global Defaults: Custom Sound 업로드 → 500KB 초과 시 에러
7. Per-Type: 각 유형 접이식 섹션 펼침/접힘
8. Per-Type: Enabled 토글 off → 해당 유형 알림 안 뜸
9. Per-Type: Override checkbox 활성화 → 값 변경 → "(custom)" 표시
10. Per-Type: Test 버튼으로 resolved config 기반 사운드 재생
11. 설정 저장 후 페이지 새로고침 → 값 유지 확인
12. Import/Export에 notifications 포함 확인

- [ ] **Step 3: 빌드 확인**

Run: `cd /Users/redpug/Dev/x-launchpad && npm run build`
Expected: 프로덕션 빌드 성공

- [ ] **Step 4: 최종 Commit**

```bash
git add server/config.ts client/js/ui/notification-config.ts client/js/ui/notification-settings.ts client/js/ui/toast.ts client/js/ui/notifications.ts client/js/ui/settings.ts client/index.html client/styles.css
git commit -m "feat(notifications): complete notification customization feature"
```
