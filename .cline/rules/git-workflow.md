# Git workflow rules

- The Git helpers live under `tools/agent/`.
- After every meaningful implementation slice, the agent must run the relevant tests.
- If tests pass, run:

  ```bash
  npm run git:slice -- "<slice name>" "<test command>"
  ```

- Do not make one giant final commit.
- Never commit secrets, `.env`, `node_modules`, build artifacts, or test result dumps unless explicitly requested.
- If a push fails because no remote/auth exists, keep the local commit and report it clearly.
