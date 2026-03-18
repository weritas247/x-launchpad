# Git Worktree Source Control Integration

## Summary

소스컨트롤 사이드패널에 git worktree 기능을 추가하여 워크트리 목록 표시, 전환, 생성, 삭제를 지원한다.

## Architecture

### Data Flow

```
Browser (source-control.js)
  ↕ WebSocket messages (git_worktree_*)
Server (index.ts → git-service.ts)
  ↕ execFileSync('git', ['worktree', ...])
Git CLI
```

### Components

#### 1. Server: `git-service.ts` - Worktree Functions

**Interface:**
```ts
interface WorktreeEntry {
  path: string;       // 워크트리 절대 경로
  branch: string;     // 체크아웃된 브랜치 (또는 detached HEAD hash)
  head: string;       // HEAD commit hash (short)
  isBare: boolean;    // bare repo 여부
  isMain: boolean;    // 메인 워크트리 여부
}
```

**Functions:**
- `getWorktreeList(cwd: string): WorktreeEntry[]` - `git worktree list --porcelain` 파싱
- `addWorktree(cwd: string, path: string, branch?: string, createBranch?: boolean): { ok: boolean; error?: string }` - 워크트리 생성
- `removeWorktree(cwd: string, path: string, force?: boolean): { ok: boolean; error?: string }` - 워크트리 삭제

#### 2. Server: `index.ts` - WebSocket Handlers

| Client Message | Server Response | Description |
|---|---|---|
| `git_worktree_list` | `git_worktree_list_data` | 워크트리 목록 반환 |
| `git_worktree_add` | `git_worktree_add_ack` + auto `git_worktree_list_data` | 워크트리 생성 |
| `git_worktree_remove` | `git_worktree_remove_ack` + auto `git_worktree_list_data` | 워크트리 삭제 |
| `git_worktree_switch` | `git_worktree_switch_ack` + auto `git_status_data` | 세션 cwd를 워크트리 경로로 변경 |

#### 3. Client: `source-control.js` - UI

브랜치 바 아래에 접을 수 있는 워크트리 섹션:

```
┌─ SOURCE CONTROL ─────────────────────────┐
│ ⎇ main ↑2                                │
│ ▾ WORKTREES (3)                      [+] │
│   ● /project (main) ← current            │
│     /project/.claude/worktrees/feat-a     │
│     /project/.claude/worktrees/fix-b      │
│ ┌─ commit input ─────────────────────────┐│
│ │ Message (Enter to commit on "main")    ││
│ └────────────────────────────────────────┘│
│ [✓ Commit] [▾]                            │
│ STAGED CHANGES (2)                        │
│ CHANGES (3)                               │
└───────────────────────────────────────────┘
```

- 현재 워크트리: `●` 마커 + 하이라이트
- 다른 워크트리 클릭: `git_worktree_switch` → 세션 cwd 변경 → git status 자동 갱신
- `[+]` 버튼: 인라인 폼으로 새 워크트리 생성 (경로 + 브랜치)
- 우클릭/호버 삭제 버튼: 워크트리 삭제

#### 4. HTML: `index.html`

브랜치 바(`sc-branch-bar`) 아래에 워크트리 섹션 추가:

```html
<div class="sc-worktree-section" id="sc-worktree-section">
  <div class="sc-worktree-header" id="sc-worktree-header">
    <span class="sc-worktree-toggle">▾</span>
    <span class="sc-worktree-title">WORKTREES</span>
    <span class="sc-worktree-count" id="sc-worktree-count"></span>
    <button class="btn-icon-sm" id="sc-worktree-add-btn" title="Add worktree">+</button>
  </div>
  <div class="sc-worktree-list" id="sc-worktree-list"></div>
  <div class="sc-worktree-add-form" id="sc-worktree-add-form" style="display:none">
    <input type="text" id="sc-worktree-path" placeholder="Path or branch name"/>
    <div class="sc-worktree-form-actions">
      <label><input type="checkbox" id="sc-worktree-new-branch"/> New branch</label>
      <button id="sc-worktree-create">Create</button>
      <button id="sc-worktree-cancel">Cancel</button>
    </div>
  </div>
</div>
```

#### 5. CSS: Styling

기존 `sc-*` 패턴을 따르는 스타일:
- `.sc-worktree-section` - 접을 수 있는 섹션
- `.sc-worktree-item` - 각 워크트리 아이템
- `.sc-worktree-item.active` - 현재 워크트리 하이라이트
- `.sc-worktree-item:hover` - 호버 시 삭제 버튼 표시

## Files to Modify

1. `server/git-service.ts` - 워크트리 함수 3개 추가
2. `server/index.ts` - WebSocket 핸들러 4개 추가
3. `client/js/source-control.js` - 워크트리 UI 로직 추가
4. `client/index.html` - 워크트리 섹션 마크업 추가
5. `client/styles.css` - 워크트리 스타일 추가
6. `client/js/main.js` - 새 메시지 타입 라우팅 추가

## Error Handling

- 워크트리 추가 실패 시 toast 메시지 표시
- 워크트리 삭제 시 dirty 상태면 확인 다이얼로그
- git repo가 아닌 경우 워크트리 섹션 숨김

## Testing

- 수동 테스트: 워크트리 추가/삭제/전환 시나리오
- 에러 케이스: 잘못된 경로, 이미 존재하는 브랜치, dirty 워크트리 삭제
