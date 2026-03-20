# X-Launchpad

Browser-based multi-session terminal for running Claude CLI through the web. Built with xterm.js + node-pty, featuring Git integration, code editing, and AI-aware monitoring.

![Node.js](https://img.shields.io/badge/Node.js-≥20.0.0-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-Server-3178C6?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)

## Features

- **Multi-session Terminal** — Create, rename, restore, and switch between multiple terminal sessions
- **Split Pane Layout** — Drag-and-drop split panes for side-by-side terminals
- **Git Integration** — Commit graph visualization, staging, diff, branch management, push/pull
- **Code Editor** — Built-in CodeMirror editor with syntax highlighting (10+ languages)
- **File Explorer** — Browse, search, edit, upload, and download files
- **AI Monitoring** — Claude CLI detection, token usage tracking, prompt history
- **Planning Board** — Kanban-style task board for AI-driven development
- **Themes** — Cyber (CRT scanlines, vignette, glow), light, dark, and custom themes
- **Authentication** — JWT + Supabase auth with rate limiting
- **Remote Access** — Deployable via Cloudflare Tunnel with Zero Trust 2FA

## Quick Start

```bash
# Requirements: Node.js >= 20, native build tools for node-pty

git clone https://github.com/weritas247/x-launchpad.git
cd x-launchpad
npm install
npm run dev
```

Open `http://localhost:3000` in your browser.

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server (ts-node) |
| `npm run build` | Compile TypeScript |
| `npm start` | Run production build |
| `npm test` | Run tests (Jest) |
| `npm run lint` | Lint with ESLint |
| `npm run format` | Format with Prettier |
| `npm run build:editor` | Bundle CodeMirror editor |
| `npm run dev:control` | Start control panel server |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Browser (client/)                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│  │ xterm.js │  │CodeMirror│  │Git Graph │  │Sidebar │  │
│  │ Terminal │  │ Editor   │  │  (SVG)   │  │ Panels │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───┬────┘  │
│       └──────────────┴─────────────┴────────────┘       │
│                        WebSocket                        │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────┴────────────────────────────────┐
│  Server (server/)              Node.js + Express        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│  │ node-pty │  │ Handlers │  │ Services │  │  Auth  │  │
│  │  (PTY)   │  │ git,file │  │claude,git│  │  JWT   │  │
│  └──────────┘  └──────────┘  └──────────┘  └────────┘  │
│                    ┌──────────┐                          │
│                    │ SQLite   │                          │
│                    │ (WAL)    │                          │
│                    └──────────┘                          │
└─────────────────────────────────────────────────────────┘
```

## Project Structure

```
server/
├── index.ts              # Express + WebSocket + node-pty bridge
├── config.ts             # App settings & persistence
├── db.ts                 # SQLite WAL mode (sessions, settings, drafts)
├── auth.ts               # JWT auth & rate limiting
├── handlers/             # WebSocket message handlers
│   ├── session.ts        #   Session lifecycle
│   ├── git.ts            #   Git operations
│   ├── file.ts           #   File operations
│   └── claude.ts         #   Claude usage tracking
├── services/             # Business logic
│   ├── claude-service.ts #   JSONL parsing, token calculation
│   └── git-service.ts    #   Git command execution
└── routes/               # REST endpoints
    ├── auth.ts           #   Login, registration
    └── plans.ts          #   AI planning board

client/
├── index.html            # Main terminal UI
├── styles.css            # Cyber theme & animations
└── js/
    ├── core/             # State, WebSocket, keybindings
    ├── terminal/         # Session management, split panes
    ├── sidebar/          # Source control, git graph, explorer, search
    ├── editor/           # CodeMirror editor, file viewer
    └── ui/               # Themes, settings, notifications, mobile
```

## Configuration

Settings are managed through the in-app settings modal (`Ctrl+,`) and persisted to SQLite.

**Key settings categories:**
- **Appearance** — Theme, font size/family, CRT effects, glow intensity
- **Terminal** — Scrollback, bell style, copy-on-select, renderer (webgl/canvas)
- **Shell** — Shell path, start directory, session name format
- **Keybindings** — Customizable keyboard shortcuts
- **Advanced** — WebSocket reconnect interval, log level

## Deployment

For remote access via Cloudflare Tunnel, see [docs/cloudflare-tunnel-guide.md](docs/cloudflare-tunnel-guide.md).

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Terminal | xterm.js 5.3, xterm-addon-webgl |
| Editor | CodeMirror 6 |
| Server | Express 4.18, TypeScript 5.3 |
| PTY | node-pty 1.1 |
| Database | better-sqlite3 (WAL mode) |
| WebSocket | ws 8.16 |
| Auth | jsonwebtoken, bcryptjs, Supabase |
| Testing | Jest, ts-jest |
| Linting | ESLint, Prettier |

## License

MIT
