#!/usr/bin/env node
/**
 * 개발 모드 Electron 앱 번들을 X-Launchpad로 리브랜딩
 * - Electron.app → X-Launchpad.app 폴더 이름 변경
 * - Info.plist의 CFBundleName, CFBundleDisplayName, CFBundleIdentifier 변경
 * - 커스텀 아이콘 복사
 * - path.txt 업데이트
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const electronDist = path.join(__dirname, '..', 'node_modules', 'electron', 'dist');
const oldApp = path.join(electronDist, 'Electron.app');
const newApp = path.join(electronDist, 'X-Launchpad.app');
const pathTxt = path.join(__dirname, '..', 'node_modules', 'electron', 'path.txt');
const customIcon = path.join(__dirname, '..', 'build', 'icon.icns');

// 1. 폴더명 변경
if (fs.existsSync(oldApp)) {
  if (fs.existsSync(newApp)) fs.rmSync(newApp, { recursive: true });
  fs.renameSync(oldApp, newApp);
  console.log('[rebrand] Electron.app → X-Launchpad.app');
}

if (!fs.existsSync(newApp)) {
  console.log('[rebrand] X-Launchpad.app not found, skipping');
  process.exit(0);
}

// 2. path.txt 업데이트
fs.writeFileSync(pathTxt, 'X-Launchpad.app/Contents/MacOS/Electron');
console.log('[rebrand] path.txt updated');

// 3. Info.plist 수정
const plist = path.join(newApp, 'Contents', 'Info.plist');
try {
  const cmds = [
    `Set :CFBundleName 'X-Launchpad'`,
    `Set :CFBundleDisplayName 'X-Launchpad'`,
    `Set :CFBundleIdentifier 'com.xlaunchpad.dev'`,
  ];
  for (const cmd of cmds) {
    try {
      execSync(`/usr/libexec/PlistBuddy -c "${cmd}" "${plist}"`, { stdio: 'pipe' });
    } catch {
      // CFBundleDisplayName이 없으면 추가
      if (cmd.includes('DisplayName')) {
        execSync(`/usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string 'X-Launchpad'" "${plist}"`, { stdio: 'pipe' });
      }
    }
  }
  console.log('[rebrand] Info.plist updated');
} catch (e) {
  console.warn('[rebrand] PlistBuddy failed:', e.message);
}

// 4. 아이콘 복사
if (fs.existsSync(customIcon)) {
  const dest = path.join(newApp, 'Contents', 'Resources', 'electron.icns');
  fs.copyFileSync(customIcon, dest);
  console.log('[rebrand] icon.icns copied');
}

// 5. 재서명
try {
  execSync(`codesign --sign - --force --deep "${newApp}"`, { stdio: 'pipe' });
  console.log('[rebrand] codesigned');
} catch (e) {
  console.warn('[rebrand] codesign failed:', e.message);
}

console.log('[rebrand] Done');
