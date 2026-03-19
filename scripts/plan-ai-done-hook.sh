#!/bin/bash
# Claude Code Stop hook: notify kanban board that AI work is complete
# Only fires for sessions assigned from the kanban board (X_LAUNCHPAD_PLAN_ID set)

TOKEN="${X_LAUNCHPAD_TOKEN}"
PLAN_ID="${X_LAUNCHPAD_PLAN_ID}"

# Skip if not a kanban-assigned AI session
[ -z "$TOKEN" ] && exit 0
[ -z "$PLAN_ID" ] && exit 0

# Build a short summary from the last few commits (if any were made during this session)
SUMMARY=$(git log --oneline -3 --no-merges 2>/dev/null | head -3 | tr '\n' '; ')
[ -z "$SUMMARY" ] && SUMMARY="AI 작업 완료"

# Escape JSON special chars
SUMMARY_ESCAPED=$(printf '%s' "$SUMMARY" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')

curl -s -X POST "${X_LAUNCHPAD_URL:-http://localhost:3000}/api/plans/log" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"summary\",\"plan_id\":\"$PLAN_ID\",\"content\":$SUMMARY_ESCAPED}" \
  >/dev/null 2>&1 &
