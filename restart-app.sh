#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

TMUX_SESSION="${SCIFORGE_APP_TMUX_SESSION:-sciforge-app}"
LOG_DIR="$ROOT_DIR/.sciforge/logs"
LOG_FILE="$LOG_DIR/app-service.log"
PID_FILE="$LOG_DIR/app-service.pid"
STARTUP_TIMEOUT_SECONDS="${SCIFORGE_APP_STARTUP_TIMEOUT_SECONDS:-90}"
SCIFORGE_CONFIG_PATH="${SCIFORGE_CONFIG_PATH:-$ROOT_DIR/config.local.json}"
SCIFORGE_MODEL_ROUTER_PORT="${SCIFORGE_MODEL_ROUTER_PORT:-5175}"

APP_PORTS=(
  3891 # retired legacy proxy residue cleanup only
  3892 # Model Router used by Runtime Codex
  "$SCIFORGE_MODEL_ROUTER_PORT" # active Model Router selected for this restart
  5173 # Vite renderer
  5174 # workspace writer
  5175 # desktop Model Router sidecar
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
  "dist-desktop/src/desktop/main.js"
  "dist-desktop/src/runtime/workspace-server.js"
  "dist-desktop/packages/workers/model-router/src/cli.js"
  "packages/workers/model-router/src/cli.ts"
  "dist-desktop/src/runtime/codex/codex-runtime-standalone-server.js"
  "node_modules/.bin/vite"
)
HEALTH_PORTS=(
  5173 # Vite renderer
  5174 # workspace writer
  "$SCIFORGE_MODEL_ROUTER_PORT" # desktop Model Router sidecar
)

normalize_openai_base_url() {
  local value="${1%/}"
  if [[ "$value" == */v1 ]]; then
    printf '%s\n' "$value"
  else
    printf '%s/v1\n' "$value"
  fi
}

shell_quote() {
  local value="$1"
  printf "'"
  printf '%s' "$value" | sed "s/'/'\\\\''/g"
  printf "'"
}

SCIFORGE_MODEL_ROUTER_BASE_URL="$(normalize_openai_base_url "${SCIFORGE_MODEL_ROUTER_BASE_URL:-${SCIFORGE_MODEL_ROUTER_URL:-http://127.0.0.1:${SCIFORGE_MODEL_ROUTER_PORT}}}")"
SCIFORGE_MODEL_ROUTER_API_KEY="${SCIFORGE_MODEL_ROUTER_API_KEY:-sciforge-local-model-router}"
SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS="${SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS:-sciforge-router}"
SCIFORGE_MODEL_ROUTER_DEFAULT_PROFILE="${SCIFORGE_MODEL_ROUTER_DEFAULT_PROFILE:-sciforge-runtime-default}"

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
  echo "[restart-app] config: $SCIFORGE_CONFIG_PATH"
  if [[ ! -f "$SCIFORGE_CONFIG_PATH" ]]; then
    echo "[restart-app] warning: config.local.json not found at $SCIFORGE_CONFIG_PATH; Model Router member LLM env may be incomplete" >&2
  fi
  echo "[restart-app] model router: $SCIFORGE_MODEL_ROUTER_BASE_URL"
  tmux new-session -d -s "$TMUX_SESSION" \
    "cd $(shell_quote "$ROOT_DIR") && env \
SCIFORGE_CONFIG_PATH=$(shell_quote "$SCIFORGE_CONFIG_PATH") \
SCIFORGE_MODEL_ROUTER_API_KEY=$(shell_quote "$SCIFORGE_MODEL_ROUTER_API_KEY") \
SCIFORGE_MODEL_ROUTER_BASE_URL=$(shell_quote "$SCIFORGE_MODEL_ROUTER_BASE_URL") \
SCIFORGE_MODEL_ROUTER_PORT=$(shell_quote "$SCIFORGE_MODEL_ROUTER_PORT") \
SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS=$(shell_quote "$SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS") \
SCIFORGE_MODEL_ROUTER_DEFAULT_PROFILE=$(shell_quote "$SCIFORGE_MODEL_ROUTER_DEFAULT_PROFILE") \
npm run desktop:dev 2>&1 | tee $(shell_quote "$LOG_FILE")"
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
