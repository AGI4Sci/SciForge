#!/bin/bash
# Tear down the scientific-modality plug-in (frees the GPUs). Kills by pidfile,
# with port-based backups. Safe: the kill tokens do not appear in this script's argv.
set -u
HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
RUN="$HERE/run"
log() { printf '[scimodality-stop] %s\n' "$*"; }

for key in scimodality experts; do
  pidf="$RUN/$key.pid"
  if [ -f "$pidf" ]; then
    pid=$(cat "$pidf")
    if kill "$pid" 2>/dev/null; then log "$key killed (pid $pid)"; else log "$key pid $pid not alive"; fi
    rm -f "$pidf"
  fi
done

# Port-based backups (no pattern self-match risk).
for port in "${SCIMODALITY_ROUTER_PORT:-3898}" "${EXPERT_TRANSLATOR_PORT:-8001}"; do
  fuser -k "${port}/tcp" 2>/dev/null && log "freed port $port"
done

sleep 1
log "done. GPU now:"
nvidia-smi --query-gpu=index,memory.used,memory.total --format=csv,noheader 2>/dev/null || true
