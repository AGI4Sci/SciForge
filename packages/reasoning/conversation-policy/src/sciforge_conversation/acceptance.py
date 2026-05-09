"""Python compatibility bridge for runtime-owned conversation acceptance gates."""

from __future__ import annotations

from dataclasses import asdict, is_dataclass
import json
import os
from pathlib import Path
import subprocess
from typing import Any, Mapping


JsonMap = dict[str, Any]


def _repo_root() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / "package.json").exists() and (parent / "src/runtime/gateway/conversation-acceptance-policy.ts").exists():
            return parent
    return Path.cwd()


def _runner(root: Path) -> list[str]:
    configured = os.environ.get("SCIFORGE_CONVERSATION_ACCEPTANCE_TSX")
    if configured:
        return [configured]
    local = root / "node_modules" / ".bin" / ("tsx.cmd" if os.name == "nt" else "tsx")
    if local.exists():
        return [str(local)]
    return ["npx", "tsx"]


def _from_gateway(payload: Mapping[str, Any]) -> JsonMap:
    root = _repo_root()
    env = os.environ.copy()
    env["PATH"] = env.get("PATH") or "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
    script = """
import { readFileSync } from 'node:fs';
import { evaluateConversationAcceptance } from './src/runtime/gateway/conversation-acceptance-policy.ts';
const input = JSON.parse(readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(evaluateConversationAcceptance(input)));
"""
    completed = subprocess.run(
        [*_runner(root), "--eval", script],
        input=json.dumps(_jsonable(payload), ensure_ascii=False),
        text=True,
        capture_output=True,
        cwd=root,
        env=env,
        timeout=8,
        check=False,
    )
    if completed.returncode != 0:
        reason = (completed.stderr or completed.stdout or "unknown failure").strip()
        raise RuntimeError(f"conversation acceptance bridge failed: {reason}")
    parsed = json.loads(completed.stdout or "{}")
    if not isinstance(parsed, dict):
        raise RuntimeError("conversation acceptance bridge returned a non-object payload")
    return parsed


def _jsonable(value: Any) -> Any:
    if is_dataclass(value):
        return asdict(value)
    to_dict = getattr(value, "to_dict", None)
    if callable(to_dict):
        return to_dict()
    if isinstance(value, Mapping):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    return value


def evaluate_acceptance(
    goal: Mapping[str, Any] | None = None,
    response: Mapping[str, Any] | None = None,
    session: Mapping[str, Any] | None = None,
) -> JsonMap:
    return _from_gateway({
        "goal": goal if isinstance(goal, Mapping) else {},
        "response": response if isinstance(response, Mapping) else {},
        "session": session if isinstance(session, Mapping) else {},
    })


__all__ = ["evaluate_acceptance"]
