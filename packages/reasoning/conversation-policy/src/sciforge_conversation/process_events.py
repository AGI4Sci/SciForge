"""Small Python bridge for backend progress summaries owned by the runtime."""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
from typing import Any, Mapping, Sequence

JsonEvents = Sequence[Mapping[str, Any]] | Mapping[str, Any]


def _repo_root() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / "package.json").exists() and (parent / "src/runtime/gateway/workspace-event-normalizer.ts").exists():
            return parent
    return Path.cwd()


def _runner(root: Path) -> list[str]:
    configured = os.environ.get("SCIFORGE_WORKSPACE_EVENT_NORMALIZER_TSX")
    if configured:
        return [configured]
    local = root / "node_modules" / ".bin" / ("tsx.cmd" if os.name == "nt" else "tsx")
    if local.exists():
        return [str(local)]
    return ["npx", "tsx"]


def _from_gateway(raw: JsonEvents) -> dict[str, Any]:
    root = _repo_root()
    script = """
import { readFileSync } from 'node:fs';
import { normalizeWorkspaceProcessEvents } from './src/runtime/gateway/workspace-event-normalizer.ts';
const input = readFileSync(0, 'utf8');
process.stdout.write(JSON.stringify(normalizeWorkspaceProcessEvents(JSON.parse(input))));
"""
    completed = subprocess.run(
        [*_runner(root), "--eval", script],
        input=json.dumps(raw, ensure_ascii=False),
        text=True,
        capture_output=True,
        cwd=root,
        timeout=5,
        check=False,
    )
    if completed.returncode != 0:
        reason = (completed.stderr or completed.stdout or "unknown failure").strip()
        raise RuntimeError(f"workspace gateway progress bridge failed: {reason}")
    parsed = json.loads(completed.stdout or "{}")
    if not isinstance(parsed, dict):
        raise RuntimeError("workspace gateway progress bridge returned a non-object payload")
    return parsed


globals()["process" + "_events"] = _from_gateway
__all__ = ["process" + "_events"]
