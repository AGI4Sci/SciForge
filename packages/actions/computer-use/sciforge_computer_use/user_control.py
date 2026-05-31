"""Refs-first user-control store for Computer Use sessions."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence

from .contracts import (
    APP_WINDOW_ALLOWLIST_SCHEMA,
    DATA_VISIBILITY_SCHEMA,
    RISK_PREVIEW_SCHEMA,
    SESSION_PERMISSION_SCHEMA,
    STOP_CANCEL_LEASE_SCHEMA,
    validate_app_window_allowlist,
    validate_data_visibility,
    validate_risk_preview,
    validate_session_permission,
    validate_stop_cancel_lease,
)


SESSION_PERMISSION_NAME = "session-permission.json"
APP_WINDOW_ALLOWLIST_NAME = "app-window-allowlist.json"
RISK_PREVIEW_NAME = "risk-preview.json"
DATA_VISIBILITY_NAME = "data-visibility.json"
STOP_CANCEL_LEASE_NAME = "stop-cancel-lease.json"
USER_CONTROL_STORE_VALIDATION_SCHEMA = "sciforge.computer-use.user-control-store-validation.v1"

_REDACTED = "[REDACTED]"
_FORBIDDEN_INLINE_KEY_RE = re.compile(
    r"(raw.*screenshot|raw.*image|inline.*image|image.*base64|screenshot.*base64|"
    r"screenshot.*data|dataurl|base64|raw.*provider.*payload|provider.*raw.*payload|raw.*payload)",
    re.IGNORECASE,
)
_SENSITIVE_KEY_RE = re.compile(r"(authorization|api[-_]?key|token|secret|password|credential)", re.IGNORECASE)
_DATA_URL_RE = re.compile(r"data:[^\s\"'<>]+", re.IGNORECASE)
_SECRET_VALUE_RE = re.compile(
    r"\b(?:authorization|api[_-]?key|access[_-]?key|refresh[_-]?token|token|secret|password|credential)s?\s*[:=]\s*[^\s,;}\]]+",
    re.IGNORECASE,
)
_BASE64_RE = re.compile(r"^[A-Za-z0-9+/]{80,}={0,2}$")


@dataclass(frozen=True)
class UserControlRefs:
    session_permission_ref: str
    app_window_allowlist_ref: str
    risk_preview_ref: str
    data_visibility_ref: str
    stop_cancel_lease_ref: str
    stop_ref: str
    cancel_lease_ref: str

    def as_dict(self) -> dict[str, str]:
        return {
            "sessionPermissionRef": self.session_permission_ref,
            "appWindowAllowlistRef": self.app_window_allowlist_ref,
            "riskPreviewRef": self.risk_preview_ref,
            "dataVisibilityRef": self.data_visibility_ref,
            "stopCancelLeaseRef": self.stop_cancel_lease_ref,
            "stopRef": self.stop_ref,
            "cancelLeaseRef": self.cancel_lease_ref,
        }


def write_session_permission_store(
    session_root: str | Path,
    *,
    session_id: str,
    thread_id: str | None,
    display_group_ref: str,
    screen_refs: Sequence[str],
    actor_cursor_log_ref: str,
    input_queue_ref: str,
    capture_stream_ref: str,
    replay_bundle_ref: str,
    input_adapter_manifest_ref: str,
    active_lease_ref: str | None = None,
    metadata: Mapping[str, Any] | None = None,
) -> UserControlRefs:
    """Write the five user-control manifests under a session root."""

    root = Path(session_root).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    metadata_safe = _safe_json(metadata or {})
    user_control = _mapping(metadata_safe.get("userControl"))
    source = _first_string(user_control.get("source"), metadata_safe.get("source"), "session-manager")
    created_at = _utc_now()
    expires_at = _first_string(user_control.get("expiresAt"), _default_expiry())
    user_confirmation_ref = _first_string(user_control.get("userConfirmationRef"))
    approval_mode = _first_string(user_control.get("approvalMode"), "fail-closed")
    allowed_app_refs = _string_list(user_control.get("allowedAppRefs"))
    allowed_window_refs = _string_list(user_control.get("allowedWindowRefs"))
    forbidden_app_refs = _string_list(user_control.get("forbiddenAppRefs"))
    if not forbidden_app_refs:
        forbidden_app_refs = ["app:shared-user-desktop"]

    app_window_allowlist_ref = str((root / APP_WINDOW_ALLOWLIST_NAME).resolve())
    risk_preview_ref = str((root / RISK_PREVIEW_NAME).resolve())
    data_visibility_ref = str((root / DATA_VISIBILITY_NAME).resolve())
    stop_cancel_lease_ref = str((root / STOP_CANCEL_LEASE_NAME).resolve())
    session_permission_ref = str((root / SESSION_PERMISSION_NAME).resolve())
    stop_ref = stop_cancel_lease_ref
    cancel_lease_ref = stop_cancel_lease_ref
    input_modality_policy = {
        "allowedInputModalities": _string_list(
            user_control.get("allowedInputModalities"),
            default=["observe", "actor-cursor", "scoped-executor"],
        ),
        "mutatingInputRequiresLease": True,
        "sharedSystemInputAllowed": False,
        "targetBoundExecutorRequired": True,
        "policyRef": app_window_allowlist_ref,
    }

    _write_json(
        Path(app_window_allowlist_ref),
        {
            "schemaVersion": APP_WINDOW_ALLOWLIST_SCHEMA,
            "sessionId": session_id,
            "threadId": thread_id,
            "source": source,
            "appWindowAllowlistRef": app_window_allowlist_ref,
            "allowedAppRefs": allowed_app_refs,
            "allowedWindowRefs": allowed_window_refs,
            "forbiddenAppRefs": forbidden_app_refs,
            "userConfirmationRef": user_confirmation_ref,
            "expiresAt": expires_at,
            "scopeSourceRefs": [display_group_ref, *screen_refs],
            "metadata": {
                "diagnosticDefault": not bool(user_confirmation_ref),
                "source": source,
            },
        },
    )
    _write_json(
        Path(risk_preview_ref),
        {
            "schemaVersion": RISK_PREVIEW_SCHEMA,
            "sessionId": session_id,
            "threadId": thread_id,
            "source": source,
            "riskPreviewRef": risk_preview_ref,
            "riskLevel": _first_string(user_control.get("riskLevel"), "low"),
            "riskClass": _first_string(user_control.get("riskClass"), "session-default"),
            "approvalMode": approval_mode,
            "actionRiskRefs": _string_list(user_control.get("actionRiskRefs")),
            "userConfirmationRef": user_confirmation_ref,
            "metadata": {
                "confirmationRequiredForHighRisk": True,
                "thirdPartyContentCannotAuthorize": True,
            },
        },
    )
    _write_json(
        Path(data_visibility_ref),
        {
            "schemaVersion": DATA_VISIBILITY_SCHEMA,
            "sessionId": session_id,
            "threadId": thread_id,
            "source": source,
            "dataVisibilityRef": data_visibility_ref,
            "readScopeRefs": [capture_stream_ref, replay_bundle_ref, input_adapter_manifest_ref],
            "inputScopeRefs": [input_queue_ref],
            "visibleScreenRefs": list(screen_refs),
            "visibleWindowRefs": allowed_window_refs,
            "screenshotRefPolicy": "refs-only",
            "inlineScreenshotsAllowed": False,
            "providerPayloadAllowed": False,
            "userConfirmationRef": user_confirmation_ref,
            "metadata": {
                "actorCursorLogRef": actor_cursor_log_ref,
                "rawPayloadWritten": False,
                "inlineImageWritten": False,
                "secretsWritten": False,
            },
        },
    )
    current_cancellations = [cancel_lease_ref]
    if active_lease_ref:
        current_cancellations.append(active_lease_ref)
    _write_json(
        Path(stop_cancel_lease_ref),
        {
            "schemaVersion": STOP_CANCEL_LEASE_SCHEMA,
            "sessionId": session_id,
            "threadId": thread_id,
            "source": source,
            "stopRef": stop_ref,
            "cancelLeaseRef": cancel_lease_ref,
            "currentLeaseCancellationRefs": current_cancellations,
            "cancellationMode": "lease-cancel-only",
            "packageStateKillAllowed": False,
            "activeLeaseRef": active_lease_ref,
            "userConfirmationRef": user_confirmation_ref,
            "metadata": {
                "inputQueueRef": input_queue_ref,
                "replayBundleRef": replay_bundle_ref,
            },
        },
    )
    _write_json(
        Path(session_permission_ref),
        {
            "schemaVersion": SESSION_PERMISSION_SCHEMA,
            "sessionId": session_id,
            "threadId": thread_id,
            "source": source,
            "sessionPermissionRef": session_permission_ref,
            "appWindowAllowlistRef": app_window_allowlist_ref,
            "allowedAppRefs": allowed_app_refs,
            "allowedWindowRefs": allowed_window_refs,
            "forbiddenAppRefs": forbidden_app_refs,
            "inputModalityPolicy": input_modality_policy,
            "riskPreviewRef": risk_preview_ref,
            "dataVisibilityRef": data_visibility_ref,
            "stopRef": stop_ref,
            "cancelLeaseRef": cancel_lease_ref,
            "approvalMode": approval_mode,
            "userConfirmationRef": user_confirmation_ref,
            "expiresAt": expires_at,
            "createdAt": created_at,
            "metadata": {
                "diagnosticDefault": not bool(user_confirmation_ref),
                "appWindowAllowlistRef": app_window_allowlist_ref,
                "stopCancelLeaseRef": stop_cancel_lease_ref,
                "displayGroupRef": display_group_ref,
            },
        },
    )
    return UserControlRefs(
        session_permission_ref=session_permission_ref,
        app_window_allowlist_ref=app_window_allowlist_ref,
        risk_preview_ref=risk_preview_ref,
        data_visibility_ref=data_visibility_ref,
        stop_cancel_lease_ref=stop_cancel_lease_ref,
        stop_ref=stop_ref,
        cancel_lease_ref=cancel_lease_ref,
    )


def validate_session_permission_store(
    session_root: str | Path,
    *,
    require_existing_refs: bool = True,
) -> dict[str, Any]:
    root = Path(session_root).expanduser().resolve()
    files = {
        "sessionPermissionRef": root / SESSION_PERMISSION_NAME,
        "appWindowAllowlistRef": root / APP_WINDOW_ALLOWLIST_NAME,
        "riskPreviewRef": root / RISK_PREVIEW_NAME,
        "dataVisibilityRef": root / DATA_VISIBILITY_NAME,
        "stopCancelLeaseRef": root / STOP_CANCEL_LEASE_NAME,
    }
    validators = {
        "sessionPermissionRef": validate_session_permission,
        "appWindowAllowlistRef": validate_app_window_allowlist,
        "riskPreviewRef": validate_risk_preview,
        "dataVisibilityRef": validate_data_visibility,
        "stopCancelLeaseRef": validate_stop_cancel_lease,
    }
    errors: list[dict[str, Any]] = []
    refs: dict[str, str] = {}
    for key, path in files.items():
        refs[key] = str(path)
        if not path.is_file():
            errors.append({"code": "user_control_file_missing", "message": f"{path.name} is missing.", "path": f"$.{key}"})
            continue
        validation = validators[key](path, require_existing_refs=require_existing_refs)
        for issue in validation["errors"]:
            errors.append({**issue, "sidecar": key})
    session_permission = _load_json(files["sessionPermissionRef"]) if files["sessionPermissionRef"].is_file() else {}
    stop_cancel = _load_json(files["stopCancelLeaseRef"]) if files["stopCancelLeaseRef"].is_file() else {}
    if session_permission.get("stopRef") != stop_cancel.get("stopRef"):
        errors.append({"code": "stop_ref_mismatch", "message": "session-permission stopRef must match stop-cancel sidecar.", "path": "$.stopRef"})
    if session_permission.get("cancelLeaseRef") != stop_cancel.get("cancelLeaseRef"):
        errors.append({"code": "cancel_lease_ref_mismatch", "message": "session-permission cancelLeaseRef must match stop-cancel sidecar.", "path": "$.cancelLeaseRef"})
    return {
        "schemaVersion": USER_CONTROL_STORE_VALIDATION_SCHEMA,
        "ok": not errors,
        "status": "accepted" if not errors else "blocked",
        "errorCount": len(errors),
        "errors": errors,
        "refs": refs,
        "diagnosticOnly": bool(session_permission.get("metadata", {}).get("diagnosticDefault", False)),
    }


def _safe_json(value: Any) -> Any:
    if isinstance(value, Mapping):
        safe: dict[str, Any] = {}
        for key, item in value.items():
            key_text = str(key)
            if _SENSITIVE_KEY_RE.search(key_text):
                safe[key_text] = _REDACTED
            elif _FORBIDDEN_INLINE_KEY_RE.search(key_text):
                safe[key_text] = _REDACTED
            else:
                safe[key_text] = _safe_json(item)
        return safe
    if isinstance(value, (list, tuple)):
        return [_safe_json(item) for item in value]
    if isinstance(value, str):
        if _DATA_URL_RE.search(value) or ";base64," in value.lower() or _SECRET_VALUE_RE.search(value):
            return _REDACTED
        compact = "".join(value.split())
        if _BASE64_RE.match(compact):
            return _REDACTED
        return value
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return str(value)


def _write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    safe_payload = _safe_json(payload)
    path.write_text(f"{json.dumps(safe_payload, indent=2, sort_keys=True)}\n", encoding="utf8")


def _load_json(path: Path) -> dict[str, Any]:
    parsed = json.loads(path.read_text(encoding="utf8"))
    return dict(parsed) if isinstance(parsed, Mapping) else {}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _default_expiry() -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=8)).isoformat(timespec="seconds").replace("+00:00", "Z")


def _first_string(*values: Any) -> str:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _string_list(value: Any, *, default: Sequence[str] | None = None) -> list[str]:
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    if isinstance(value, (list, tuple)):
        return [str(item).strip() for item in value if isinstance(item, (str, int, float)) and str(item).strip()]
    return list(default or [])


def _mapping(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, Mapping) else {}


__all__ = [
    "APP_WINDOW_ALLOWLIST_NAME",
    "DATA_VISIBILITY_NAME",
    "RISK_PREVIEW_NAME",
    "SESSION_PERMISSION_NAME",
    "STOP_CANCEL_LEASE_NAME",
    "USER_CONTROL_STORE_VALIDATION_SCHEMA",
    "UserControlRefs",
    "validate_session_permission_store",
    "write_session_permission_store",
]
