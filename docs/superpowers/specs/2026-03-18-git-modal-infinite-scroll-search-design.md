# Git Modal: Infinite Scroll + Search Bar

## Overview
Git 모달에 무한 스크롤과 토글 검색바를 추가하여 전체 커밋 히스토리를 탐색할 수 있게 한다.

## 1. Infinite Scroll

### Client
- `#gg-scroll` 컨테이너에 scroll 이벤트 리스너 추가 (requestAnimationFrame 쓰로틀)
- 하단 200px 이내 도달 시 다음 페이지 요청
- 상태 관리: `isLoadingMore`, `hasMore`, `currentSkip` 변수 추가
- 중복 요청 방지: `isLoadingMore` 플래그로 가드
- 로딩 중: 커밋 행 영역 하단에 스피너 표시 (`#gg-load-more-spinner`)
- 새 커밋 수신 시 `cachedCommits`에 append → 전체 `renderGraph()` 재실행 (스크롤 위치 보존)
  - computeLayout은 전체 커밋에 대해 레인을 재계산해야 하므로 incremental append 불가
  - 100~200개 수준에서는 성능 문제 없음
- 최대 로드 한도: 500개 커밋 (이후 "더 이상 로드하지 않음" 표시)

### Server
- `git_graph` 메시지에 `skip` (number, default 0) 파라미터 수신
- `getGitLog(cwd, maxCount, skip)` — `git log --topo-order --skip=N --max-count=M`
  - 메인 log 명령과 stats 명령 모두 동일한 skip/maxCount 적용
- `hasMore` 판단: maxCount + 1개를 요청하고 maxCount개만 반환. 초과분이 있으면 hasMore = true

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
- 결과 없음 시: "No commits matching '<query>'" 메시지 표시

### Keyboard Behavior
- Esc (검색 열림): 검색만 닫기 (모달은 유지), 전체 목록 복원
- Esc (검색 닫힘): 모달 닫기 (기존 동작)
- ArrowDown (검색 입력 포커스): 결과 목록으로 포커스 이동
- 결과 목록에서 타이핑: 검색 입력으로 포커스 복귀

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
  - 해시 프리픽스 매칭: query가 `/^[0-9a-f]{4,40}$/`이면 `git log <query> --max-count=1`도 시도
  - 두 결과 병합, 해시 중복 제거, 날짜순 정렬
- 보안: query를 `--` 뒤에 배치하여 flag injection 방지, 빈 쿼리 거부, 길이 200자 제한

### Wire Format
```
Client → Server: { type: 'git_graph_search', sessionId, query: string }
Server → Client: { type: 'git_graph_search_data', sessionId, commits: [], query: string }
```

### Search State Management
- `searchActive` 플래그와 `searchQuery` 상태 추적
- 서버 응답의 `query`가 현재 `searchQuery`와 불일치 시 응답 무시 (stale 결과 방지)
- 검색 해제 후 도착한 `git_graph_search_data` 응답도 무시
- 검색 활성화 중 무한 스크롤 비활성화
- 검색어 하이라이트: 매칭 텍스트에 `.gg-highlight` 클래스 적용
- 검색 해제 시 원래 커밋 목록 + 무한 스크롤 복원
- 브랜치 전환 시: 검색 상태 초기화, 기본 페이지네이션 뷰로 복원

## 3. Files Changed

| File | Changes |
|---|---|
| `server/git-service.ts` | `getGitLog`에 `skip` 파라미터 추가, `--topo-order` 적용, `searchGitLog` 함수 신규 |
| `server/index.ts` | `git_graph` skip 처리, `git_graph_search` 핸들러 신규 |
| `client/js/git-graph.js` | 무한 스크롤 로직, 검색 UI/토글/하이브리드 검색, 스크롤 위치 보존 재렌더링 |
| `client/index.html` | 검색 아이콘 버튼, 검색 행 HTML, 로드 스피너 |
| `client/styles.css` | `.gg-search-bar`, `.gg-search-toggle`, `.gg-highlight`, 로드 스피너 스타일 |
