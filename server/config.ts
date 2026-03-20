/**
 * Application configuration defaults and settings persistence.
 */
import * as fs from 'fs';
import * as db from './db';
import { env } from './env';

export const DEFAULT_SETTINGS = {
  appearance: {
    theme: 'cyber',
    fontFamily: '"JetBrains Mono",monospace',
    fontSize: 12,
    sidebarFontSize: 12,
    statusBarFontSize: 11,
    tabBarFontSize: 8,
    inputPanelFontSize: 11,
    fileViewerFontSize: 13,
    gitGraphFontSize: 12,
    kanbanFontSize: 12,
    lineHeight: 1.25,
    cursorStyle: 'block',
    cursorBlink: true,
    backgroundOpacity: 1.0,
    crtScanlines: true,
    crtScanlinesIntensity: 0.07,
    crtFlicker: true,
    vignette: true,
    glowIntensity: 0.4,
    screenDimOpacity: 0.05,
  },
  terminal: {
    scrollback: 5000,
    bellStyle: 'none',
    copyOnSelect: false,
    rightClickPaste: true,
    trimCopied: true,
    wordSeparators: ' ()[]{}\'":;,`|',
    renderer: 'canvas',
  },
  shell: {
    shellPath: env.SHELL,
    startDirectory: env.HOME,
    env: {} as Record<string, string>,
    sessionNameFormat: 'shell-{n}',
    autoReconnect: true,
  },
  keybindings: {
    newSession: 'Ctrl+Shift+T',
    closeTab: 'Ctrl+w',
    nextTab: 'Ctrl+Tab',
    prevTab: 'Ctrl+Shift+Tab',
    openSettings: 'Ctrl+,',
    fullscreen: 'F11',
    renameSession: 'Ctrl+Shift+r',
    clearTerminal: 'Meta+k',
    splitSession: '',
    gitGraph: 'Ctrl+g',
    toggleSidebar: 'Ctrl+b',
    focusSearch: 'Ctrl+Shift+f',
    focusExplorer: 'Ctrl+Shift+e',
    focusSourceControl: 'Ctrl+Shift+g',
    toggleInputPanel: 'Meta+i',
    planModal: 'Ctrl+p',
    toggleFileEdit: 'Ctrl+e',
    openPalette: 'Meta+p',
    openCommandPalette: 'Meta+Shift+p',
  },
  notifications: {
    global: {
      volume: 80,
      soundEnabled: true,
      osNotification: true,
      position: 'top-right' as const,
      duration: 5000,
      customSound: null as string | null,
    },
    types: {
      success:    { enabled: true, volume: null as number | null, soundEnabled: false as boolean | null, osNotification: false as boolean | null, position: null as string | null, duration: 3000 as number | null, customSound: null as string | null },
      error:      { enabled: true, volume: null as number | null, soundEnabled: false as boolean | null, osNotification: false as boolean | null, position: null as string | null, duration: 5000 as number | null, customSound: null as string | null },
      info:       { enabled: true, volume: null as number | null, soundEnabled: false as boolean | null, osNotification: false as boolean | null, position: null as string | null, duration: 3000 as number | null, customSound: null as string | null },
      aiDone:     { enabled: true, volume: null as number | null, soundEnabled: null as boolean | null, osNotification: null as boolean | null, position: null as string | null, duration: null as number | null, customSound: null as string | null },
      aiQuestion: { enabled: true, volume: null as number | null, soundEnabled: null as boolean | null, osNotification: null as boolean | null, position: null as string | null, duration: null as number | null, customSound: null as string | null },
    },
  },
  advanced: {
    customCss: '',
    wsReconnectInterval: 3000,
    logLevel: 'info',
  },
};

export type AppSettings = typeof DEFAULT_SETTINGS;

export function deepMerge(defaults: any, saved: any): any {
  const result = { ...defaults };
  for (const key of Object.keys(saved)) {
    if (
      saved[key] &&
      typeof saved[key] === 'object' &&
      !Array.isArray(saved[key]) &&
      defaults[key] &&
      typeof defaults[key] === 'object'
    ) {
      result[key] = deepMerge(defaults[key], saved[key]);
    } else {
      result[key] = saved[key];
    }
  }
  return result;
}

function migrateKeybindings(settings: any): void {
  const kb = settings?.keybindings;
  if (!kb) return;
  // closeSession → closeTab (renamed)
  if (kb.closeSession !== undefined && kb.closeTab === undefined) {
    kb.closeTab = kb.closeSession;
  }
  delete kb.closeSession;
}

export function loadSettings(settingsPath: string): AppSettings {
  // Try SQLite first
  try {
    const dbSettings = db.getSettings();
    if (dbSettings) {
      migrateKeybindings(dbSettings);
      return deepMerge(DEFAULT_SETTINGS, dbSettings as any);
    }
  } catch {}
  // Fall back to JSON file (and migrate to SQLite)
  try {
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      const parsed = JSON.parse(raw);
      migrateKeybindings(parsed);
      const settings = deepMerge(DEFAULT_SETTINGS, parsed);
      try {
        db.saveSettings(settings);
      } catch {} // migrate
      return settings;
    }
  } catch {}
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

export function saveSettings(s: AppSettings, settingsPath: string): void {
  db.saveSettings(s);
  // Also write JSON file for backwards compatibility
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2), 'utf-8');
  } catch {}
}
