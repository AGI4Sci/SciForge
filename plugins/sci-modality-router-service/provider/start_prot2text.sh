#!/bin/bash
# Launch the isolated Prot2Text structure->text micro-service in the `p2t` conda env
# (which has graphein + DSSP). The main provider proxies protein_structure requests here.
# Runs on GPU1 (CUDA_VISIBLE_DEVICES=1) so it never contends with the cua/GUI-Owl service
# on GPU0. Behind the GFW, HF_ENDPOINT points at the mirror for the ESM tokenizer fetch.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

MD="${PROT2TEXT_MODEL_DIR:-/fs-computility-new/upzd_share/shared/sciforge-expert-models/prot2text-large}"
P2T_PY="${P2T_PYTHON:-/root/miniconda3/envs/p2t/bin/python}"

# Prot2Text ships custom modeling code with relative imports; transformers' dynamic-module
# loader does not copy them all when loading from a local dir, so seed the cache ourselves.
CACHE="$HOME/.cache/huggingface/modules/transformers_modules/prot2text-large"
mkdir -p "$CACHE"
cp "$MD"/*.py "$CACHE"/
touch "$HOME/.cache/huggingface/modules/transformers_modules/__init__.py" "$CACHE/__init__.py"

export HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"
export CUDA_VISIBLE_DEVICES="${CUDA_VISIBLE_DEVICES:-1}"
export PROT2TEXT_DEVICE="${PROT2TEXT_DEVICE:-cuda:0}"  # cuda:0 within the GPU1-only mask
export PROT2TEXT_HOST="${PROT2TEXT_HOST:-127.0.0.1}"
export PROT2TEXT_PORT="${PROT2TEXT_PORT:-8002}"
export PROT2TEXT_MODEL_DIR="$MD"
export TOKENIZERS_PARALLELISM=false

exec "$P2T_PY" -u prot2text_service.py
