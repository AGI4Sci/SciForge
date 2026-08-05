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
    "BLOCKED_BY_POLICY", "INTERNAL_ERROR", "BACKEND_UNAVAILABLE",
    "ISOLATION_UNAVAILABLE", "SESSION_ID_CONFLICT", "SESSION_NOT_FOUND",
    "SESSION_BUSY", "SESSION_OWNER_MISMATCH", "REQUEST_ID_CONFLICT",
    "REQUEST_NOT_FOUND", "TARGET_BUSY", "HOST_INPUT_BUSY",
    "LEASE_ALREADY_ACTIVE", "LEASE_NOT_FOUND", "INVALID_STATE_TRANSITION",
    "REGISTRY_CLOSED",
    "DEGRADATION_NOT_ALLOWED", "TARGET_NOT_FOUND", "TARGET_LOST",
    "STALE_OBSERVATION", "ACTION_UNSUPPORTED", "ACTION_UNVERIFIED",
    "ACTION_OUTCOME_UNKNOWN", "LEASE_EXPIRED", "CANCEL_PENDING",
    "CLEANUP_INCOMPLETE",
}

_RETRYABLE_CODES = {
    "TIMEOUT", "RATE_LIMITED", "UNAVAILABLE", "SESSION_BUSY", "TARGET_BUSY",
    "HOST_INPUT_BUSY", "CANCEL_PENDING",
}

_FAILURE_CLASS = {
    "SESSION_BUSY": "contention", "TARGET_BUSY": "contention",
    "HOST_INPUT_BUSY": "contention", "BACKEND_UNAVAILABLE": "routing",
    "ISOLATION_UNAVAILABLE": "routing", "DEGRADATION_NOT_ALLOWED": "routing",
    "ACTION_OUTCOME_UNKNOWN": "outcome-unknown", "CLEANUP_INCOMPLETE": "cleanup",
}


def provenance(operation: str, request_id: Optional[str] = None,
               started_at: Optional[float] = None, *,
               session_id: Optional[str] = None,
               target_id: Optional[str] = None,
               lease_id: Optional[str] = None,
               backend: Optional[str] = None,
               requested_isolation: Optional[str] = None,
               effective_isolation: Optional[str] = None,
               degraded: Optional[bool] = None) -> Dict[str, Any]:
    p = {"serviceId": SERVICE_ID, "operation": operation,
         "requestId": request_id or str(uuid.uuid4())}
    if started_at is not None:
        p["startedAt"] = _iso(started_at)
        p["completedAt"] = _iso(time.time())
    optional = {
        "sessionId": session_id,
        "targetId": target_id,
        "leaseId": lease_id,
        "backend": backend,
        "requestedIsolation": requested_isolation,
        "effectiveIsolation": effective_isolation,
        "degraded": degraded,
    }
    p.update({key: value for key, value in optional.items() if value is not None})
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


def err(code: str, message: str, retryable: Optional[bool] = None,
        blocked_reason: Optional[str] = None, details: Optional[Dict] = None,
        prov: Optional[Dict] = None) -> Dict[str, Any]:
    assert code in ERROR_CODES, f"bad error code {code}"
    resolved_retryable = code in _RETRYABLE_CODES if retryable is None else retryable
    e: Dict[str, Any] = {
        "code": code,
        "message": message,
        "retryable": resolved_retryable,
        "failureClass": _FAILURE_CLASS.get(code, "request"),
        "recovery": _recovery_guidance(code),
    }
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


def _recovery_guidance(code: str) -> str:
    if code in {"SESSION_BUSY", "TARGET_BUSY", "HOST_INPUT_BUSY"}:
        return "retry with bounded backoff or choose another session/target"
    if code in {"BACKEND_UNAVAILABLE", "ISOLATION_UNAVAILABLE", "DEGRADATION_NOT_ALLOWED"}:
        return "choose an available backend/isolation level or explicitly permit degradation"
    if code == "ACTION_OUTCOME_UNKNOWN":
        return "inspect target state before deciding whether to retry"
    if code == "CLEANUP_INCOMPLETE":
        return "do not reuse the lease; inspect status and cleanup diagnostics"
    return "correct the request or inspect service diagnostics"
