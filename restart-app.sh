#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

APP_PORTS=(5173 5174 5175 5176)
APP_PATTERNS=(
  "tools/desktop-dev-shell"
  "dist-desktop/src/desktop/main.js"
  "dist-desktop/src/runtime/workspace-server.js"
  "dist-desktop/packages/backend/src/cli.js"
  "dist-desktop/src/runtime/codex/codex-runtime-standalone-server.js"
  "node_modules/.bin/vite"
)

collect_app_pids() {
  local pids=()
  local port
  for port in "${APP_PORTS[@]}"; do
    while IFS= read -r pid; do
      [[ -n "$pid" ]] && pids+=("$pid")
    done < <(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
  done

  local pattern
  for pattern in "${APP_PATTERNS[@]}"; do
    while IFS= read -r pid; do
      [[ -n "$pid" ]] && pids+=("$pid")
    done < <(ps -axo pid=,command= | awk -v root="$ROOT_DIR" -v pattern="$pattern" '$0 ~ root && $0 ~ pattern {print $1}')
  done

  if ((${#pids[@]} > 0)); then
    printf '%s\n' "${pids[@]}" | sort -u
  fi
}

stop_existing_app() {
  mapfile -t pids < <(collect_app_pids)
  if ((${#pids[@]} == 0)); then
    echo "[restart-app] no existing SciForge app processes found"
    return
  fi

  echo "[restart-app] stopping existing SciForge app processes: ${pids[*]}"
  kill "${pids[@]}" 2>/dev/null || true

  local deadline=$((SECONDS + 10))
  while ((SECONDS < deadline)); do
    local alive=()
    local pid
    for pid in "${pids[@]}"; do
      if kill -0 "$pid" 2>/dev/null; then
        alive+=("$pid")
      fi
    done
    if ((${#alive[@]} == 0)); then
      echo "[restart-app] stopped existing processes"
      return
    fi
    sleep 0.5
  done

  echo "[restart-app] force stopping lingering processes"
  kill -9 "${pids[@]}" 2>/dev/null || true
}

stop_existing_app

echo "[restart-app] rebuilding artifacts and starting desktop app"
exec npm run desktop:dev
