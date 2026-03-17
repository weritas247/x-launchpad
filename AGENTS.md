# AGENTS.md — claude-web-terminal (Super Terminal)

**Generated:** 2026-03-17

## OVERVIEW

Browser-based multi-session terminal. xterm.js frontend connects via WebSocket to Node server running node-pty shells. Designed for running Claude CLI through a browser.

## STRUCTURE

```
server/
  index.ts             # Express + WebSocket + node-pty bridge
client/
  index.html           # xterm.js terminal UI
  js/                  # Client-side logic (11 modules: themes, sessions, AI detection, etc.)
  icons/               # UI icons
docs/                  # Specifications and design docs
sessions.json          # Persistent session data
settings.json          # App configuration
```

## COMMANDS

```bash
npm run dev            # ts-node server/index.ts (development)
npm run build          # tsc (compile TypeScript)
npm start              # node dist/server/index.js (production)
```

## CONVENTIONS

- **Server:** TypeScript. Express serves static `client/` and handles WebSocket upgrades.
- **Client:** Vanilla JS (no framework, no bundler). xterm.js loaded directly.
- **Sessions:** Multi-session support — each WebSocket connection spawns a node-pty instance.
- **macOS ARM64:** postinstall chmod on node-pty spawn-helper.

## NOTES

- node-pty requires native compilation — `npm install` may fail without build tools.
- See `PLAN.md` for the original architecture plan and feature roadmap.
- `settings.json` and `sessions.json` are runtime state files, not configs to version-control.
- No test framework configured.
