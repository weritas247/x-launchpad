# File Editor Design Spec

> File Viewer를 CodeMirror 6 기반 경량 코드 에디터로 업그레이드

## 목표

현재 읽기 전용 File Viewer(highlight.js 기반)를 CodeMirror 6로 교체하여 파일 편집 기능을 제공한다. 모든 텍스트 파일은 CodeMirror로 렌더링하되, 기본은 읽기 전용이고 명시적으로 편집 모드에 진입한다.

## 핵심 결정사항

| 항목 | 결정 |
|------|------|
| 에디터 엔진 | CodeMirror 6 |
| 로딩 방식 | npm install → esbuild로 단일 번들 생성 (`client/js/codemirror-bundle.js`) |
| 기본 모드 | 읽기 전용 (CodeMirror `EditorState.readOnly`) |
| 편집 진입 | Edit 버튼 또는 Ctrl+E |
| 저장 방식 | Ctrl+S → WebSocket `file_save` → 서버 파일시스템 직접 저장 |
| 미저장 표시 | 탭에 빨간 ● 인디케이터 |

## 아키텍처

```
┌─ Browser ──────────────────────────────────────┐
│                                                │
│  file-viewer.js (기존, 수정)                    │
│    ├── openFileTab() — 탭 생성/관리 (유지)       │
│    ├── activateFileTab() — 탭 전환 (유지)        │
│    └── updateFileContent() — CodeMirror로 교체  │
│                                                │
│  file-editor.js (신규)                          │
│    ├── createEditor(container, content, lang)   │
│    │     → CodeMirror EditorView 생성           │
│    ├── toggleReadOnly(editor)                   │
│    │     → readOnly extension 토글              │
│    ├── getContent(editor) → string              │
│    └── destroyEditor(editor)                    │
│                                                │
│  WebSocket ──── file:save {path, content} ──►  │
│                                                │
└────────────────────────────────────────────────┘
                      │
                      ▼
┌─ Server (ws-handlers.ts) ──────────────────────┐
│  file_save(ctx, parsed)                        │
│    → 경로 검증 (session.cwd 내부인지)            │
│    → fs.writeFile(resolvedPath, content)        │
│    → wsSend({ type: 'file_save_result' })      │
└────────────────────────────────────────────────┘
```

## npm 패키지

```
# 런타임
@codemirror/state
@codemirror/view
@codemirror/language
@codemirror/commands
@codemirror/search
@codemirror/lang-javascript    (JS/TS/JSX/TSX)
@codemirror/lang-python
@codemirror/lang-html
@codemirror/lang-css
@codemirror/lang-json
@codemirror/lang-markdown
@codemirror/lang-rust
@codemirror/lang-cpp
@codemirror/lang-java
@codemirror/lang-sql
@codemirror/lang-xml

# 빌드
esbuild (devDependency)
```

@lezer/* 패키지들은 @codemirror의 transitive dependency로 자동 설치된다.
@codemirror/lang-yaml (공식 패키지 존재)

## CodeMirror 로딩

esbuild로 단일 번들을 생성하여 브라우저에서 로드한다.

**엔트리 파일** (`client/js/codemirror-entry.js`):
```js
// CodeMirror core + extensions + languages를 하나의 번들로 export
export { EditorState } from '@codemirror/state';
export { EditorView, keymap, lineNumbers } from '@codemirror/view';
export { defaultKeymap, history, historyKeymap, undo, redo } from '@codemirror/commands';
export { searchKeymap, openSearchPanel } from '@codemirror/search';
export { javascript } from '@codemirror/lang-javascript';
// ... 기타 언어
```

**빌드 스크립트** (`package.json`):
```json
"scripts": {
  "build:editor": "esbuild client/js/codemirror-entry.js --bundle --format=esm --outfile=client/js/codemirror-bundle.js"
}
```

**index.html**:
```html
<script type="module">
  // file-editor.js에서 codemirror-bundle.js를 import
</script>
```

`npm run build:editor`는 npm install 후 한 번만 실행하면 된다. postinstall 스크립트에 추가하여 자동화할 수 있다.

`file-editor.js`는 `<script type="module">`로 로드되며, 기존 non-module 스크립트인 `file-viewer.js`에서는 전역 함수(`window.FileEditor.*`)를 통해 호출한다.

## UI 디자인

### 읽기 전용 모드 (기본)

- 파일 헤더바: 파일 경로 + "READ ONLY" 뱃지 + ✏️ Edit 버튼
- CodeMirror `readOnly: true` — 커서 이동, 선택은 가능하나 편집 불가
- 줄번호, syntax highlighting 표시

### 편집 모드

- Edit 버튼 클릭 또는 Ctrl+E로 진입
- 헤더바 변경: "EDITING" 표시 + 💾 Save 버튼 + Cancel 버튼 + "Ctrl+S 저장" 힌트
- CodeMirror `readOnly: false` — 편집 가능
- 변경사항 발생 시 탭에 빨간 ● 표시 (unsaved indicator)

### 단축키

| 단축키 | 동작 |
|--------|------|
| Ctrl+E | 편집 모드 진입/종료 토글 |
| Ctrl+S | 파일 저장 |
| Ctrl+Z | Undo |
| Ctrl+Shift+Z | Redo |
| Ctrl+F | 찾기 |
| Ctrl+H | 찾기/바꾸기 (커스텀 keybinding 필요 — `@codemirror/search`는 기본 바인딩 없음) |
| Escape | 편집 모드 종료 (읽기 전용으로) |

## 서버: file_save 핸들러

```
클라이언트 → WebSocket → file_save { sessionId, filePath, content }
                              │
                              ▼
                    경로 검증 (session.cwd 내부인지 path.resolve로 확인)
                              │
                    ├── 실패 → file_save_result { success: false, error }
                    └── 성공 → fs.writeFile → file_save_result { success: true, filePath }
```

보안: `path.resolve(session.cwd, filePath)` 결과가 `session.cwd`로 시작하는지 검증하여 path traversal 방지.

## 에러 처리 & 엣지 케이스

| 상황 | 처리 |
|------|------|
| 저장 실패 | 헤더바에 빨간색 에러 메시지 3초 표시, ● 유지, 내용 보존 |
| 미저장 상태에서 탭 닫기 | "Unsaved changes. Close anyway?" confirm |
| 미저장 상태에서 탭 전환 | 차단 안 함. CodeMirror state에 내용 보존 |
| 이미지/바이너리 파일 | 기존 방식 유지 (CodeMirror 사용 안 함) |
| 탭 닫기 | `editor.destroy()` 호출하여 메모리 해제 |

## 파일 변경 목록

| 파일 | 변경 내용 |
|------|----------|
| `package.json` | @codemirror/* 패키지 추가, esbuild devDep, `build:editor` 스크립트 |
| `server/ws-handlers.ts` | `file_save` 핸들러 추가 (~20줄) |
| `client/js/codemirror-entry.js` | **신규** — esbuild 엔트리, CodeMirror re-export |
| `client/js/codemirror-bundle.js` | **생성됨** — esbuild 번들 출력 |
| `.gitignore` | `client/js/codemirror-bundle.js` 추가 |
| `client/js/file-editor.js` | **신규** — CodeMirror 초기화, readOnly 토글, 언어 매핑, `window.FileEditor`로 export |
| `client/js/file-viewer.js` | highlight.js 렌더링 → CodeMirror 교체, 편집 UI, 미저장 confirm |
| `client/styles.css` | CodeMirror 테마 커스터마이징, 편집 모드 헤더 스타일 |

## 범위 밖 (YAGNI)

- 외부 파일 변경 감지 (file watcher)
- LSP / 자동완성
- 멀티 커서, 미니맵
- Claude 연동 저장
- diff 뷰어
