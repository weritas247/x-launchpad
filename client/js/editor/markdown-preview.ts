// ─── MARKDOWN PREVIEW: renders md files as HTML ───
import { marked, DOMPurify } from '../marked-bundle';

// Configure marked for GFM
marked.setOptions({
  gfm: true,
  breaks: true,
});

/**
 * Render markdown text as sanitized HTML into a container.
 * @param {HTMLElement} container - The DOM element to render into
 * @param {string} markdownText - Raw markdown string
 */
export function renderPreview(container, markdownText) {
  const rawHtml = marked.parse(markdownText);
  const cleanHtml = DOMPurify.sanitize(rawHtml);
  container.innerHTML = `<div class="md-preview">${cleanHtml}</div>`;
}

/**
 * Remove preview DOM content from container.
 * @param {HTMLElement} container - The DOM element to clear
 */
export function destroyPreview(container) {
  const preview = container.querySelector('.md-preview');
  if (preview) preview.remove();
}

// Expose globally for file-viewer.js (non-module script access)
window.MarkdownPreview = { renderPreview, destroyPreview };
