"""Strict CDP-only Computer Use service contract."""
from __future__ import annotations

from typing import Any

from .target import validate_safe_id

PROTOCOL_V2 = 2


def normalize_run_input(value: object) -> dict[str, Any]:
    if not isinstance(value, dict): raise ValueError("run input must be an object")
    allowed = {"sessionId", "semanticAction", "expectedRevision", "deadlineMs", "instruction", "requestId", "execute"}
    unknown = set(value) - allowed
    if unknown: raise ValueError(f"unsupported fields: {', '.join(sorted(unknown))}")
    if "semanticAction" not in value:
        if isinstance(value.get("instruction"), str):
            raise ValueError("UNSUPPORTED_LEGACY_INSTRUCTION: instruction-only input is unsupported")
        raise ValueError("semanticAction is required")
    normalized: dict[str, Any] = {
        "protocolVersion": PROTOCOL_V2,
        "sessionId": validate_safe_id(value.get("sessionId"), "sessionId"),
        "semanticAction": _semantic_action(value["semanticAction"]),
        "requestedIsolation": "host-app-scoped", "allowDegraded": False,
        "queueIfBusy": False, "execute": True, "approve": True,
    }
    if value.get("requestId") is not None:
        normalized["requestId"] = validate_safe_id(value["requestId"], "requestId")
    if value.get("expectedRevision") is not None:
        normalized["expectedRevision"] = _text(value["expectedRevision"], "expectedRevision", 512)
    deadline = value.get("deadlineMs")
    if deadline is not None:
        if isinstance(deadline, bool) or not isinstance(deadline, int) or not 1 <= deadline <= 600_000:
            raise ValueError("deadlineMs must be an integer between 1 and 600000")
        normalized["deadlineMs"] = deadline
    if value.get("instruction") is not None:
        normalized["instruction"] = _text(value["instruction"], "instruction", 1024)
    return normalized


def _semantic_action(value: object) -> dict[str, Any]:
    if not isinstance(value, dict): raise ValueError("semanticAction must be an object")
    kind = value.get("kind")
    if kind == "observe":
        if set(value) - {"kind", "expect"}: raise ValueError("observe contains unsupported fields")
        return {"kind": "observe", **_expect(value.get("expect"))}
    if kind == "click":
        if set(value) - {"kind", "role", "name", "expect"}: raise ValueError("click contains unsupported fields")
        return {"kind": "click", "role": _text(value.get("role"), "semanticAction.role", 64).lower(),
                "name": _text(value.get("name"), "semanticAction.name", 512), **_expect(value.get("expect"))}
    if kind != "sequence" or set(value) - {"kind", "steps", "expect"}:
        raise ValueError("semanticAction.kind must be observe, click, or sequence")
    steps = value.get("steps")
    if not isinstance(steps, list) or not 1 <= len(steps) <= 32:
        raise ValueError("semanticAction.steps must contain 1-32 entries")
    return {"kind": "sequence", "steps": [_step(step, index) for index, step in enumerate(steps)], **_expect(value.get("expect"))}


def _step(value: object, index: int) -> dict[str, Any]:
    if not isinstance(value, dict): raise ValueError(f"semanticAction.steps[{index}] must be an object")
    kind = value.get("kind")
    if kind == "click" and set(value) == {"kind", "role", "name"}:
        return {"kind": kind, "role": _text(value["role"], "role", 64).lower(), "name": _text(value["name"], "name", 512)}
    if kind == "type" and set(value) == {"kind", "text"}:
        text = value["text"]
        if not isinstance(text, str) or len(text) > 4096: raise ValueError("type text must be at most 4096 characters")
        return {"kind": kind, "text": text}
    if kind == "press" and set(value) == {"kind", "keys"}:
        keys = value["keys"]
        if not isinstance(keys, list) or not 1 <= len(keys) <= 8: raise ValueError("press keys must contain 1-8 entries")
        return {"kind": kind, "keys": [_text(key, "key", 64) for key in keys]}
    if kind == "scroll" and set(value) <= {"kind", "deltaX", "deltaY"} and "deltaY" in value:
        x, y = value.get("deltaX", 0), value["deltaY"]
        if any(isinstance(item, bool) or not isinstance(item, (int, float)) or abs(item) > 10_000 for item in (x, y)):
            raise ValueError("scroll deltas must be numbers between -10000 and 10000")
        return {"kind": kind, "deltaX": float(x), "deltaY": float(y)}
    raise ValueError(f"semanticAction.steps[{index}] is invalid")


def _expect(value: object) -> dict[str, Any]:
    if value is None: return {}
    if not isinstance(value, dict) or set(value) - {"kind", "text", "stableForMs"} or value.get("kind") != "text-present":
        raise ValueError("expect must be a text-present expectation")
    stable = value.get("stableForMs", 0)
    if isinstance(stable, bool) or not isinstance(stable, int) or not 0 <= stable <= 10_000:
        raise ValueError("expect.stableForMs must be 0-10000")
    return {"expect": {"kind": "text-present", "text": _text(value.get("text"), "expect.text", 512), "stableForMs": stable}}


def _text(value: object, field: str, maximum: int) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ValueError(f"{field} must be 1-{maximum} characters")
    return value.strip()
