# Git Graph 기능 설계

## 개요

브라우저 웹 터미널(X-Launchpad)에 Git 커밋 그래프 시각화 기능을 추가한다. 모달 오버레이 형태로, 현재 활성 세션의 CWD에 있는 git repository의 브랜치/머지 그래프와 커밋 상세 정보를 함께 표시한다.

## 요구사항

- **표시 형태:** 전체 화면 모달 오버레이 (단축키/상태바 클릭으로 열고 닫음)
- **정보 범위:** 브랜치/머지 그래프 + 커밋 상세 정보 (해시, 메시지, 작성자, 날짜)
- **커밋 클릭 시:** 변경된 파일 목록 표시 (상세 diff는 미포함)
- **데이터 소스:** 현재 활성 세션의 CWD 기준 자동 감지
- **열기 방법:** 상태바 브랜치명 클릭 + `Ctrl+G` 단축키
- **커밋 개수:** 최근 50개
- **렌더링:** SVG 기반 (CSS 테마 연동, DOM 이벤트 활용)

## 아키텍처

### 데이터 흐름

```
Client                          Server
  |                               |
  |-- git_graph { sessionId } --> |
  |                               |-- git log 실행 (CWD에서)
  |                               |-- 파싱: hash, parents, refs, author, date, message
  | <-- git_graph_data { ... } -- |
  |                               |
  |-- git_file_list { hash } ---> |
  |                               |-- git diff-tree 실행
  | <-- git_file_list_data {...} -|
  |                               |
  |-- git_branch { sessionId } -> |
  |                               |-- git branch --show-current
  | <-- git_branch_data { ... } --|
```

### 보안

- **커밋 해시 검증:** `git_file_list` 요청의 `hash` 파라미터는 서버에서 `/^[0-9a-f]{4,40}$/i` 정규식으로 검증 후 사용. 미통과 시 에러 응답.
- **명령어 실행:** 모든 git 명령어는 `execFileSync` (또는 `spawn`)를 사용하여 인자 배열로 전달. 문자열 보간으로 셸에 전달하지 않음.

### 서버 측 (server/index.ts)

#### 새 WebSocket 메시지 핸들러 3개:

**`git_graph`** — 커밋 그래프 데이터 요청
- 세션의 CWD에서 `git log` 실행
- 명령어: `git log --format="%H|%P|%D|%an|%aI|%s" --max-count=50 --all`
- 파싱하여 구조화된 JSON으로 응답

응답 형식:
```json
{
  "type": "git_graph_data",
  "commits": [
    {
      "hash": "abc1234...",
      "parents": ["def5678..."],
      "refs": ["HEAD -> main", "origin/main"],
      "author": "name",
      "date": "2026-03-17T10:00:00+09:00",
      "message": "커밋 메시지"
    }
  ]
}
```

**`git_file_list`** — 특정 커밋의 변경 파일 목록 요청
- 명령어: `git diff-tree --no-commit-id --name-status -r <hash>`
- 응답: `{ type: "git_file_list_data", hash, files: [{ status: "M", path: "src/foo.js" }] }`

**`git_branch`** — 현재 브랜치명 요청 (상태바용)
- 명령어: `git branch --show-current` (또는 detached HEAD 시 `git rev-parse --short HEAD`)
- 응답: `{ type: "git_branch_data", branch: "main" }`

### 클라이언트 측

#### 새 파일: `client/js/git-graph.js`

그래프 로직, SVG 렌더링, 오버레이 UI 전체를 담당하는 단일 모듈.

**주요 함수:**
- `openGitGraph()` — 오버레이 열기 + `git_graph` 요청
- `closeGitGraph()` — 오버레이 닫기
- `renderGraph(commits)` — 레이아웃 계산 + SVG/HTML 렌더링
- `onCommitClick(hash)` — `git_file_list` 요청 + 파일 목록 패널 표시
- `requestBranch(sessionId)` — 상태바용 브랜치명 요청
- `handleGitGraphData(msg)` — WebSocket 응답 핸들러 (main.js에서 호출)
- `handleGitFileListData(msg)` — WebSocket 응답 핸들러 (main.js에서 호출)
- `handleGitBranchData(msg)` — WebSocket 응답 핸들러 (main.js에서 호출)
- `updateStatusBarBranch(branch)` — 상태바 브랜치명 UI 업데이트

상태(오버레이 열림/닫힘, 선택 커밋, 캐시 등)는 모듈 내부에서 관리.

#### 기존 파일 변경:

**`main.js`**
- `git-graph.js` import
- WebSocket 메시지 라우팅에 `git_graph_data`, `git_file_list_data`, `git_branch_data` 추가

**`index.html`**
- git graph 오버레이 컨테이너 DOM 추가

**`styles.css`**
- 오버레이, 그래프, 커밋 리스트 스타일 추가 (기존 CSS 변수 활용)

**`session.js`**
- 상태바에 브랜치 아이콘 + 브랜치명 표시
- 브랜치명 클릭 시 `openGitGraph()` 호출
- git repo가 아닌 CWD에서는 미표시

## UI 레이아웃

### 오버레이 구조

```
┌──────────────────────────────────────────────────┐
│  📁 repo-name    🔀 main                    [X]  │  ← 헤더
├──────────────────┬───────────────────────────────┤
│                  │ abc1234 커밋 메시지  작성자 2h │  ← 커밋 행 (그래프와 수평 정렬)
│   SVG 그래프     │ def5678 다른 커밋    작성자 3h │
│   (브랜치 라인   │ ghi9012 또 다른 것   작성자 1d │
│    + 커밋 노드)  │ ...                           │
│                  ├───────────────────────────────┤
│                  │ 변경 파일:                     │  ← 파일 목록 패널
│                  │  M src/foo.js                  │     (커밋 클릭 시 표시)
│                  │  A src/bar.js                  │
│                  │  D old/baz.js                  │
└──────────────────┴───────────────────────────────┘
```

- 좌측 (40%): SVG 그래프 영역
- 우측 (60%): 커밋 리스트 + 하단 파일 목록 패널
- 행 높이 40px 고정, 그래프 노드와 커밋 행 수평 정렬
- **스크롤:** 좌측 SVG 그래프와 우측 커밋 리스트는 동기화 스크롤 (하나의 스크롤 컨테이너에 좌우 영역을 배치)
- **로딩 상태:** 오버레이 열림 후 데이터 수신 전까지 중앙에 로딩 스피너 표시

### 커밋 행 구성

```
[해시 7자리]  [HEAD] [main]  커밋 메시지       작성자    2h ago
```

- 브랜치/태그 ref는 컬러 뱃지로 표시
- HEAD 뱃지는 별도 강조 색상

### 상태바 연동

기존 상태바에 추가:
```
... | 🔀 main | ...
```
- git repo가 아니면 미표시
- 클릭 시 git graph 오버레이 열림
- 세션 전환 시 브랜치명 업데이트 (`git_branch` 요청)

## 그래프 렌더링

### 레이아웃 알고리즘

`git log --graph`와 유사한 레인 기반 접근법을 사용한다. 2-pass 알고리즘:

**Pass 1 — 활성 레인 추적:**
1. 활성 레인 배열을 유지 (각 슬롯에 예상되는 커밋 해시를 저장)
2. 각 커밋 순회 시, 해당 커밋의 해시가 있는 레인 위치를 찾아 x좌표로 사용 (없으면 새 레인 추가)
3. 해당 레인에서 현재 커밋을 제거하고, 부모 커밋들을 레인에 삽입
   - 첫 번째 부모: 같은 레인 위치에 삽입 (직선 연결)
   - 추가 부모: 비어있는 레인 또는 새 레인에 삽입 (분기/병합 곡선)
4. 비어있는 레인은 축소하여 불필요한 빈 공간 방지

**Pass 2 — 연결선 생성:**
- 같은 레인의 부모-자식: 직선 `<line>`
- 다른 레인의 부모-자식: cubic bezier `<path>`로 곡선 연결

### SVG 요소

- **커밋 노드:** `<circle>` r=4, 브랜치별 색상
- **직선 연결:** `<line>` 같은 컬럼 부모-자식
- **분기/병합 곡선:** `<path>` cubic bezier, 다른 컬럼 간 연결
- **색상:** 브랜치별 고유 색상 (미리 정의된 팔레트에서 순환 할당)

### 브랜치 색상 팔레트

```javascript
const BRANCH_COLORS = [
  'var(--accent)',      // 첫 번째 브랜치 (보통 main)
  '#e06c75',            // red
  '#98c379',            // green
  '#e5c07b',            // yellow
  '#61afef',            // blue
  '#c678dd',            // purple
  '#56b6c2',            // cyan
];
```

테마 변경 시 `var(--accent)`는 자동 반영, 나머지는 고정 팔레트.

## 테마 연동

- 오버레이 배경: `var(--bg)` + 반투명
- 텍스트: `var(--text)`
- 보더: `var(--border)` 또는 `var(--dim)`
- 선택된 커밋 행: `var(--accent)` 배경 하이라이트
- SVG 라인: 브랜치별 팔레트 색상
- CRT 효과(scanline, glow)가 오버레이 위에도 적용됨

## 단축키

- `Ctrl+G` — git graph 토글 (열기/닫기)
- `Escape` — git graph 닫기
- 등록 위치:
  1. `server/index.ts` — `DEFAULT_SETTINGS.keybindings`에 기본값 추가
  2. `client/js/constants.js` — `KB_DEFS` 배열에 표시 라벨 추가
  3. `client/js/main.js` — `keydown` 핸들러에 `Ctrl+G` 분기 추가
- 참고: `Ctrl+G`는 ASCII BEL(0x07) 문자이나, keydown 핸들러에서 `preventDefault()`로 터미널 전달을 차단함

## 에러 처리

- git repo가 아닌 CWD: 상태바에 브랜치명 미표시, `Ctrl+G` 시 오버레이 내 에러 메시지 표시 "Not a git repository"
- git 명령어 실행 실패: 오버레이에 에러 메시지 표시
- 세션 연결 끊김: 오버레이 자동 닫기

## 범위 외 (향후 고려)

- 상세 diff 보기
- 커밋 간 비교
- 브랜치 생성/삭제/체크아웃 등 git 조작
- 무한 스크롤 / 추가 로딩
- 경로 수동 지정
