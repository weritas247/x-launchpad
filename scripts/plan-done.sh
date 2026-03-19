#!/bin/bash
# Manually trigger AI completion summary for the current DOING plan
SUMMARY="$*"
[ -z "$SUMMARY" ] && echo "Usage: plan-done <summary text>" && exit 1

TOKEN="${SUPER_TERMINAL_TOKEN}"
[ -z "$TOKEN" ] && echo "Error: SUPER_TERMINAL_TOKEN not set" && exit 1

SUMMARY_ESCAPED=$(printf '%s' "$SUMMARY" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')

curl -s -X POST "${SUPER_TERMINAL_URL:-http://localhost:3000}/api/plans/log" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"summary\",\"content\":$SUMMARY_ESCAPED}"

echo "✅ Plan summary logged"
