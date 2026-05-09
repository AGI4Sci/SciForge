"""Python compatibility bridge for runtime-owned conversation memory policy."""

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
        if (parent / "package.json").exists() and (
            parent / "src/runtime/gateway/conversation-memory-policy.ts"
        ).exists():
            return parent
    return Path.cwd()


def _runner(root: Path) -> list[str]:
    configured = os.environ.get("SCIFORGE_MEMORY_POLICY_TSX")
    if configured:
        return [configured]
    local = root / "node_modules" / ".bin" / ("tsx.cmd" if os.name == "nt" else "tsx")
    if local.exists():
        return [str(local)]
    return ["npx", "tsx"]


def _from_gateway(payload: Mapping[str, Any], export_name: str) -> Any:
    root = _repo_root()
    env = os.environ.copy()
    env["PATH"] = env.get("PATH") or "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
    script = f"""
import {{ readFileSync }} from 'node:fs';
import {{ {export_name} }} from './src/runtime/gateway/conversation-memory-policy.ts';
const input = JSON.parse(readFileSync(0, 'utf8'));
const result = {export_name}(...(Array.isArray(input.__args) ? input.__args : [input]));
process.stdout.write(JSON.stringify(result));
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
        raise RuntimeError(f"conversation memory policy bridge failed: {reason}")
    return json.loads(completed.stdout or "null")


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


def _payload(value: Mapping[str, Any] | Any) -> JsonMap:
    jsonable = _jsonable(value)
    return jsonable if isinstance(jsonable, dict) else {}


def build_memory_plan(request: Mapping[str, Any] | Any) -> JsonMap:
    result = _from_gateway(_payload(request), "buildConversationMemoryPlan")
    if not isinstance(result, dict):
        raise RuntimeError("conversation memory policy bridge returned a non-object payload")
    return result


def build_conversation_ledger(messages: list[Any], runs: list[Any] | None = None) -> list[JsonMap]:
    result = _from_gateway({"__args": [messages, runs or []]}, "buildConversationLedger")
    if not isinstance(result, list):
        raise RuntimeError("conversation memory ledger bridge returned a non-list payload")
    return [dict(item) for item in result if isinstance(item, Mapping)]


__all__ = ["build_memory_plan", "build_conversation_ledger"]
