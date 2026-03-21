const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

const ELECTRON_TARGETS = [
  'dist/electron/main.js',
  'dist/electron/preload.js',
  'dist/electron/security.js',
];

const SERVER_TARGETS = [
  'dist/server/index.js',
];

const OPTIONS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.5,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.2,
  debugProtection: true,
  debugProtectionInterval: 2000,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  log: false,
  numbersToExpressions: true,
  renameGlobals: false,
  selfDefending: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 5,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ['rc4'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 2,
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersType: 'function',
  stringArrayThreshold: 0.75,
  transformObjectKeys: true,
  unicodeEscapeSequence: false,
};

// 서버 사이드용 옵션 — debugProtection 비활성화 (Node.js에서 프로세스 행 방지)
const SERVER_OPTIONS = {
  ...OPTIONS,
  debugProtection: false,
  debugProtectionInterval: 0,
  selfDefending: false,
};

for (const file of ELECTRON_TARGETS) {
  const filePath = path.resolve(__dirname, '..', file);
  if (!fs.existsSync(filePath)) {
    console.warn(`[obfuscate] skip (not found): ${file}`);
    continue;
  }
  console.log(`[obfuscate] ${file}`);
  const code = fs.readFileSync(filePath, 'utf8');
  const result = JavaScriptObfuscator.obfuscate(code, {
    ...OPTIONS,
    debugProtection: false,
    debugProtectionInterval: 0,
  });
  fs.writeFileSync(filePath, result.getObfuscatedCode());
}

for (const file of SERVER_TARGETS) {
  const filePath = path.resolve(__dirname, '..', file);
  if (!fs.existsSync(filePath)) {
    console.warn(`[obfuscate] skip (not found): ${file}`);
    continue;
  }
  console.log(`[obfuscate] server: ${file}`);
  const code = fs.readFileSync(filePath, 'utf8');
  const result = JavaScriptObfuscator.obfuscate(code, SERVER_OPTIONS);
  fs.writeFileSync(filePath, result.getObfuscatedCode());
}

// dist/client JS 파일도 난독화
const clientDir = path.resolve(__dirname, '..', 'dist/client/assets');
if (fs.existsSync(clientDir)) {
  const jsFiles = fs.readdirSync(clientDir).filter(f => f.endsWith('.js'));
  for (const file of jsFiles) {
    const filePath = path.join(clientDir, file);
    console.log(`[obfuscate] client: ${file}`);
    const code = fs.readFileSync(filePath, 'utf8');
    const result = JavaScriptObfuscator.obfuscate(code, {
      ...OPTIONS,
      debugProtection: false,
      debugProtectionInterval: 0,
      selfDefending: false,
    });
    fs.writeFileSync(filePath, result.getObfuscatedCode());
  }
}

console.log('[obfuscate] done');
