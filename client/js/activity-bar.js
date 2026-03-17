// ─── ACTIVITY BAR (LEFT ICON BAR) ────────────────────────────────
import { requestFileTree } from './explorer.js';
import { requestGitStatus } from './source-control.js';

let activePanel = 'sessions'; // 'sessions' | 'explorer' | 'source-control'

export function initActivityBar() {
  const buttons = document.querySelectorAll('.activity-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = btn.dataset.panel;
      if (panel === activePanel) {
        // Toggle sidebar visibility
        toggleSidebar();
      } else {
        switchPanel(panel);
      }
    });
  });
}

export function switchPanel(panel) {
  activePanel = panel;

  // Update active button
  document.querySelectorAll('.activity-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.panel === panel);
  });

  // Update visible panel
  document.querySelectorAll('.sidebar-panel').forEach(p => {
    p.classList.toggle('active', p.id === `panel-${panel}`);
  });

  // Ensure sidebar is visible
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.remove('collapsed');

  // Trigger data loading
  if (panel === 'explorer') {
    requestFileTree();
  } else if (panel === 'source-control') {
    requestGitStatus();
  }
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.toggle('collapsed');
}

export function getActivePanel() {
  return activePanel;
}
