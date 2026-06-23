#!/bin/bash
# ============================================================================
# One-click START for the scientific-modality plug-in on a GPU server.
# Brings up (idempotently; skips anything already healthy):
#   expert-translator (6 text-output experts) :8001   (lazy-loaded generative models)
#   sci-modality-router (this TS module)       :3898   -> ServiceResult API
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
MODULE_DIR="$(cd "$HERE/.." && pwd)"        # the TS module (plugins/sci-modality-router-service)
PROVIDER_DIR="$MODULE_DIR/provider"
RUN="$HERE/run"; mkdir -p "$RUN"
PYTHON="${PYTHON:-/root/miniconda3/envs/serve/bin/python}"
export HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"

log() { printf '[scimodality-start] %s\n' "$*"; }
wait_for() { local n=$1 u=$2; for i in $(seq 1 45); do curl -sf --max-time 2 "$u" >/dev/null 2>&1 && { log "$n READY ($u)"; return 0; }; sleep 4; done; log "$n FAILED to become ready at $u"; return 1; }
ensure() { # name healthurl cmd logfile pidkey
  local name=$1 url=$2 cmd=$3 logf=$4 key=$5
  if curl -sf --max-time 3 "$url" >/dev/null 2>&1; then log "$name already UP - skip"; return 0; fi
  nohup bash -c "$cmd" >"$logf" 2>&1 </dev/null & echo $! >"$RUN/$key.pid"; disown
  log "$name starting (pid $(cat "$RUN/$key.pid")) log=$logf"
  wait_for "$name" "$url"
}

ensure experts "http://127.0.0.1:${EXPERT_TRANSLATOR_PORT:-8001}/health" \
  "cd '$PROVIDER_DIR' && EXPERT_DEVICE='${EXPERT_DEVICE:-cuda:0}' exec bash start.sh" \
  "$RUN/experts.log" experts

ensure scimodality "http://127.0.0.1:${SCIMODALITY_ROUTER_PORT:-3898}/health" \
  "cd '$MODULE_DIR' && exec node --env-file-if-exists=.env --import tsx src/index.ts" \
  "$RUN/scimodality.log" scimodality

log "================ scientific-modality plug-in UP ================"
log "Module: http://127.0.0.1:${SCIMODALITY_ROUTER_PORT:-3898}  (GET /experts/status to check experts)"
log "Model Router host: ssh -p <port> -N -L 3898:127.0.0.1:3898 <server>  then SCIFORGE_SCIMODALITY_SERVICE_URL=http://127.0.0.1:3898"
