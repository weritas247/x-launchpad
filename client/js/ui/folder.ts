import { S, terminalMap, folderMap, escHtml } from '../core/state';
import { getFolderIcon } from './file-icons';

export function createFolder(name) {
  const id = 'folder-' + ++S.folderCounter;
  const folderName = typeof name === 'string' && name ? name : 'Folder ' + S.folderCounter;

  const el = document.createElement('div');
  el.className = 'folder-item open';
  el.dataset.folderId = id;
  el.innerHTML = `
    <div class="folder-header">
      <span class="folder-arrow">▶</span>
      <span class="folder-icon">${getFolderIcon(true)}</span>
      <span class="folder-name">${escHtml(folderName)}</span>
      <span class="folder-count"></span>
      <button class="folder-close-btn" title="Delete folder">✕</button>
    </div>
    <div class="folder-children"></div>
  `;

  const header = el.querySelector('.folder-header');
  const children = el.querySelector('.folder-children');
  const nameEl = el.querySelector('.folder-name');
  const countEl = el.querySelector('.folder-count');
  const closeBtn = el.querySelector('.folder-close-btn');

  header.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.folder-close-btn')) return;
    el.classList.toggle('open');
    el.querySelector('.folder-icon').innerHTML = getFolderIcon(el.classList.contains('open'));
  });

  nameEl.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    const input = document.createElement('input');
    input.className = 'folder-name-input';
    input.value = nameEl.textContent;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    const commit = () => {
      const newName = input.value.trim() || folderName;
      const span = document.createElement('span');
      span.className = 'folder-name';
      span.textContent = newName;
      input.replaceWith(span);
      folderMap.get(id).name = newName;
      span.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        nameEl.dispatchEvent(new Event('dblclick'));
      });
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') {
        input.value = nameEl.textContent;
        commit();
      }
    });
  });

  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const sessionListEl = document.getElementById('session-list');
    [...children.querySelectorAll('.session-item')].forEach((s) => sessionListEl.appendChild(s));
    el.remove();
    folderMap.delete(id);
  });

  el.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('text/sidebar-session')) {
      e.preventDefault();
      e.stopPropagation();
      el.classList.add('drag-over');
    }
  });
  el.addEventListener('dragleave', (e) => {
    if (!el.contains(e.relatedTarget as Node)) el.classList.remove('drag-over');
  });
  el.addEventListener('drop', (e) => {
    const srcId = e.dataTransfer.getData('text/sidebar-session');
    el.classList.remove('drag-over');
    if (!srcId) return;
    e.preventDefault();
    e.stopPropagation();
    const entry = terminalMap.get(srcId);
    if (entry) {
      children.appendChild(entry.sidebarEl);
      el.classList.add('open');
      el.querySelector('.folder-icon').innerHTML = getFolderIcon(true);
      updateFolderCount(countEl, children);
    }
  });

  document.getElementById('session-list').appendChild(el);
  folderMap.set(id, { el, name: folderName, open: true });
  updateFolderCount(countEl, children);
  return el;
}

export function updateFolderCount(countEl, children) {
  const n = children.querySelectorAll('.session-item').length;
  countEl.textContent = n > 0 ? `(${n})` : '';
}

export function initFolderDnD() {
  const sessionListEl = document.getElementById('session-list');
  sessionListEl.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('text/sidebar-session') && e.target === sessionListEl) {
      e.preventDefault();
      sessionListEl.classList.add('drag-over-root');
    }
  });
  sessionListEl.addEventListener('dragleave', (e) => {
    if (!sessionListEl.contains(e.relatedTarget as Node)) sessionListEl.classList.remove('drag-over-root');
  });
  sessionListEl.addEventListener('drop', (e) => {
    const srcId = e.dataTransfer.getData('text/sidebar-session');
    sessionListEl.classList.remove('drag-over-root');
    if (!srcId) return;
    const entry = terminalMap.get(srcId);
    if (entry && entry.sidebarEl.closest('.folder-children')) {
      e.preventDefault();
      sessionListEl.insertBefore(entry.sidebarEl, document.getElementById('session-empty'));
      document.querySelectorAll('.folder-children').forEach((fc) => {
        const folder = fc.closest('.folder-item');
        if (folder) updateFolderCount(folder.querySelector('.folder-count'), fc);
      });
    }
  });
}
