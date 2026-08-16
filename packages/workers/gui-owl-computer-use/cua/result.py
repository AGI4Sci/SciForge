"""Small structured-result helpers for the Computer Use control service."""
from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone
from typing import Any

SERVICE_ID = "sciforge.computer-use"


def provenance(operation: str, request_id: str | None = None,
               started_at: float | None = None, **identity: Any) -> dict[str, Any]:
    value: dict[str, Any] = {
        "serviceId": SERVICE_ID, "operation": operation,
        "requestId": request_id or f"request-{uuid.uuid4()}",
        **{_camel(key): item for key, item in identity.items() if item is not None},
    }
    if started_at is not None:
        value["startedAt"] = _iso(started_at)
        value["completedAt"] = _iso(time.time())
    return value


def ok(data: Any, summary: str | None = None, artifacts: list[dict] | None = None,
       prov: dict | None = None, warnings: list[str] | None = None) -> dict[str, Any]:
    value: dict[str, Any] = {"ok": True, "data": data}
    if summary: value["summary"] = summary
    if artifacts: value["artifacts"] = artifacts
    if prov: value["provenance"] = prov
    if warnings: value["warnings"] = warnings
    return value


def err(code: str, message: str, retryable: bool = False,
        blocked_reason: str | None = None, details: dict | None = None,
        prov: dict | None = None) -> dict[str, Any]:
    error: dict[str, Any] = {"code": code, "message": message, "retryable": retryable}
    if blocked_reason: error["blockedReason"] = blocked_reason
    if details: error["details"] = details
    value: dict[str, Any] = {"ok": False, "error": error}
    if prov: value["provenance"] = prov
    return value


def _camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part[:1].upper() + part[1:] for part in tail)


def _iso(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat().replace("+00:00", "Z")
