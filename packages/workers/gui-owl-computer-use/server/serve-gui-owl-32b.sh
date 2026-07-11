#!/usr/bin/env bash
# Development-only helper for serving a user-supplied GUI agent checkpoint on vLLM.
#
# Commercial builds must not rely on this script or ship model weights. Runtime
# traffic still crosses SciForge Model Router; this helper is only for
# operators who have independently verified their checkpoint license and
# explicitly opt in.
#
set -euo pipefail

if [ "${SCIFORGE_ENABLE_LOCAL_MODEL_SERVE:-}" != "1" ]; then
  echo "Local model serving is disabled by default. Set SCIFORGE_ENABLE_LOCAL_MODEL_SERVE=1 after verifying the checkpoint license." >&2
  exit 2
fi

: "${CKPT:?Set CKPT to a licensed local checkpoint path.}"
SERVED_MODEL_NAME="${SERVED_MODEL_NAME:-sciforge-computer-use}"
export CUDA_VISIBLE_DEVICES=${CUDA_VISIBLE_DEVICES:-0,1}
export VLLM_ATTENTION_BACKEND=TORCH_SDPA
export VLLM_USE_FLASHINFER_SAMPLER=0
# CUDA graphs are ON by default — without nvcc/flash-attn this is the main decode
# speedup (~2x vs eager). Set ENFORCE_EAGER=1 to fall back to eager mode if you
# hit graph-capture errors or OOM.
EAGER=""
[ -n "${ENFORCE_EAGER:-}" ] && EAGER="--enforce-eager"
exec /root/miniconda3/envs/cua/bin/python -m vllm.entrypoints.openai.api_server \
  --model "$CKPT" --served-model-name "$SERVED_MODEL_NAME" \
  --max-model-len 32768 $EAGER \
  --mm-processor-kwargs '{"min_pixels":3136,"max_pixels":10035200}' \
  --limit-mm-per-prompt '{"image":2}' \
  --tensor-parallel-size 2 --gpu-memory-utilization 0.90 \
  --allowed-local-media-path "/" --host 0.0.0.0 --port 4243
