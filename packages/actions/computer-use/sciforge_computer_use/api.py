"""Public shims for the Computer Use action provider API."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Mapping

from .loop import run_task
from .trace import compact_result, validate_trace


def get_manifest() -> dict[str, Any]:
    """Return the bundled action-provider manifest."""

    manifest_path = Path(__file__).resolve().parents[1] / "action-provider.manifest.json"
    parsed = json.loads(manifest_path.read_text(encoding="utf8"))
    if not isinstance(parsed, Mapping):
        raise ValueError("Computer Use manifest root must be a JSON object.")
    return dict(parsed)


getManifest = get_manifest
runTask = run_task
validateTrace = validate_trace
compactResult = compact_result


__all__ = [
    "compact_result",
    "compactResult",
    "get_manifest",
    "getManifest",
    "runTask",
    "run_task",
    "validate_trace",
    "validateTrace",
]
