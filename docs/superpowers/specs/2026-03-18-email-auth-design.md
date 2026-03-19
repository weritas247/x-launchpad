# Email Authentication Design

## Summary

X-Launchpad의 기존 단순 토큰 인증을 이메일 기반 가입/로그인으로 확장한다.
기존 `AUTH_TOKEN` 방식은 하위 호환으로 유지하고, 새로운 이메일/비밀번호 인증을 추가한다.

## Motivation

- 현재 단일 토큰 공유 방식은 사용자 식별이 불가
- 이메일 가입으로 개인별 계정 관리 가능
- 추후 사용자별 세션 격리 등 확장의 기반

## Architecture

### Approach: SQLite + bcrypt + JWT

기존 SQLite DB(`data.db`)에 `users` 테이블 추가. bcrypt로 비밀번호 해싱, JWT로 세션 토큰 발급.

**선택 이유:**
- 기존 아키텍처(SQLite + 최소 의존성)와 일관
- 외부 서비스 불필요, 오프라인 동작
- WebSocket 인증과 자연스러운 통합

### Database Schema

```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT DEFAULT '',
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now'))
);
```

`db.ts`에 추가할 함수:
- `createUser(email, passwordHash, name)` → user id
- `getUserByEmail(email)` → user row | null
- `getUserById(id)` → user row | null
- `getUserCount()` → number (가입 허용 여부 판단용)

### Registration Access Control

터미널 앱은 셸 접근을 부여하므로, 가입을 무제한으로 열면 안 된다.

**First-user 패턴:**
- DB에 사용자가 0명일 때만 가입 가능 (첫 번째 사용자 = 관리자)
- 이후 추가 사용자 등록은 `ALLOW_REGISTRATION=1` 환경변수로 명시적 허용 필요
- 기본값: 가입 비활성화 (첫 사용자 등록 이후)
- `GET /api/auth/check`에서 `registrationAllowed` 플래그 반환 → 클라이언트가 가입 UI 표시 여부 결정

### API Endpoints

#### `POST /api/auth/register`
```json
// Request
{ "email": "user@example.com", "password": "securepass", "name": "User" }
// Response (success)
{ "ok": true, "token": "<jwt>", "user": { "id": 1, "email": "...", "name": "..." } }
// Response (error — 일반적인 메시지로 이메일 존재 여부 노출 방지)
{ "ok": false, "error": "Registration failed" }
```

**Validation:**
- email: 유효한 이메일 형식
- password: 최소 8자, 최대 128자 (bcrypt 72바이트 제한 고려)
- name: 선택 사항

#### `POST /api/auth/login` (기존 엔드포인트 확장)
```json
// Request — 이메일 로그인
{ "email": "user@example.com", "password": "securepass" }
// Request — 레거시 토큰 로그인 (하위 호환)
{ "token": "existing-auth-token" }
// Response (이메일 로그인 성공)
{ "ok": true, "token": "<jwt>", "user": { "id": 1, "email": "...", "name": "..." } }
// Response (레거시 토큰 로그인 성공)
{ "ok": true }
// Response (실패 — 일반적인 메시지로 계정 존재 여부 노출 방지)
{ "ok": false, "error": "Invalid credentials" }
```

로그인 요청에 `email` 필드가 있으면 이메일 로그인, `token` 필드만 있으면 기존 토큰 로그인.

#### `GET /api/auth/check`
```json
{
  "ok": true,
  "authEnabled": true,
  "authMode": "email" | "token" | "none",
  "registrationAllowed": true,
  "user": { "id": 1, "email": "...", "name": "..." }
}
```

### `authEnabled` 재정의

현재 `authEnabled = AUTH_TOKEN.length > 0`만으로 판단.

**변경:**
```typescript
const tokenAuthEnabled = AUTH_TOKEN.length > 0;
// emailAuthEnabled는 동적 — users 테이블에 사용자가 1명 이상 존재하거나 ALLOW_REGISTRATION=1일 때
function isAuthEnabled(): boolean {
  return tokenAuthEnabled || getUserCount() > 0;
}
```

- `AUTH_TOKEN` 미설정 + users 테이블 비어있음 → 인증 비활성화 (기존 동작 유지)
- `AUTH_TOKEN` 설정 → 토큰 인증 활성화
- users 테이블에 사용자 존재 → 이메일 인증 활성화
- 둘 다 가능 → 이메일 우선, 토큰 폴백

### Authentication Flow

```
가입: email+password → POST /api/auth/register → 가입 허용 체크 → bcrypt hash → DB 저장 → JWT 발급
로그인: email+password → POST /api/auth/login → DB 조회 → bcrypt verify → JWT 발급
레거시 로그인: token → POST /api/auth/login → AUTH_TOKEN 비교 → { ok: true }
인증: Bearer 토큰 → verifyToken() → JWT decode 성공이면 true, 아니면 레거시 토큰 비교
```

### Token Verification

`verifyToken`은 기존과 동일하게 `boolean`만 반환. 사용자 정보가 필요한 곳에서는 별도 `getTokenPayload` 사용.

```typescript
function verifyToken(token: string): boolean {
  // 1) JWT 검증 시도
  try {
    jwt.verify(token, JWT_SECRET);
    return true;
  } catch {}
  // 2) 레거시 AUTH_TOKEN 폴백
  if (tokenAuthEnabled && AUTH_TOKEN) {
    try {
      return timingSafeEqual(Buffer.from(token), Buffer.from(AUTH_TOKEN));
    } catch {}
  }
  return false;
}

function getTokenPayload(token: string): { userId: number; email: string } | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub: number; email: string };
    return { userId: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}
```

WebSocket 인증도 동일한 `verifyToken()` 사용하므로 자동 호환.

### authMiddleware 업데이트

```typescript
function authMiddleware(req, res, next) {
  if (!isAuthEnabled()) return next();
  // 인증 없이 접근 가능한 경로
  if (['/api/auth/login', '/api/auth/check', '/api/auth/register'].includes(req.path)) return next();
  if (req.path === '/login' || req.path === '/login.html') return next();
  // ... 기존 로직 동일
}
```

### Client Changes (`login.html`)

현재 단일 토큰 입력 폼을 **로그인/가입 탭 전환** UI로 교체:

**로그인 탭 (기본):**
- 이메일 입력
- 비밀번호 입력
- "로그인" 버튼
- "계정이 없으신가요? 가입" 링크 (서버에서 `registrationAllowed: true`일 때만 표시)

**가입 탭:**
- 이름 입력 (선택)
- 이메일 입력
- 비밀번호 입력 (8~128자)
- 비밀번호 확인 입력
- "가입" 버튼
- "이미 계정이 있으신가요? 로그인" 링크

**스타일:** 기존 `.login-box` 디자인 유지, 탭 전환만 추가.

**레거시 호환:** `AUTH_TOKEN`이 설정된 경우(`authMode`가 `token` 포함 시) "토큰으로 로그인" 링크를 하단에 표시.

**초기화 로직:**
1. 페이지 로드 시 `/api/auth/check` 호출
2. `authMode`, `registrationAllowed` 에 따라 UI 동적 구성
3. 저장된 토큰이 있으면 자동 인증 시도

### JWT Secret 관리

`JWT_SECRET` 환경변수가 미설정일 때 랜덤 생성하면 서버 재시작 시 모든 세션이 무효화된다.

**해결:** 자동 생성된 시크릿을 DB `settings` 테이블에 영구 저장:
```typescript
function getJwtSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  let secret = getSetting('jwt_secret');
  if (!secret) {
    secret = crypto.randomBytes(64).toString('hex');
    setSetting('jwt_secret', secret);
  }
  return secret;
}
```

### Security

| 항목 | 구현 |
|------|------|
| 비밀번호 해싱 | bcrypt, salt rounds 12 |
| 비밀번호 길이 | 최소 8자, 최대 128자 |
| JWT 만료 | 7일 (환경변수 `JWT_EXPIRES_IN` 오버라이드 가능) |
| JWT 시크릿 | `JWT_SECRET` 환경변수, 미설정 시 DB에 자동 생성/영구 저장 |
| Rate limiting | 기존 IP 기반 rate limit 유지 (가입/로그인 모두 적용) |
| 이메일 유효성 | 서버 측 정규식 검증 |
| 계정 열거 방지 | 가입 실패/로그인 실패 시 일반적 에러 메시지만 반환 |
| 가입 제한 | First-user 패턴 + `ALLOW_REGISTRATION` 환경변수 |
| 토큰 전달 | Bearer 헤더 또는 query param (기존 방식 유지) |

### New Dependencies

```json
{
  "bcryptjs": "^2.4.3",
  "@types/bcryptjs": "^2.4.6",
  "jsonwebtoken": "^9.0.2",
  "@types/jsonwebtoken": "^9.0.7"
}
```

참고: 네이티브 `bcrypt` 대신 순수 JS `bcryptjs` 사용 — C++ 빌드 도구 불필요, 크로스 플랫폼 호환성.

### Environment Variables

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `AUTH_TOKEN` | `''` | 레거시 토큰 (기존과 동일) |
| `JWT_SECRET` | DB 자동 생성 | JWT 서명 시크릿 |
| `JWT_EXPIRES_IN` | `'7d'` | JWT 만료 기간 |
| `ALLOW_REGISTRATION` | `''` | `1`이면 신규 가입 상시 허용 |

### Files Changed

1. **`server/db.ts`** — `users` 테이블 스키마 + CRUD 함수 추가
2. **`server/index.ts`** — 인증 로직 확장 (register 엔드포인트, login 확장, verifyToken/getTokenPayload, authEnabled 재정의, middleware 업데이트)
3. **`client/login.html`** — 로그인/가입 탭 UI로 교체
4. **`package.json`** — bcryptjs, jsonwebtoken 의존성 추가

### What's NOT Included

- 이메일 인증 (확인 메일 발송) — SMTP 필요, 향후 확장 가능
- 비밀번호 리셋 — 향후 확장 가능
- OAuth/소셜 로그인 — 향후 확장 가능
- 사용자별 세션 격리 — 별도 기능으로 분리
- 토큰 폐기/블랙리스트 — 7일 만료로 대체, 향후 확장 가능
- 로그아웃 API — 클라이언트 측 localStorage 삭제로 처리
