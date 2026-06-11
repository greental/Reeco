#!/usr/bin/env bash
set -euo pipefail

SUITE="${1:-all}"
shift || true
EXTRA_ARGS=("$@")

if [ ! -d tests ]; then
  echo "Missing tests/ directory. Assignment tests must be present at repo root/tests." >&2
  exit 1
fi

if [ ! -f tests/package.json ]; then
  echo "Missing tests/package.json. Cannot run assignment tests." >&2
  exit 1
fi

run_suite() {
  local suite="$1"

  echo ""
  echo "Running ordered suite: $suite"

  if [ "${#EXTRA_ARGS[@]}" -gt 0 ]; then
    npm --prefix tests run "test:$suite" -- "${EXTRA_ARGS[@]}"
  else
    npm --prefix tests run "test:$suite"
  fi
}

case "$SUITE" in
  all)
    echo "Importing data once before ordered test suites..."
    npm run data:import

    for ordered_suite in basic filter agg anomaly bulk concurrent perf realtime security; do
      run_suite "$ordered_suite"
    done
    ;;

  basic|filter|agg|anomaly|bulk|concurrent|perf|realtime|security)
    run_suite "$SUITE"
    ;;

  grade)
    if [ "${#EXTRA_ARGS[@]}" -gt 0 ]; then
      npm --prefix tests run grade -- "${EXTRA_ARGS[@]}"
    else
      npm --prefix tests run grade
    fi
    ;;

  check)
    node -e "const p=require('./tests/package.json'); const required=['test','test:basic','test:filter','test:agg','test:anomaly','test:bulk','test:concurrent','test:perf','test:realtime','test:security','grade']; const missing=required.filter((s)=>!p.scripts?.[s]); if(missing.length){console.error('Missing test scripts:', missing.join(', ')); process.exit(1);} console.log('Assignment test scripts available:', required.join(', '));"
    ;;

  *)
    echo "Usage: $0 [all|basic|filter|agg|anomaly|bulk|concurrent|perf|realtime|security|grade|check]" >&2
    exit 1
    ;;
esac