#!/bin/bash
# ============================================================================
# One-click START for the sci-modality-router worker's GPU services.
# Brings up (idempotently; skips anything already healthy):
#   expert-translator (4 native-to-text experts) :8001   (lazy-loaded generative models)
#   sci-modality-router (this TS worker)          :3898   -> ServiceResult API
#
# Experts load lazily on first request (no eager startup load), so this is light
# and only used modalities consume VRAM. Behind the GFW, models download via
# HF_ENDPOINT=https://hf-mirror.com (exported below).
#
# The local SciForge app reaches :3898 over an SSH port-forward and sets
# SCIFORGE_SCIMODALITY_SERVICE_URL=http://127.0.0.1:3898 (see DEPLOYMENT.md).
#
# Env overrides: PYTHON, EXPERT_MODEL_DIR, EXPERT_DEVICE
# Pidfiles in ./run; tear down with stop.sh; acceptance with verify.sh.
# ============================================================================
set -u
HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
MODULE_DIR="$(cd "$HERE/.." && pwd)"        # the worker root (packages/workers/sci-modality-router)
PROVIDER_DIR="$MODULE_DIR/provider"
RUN="$HERE/run"; mkdir -p "$RUN"
PYTHON="${PYTHON:-/root/miniconda3/envs/serve/bin/python}"
if [ -f "$MODULE_DIR/.env" ]; then
  set -a
  . "$MODULE_DIR/.env"
  set +a
fi
export HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"

log() { printf '[scimodality-start] %s\n' "$*"; }
if [ "${SCIFORGE_ENABLE_LOCAL_EXPERT_PROVIDER:-}" != "1" ]; then
  log "local expert provider startup is disabled by default"
  log "set SCIFORGE_ENABLE_LOCAL_EXPERT_PROVIDER=1 only after verifying all model licenses"
  exit 2
fi
: "${EXPERT_MODEL_DIR:?EXPERT_MODEL_DIR is required and must point to licensed external weights}"
EXPERT_PROVIDER_API_KEY="${EXPERT_PROVIDER_API_KEY:?EXPERT_PROVIDER_API_KEY is required for provider health checks}"
SCIMODALITY_ROUTER_RUNTIME_TOKEN="${SCIMODALITY_ROUTER_RUNTIME_TOKEN:?SCIMODALITY_ROUTER_RUNTIME_TOKEN is required for router health checks}"
wait_for() {
  local n=$1 u=$2 h=${3:-}
  for i in $(seq 1 45); do
    if [ -n "$h" ]; then
      curl -sf --max-time 2 -H "$h" "$u" >/dev/null 2>&1 && { log "$n READY ($u)"; return 0; }
    else
      curl -sf --max-time 2 "$u" >/dev/null 2>&1 && { log "$n READY ($u)"; return 0; }
    fi
    sleep 4
  done
  log "$n FAILED to become ready at $u"
  return 1
}
ensure() { # name healthurl cmd logfile pidkey
  local name=$1 url=$2 cmd=$3 logf=$4 key=$5 header=${6:-}
  if [ -n "$header" ]; then
    curl -sf --max-time 3 -H "$header" "$url" >/dev/null 2>&1 && { log "$name already UP - skip"; return 0; }
  else
    curl -sf --max-time 3 "$url" >/dev/null 2>&1 && { log "$name already UP - skip"; return 0; }
  fi
  nohup bash -c "$cmd" >"$logf" 2>&1 </dev/null & echo $! >"$RUN/$key.pid"; disown
  log "$name starting (pid $(cat "$RUN/$key.pid")) log=$logf"
  wait_for "$name" "$url" "$header"
}

ensure experts "http://127.0.0.1:${EXPERT_TRANSLATOR_PORT:-8001}/health" \
  "cd '$PROVIDER_DIR' && EXPERT_DEVICE='${EXPERT_DEVICE:-cuda:0}' exec bash start.sh" \
  "$RUN/experts.log" experts "Authorization: Bearer ${EXPERT_PROVIDER_API_KEY}"

ensure scimodality "http://127.0.0.1:${SCIMODALITY_ROUTER_PORT:-3898}/health" \
  "cd '$MODULE_DIR' && exec node --env-file-if-exists=.env --import tsx src/cli.ts" \
  "$RUN/scimodality.log" scimodality "Authorization: Bearer ${SCIMODALITY_ROUTER_RUNTIME_TOKEN}"

log "================ scientific-modality worker UP ================"
log "Module: http://127.0.0.1:${SCIMODALITY_ROUTER_PORT:-3898}  (GET /experts/status with Bearer token to check experts)"
log "Model Router host: ssh -p <port> -N -L 3898:127.0.0.1:3898 <server>  then set SCIFORGE_SCIMODALITY_SERVICE_URL=http://127.0.0.1:3898 and SCIFORGE_SCIMODALITY_SERVICE_TOKEN=<runtime-token> so the sidecar/CLI writes translators.scientific"
