// ═══════════════════════════════════════════════════
//  THEMES & CONSTANTS
// ═══════════════════════════════════════════════════
export const THEMES = [
  { id:'cyber',  label:'Cyber',  colors:['#050508','#00ffe5'],
    term:{ background:'#050508',foreground:'#c0fff8',cursor:'#00ffe5',cursorAccent:'#050508',selectionBackground:'#00ffe530',
           black:'#050508',red:'#ff3366',green:'#39ff78',yellow:'#ffb300',blue:'#60b0ff',magenta:'#bf80ff',cyan:'#00ffe5',white:'#c0fFF8',
           brightBlack:'#2a2a50',brightRed:'#ff6688',brightGreen:'#60ff99',brightYellow:'#ffd060',brightBlue:'#80c8ff',brightMagenta:'#d0a0ff',brightCyan:'#60ffef',brightWhite:'#e8e8ff'}},
  { id:'matrix', label:'Matrix', colors:['#020802','#39ff14'],
    term:{ background:'#020802',foreground:'#a0ffa0',cursor:'#39ff14',cursorAccent:'#020802',selectionBackground:'#39ff1430',
           black:'#020802',red:'#ff3366',green:'#39ff14',yellow:'#ccff00',blue:'#00ff88',magenta:'#88ff00',cyan:'#00ff88',white:'#a0ffa0',
           brightBlack:'#1a3a1a',brightRed:'#ff6688',brightGreen:'#60ff60',brightYellow:'#e0ff60',brightBlue:'#60ffaa',brightMagenta:'#aaff60',brightCyan:'#60ffcc',brightWhite:'#c0ffc0'}},
  { id:'amber',  label:'Amber',  colors:['#080400','#ffb300'],
    term:{ background:'#080400',foreground:'#ffe0a0',cursor:'#ffb300',cursorAccent:'#080400',selectionBackground:'#ffb30030',
           black:'#080400',red:'#ff3366',green:'#39ff78',yellow:'#ffb300',blue:'#ff6b35',magenta:'#ffd060',cyan:'#ffcc44',white:'#ffe0a0',
           brightBlack:'#3a2800',brightRed:'#ff6688',brightGreen:'#60ff99',brightYellow:'#ffd060',brightBlue:'#ff9966',brightMagenta:'#ffe080',brightCyan:'#ffdd88',brightWhite:'#fff0c0'}},
  { id:'frost',  label:'Frost',  colors:['#06080f','#60b0ff'],
    term:{ background:'#06080f',foreground:'#c0d8ff',cursor:'#60b0ff',cursorAccent:'#06080f',selectionBackground:'#60b0ff30',
           black:'#06080f',red:'#ff6688',green:'#60ffb0',yellow:'#ffd060',blue:'#60b0ff',magenta:'#c060ff',cyan:'#60e0ff',white:'#c0d8ff',
           brightBlack:'#1a2040',brightRed:'#ff88aa',brightGreen:'#80ffc0',brightYellow:'#ffe080',brightBlue:'#88c8ff',brightMagenta:'#d888ff',brightCyan:'#88eeff',brightWhite:'#e0eeff'}},
  { id:'blood',  label:'Blood',  colors:['#0a0505','#ff3366'],
    term:{ background:'#0a0505',foreground:'#ffb8b8',cursor:'#ff3366',cursorAccent:'#0a0505',selectionBackground:'#ff336630',
           black:'#0a0505',red:'#ff3366',green:'#ff9955',yellow:'#ff6b35',blue:'#ff80aa',magenta:'#ff60c0',cyan:'#ff8888',white:'#ffb8b8',
           brightBlack:'#2a1010',brightRed:'#ff6688',brightGreen:'#ffbb88',brightYellow:'#ff9966',brightBlue:'#ffaac8',brightMagenta:'#ff88d8',brightCyan:'#ffaaaa',brightWhite:'#ffd8d8'}},
  { id:'violet', label:'Violet', colors:['#070510','#bf80ff'],
    term:{ background:'#070510',foreground:'#ddc0ff',cursor:'#bf80ff',cursorAccent:'#070510',selectionBackground:'#bf80ff30',
           black:'#070510',red:'#ff6688',green:'#80ffbf',yellow:'#ffd060',blue:'#80a0ff',magenta:'#bf80ff',cyan:'#80d0ff',white:'#ddc0ff',
           brightBlack:'#201840',brightRed:'#ff88aa',brightGreen:'#a0ffd0',brightYellow:'#ffe080',brightBlue:'#a0b8ff',brightMagenta:'#d0a0ff',brightCyan:'#a0e0ff',brightWhite:'#f0e0ff'}},
];

export const AI_REGISTRY = {
  claude:   { label: 'Claude',   icon: 'icons/claude.svg',   notifyIcon: '✦', rgb: [191,128,255], color: '#d4a8ff' },
  chatgpt:  { label: 'ChatGPT',  icon: 'icons/chatgpt.svg',  notifyIcon: '●', rgb: [16,200,150],  color: '#20d4a0' },
  gemini:   { label: 'Gemini',   icon: 'icons/gemini.svg',   notifyIcon: '✦', rgb: [100,160,255], color: '#88bbff' },
  copilot:  { label: 'Copilot',  icon: 'icons/copilot.svg',  notifyIcon: '◎', rgb: [96,200,255],  color: '#60c8ff' },
  aider:    { label: 'Aider',    icon: 'icons/aider.svg',    notifyIcon: '◈', rgb: [255,200,80],  color: '#ffc850' },
  cursor:   { label: 'Cursor',   icon: 'icons/cursor.svg',   notifyIcon: '▸', rgb: [80,220,255],  color: '#50dcff' },
  codex:    { label: 'Codex',    icon: 'icons/codex.svg',    notifyIcon: '●', rgb: [16,163,127],  color: '#10a37f' },
  opencode: { label: 'OpenCode', icon: 'icons/opencode.svg', notifyIcon: '🔶', rgb: [255,160,80],  color: '#ffa050' },
};

export const KB_DEFS = [
  { key:'newSession',      label:'New Session' },
  { key:'closeSession',    label:'Close Session' },
  { key:'nextTab',         label:'Next Tab' },
  { key:'prevTab',         label:'Previous Tab' },
  { key:'renameSession',   label:'Rename Session' },
  { key:'clearTerminal',   label:'Clear Terminal' },
  { key:'openSettings',    label:'Open Settings' },
  { key:'fullscreen',      label:'Toggle Fullscreen' },
];
