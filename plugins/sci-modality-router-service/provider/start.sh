#!/bin/bash
# Launch the SciForge expert-translator FastAPI provider (the six text-output experts).
# All experts load lazily on first request, so this boots instantly and only the
# modalities you actually use consume VRAM. Location-relative so it runs wherever this
# provider/ dir is deployed. Behind the GFW, set HF_ENDPOINT=https://hf-mirror.com.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

export EXPERT_TRANSLATOR_HOST="${EXPERT_TRANSLATOR_HOST:-127.0.0.1}"
export EXPERT_TRANSLATOR_PORT="${EXPERT_TRANSLATOR_PORT:-8001}"
export EXPERT_DEVICE="${EXPERT_DEVICE:-cuda:0}"
export EXPERT_MODEL_DIR="${EXPERT_MODEL_DIR:-/fs-computility-new/upzd_share/shared/sciforge-expert-models}"
export HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"
export TOKENIZERS_PARALLELISM=false

# Python interpreter (override PYTHON for non-default environments).
exec "${PYTHON:-/root/miniconda3/envs/serve/bin/python}" -u server.py
