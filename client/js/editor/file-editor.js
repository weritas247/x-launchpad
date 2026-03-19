// ─── FILE EDITOR: CodeMirror 6 wrapper ───
import {
  EditorState, Compartment, EditorView, keymap, lineNumbers,
  highlightActiveLine, highlightActiveLineGutter,
  drawSelection, dropCursor,
  defaultKeymap, history, historyKeymap, indentWithTab,
  searchKeymap, openSearchPanel, search, highlightSelectionMatches,
  defaultHighlightStyle, syntaxHighlighting,
  indentOnInput, bracketMatching, foldGutter, foldKeymap,
  javascript, python, html, css, json, markdown,
  rust, cpp, java, sql, xml, yaml,
} from '../codemirror-bundle.js';

// ─── Language map (file extension → CodeMirror language function) ───
const LANG_MAP = {
  js: javascript, mjs: javascript, cjs: javascript,
  jsx: () => javascript({ jsx: true }),
  ts: () => javascript({ typescript: true }),
  mts: () => javascript({ typescript: true }),
  cts: () => javascript({ typescript: true }),
  tsx: () => javascript({ typescript: true, jsx: true }),
  py: python, python: python,
  html: html, htm: html,
  css: css, scss: css, less: css, sass: css,
  json: json,
  md: markdown, markdown: markdown,
  rs: rust,
  c: cpp, h: cpp, cpp: cpp, cc: cpp, cxx: cpp, hpp: cpp,
  java: java, kt: java, scala: java,
  sql: sql,
  xml: xml, svg: xml, vue: xml, svelte: xml,
  yaml: yaml, yml: yaml,
};

function getLangExtension(filePath) {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const langFn = LANG_MAP[ext];
  if (!langFn) return [];
  const result = typeof langFn === 'function' ? langFn() : langFn();
  return [result];
}

// ─── Dark theme matching Super Terminal ───
const superTerminalTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--bg-void)',
    color: 'var(--text-main)',
    fontSize: 'var(--font-size, 13px)',
    fontFamily: 'var(--font-mono)',
  },
  '.cm-content': {
    caretColor: 'var(--accent, #c792ea)',
    padding: '4px 0',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--accent, #c792ea)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--bg-hover)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--bg-deep)',
    color: 'var(--text-ghost)',
    border: 'none',
    minWidth: '3ch',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--bg-hover)',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--bg-hover)',
    color: 'var(--text-dim)',
    border: 'none',
  },
  '.cm-searchMatch': {
    backgroundColor: 'rgba(255, 203, 107, 0.3)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'rgba(255, 203, 107, 0.5)',
  },
}, { dark: true });

// ─── Base extensions (always applied) ───
function baseExtensions(filePath) {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    drawSelection(),
    dropCursor(),
    indentOnInput(),
    bracketMatching(),
    highlightSelectionMatches(),
    foldGutter(),
    history(),
    search(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    superTerminalTheme,
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...searchKeymap,
      indentWithTab,
      // Ctrl+H → find/replace (custom binding)
      { key: 'Mod-h', run: openSearchPanel },
    ]),
    ...getLangExtension(filePath),
  ];
}

// ─── Compartments for dynamic readOnly toggle ───
const readOnlyComp = new WeakMap(); // view → Compartment
const editableComp = new WeakMap();

// ─── Public API ───

function createEditor(container, content, filePath, { readOnly = true, onSave, onChange } = {}) {
  const roComp = new Compartment();
  const edComp = new Compartment();

  const extensions = [
    ...baseExtensions(filePath),
    roComp.of(EditorState.readOnly.of(readOnly)),
    edComp.of(EditorView.editable.of(!readOnly)),
  ];

  if (onChange) {
    extensions.push(EditorView.updateListener.of((update) => {
      if (update.docChanged) onChange(update.state.doc.toString());
    }));
  }

  if (onSave) {
    extensions.push(keymap.of([{
      key: 'Mod-s',
      run: (view) => { onSave(view.state.doc.toString()); return true; },
      preventDefault: true,
    }]));
  }

  const state = EditorState.create({ doc: content || '', extensions });
  const view = new EditorView({ state, parent: container });

  readOnlyComp.set(view, roComp);
  editableComp.set(view, edComp);

  return view;
}

function setReadOnly(view, readOnly) {
  const roComp = readOnlyComp.get(view);
  const edComp = editableComp.get(view);
  if (!roComp || !edComp) return;
  view.dispatch({
    effects: [
      roComp.reconfigure(EditorState.readOnly.of(readOnly)),
      edComp.reconfigure(EditorView.editable.of(!readOnly)),
    ],
  });
}

function getContent(view) {
  return view.state.doc.toString();
}

function destroyEditor(view) {
  readOnlyComp.delete(view);
  editableComp.delete(view);
  view.destroy();
}

// Expose on window for non-module scripts
window.FileEditor = { createEditor, setReadOnly, getContent, destroyEditor };
