// ─── CodeMirror 6 bundle entry ───
// Core
export { EditorState, Compartment } from '@codemirror/state';
export {
  EditorView, keymap, lineNumbers, highlightActiveLine,
  highlightActiveLineGutter, drawSelection, dropCursor,
  rectangularSelection, crosshairCursor,
} from '@codemirror/view';

// Commands
export {
  defaultKeymap, history, historyKeymap,
  indentWithTab, undo, redo,
} from '@codemirror/commands';

// Search
export {
  searchKeymap, openSearchPanel, search,
  highlightSelectionMatches,
} from '@codemirror/search';

// Language infrastructure
export {
  defaultHighlightStyle, syntaxHighlighting,
  indentOnInput, bracketMatching, foldGutter, foldKeymap,
  LanguageSupport,
} from '@codemirror/language';

// Languages
export { javascript } from '@codemirror/lang-javascript';
export { python } from '@codemirror/lang-python';
export { html } from '@codemirror/lang-html';
export { css } from '@codemirror/lang-css';
export { json } from '@codemirror/lang-json';
export { markdown } from '@codemirror/lang-markdown';
export { rust } from '@codemirror/lang-rust';
export { cpp } from '@codemirror/lang-cpp';
export { java } from '@codemirror/lang-java';
export { sql } from '@codemirror/lang-sql';
export { xml } from '@codemirror/lang-xml';
export { yaml } from '@codemirror/lang-yaml';
