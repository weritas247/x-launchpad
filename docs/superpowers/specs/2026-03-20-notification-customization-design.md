# Notification Customization Design

**Date:** 2026-03-20
**Status:** Approved

## Overview

Settings modal에 "Notifications" 탭을 추가하여 토스트 알림과 AI 알림을 유형별로 커스터마이징할 수 있게 한다. 글로벌 기본값 + 유형별 오버라이드 구조.

## Notification Types

| Key          | Icon | Label       | Source             | Internal type mapping     |
|--------------|------|-------------|--------------------|---------------------------|
| `success`    | ✓    | Success     | `toast.ts`         | `showToast(_, 'success')` |
| `error`      | ✕    | Error       | `toast.ts`         | `showToast(_, 'error')`   |
| `info`       | ℹ    | Info        | `toast.ts`         | `showToast(_, 'info')`    |
| `aiDone`     | ✦    | AI Done     | `notifications.ts` | `matched.type === 'done'` |
| `aiQuestion` | ?    | AI Question | `notifications.ts` | `matched.type === 'question'` |

**Type mapping**: `notifications.ts`의 `matched.type`이 `'done'`이면 설정 키 `aiDone`, `'question'`이면 `aiQuestion`으로 매핑한다. `toast.ts`의 type 파라미터(`success`, `error`, `info`)는 설정 키와 동일하므로 매핑 불필요.

## Data Structure

`DEFAULT_SETTINGS.notifications`:

```typescript
notifications: {
  global: {
    volume: 80,            // 0–100
    soundEnabled: true,
    osNotification: true,
    position: 'top-right', // top-right | top-left | bottom-right | bottom-left
    duration: 5000,        // ms, 페이드아웃 시작 전 표시 시간 (애니메이션 별도)
    customSound: null,     // null = default alert.m4a, string = base64 data URL
  },
  types: {
    success:    { enabled: true, volume: null, soundEnabled: false, osNotification: false, position: null, duration: 3000, customSound: null },
    error:      { enabled: true, volume: null, soundEnabled: false, osNotification: false, position: null, duration: 5000, customSound: null },
    info:       { enabled: true, volume: null, soundEnabled: false, osNotification: false, position: null, duration: 3000, customSound: null },
    aiDone:     { enabled: true, volume: null, soundEnabled: null, osNotification: null, position: null, duration: null,  customSound: null },
    aiQuestion: { enabled: true, volume: null, soundEnabled: null, osNotification: null, position: null, duration: null,  customSound: null },
  }
}
```

- `null` = 글로벌 값 상속
- 값 지정 시 해당 유형에만 오버라이드
- `enabled: false` = 해당 유형 알림 완전 비활성화

**기본값 설계 의도:**
- 시스템 토스트(`success`, `error`, `info`)는 기존에 사운드/OS알림이 없었으므로 3종 모두 `soundEnabled: false`, `osNotification: false`로 기존 동작 유지
- AI 알림(`aiDone`, `aiQuestion`)은 기존 동작 유지 (사운드 + OS알림 모두 on, 글로벌 상속)

**Duration 의미:** `duration`은 토스트가 보이는 시간(페이드아웃 시작 전)이다. 페이드아웃 애니메이션(300ms)은 별도로 추가된다. 총 표시시간 = `duration` + 300ms.

## Settings UI Layout

### Tab Position

```
[Appearance] [Terminal] [Shell] [Keybindings] [Notifications] [Advanced] ─── [Import/Export]
```

Notifications 탭은 nav-sep 구분선 앞, Advanced 뒤에 위치. 아이콘: 🔔 (bell).

### Panel Structure

**Global Defaults 섹션:**

| Control          | Widget                                     |
|------------------|--------------------------------------------|
| Volume           | Range slider (0–100) + percentage label + Test button |
| Sound            | Toggle switch                              |
| OS Notification  | Toggle switch + Request Permission 버튼 (권한 미허용 시 표시) |
| Position         | Dropdown: Top Right, Top Left, Bottom Right, Bottom Left |
| Duration         | Dropdown: 3s, 5s, 8s, 10s, 15s, 30s       |
| Custom Sound     | File input (accept audio/*) + Reset button |

**OS Notification 권한 처리:**
- `Notification.permission === 'granted'`: 토글만 표시
- `Notification.permission === 'default'`: 토글 + "Request Permission" 버튼
- `Notification.permission === 'denied'`: 토글 비활성화 + "브라우저 설정에서 허용 필요" 안내

**Per-Type Overrides 섹션:**

5개 유형 각각 접이식(collapsible) 행:

- 접힌 상태: 아이콘 + 이름 + ON/OFF 토글 + "(using defaults)" 또는 "(custom)"
- 펼친 상태: 체크박스로 각 항목 오버라이드 활성화 → 활성화 시 위젯 표시
  - Override volume: checkbox + range slider
  - Override sound: checkbox + toggle
  - Override OS notification: checkbox + toggle
  - Override position: checkbox + dropdown
  - Override duration: checkbox + dropdown
  - Custom sound: file input + Reset + Test

**Test 버튼 동작:**
- Global의 Test: 글로벌 설정으로 사운드 재생
- Per-Type의 Test: 해당 유형의 resolved config(글로벌 + 오버라이드 머지)로 사운드 재생 + 샘플 토스트 표시

## Core Functions

### `getNotificationConfig(type: string): ResolvedNotificationConfig`

유형별 설정과 글로벌 설정을 머지하여 최종 설정 반환.

```typescript
interface ResolvedNotificationConfig {
  enabled: boolean;
  volume: number;
  soundEnabled: boolean;
  osNotification: boolean;
  position: string;
  duration: number;
  customSound: string | null;
}
```

로직: 유형별 값이 `null`이 아니면 사용, `null`이면 글로벌 값 사용.

### `playNotificationSound(type: string): void`

1. `getNotificationConfig(type)` 호출
2. `soundEnabled`가 `false`면 리턴
3. `customSound`가 있으면 해당 data URL로 Audio 생성, 없으면 기본 `alert.m4a`
4. `audio.volume = config.volume / 100`
5. `audio.play().catch(() => {})`

### `showConfiguredToast(message, type): void`

기존 `showToast`를 래핑하여 설정값 반영:

1. `getNotificationConfig(type)` 호출
2. `enabled`가 `false`면 리턴
3. `position`에 따라 토스트 컨테이너 위치 조정
4. `duration`에 따라 자동 닫힘 시간 설정
5. `playNotificationSound(type)` 호출
6. `osNotification`이 true이고 권한이 granted면 OS 알림 트리거 (항상 `silent: true`로 생성하여 중복 사운드 방지)

### Integration with `settings.ts`

`notification-settings.ts`는 다음 함수를 export:
- `populateNotificationForm(settings)` — 설정값을 폼에 반영. `settings.ts`의 `populateForm()`에서 호출.
- `readNotificationForm()` — 폼에서 설정값 읽기. `settings.ts`의 `readForm()`에서 호출.
- `initNotificationSettings()` — 이벤트 리스너 등록. `settings.ts` 초기화 시 호출.

## Custom Sound Handling

- 파일 업로드 시 `FileReader.readAsDataURL()`로 base64 변환
- 설정에 base64 data URL 문자열로 저장
- **파일 크기 제한: 500KB per file** (초과 시 에러 토스트)
- **총 커스텀 사운드 합산 제한: 2MB** (6개 슬롯: 글로벌 1 + 유형별 5)
- 허용 포맷: audio/* (m4a, mp3, wav, ogg 등)
- Reset 클릭 시 `null`로 되돌려 기본 사운드 사용

## Toast Container Architecture

기존 두 개의 컨테이너(`#ai-toast-container`, `#sys-toast-container`)를 **통합 관리자**로 감싼다:

- 위치별로 컨테이너를 동적 생성/재사용: `.toast-zone-top-right`, `.toast-zone-top-left`, etc.
- 각 zone 안에서 AI 토스트와 시스템 토스트는 각자의 스타일(z-index, 애니메이션)을 유지
- 같은 zone에 두 종류 토스트가 쌓일 때: AI 토스트가 위, 시스템 토스트가 아래 (AI z-index가 더 높으므로)

```typescript
function getOrCreateToastZone(position: string): HTMLElement {
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

## Files to Modify

| File | Changes |
|------|---------|
| `server/config.ts` | `DEFAULT_SETTINGS`에 `notifications` 섹션 추가 |
| `client/index.html` | Notifications 탭 네비게이션 + 패널 HTML |
| `client/js/ui/settings.ts` | `populateForm`/`readForm`에서 `notification-settings.ts` 함수 호출 |
| `client/js/ui/notifications.ts` | `matched.type` → 설정 키 매핑, 설정값 참조하여 동작 변경, OS 알림에 `silent: true` |
| `client/js/ui/toast.ts` | `showToast`에서 `getNotificationConfig` 사용, zone 기반 위치 변경 |
| `client/styles.css` | toast-zone 위치 CSS, 오버라이드 UI 스타일, Notifications 탭 스타일 |

| New File | Purpose |
|----------|---------|
| `client/js/ui/notification-settings.ts` | Notifications 탭 UI 로직: `initNotificationSettings()`, `populateNotificationForm()`, `readNotificationForm()`, 접이식 섹션, 파일 업로드, 테스트 재생 |

## Position CSS

```css
.toast-zone {
  position: fixed;
  z-index: 99999;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}
.toast-zone > * { pointer-events: auto; }

.toast-zone-top-right    { top: 20px; right: 20px; }
.toast-zone-top-left     { top: 20px; left: 20px; }
.toast-zone-bottom-right { bottom: 20px; right: 20px; }
.toast-zone-bottom-left  { bottom: 20px; left: 20px; }
```

## Edge Cases

- **설정 마이그레이션**: 기존 사용자에게 `notifications` 키가 없으면 `DEFAULT_SETTINGS.notifications` 사용 (deep merge)
- **커스텀 사운드 크기**: 500KB/file, 2MB 총합 제한
- **동시 토스트**: 같은 zone에 여러 토스트 → 스택으로 쌓임
- **다른 위치 토스트 동시 표시**: zone별 컨테이너로 독립 관리
- **OS 알림 권한 거부**: 토글 비활성화 + 안내 메시지
- **OS 알림 + 인앱 사운드 중복**: OS 알림은 항상 `silent: true`로 생성
- **시스템 토스트 사운드**: 3종 모두 기본 `soundEnabled: false`로 기존 무음 동작 유지. 사용자가 원하면 설정에서 활성화 가능
