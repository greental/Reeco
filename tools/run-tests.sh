#!/usr/bin/env bash
set -euo pipefail

SUITE="${1:-all}"

if [ ! -d tests ]; then
  echo "Missing tests/ directory. Assignment tests must be present at repo root/tests." >&2
  exit 1
fi

if [ ! -f tests/package.json ]; then
  echo "Missing tests/package.json. Cannot run assignment tests." >&2
  exit 1
fi

case "$SUITE" in
  all)
    npm --prefix tests test
    ;;
  basic|filter|agg|anomaly|bulk|concurrent|perf|realtime|security)
    npm --prefix tests run "test:$SUITE"
    ;;
  grade)
    npm --prefix tests run grade
    ;;
  check)
    node -e "const fs=require('fs'); const p=require('./tests/package.json'); const required=['test','test:basic','test:filter','test:agg','test:anomaly','test:bulk','test:concurrent','test:perf','test:realtime','test:security','grade']; const missing=required.filter((s)=>!p.scripts?.[s]); if(missing.length){console.error('Missing test scripts:', missing.join(', ')); process.exit(1);} console.log('Assignment test scripts available:', required.join(', '));"
    ;;
  *)
    echo "Usage: $0 [all|basic|filter|agg|anomaly|bulk|concurrent|perf|realtime|security|grade|check]" >&2
    exit 1
    ;;
esac
