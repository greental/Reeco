#!/usr/bin/env bash
set -euo pipefail

REQUIRED_IGNORES=(
  "node_modules/"
  ".env"
  ".env.local"
  "dist/"
  "build/"
  "coverage/"
  ".vite/"
  "*.log"
  ".DS_Store"
)

if [ ! -d .git ]; then
  echo "Initializing Git repository on branch main..."
  git init -b main
else
  echo "Git repository already initialized."
fi

touch .gitignore
for pattern in "${REQUIRED_IGNORES[@]}"; do
  if ! grep -qxF "$pattern" .gitignore; then
    printf '%s\n' "$pattern" >> .gitignore
  fi
done

if [ ! -f docs/SLICE_LOG.md ]; then
  cat > docs/SLICE_LOG.md <<'LOG'
# Slice Log

Records completed implementation slices committed with the repo-local Git workflow.

LOG
fi

git add .gitignore docs/SLICE_LOG.md tools/agent/git-init.sh tools/agent/git-slice.sh tools/agent/git-status.sh package.json .cline/rules/git-workflow.md 2>/dev/null || true

if git diff --cached --quiet; then
  echo "No changes to commit."
else
  git commit -m "chore: initialize git workflow"
fi

if git remote get-url origin >/dev/null 2>&1; then
  echo "Pushing current HEAD to origin..."
  git push origin HEAD
else
  echo "No origin remote configured; skipping push."
fi
