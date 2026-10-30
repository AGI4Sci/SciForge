#!/bin/bash
# Launch the SciForge expert-translator FastAPI provider.
# All experts load lazily on first request, so this boots instantly and only the
# modalities you actually use consume VRAM. Location-relative so it runs wherever this
# provider/ dir is deployed. Behind the GFW, set HF_ENDPOINT=https://hf-mirror.com.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

if [ "${SCIFORGE_ENABLE_LOCAL_EXPERT_PROVIDER:-}" != "1" ]; then
  echo "Local expert provider is disabled by default. Set SCIFORGE_ENABLE_LOCAL_EXPERT_PROVIDER=1 after verifying model licenses." >&2
  exit 2
fi

: "${EXPERT_MODEL_DIR:?Set EXPERT_MODEL_DIR to a licensed external model directory.}"

export EXPERT_TRANSLATOR_HOST="${EXPERT_TRANSLATOR_HOST:-127.0.0.1}"
export EXPERT_TRANSLATOR_PORT="${EXPERT_TRANSLATOR_PORT:-8001}"
export EXPERT_DEVICE="${EXPERT_DEVICE:-cuda:0}"
export HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"
export TOKENIZERS_PARALLELISM=false

# Python interpreter (override PYTHON for non-default environments).
exec "${PYTHON:-/root/miniconda3/envs/serve/bin/python}" -u server.py
