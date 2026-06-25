#!/bin/bash
# Acceptance check: drives the LIVE stack (module :3898 -> experts :8001 -> real GPU models)
# with genuine example inputs for all four modalities and asserts real, input-sensitive numbers.
set -u
HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
MODULE_DIR="$(cd "$HERE/.." && pwd)"
PYTHON="${PYTHON:-/root/miniconda3/envs/serve/bin/python}"
exec "$PYTHON" "$MODULE_DIR/tests/e2e_real_models.py"
