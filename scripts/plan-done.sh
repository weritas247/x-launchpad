#!/bin/bash
# Manually trigger AI completion summary for the current DOING plan
SUMMARY="$*"
[ -z "$SUMMARY" ] && echo "Usage: plan-done <summary text>" && exit 1

TOKEN="${X_LAUNCHPAD_TOKEN}"
[ -z "$TOKEN" ] && echo "Error: X_LAUNCHPAD_TOKEN not set" && exit 1

SUMMARY_ESCAPED=$(printf '%s' "$SUMMARY" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')

curl -s -X POST "${X_LAUNCHPAD_URL:-http://localhost:3000}/api/plans/log" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"summary\",\"content\":$SUMMARY_ESCAPED}"

echo "✅ Plan summary logged"
