#!/usr/bin/env bash
set -euo pipefail

# Stop Reeco API server processes started by `npm start`, `npm run dev`, or
# ad-hoc PORT=... node dist/backend/server.js smoke/manual runs.
#
# This script intentionally targets only this repository's backend server:
# - processes listening on common Reeco API ports, and
# - node/tsx command lines containing src/backend/server.ts or dist/backend/server.js.

PORTS=("${PORT:-3000}" 3000 3001)
PIDS=()

add_pid() {
  local pid="$1"
  if [[ -n "$pid" && "$pid" =~ ^[0-9]+$ ]]; then
    PIDS+=("$pid")
  fi
}

collect_port_pids() {
  local port="$1"
  if command -v netstat >/dev/null 2>&1; then
    while IFS= read -r pid; do
      if is_node_process "$pid"; then
        add_pid "$pid"
      fi
    done < <(netstat -ano 2>/dev/null | awk -v port=":$port" '$2 ~ port && $4 == "LISTENING" { print $5 }')
  fi
}

is_node_process() {
  local pid="$1"
  if command -v powershell.exe >/dev/null 2>&1; then
    local name
    name="$(powershell.exe -NoProfile -Command "(Get-Process -Id $pid -ErrorAction SilentlyContinue).ProcessName" 2>/dev/null | tr -d '\r' || true)"
    [[ "$name" =~ ^(node|tsx)$ ]]
  else
    ps -p "$pid" -o comm= 2>/dev/null | grep -Eq '^(node|tsx)$'
  fi
}

collect_command_pids() {
  if command -v powershell.exe >/dev/null 2>&1; then
    local query="Get-CimInstance Win32_Process | Where-Object { \$_.CommandLine -match 'node|tsx' -and (\$_.CommandLine -match 'dist/backend/server.js' -or \$_.CommandLine -match 'src/backend/server.ts') } | ForEach-Object { \$_.ProcessId }"
    while IFS= read -r pid; do
      add_pid "$pid"
    done < <(powershell.exe -NoProfile -Command "$query" 2>/dev/null | tr -d '\r')
  else
    while IFS= read -r pid; do
      add_pid "$pid"
    done < <(ps -ef 2>/dev/null | awk '/[n]ode|[t]sx/ && (/dist\/backend\/server\.js/ || /src\/backend\/server\.ts/) { print $2 }')
  fi
}

for port in "${PORTS[@]}"; do
  collect_port_pids "$port"
done
collect_command_pids

if [[ ${#PIDS[@]} -eq 0 ]]; then
  echo "No Reeco server processes found."
  exit 0
fi

mapfile -t UNIQUE_PIDS < <(printf '%s\n' "${PIDS[@]}" | sort -n | uniq)

for pid in "${UNIQUE_PIDS[@]}"; do
  echo "Stopping Reeco server process PID $pid"
  if command -v taskkill >/dev/null 2>&1; then
    taskkill //PID "$pid" //F >/dev/null 2>&1 || true
  else
    kill "$pid" 2>/dev/null || true
  fi
done

echo "Stopped ${#UNIQUE_PIDS[@]} Reeco server process(es)."