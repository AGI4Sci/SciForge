#!/usr/bin/env bash
# Serve GUI-Owl-1.5-32B-Instruct (Qwen3-VL) on vLLM as the FULL end-to-end GUI
# agent — it reads the screen, plans, grounds (pixel coords) and decides when to
# stop, all in one model. No planner/grounder split.
#
# Runs on the GPU box; the Windows launcher tunnels localhost:4243 -> here.
# Served under name "gui-owl" so the client config (CUA_MODEL=gui-owl) is
# identical to the 8B setup — only the checkpoint changes.
#
# 32B (~64GB bf16) is tensor-parallel across 2x 80GB GPUs.
# Avoid the flashinfer JIT path (no nvcc): force TORCH_SDPA + --enforce-eager.
set -euo pipefail
CKPT=${CKPT:-/fs-computility-new/upzd_share/shared/cua/models/GUI-Owl-1.5-32B-Instruct}
export CUDA_VISIBLE_DEVICES=${CUDA_VISIBLE_DEVICES:-0,1}
export VLLM_ATTENTION_BACKEND=TORCH_SDPA
export VLLM_USE_FLASHINFER_SAMPLER=0
exec /root/miniconda3/envs/cua/bin/python -m vllm.entrypoints.openai.api_server \
  --model "$CKPT" --served-model-name gui-owl \
  --max-model-len 32768 --enforce-eager \
  --mm-processor-kwargs '{"min_pixels":3136,"max_pixels":10035200}' \
  --limit-mm-per-prompt '{"image":2}' \
  --tensor-parallel-size 2 --gpu-memory-utilization 0.90 \
  --allowed-local-media-path "/" --host 0.0.0.0 --port 4243
