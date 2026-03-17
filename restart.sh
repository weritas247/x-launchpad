#!/bin/bash
lsof -ti:3000 2>/dev/null | xargs kill 2>/dev/null
sleep 1
npx tsc && node dist/server/index.js
