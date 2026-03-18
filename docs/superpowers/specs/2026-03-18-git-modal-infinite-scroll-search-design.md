# Git Modal: Infinite Scroll + Search Bar

## Overview
Git 모달에 무한 스크롤과 토글 검색바를 추가하여 전체 커밋 히스토리를 탐색할 수 있게 한다.

## 1. Infinite Scroll

### Client
- `#gg-scroll` 컨테이너에 scroll 이벤트 리스너 추가
- 하단 200px 이내 도달 시 다음 페이지 요청
- 상태 관리: `isLoadingMore`, `hasMore`, `currentSkip` 변수 추가
- 중복 요청 방지: `isLoadingMore` 플래그로 가드
- 로딩 중: 커밋 목록 하단에 스피너 표시 (`#gg-load-more-spinner`)
- 새 커밋 수신 시 `cachedCommits`에 append, `renderGraph()` 대신 incremental append 렌더링
- SVG 그래프: 높이 확장, 새 커밋의 레인/엣지 추가

### Server
- `git_graph` 메시지에 `skip` (number, default 0) 파라미터 수신
- `getGitLog(cwd, maxCount, skip)` — `git log --skip=N --max-count=M`
- 응답에 `hasMore: boolean` 추가 — `commits.length === maxCount`이면 true

### Wire Format
```
Client → Server: { type: 'git_graph', sessionId, skip?: number }
Server → Client: { type: 'git_graph_data', sessionId, commits: [], hasMore: boolean }
```

## 2. Toggle Search Bar

### UI
- 타이틀바에 검색 아이콘 버튼 추가 (`.gg-search-toggle`)
- 클릭 또는 Cmd+F / Ctrl+F로 토글
- 타이틀바 아래에 검색 행 (`.gg-search-bar`) 슬라이드 표시
- 검색 입력 필드 + Esc 닫기 힌트 배지
- Esc 키로 검색 닫기 및 전체 목록 복원

### Hybrid Search Logic
1. 사용자 입력 → 300ms 디바운스
2. 클라이언트 필터링: `cachedCommits`에서 message, author, hash 매칭
3. 클라이언트 결과 < 10개 → 서버 검색 요청
4. 서버 결과 수신 → 클라이언트 결과와 병합 (해시 기준 중복 제거)
5. 병합된 결과로 그래프 렌더링

### Server Search
- 새 메시지 타입: `git_graph_search`
- `searchGitLog(cwd, query, maxCount=50)` 함수 추가
  - `git log --all --grep=<query> --format=...` (메시지 검색)
  - `git log --all --author=<query> --format=...` (작성자 검색)
  - 두 결과 병합, 해시 중복 제거, 날짜순 정렬

### Wire Format
```
Client → Server: { type: 'git_graph_search', sessionId, query: string }
Server → Client: { type: 'git_graph_search_data', sessionId, commits: [], query: string }
```

### Search Mode Behavior
- 검색 활성화 중 무한 스크롤 비활성화
- 검색어 하이라이트: 매칭 텍스트에 `.gg-highlight` 클래스 적용
- 검색 해제 시 원래 커밋 목록 + 무한 스크롤 복원

## 3. Files Changed

| File | Changes |
|---|---|
| `server/git-service.ts` | `getGitLog`에 `skip` 파라미터 추가, `searchGitLog` 함수 신규 |
| `server/index.ts` | `git_graph` skip 처리, `git_graph_search` 핸들러 신규 |
| `client/js/git-graph.js` | 무한 스크롤 로직, 검색 UI/토글/하이브리드 검색, incremental 렌더링 |
| `client/index.html` | 검색 아이콘 버튼, 검색 행 HTML |
| `client/styles.css` | `.gg-search-bar`, `.gg-search-toggle`, `.gg-highlight` 스타일 |
