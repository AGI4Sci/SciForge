#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

TMUX_SESSION="${SCIFORGE_APP_TMUX_SESSION:-sciforge-app}"
LOG_DIR="$ROOT_DIR/.sciforge/logs"
LOG_FILE="$LOG_DIR/app-service.log"
PID_FILE="$LOG_DIR/app-service.pid"
STARTUP_TIMEOUT_SECONDS="${SCIFORGE_APP_STARTUP_TIMEOUT_SECONDS:-90}"

APP_PORTS=(
  3891 # managed Codex Responses proxy from npm run dev
  3892 # model-router / goose proxy residue used by chat runtime
  5173 # Vite renderer
  5174 # workspace writer
  5175 # desktop provider proxy
  5176 # desktop Runtime Codex
  6173 # alternate workspace writer from tools/dev.ts
  18080 # legacy AgentServer / OpenTeam Studio
)
APP_PATTERNS=(
  "tools/dev.ts"
  "tools/dev-dual.ts"
  "tools/desktop-dev-shell"
  "tools/desktop-dev-shell.ts"
  "server/index.ts"
  "sciforge-goose-proxy.mjs"
  "dist-desktop/src/desktop/main.js"
  "dist-desktop/src/runtime/workspace-server.js"
  "dist-desktop/packages/backend/src/cli.js"
  "dist-desktop/packages/workers/model-router/src/cli.js"
  "packages/workers/model-router/src/cli.ts"
  "dist-desktop/src/runtime/codex/codex-runtime-standalone-server.js"
  "node_modules/.bin/vite"
)
HEALTH_PORTS=(
  5173 # Vite renderer
  5174 # workspace writer
  5175 # model-router / desktop provider proxy
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
  if command -v tmux >/dev/null 2>&1 && tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
    echo "[restart-app] stopping existing tmux session: $TMUX_SESSION"
    tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true
  fi

  local pids=()
  local pid
  while IFS= read -r pid; do
    [[ -n "$pid" ]] && pids+=("$pid")
  done < <(collect_app_pids)
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

wait_for_ports() {
  local deadline=$((SECONDS + STARTUP_TIMEOUT_SECONDS))
  local missing=()

  while ((SECONDS < deadline)); do
    missing=()
    local port
    for port in "${HEALTH_PORTS[@]}"; do
      if ! lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
        missing+=("$port")
      fi
    done

    if ((${#missing[@]} == 0)); then
      return 0
    fi

    if ! tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
      echo "[restart-app] tmux session exited before app became healthy"
      return 1
    fi

    sleep 1
  done

  echo "[restart-app] timed out waiting for ports: ${missing[*]}"
  return 1
}

start_app() {
  if ! command -v tmux >/dev/null 2>&1; then
    echo "[restart-app] tmux is required for background app restart but was not found" >&2
    exit 1
  fi

  mkdir -p "$LOG_DIR"
  : > "$LOG_FILE"

  echo "[restart-app] rebuilding artifacts and starting desktop app in tmux session: $TMUX_SESSION"
  tmux new-session -d -s "$TMUX_SESSION" \
    "cd '$ROOT_DIR' && npm run desktop:dev 2>&1 | tee '$LOG_FILE'"
  tmux display-message -p -t "$TMUX_SESSION" '#{pane_pid}' > "$PID_FILE"

  if wait_for_ports; then
    echo "[restart-app] app service is listening on ports: ${HEALTH_PORTS[*]}"
    echo "[restart-app] log: $LOG_FILE"
    echo "[restart-app] tmux attach: tmux attach -t $TMUX_SESSION"
    return 0
  fi

  echo "[restart-app] startup failed; recent log output:"
  tail -80 "$LOG_FILE" 2>/dev/null || true
  return 1
}

stop_existing_app
start_app
