"""ServiceResult envelope (Servic_Module_Template.md).

The module returns structured result / evidence / artifacts / error / blockedReason.
It NEVER returns a user-level final answer or completion truth — the Agent Host
decides whether the task is truly done. For computer-use that means: we report
what was observed and done (trace + status), not "task accomplished".
"""
from __future__ import annotations
import time
import uuid
from typing import Any, Dict, List, Optional

SERVICE_ID = "sciforge.computer-use"

ERROR_CODES = {
    "INVALID_ARGUMENT", "UNAUTHENTICATED", "PERMISSION_DENIED", "NOT_FOUND",
    "TIMEOUT", "RATE_LIMITED", "UNAVAILABLE", "NEEDS_APPROVAL",
    "BLOCKED_BY_POLICY", "INTERNAL_ERROR",
}


def provenance(operation: str, request_id: Optional[str] = None,
               started_at: Optional[float] = None) -> Dict[str, Any]:
    p = {"serviceId": SERVICE_ID, "operation": operation,
         "requestId": request_id or str(uuid.uuid4())}
    if started_at is not None:
        p["startedAt"] = _iso(started_at)
        p["completedAt"] = _iso(time.time())
    return p


def ok(data: Any, summary: Optional[str] = None, artifacts: Optional[List[Dict]] = None,
       prov: Optional[Dict] = None, warnings: Optional[List[str]] = None) -> Dict[str, Any]:
    r: Dict[str, Any] = {"ok": True, "data": data}
    if summary:
        r["summary"] = summary
    if artifacts:
        r["artifacts"] = artifacts
    if prov:
        r["provenance"] = prov
    if warnings:
        r["warnings"] = warnings
    return r


def err(code: str, message: str, retryable: bool = False,
        blocked_reason: Optional[str] = None, details: Optional[Dict] = None,
        prov: Optional[Dict] = None) -> Dict[str, Any]:
    assert code in ERROR_CODES, f"bad error code {code}"
    e: Dict[str, Any] = {"code": code, "message": message, "retryable": retryable}
    if blocked_reason:
        e["blockedReason"] = blocked_reason
    if details:
        e["details"] = details
    r: Dict[str, Any] = {"ok": False, "error": e}
    if prov:
        r["provenance"] = prov
    return r


def artifact_ref(kind: str, title: str, path: Optional[str] = None,
                 schema_version: Optional[str] = None) -> Dict[str, Any]:
    a = {"kind": kind, "title": title}
    if path:
        a["path"] = path
    if schema_version:
        a["schemaVersion"] = schema_version
    return a


def _iso(ts: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts))
