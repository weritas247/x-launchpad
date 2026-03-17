import { S, terminalMap } from './state.js';
import { THEMES } from './constants.js';

export function updateSwatches() {
  document.querySelectorAll('.theme-swatch').forEach((el, i) => {
    el.classList.toggle('active', THEMES[i].id === S.currentTheme.id);
  });
}

export function applyTheme(t) {
  S.currentTheme = t;
  document.body.className = `theme-${t.id}`;
  terminalMap.forEach(({ term }) => { term.options.theme = t.term; });
  updateSwatches();
}

export function initThemeSwatches() {
  const swatchContainer = document.getElementById('theme-swatches');
  THEMES.forEach(t => {
    const sw = document.createElement('div');
    sw.className = 'theme-swatch' + (t.id === 'cyber' ? ' active' : '');
    sw.title = t.label;
    sw.style.background = `linear-gradient(135deg, ${t.colors[0]} 40%, ${t.colors[1]})`;
    sw.addEventListener('click', () => {
      if (S.pendingSettings) {
        S.pendingSettings.appearance.theme = t.id;
        document.querySelectorAll('.theme-grid .theme-card').forEach(el => {
          el.classList.toggle('active', el.dataset.themeId === t.id);
        });
      }
      applyTheme(t);
      updateSwatches();
    });
    swatchContainer.appendChild(sw);
  });
}
