import { contextBridge } from 'electron';

// 최소한의 API만 노출 — 현재는 빈 브릿지
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  devMode: process.argv.includes('--dev'),
});
