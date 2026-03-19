# X-Launchpad (xterm.js) 구축 계획서

## 🎯 목표

브라우저에서 xterm.js를 통해 실제 서버 쉘에 접속하고, 해당 쉘에서 `claude` CLI를 실행하여 Claude Code를 사용하는 웹 터미널 환경 구축

---

## 🏗️ 전체 아키텍처

```text
Browser (xterm.js)
    ↓ WebSocket
Node Server (ws + node-pty)
    ↓
Shell (bash/zsh)
    ↓
Claude CLI
```

---

## 📦 1단계: 환경 준비

### 1.1 서버 준비

* Node.js 설치된 환경 (Mac / Linux / Windows WSL 권장)
* 포트: 3000 사용 예정

### 1.2 Claude CLI 설치

```bash
npm install -g @anthropic-ai/claude-code
```

### 1.3 Claude 로그인

```bash
claude login
```

👉 반드시 서버에서 로그인 완료 상태여야 함

---

## 📁 2단계: 프로젝트 구조

```text
claude-web-terminal/
├── server/
│   └── index.ts
├── client/
│   └── index.html
├── package.json
└── README.md
```

---

## ⚙️ 3단계: 서버 구현

### 핵심 역할

* WebSocket 서버 생성
* 사용자별 PTY 생성
* 쉘 입출력 브리지

### 주요 기능

* node-pty로 쉘 생성
* WebSocket으로 데이터 전달
* 세션 종료 처리

### 체크리스트

* [ ] WebSocket 연결 처리
* [ ] pty.spawn 정상 동작
* [ ] 입력/출력 연결
* [ ] 연결 종료 시 쉘 kill

---

## 🖥️ 4단계: 클라이언트 구현

### 핵심 역할

* xterm.js UI 렌더링
* WebSocket 연결
* 키보드 입력 전달

### 주요 기능

* 터미널 렌더링
* 서버 메시지 출력
* 사용자 입력 전송

### 체크리스트

* [ ] xterm.js 로딩
* [ ] terminal.open 정상 동작
* [ ] ws 연결 성공
* [ ] 입력/출력 동기화

---

## 🔗 5단계: 터미널 연결 흐름

1. 브라우저 접속
2. WebSocket 연결
3. 서버에서 PTY 생성
4. 쉘 실행
5. 사용자 입력 → 쉘 전달
6. 쉘 출력 → 브라우저 표시

---

## 🚀 6단계: Claude CLI 실행

### 사용 흐름

```bash
claude
```

또는

```bash
cd 프로젝트경로
claude
```

### 목표 상태

* 브라우저에서 Claude Code 인터페이스 그대로 사용 가능

---

## 🔐 7단계: 보안 (필수)

### 최소 요구사항

* [ ] 인증 (JWT 또는 세션)
* [ ] 사용자별 PTY 분리
* [ ] 명령어 제한 (선택)
* [ ] rate limit 적용

### 위험 요소

* 서버 쉘이 그대로 노출됨
* 악의적인 명령 실행 가능

---

## ⚡ 8단계: 확장 계획

### 8.1 기능 확장

* 파일 탐색기 (Monaco Editor 연동)
* 멀티 세션 지원
* 세션 복구
* 로그 저장

### 8.2 고급 기능

* Docker sandbox 실행
* 사용자별 isolated 환경
* Claude 실행 자동화

---

## 🧪 9단계: 테스트 계획

### 기능 테스트

* [ ] WebSocket 연결
* [ ] 쉘 명령 실행 (`ls`, `pwd`)
* [ ] Claude 실행 (`claude`)
* [ ] 입력/출력 정상 동작

### 장애 테스트

* [ ] 연결 끊김 처리
* [ ] 서버 재시작 대응
* [ ] 다중 사용자 접속

---

## 📌 10단계: 최종 목표 상태

* 브라우저에서 터미널 사용 가능
* Claude CLI 실행 가능
* 로컬 터미널과 동일한 UX 제공

---

## 💡 핵심 요약

* xterm.js는 UI
* node-pty는 실제 터미널
* Claude는 쉘에서 실행
* 브라우저는 단순 인터페이스

---

## 🔥 완료 기준

✔ 브라우저에서 접속
✔ 터미널 입력 가능
✔ `claude` 실행 성공
✔ Claude Code 인터랙션 정상 동작

---
