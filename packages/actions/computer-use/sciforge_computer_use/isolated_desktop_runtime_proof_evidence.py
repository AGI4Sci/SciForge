"""Shared runtime proof validators for isolated desktop evidence payloads."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from .isolated_desktop_contracts import ISOLATED_RUNTIME_RESOURCE_ALLOCATION_SCHEMAS
from .trace import (
    _int_or_none,
    _list_of_mappings,
    _mapping,
    _repair_replay_error,
    _string_or_none,
)

RUNTIME_SIDE_EFFECT_FLAGS = (
    "sharedSystemInputUsed",
    "systemPointerMoved",
    "systemKeyboardEventsSent",
)
ALLOWED_RUNTIME_RESOURCE_ALLOCATION_STATUSES = frozenset({
    "allocated",
    "released-after-run",
})


def validate_backend_process_payload(
    *,
    evidence_process_ref: str | None,
    readiness_payload: Mapping[str, Any] | None,
    process_payload: Mapping[str, Any],
    errors: list[dict[str, Any]],
    expected_display: str | None = None,
    expected_session_id: str | None = None,
    require_readiness_process_ref: bool = True,
    required_process_roles: Sequence[str] | None = None,
    require_existing_log_refs: bool = False,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None = None,
) -> None:
    if process_payload.get("schemaVersion") != "sciforge.computer-use.backend-processes.v1":
        errors.append(_repair_replay_error("process_ref_schema_invalid", "processRef must resolve to backend process records.", "$.processRef.schemaVersion", expected="sciforge.computer-use.backend-processes.v1", actual=process_payload.get("schemaVersion")))
    readiness_process_ref = _string_or_none(_mapping(readiness_payload).get("processRef"))
    if require_readiness_process_ref and readiness_payload is not None and not readiness_process_ref:
        errors.append(_repair_replay_error("backend_readiness_process_ref_missing", "backendReadinessProofRef must cite the backend process records.", "$.backendReadinessProofRef.processRef", expected=evidence_process_ref))
    if evidence_process_ref and readiness_process_ref and readiness_process_ref != evidence_process_ref:
        errors.append(_repair_replay_error("backend_readiness_process_ref_mismatch", "backendReadinessProofRef.processRef must match top-level processRef.", "$.backendReadinessProofRef.processRef", expected=evidence_process_ref, actual=readiness_process_ref))
    _validate_runtime_session_and_display(
        process_payload,
        errors,
        path="$.processRef",
        code_prefix="process_ref",
        expected_display=expected_display,
        expected_session_id=expected_session_id,
    )
    processes = _list_of_mappings(process_payload.get("processes"))
    if not processes:
        errors.append(_repair_replay_error("process_ref_records_missing", "processRef must contain backend process records.", "$.processRef.processes"))
    _validate_required_process_roles(processes, errors, required_process_roles=required_process_roles)
    for process in processes:
        _validate_runtime_session_and_display(
            process,
            errors,
            path="$.processRef.processes",
            code_prefix="process_record",
            expected_display=expected_display,
            expected_session_id=expected_session_id,
        )
        if not _string_or_none(process.get("stdoutLogRef")) or not _string_or_none(process.get("stderrLogRef")):
            errors.append(_repair_replay_error("process_log_refs_missing", "Every backend process record must include stdoutLogRef and stderrLogRef.", "$.processRef.processes", actual=process))
            break
        if require_existing_log_refs:
            _validate_process_log_ref_exists(process, errors, resolver=resolver)
        validate_no_side_effect_flags(process, errors, path="$.processRef.processes")
    validate_no_side_effect_flags(process_payload, errors, path="$.processRef")


def validate_runtime_resource_allocation_payload(
    payload: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    expected_display: str | None,
    expected_session_id: str | None = None,
    expected_vnc_port: int | None = None,
    expected_novnc_port: int | None = None,
) -> None:
    if payload.get("schemaVersion") not in ISOLATED_RUNTIME_RESOURCE_ALLOCATION_SCHEMAS:
        errors.append(_repair_replay_error(
            "resource_allocation_schema_invalid",
            "resourceAllocationRef must resolve to an isolated runtime resource allocation payload.",
            "$.resourceAllocationRef.schemaVersion",
            expected=sorted(ISOLATED_RUNTIME_RESOURCE_ALLOCATION_SCHEMAS),
            actual=payload.get("schemaVersion"),
        ))
    status = str(payload.get("status") or "")
    if status.startswith("blocked") or status == "released-after-blocked":
        errors.append(_repair_replay_error("resource_allocation_blocked", "resourceAllocationRef cannot be blocked for completed evidence.", "$.resourceAllocationRef.status", actual=payload.get("status")))
    elif status not in ALLOWED_RUNTIME_RESOURCE_ALLOCATION_STATUSES:
        errors.append(_repair_replay_error("resource_allocation_status_invalid", "resourceAllocationRef status must be an allowed completed-run allocation state.", "$.resourceAllocationRef.status", expected=sorted(ALLOWED_RUNTIME_RESOURCE_ALLOCATION_STATUSES), actual=payload.get("status")))
    if expected_display and _string_or_none(payload.get("display")) != expected_display:
        errors.append(_repair_replay_error("resource_allocation_display_mismatch", "resourceAllocationRef display must match the isolated virtual display.", "$.resourceAllocationRef.display", expected=expected_display, actual=payload.get("display")))
    if expected_session_id:
        actual_session_id = session_id(payload)
        if not actual_session_id:
            errors.append(_repair_replay_error(
                "resource_allocation_session_id_missing",
                "resourceAllocationRef must include the shared isolated sessionId.",
                "$.resourceAllocationRef.sessionId",
                expected=expected_session_id,
            ))
        elif actual_session_id != expected_session_id:
            errors.append(_repair_replay_error(
                "resource_allocation_session_id_mismatch",
                "resourceAllocationRef sessionId must match sessionManifestRef.",
                "$.resourceAllocationRef.sessionId",
                expected=expected_session_id,
                actual=actual_session_id,
            ))
    actual_vnc_port = _int_or_none(payload.get("vncPort"))
    actual_novnc_port = _int_or_none(payload.get("novncPort"))
    if actual_vnc_port is None or actual_novnc_port is None or payload.get("localhostOnly") is not True:
        errors.append(_repair_replay_error("resource_allocation_ports_invalid", "resourceAllocationRef must allocate localhost VNC/noVNC ports.", "$.resourceAllocationRef", actual=payload))
    elif actual_vnc_port == actual_novnc_port:
        errors.append(_repair_replay_error("resource_allocation_ports_collide", "resourceAllocationRef must allocate distinct VNC and noVNC localhost ports.", "$.resourceAllocationRef", actual=payload))
    if expected_vnc_port is not None and actual_vnc_port != expected_vnc_port:
        errors.append(_repair_replay_error("resource_allocation_vnc_port_mismatch", "resourceAllocationRef vncPort must match backendReadinessProofRef.", "$.resourceAllocationRef.vncPort", expected=expected_vnc_port, actual=actual_vnc_port))
    if expected_novnc_port is not None and actual_novnc_port != expected_novnc_port:
        errors.append(_repair_replay_error("resource_allocation_novnc_port_mismatch", "resourceAllocationRef novncPort must match backendReadinessProofRef.", "$.resourceAllocationRef.novncPort", expected=expected_novnc_port, actual=actual_novnc_port))
    validate_no_side_effect_flags(payload, errors, path="$.resourceAllocationRef")


def _validate_required_process_roles(
    processes: Sequence[Mapping[str, Any]],
    errors: list[dict[str, Any]],
    *,
    required_process_roles: Sequence[str] | None,
) -> None:
    required = {str(role).strip() for role in (required_process_roles or []) if str(role).strip()}
    if not required:
        return
    observed = {_string_or_none(process.get("role")) or "" for process in processes}
    missing = sorted(role for role in required if role not in observed)
    if missing:
        errors.append(_repair_replay_error(
            "process_required_roles_missing",
            "processRef must contain records for every required isolated desktop runtime role.",
            "$.processRef.processes",
            expected=sorted(required),
            actual={"roles": sorted(role for role in observed if role), "missing": missing},
        ))


def _validate_process_log_ref_exists(
    process: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> None:
    for key in ("stdoutLogRef", "stderrLogRef"):
        ref = _string_or_none(process.get(key))
        if ref and not _ref_exists(ref, resolver=resolver):
            errors.append(_repair_replay_error(
                "process_log_ref_not_found",
                "Every backend process stdout/stderr log ref must exist for completed evidence.",
                f"$.processRef.processes.{key}",
                actual=ref,
            ))
            return


def _ref_exists(
    ref: str,
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> bool:
    try:
        resolved = resolver(ref) if resolver else ref
        if resolved is None:
            resolved = ref
        if isinstance(resolved, Mapping):
            return True
        return Path(resolved).expanduser().is_file()
    except (OSError, TypeError, ValueError):
        return False


def validate_no_side_effect_flags(
    payload: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    path: str,
    flags: Sequence[str] = RUNTIME_SIDE_EFFECT_FLAGS,
) -> None:
    for flag in flags:
        if payload.get(flag) is not False:
            errors.append(_repair_replay_error("runtime_proof_side_effect_flag", "Runtime proof payload must explicitly rule out shared/system input side effects.", f"{path}.{flag}", expected=False, actual=payload.get(flag)))


def validate_runtime_session_and_display(
    payload: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    path: str,
    code_prefix: str,
    expected_display: str | None,
    expected_session_id: str | None,
) -> None:
    _validate_runtime_session_and_display(
        payload,
        errors,
        path=path,
        code_prefix=code_prefix,
        expected_display=expected_display,
        expected_session_id=expected_session_id,
    )


def _validate_runtime_session_and_display(
    payload: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    path: str,
    code_prefix: str,
    expected_display: str | None,
    expected_session_id: str | None,
) -> None:
    if expected_session_id:
        actual_session_id = session_id(payload)
        if not actual_session_id:
            errors.append(_repair_replay_error(
                f"{code_prefix}_session_id_missing",
                "Runtime process proof must include the shared isolated sessionId.",
                f"{path}.sessionId",
                expected=expected_session_id,
            ))
        elif actual_session_id != expected_session_id:
            errors.append(_repair_replay_error(
                f"{code_prefix}_session_id_mismatch",
                "Runtime process proof sessionId must match sessionManifestRef.",
                f"{path}.sessionId",
                expected=expected_session_id,
                actual=actual_session_id,
            ))
    if expected_display:
        actual_display = display_id(payload)
        if not actual_display:
            errors.append(_repair_replay_error(
                f"{code_prefix}_display_missing",
                "Runtime process proof must include the shared isolated display.",
                f"{path}.display",
                expected=expected_display,
            ))
        elif actual_display != expected_display:
            errors.append(_repair_replay_error(
                f"{code_prefix}_display_mismatch",
                "Runtime process proof display must match virtualDisplayRef.",
                f"{path}.display",
                expected=expected_display,
                actual=actual_display,
            ))


def session_id(payload: Mapping[str, Any]) -> str | None:
    for key in ("sessionId", "sessionID", "virtualSessionId", "isolatedSessionId"):
        value = _string_or_none(payload.get(key))
        if value:
            return value
    for key in ("session", "runtime", "desktopSession"):
        value = _string_or_none(_mapping(payload.get(key)).get("sessionId"))
        if value:
            return value
    return None


def display_id(payload: Mapping[str, Any] | None) -> str | None:
    if payload is None:
        return None
    for key in ("display", "displayId", "xDisplay", "DISPLAY"):
        value = _string_or_none(payload.get(key))
        if value:
            return value
    for key in ("virtualDisplay", "displayRef", "runtime", "backend"):
        nested = _mapping(payload.get(key))
        for nested_key in ("display", "displayId", "xDisplay", "DISPLAY"):
            value = _string_or_none(nested.get(nested_key))
            if value:
                return value
    return None


__all__ = [
    "RUNTIME_SIDE_EFFECT_FLAGS",
    "ALLOWED_RUNTIME_RESOURCE_ALLOCATION_STATUSES",
    "display_id",
    "session_id",
    "validate_backend_process_payload",
    "validate_no_side_effect_flags",
    "validate_runtime_resource_allocation_payload",
    "validate_runtime_session_and_display",
]
