"""Single tsx-subprocess batch bridge for the Python conversation policy.

Replaces 9 separate tsx subprocess spawns (context_policy, context_projection,
reference_digest, artifact_index, service_plan×3, latency_policy, handoff_planner)
with one call to conversation-policy-batch.ts, reducing tsx overhead from
~2.5 seconds to ~0.3 seconds per request.
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any, Mapping
import subprocess


JsonMap = dict[str, Any]

_BATCH_TS_RELATIVE = "src/runtime/gateway/conversation-policy-batch.ts"


def _repo_root() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / "package.json").exists() and (parent / _BATCH_TS_RELATIVE).exists():
            return parent
    return Path.cwd()


def _runner(root: Path) -> list[str]:
    configured = os.environ.get("SCIFORGE_CONTEXT_POLICY_TSX")
    if configured:
        return [configured]
    local = root / "node_modules" / ".bin" / ("tsx.cmd" if os.name == "nt" else "tsx")
    if local.exists():
        return [str(local)]
    return ["npx", "tsx"]


def _jsonable(value: Any) -> Any:
    if is_dataclass(value):
        return asdict(value)
    to_dict = getattr(value, "to_dict", None)
    if callable(to_dict):
        return to_dict()
    if isinstance(value, Mapping):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    return value


def run_policy_batch(
    request: Mapping[str, Any],
    *,
    timeout: int = 12,
) -> JsonMap:
    """Run all TypeScript policy computations in a single tsx subprocess.

    Args:
        request: Full policy request including goalSnapshot, capabilityBrief,
                 executionModePlan, handoffBudget, and turnExecutionConstraints.
        timeout: Subprocess timeout in seconds (default 12).

    Returns:
        Combined result with keys: policyInput, contextPolicy, contextProjection,
        currentReferenceDigests, artifactIndex, turnComposition, latencyPolicy,
        handoffPlan, servicePlan, recoveryPlan, currentReferences, recentFailures.

    Raises:
        RuntimeError: If the tsx subprocess exits non-zero or returns invalid JSON.
        subprocess.TimeoutExpired: If the subprocess exceeds `timeout` seconds.
    """
    root = _repo_root()
    env = os.environ.copy()
    env["PATH"] = env.get("PATH") or "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
    script = """
import { readFileSync } from 'node:fs';
import { runConversationPolicyBatch } from './src/runtime/gateway/conversation-policy-batch.ts';
const input = JSON.parse(readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(runConversationPolicyBatch(input)));
"""
    payload = json.dumps(_jsonable(dict(request)), ensure_ascii=False)
    completed = subprocess.run(
        [*_runner(root), "--eval", script],
        input=payload,
        text=True,
        capture_output=True,
        cwd=root,
        env=env,
        timeout=timeout,
        check=False,
    )
    if completed.returncode != 0:
        reason = (completed.stderr or completed.stdout or "unknown failure").strip()
        raise RuntimeError(f"conversation policy batch bridge failed: {reason}")
    try:
        parsed = json.loads(completed.stdout or "{}")
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"conversation policy batch bridge returned invalid JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise RuntimeError("conversation policy batch bridge returned a non-object payload")
    return parsed


__all__ = ["run_policy_batch"]
