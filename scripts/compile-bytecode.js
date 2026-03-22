/**
 * V8 바이트코드 컴파일 스크립트
 *
 * 반드시 Electron Node 런타임으로 실행해야 합니다:
 *   ELECTRON_RUN_AS_NODE=1 electron scripts/compile-bytecode.js
 *
 * 시스템 Node로 실행하면 V8 버전 불일치로 패키지 앱이 크래시합니다.
 */
const bytenode = require('bytenode');
const fs = require('fs');
const path = require('path');

// ─── V8 버전 검증 ──────────────────────────────────────────
const v8ver = process.versions.v8 || '';
if (!v8ver.includes('electron')) {
  console.error(`[bytecode] FATAL: 시스템 Node V8(${v8ver})로 실행 중!`);
  console.error('[bytecode] Electron V8가 필요합니다:');
  console.error('  ELECTRON_RUN_AS_NODE=1 electron scripts/compile-bytecode.js');
  process.exit(1);
}
console.log(`[bytecode] V8: ${v8ver} (Electron ${process.versions.electron})`);

// ─── 컴파일 대상 ───────────────────────────────────────────
// preload.js 제외: sandbox 환경에서 bytenode require 불가
const TARGETS = [
  // main.js 제외: Electron 엔트리 포인트는 패키지 앱에서 바이트코드 로딩 이슈
  'dist/electron/security.js',
];

const ROOT = path.resolve(__dirname, '..');

for (const file of TARGETS) {
  const filePath = path.join(ROOT, file);

  if (!fs.existsSync(filePath)) {
    console.warn(`[bytecode] skip (not found): ${file}`);
    continue;
  }

  console.log(`[bytecode] compiling: ${file}`);

  const jscPath = filePath.replace(/\.js$/, '.jsc');
  bytenode.compileFile({ filename: filePath, output: jscPath });

  // 원본 .js → 바이트코드 로더 스텁으로 교체
  const jscBasename = path.basename(jscPath);
  const stub = `'use strict';require('bytenode');require('./${jscBasename}');`;
  fs.writeFileSync(filePath, stub, 'utf8');

  const jscSize = fs.statSync(jscPath).size;
  console.log(`[bytecode] done: ${file} → ${jscBasename} (${(jscSize / 1024).toFixed(1)}KB)`);
}

console.log('[bytecode] all done');
