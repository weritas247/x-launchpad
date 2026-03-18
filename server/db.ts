// ─── SQLite persistence layer (WAL mode) ────────────────────────
import Database from 'better-sqlite3';
import * as path from 'path';

const DB_PATH = path.join(__dirname, '../../data.db');
const db = new Database(DB_PATH);

// Enable WAL mode for concurrent read/write safety
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

// ─── Schema ─────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    cwd TEXT DEFAULT '',
    cmd TEXT DEFAULT '',
    updated_at INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS drafts (
    key TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    updated_at INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file TEXT NOT NULL,
    type TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );

`);

// ─── Settings ───────────────────────────────────────
const stmtGetSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const stmtSetSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, strftime(\'%s\',\'now\'))');

export function getSetting(key: string): string | null {
  const row = stmtGetSetting.get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setSetting(key: string, value: string): void {
  stmtSetSetting.run(key, value);
}

export function getSettings(): Record<string, unknown> | null {
  const raw = getSetting('app_settings');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function saveSettings(settings: Record<string, unknown>): void {
  setSetting('app_settings', JSON.stringify(settings));
}

// ─── Sessions ───────────────────────────────────────
const stmtListSessions = db.prepare('SELECT * FROM sessions ORDER BY created_at');
const stmtUpsertSession = db.prepare('INSERT OR REPLACE INTO sessions (id, name, created_at, cwd, cmd, updated_at) VALUES (?, ?, ?, ?, ?, strftime(\'%s\',\'now\'))');
const stmtDeleteSession = db.prepare('DELETE FROM sessions WHERE id = ?');
const stmtClearSessions = db.prepare('DELETE FROM sessions');

export interface SessionRow {
  id: string;
  name: string;
  created_at: number;
  cwd: string;
  cmd: string;
}

export function listSessions(): SessionRow[] {
  return stmtListSessions.all() as SessionRow[];
}

export function upsertSession(id: string, name: string, createdAt: number, cwd: string, cmd?: string): void {
  stmtUpsertSession.run(id, name, createdAt, cwd, cmd || '');
}

export function deleteSession(id: string): void {
  stmtDeleteSession.run(id);
}

export function saveSessions(sessions: Array<{ id: string; name: string; createdAt: number; cwd: string; cmd?: string }>): void {
  const transaction = db.transaction(() => {
    stmtClearSessions.run();
    for (const s of sessions) {
      stmtUpsertSession.run(s.id, s.name, s.createdAt, s.cwd, s.cmd || '');
    }
  });
  transaction();
}

// ─── Drafts ─────────────────────────────────────────
const stmtGetDraft = db.prepare('SELECT content FROM drafts WHERE key = ?');
const stmtSetDraft = db.prepare('INSERT OR REPLACE INTO drafts (key, content, updated_at) VALUES (?, ?, strftime(\'%s\',\'now\'))');

export function getDraft(key: string): string | null {
  const row = stmtGetDraft.get(key) as { content: string } | undefined;
  return row ? row.content : null;
}

export function setDraft(key: string, content: string): void {
  stmtSetDraft.run(key, content);
}

// ─── Annotations ────────────────────────────────────
const stmtListAnnotations = db.prepare('SELECT * FROM annotations WHERE file = ? ORDER BY created_at');
const stmtInsertAnnotation = db.prepare('INSERT INTO annotations (file, type, text) VALUES (?, ?, ?)');
const stmtDeleteAnnotation = db.prepare('DELETE FROM annotations WHERE id = ?');

export interface AnnotationRow {
  id: number;
  file: string;
  type: string;
  text: string;
  created_at: number;
}

export function listAnnotations(file: string): AnnotationRow[] {
  return stmtListAnnotations.all(file) as AnnotationRow[];
}

export function addAnnotation(file: string, type: string, text: string): number {
  const result = stmtInsertAnnotation.run(file, type, text);
  return result.lastInsertRowid as number;
}

export function removeAnnotation(id: number): void {
  stmtDeleteAnnotation.run(id);
}

// ─── Cleanup ────────────────────────────────────────
export function close(): void {
  db.close();
}
