# Supabase 유저 테이블 마이그레이션 Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SQLite users 테이블을 Supabase로 완전 교체하여 회원가입/로그인 데이터를 Supabase에 저장

**Architecture:** Supabase JS client를 통해 유저 CRUD 수행. bcrypt/JWT는 기존 서버 로직 유지. getUserCount()는 서버 시작 시 캐싱하고 등록 시 증가시켜 동기 호출 유지.

**Tech Stack:** @supabase/supabase-js, dotenv, Express, jsonwebtoken, bcryptjs

---

### Task 1: 환경 설정

**Files:**
- Modify: `.env.dev`
- Modify: `package.json`
- Modify: `server/index.ts:1-18` (dotenv import)

- [ ] **Step 1: .env.dev를 KEY=VALUE 형식으로 수정**

```
SUPABASE_URL=https://qvwhhxfizpdsmzduyihq.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF2d2hoeGZpenBkc216ZHV5aWhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MTE1NzgsImV4cCI6MjA4OTM4NzU3OH0.Nx_8S81ZxBAs_l8qGTMUKPTACLGYUDGc359-xgc8NjE
```

- [ ] **Step 2: 패키지 설치**

```bash
npm install @supabase/supabase-js dotenv
```

- [ ] **Step 3: server/index.ts 최상단에 dotenv 로드**

```typescript
import 'dotenv/config';  // 기존 import 전에 추가 (dotenv/config 자동 로드)
```

단, `.env.dev`를 로드하려면 시작 스크립트에서 `--env-file=.env.dev` 또는 `dotenv -e .env.dev` 사용. 혹은 `dotenv.config({ path: '.env.dev' })` 명시.

- [ ] **Step 4: .gitignore에 .env.dev 추가 확인**

`.env.dev`가 이미 untracked이고 `.gitignore`에 없으므로 추가:
```
.env.dev
```

- [ ] **Step 5: 커밋**

```bash
git add package.json package-lock.json .env.dev .gitignore
git commit -m "chore: add supabase-js, dotenv, configure env"
```

---

### Task 2: Supabase 클라이언트 및 유저 모듈 생성

**Files:**
- Create: `server/supabase.ts`

- [ ] **Step 1: Supabase 테이블 생성 SQL (Supabase Dashboard에서 실행)**

```sql
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS 비활성화 (서버 사이드 전용, anon key + service role 사용)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Server full access" ON users FOR ALL USING (true) WITH CHECK (true);
```

- [ ] **Step 2: server/supabase.ts 작성**

```typescript
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
}

const supabase = createClient(supabaseUrl, supabaseKey);

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  name: string;
  created_at: string;
  updated_at: string;
}

// 서버 시작 시 캐싱, 등록 시 증가
let cachedUserCount = 0;

export async function initUserCount(): Promise<void> {
  const { count, error } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true });
  if (error) throw error;
  cachedUserCount = count ?? 0;
}

export function getUserCount(): number {
  return cachedUserCount;
}

export async function createUser(email: string, passwordHash: string, name: string): Promise<number> {
  const { data, error } = await supabase
    .from('users')
    .insert({ email, password_hash: passwordHash, name })
    .select('id')
    .single();
  if (error) throw error;
  cachedUserCount++;
  return data.id;
}

export async function getUserByEmail(email: string): Promise<UserRow | null> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data as UserRow | null;
}

export async function getUserById(id: number): Promise<UserRow | null> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', id)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data as UserRow | null;
}
```

- [ ] **Step 3: 커밋**

```bash
git add server/supabase.ts
git commit -m "feat: add Supabase client with async user CRUD"
```

---

### Task 3: server/db.ts에서 유저 코드 제거

**Files:**
- Modify: `server/db.ts:43-184`

- [ ] **Step 1: db.ts에서 users 테이블 생성 SQL, 유저 prepared statements, 유저 함수, UserRow 인터페이스 모두 제거**

제거 대상:
- `CREATE TABLE IF NOT EXISTS users` (스키마 블록에서)
- `UserRow` 인터페이스
- `stmtCreateUser`, `stmtGetUserByEmail`, `stmtGetUserById`, `stmtGetUserCount`
- `createUser()`, `getUserByEmail()`, `getUserById()`, `getUserCount()`

- [ ] **Step 2: 커밋**

```bash
git add server/db.ts
git commit -m "refactor: remove SQLite user table and functions"
```

---

### Task 4: server/index.ts 유저 호출을 Supabase로 교체

**Files:**
- Modify: `server/index.ts`

- [ ] **Step 1: import 변경**

기존:
```typescript
import * as db from './db';
```

추가:
```typescript
import * as userDb from './supabase';
```

- [ ] **Step 2: 서버 시작 시 initUserCount() 호출**

기존 `server.listen()` 부분을 async로 감싸서 시작 전에 `await userDb.initUserCount()` 호출:

```typescript
async function startServer() {
  await userDb.initUserCount();
  server.listen(PORT, () => {
    console.log(`[server] Listening on :${PORT}`);
  });
}
startServer();
```

- [ ] **Step 3: 동기 함수에서 db.getUserCount() → userDb.getUserCount() 교체**

`isAuthEnabled()`, `isSetupRequired()`, `isRegistrationAllowed()`, `getAuthMode()`, 콘솔 로그 등에서:

```typescript
// 이 함수들은 동기 유지 — getUserCount()는 캐시된 값 반환
function isAuthEnabled(): boolean {
  return tokenAuthEnabled || userDb.getUserCount() > 0 || isSetupRequired();
}

function isSetupRequired(): boolean {
  return userDb.getUserCount() === 0 && !tokenAuthEnabled;
}
// ... 나머지 동일 패턴
```

- [ ] **Step 4: register 엔드포인트 async 호출 교체**

```typescript
app.post('/api/auth/register', async (req, res) => {
  // ... 기존 validation 유지 ...
  try {
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const userId = await userDb.createUser(email, hash, name || '');
    const user = await userDb.getUserById(userId);
    if (!user) throw new Error('User creation failed');
    const jwtToken = issueJwt({ id: user.id, email: user.email });
    console.log(`[auth] New user registered: ${email} (id: ${userId})`);
    res.json({
      ok: true,
      token: jwtToken,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (err: any) {
    recordAuthFailure(ip);
    res.status(400).json({ ok: false, error: 'Registration failed' });
  }
});
```

- [ ] **Step 5: login 엔드포인트 교체**

```typescript
const user = await userDb.getUserByEmail(email);
```

- [ ] **Step 6: auth/check 엔드포인트 교체**

```typescript
const user = await userDb.getUserById(payload.userId);
```

(이미 async handler 아닌 경우 async로 변경)

- [ ] **Step 7: 커밋**

```bash
git add server/index.ts
git commit -m "feat: replace SQLite user calls with Supabase"
```

---

### Task 5: 빌드 및 검증

**Files:**
- None (검증만)

- [ ] **Step 1: TypeScript 빌드 확인**

```bash
npm run build
```

Expected: 에러 없이 빌드 성공

- [ ] **Step 2: 서버 시작 확인**

```bash
npm run dev
```

Expected: `[server] Listening on :3000` 출력, Supabase 연결 에러 없음

- [ ] **Step 3: 수동 테스트 — 회원가입 후 Supabase Dashboard에서 데이터 확인**

- [ ] **Step 4: 최종 커밋**

```bash
git add -A
git commit -m "feat: complete Supabase user migration"
```
