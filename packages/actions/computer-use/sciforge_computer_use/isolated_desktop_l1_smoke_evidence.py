"""Strict evidence contract for a real isolated desktop L1 smoke run."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from .isolated_desktop_contracts import (
    BACKEND_KIND,
    BACKEND_READINESS_PROOF_SCHEMA_VERSION,
    EXECUTOR_COMMAND_EVENT_LOG_SCHEMA,
    ISOLATED_CAPTURE_SOURCE,
    REMOTE_DESKTOP_INPUT_CHANNEL,
    TARGET_ENVIRONMENT_KIND,
)
from .isolated_desktop_preflight_evidence import (
    validate_isolated_desktop_backend_preflight_payload,
)
from .isolated_desktop_runtime_proof_evidence import (
    display_id as _runtime_display_id,
    session_id as _runtime_session_id,
    validate_backend_process_payload,
    validate_runtime_resource_allocation_payload,
)
from .isolated_desktop_l1_smoke_evidence_helpers import (
    EXECUTOR_COMMAND_SIDE_EFFECT_FLAGS,
    _input_event_log_refs,
    _l1_action_summary,
    _l1_input_event_log_summary,
    _load_evidence_records,
    _load_json_mapping,
    _load_l1_payload_ref,
    _prior_round_completion_evidence_issues,
    _required_modalities,
    _resolve_ref_or_value,
    _state_changing_step,
    _step_current_screenshot_refs,
    _steps_from_result_or_trace,
    _target_environment_is_package_or_diagnostic,
    _unique_strings,
    _validate_backend_readiness_proof,
    _validate_final_visible_evidence_consistency,
    _validate_input_command_provenance,
    _validate_screenshot_content_change,
    _validate_session_ref_payload_schemas,
    _validate_stepwise_screenshot_content_change,
    _viewer_screenshot_refs,
    _workflow_screen_change_verified,
)
from .trace import (
    _existing_ref_errors,
    _inline_payload_issues,
    _int_or_none,
    _list_of_mappings,
    _load_repair_mapping_with_ref,
    _looks_like_screenshot_ref,
    _mapping,
    _refs_from_explicit_list,
    _repair_replay_error,
    _string_or_none,
)
from .visible_viewer import validate_visible_run_viewer_manifest


ISOLATED_DESKTOP_L1_SMOKE_EVIDENCE_SCHEMA_VERSION = (
    "sciforge.computer-use.isolated-desktop-l1-smoke-evidence.v1"
)
ISOLATED_DESKTOP_L1_SMOKE_EVIDENCE_VALIDATION_SCHEMA_VERSION = (
    "sciforge.computer-use.isolated-desktop-l1-smoke-evidence-validation.v1"
)
L1_ACCEPTANCE_TIER = "l1-isolated-smoke"
ALLOWED_L1_BACKEND_KINDS = frozenset({BACKEND_KIND})
REQUIRED_L1_SESSION_REFS = (
    "sessionManifestRef",
    "virtualDisplayRef",
    "captureStreamRef",
    "replayBundleRef",
    "filesystemRootRef",
    "noVncViewerRef",
)
REQUIRED_L1_LEDGER_REFS = (
    "evidenceLogRef",
    "evidenceSnapshotRef",
    "evidenceIndexRef",
    "plannerBriefRef",
)
REQUIRED_L1_WORKFLOW_ACTIONS = (
    "open-real-gui-app",
    "click-or-focus-visible-input",
    "type-text-through-isolated-input",
    "click-visible-button-or-control",
    "verify-screen-changed",
)
REQUIRED_L1_RUNTIME_PROCESS_ROLES = (
    "virtual-display",
    "window-manager",
    "vnc-server",
    "novnc-proxy",
    "browser",
)


def build_isolated_desktop_l1_smoke_evidence(
    preflight_manifest_or_ref: Mapping[str, Any] | str | Path,
    result_or_ref: Mapping[str, Any] | str | Path,
    trace_or_ref: Mapping[str, Any] | str | Path,
    *,
    initial_screenshot_ref: str,
    final_screenshot_ref: str,
    screenshot_refs: Sequence[str] | None = None,
    real_window_evidence_refs: Sequence[str] | None = None,
    viewer_manifest_ref: str | None = None,
    viewer_html_ref: str | None = None,
    input_event_log_ref: str | None = None,
    pointer_event_log_ref: str | None = None,
    keyboard_event_log_ref: str | None = None,
    session_manifest_ref: str | None = None,
    virtual_display_ref: str | None = None,
    capture_stream_ref: str | None = None,
    replay_bundle_ref: str | None = None,
    filesystem_root_ref: str | None = None,
    no_vnc_viewer_ref: str | None = None,
    backend_readiness_proof_ref: str | None = None,
    executor_command_event_log_ref: str | None = None,
    target_window_ref: str | None = None,
    window_bound_pointer_proof_ref: str | None = None,
    process_ref: str | None = None,
    resource_allocation_ref: str | None = None,
    evidence_log_ref: str | None = None,
    evidence_snapshot_ref: str | None = None,
    evidence_index_ref: str | None = None,
    planner_brief_ref: str | None = None,
    input_adapter_manifest_ref: str | None = None,
    input_adapter_binding_manifest_ref: str | None = None,
    target_environment_kind: str = TARGET_ENVIRONMENT_KIND,
    backend_kind: str = BACKEND_KIND,
    input_channel: str = REMOTE_DESKTOP_INPUT_CHANNEL,
    capture_source: str = ISOLATED_CAPTURE_SOURCE,
    minimum_action_count: int = 4,
    required_input_modalities: Sequence[str] | None = ("pointer", "keyboard"),
    requires_current_step_screenshots: bool = True,
    forbid_prior_round_completion_evidence: bool = True,
    screen_changed: bool = True,
    require_existing_refs: bool = True,
    metadata: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Build refs-first evidence for a completed real isolated desktop L1 run.

    The builder intentionally validates the payload it constructs. A readiness
    manifest can be a preflight ref, but it cannot by itself satisfy this L1
    contract.
    """

    preflight, preflight_ref = _load_repair_mapping_with_ref(preflight_manifest_or_ref, resolver=None)
    result, result_ref = _load_repair_mapping_with_ref(result_or_ref, resolver=None)
    trace, trace_ref = _load_repair_mapping_with_ref(trace_or_ref, resolver=None)
    trace_refs = _unique_strings([
        *(_refs_from_explicit_list(result.get("traceRefs")) if isinstance(result, Mapping) else []),
        *(_refs_from_explicit_list(trace.get("traceRefs")) if isinstance(trace, Mapping) else []),
        *([trace_ref] if trace_ref else []),
    ])
    screenshots = _unique_strings([
        *(screenshot_refs or []),
        initial_screenshot_ref,
        final_screenshot_ref,
    ])
    evidence_refs = _unique_strings([
        *(real_window_evidence_refs or []),
        initial_screenshot_ref,
        final_screenshot_ref,
        *[
            ref
            for ref in (
                viewer_manifest_ref,
                input_event_log_ref,
                pointer_event_log_ref,
                keyboard_event_log_ref,
                backend_readiness_proof_ref,
                executor_command_event_log_ref,
                target_window_ref,
                window_bound_pointer_proof_ref,
                process_ref,
                resource_allocation_ref,
            )
            if ref
        ],
    ])
    evidence = {
        "schemaVersion": ISOLATED_DESKTOP_L1_SMOKE_EVIDENCE_SCHEMA_VERSION,
        "status": "completed",
        "reason": "",
        "acceptanceTier": L1_ACCEPTANCE_TIER,
        "userAcceptanceEligible": True,
        "backendKind": backend_kind,
        "targetEnvironmentKind": target_environment_kind,
        "captureSource": capture_source,
        "preflightRef": preflight_ref,
        "preflightStatus": preflight.get("status"),
        "resultRef": result_ref,
        "traceRefs": trace_refs,
        "screenshotRefs": screenshots,
        "initialScreenshotRef": initial_screenshot_ref,
        "finalScreenshotRef": final_screenshot_ref,
        "realWindowEvidenceRefs": evidence_refs,
        "viewerManifestRef": viewer_manifest_ref,
        "visibleRunViewerManifestRef": viewer_manifest_ref,
        "viewerHtmlRef": viewer_html_ref,
        "inputEventLogRef": input_event_log_ref,
        "pointerEventLogRef": pointer_event_log_ref,
        "keyboardEventLogRef": keyboard_event_log_ref,
        "sessionManifestRef": session_manifest_ref,
        "virtualDisplayRef": virtual_display_ref,
        "captureStreamRef": capture_stream_ref,
        "replayBundleRef": replay_bundle_ref,
        "filesystemRootRef": filesystem_root_ref,
        "noVncViewerRef": no_vnc_viewer_ref,
        "backendReadinessProofRef": backend_readiness_proof_ref,
        "executorCommandEventLogRef": executor_command_event_log_ref,
        "targetWindowRef": target_window_ref,
        "windowBoundPointerProofRef": window_bound_pointer_proof_ref,
        "processRef": process_ref,
        "resourceAllocationRef": resource_allocation_ref,
        "evidenceLogRef": evidence_log_ref,
        "evidenceSnapshotRef": evidence_snapshot_ref,
        "evidenceIndexRef": evidence_index_ref,
        "plannerBriefRef": planner_brief_ref,
        "inputAdapterManifestRef": input_adapter_manifest_ref,
        "inputAdapterBindingManifestRef": input_adapter_binding_manifest_ref,
        "inputChannel": input_channel,
        "inputExecuted": True,
        "executeFailClosed": False,
        "osInputExecuted": False,
        "realOsInputExecuted": False,
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
        "realWindowEvidence": True,
        "diagnosticOnly": False,
        "rawPayloadWritten": False,
        "inlineImageWritten": False,
        "secretsWritten": False,
        "l1Smoke": {
            "status": "completed",
            "completed": True,
            "screenChanged": bool(screen_changed),
            "requiredActions": list(REQUIRED_L1_WORKFLOW_ACTIONS),
        },
        "workflowRequirements": {
            "minimumActionCount": int(minimum_action_count),
            "requiredInputModalities": _required_modalities(required_input_modalities),
            "requiresCurrentStepScreenshots": bool(requires_current_step_screenshots),
            "forbidPriorRoundCompletionEvidence": bool(forbid_prior_round_completion_evidence),
        },
        "metadata": dict(metadata or {}),
    }
    validation = validate_isolated_desktop_l1_smoke_evidence(evidence, require_existing_refs=require_existing_refs)
    evidence["status"] = "completed" if validation["ok"] else "blocked"
    evidence["reason"] = (
        "Isolated desktop L1 smoke evidence satisfies the real backend contract."
        if validation["ok"]
        else "; ".join(error["message"] for error in validation["errors"])
    )
    evidence["errors"] = validation["errors"]
    return evidence


def validate_isolated_desktop_l1_smoke_evidence(
    evidence_or_ref: Mapping[str, Any] | str | Path,
    *,
    require_existing_refs: bool = True,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None = None,
) -> dict[str, Any]:
    """Validate real isolated desktop L1 evidence and reject diagnostics."""

    try:
        evidence, evidence_ref = _load_repair_mapping_with_ref(evidence_or_ref, resolver=resolver)
    except (OSError, json.JSONDecodeError, TypeError) as exc:
        return _validation_result(
            None,
            evidence_ref=str(evidence_or_ref),
            errors=[_repair_replay_error("evidence_load_failed", f"Isolated desktop L1 evidence could not be loaded: {exc}.", "$")],
            require_existing_refs=require_existing_refs,
        )

    errors: list[dict[str, Any]] = []
    _validate_top_level_contract(evidence, errors)
    _validate_refs_and_viewer(evidence, errors, require_existing_refs=require_existing_refs, resolver=resolver)
    _validate_workflow(evidence, errors, resolver=resolver)
    _validate_evidence_ledger(evidence, errors, resolver=resolver)
    for issue in _inline_payload_issues(evidence):
        errors.append(_repair_replay_error("inline_payload_forbidden", issue, "$"))
    if require_existing_refs:
        errors.extend(_existing_ref_errors(_all_required_refs(evidence)))
    return _validation_result(
        evidence,
        evidence_ref=evidence_ref,
        errors=errors,
        require_existing_refs=require_existing_refs,
    )


def _validate_top_level_contract(evidence: Mapping[str, Any], errors: list[dict[str, Any]]) -> None:
    if evidence.get("schemaVersion") != ISOLATED_DESKTOP_L1_SMOKE_EVIDENCE_SCHEMA_VERSION:
        errors.append(_repair_replay_error(
            "unsupported_schema_version",
            "Isolated desktop L1 evidence schemaVersion is invalid.",
            "$.schemaVersion",
            expected=ISOLATED_DESKTOP_L1_SMOKE_EVIDENCE_SCHEMA_VERSION,
            actual=evidence.get("schemaVersion"),
        ))
    if evidence.get("status") != "completed":
        errors.append(_repair_replay_error("status_not_completed", "Isolated desktop L1 evidence status must be completed.", "$.status", expected="completed", actual=evidence.get("status")))
    if evidence.get("acceptanceTier") != L1_ACCEPTANCE_TIER:
        errors.append(_repair_replay_error("acceptance_tier_not_l1", "Isolated desktop L1 evidence requires acceptanceTier=l1-isolated-smoke.", "$.acceptanceTier", expected=L1_ACCEPTANCE_TIER, actual=evidence.get("acceptanceTier")))
    if evidence.get("userAcceptanceEligible") is not True:
        errors.append(_repair_replay_error("user_acceptance_not_eligible", "Completed L1 smoke evidence must explicitly be acceptance eligible for the L1 tier.", "$.userAcceptanceEligible", expected=True, actual=evidence.get("userAcceptanceEligible")))
    if evidence.get("backendKind") not in ALLOWED_L1_BACKEND_KINDS:
        errors.append(_repair_replay_error("backend_kind_not_supported", "Isolated desktop L1 evidence requires a supported real backend kind.", "$.backendKind", expected=sorted(ALLOWED_L1_BACKEND_KINDS), actual=evidence.get("backendKind")))
    if evidence.get("preflightStatus") != "ready":
        errors.append(_repair_replay_error("preflight_not_ready", "Isolated desktop L1 evidence requires preflightStatus=ready.", "$.preflightStatus", expected="ready", actual=evidence.get("preflightStatus")))
    if evidence.get("inputChannel") != REMOTE_DESKTOP_INPUT_CHANNEL:
        errors.append(_repair_replay_error("input_channel_not_remote_desktop", "L1 smoke evidence must use a remote desktop isolated session input channel.", "$.inputChannel", expected=REMOTE_DESKTOP_INPUT_CHANNEL, actual=evidence.get("inputChannel")))
    if evidence.get("captureSource") != ISOLATED_CAPTURE_SOURCE:
        errors.append(_repair_replay_error("capture_source_not_isolated_display", "L1 smoke evidence must capture from the isolated virtual display.", "$.captureSource", expected=ISOLATED_CAPTURE_SOURCE, actual=evidence.get("captureSource")))
    target_environment_kind = _string_or_none(evidence.get("targetEnvironmentKind")) or ""
    if not target_environment_kind:
        errors.append(_repair_replay_error("target_environment_kind_missing", "targetEnvironmentKind is required.", "$.targetEnvironmentKind"))
    elif target_environment_kind != TARGET_ENVIRONMENT_KIND:
        errors.append(_repair_replay_error("target_environment_kind_not_isolated_desktop", "L1 smoke evidence must use the shared Linux isolated desktop target environment kind.", "$.targetEnvironmentKind", expected=TARGET_ENVIRONMENT_KIND, actual=target_environment_kind))
    if target_environment_kind and _target_environment_is_package_or_diagnostic(target_environment_kind):
        errors.append(_repair_replay_error("target_environment_kind_not_real_backend", "L1 smoke evidence cannot use package-owned, diagnostic, fixture, mock, virtual, or state-only target environments.", "$.targetEnvironmentKind", actual=target_environment_kind))
    for key, expected in {
        "inputExecuted": True,
        "executeFailClosed": False,
        "osInputExecuted": False,
        "realOsInputExecuted": False,
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
        "realWindowEvidence": True,
        "diagnosticOnly": False,
        "rawPayloadWritten": False,
        "inlineImageWritten": False,
        "secretsWritten": False,
    }.items():
        if evidence.get(key) is not expected:
            errors.append(_repair_replay_error(
                "l1_flag_mismatch",
                f"Isolated desktop L1 evidence requires {key}={str(expected).lower()}.",
                f"$.{key}",
                expected=expected,
                actual=evidence.get(key),
            ))
    l1_smoke = _mapping(evidence.get("l1Smoke"))
    if l1_smoke.get("status") != "completed":
        errors.append(_repair_replay_error("l1_smoke_status_not_completed", "l1Smoke.status must be completed.", "$.l1Smoke.status", expected="completed", actual=l1_smoke.get("status")))
    if l1_smoke.get("completed") is not True:
        errors.append(_repair_replay_error("l1_smoke_not_completed", "l1Smoke.completed must be true.", "$.l1Smoke.completed", expected=True, actual=l1_smoke.get("completed")))
    if l1_smoke.get("screenChanged") is not True:
        errors.append(_repair_replay_error("l1_screen_change_not_verified", "l1Smoke.screenChanged must be true.", "$.l1Smoke.screenChanged", expected=True, actual=l1_smoke.get("screenChanged")))


def _validate_refs_and_viewer(
    evidence: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    require_existing_refs: bool,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> None:
    for key in (
        "preflightRef",
        "resultRef",
        "viewerManifestRef",
        "viewerHtmlRef",
        "backendReadinessProofRef",
        "executorCommandEventLogRef",
        "targetWindowRef",
        "windowBoundPointerProofRef",
        "processRef",
        "resourceAllocationRef",
        *REQUIRED_L1_SESSION_REFS,
        *REQUIRED_L1_LEDGER_REFS,
    ):
        if not _string_or_none(evidence.get(key)):
            errors.append(_repair_replay_error("required_ref_missing", f"{key} is required for L1 smoke evidence.", f"$.{key}"))
    trace_refs = _refs_from_explicit_list(evidence.get("traceRefs"))
    if not trace_refs:
        errors.append(_repair_replay_error("trace_refs_missing", "traceRefs are required.", "$.traceRefs"))
    screenshot_refs = _refs_from_explicit_list(evidence.get("screenshotRefs"))
    if len(screenshot_refs) < 2:
        errors.append(_repair_replay_error("screenshot_refs_too_few", "L1 smoke evidence requires at least before and after screenshot refs.", "$.screenshotRefs", expected=">=2", actual=len(screenshot_refs)))
    initial_screenshot_ref = _string_or_none(evidence.get("initialScreenshotRef"))
    final_screenshot_ref = _string_or_none(evidence.get("finalScreenshotRef"))
    if not initial_screenshot_ref:
        errors.append(_repair_replay_error("initial_screenshot_ref_missing", "initialScreenshotRef is required.", "$.initialScreenshotRef"))
    if not final_screenshot_ref:
        errors.append(_repair_replay_error("final_screenshot_ref_missing", "finalScreenshotRef is required.", "$.finalScreenshotRef"))
    if initial_screenshot_ref and final_screenshot_ref and initial_screenshot_ref == final_screenshot_ref:
        errors.append(_repair_replay_error("screenshot_refs_not_distinct", "Initial and final screenshot refs must be distinct current observations.", "$"))
    if final_screenshot_ref and not _looks_like_screenshot_ref(final_screenshot_ref):
        errors.append(_repair_replay_error("final_visual_ref_missing", "finalScreenshotRef must be a screenshot ref.", "$.finalScreenshotRef", actual=final_screenshot_ref))
    if initial_screenshot_ref and not _looks_like_screenshot_ref(initial_screenshot_ref):
        errors.append(_repair_replay_error("initial_visual_ref_missing", "initialScreenshotRef must be a screenshot ref.", "$.initialScreenshotRef", actual=initial_screenshot_ref))
    for ref in (initial_screenshot_ref, final_screenshot_ref):
        if ref and ref not in screenshot_refs:
            errors.append(_repair_replay_error("screenshot_ref_not_listed", "Initial and final screenshot refs must be present in screenshotRefs.", "$.screenshotRefs", actual=ref))
            break
    if require_existing_refs:
        _validate_screenshot_content_change(
            initial_screenshot_ref,
            final_screenshot_ref,
            errors,
            resolver=resolver,
        )
    if not _input_event_log_refs(evidence):
        errors.append(_repair_replay_error("input_event_log_refs_missing", "L1 smoke evidence requires input event log refs.", "$"))
    filesystem_root_ref = _string_or_none(evidence.get("filesystemRootRef"))
    if require_existing_refs and filesystem_root_ref and not Path(filesystem_root_ref).expanduser().is_dir():
        errors.append(_repair_replay_error("filesystem_root_ref_not_directory", "filesystemRootRef must point to an existing local directory.", "$.filesystemRootRef", actual=filesystem_root_ref))
    if require_existing_refs:
        _validate_preflight_payload(evidence, errors, resolver=resolver)
        _validate_session_ref_payload_schemas(evidence, errors, resolver=resolver)
        _validate_backend_readiness_proof(evidence, errors, resolver=resolver)
        _validate_runtime_substrate_refs(evidence, errors, resolver=resolver)

    viewer_manifest_ref = _string_or_none(evidence.get("viewerManifestRef"))
    if viewer_manifest_ref:
        try:
            viewer_payload, _ = _load_repair_mapping_with_ref(
                _resolve_ref_or_value(viewer_manifest_ref, resolver=resolver),
                resolver=None,
            )
            viewer_validation = validate_visible_run_viewer_manifest(
                _resolve_ref_or_value(viewer_manifest_ref, resolver=resolver),
                require_existing_refs=require_existing_refs,
            )
        except (OSError, json.JSONDecodeError, TypeError, ValueError) as exc:
            errors.append(_repair_replay_error("viewer_manifest_unreadable", f"Viewer manifest could not be loaded: {exc}.", "$.viewerManifestRef", actual=viewer_manifest_ref))
        else:
            if not viewer_validation.get("ok"):
                errors.append(_repair_replay_error("viewer_manifest_invalid", "Visible run viewer manifest must validate for L1 smoke evidence.", "$.viewerManifestRef", actual=viewer_validation.get("errors")))
            frame_counts = _mapping(viewer_validation.get("frameCounts"))
            screenshot_count = _int_or_none(frame_counts.get("screenshot")) or 0
            if screenshot_count < 2:
                errors.append(_repair_replay_error("viewer_real_frames_too_few", "L1 smoke evidence requires at least two real screenshot viewer frames; placeholders alone are diagnostic.", "$.viewerManifestRef", expected=">=2", actual=screenshot_count))
            viewer_screenshot_refs = _viewer_screenshot_refs(viewer_payload)
            missing_viewer_refs = [
                ref
                for ref in (initial_screenshot_ref, final_screenshot_ref)
                if ref and ref not in viewer_screenshot_refs
            ]
            if missing_viewer_refs:
                errors.append(_repair_replay_error(
                    "viewer_initial_final_frames_missing",
                    "L1 viewer frames must include the initial and final screenshot refs.",
                    "$.viewerManifestRef",
                    actual=missing_viewer_refs,
                ))


def _validate_preflight_payload(
    evidence: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> None:
    preflight = _load_l1_payload_ref(
        _string_or_none(evidence.get("preflightRef")),
        resolver=resolver,
        kind="preflight",
        errors=errors,
    )
    if preflight is None:
        return
    validate_isolated_desktop_backend_preflight_payload(
        preflight,
        errors,
        tier_label="L1",
        allow_diagnostic_only=True,
        require_acceptance_eligible=False,
    )


def _validate_runtime_substrate_refs(
    evidence: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> None:
    readiness = _load_l1_payload_ref(
        _string_or_none(evidence.get("backendReadinessProofRef")),
        resolver=resolver,
        kind="backend_readiness_proof",
        errors=errors,
    )
    expected_display = _expected_l1_display(evidence, readiness, resolver=resolver)
    expected_session_id = _expected_l1_session_id(evidence, resolver=resolver)
    expected_vnc_port = _int_or_none(_mapping(readiness).get("vncPort")) or _int_or_none(_mapping(_mapping(readiness).get("vnc")).get("port"))
    expected_novnc_port = _int_or_none(_mapping(readiness).get("novncPort")) or _int_or_none(_mapping(_mapping(readiness).get("novnc")).get("port"))

    process_payload = _load_l1_payload_ref(
        _string_or_none(evidence.get("processRef")),
        resolver=resolver,
        kind="process",
        errors=errors,
    )
    if process_payload is not None:
        validate_backend_process_payload(
            evidence_process_ref=_string_or_none(evidence.get("processRef")),
            readiness_payload=readiness,
            process_payload=process_payload,
            errors=errors,
            expected_display=expected_display,
            expected_session_id=expected_session_id,
            required_process_roles=REQUIRED_L1_RUNTIME_PROCESS_ROLES,
            require_existing_log_refs=True,
            resolver=resolver,
        )

    allocation_payload = _load_l1_payload_ref(
        _string_or_none(evidence.get("resourceAllocationRef")),
        resolver=resolver,
        kind="resource_allocation",
        errors=errors,
    )
    if allocation_payload is not None:
        validate_runtime_resource_allocation_payload(
            allocation_payload,
            errors,
            expected_display=expected_display,
            expected_session_id=expected_session_id,
            expected_vnc_port=expected_vnc_port,
            expected_novnc_port=expected_novnc_port,
        )


def _expected_l1_display(
    evidence: Mapping[str, Any],
    readiness: Mapping[str, Any] | None,
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> str | None:
    for ref_key in ("virtualDisplayRef",):
        payload = _load_l1_payload_ref(_string_or_none(evidence.get(ref_key)), resolver=resolver, kind=ref_key, errors=[])
        display = _runtime_display_id(payload)
        if display:
            return display
    return _runtime_display_id(readiness)


def _expected_l1_session_id(
    evidence: Mapping[str, Any],
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> str | None:
    for ref_key in ("sessionManifestRef", "virtualDisplayRef"):
        payload = _load_l1_payload_ref(_string_or_none(evidence.get(ref_key)), resolver=resolver, kind=ref_key, errors=[])
        session_id = _runtime_session_id(payload or {})
        if session_id:
            return session_id
    return None


def _validate_workflow(
    evidence: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> None:
    result = _load_l1_payload_ref(_string_or_none(evidence.get("resultRef")), resolver=resolver, kind="result", errors=errors)
    traces = [
        trace
        for trace_ref in _refs_from_explicit_list(evidence.get("traceRefs"))
        if (trace := _load_l1_payload_ref(trace_ref, resolver=resolver, kind="trace", errors=errors)) is not None
    ]
    if result is None:
        errors.append(_repair_replay_error("workflow_result_ref_unreadable", "L1 smoke evidence requires a readable resultRef.", "$.resultRef", actual=evidence.get("resultRef")))
    elif result.get("status") != "completed":
        errors.append(_repair_replay_error("workflow_result_not_completed", "L1 resultRef must resolve to a completed result.", "$.resultRef.status", expected="completed", actual=result.get("status")))
    if not traces:
        errors.append(_repair_replay_error("workflow_trace_refs_unreadable", "L1 smoke evidence requires at least one readable traceRef.", "$.traceRefs", actual=evidence.get("traceRefs")))
    for index, trace in enumerate(traces):
        if trace.get("status") != "completed":
            errors.append(_repair_replay_error("workflow_trace_not_completed", "L1 traceRefs must resolve to completed trace evidence.", f"$.traceRefs[{index}].status", expected="completed", actual=trace.get("status")))
    workflow_payloads = [payload for payload in [evidence, result, *traces] if isinstance(payload, Mapping)]
    steps = _steps_from_result_or_trace(result, traces)
    _validate_final_visible_evidence_consistency(evidence, result, traces, errors)
    requirements = _mapping(evidence.get("workflowRequirements"))
    minimum_action_count = _int_or_none(requirements.get("minimumActionCount")) or 4
    if len(steps) < minimum_action_count:
        errors.append(_repair_replay_error("minimum_action_count_not_met", "L1 smoke evidence has fewer action steps than required.", "$.workflowRequirements.minimumActionCount", expected=minimum_action_count, actual=len(steps)))
    if requirements.get("requiresCurrentStepScreenshots") is not True:
        errors.append(_repair_replay_error(
            "workflow_requirement_must_be_true",
            "L1 smoke evidence must require current step screenshots.",
            "$.workflowRequirements.requiresCurrentStepScreenshots",
            expected=True,
            actual=requirements.get("requiresCurrentStepScreenshots"),
        ))
    for index, step in enumerate(steps):
        if _state_changing_step(step) and not _step_current_screenshot_refs(step):
            errors.append(_repair_replay_error("current_step_screenshot_ref_missing", "Each state-changing L1 step must include a current screenshot or observation ref.", f"$.steps[{index}]"))
            break
    _validate_stepwise_screenshot_content_change(steps, errors, resolver=resolver)
    action_summary = _l1_action_summary(steps)
    if not action_summary["openApp"]:
        errors.append(_repair_replay_error("l1_open_app_step_missing", "L1 smoke workflow must include a generic open_app step for a real GUI app.", "$.steps"))
    if len(action_summary["pointerActionIndexes"]) < 2:
        errors.append(_repair_replay_error("l1_pointer_steps_missing", "L1 smoke workflow must include at least two pointer actions: input focus/click and button/control click.", "$.steps", expected=">=2", actual=len(action_summary["pointerActionIndexes"])))
    if not action_summary["typedText"]:
        errors.append(_repair_replay_error("l1_type_text_step_missing", "L1 smoke workflow must type text through isolated input.", "$.steps"))
    if not _workflow_screen_change_verified(steps, evidence):
        errors.append(_repair_replay_error("l1_screen_change_not_verified", "L1 smoke workflow must verify that the screen changed.", "$.steps"))

    required_modalities = _required_modalities(requirements.get("requiredInputModalities") or ("pointer", "keyboard"))
    event_summary = _l1_input_event_log_summary(workflow_payloads, resolver=resolver)
    errors.extend(event_summary["errors"])
    for modality in required_modalities:
        if modality not in event_summary["modalities"]:
            errors.append(_repair_replay_error("required_input_event_log_missing", "L1 smoke evidence is missing required input event modality.", "$.workflowRequirements.requiredInputModalities", expected=modality, actual=sorted(event_summary["modalities"])))
            break
        expected_indexes = action_summary[f"{modality}ActionIndexes"]
        observed_indexes = event_summary["actionIndexesByModality"].get(modality, set())
        if expected_indexes and not expected_indexes.issubset(observed_indexes):
            errors.append(_repair_replay_error("required_input_event_action_index_missing", "L1 input event logs must reference every action index that exercised the required modality.", "$.workflowRequirements.requiredInputModalities", expected=sorted(expected_indexes), actual=sorted(observed_indexes)))
            break
    _validate_input_command_provenance(
        evidence,
        workflow_payloads,
        action_summary=action_summary,
        errors=errors,
        resolver=resolver,
    )
    if requirements.get("forbidPriorRoundCompletionEvidence") is not True:
        errors.append(_repair_replay_error(
            "workflow_requirement_must_be_true",
            "L1 smoke evidence must forbid prior-round completion evidence.",
            "$.workflowRequirements.forbidPriorRoundCompletionEvidence",
            expected=True,
            actual=requirements.get("forbidPriorRoundCompletionEvidence"),
        ))
    for issue in _prior_round_completion_evidence_issues(workflow_payloads):
        errors.append(_repair_replay_error("prior_round_completion_evidence_forbidden", issue, "$"))
        break


def _validate_evidence_ledger(
    evidence: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> None:
    log_ref = _string_or_none(evidence.get("evidenceLogRef"))
    index_ref = _string_or_none(evidence.get("evidenceIndexRef"))
    snapshot_ref = _string_or_none(evidence.get("evidenceSnapshotRef"))
    planner_ref = _string_or_none(evidence.get("plannerBriefRef"))
    if not all([log_ref, index_ref, snapshot_ref, planner_ref]):
        return
    try:
        records = _load_evidence_records(log_ref, resolver=resolver)
        index = _load_json_mapping(index_ref, resolver=resolver)
        snapshot = _load_json_mapping(snapshot_ref, resolver=resolver)
        planner = _load_json_mapping(planner_ref, resolver=resolver)
    except (OSError, json.JSONDecodeError, TypeError, UnicodeDecodeError) as exc:
        errors.append(_repair_replay_error("evidence_ledger_unreadable", f"L1 evidence ledger refs could not be loaded: {exc}.", "$"))
        return
    if index.get("schemaVersion") != "sciforge.computer-use.evidence-index.v1":
        errors.append(_repair_replay_error("evidence_index_schema_invalid", "evidenceIndexRef must resolve to an evidence index.", "$.evidenceIndexRef", actual=index.get("schemaVersion")))
    if snapshot.get("schemaVersion") != "sciforge.computer-use.evidence-snapshot.v1":
        errors.append(_repair_replay_error("evidence_snapshot_schema_invalid", "evidenceSnapshotRef must resolve to an evidence snapshot.", "$.evidenceSnapshotRef", actual=snapshot.get("schemaVersion")))
    if planner.get("schemaVersion") != "sciforge.computer-use.planner-brief.v1":
        errors.append(_repair_replay_error("planner_brief_schema_invalid", "plannerBriefRef must resolve to a planner brief.", "$.plannerBriefRef", actual=planner.get("schemaVersion")))
    current_ids = set(_refs_from_explicit_list(index.get("current")))
    completion_claims = [
        record
        for record in records
        if record.get("type") == "completion-claim" and record.get("id") in current_ids
    ]
    if not completion_claims:
        errors.append(_repair_replay_error("current_completion_claim_missing", "L1 evidence ledger requires a current completion-claim.", "$.evidenceLogRef"))
        return
    latest_claim = completion_claims[-1]
    support_ids = _refs_from_explicit_list(latest_claim.get("supports"))
    if not support_ids:
        errors.append(_repair_replay_error("completion_claim_supports_missing", "L1 completion-claim must support current evidence ids.", "$.evidenceLogRef"))
    stale_supports = [support_id for support_id in support_ids if support_id not in current_ids]
    if stale_supports:
        errors.append(_repair_replay_error("completion_claim_supports_stale_evidence", "L1 completion-claim cannot support stale evidence records.", "$.evidenceLogRef", actual=stale_supports))
    final_ref = _string_or_none(evidence.get("finalScreenshotRef"))
    current_final_observations = [
        record
        for record in records
        if record.get("type") == "observation"
        and record.get("id") in current_ids
        and _string_or_none(record.get("ref")) == final_ref
    ]
    if final_ref and not current_final_observations:
        errors.append(_repair_replay_error("final_observation_not_current", "finalScreenshotRef must be represented by a current observation record in the evidence ledger.", "$.finalScreenshotRef", actual=final_ref))
    final_observation_ids = [
        str(record.get("id"))
        for record in current_final_observations
        if _string_or_none(record.get("id"))
    ]
    if final_observation_ids and set(final_observation_ids).isdisjoint(support_ids):
        errors.append(_repair_replay_error(
            "completion_claim_missing_final_observation_support",
            "L1 completion-claim must directly support the current final screenshot observation.",
            "$.evidenceLogRef",
            expected=final_observation_ids,
            actual=support_ids,
        ))


def _validation_result(
    evidence: Mapping[str, Any] | None,
    *,
    evidence_ref: str | None,
    errors: list[dict[str, Any]],
    require_existing_refs: bool,
) -> dict[str, Any]:
    return {
        "schemaVersion": ISOLATED_DESKTOP_L1_SMOKE_EVIDENCE_VALIDATION_SCHEMA_VERSION,
        "ok": not errors,
        "evidenceRef": evidence_ref,
        "status": evidence.get("status") if evidence else None,
        "errors": errors,
        "warnings": [],
        "requireExistingRefs": bool(require_existing_refs),
        "acceptanceTier": evidence.get("acceptanceTier") if evidence else None,
        "backendKind": evidence.get("backendKind") if evidence else None,
        "targetEnvironmentKind": evidence.get("targetEnvironmentKind") if evidence else None,
        "inputChannel": evidence.get("inputChannel") if evidence else None,
        "preflightStatus": evidence.get("preflightStatus") if evidence else None,
        "resultRef": evidence.get("resultRef") if evidence else None,
        "traceRefs": _refs_from_explicit_list(evidence.get("traceRefs")) if evidence else [],
        "screenshotRefs": _refs_from_explicit_list(evidence.get("screenshotRefs")) if evidence else [],
        "viewerManifestRef": evidence.get("viewerManifestRef") if evidence else None,
        "evidenceLogRef": evidence.get("evidenceLogRef") if evidence else None,
        "inputExecuted": evidence.get("inputExecuted") if evidence else None,
        "realWindowEvidence": evidence.get("realWindowEvidence") if evidence else None,
        "diagnosticOnly": evidence.get("diagnosticOnly") if evidence else None,
        "userAcceptanceEligible": evidence.get("userAcceptanceEligible") if evidence else None,
    }




































































































def _all_required_refs(evidence: Mapping[str, Any]) -> list[str]:
    refs = [
        *[
            str(evidence.get(key))
            for key in (
                "preflightRef",
                "resultRef",
                "viewerManifestRef",
                "viewerHtmlRef",
                "backendReadinessProofRef",
                "executorCommandEventLogRef",
                "processRef",
                "resourceAllocationRef",
                *[ref_key for ref_key in REQUIRED_L1_SESSION_REFS if ref_key != "filesystemRootRef"],
                *REQUIRED_L1_LEDGER_REFS,
            )
            if _string_or_none(evidence.get(key))
        ],
        *_refs_from_explicit_list(evidence.get("traceRefs")),
        *_refs_from_explicit_list(evidence.get("screenshotRefs")),
        *_input_event_log_refs(evidence),
        *_refs_from_explicit_list(evidence.get("realWindowEvidenceRefs")),
    ]
    return _unique_strings(refs)










__all__ = [
    "ALLOWED_L1_BACKEND_KINDS",
    "BACKEND_READINESS_PROOF_SCHEMA_VERSION",
    "EXECUTOR_COMMAND_EVENT_LOG_SCHEMA",
    "ISOLATED_CAPTURE_SOURCE",
    "ISOLATED_DESKTOP_L1_SMOKE_EVIDENCE_SCHEMA_VERSION",
    "ISOLATED_DESKTOP_L1_SMOKE_EVIDENCE_VALIDATION_SCHEMA_VERSION",
    "L1_ACCEPTANCE_TIER",
    "REQUIRED_L1_RUNTIME_PROCESS_ROLES",
    "REMOTE_DESKTOP_INPUT_CHANNEL",
    "build_isolated_desktop_l1_smoke_evidence",
    "validate_isolated_desktop_l1_smoke_evidence",
]
