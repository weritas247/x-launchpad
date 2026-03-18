# Cloudflare Tunnel 설정 가이드

Super Terminal을 퍼블릭 도메인으로 안전하게 노출하기 위한 Cloudflare Tunnel 설정 매뉴얼입니다.

## 목차

- [개요](#개요)
- [아키텍처](#아키텍처)
- [사전 준비](#사전-준비)
- [설치](#설치)
- [터널 생성 및 DNS 연결](#터널-생성-및-dns-연결)
- [터널 설정 파일](#터널-설정-파일)
- [앱 보안 강화](#앱-보안-강화)
- [Cloudflare Access 2차 인증](#cloudflare-access-2차-인증)
- [터널 실행](#터널-실행)
- [자동 시작 (서비스 등록)](#자동-시작-서비스-등록)
- [다중 머신 운용](#다중-머신-운용)
- [문제 해결](#문제-해결)
- [유용한 명령어](#유용한-명령어)
- [보안 체크리스트](#보안-체크리스트)

---

## 개요

### Cloudflare Tunnel이란?

Cloudflare Tunnel(구 Argo Tunnel)은 로컬 서버를 인터넷에 안전하게 노출하는 서비스입니다.

**기존 방식 (포트포워딩):**
```
인터넷 → 공유기 포트포워딩 → 집 IP 노출 → 로컬 서버
```

**Cloudflare Tunnel:**
```
인터넷 → Cloudflare Edge (HTTPS + DDoS 방어) → 암호화된 터널 → 로컬 서버
```

### 장점

| 항목 | 설명 |
|------|------|
| 포트포워딩 불필요 | 공유기 설정 변경 없이 사용 가능 |
| IP 비노출 | 집 공인 IP가 외부에 노출되지 않음 |
| 무료 HTTPS | SSL 인증서 자동 발급 및 갱신 |
| DDoS 방어 | Cloudflare Edge 네트워크의 보호 |
| Zero Trust 연동 | 이메일 OTP 등 2차 인증 무료 제공 |

### 비용

| 항목 | 비용 | 주기 |
|------|------|------|
| 도메인 (`.win`, `.xyz` 등) | $1~$10 | 연간 |
| Cloudflare Tunnel | 무료 | - |
| Cloudflare Access (50명 이하) | 무료 | - |
| HTTPS/SSL | 무료 | - |

---

## 아키텍처

### 접속 흐름

```
[외부 브라우저]
  → https://super-terminal.win
  → Cloudflare Edge (전 세계 분산, 가장 가까운 PoP)
  → Cloudflare Access (2차 인증 — 이메일 OTP)
  → Cloudflare Tunnel (QUIC 암호화 커넥션)
  → 집 서버 localhost:3031
  → 앱 로그인 (JWT 인증)
  → 터미널 사용
```

### 보안 계층

```
[Layer 1] Cloudflare Access — 이메일 OTP 인증
[Layer 2] App Login — JWT + bcrypt 비밀번호 인증
[Layer 3] WebSocket Auth — JWT 토큰 검증
[Layer 4] Cloudflare DDoS/WAF — 네트워크 레벨 보호
```

---

## 사전 준비

1. **Cloudflare 계정**: https://dash.cloudflare.com 가입
2. **도메인**: Cloudflare Registrar에서 직접 구매 권장 (네임서버 자동 설정)
   - Dashboard → Domain Registration → Register Domains
   - 가장 저렴한 TLD 선택 (`.win`, `.uk`, `.org` 등)
3. **도메인 활성화 확인**: Dashboard → Domains에서 녹색 체크 표시

---

## 설치

### macOS

```bash
brew install cloudflared
```

### Linux (Debian/Ubuntu)

```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared
sudo mv cloudflared /usr/local/bin/
```

### 설치 확인

```bash
cloudflared --version
```

---

## 터널 생성 및 DNS 연결

### 1. Cloudflare 로그인

```bash
cloudflared tunnel login
```

- 브라우저가 열리면 Cloudflare에 로그인
- 사용할 도메인 선택
- `~/.cloudflared/cert.pem` 인증서가 다운로드됨
- 브라우저에서 직접 다운받은 경우: `cp ~/Downloads/cert.pem ~/.cloudflared/cert.pem`

### 2. 터널 생성

```bash
cloudflared tunnel create super-terminal
```

출력 예시:
```
Tunnel credentials written to /Users/USERNAME/.cloudflared/TUNNEL_ID.json
Created tunnel super-terminal with id TUNNEL_ID
```

> **중요**: `TUNNEL_ID.json` 파일은 터널 인증에 사용됩니다. 절대 외부에 공유하지 마세요.

### 3. DNS 레코드 연결

```bash
# 루트 도메인 연결
cloudflared tunnel route dns super-terminal super-terminal.win

# 서브도메인 연결 (선택)
cloudflared tunnel route dns super-terminal dev.super-terminal.win
```

이 명령은 Cloudflare DNS에 CNAME 레코드를 자동으로 추가합니다.

### 4. 터널 확인

```bash
cloudflared tunnel list
```

---

## 터널 설정 파일

`~/.cloudflared/config.yml` 파일을 생성합니다:

```yaml
tunnel: TUNNEL_ID
credentials-file: /Users/USERNAME/.cloudflared/TUNNEL_ID.json

ingress:
  - hostname: super-terminal.win
    service: http://localhost:3031
  - service: http_status:404
```

### 설정 항목 설명

| 항목 | 설명 |
|------|------|
| `tunnel` | 터널 ID (터널 생성 시 출력된 UUID) |
| `credentials-file` | 터널 인증 JSON 파일 경로 |
| `ingress.hostname` | 외부에서 접속할 도메인 |
| `ingress.service` | 내부 서비스 주소 (앱 서버) |
| 마지막 `service: http_status:404` | 매칭되지 않는 요청에 404 반환 (필수) |

### 다중 서비스 예시

```yaml
ingress:
  - hostname: super-terminal.win
    service: http://localhost:3031
  - hostname: api.super-terminal.win
    service: http://localhost:4000
  - hostname: grafana.super-terminal.win
    service: http://localhost:3000
  - service: http_status:404
```

---

## 앱 보안 강화

### .env.dev 설정

```env
# 기존 설정
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=xxx

# 보안 설정 (퍼블릭 노출 시 필수)
JWT_SECRET=여기에_강력한_랜덤_문자열
JWT_EXPIRES_IN=1d
ALLOW_REGISTRATION=0
```

### JWT_SECRET 생성

```bash
openssl rand -hex 64
```

> **중요**: `JWT_SECRET`을 설정하지 않으면 자동 생성된 키가 SQLite에 저장됩니다.
> 퍼블릭 노출 시에는 반드시 환경변수로 강력한 시크릿을 직접 지정하세요.

### 설정 항목 설명

| 항목 | 값 | 설명 |
|------|---|------|
| `JWT_SECRET` | 128자 hex | JWT 서명에 사용하는 비밀 키 |
| `JWT_EXPIRES_IN` | `1d` | 토큰 만료 시간 (기본 7일 → 1일로 단축) |
| `ALLOW_REGISTRATION` | `0` | 첫 번째 사용자 등록 후 추가 등록 차단 |

---

## Cloudflare Access 2차 인증

앱 로그인 앞단에 Cloudflare 이메일 OTP 인증을 추가합니다.

### 설정 방법

1. **Zero Trust 대시보드** 접속
   - Cloudflare Dashboard 왼쪽 메뉴 → **Zero Trust**
   - 또는 https://one.dash.cloudflare.com

2. **Application 생성**
   - Access controls → Applications → Add an application
   - **Self-hosted** 선택

3. **Basic Information 설정**
   - Application name: `Super Terminal`
   - Session Duration: `24 hours`
   - Add public hostname → Domain: `super-terminal.win`

4. **Policy 생성**
   - Policies 탭 → Add a policy 또는 Create new policy
   - Policy name: `Allow me`
   - Action: `Allow`
   - Include → Selector: **Emails**
   - Value: 본인 이메일 주소

5. **Save application**

### 동작 방식

```
1. 브라우저에서 super-terminal.win 접속
2. Cloudflare Access가 이메일 입력 화면 표시
3. 허용된 이메일 입력 → OTP 코드 발송
4. OTP 입력 → 24시간 세션 유지
5. 앱 로그인 페이지 표시
```

### 추가 인증 방법 (선택)

Cloudflare Access는 이메일 OTP 외에도 다양한 인증 방법을 지원합니다:

- Google 로그인
- GitHub 로그인
- Microsoft 계정
- SAML/OIDC 연동

Login methods 탭에서 설정 가능합니다.

---

## 터널 실행

### 수동 실행

```bash
cloudflared tunnel run super-terminal
```

### 백그라운드 실행

```bash
cloudflared tunnel run super-terminal &
```

### 정상 연결 확인

로그에 아래와 같이 표시되면 정상:
```
INF Registered tunnel connection connIndex=0 ... location=icn06 protocol=quic
INF Registered tunnel connection connIndex=1 ... location=icn01 protocol=quic
INF Registered tunnel connection connIndex=2 ... location=icn06 protocol=quic
INF Registered tunnel connection connIndex=3 ... location=icn05 protocol=quic
```

- `location=icn` → 서울(인천) Cloudflare PoP에 연결됨
- 보통 4개의 커넥션이 생성됨 (고가용성)

---

## 자동 시작 (서비스 등록)

### macOS — cloudflared 서비스 등록

```bash
# 서비스 등록 (부팅 시 자동 시작)
brew services start cloudflared
```

또는 수동으로 LaunchAgent 등록:

```bash
sudo cloudflared service install
```

### macOS — 앱 서버 자동 시작

`~/Library/LaunchAgents/com.super-terminal.plist` 파일 생성:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.super-terminal</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>dist/server/index.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/path/to/super-terminal</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/super-terminal.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/super-terminal-error.log</string>
</dict>
</plist>
```

```bash
# 등록
launchctl load ~/Library/LaunchAgents/com.super-terminal.plist

# 해제
launchctl unload ~/Library/LaunchAgents/com.super-terminal.plist
```

### Linux — systemd 서비스

```bash
# cloudflared 서비스
sudo cloudflared service install

# 앱 서버 서비스
sudo cat > /etc/systemd/system/super-terminal.service << 'EOF'
[Unit]
Description=Super Terminal
After=network.target

[Service]
Type=simple
User=YOUR_USER
WorkingDirectory=/path/to/super-terminal
ExecStart=/usr/bin/node dist/server/index.js
Restart=always
RestartSec=5
EnvironmentFile=/path/to/super-terminal/.env.dev

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable super-terminal
sudo systemctl start super-terminal
```

---

## 다중 머신 운용

여러 컴퓨터에서 각각 터널을 운영할 수 있습니다.

### 서브도메인으로 분리

```bash
# 집 컴퓨터 (이미 설정됨)
super-terminal.win → 집 서버:3031

# 회사 컴퓨터 (추가 설정)
cloudflared tunnel login
cloudflared tunnel create work-terminal
cloudflared tunnel route dns work-terminal work.super-terminal.win
```

회사 컴퓨터의 `~/.cloudflared/config.yml`:
```yaml
tunnel: WORK_TUNNEL_ID
credentials-file: /Users/USERNAME/.cloudflared/WORK_TUNNEL_ID.json

ingress:
  - hostname: work.super-terminal.win
    service: http://localhost:3031
  - service: http_status:404
```

### Cloudflare Access에 서브도메인 추가

Access controls → Applications → Super Terminal 편집:
- Add public hostname → `work.super-terminal.win` 추가

### 결과

| 도메인 | 연결 대상 | 용도 |
|--------|----------|------|
| `super-terminal.win` | 집 컴퓨터 | 항상 켜둠 (메인 서버) |
| `work.super-terminal.win` | 회사 컴퓨터 | 업무 시간만 사용 |

같은 포트(3031)를 사용해도 서로 다른 머신이므로 충돌 없음.

---

## 문제 해결

### 502 Bad Gateway

```
Host: Error
```

**원인**: 터널은 연결되었지만 로컬 앱 서버가 꺼져 있음

**해결**:
```bash
# 앱 서버 확인
curl -s -o /dev/null -w "%{http_code}" http://localhost:3031

# 앱 서버가 안 돌고 있으면 시작
npm run dev
# 또는
npm start
```

### Unable to find your Access application

**원인**: Cloudflare Access Application에 hostname이 설정되지 않음

**해결**:
- Zero Trust → Access controls → Applications → 해당 앱 편집
- Basic information 탭에서 Public hostname에 도메인이 있는지 확인
- 캐시 문제일 수 있으므로 시크릿 모드로 접속 시도

### EADDRINUSE 에러

```
Error: listen EADDRINUSE: address already in use 0.0.0.0:3031
```

**원인**: 해당 포트를 이미 다른 프로세스가 사용 중

**해결**:
```bash
# 포트 사용 프로세스 확인
lsof -i:3031 -P

# 해당 프로세스 종료
kill $(lsof -ti:3031)
```

### 터널 연결 안됨

```bash
# 터널 상태 확인
cloudflared tunnel info super-terminal

# cert.pem 확인
ls ~/.cloudflared/cert.pem

# credentials 파일 확인
ls ~/.cloudflared/*.json

# 터널 로그 확인 (verbose)
cloudflared tunnel --loglevel debug run super-terminal
```

### DNS 전파 대기

터널 DNS 설정 후 접속이 안 되면 DNS 전파에 시간이 걸릴 수 있습니다:

```bash
# DNS 확인
dig super-terminal.win CNAME

# 기대 출력: TUNNEL_ID.cfargotunnel.com
```

---

## 유용한 명령어

### 터널 관리

```bash
# 터널 목록
cloudflared tunnel list

# 터널 정보
cloudflared tunnel info super-terminal

# 터널 삭제 (DNS 레코드 먼저 삭제 필요)
cloudflared tunnel delete super-terminal

# DNS 라우트 삭제
cloudflared tunnel route dns --delete super-terminal super-terminal.win
```

### 터널 실행 & 종료

```bash
# 실행
cloudflared tunnel run super-terminal

# 백그라운드 실행
cloudflared tunnel run super-terminal &

# 종료
pkill -f "cloudflared tunnel run"
```

### 서비스 관리 (brew)

```bash
# 서비스 시작
brew services start cloudflared

# 서비스 중지
brew services stop cloudflared

# 서비스 상태
brew services list | grep cloudflared
```

### 로그 확인

```bash
# 실시간 로그
cloudflared tunnel --loglevel info run super-terminal

# 디버그 로그
cloudflared tunnel --loglevel debug run super-terminal

# 메트릭 확인
curl http://127.0.0.1:20241/metrics
```

---

## 보안 체크리스트

퍼블릭 노출 전 반드시 확인하세요:

- [ ] **HTTPS 적용** — Cloudflare Tunnel 사용 시 자동 적용
- [ ] **JWT_SECRET 설정** — `.env.dev`에 강력한 랜덤 문자열 설정
- [ ] **ALLOW_REGISTRATION=0** — 첫 번째 사용자 등록 후 추가 등록 차단
- [ ] **JWT_EXPIRES_IN 단축** — 7d → 1d 권장
- [ ] **Cloudflare Access 설정** — 이메일 OTP 2차 인증 추가
- [ ] **WebSocket 인증 확인** — `/pty`, `/` 양쪽 WebSocket 모두 JWT 검증 적용됨
- [ ] **집 IP 비노출** — Cloudflare Tunnel 사용 시 자동 보호
- [ ] **credential 파일 보호** — `~/.cloudflared/*.json`, `cert.pem` 외부 유출 금지
- [ ] **`.env.dev` 보호** — `.gitignore`에 포함 확인

---

## 현재 설정 요약

| 항목 | 값 |
|------|---|
| 도메인 | `super-terminal.win` |
| 터널 이름 | `super-terminal` |
| 터널 ID | `7b56f5ad-17c4-4e59-b9fb-73afc09c54a9` |
| 로컬 서비스 | `http://localhost:3031` |
| Cloudflare Access | 이메일 OTP (`secondwarren@gmail.com`) |
| JWT 만료 | 1일 |
| 등록 허용 | 비활성화 |
