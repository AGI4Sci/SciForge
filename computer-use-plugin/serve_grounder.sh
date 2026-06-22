#!/usr/bin/env bash
# Serve GUI-Owl-1.5-8B-Instruct as a grounding endpoint via vLLM on the A800 box.
# Run inside the isolated `cua` conda env (vLLM 0.23, Qwen3-VL support).
# Isolated from the `serve` env (sci-modality experts on vLLM 0.6.3) — do NOT mix.
set -euo pipefail

MODEL_DIR=${MODEL_DIR:-/fs-computility-new/upzd_share/shared/cua/models/GUI-Owl-1.5-8B-Instruct}
PORT=${PORT:-18901}
GPU=${GPU:-0}                  # A800 #0; sci-modality experts (if up) sit elsewhere
PY=${PY:-$HOME/miniconda3/envs/cua/bin}
LOG=${LOG:-/fs-computility-new/upzd_share/shared/cua/grounder-serve.log}

export CUDA_VISIBLE_DEVICES="$GPU"
export VLLM_USE_MODELSCOPE=false

nohup "$PY/vllm" serve "$MODEL_DIR" \
  --served-model-name gui-owl-1.5-8b \
  --tensor-parallel-size 1 \
  --trust-remote-code \
  --port "$PORT" \
  --max-model-len 16384 \
  --limit-mm-per-prompt '{"image":3}' \
  --gpu-memory-utilization 0.85 \
  > "$LOG" 2>&1 &
echo "vllm serving GUI-Owl-1.5-8b on :$PORT (gpu $GPU), pid $!"
echo "tail -f $LOG   # wait for 'Application startup complete'"
echo "health: curl -s http://127.0.0.1:$PORT/health"
