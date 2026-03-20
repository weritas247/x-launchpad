import { S, terminalMap } from '../core/state';
import { THEMES } from '../core/constants';

export function updateSwatches() {
  document.querySelectorAll('.theme-swatch').forEach((el, i) => {
    el.classList.toggle('active', THEMES[i].id === S.currentTheme.id);
  });
}

export function applyTheme(t, preview = false) {
  S.currentTheme = t;
  document.body.className = '';
  if (t.css) {
    const root = document.documentElement;
    for (const [prop, val] of Object.entries(t.css)) {
      root.style.setProperty(prop, val as string);
    }
  }
  terminalMap.forEach(({ term }) => {
    term.options.theme = t.term;
  });
  if (!preview) {
    updateSwatches();
  }
}

export function initThemeSwatches() {
  const swatchContainer = document.getElementById('theme-swatches');
  if (!swatchContainer) return;
  THEMES.forEach((t) => {
    const sw = document.createElement('div');
    sw.className = 'theme-swatch' + (t.id === 'cyber' ? ' active' : '');
    sw.title = t.label;
    sw.style.background = `linear-gradient(135deg, ${t.colors[0]} 40%, ${t.colors[1]})`;
    sw.addEventListener('click', () => {
      if (S.pendingSettings) {
        S.pendingSettings.appearance.theme = t.id;
        document.querySelectorAll('.theme-grid .theme-card').forEach((el) => {
          el.classList.toggle('active', (el as HTMLElement).dataset.themeId === t.id);
        });
      }
      applyTheme(t);
      updateSwatches();
    });
    swatchContainer.appendChild(sw);
  });
}
