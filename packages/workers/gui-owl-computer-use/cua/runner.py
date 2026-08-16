"""Deterministic structured Computer Use execution over one bound channel."""
from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any, Mapping

from driver.channel import ChannelError, SessionInputChannel

from . import result as R


def run_task(request: dict[str, Any], channel: SessionInputChannel) -> dict[str, Any]:
    started = time.time()
    try:
        action = request["semanticAction"]
        current = channel.observe()
        expected_revision = request.get("expectedRevision")
        if expected_revision is not None and expected_revision != current.revision:
            raise ChannelError(
                "STALE_OBSERVATION", "expectedRevision does not match the current target",
                details={"expectedRevision": expected_revision, "latestRevision": current.revision},
            )
        initial = _observation(current)
        records: list[dict[str, Any]] = []
        if action["kind"] == "click":
            records.append(_perform_click(channel, current, action, 0))
            current = channel.observe()
        elif action["kind"] == "sequence":
            for index, step in enumerate(action["steps"]):
                record = _perform_step(channel, current, step, index)
                records.append(record)
                current = channel.observe()
        matched, current = _verify_expectation(channel, current, action.get("expect"))
        final = _observation(current)
        if matched is not None and not matched:
            return R.err(
                "ACTION_UNVERIFIED", "structured action readback did not match",
                details=_data(channel, request, initial, final, records, matched),
                prov=_provenance(channel, started),
            )
        data = _data(channel, request, initial, final, records, matched)
        return R.ok(
            data,
            summary=f"structured {action['kind']} completed on {channel.target.target_id}",
            prov=_provenance(channel, started),
        )
    except ChannelError as error:
        return R.err(
            error.code, str(error), details=error.details,
            prov=_provenance(channel, started),
        )
    except Exception as error:  # noqa: BLE001
        return R.err(
            "INTERNAL_ERROR", f"structured runner failed: {error}", retryable=False,
            prov=_provenance(channel, started),
        )


def _perform_step(channel: SessionInputChannel, observation, step: dict[str, Any], index: int) -> dict[str, Any]:
    if step["kind"] == "click":
        return _perform_click(channel, observation, step, index)
    if step["kind"] == "type":
        action = {"action": "type", "text": step["text"]}
    elif step["kind"] == "press":
        action = {"action": "hotkey" if len(step["keys"]) > 1 else "key", "keys": step["keys"]}
    elif step["kind"] == "scroll":
        action = {"action": "scroll", "deltaX": step["deltaX"], "deltaY": step["deltaY"]}
    else:
        raise ChannelError("ACTION_UNSUPPORTED", f"unsupported structured step {step['kind']}")
    return _perform(channel, observation, action, index, step)


def _perform_click(channel: SessionInputChannel, observation, step: dict[str, Any], index: int) -> dict[str, Any]:
    nodes = _semantic_tree(observation.metadata)
    matches = [node for node in nodes if _role(node) == step["role"] and
               str(node.get("name") or "").strip() == step["name"] and
               node.get("disabled") is not True and _center(node) is not None]
    if len(matches) != 1:
        raise ChannelError(
            "ACTION_UNSUPPORTED", "click requires exactly one enabled semantic control",
            details={"role": step["role"], "name": step["name"], "matchCount": len(matches)},
        )
    center = _center(matches[0])
    assert center is not None
    width, height = observation.image.size
    action = {"action": "click", "coordinate": [round(center[0] * width / 1000), round(center[1] * height / 1000)]}
    return _perform(channel, observation, action, index, step)


def _perform(channel: SessionInputChannel, observation, action: Mapping[str, Any],
             index: int, semantic: Mapping[str, Any]) -> dict[str, Any]:
    started = time.time()
    outcome = channel.perform(action, expected_revision=observation.revision)
    return {
        "step": index, "semanticAction": _redacted_semantic_action(semantic),
        "outcome": outcome.to_dict(),
        "timeline": {"actionStartedAt": _iso(started), "actionCompletedAt": _iso(time.time())},
    }


def _redacted_semantic_action(value: Mapping[str, Any]) -> dict[str, Any]:
    if value.get("kind") == "type":
        return {"kind": "type", "textLength": len(str(value.get("text") or ""))}
    return dict(value)


def _verify_expectation(channel: SessionInputChannel, observation,
                        expectation: dict[str, Any] | None) -> tuple[bool | None, Any]:
    if expectation is None:
        return None, observation
    stable_seconds = int(expectation.get("stableForMs", 0)) / 1000
    remaining = channel.remaining_seconds
    verify_deadline = time.monotonic() + min(3.0, remaining if remaining is not None else 0.0)
    matched_since: float | None = None
    while True:
        now = time.monotonic()
        matched = _text_present(_semantic_tree(observation.metadata), expectation["text"])
        if matched:
            matched_since = matched_since or now
            if now - matched_since >= stable_seconds:
                return True, observation
        else:
            matched_since = None
        wait_seconds = min(0.05, verify_deadline - now)
        if wait_seconds <= 0:
            return False, observation
        channel.wait(wait_seconds)
        observation = channel.observe()


def _data(channel: SessionInputChannel, request: dict[str, Any], initial: dict[str, Any],
          final: dict[str, Any], records: list[dict[str, Any]], matched: bool | None) -> dict[str, Any]:
    return {
        "status": "verified" if matched is True else "observed" if not records else "executed",
        "executed": bool(records), "stepCount": len(records),
        "targetId": channel.target.target_id, "backend": channel.capabilities.backend.value,
        "requestedIsolation": channel.isolation.requested.value,
        "effectiveIsolation": channel.isolation.effective.value,
        "degraded": channel.isolation.degraded,
        "initialObservation": initial, "steps": records, "finalObservation": final,
        "verification": {"matched": matched, "expectation": request["semanticAction"].get("expect")},
    }


def _observation(value) -> dict[str, Any]:
    return {"revision": value.revision, "semanticTree": _semantic_tree(value.metadata)}


def _semantic_tree(metadata: Mapping[str, Any]) -> list[dict[str, Any]]:
    value = metadata.get("semanticTree")
    return [dict(node) for node in value[:256] if isinstance(node, Mapping)] if isinstance(value, list) else []


def _role(node: Mapping[str, Any]) -> str:
    role = str(node.get("role") or "").strip().lower()
    if role: return role
    return {"a": "link", "button": "button", "input": "textbox", "textarea": "textbox"}.get(
        str(node.get("tag") or "").lower(), str(node.get("tag") or "").lower())


def _center(node: Mapping[str, Any]) -> tuple[float, float] | None:
    value = node.get("center")
    if not isinstance(value, (list, tuple)) or len(value) != 2: return None
    try: return float(value[0]), float(value[1])
    except (TypeError, ValueError): return None


def _text_present(nodes: list[dict[str, Any]], text: str) -> bool:
    return any(text in str(node.get("name") or "") for node in nodes)


def _provenance(channel: SessionInputChannel, started: float) -> dict[str, Any]:
    return R.provenance(
        "computer_use", channel.request_id, started,
        session_id=channel.session_id, target_id=channel.target.target_id,
        lease_id=channel.lease.lease_id, backend=channel.capabilities.backend.value,
        requested_isolation=channel.isolation.requested.value,
        effective_isolation=channel.isolation.effective.value,
        degraded=channel.isolation.degraded,
    )


def _iso(value: float) -> str:
    return datetime.fromtimestamp(value, tz=timezone.utc).isoformat().replace("+00:00", "Z")
