#!/usr/bin/env bash
set -euo pipefail

SLICE_NAME="${1:-}"
TEST_COMMAND="${2:-}"
TEST_RESULT="not run"

if [ -z "$SLICE_NAME" ]; then
  echo "Usage: ./scripts/git-slice.sh \"slice name\" \"optional test command\"" >&2
  exit 1
fi

if [ ! -d .git ]; then
  echo "Git repository is not initialized. Run npm run git:init first." >&2
  exit 1
fi

echo "Current git status:"
git status --short --branch

if [ -n "$TEST_COMMAND" ]; then
  echo "Running test command: $TEST_COMMAND"
  if bash -lc "$TEST_COMMAND"; then
    TEST_RESULT="passed"
  else
    TEST_RESULT="failed"
    echo "Test command failed; not committing."
    exit 1
  fi
fi

# Stage all project changes while respecting .gitignore.
git add -A

if git diff --cached --quiet; then
  echo "No changes to commit."
  exit 0
fi

git commit -m "slice: $SLICE_NAME"
COMMIT_HASH="$(git rev-parse --short HEAD)"

mkdir -p docs
if [ ! -f docs/SLICE_LOG.md ]; then
  cat > docs/SLICE_LOG.md <<'LOG'
# Slice Log

Records completed implementation slices committed with the repo-local Git workflow.

LOG
fi

TIMESTAMP="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
{
  printf '## %s - %s\n\n' "$TIMESTAMP" "$SLICE_NAME"
  printf -- '- Test command: `%s`\n' "${TEST_COMMAND:-none}"
  printf -- '- Test result: %s\n' "$TEST_RESULT"
  printf -- '- Commit hash: %s\n\n' "$COMMIT_HASH"
} >> docs/SLICE_LOG.md

git add docs/SLICE_LOG.md
if ! git diff --cached --quiet; then
  git commit -m "docs: log slice $SLICE_NAME"
fi

echo "Committed slice '$SLICE_NAME' as $COMMIT_HASH."

if git remote get-url origin >/dev/null 2>&1; then
  echo "Pushing current HEAD to origin..."
  git push origin HEAD
else
  echo "No origin remote configured; skipping push. Local commit kept: $COMMIT_HASH."
fi
