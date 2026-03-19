# Markdown Preview Design Spec

> md 파일을 열면 렌더링된 마크다운 프리뷰를 기본으로 표시

## 목표

File Viewer에서 `.md`/`.markdown` 파일을 열면 렌더링된 HTML 프리뷰를 기본으로 표시한다. Source/Preview 토글로 CodeMirror 소스 보기와 전환할 수 있다.

## 핵심 결정사항

| 항목 | 결정 |
|------|------|
| 렌더링 라이브러리 | marked (GFM 지원) |
| XSS 방지 | DOMPurify |
| 기본 모드 | md 파일 → 프리뷰, 그 외 → CodeMirror |
| 토글 방식 | Source/Preview 버튼 토글 |
| 편집 진입 | Edit 클릭 → 프리뷰 해제 + 소스 편집 모드 |
| 번들 방식 | esbuild 별도 번들 (`marked-bundle.js`) |

## 아키텍처

```
┌─ file-viewer.js ──────────────────────────┐
│  openFileTab() / updateFileContent()      │
│    → md 파일 판별 (.md, .markdown)         │
│    → md이면 프리뷰 기본 렌더링              │
│    → Source/Preview 토글 버튼 관리          │
│    → Edit 클릭 시 프리뷰 해제 + 편집 모드   │
└───────────────────────────────────────────┘
           │
           ▼
┌─ markdown-preview.js (신규) ──────────────┐
│  renderPreview(container, markdownText)    │
│    → marked로 HTML 생성                    │
│    → DOMPurify로 sanitize                  │
│    → container에 삽입                      │
│  destroyPreview(container)                │
│    → 프리뷰 DOM 정리                       │
│  window.MarkdownPreview로 노출             │
└───────────────────────────────────────────┘
           │
           ▼
┌─ marked-bundle.js (esbuild 생성) ─────────┐
│  marked + DOMPurify 번들                   │
└───────────────────────────────────────────┘
```

## npm 패키지

```
# 런타임
marked
dompurify
```

## 번들 빌드

`marked-entry.js` (esbuild 엔트리):
```js
export { marked } from 'marked';
export { default as DOMPurify } from 'dompurify';
```

`package.json` 스크립트:
```json
"build:md": "esbuild client/js/marked-entry.js --bundle --format=esm --outfile=client/js/marked-bundle.js --minify"
```

`postinstall`에도 `&& npm run build:md` 추가.

`markdown-preview.js`는 `<script type="module">`로 로드되며, `window.MarkdownPreview`로 file-viewer.js에서 호출.

## UI 디자인

### md 파일 기본 상태 (프리뷰)

```
[…/docs/README.md]     [READ ONLY] [Source] [Edit]
┌──────────────────────────────────────────┐
│  # 제목                                  │
│                                          │
│  본문 텍스트가 렌더링되어 표시됩니다.      │
│  - 리스트 항목                            │
│  - **볼드**, *이탈릭*                     │
│                                          │
│  ```js                                   │
│  const x = 1;  // 코드 블록               │
│  ```                                     │
└──────────────────────────────────────────┘
```

### Source 클릭 후

```
[…/docs/README.md]     [READ ONLY] [Preview] [Edit]
┌──────────────────────────────────────────┐
│ 1 │ # 제목                               │
│ 2 │                                      │
│ 3 │ 본문 텍스트...                        │
│ 4 │ - 리스트 항목                         │
│   │ (CodeMirror 소스 뷰)                  │
└──────────────────────────────────────────┘
```

### Edit 클릭 (프리뷰/소스 어디서든)

```
[…/docs/README.md]     [EDITING] [Ctrl+S to save] [Save] [Cancel]
┌──────────────────────────────────────────┐
│ 1 │ # 제목                               │
│ 2 │ (편집 가능한 CodeMirror)               │
└──────────────────────────────────────────┘
```

- 프리뷰 상태에서 Edit → 프리뷰 해제 + CodeMirror 편집 모드 진입
- 편집 중에는 Source/Preview 토글 숨김
- Save/Cancel 후 → Source(읽기전용) + Source/Preview 토글 복귀

## 상태 전이

```
md 파일 열기 → Preview(읽기전용)
                     │
              ┌──────┼──────┐
              │      │      │
           Source    Edit    │
              │      │      │
              ▼      │      │
    Source(읽기전용)  │      │
              │      │      │
        ┌─────┼──────┘      │
        │     │             │
     Preview Edit           │
        │     │             │
        │     ▼             │
        │  Source(편집중)     │
        │     │             │
        │  Save/Cancel      │
        │     │             │
        └─────┴─────────────┘
              → Source(읽기전용)로 복귀
```

## md 파일 판별

파일 확장자로 판별:
```js
function isMarkdownFile(filePath) {
  return /\.(md|markdown)$/i.test(filePath);
}
```

## file-viewer.js 변경사항

### updateFileContent 수정

텍스트 파일 렌더링 분기에서:
1. md 파일인 경우 → CodeMirror 생성 후 숨기고, `window.MarkdownPreview.renderPreview()`로 프리뷰 표시
2. 프리뷰와 CodeMirror 컨테이너를 별도로 관리

### fileTabs entry 확장

기존 entry에 추가:
- `isPreview` — boolean, 프리뷰 모드 여부
- `previewEl` — 프리뷰 컨테이너 DOM 요소

### 헤더 버튼 관리

- `renderReadonlyHeader` 수정: md 파일이면 Source/Preview 토글 버튼 추가
- `renderEditingHeader`는 변경 없음 (편집 중에는 토글 숨김)

## 프리뷰 스타일

`.md-preview` 클래스로 마크다운 렌더링 스타일 적용:
- heading (h1~h6): 크기, 간격, border-bottom
- code block: 배경색, 패딩, 폰트
- inline code: 배경색, 패딩
- table: 테두리, 패딩
- blockquote: 왼쪽 보더, 배경
- list: 들여쓰기, 간격
- link: 색상 (accent color)
- image: max-width 100%
- hr: 구분선

기존 Super Terminal 테마 변수(--bg-void, --text-main, --accent 등)를 사용하여 일관된 디자인.

## 파일 변경 목록

| 파일 | 변경 내용 |
|------|----------|
| `package.json` | marked, dompurify 추가, `build:md` 스크립트, postinstall 업데이트 |
| `client/js/marked-entry.js` | **신규** — esbuild 엔트리 |
| `client/js/marked-bundle.js` | **생성됨** — gitignore |
| `client/js/markdown-preview.js` | **신규** — renderPreview, destroyPreview, window.MarkdownPreview |
| `client/js/file-viewer.js` | md 판별, 기본 프리뷰, Source/Preview 토글, Edit 시 프리뷰 해제 |
| `client/styles.css` | `.md-preview` 마크다운 렌더링 스타일 |
| `client/index.html` | markdown-preview.js script 태그 |
| `.gitignore` | `client/js/marked-bundle.js` 추가 |

## 범위 밖 (YAGNI)

- 분할 뷰 (소스 + 프리뷰 동시)
- 편집 중 실시간 프리뷰
- mermaid/다이어그램 렌더링
- 수식(LaTeX) 렌더링
- 커스텀 마크다운 확장
- 프리뷰에서 직접 편집 (WYSIWYG)
