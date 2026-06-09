#!/usr/bin/env bash
set -euo pipefail

if [ ! -d .git ]; then
  echo "Git repository: not initialized"
  exit 0
fi

BRANCH="$(git branch --show-current 2>/dev/null || true)"
LATEST_COMMIT="$(git log -1 --pretty=format:'%h %s' 2>/dev/null || true)"

echo "Branch: ${BRANCH:-detached HEAD or unborn branch}"
echo "Latest commit: ${LATEST_COMMIT:-none}"

if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
  echo "Status: clean"
else
  echo "Status: dirty"
  git status --short
fi

echo "Remote info:"
if git remote -v | grep -q .; then
  git remote -v
else
  echo "No remotes configured."
fi
