# Email Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add email-based registration and login to Super Terminal, while maintaining backward compatibility with the existing AUTH_TOKEN mechanism.

**Architecture:** SQLite `users` table + bcryptjs password hashing + JWT session tokens. The existing `verifyToken()` function is extended to try JWT first, then fall back to legacy AUTH_TOKEN comparison. A first-user registration pattern restricts sign-ups after the initial account is created.

**Tech Stack:** bcryptjs, jsonwebtoken, existing SQLite (better-sqlite3), Express

**Spec:** `docs/superpowers/specs/2026-03-18-email-auth-design.md`

**Note:** Line numbers reference the original file before any modifications. As earlier tasks modify files, line numbers shift — always use the content shown in the code blocks as the anchor for search-and-replace, not the line number alone.

**Behavior change:** The old `verifyToken()` returns `true` when auth is disabled. The new version does not — it only returns `true` for valid JWT or legacy token. This is safe because `authMiddleware` and WebSocket auth both check `isAuthEnabled()` first.

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install bcryptjs and jsonwebtoken with types**

```bash
cd /Users/matthew_team42/dev/cluade-code-my-terminal/.claude/worktrees/amazing-poitras
npm install bcryptjs jsonwebtoken
npm install -D @types/bcryptjs @types/jsonwebtoken
```

- [ ] **Step 2: Verify installation**

```bash
node -e "require('bcryptjs'); require('jsonwebtoken'); console.log('OK')"
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add bcryptjs and jsonwebtoken dependencies"
```

---

### Task 2: Add users table and CRUD functions to db.ts

**Files:**
- Modify: `server/db.ts`

- [ ] **Step 1: Add users table schema**

Add the `users` table to the existing `db.exec` block in `server/db.ts`. Find the closing of the `db.exec(...)` call (the line containing only `` `); ``), and insert this SQL **inside** the template string, right before that closing line:

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

- [ ] **Step 2: Add UserRow interface and prepared statements**

After the `removeAnnotation` function and before the `// ─── Cleanup` section, add:

```typescript
// ─── Users ─────────────────────────────────────────
export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  name: string;
  created_at: number;
  updated_at: number;
}

const stmtCreateUser = db.prepare(
  'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)'
);
const stmtGetUserByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const stmtGetUserById = db.prepare('SELECT * FROM users WHERE id = ?');
const stmtGetUserCount = db.prepare('SELECT COUNT(*) as count FROM users');

export function createUser(email: string, passwordHash: string, name: string): number {
  const result = stmtCreateUser.run(email, passwordHash, name);
  return result.lastInsertRowid as number;
}

export function getUserByEmail(email: string): UserRow | null {
  return (stmtGetUserByEmail.get(email) as UserRow) || null;
}

export function getUserById(id: number): UserRow | null {
  return (stmtGetUserById.get(id) as UserRow) || null;
}

export function getUserCount(): number {
  const row = stmtGetUserCount.get() as { count: number };
  return row.count;
}
```

- [ ] **Step 3: Build and verify**

```bash
npm run build
```
Expected: Compiles with no errors.

- [ ] **Step 4: Commit**

```bash
git add server/db.ts
git commit -m "feat: add users table schema and CRUD functions"
```

---

### Task 3: Add JWT imports and secret management to index.ts

**Files:**
- Modify: `server/index.ts`

- [ ] **Step 1: Add imports**

After line 14 (`import * as db from './db';`), add:

```typescript
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
```

- [ ] **Step 2: Add JWT secret management**

After line 210 (`const authEnabled = AUTH_TOKEN.length > 0;`) — but NOTE: `authEnabled` will be replaced in the next step, so for now add this right after it:

```typescript
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const BCRYPT_ROUNDS = 12;
const ALLOW_REGISTRATION = process.env.ALLOW_REGISTRATION === '1';

function getJwtSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  let secret = db.getSetting('jwt_secret');
  if (!secret) {
    secret = crypto.randomBytes(64).toString('hex');
    db.setSetting('jwt_secret', secret);
    console.log('[auth] Generated and persisted new JWT secret');
  }
  return secret;
}

const JWT_SECRET = getJwtSecret();
```

- [ ] **Step 3: Build and verify**

```bash
npm run build
```
Expected: Compiles with no errors (new imports/vars may warn as unused, that's OK for now).

- [ ] **Step 4: Commit**

```bash
git add server/index.ts
git commit -m "feat: add JWT/bcrypt imports and secret management"
```

---

### Task 4: Rewrite auth logic in index.ts

**Files:**
- Modify: `server/index.ts` — lines 209-302 (the entire auth section)

This is the core change. Replace the existing auth block.

- [ ] **Step 1: Replace `authEnabled` with dynamic `isAuthEnabled`**

Replace line 210:
```typescript
const authEnabled = AUTH_TOKEN.length > 0;
```

With:
```typescript
const tokenAuthEnabled = AUTH_TOKEN.length > 0;

function isAuthEnabled(): boolean {
  return tokenAuthEnabled || db.getUserCount() > 0;
}

function isRegistrationAllowed(): boolean {
  if (ALLOW_REGISTRATION) return true;
  return db.getUserCount() === 0;
}

function getAuthMode(): 'email' | 'token' | 'none' {
  const hasUsers = db.getUserCount() > 0;
  if (hasUsers) return 'email';
  if (tokenAuthEnabled) return 'token';
  return 'none';
}
```

- [ ] **Step 2: Replace `verifyToken` and add `getTokenPayload`**

Replace the existing `verifyToken` function (lines 232-240) with:

```typescript
function verifyToken(token: string): boolean {
  if (!token) return false;
  // 1) Try JWT verification
  try {
    jwt.verify(token, JWT_SECRET);
    return true;
  } catch {}
  // 2) Fall back to legacy AUTH_TOKEN
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

function issueJwt(user: { id: number; email: string }): string {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
}
```

- [ ] **Step 3: Update `authMiddleware`**

Replace the existing `authMiddleware` (lines 248-268) with:

```typescript
function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!isAuthEnabled()) return next();
  // Allow auth endpoints without authentication
  if (['/api/auth/login', '/api/auth/check', '/api/auth/register'].includes(req.path)) return next();
  if (req.path === '/login' || req.path === '/login.html') return next();

  const token = extractToken(req);
  if (token && verifyToken(token)) return next();

  if (req.path.startsWith('/api/')) {
    res.status(401).json({ error: 'Unauthorized' });
  } else if (req.path === '/' || req.path === '/index.html') {
    res.redirect('/login');
  } else {
    // Allow static assets so login page CSS/JS/icons load
    next();
  }
}
```

- [ ] **Step 4: Update the `authEnabled` log**

Replace lines 270-272:
```typescript
if (authEnabled) {
  console.log('[auth] Token authentication enabled');
}
```

With:
```typescript
if (tokenAuthEnabled) {
  console.log('[auth] Legacy token authentication enabled');
}
console.log(`[auth] Email auth: ${db.getUserCount()} registered user(s), registration ${isRegistrationAllowed() ? 'allowed' : 'locked'}`);
```

- [ ] **Step 5: Update all `authEnabled` references in WebSocket sections**

In the data WebSocket section (around line 910), replace:
```typescript
  if (authEnabled) {
```
with:
```typescript
  if (isAuthEnabled()) {
```

In the control WebSocket section (around line 949), replace:
```typescript
  if (authEnabled) {
```
with:
```typescript
  if (isAuthEnabled()) {
```

- [ ] **Step 6: Build and verify**

```bash
npm run build
```
Expected: Compiles with no errors.

- [ ] **Step 7: Commit**

```bash
git add server/index.ts
git commit -m "feat: rewrite auth to support JWT + legacy token fallback"
```

---

### Task 5: Add register and update login/check endpoints

**Files:**
- Modify: `server/index.ts` — auth endpoints section (lines 280-302)

- [ ] **Step 1: Replace login endpoint**

Replace the existing `POST /api/auth/login` handler (lines 280-292) with:

```typescript
app.post('/api/auth/login', async (req, res) => {
  const ip = req.ip || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ ok: false, error: 'Too many attempts. Try again later.' });
  }

  const { email, password, token } = req.body || {};

  // Legacy token login
  if (token && !email) {
    if (tokenAuthEnabled && verifyToken(token)) {
      return res.json({ ok: true });
    }
    recordAuthFailure(ip);
    return res.status(401).json({ ok: false, error: 'Invalid credentials' });
  }

  // Email login
  if (!email || !password) {
    return res.status(400).json({ ok: false, error: 'Email and password required' });
  }

  const user = db.getUserByEmail(email);
  if (!user) {
    recordAuthFailure(ip);
    return res.status(401).json({ ok: false, error: 'Invalid credentials' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    recordAuthFailure(ip);
    return res.status(401).json({ ok: false, error: 'Invalid credentials' });
  }

  const jwtToken = issueJwt(user);
  res.json({
    ok: true,
    token: jwtToken,
    user: { id: user.id, email: user.email, name: user.name },
  });
});
```

- [ ] **Step 2: Add register endpoint**

Add before the `GET /api/auth/check` handler:

```typescript
app.post('/api/auth/register', async (req, res) => {
  const ip = req.ip || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ ok: false, error: 'Too many attempts. Try again later.' });
  }

  if (!isRegistrationAllowed()) {
    return res.status(403).json({ ok: false, error: 'Registration is not allowed' });
  }

  const { email, password, name } = req.body || {};

  // Validate email
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: 'Valid email is required' });
  }

  // Validate password length
  if (!password || password.length < 8) {
    return res.status(400).json({ ok: false, error: 'Password must be at least 8 characters' });
  }
  if (password.length > 128) {
    return res.status(400).json({ ok: false, error: 'Password must be at most 128 characters' });
  }

  try {
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const userId = db.createUser(email, hash, name || '');
    const user = db.getUserById(userId)!;
    const jwtToken = issueJwt(user);
    console.log(`[auth] New user registered: ${email} (id: ${userId})`);
    res.json({
      ok: true,
      token: jwtToken,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (err: any) {
    // UNIQUE constraint violation = duplicate email, but use generic message
    recordAuthFailure(ip);
    res.status(400).json({ ok: false, error: 'Registration failed' });
  }
});
```

- [ ] **Step 3: Update check endpoint**

Replace the existing `GET /api/auth/check` handler (lines 294-298) with:

```typescript
app.get('/api/auth/check', (req, res) => {
  const authOn = isAuthEnabled();
  if (!authOn) return res.json({ ok: true, authEnabled: false, authMode: 'none', registrationAllowed: false });

  const token = extractToken(req);
  const valid = token ? verifyToken(token) : false;

  const result: any = {
    ok: valid,
    authEnabled: true,
    authMode: getAuthMode(),
    registrationAllowed: isRegistrationAllowed(),
    tokenAuthEnabled,
  };

  // If JWT, include user info
  if (valid && token) {
    const payload = getTokenPayload(token);
    if (payload) {
      const user = db.getUserById(payload.userId);
      if (user) {
        result.user = { id: user.id, email: user.email, name: user.name };
      }
    }
  }

  res.json(result);
});
```

- [ ] **Step 4: Build and verify**

```bash
npm run build
```
Expected: Compiles with no errors.

- [ ] **Step 5: Commit**

```bash
git add server/index.ts
git commit -m "feat: add register endpoint, update login/check for email auth"
```

---

### Task 6: Rewrite login.html with login/register tabs

**Files:**
- Modify: `client/login.html` (complete rewrite)

- [ ] **Step 1: Rewrite login.html**

Replace the entire `client/login.html` with the new login/register tab UI. The design preserves the existing dark theme and `.login-box` styling.

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>SUPER TERMINAL — Login</title>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet"/>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{width:100%;height:100vh;background:#050508;color:#e8e8ff;font-family:'JetBrains Mono',monospace;
      display:flex;align-items:center;justify-content:center}
    .login-box{background:#0d0d18;border:1px solid #1e1e38;border-radius:8px;padding:40px;width:380px;
      box-shadow:0 0 40px rgba(0,255,229,.05)}
    .login-logo{text-align:center;margin-bottom:24px;font-size:14px;font-weight:600;letter-spacing:.15em;color:#00ffe5}
    .login-title{text-align:center;font-size:12px;color:#7777aa;margin-bottom:20px}
    .login-input{width:100%;background:#111120;color:#e8e8ff;border:1px solid #1e1e38;border-radius:4px;
      padding:10px 12px;font-family:inherit;font-size:13px;outline:none;margin-bottom:12px;transition:border .2s}
    .login-input:focus{border-color:#00ffe5;box-shadow:0 0 6px rgba(0,255,229,.2)}
    .login-input::placeholder{color:#7777aa}
    .login-btn{width:100%;background:#00ffe520;color:#00ffe5;border:1px solid #00ffe530;border-radius:4px;
      padding:10px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:all .2s;letter-spacing:.05em}
    .login-btn:hover{background:#00ffe5;color:#050508}
    .login-btn:disabled{opacity:.4;cursor:not-allowed}
    .login-error{color:#ff3366;font-size:11px;text-align:center;margin-top:12px;min-height:16px}
    .login-switch{text-align:center;margin-top:16px;font-size:11px;color:#7777aa}
    .login-switch a{color:#00ffe5;cursor:pointer;text-decoration:none}
    .login-switch a:hover{text-decoration:underline}
    .hidden{display:none}
  </style>
</head>
<body>
  <div class="login-box">
    <div class="login-logo">SUPER / TERMINAL</div>

    <!-- Login Form -->
    <div id="login-view">
      <div class="login-title">Sign in to your account</div>
      <form id="login-form">
        <input type="email" class="login-input" id="login-email" placeholder="Email" autocomplete="email" autofocus/>
        <input type="password" class="login-input" id="login-password" placeholder="Password" autocomplete="current-password"/>
        <button type="submit" class="login-btn">LOGIN</button>
      </form>
      <div class="login-error" id="login-error"></div>
      <div class="login-switch" id="switch-to-register">
        Don't have an account? <a id="show-register">Sign up</a>
      </div>
      <div class="login-switch hidden" id="switch-to-token">
        <a id="show-token">Login with access token</a>
      </div>
    </div>

    <!-- Register Form -->
    <div id="register-view" class="hidden">
      <div class="login-title">Create your account</div>
      <form id="register-form">
        <input type="text" class="login-input" id="register-name" placeholder="Name (optional)" autocomplete="name"/>
        <input type="email" class="login-input" id="register-email" placeholder="Email" autocomplete="email"/>
        <input type="password" class="login-input" id="register-password" placeholder="Password (8+ characters)" autocomplete="new-password"/>
        <input type="password" class="login-input" id="register-confirm" placeholder="Confirm password" autocomplete="new-password"/>
        <button type="submit" class="login-btn">SIGN UP</button>
      </form>
      <div class="login-error" id="register-error"></div>
      <div class="login-switch">
        Already have an account? <a id="show-login">Sign in</a>
      </div>
    </div>

    <!-- Token Form (legacy) -->
    <div id="token-view" class="hidden">
      <div class="login-title">Enter your access token to continue</div>
      <form id="token-form">
        <input type="password" class="login-input" id="token-input" placeholder="Access token" autocomplete="off"/>
        <button type="submit" class="login-btn">LOGIN</button>
      </form>
      <div class="login-error" id="token-error"></div>
      <div class="login-switch">
        <a id="show-login-from-token">Back to email login</a>
      </div>
    </div>
  </div>

  <script>
    // ─── DOM refs ──────────────────────────────────────
    const loginView = document.getElementById('login-view');
    const registerView = document.getElementById('register-view');
    const tokenView = document.getElementById('token-view');
    const switchToRegister = document.getElementById('switch-to-register');
    const switchToToken = document.getElementById('switch-to-token');

    const loginForm = document.getElementById('login-form');
    const loginEmail = document.getElementById('login-email');
    const loginPassword = document.getElementById('login-password');
    const loginError = document.getElementById('login-error');

    const registerForm = document.getElementById('register-form');
    const registerName = document.getElementById('register-name');
    const registerEmail = document.getElementById('register-email');
    const registerPassword = document.getElementById('register-password');
    const registerConfirm = document.getElementById('register-confirm');
    const registerError = document.getElementById('register-error');

    const tokenForm = document.getElementById('token-form');
    const tokenInput = document.getElementById('token-input');
    const tokenError = document.getElementById('token-error');

    // ─── View switching ────────────────────────────────
    function showView(view) {
      loginView.classList.toggle('hidden', view !== 'login');
      registerView.classList.toggle('hidden', view !== 'register');
      tokenView.classList.toggle('hidden', view !== 'token');
      // Clear errors
      loginError.textContent = '';
      registerError.textContent = '';
      tokenError.textContent = '';
    }

    document.getElementById('show-register').addEventListener('click', () => showView('register'));
    document.getElementById('show-login').addEventListener('click', () => showView('login'));
    document.getElementById('show-token').addEventListener('click', () => showView('token'));
    document.getElementById('show-login-from-token').addEventListener('click', () => showView('login'));

    // ─── Auth success handler ──────────────────────────
    function onAuthSuccess(token) {
      localStorage.setItem('super-terminal-token', token);
      window.location.href = '/?token=' + encodeURIComponent(token);
    }

    // ─── Auto-auth check ───────────────────────────────
    async function init() {
      const saved = localStorage.getItem('super-terminal-token');

      try {
        const url = saved
          ? '/api/auth/check?token=' + encodeURIComponent(saved)
          : '/api/auth/check';
        const res = await fetch(url);
        const data = await res.json();

        // Already authenticated
        if (data.ok && saved) {
          window.location.href = '/?token=' + encodeURIComponent(saved);
          return;
        }

        // Configure UI based on server auth mode
        if (!data.authEnabled) {
          // No auth configured — go straight to app
          window.location.href = '/';
          return;
        }

        // Show/hide registration link
        if (!data.registrationAllowed) {
          switchToRegister.classList.add('hidden');
        }

        // Show/hide token login link
        if (data.tokenAuthEnabled) {
          switchToToken.classList.remove('hidden');
        }

        // If auth mode is token-only (no email users, no registration), show token view
        if (data.authMode === 'token' && !data.registrationAllowed) {
          showView('token');
        }
      } catch {
        // Server unreachable — show login form anyway
      }
    }

    init();

    // ─── Login form ────────────────────────────────────
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      loginError.textContent = '';
      const email = loginEmail.value.trim();
      const password = loginPassword.value;
      if (!email || !password) return;

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (data.ok && data.token) {
          onAuthSuccess(data.token);
        } else {
          loginError.textContent = data.error || 'Login failed';
        }
      } catch {
        loginError.textContent = 'Connection error';
      }
    });

    // ─── Register form ─────────────────────────────────
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      registerError.textContent = '';
      const name = registerName.value.trim();
      const email = registerEmail.value.trim();
      const password = registerPassword.value;
      const confirm = registerConfirm.value;

      if (!email || !password) return;
      if (password.length < 8) {
        registerError.textContent = 'Password must be at least 8 characters';
        return;
      }
      if (password.length > 128) {
        registerError.textContent = 'Password must be at most 128 characters';
        return;
      }
      if (password !== confirm) {
        registerError.textContent = 'Passwords do not match';
        return;
      }

      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, name }),
        });
        const data = await res.json();
        if (data.ok && data.token) {
          onAuthSuccess(data.token);
        } else {
          registerError.textContent = data.error || 'Registration failed';
        }
      } catch {
        registerError.textContent = 'Connection error';
      }
    });

    // ─── Token form (legacy) ───────────────────────────
    tokenForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      tokenError.textContent = '';
      const token = tokenInput.value.trim();
      if (!token) return;

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();
        if (data.ok) {
          onAuthSuccess(token);
        } else {
          tokenError.textContent = data.error || 'Invalid token';
          tokenInput.select();
        }
      } catch {
        tokenError.textContent = 'Connection error';
      }
    });
  </script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add client/login.html
git commit -m "feat: rewrite login page with email login/register tabs"
```

---

### Task 7: Manual integration test

- [ ] **Step 1: Build the project**

```bash
cd /Users/matthew_team42/dev/cluade-code-my-terminal/.claude/worktrees/amazing-poitras
npm run build
```
Expected: No TypeScript errors.

- [ ] **Step 2: Start dev server and test registration flow**

Start the server:
```bash
npm run dev
```

In another terminal, test the auth check endpoint (should show no auth):
```bash
curl -s http://localhost:3000/api/auth/check | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');const j=JSON.parse(d);console.log(j);if(!j.authEnabled)console.log('PASS: no auth');else console.log('FAIL')"
```
Expected: `authEnabled: false` (no users, no AUTH_TOKEN).

- [ ] **Step 3: Test registration**

```bash
curl -s -X POST http://localhost:3000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"testpass123","name":"Test User"}'
```
Expected: `{ "ok": true, "token": "<jwt>", "user": { "id": 1, "email": "test@example.com", "name": "Test User" } }`

- [ ] **Step 4: Test login with registered email**

```bash
curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"testpass123"}'
```
Expected: `{ "ok": true, "token": "<jwt>", "user": {...} }`

- [ ] **Step 5: Test auth check with JWT**

Use the JWT from the previous step:
```bash
curl -s "http://localhost:3000/api/auth/check?token=<jwt-from-step-4>"
```
Expected: `{ "ok": true, "authEnabled": true, "authMode": "email", "user": {...} }`

- [ ] **Step 6: Test registration is now blocked**

```bash
curl -s -X POST http://localhost:3000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"test2@example.com","password":"testpass123","name":"Test2"}'
```
Expected: `{ "ok": false, "error": "Registration is not allowed" }` (first-user pattern: registration locked after first user).

- [ ] **Step 7: Test wrong password**

```bash
curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"wrongpassword"}'
```
Expected: `{ "ok": false, "error": "Invalid credentials" }`

- [ ] **Step 8: Test login page loads in browser**

Open `http://localhost:3000/login` in a browser. Verify:
- Login form is visible with email + password fields
- "Sign up" link is hidden (registration locked)
- The styling matches existing dark theme

- [ ] **Step 9: Clean up test database**

```bash
rm -f /Users/matthew_team42/dev/cluade-code-my-terminal/.claude/worktrees/amazing-poitras/data.db
```

- [ ] **Step 10: Final commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix: address issues found during integration testing"
```
(Only if changes were needed. Skip if everything passed.)
