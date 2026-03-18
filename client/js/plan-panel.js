// ─── PLAN PANEL: Markdown viewer + annotations ─────────────────
import { S, escHtml } from './state.js';
import { wsSend } from './websocket.js';
import { showToast } from './toast.js';

const planContent = document.getElementById('plan-content');
const planFileBar = document.getElementById('plan-file-bar');
const planFileName = document.getElementById('plan-file-name');
const annotPanel = document.getElementById('plan-annotations');
const annotList = document.getElementById('plan-annot-list');

let currentPlanFile = null;
let currentPlanContent = '';
let annotations = [];

const ANNOT_STORAGE_KEY = 'plan-annotations';

// ─── Markdown rendering (simple parser) ────────────
function renderMarkdown(md) {
  let html = escHtml(md);

  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) =>
    `<pre><code class="lang-${lang}">${code}</code></pre>`
  );

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headings
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold, italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

  // Checkboxes
  html = html.replace(/^- \[x\] (.+)$/gm, '<li><input type="checkbox" checked disabled> $1</li>');
  html = html.replace(/^- \[ \] (.+)$/gm, '<li><input type="checkbox" disabled> $1</li>');

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Blockquotes
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr>');

  // Paragraphs (double newlines)
  html = html.replace(/\n\n/g, '</p><p>');
  html = '<p>' + html + '</p>';

  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '');
  html = html.replace(/<p>(<h[1-3]>)/g, '$1');
  html = html.replace(/(<\/h[1-3]>)<\/p>/g, '$1');
  html = html.replace(/<p>(<pre>)/g, '$1');
  html = html.replace(/(<\/pre>)<\/p>/g, '$1');
  html = html.replace(/<p>(<ul>)/g, '$1');
  html = html.replace(/(<\/ul>)<\/p>/g, '$1');
  html = html.replace(/<p>(<blockquote>)/g, '$1');
  html = html.replace(/(<\/blockquote>)<\/p>/g, '$1');
  html = html.replace(/<p>(<hr>)/g, '$1');

  return html;
}

// ─── Annotations ────────────────────────────────────
function loadAnnotations() {
  try {
    const saved = localStorage.getItem(ANNOT_STORAGE_KEY);
    if (saved) annotations = JSON.parse(saved);
  } catch {}
}

function saveAnnotations() {
  try { localStorage.setItem(ANNOT_STORAGE_KEY, JSON.stringify(annotations)); } catch {}
}

function renderAnnotations() {
  if (!annotList) return;
  const fileAnnots = annotations.filter(a => a.file === currentPlanFile);
  if (fileAnnots.length === 0) {
    annotPanel.style.display = 'none';
    return;
  }
  annotPanel.style.display = '';
  annotList.innerHTML = fileAnnots.map((a, i) => {
    const typeLabel = { insert: '+', delete: '−', replace: '↔', comment: '?' }[a.type] || '?';
    return `<div class="plan-annot-item" data-idx="${i}">
      <span class="plan-annot-type ${a.type}">${typeLabel}</span>
      <span>${escHtml(a.text.slice(0, 60))}${a.text.length > 60 ? '…' : ''}</span>
    </div>`;
  }).join('');
}

function addAnnotation(type = 'comment') {
  const text = prompt(`${type} annotation:`);
  if (!text || !currentPlanFile) return;
  annotations.push({ file: currentPlanFile, type, text, created: Date.now() });
  saveAnnotations();
  renderAnnotations();
}

// ─── File loading ───────────────────────────────────
function loadPlanFile(filePath) {
  if (!S.activeSessionId) return;
  currentPlanFile = filePath;
  wsSend({ type: 'file_read', sessionId: S.activeSessionId, filePath });
}

export function handlePlanFileData(msg) {
  if (msg.error) {
    showToast(`Plan file error: ${msg.error}`, 'error');
    return;
  }
  if (msg.binary) {
    planContent.innerHTML = '<div class="plan-empty">Binary files are not supported</div>';
    return;
  }
  currentPlanContent = msg.content || '';
  planFileBar.style.display = 'flex';
  planFileName.textContent = (msg.filePath || '').split('/').pop();
  planFileName.title = msg.filePath || '';
  planContent.innerHTML = renderMarkdown(currentPlanContent);
  renderAnnotations();
}

function openFileDialog() {
  const filePath = prompt('Enter path to markdown file (relative to CWD):');
  if (!filePath) return;
  loadPlanFile(filePath);
}

function closePlanFile() {
  currentPlanFile = null;
  currentPlanContent = '';
  planFileBar.style.display = 'none';
  planContent.innerHTML = '<div class="plan-empty">No plan file loaded.<br/>Click 📄 to open a markdown file.</div>';
  annotPanel.style.display = 'none';
}

// ─── Init ───────────────────────────────────────────
export function initPlanPanel() {
  loadAnnotations();

  document.getElementById('plan-open-file')?.addEventListener('click', openFileDialog);
  document.getElementById('plan-refresh')?.addEventListener('click', () => {
    if (currentPlanFile) loadPlanFile(currentPlanFile);
  });
  document.getElementById('plan-file-close')?.addEventListener('click', closePlanFile);
  document.getElementById('plan-annot-add')?.addEventListener('click', () => addAnnotation('comment'));
}

export function onPlanSessionChange() {
  if (currentPlanFile) loadPlanFile(currentPlanFile);
}
