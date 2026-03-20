// ─── FILE EDITOR: CodeMirror 6 wrapper ───
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, openSearchPanel, search, highlightSelectionMatches } from '@codemirror/search';
import { syntaxHighlighting, HighlightStyle, indentOnInput, bracketMatching, foldGutter, foldKeymap } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { rust } from '@codemirror/lang-rust';
import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { tags } from '@lezer/highlight';

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

// ─── GitHub Dark syntax highlighting ───
const githubDarkHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#ff7b72' },
  { tag: [tags.name, tags.deleted, tags.character, tags.macroName], color: '#c9d1d9' },
  { tag: [tags.function(tags.variableName), tags.labelName], color: '#d2a8ff' },
  { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: '#79c0ff' },
  { tag: [tags.definition(tags.name), tags.separator], color: '#c9d1d9' },
  { tag: [tags.typeName, tags.className, tags.number, tags.changed, tags.annotation, tags.modifier, tags.self, tags.namespace], color: '#ffa657' },
  { tag: [tags.operator, tags.operatorKeyword, tags.url, tags.escape, tags.regexp, tags.link, tags.special(tags.string)], color: '#79c0ff' },
  { tag: [tags.meta, tags.comment], color: '#8b949e' },
  { tag: tags.strong, fontWeight: 'bold', color: '#c9d1d9' },
  { tag: tags.emphasis, fontStyle: 'italic', color: '#c9d1d9' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: '#58a6ff', textDecoration: 'underline' },
  { tag: tags.heading, fontWeight: 'bold', color: '#d2a8ff' },
  { tag: [tags.atom, tags.bool, tags.special(tags.variableName)], color: '#79c0ff' },
  { tag: [tags.processingInstruction, tags.string, tags.inserted], color: '#a5d6ff' },
  { tag: tags.invalid, color: '#f85149' },
]);

// ─── Dark theme matching X-Launchpad ───
const superTerminalTheme = EditorView.theme({
  '&': {
    backgroundColor: '#0d1117',
    color: '#c9d1d9',
    fontSize: 'var(--font-size, 13px)',
    fontFamily: 'var(--font-mono)',
  },
  '.cm-content': {
    caretColor: '#58a6ff',
    padding: '4px 0',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: '#58a6ff',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'rgba(56, 139, 253, 0.25)',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(110, 118, 129, 0.1)',
  },
  '.cm-gutters': {
    backgroundColor: '#0d1117',
    color: '#484f58',
    border: 'none',
    minWidth: '3ch',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'rgba(110, 118, 129, 0.1)',
    color: '#c9d1d9',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: '#161b22',
    color: '#8b949e',
    border: 'none',
  },
  '.cm-searchMatch': {
    backgroundColor: 'rgba(210, 153, 34, 0.3)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'rgba(210, 153, 34, 0.5)',
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
    syntaxHighlighting(githubDarkHighlight),
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

export { createEditor, setReadOnly, getContent, destroyEditor };
