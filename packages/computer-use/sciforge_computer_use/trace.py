"""Trace serialization helpers for Computer Use results."""

from __future__ import annotations

from dataclasses import fields, is_dataclass
from typing import Any, Mapping

from .contracts import ComputerUseResult


def result_to_trace(result: ComputerUseResult) -> dict[str, Any]:
    """Return a file-ref-only trace dictionary."""

    trace = {
        "schemaVersion": "sciforge.computer-use.loop-trace.v1",
        "status": result.status,
        "reason": result.reason,
        "metrics": dict(result.metrics),
        "failureDiagnostics": dict(result.failure_diagnostics),
        "finalObservationRef": result.final_observation.ref if result.final_observation else None,
        "steps": [_step_to_trace(step) for step in result.steps],
    }
    _reject_inline_payloads(trace)
    return trace


def compact_result_for_handoff(result: ComputerUseResult) -> dict[str, Any]:
    """Build a compact handoff block for upper-level agents."""

    trace = result_to_trace(result)
    refs = []
    for step in trace["steps"]:
        refs.append(step["beforeRef"])
        if step.get("afterRef"):
            refs.append(step["afterRef"])
    return {
        "schemaVersion": "sciforge.computer-use.compact-handoff.v1",
        "status": result.status,
        "reason": result.reason,
        "refs": [ref for ref in refs if ref],
        "actions": [
            {
                "index": step["index"],
                "kind": step.get("action", {}).get("kind"),
                "target": step.get("action", {}).get("target"),
                "status": step.get("status"),
                "verification": step.get("verification"),
            }
            for step in trace["steps"]
        ],
        "failureDiagnostics": trace["failureDiagnostics"],
    }


def _step_to_trace(step: Any) -> dict[str, Any]:
    return {
        "index": step.index,
        "status": step.status,
        "beforeRef": step.before.ref,
        "beforeSummary": step.before.summary,
        "afterRef": step.after.ref if step.after else None,
        "action": _action_to_trace(step.plan),
        "grounding": _compact_dataclass(step.grounding),
        "execution": _compact_dataclass(step.execution),
        "verification": _compact_dataclass(step.verification),
        "failureReason": step.failure_reason,
    }


def _action_to_trace(action: Any) -> dict[str, Any]:
    return {
        "kind": action.kind,
        "target": action.target.description if action.target else None,
        "targetRegion": action.target.region_description if action.target else None,
        "text": action.text,
        "key": action.key,
        "keys": list(action.keys),
        "direction": action.direction,
        "amount": action.amount,
        "appName": action.app_name,
        "done": action.done,
        "reason": action.reason,
        "riskLevel": action.risk_level,
        "requiresConfirmation": action.requires_confirmation,
    }


def _compact_dataclass(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    if isinstance(value, Mapping):
        data = dict(value)
    elif is_dataclass(value):
        data = {field.name: getattr(value, field.name) for field in fields(value)}
    else:
        return {"value": str(value)}
    return {key: _compact_value(item) for key, item in data.items()}


def _compact_value(value: Any) -> Any:
    if is_dataclass(value):
        return _compact_dataclass(value)
    if isinstance(value, Mapping):
        return {key: _compact_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_compact_value(item) for item in value]
    return value


def _reject_inline_payloads(value: Any) -> None:
    text = str(value)
    if "data:image/" in text or ";base64," in text:
        raise ValueError("Computer Use trace must be file-ref-only and cannot contain inline image payloads.")

