"""Pure helpers for the isolated desktop L1 smoke probe."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Mapping, Sequence

from .isolated_desktop_l1_smoke_evidence import (
    ISOLATED_DESKTOP_L1_SMOKE_EVIDENCE_SCHEMA_VERSION,
)


def _runner_options(
    *,
    display: str | None,
    vnc_port: int | None,
    novnc_port: int | None,
    timeout_seconds: float,
    resource_lock_root: str | Path | None,
) -> dict[str, Any]:
    return {
        "display": display,
        "vncPort": vnc_port,
        "novncPort": novnc_port,
        "timeoutSeconds": timeout_seconds,
        "resourceLockRoot": str(resource_lock_root) if resource_lock_root else None,
    }


def _command_plan(
    components: Mapping[str, Mapping[str, Any]],
    *,
    execute_requested: bool,
    display: str | None,
    vnc_port: int | None,
    novnc_port: int | None,
    timeout_seconds: float,
    resource_lock_root: str | Path | None,
) -> dict[str, Any]:
    return {
        "status": "not-started",
        "executeRequested": bool(execute_requested),
        "inputTool": _path_or_placeholder(components, "isolatedInputTool"),
        "screenshotTool": _path_or_placeholder(components, "screenshotTool"),
        "inputToolScope": "must be invoked only with DISPLAY bound to the isolated X display",
        "sharedSystemInputAllowed": False,
        "completionEvidenceRequired": ISOLATED_DESKTOP_L1_SMOKE_EVIDENCE_SCHEMA_VERSION,
        "runnerOptions": _runner_options(
            display=display,
            vnc_port=vnc_port,
            novnc_port=novnc_port,
            timeout_seconds=timeout_seconds,
            resource_lock_root=resource_lock_root,
        ),
    }


def _check(ok: bool, category: str, reason: str) -> dict[str, Any]:
    return {"category": category, "ok": bool(ok), "reason": "" if ok else reason}


def _short_text(value: Any, *, limit: int = 500) -> str:
    text = str(value or "")
    return text[:limit]


def _unique_strings(values: Sequence[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if not isinstance(value, str):
            continue
        text = value.strip()
        if not text or text in seen:
            continue
        seen.add(text)
        result.append(text)
    return result


def _path_or_placeholder(components: Mapping[str, Mapping[str, Any]], name: str) -> str | None:
    value = components.get(name, {})
    path = value.get("path")
    return str(path) if path else None


def _write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{json.dumps(payload, indent=2, sort_keys=True)}\n", encoding="utf8")


__all__ = [
    "_check",
    "_command_plan",
    "_path_or_placeholder",
    "_runner_options",
    "_short_text",
    "_unique_strings",
    "_write_json",
]
