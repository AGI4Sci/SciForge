"""Python compatibility bridge for runtime-owned execution mode decisions."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field, is_dataclass
import json
import os
from pathlib import Path
import subprocess
from typing import Any, Literal, Mapping, Sequence


ExecutionMode = Literal[
    "direct-context-answer",
    "thin-reproducible-adapter",
    "single-stage-task",
    "multi-stage-project",
    "repair-or-continue-project",
]
ReproducibilityLevel = Literal["none", "light", "full", "staged"]
JsonMap = dict[str, Any]


@dataclass(frozen=True)
class ExecutionClassifierInput:
    prompt: str = ""
    refs: Sequence[Any] = field(default_factory=tuple)
    artifacts: Sequence[Mapping[str, Any]] = field(default_factory=tuple)
    expected_artifact_types: Sequence[str] = field(default_factory=tuple)
    selected_capabilities: Sequence[Any] = field(default_factory=tuple)
    selected_tools: Sequence[Any] = field(default_factory=tuple)
    selected_senses: Sequence[Any] = field(default_factory=tuple)
    selected_verifiers: Sequence[Any] = field(default_factory=tuple)
    recent_failures: Sequence[Any] = field(default_factory=tuple)
    prior_attempts: Sequence[Any] = field(default_factory=tuple)
    user_guidance_queue: Sequence[Any] = field(default_factory=tuple)


@dataclass(frozen=True)
class ExecutionModeDecision:
    executionMode: ExecutionMode
    complexityScore: float
    uncertaintyScore: float
    reproducibilityLevel: ReproducibilityLevel
    stagePlanHint: list[str]
    reason: str
    riskFlags: list[str] = field(default_factory=list)
    signals: list[str] = field(default_factory=list)


def _repo_root() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (
            (parent / "package.json").exists()
            and (parent / "src/runtime/gateway/conversation-execution-classifier.ts").exists()
        ):
            return parent
    return Path.cwd()


def _runner(root: Path) -> list[str]:
    configured = os.environ.get("SCIFORGE_EXECUTION_CLASSIFIER_TSX")
    if configured:
        return [configured]
    local = root / "node_modules" / ".bin" / ("tsx.cmd" if os.name == "nt" else "tsx")
    if local.exists():
        return [str(local)]
    return ["npx", "tsx"]


def _from_gateway(payload: Mapping[str, Any] | Any) -> JsonMap:
    root = _repo_root()
    env = os.environ.copy()
    env["PATH"] = env.get("PATH") or "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
    script = """
import { readFileSync } from 'node:fs';
import { classifyExecutionMode } from './src/runtime/gateway/conversation-execution-classifier.ts';
const input = JSON.parse(readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(classifyExecutionMode(input)));
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
        raise RuntimeError(f"runtime execution decision bridge failed: {reason}")
    parsed = json.loads(completed.stdout or "{}")
    if not isinstance(parsed, dict):
        raise RuntimeError("runtime execution decision bridge returned a non-object payload")
    return parsed


def _jsonable(value: Any) -> Any:
    if is_dataclass(value):
        return _jsonable(asdict(value))
    to_dict = getattr(value, "to_dict", None)
    if callable(to_dict):
        return _jsonable(to_dict())
    if isinstance(value, Mapping):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return {
        key: _jsonable(getattr(value, key))
        for key in dir(value)
        if not key.startswith("_") and not callable(getattr(value, key))
    }


def classify_execution_mode(request: ExecutionClassifierInput | Mapping[str, Any] | Any) -> JsonMap:
    """Classify a prompt into an execution mode decision via runtime ownership."""

    return _from_gateway(request)


__all__ = [
    "ExecutionClassifierInput",
    "ExecutionModeDecision",
    "ExecutionMode",
    "ReproducibilityLevel",
    "classify_execution_mode",
]
