# Control Server — X-Launchpad 프로세스 관리 대시보드

**Date**: 2026-03-19
**Status**: Approved

## Overview

X-Launchpad(포트 3000)을 켜고 끌 수 있는 별도 경량 컨트롤 서버(포트 3001)를 만든다. 컨트롤 서버는 항상 실행되며, X-Launchpad 프로세스를 spawn/kill하고 상태를 모니터링한다.

서버가 꺼져 있을 때도 `localhost:3000`에 접근하면 "꺼짐 상태" 페이지를 보여주고, 켜져 있을 때는 X-Launchpad 메인 UI에서 플로팅 버튼으로 컨트롤 패널에 접근할 수 있다.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Control Server (포트 3001) — 항상 실행              │
│  ├─ Express (경량)                                   │
│  ├─ WebSocket (상태 실시간 push)                     │
│  ├─ child_process.spawn → X-Launchpad (포트 3000) │
│  ├─ 포트 3000 전환: OFF시 바인딩 / ON시 release      │
│  └─ 미니 대시보드 UI 제공                            │
└─────────────────────────────────────────────────────┘

사용자 접근:
  브라우저 → localhost:3000
    ├─ 서버 ON  → X-Launchpad UI (+ 왼쪽 아래 플로팅 버튼)
    └─ 서버 OFF → 컨트롤 서버가 3000에 바인딩 → "꺼짐 상태" UI
```

### 포트 전환 메커니즘

1. **X-Launchpad OFF**: 컨트롤 서버가 포트 3000에 미니 HTTP 서버를 바인딩하여 "꺼짐 상태" 페이지 제공
2. **POST /api/start**: 포트 3000 미니 서버를 close → X-Launchpad을 `child_process.spawn`으로 시작 (포트 3000 사용)
3. **POST /api/stop**: X-Launchpad 프로세스를 graceful kill → 포트 3000에 미니 서버 다시 바인딩

### Readiness Detection (시작 완료 감지)

포트 3000 release 후 X-Launchpad이 실제로 바인딩할 때까지 타이밍 갭이 존재한다. 이를 처리하는 흐름:

1. 포트 3000 미니 서버 `server.close()` 콜백 수신
2. X-Launchpad spawn
3. stdout에서 `"listening on"` 또는 `"Server running"` 메시지 파싱 → 1차 감지
4. 동시에 `localhost:3000/api/health` (또는 기존 엔드포인트)를 500ms 간격으로 폴링 → 2차 확인
5. 10초 타임아웃 내 응답 없으면:
   - 자식 프로세스 kill
   - 포트 3000 미니 서버 다시 바인딩
   - WebSocket으로 `{ type: 'start_failed', reason: 'timeout' }` push
6. 시작 완료 확인 시 → WebSocket으로 `{ type: 'started' }` push → 꺼짐 페이지 클라이언트가 `location.reload()`

### 프로세스 관리

- `child_process.spawn('node', ['dist/server/index.js'])` (production) 또는 `ts-node server/index.ts` (dev 모드)
- **cwd**: 프로젝트 루트 (`__dirname + '/..''` 또는 명시적 프로젝트 경로)
- **env**: `{ ...process.env }` — 컨트롤 서버가 로드한 `.env.dev` 환경변수가 그대로 상속됨
- **detached**: `false` (기본값) — 컨트롤 서버 종료 시 자식도 함께 종료
- stdout/stderr를 링 버퍼(최근 500줄)에 저장
- 프로세스 exit 이벤트 감지 → WebSocket으로 상태 변경 push
- 비정상 종료 시 상태 + exit code 기록
- **프로세스 그룹 정리**: stop 시 `process.kill(-pid, 'SIGTERM')` (프로세스 그룹 kill)으로 node-pty가 fork한 셸 프로세스까지 정리. 5초 후 `SIGKILL`

## API

컨트롤 서버(포트 3001)의 API. 127.0.0.1에서만 접근 가능 (보안).

```
GET  /api/health     → { ok: true } (항상 200, 외부 모니터링/readiness 체크용)
GET  /api/status     → { running, uptime, pid, port, sessions, cpu, memory }
POST /api/start      → X-Launchpad 시작
POST /api/stop       → X-Launchpad 종료 (graceful)
POST /api/restart    → stop + start
GET  /api/logs       → 최근 로그 (stdout/stderr 링 버퍼, 500줄)
GET  /api/logs?stream=1 → SSE 스트림으로 실시간 로그 push
WS   /ws             → 실시간 상태 push (1초 간격) + 로그 라인 push
```

### 인증 및 접근 제어

- 컨트롤 서버는 `127.0.0.1`에만 바인딩 (외부 접근 차단)
- 포트 3000 미니 서버(꺼짐 페이지)도 동일하게 `127.0.0.1`만
- LAN 접근이 필요한 경우: 환경변수 `CONTROL_HOST=0.0.0.0` 설정 시 기존 X-Launchpad JWT 인증 재사용

### CORS

- 컨트롤 서버(3001)는 `Access-Control-Allow-Origin: http://localhost:3000` 헤더 설정
- WebSocket은 origin 체크: `localhost:3000`, `localhost:3001` 허용
- LAN 접근 시 동적 origin 허용 (요청 origin 기반)

### 상태 정보 수집

- **uptime**: 프로세스 시작 시각 기준 계산
- **pid**: child_process.pid
- **sessions**: X-Launchpad의 `/api/sessions` 호출 또는 WebSocket으로 조회
- **cpu/memory**: `process.cpuUsage()` + `process.memoryUsage()` (child process에 대해 `pidusage` 라이브러리 사용)

## UI Components

### 1. 서버 OFF 페이지 (localhost:3000, 서버 꺼진 상태)

컨트롤 서버가 포트 3000에 바인딩하여 제공하는 정적 페이지.

- X-Launchpad 로고 + "서버가 꺼져 있습니다" 메시지
- 전원 버튼 (원형, 초록 테두리) → 클릭 시 `POST localhost:3001/api/start` 호출 (미니 서버는 `/api/*`를 3001로 프록시)
- 마지막 실행 정보: 종료 시각, 종료 사유, 저장된 세션 수
- 시작 중 상태: 스피너 + "서버 시작 중..." → 시작 완료 시 자동 리다이렉트

### 2. 플로팅 버튼 (X-Launchpad 메인 UI, 왼쪽 아래)

X-Launchpad이 켜져 있을 때 메인 UI에 표시되는 원형 버튼.

- 위치: `position: fixed; bottom: 24px; left: 24px;`
- 크기: 44x44px 원형
- 디자인: 그라데이션 배경 (파랑→보라), 번개 아이콘
- 클릭 시 플로팅 패널 토글
- Activity Bar 아래에 위치하므로 겹침 주의 → z-index 관리

### 3. 플로팅 패널 (펼친 상태)

플로팅 버튼 클릭 시 위로 펼쳐지는 미니 대시보드.

- 크기: ~260px 너비
- 위치: 플로팅 버튼 바로 위
- 내용:
  - 헤더: "X-Launchpad" + ON/OFF 뱃지
  - 상태 정보: Uptime, Sessions, CPU, Memory
  - 액션 버튼: Stop (빨강), Restart (초록), Logs (회색)
- Logs 버튼: 클릭 시 패널 확장 또는 모달로 최근 로그 표시
- 패널 밖 클릭 시 닫힘
- WebSocket(3001)으로 실시간 상태 업데이트

## File Structure

```
control-server/
├── index.ts              # 컨트롤 서버 엔트리포인트
├── process-manager.ts    # spawn/kill/restart 로직
├── port-switcher.ts      # 포트 3000 바인딩/release + /api/* 프록시
├── stats-collector.ts    # CPU/메모리/세션 수집
├── log-buffer.ts         # 링 버퍼 (stdout/stderr)
├── tsconfig.json         # 별도 TypeScript 설정
└── public/
    ├── index.html         # 서버 OFF 페이지
    ├── dashboard.html     # 대시보드 (3001 직접 접근 시, 플로팅 패널의 풀페이지 버전)
    ├── styles.css         # 공통 스타일
    └── app.js             # 클라이언트 JS

client/js/
└── control-panel.js      # 플로팅 버튼 + 패널 (X-Launchpad 내)
```

### 대시보드 페이지 (dashboard.html)

포트 3001에 직접 접근 시 보이는 풀페이지 대시보드. 플로팅 패널과 동일한 정보를 더 넓은 레이아웃으로 표시:
- 서버 상태 + 제어 버튼 (Start/Stop/Restart)
- 실시간 로그 뷰어 (스크롤 가능, 자동 스크롤)
- CPU/메모리 미니 차트
- 세션 목록

## Build Configuration

컨트롤 서버는 별도 TypeScript 프로젝트로 빌드:

```json
// control-server/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "../dist/control-server",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true
  },
  "include": ["./**/*"]
}
```

### npm scripts 추가

```json
{
  "scripts": {
    "dev:control": "ts-node control-server/index.ts",
    "build:control": "tsc -p control-server/tsconfig.json",
    "start:control": "node dist/control-server/index.js",
    "dev:all": "npm run dev:control"
  }
}
```

`dev:all`은 컨트롤 서버만 시작. X-Launchpad은 컨트롤 서버가 관리.

## Integration with X-Launchpad

### 메인 UI에 플로팅 버튼 추가

- `client/index.html`에 플로팅 버튼 + 패널 HTML 추가
- `client/js/control-panel.js` 신규 모듈:
  - 컨트롤 서버(3001) WebSocket 연결
  - 상태 실시간 업데이트
  - Stop/Restart/Logs 버튼 핸들러
- `client/styles.css`에 플로팅 버튼/패널 스타일 추가
- `client/js/main.js`에서 `control-panel.js` 초기화

### 기존 코드 변경 최소화

- X-Launchpad 서버 코드(`server/index.ts`) 변경 없음
- 클라이언트에 플로팅 버튼 UI + JS 모듈 추가만
- 컨트롤 서버는 완전히 독립적인 별도 프로세스

## Startup Flow

```
1. 사용자가 컨트롤 서버 시작: node control-server/index.ts
2. 컨트롤 서버가 포트 3001 바인딩 (대시보드)
3. 컨트롤 서버가 포트 3000 바인딩 (꺼짐 페이지)
4. 사용자가 브라우저에서 localhost:3000 접근 → 꺼짐 페이지
5. 전원 버튼 클릭 → POST /api/start
6. 컨트롤 서버: 포트 3000 release → X-Launchpad spawn
7. X-Launchpad 시작 완료 → 브라우저 자동 리다이렉트 → X-Launchpad UI
8. 플로팅 버튼 표시 → 클릭 시 컨트롤 패널 접근
```

## Dependencies

- `pidusage` — 자식 프로세스 CPU/메모리 모니터링 (**신규 설치 필요**: `npm i pidusage && npm i -D @types/pidusage`)
- `express` — 이미 프로젝트에 존재
- `ws` — 이미 프로젝트에 존재

### Configuration

환경변수 (`.env.dev`에 추가):

```
CONTROL_PORT=3001          # 컨트롤 서버 포트 (기본: 3001)
CONTROL_HOST=127.0.0.1     # 바인딩 호스트 (기본: 127.0.0.1)
AUTO_START=0               # 1이면 컨트롤 서버 시작 시 X-Launchpad 자동 시작
```

## Edge Cases

- **X-Launchpad 크래시**: exit 이벤트 감지 → 포트 3000 다시 바인딩 → 꺼짐 페이지에 "비정상 종료" 표시
- **포트 3000 이미 사용 중**: 시작 시 포트 충돌 감지 → 에러 메시지
- **컨트롤 서버 자체 종료**: 컨트롤 서버 종료 시 X-Launchpad도 같이 종료할지 선택 가능 (설정)
- **동시 시작 요청**: 이미 시작 중이면 중복 요청 무시
- **Graceful shutdown**: SIGTERM (프로세스 그룹) → 5초 대기 → SIGKILL
- **포트 3000 미니 서버의 API 라우팅**: 꺼짐 페이지에서 `/api/*` 요청은 `localhost:3001`로 프록시하여 크로스 오리진 문제 없이 시작 요청 가능
