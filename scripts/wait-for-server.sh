#!/bin/sh
# Wait for backend server to be ready, then start vite
PORT=${1:-3000}
MAX_WAIT=30
WAITED=0

while [ $WAITED -lt $MAX_WAIT ]; do
  if curl -s "http://localhost:$PORT/api/health" > /dev/null 2>&1; then
    exec vite --config vite.config.ts
  fi
  sleep 0.5
  WAITED=$((WAITED + 1))
done

echo "[wait] Server did not start within ${MAX_WAIT}s, starting vite anyway"
exec vite --config vite.config.ts
