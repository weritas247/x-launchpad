#!/bin/bash
# Claude Code PostToolUse hook: detect git commit and log to plan
# $TOOL_INPUT contains the executed command
echo "$TOOL_INPUT" | grep -q 'git commit' || exit 0

COMMIT_INFO=$(git log -1 --format='%H|||%s' 2>/dev/null) || exit 0
HASH=$(echo "$COMMIT_INFO" | cut -d'|' -f1)
MSG=$(echo "$COMMIT_INFO" | sed 's/^[^|]*|||//')

TOKEN="${X_LAUNCHPAD_TOKEN}"
[ -z "$TOKEN" ] && exit 0

# Escape JSON special chars in commit message
MSG_ESCAPED=$(printf '%s' "$MSG" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')

curl -s -X POST "${X_LAUNCHPAD_URL:-http://localhost:3000}/api/plans/log" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"commit\",\"content\":$MSG_ESCAPED,\"commit_hash\":\"$HASH\"}" \
  >/dev/null 2>&1 &
