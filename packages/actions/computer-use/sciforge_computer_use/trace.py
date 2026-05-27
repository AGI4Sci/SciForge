"""Trace serialization and validation helpers for Computer Use results."""

from __future__ import annotations

import json
from dataclasses import fields, is_dataclass
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Sequence

from .contracts import ComputerUseResult

TRACE_SCHEMA_VERSION = "sciforge.computer-use.loop-trace.v1"
TRACE_VALIDATION_SCHEMA_VERSION = "sciforge.computer-use.trace-validation.v1"
REPAIR_REPLAY_EVIDENCE_SCHEMA_VERSION = "sciforge.computer-use.repair-replay-evidence.v1"
REPAIR_REPLAY_EVIDENCE_VALIDATION_SCHEMA_VERSION = "sciforge.computer-use.repair-replay-evidence-validation.v1"
VIEWPORT_RECOVERY_EVIDENCE_SCHEMA_VERSION = "sciforge.computer-use.viewport-recovery-evidence.v1"
VIEWPORT_RECOVERY_EVIDENCE_VALIDATION_SCHEMA_VERSION = "sciforge.computer-use.viewport-recovery-evidence-validation.v1"


def result_to_trace(result: ComputerUseResult) -> dict[str, Any]:
    """Return a file-ref-only trace dictionary."""

    screenshot_refs, artifact_refs = _promoted_result_refs(result)
    final_artifact_refs = _promoted_final_artifact_refs(result)
    trace = {
        "schemaVersion": TRACE_SCHEMA_VERSION,
        "resultSchemaVersion": result.schema_version,
        "status": result.status,
        "reason": result.reason,
        "approvalRequest": _compact_dataclass(result.approval_request),
        "metrics": dict(result.metrics),
        "failureDiagnostics": dict(result.failure_diagnostics),
        "finalObservationRef": result.final_observation.ref if result.final_observation else None,
        "traceRefs": list(result.trace_refs),
        "screenshotRefs": screenshot_refs,
        "artifactRefs": artifact_refs,
        "finalArtifactRef": final_artifact_refs[0] if final_artifact_refs else None,
        "finalArtifactRefs": final_artifact_refs,
        "steps": [_step_to_trace(step) for step in result.steps],
        "budgetDebits": [dict(debit) for debit in result.budget_debits],
        "budgetDebitRefs": list(result.budget_debit_refs),
    }
    _reject_inline_payloads(trace)
    return trace


def compact_result_for_handoff(result: ComputerUseResult) -> dict[str, Any]:
    """Build a compact handoff block for upper-level agents."""

    trace = result_to_trace(result)
    refs = _unique_strings([
        *trace["screenshotRefs"],
        *trace["artifactRefs"],
        *trace["finalArtifactRefs"],
        *trace["traceRefs"],
    ])
    return {
        "schemaVersion": "sciforge.computer-use.compact-handoff.v1",
        "status": result.status,
        "reason": result.reason,
        "refs": refs,
        "traceRefs": trace["traceRefs"],
        "screenshotRefs": trace["screenshotRefs"],
        "artifactRefs": trace["artifactRefs"],
        "finalArtifactRef": trace.get("finalArtifactRef"),
        "finalArtifactRefs": trace["finalArtifactRefs"],
        "actions": [
            {
                "index": step["index"],
                "kind": step.get("action", {}).get("kind"),
                "target": step.get("action", {}).get("target"),
                "status": step.get("status"),
                "verification": step.get("verification"),
                "screenshotRefs": step.get("screenshotRefs", []),
                "artifactRefs": step.get("artifactRefs", []),
                "budgetDebitRefs": list(step.get("budgetDebitRefs", [])),
            }
            for step in trace["steps"]
        ],
        "failureDiagnostics": trace["failureDiagnostics"],
        "approvalRequest": trace.get("approvalRequest"),
        "budgetDebits": trace["budgetDebits"],
        "budgetDebitRefs": trace["budgetDebitRefs"],
    }


def compact_result(result: ComputerUseResult) -> dict[str, Any]:
    """Public README-aligned shim for compact result handoff."""

    return compact_result_for_handoff(result)


def build_repair_replay_evidence(
    failure_manifest_or_ref: Mapping[str, Any] | str | Path,
    replay_result_or_ref: Mapping[str, Any] | str | Path,
    replay_trace_or_ref: Mapping[str, Any] | str | Path | None = None,
    *,
    replay_result_ref_override: str | None = None,
) -> dict[str, Any]:
    """Build refs-first evidence linking a failure manifest to a repaired replay."""

    failure_manifest, failure_ref = _load_mapping_with_ref(failure_manifest_or_ref)
    replay_result, loaded_replay_result_ref = _load_mapping_with_ref(replay_result_or_ref)
    replay_trace: Mapping[str, Any] = {}
    replay_trace_ref: str | None = None
    if replay_trace_or_ref is not None:
        replay_trace, replay_trace_ref = _load_mapping_with_ref(replay_trace_or_ref)

    locate_failure = _first_mapping(
        failure_manifest.get("locateFailures"),
        _mapping(failure_manifest.get("failureDiagnostics")).get("virtualDesktopLocateFailures"),
    )
    before_candidate_ids = _candidate_ids(locate_failure.get("matches") if locate_failure else None)
    replay_step = _first_replay_step_with_grounding(replay_result.get("steps"))
    replay_action = _mapping(replay_step.get("action")) if replay_step else {}
    replay_grounding = _mapping(replay_step.get("grounding")) if replay_step else {}
    replay_grounding_metadata = _mapping(replay_grounding.get("metadata"))
    selected_element_id = _string_or_none(replay_grounding_metadata.get("elementId"))
    before_match_count = _int_or_none(locate_failure.get("matchCount") if locate_failure else None)
    after_match_count = _int_or_none(replay_grounding_metadata.get("matchCount"))
    selected_was_candidate = bool(selected_element_id and selected_element_id in before_candidate_ids)
    replay_trace_refs = _unique_strings([
        *_refs_from_explicit_list(replay_result.get("traceRefs")),
        *_refs_from_explicit_list(replay_trace.get("traceRefs")),
        *([replay_trace_ref] if replay_trace_ref else []),
    ])
    real_window_evidence = bool(
        _mapping(failure_manifest.get("failureDiagnostics")).get("realWindowEvidence")
        or _mapping(replay_result.get("failureDiagnostics")).get("realWindowEvidence")
    )
    evidence = {
        "schemaVersion": REPAIR_REPLAY_EVIDENCE_SCHEMA_VERSION,
        "status": "completed",
        "reason": "",
        "sourceFailureManifestRef": failure_ref,
        "replayResultRef": replay_result_ref_override or loaded_replay_result_ref,
        "replayTraceRefs": replay_trace_refs,
        "failedStage": failure_manifest.get("failedStage") or _mapping(failure_manifest.get("failureDiagnostics")).get("failedStage"),
        "originalTargetDescription": locate_failure.get("targetDescription") if locate_failure else None,
        "beforeMatchCount": before_match_count,
        "beforeCandidateElementIds": before_candidate_ids,
        "replayedTargetDescription": replay_action.get("target"),
        "afterMatchCount": after_match_count,
        "selectedElementId": selected_element_id,
        "selectedElementWasFailedCandidate": selected_was_candidate,
        "realWindowEvidence": real_window_evidence,
        "diagnosticOnly": not real_window_evidence,
    }
    validation = validate_repair_replay_evidence(evidence)
    evidence["status"] = "completed" if validation["ok"] else "blocked"
    evidence["reason"] = (
        "Repair replay selected one prior failed candidate."
        if validation["ok"]
        else "; ".join(error["message"] for error in validation["errors"])
    )
    evidence["errors"] = validation["errors"]
    return evidence


def validate_repair_replay_evidence(
    evidence_or_ref: Mapping[str, Any] | str | Path,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None = None,
    *,
    require_existing_refs: bool = False,
) -> dict[str, Any]:
    """Validate a repair replay evidence record without reading raw payloads."""

    try:
        evidence, evidence_ref = _load_repair_mapping_with_ref(evidence_or_ref, resolver=resolver)
    except (OSError, json.JSONDecodeError, TypeError) as exc:
        return {
            "schemaVersion": REPAIR_REPLAY_EVIDENCE_VALIDATION_SCHEMA_VERSION,
            "ok": False,
            "evidenceRef": str(evidence_or_ref),
            "status": None,
            "errors": [
                _repair_replay_error(
                    "evidence_load_failed",
                    f"Repair replay evidence could not be loaded: {exc}.",
                    "$",
                )
            ],
            "warnings": [],
            "sourceFailureManifestRef": None,
            "replayResultRef": None,
            "replayTraceRefs": [],
            "beforeMatchCount": None,
            "afterMatchCount": None,
            "selectedElementId": None,
            "selectedElementWasFailedCandidate": None,
            "realWindowEvidence": None,
            "diagnosticOnly": None,
        }

    errors: list[dict[str, Any]] = []
    if evidence.get("schemaVersion") != REPAIR_REPLAY_EVIDENCE_SCHEMA_VERSION:
        errors.append(_repair_replay_error(
            "unsupported_schema_version",
            "Repair replay evidence schemaVersion is invalid.",
            "$.schemaVersion",
            expected=REPAIR_REPLAY_EVIDENCE_SCHEMA_VERSION,
            actual=evidence.get("schemaVersion"),
        ))
    if evidence.get("status") != "completed":
        errors.append(_repair_replay_error(
            "status_not_completed",
            "Repair replay evidence status must be completed.",
            "$.status",
            expected="completed",
            actual=evidence.get("status"),
        ))
    if not _string_or_none(evidence.get("sourceFailureManifestRef")):
        errors.append(_repair_replay_error(
            "source_failure_manifest_ref_missing",
            "Source failure manifest ref is missing.",
            "$.sourceFailureManifestRef",
        ))
    if not _string_or_none(evidence.get("replayResultRef")):
        errors.append(_repair_replay_error(
            "replay_result_ref_missing",
            "Replay result ref is missing.",
            "$.replayResultRef",
        ))
    if not _string_or_none(evidence.get("failedStage")):
        errors.append(_repair_replay_error(
            "failed_stage_missing",
            "failedStage is missing.",
            "$.failedStage",
        ))
    before_match_count = _int_or_none(evidence.get("beforeMatchCount"))
    after_match_count = _int_or_none(evidence.get("afterMatchCount"))
    selected_element_id = _string_or_none(evidence.get("selectedElementId"))
    candidate_ids_value = evidence.get("beforeCandidateElementIds")
    candidate_ids = _candidate_id_list(candidate_ids_value)
    replay_trace_refs = _refs_from_explicit_list(evidence.get("replayTraceRefs"))
    if before_match_count is None:
        errors.append(_repair_replay_error(
            "before_match_count_missing",
            "Source failure beforeMatchCount is missing.",
            "$.beforeMatchCount",
        ))
    elif before_match_count <= 1:
        errors.append(_repair_replay_error(
            "before_match_count_not_ambiguous",
            "Source failure was not an ambiguous multi-match failure.",
            "$.beforeMatchCount",
            expected=">1",
            actual=before_match_count,
        ))
    if not isinstance(candidate_ids_value, (list, tuple)):
        errors.append(_repair_replay_error(
            "before_candidate_ids_invalid",
            "Source failure candidate element ids must be a list.",
            "$.beforeCandidateElementIds",
            expected="list[str]",
            actual=type(candidate_ids_value).__name__,
        ))
    elif not candidate_ids:
        errors.append(_repair_replay_error(
            "before_candidate_ids_missing",
            "Source failure candidate element ids are missing.",
            "$.beforeCandidateElementIds",
        ))
    if after_match_count is None:
        errors.append(_repair_replay_error(
            "after_match_count_missing",
            "Replay evidence must include explicit afterMatchCount=1.",
            "$.afterMatchCount",
            expected=1,
            actual=None,
        ))
    elif after_match_count != 1:
        errors.append(_repair_replay_error(
            "after_match_count_not_single",
            "Replay did not reduce grounding to a single selected element.",
            "$.afterMatchCount",
            expected=1,
            actual=after_match_count,
        ))
    if not selected_element_id:
        errors.append(_repair_replay_error(
            "selected_element_id_missing",
            "Replay result has no selected element id.",
            "$.selectedElementId",
        ))
    if selected_element_id and selected_element_id not in candidate_ids:
        errors.append(_repair_replay_error(
            "selected_element_not_failed_candidate",
            "Replay selected element was not one of the failed candidates.",
            "$.selectedElementId",
            expected="one of beforeCandidateElementIds",
            actual=selected_element_id,
        ))
    if evidence.get("selectedElementWasFailedCandidate") is not True:
        errors.append(_repair_replay_error(
            "selected_element_membership_flag_not_true",
            "selectedElementWasFailedCandidate must be true.",
            "$.selectedElementWasFailedCandidate",
            expected=True,
            actual=evidence.get("selectedElementWasFailedCandidate"),
        ))
    if not replay_trace_refs:
        errors.append(_repair_replay_error(
            "replay_trace_refs_missing",
            "Replay trace refs are missing.",
            "$.replayTraceRefs",
        ))
    real_window_evidence = evidence.get("realWindowEvidence")
    diagnostic_only = evidence.get("diagnosticOnly")
    if not isinstance(real_window_evidence, bool):
        errors.append(_repair_replay_error(
            "real_window_evidence_missing",
            "realWindowEvidence must be an explicit boolean.",
            "$.realWindowEvidence",
            expected="boolean",
            actual=real_window_evidence,
        ))
    if not isinstance(diagnostic_only, bool):
        errors.append(_repair_replay_error(
            "diagnostic_only_missing",
            "diagnosticOnly must be an explicit boolean.",
            "$.diagnosticOnly",
            expected="boolean",
            actual=diagnostic_only,
        ))
    if real_window_evidence is True and diagnostic_only is True:
        errors.append(_repair_replay_error(
            "real_window_flags_inconsistent",
            "Evidence cannot be both real-window evidence and diagnostic-only.",
            "$",
        ))
    if real_window_evidence is False and diagnostic_only is False:
        errors.append(_repair_replay_error(
            "real_window_flags_inconsistent",
            "Evidence with realWindowEvidence=false must remain diagnostic-only.",
            "$",
        ))
    real_window_evidence_refs = _refs_from_explicit_list(evidence.get("realWindowEvidenceRefs"))
    target_binding_validation = _mapping(evidence.get("targetBindingValidation"))
    if real_window_evidence is True:
        if not real_window_evidence_refs:
            errors.append(_repair_replay_error(
                "real_window_evidence_refs_missing",
                "Real-window repair replay evidence must include explicit realWindowEvidenceRefs.",
                "$.realWindowEvidenceRefs",
            ))
        errors.extend(_real_window_target_binding_validation_errors(
            target_binding_validation,
            context="repair replay",
        ))
    if require_existing_refs:
        errors.extend(_existing_ref_errors(
            [
                evidence.get("sourceFailureManifestRef"),
                evidence.get("replayResultRef"),
                *replay_trace_refs,
                *real_window_evidence_refs,
                target_binding_validation.get("adapterManifestRef"),
                target_binding_validation.get("targetWindowRef"),
                *_refs_from_explicit_list(target_binding_validation.get("evidenceRefs")),
            ],
        ))
    for issue in _inline_payload_issues(evidence):
        errors.append(_repair_replay_error("inline_payload_forbidden", issue, "$"))
    return {
        "schemaVersion": REPAIR_REPLAY_EVIDENCE_VALIDATION_SCHEMA_VERSION,
        "ok": not errors,
        "evidenceRef": evidence_ref,
        "status": evidence.get("status"),
        "errors": errors,
        "warnings": [],
        "sourceFailureManifestRef": evidence.get("sourceFailureManifestRef"),
        "replayResultRef": evidence.get("replayResultRef"),
        "replayTraceRefs": replay_trace_refs,
        "realWindowEvidenceRefs": real_window_evidence_refs,
        "targetBindingValidation": target_binding_validation,
        "selectedElementId": selected_element_id,
        "selectedElementWasFailedCandidate": evidence.get("selectedElementWasFailedCandidate"),
        "beforeMatchCount": before_match_count,
        "afterMatchCount": after_match_count,
        "diagnosticOnly": diagnostic_only,
        "realWindowEvidence": real_window_evidence,
    }


def build_viewport_recovery_evidence(
    failure_manifest_or_ref: Mapping[str, Any] | str | Path,
    replay_result_or_ref: Mapping[str, Any] | str | Path,
    replay_trace_or_ref: Mapping[str, Any] | str | Path | None = None,
    *,
    replay_result_ref_override: str | None = None,
) -> dict[str, Any]:
    """Build refs-first evidence for viewport/offscreen scroll recovery."""

    failure_manifest, failure_ref = _load_mapping_with_ref(failure_manifest_or_ref)
    replay_result, loaded_replay_result_ref = _load_mapping_with_ref(replay_result_or_ref)
    replay_trace: Mapping[str, Any] = {}
    replay_trace_ref: str | None = None
    if replay_trace_or_ref is not None:
        replay_trace, replay_trace_ref = _load_mapping_with_ref(replay_trace_or_ref)

    viewport_failure = _first_mapping(
        failure_manifest.get("viewportFailures"),
        _mapping(failure_manifest.get("failureDiagnostics")).get("virtualDesktopViewportFailures"),
    )
    offscreen_candidate_ids = _candidate_id_list(viewport_failure.get("offscreenCandidateElementIds"))
    if not offscreen_candidate_ids:
        offscreen_candidate_ids = _candidate_ids(viewport_failure.get("offscreenMatches"))
    replay_steps = replay_result.get("steps")
    scroll_step = _first_replay_step_with_action(replay_steps, "scroll")
    selected_step = _first_replay_step_with_grounding(replay_steps)
    selected_grounding = _mapping(selected_step.get("grounding")) if selected_step else {}
    selected_metadata = _mapping(selected_grounding.get("metadata"))
    selected_element_id = _string_or_none(selected_metadata.get("elementId"))
    scroll_action = _mapping(scroll_step.get("action")) if scroll_step else {}
    scroll_execution = _mapping(scroll_step.get("execution")) if scroll_step else {}
    scroll_execution_metadata = _mapping(scroll_execution.get("metadata"))
    state_update = _mapping(scroll_execution_metadata.get("stateUpdate"))
    scroll_delta = _scroll_delta_from_state_update(state_update, scroll_action)
    state_refs_before = _mapping(scroll_execution_metadata.get("stateRefsBefore"))
    state_refs_after = _mapping(scroll_execution_metadata.get("stateRefsAfter")) or _mapping(scroll_execution_metadata.get("stateRefs"))
    replay_trace_refs = _unique_strings([
        *_refs_from_explicit_list(replay_result.get("traceRefs")),
        *_refs_from_explicit_list(replay_trace.get("traceRefs")),
        *([replay_trace_ref] if replay_trace_ref else []),
    ])
    real_window_evidence = bool(
        _mapping(failure_manifest.get("failureDiagnostics")).get("realWindowEvidence")
        or _mapping(replay_result.get("failureDiagnostics")).get("realWindowEvidence")
    )
    evidence = {
        "schemaVersion": VIEWPORT_RECOVERY_EVIDENCE_SCHEMA_VERSION,
        "status": "completed",
        "reason": "",
        "sourceFailureManifestRef": failure_ref,
        "replayResultRef": replay_result_ref_override or loaded_replay_result_ref,
        "replayTraceRefs": replay_trace_refs,
        "failedStage": failure_manifest.get("failedStage") or _mapping(failure_manifest.get("failureDiagnostics")).get("failedStage"),
        "failureClass": viewport_failure.get("failureClass"),
        "targetDescription": viewport_failure.get("targetDescription"),
        "beforeObservationRef": viewport_failure.get("beforeObservationRef"),
        "visibleMatchCount": _int_or_none(viewport_failure.get("visibleMatchCount")),
        "offscreenCandidateElementIds": offscreen_candidate_ids,
        "recoveryAction": {
            "kind": scroll_action.get("kind"),
            "direction": scroll_action.get("direction"),
            "amount": scroll_action.get("amount"),
            "target": scroll_action.get("target"),
        },
        "scrollStateBeforeRef": state_refs_before.get("virtualInputStateRef"),
        "scrollStateAfterRef": state_refs_after.get("virtualInputStateRef"),
        "scrollDelta": scroll_delta,
        "afterObservationRef": selected_step.get("beforeRef") if selected_step else None,
        "afterMatchCount": _int_or_none(selected_metadata.get("matchCount")),
        "selectedElementId": selected_element_id,
        "selectedElementWasOffscreenCandidate": bool(selected_element_id and selected_element_id in offscreen_candidate_ids),
        "realWindowEvidence": real_window_evidence,
        "diagnosticOnly": not real_window_evidence,
    }
    validation = validate_viewport_recovery_evidence(evidence)
    evidence["status"] = "completed" if validation["ok"] else "blocked"
    evidence["reason"] = (
        "Viewport recovery scrolled to one prior offscreen candidate."
        if validation["ok"]
        else "; ".join(error["message"] for error in validation["errors"])
    )
    evidence["errors"] = validation["errors"]
    return evidence


def validate_viewport_recovery_evidence(
    evidence_or_ref: Mapping[str, Any] | str | Path,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None = None,
    *,
    require_existing_refs: bool = False,
) -> dict[str, Any]:
    """Validate refs-first viewport/offscreen recovery evidence."""

    try:
        evidence, evidence_ref = _load_repair_mapping_with_ref(evidence_or_ref, resolver=resolver)
    except (OSError, json.JSONDecodeError, TypeError) as exc:
        return _viewport_recovery_validation_result(
            None,
            evidence_ref=str(evidence_or_ref),
            errors=[_repair_replay_error("evidence_load_failed", f"Viewport recovery evidence could not be loaded: {exc}.", "$")],
        )

    errors: list[dict[str, Any]] = []
    if evidence.get("schemaVersion") != VIEWPORT_RECOVERY_EVIDENCE_SCHEMA_VERSION:
        errors.append(_repair_replay_error(
            "unsupported_schema_version",
            "Viewport recovery evidence schemaVersion is invalid.",
            "$.schemaVersion",
            expected=VIEWPORT_RECOVERY_EVIDENCE_SCHEMA_VERSION,
            actual=evidence.get("schemaVersion"),
        ))
    if evidence.get("status") != "completed":
        errors.append(_repair_replay_error("status_not_completed", "Viewport recovery evidence status must be completed.", "$.status", expected="completed", actual=evidence.get("status")))
    if not _string_or_none(evidence.get("sourceFailureManifestRef")):
        errors.append(_repair_replay_error("source_failure_manifest_ref_missing", "Source failure manifest ref is missing.", "$.sourceFailureManifestRef"))
    if not _string_or_none(evidence.get("replayResultRef")):
        errors.append(_repair_replay_error("replay_result_ref_missing", "Replay result ref is missing.", "$.replayResultRef"))
    replay_trace_refs = _refs_from_explicit_list(evidence.get("replayTraceRefs"))
    if not replay_trace_refs:
        errors.append(_repair_replay_error("replay_trace_refs_missing", "Replay trace refs are missing.", "$.replayTraceRefs"))
    if evidence.get("failedStage") != "grounding":
        errors.append(_repair_replay_error("failed_stage_not_grounding", "Viewport recovery must start from a grounding failure.", "$.failedStage", expected="grounding", actual=evidence.get("failedStage")))
    if evidence.get("failureClass") not in {"offscreen-target", "viewport-miss"}:
        errors.append(_repair_replay_error("failure_class_invalid", "Viewport recovery failureClass must be offscreen-target or viewport-miss.", "$.failureClass", actual=evidence.get("failureClass")))
    if _int_or_none(evidence.get("visibleMatchCount")) != 0:
        errors.append(_repair_replay_error("visible_match_count_not_zero", "Viewport recovery source failure must have zero visible matches.", "$.visibleMatchCount", expected=0, actual=evidence.get("visibleMatchCount")))
    offscreen_candidate_ids = _candidate_id_list(evidence.get("offscreenCandidateElementIds"))
    if not isinstance(evidence.get("offscreenCandidateElementIds"), (list, tuple)):
        errors.append(_repair_replay_error("offscreen_candidate_ids_invalid", "Offscreen candidate element ids must be a list.", "$.offscreenCandidateElementIds", expected="list[str]", actual=type(evidence.get("offscreenCandidateElementIds")).__name__))
    elif not offscreen_candidate_ids:
        errors.append(_repair_replay_error("offscreen_candidate_ids_missing", "Offscreen candidate element ids are missing.", "$.offscreenCandidateElementIds"))
    recovery_action = _mapping(evidence.get("recoveryAction"))
    if recovery_action.get("kind") != "scroll":
        errors.append(_repair_replay_error("recovery_action_not_scroll", "Viewport recovery action must be scroll.", "$.recoveryAction.kind", expected="scroll", actual=recovery_action.get("kind")))
    scroll_delta = _mapping(evidence.get("scrollDelta"))
    if not _nonzero_scroll_delta(scroll_delta):
        errors.append(_repair_replay_error("scroll_delta_missing", "Viewport recovery must include a non-zero scroll delta.", "$.scrollDelta"))
    if not _string_or_none(evidence.get("scrollStateBeforeRef")):
        errors.append(_repair_replay_error("scroll_state_before_ref_missing", "Scroll state before ref is missing.", "$.scrollStateBeforeRef"))
    if not _string_or_none(evidence.get("scrollStateAfterRef")):
        errors.append(_repair_replay_error("scroll_state_after_ref_missing", "Scroll state after ref is missing.", "$.scrollStateAfterRef"))
    after_match_count = _int_or_none(evidence.get("afterMatchCount"))
    if after_match_count != 1:
        errors.append(_repair_replay_error("after_match_count_not_single", "Replay did not reduce viewport grounding to a single selected element.", "$.afterMatchCount", expected=1, actual=after_match_count))
    selected_element_id = _string_or_none(evidence.get("selectedElementId"))
    if not selected_element_id:
        errors.append(_repair_replay_error("selected_element_id_missing", "Replay result has no selected element id.", "$.selectedElementId"))
    if selected_element_id and selected_element_id not in offscreen_candidate_ids:
        errors.append(_repair_replay_error("selected_element_not_offscreen_candidate", "Replay selected element was not one of the offscreen candidates.", "$.selectedElementId", expected="one of offscreenCandidateElementIds", actual=selected_element_id))
    if evidence.get("selectedElementWasOffscreenCandidate") is not True:
        errors.append(_repair_replay_error("selected_element_membership_flag_not_true", "selectedElementWasOffscreenCandidate must be true.", "$.selectedElementWasOffscreenCandidate", expected=True, actual=evidence.get("selectedElementWasOffscreenCandidate")))
    real_window_evidence = evidence.get("realWindowEvidence")
    diagnostic_only = evidence.get("diagnosticOnly")
    if not isinstance(real_window_evidence, bool):
        errors.append(_repair_replay_error("real_window_evidence_missing", "realWindowEvidence must be an explicit boolean.", "$.realWindowEvidence", expected="boolean", actual=real_window_evidence))
    if not isinstance(diagnostic_only, bool):
        errors.append(_repair_replay_error("diagnostic_only_missing", "diagnosticOnly must be an explicit boolean.", "$.diagnosticOnly", expected="boolean", actual=diagnostic_only))
    if real_window_evidence is True and diagnostic_only is True:
        errors.append(_repair_replay_error("real_window_flags_inconsistent", "Evidence cannot be both real-window evidence and diagnostic-only.", "$"))
    if real_window_evidence is False and diagnostic_only is False:
        errors.append(_repair_replay_error("real_window_flags_inconsistent", "Evidence with realWindowEvidence=false must remain diagnostic-only.", "$"))
    real_window_evidence_refs = _refs_from_explicit_list(evidence.get("realWindowEvidenceRefs"))
    target_binding_validation = _mapping(evidence.get("targetBindingValidation"))
    if real_window_evidence is True:
        if not real_window_evidence_refs:
            errors.append(_repair_replay_error(
                "real_window_evidence_refs_missing",
                "Real-window viewport recovery evidence must include explicit realWindowEvidenceRefs.",
                "$.realWindowEvidenceRefs",
            ))
        errors.extend(_real_window_target_binding_validation_errors(
            target_binding_validation,
            context="viewport recovery",
        ))
    if require_existing_refs:
        errors.extend(_existing_ref_errors(
            [
                evidence.get("sourceFailureManifestRef"),
                evidence.get("replayResultRef"),
                *replay_trace_refs,
                evidence.get("scrollStateBeforeRef"),
                evidence.get("scrollStateAfterRef"),
                *real_window_evidence_refs,
                target_binding_validation.get("adapterManifestRef"),
                target_binding_validation.get("targetWindowRef"),
                *_refs_from_explicit_list(target_binding_validation.get("evidenceRefs")),
            ],
        ))
    for issue in _inline_payload_issues(evidence):
        errors.append(_repair_replay_error("inline_payload_forbidden", issue, "$"))
    return _viewport_recovery_validation_result(evidence, evidence_ref=evidence_ref, errors=errors)


def validate_trace(
    trace_or_ref: Mapping[str, Any] | str | Path,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None = None,
) -> dict[str, Any]:
    """Validate a refs-first Computer Use trace payload, local trace path, or host-resolved durable ref.

    Durable workspace refs such as ``trace:...`` require a host-side resolver, so
    callers can pass ``resolver`` to map durable refs to a payload or local JSON
    file before validation.
    """

    trace_ref: str | None = None
    warnings: list[str] = []
    errors: list[str] = []

    try:
        trace = _load_trace(trace_or_ref, resolver=resolver)
    except FileNotFoundError as exc:
        return _trace_validation_result(
            None,
            trace_ref=str(trace_or_ref),
            errors=[f"Trace ref is not a readable local JSON file: {exc}."],
            warnings=warnings,
        )
    except json.JSONDecodeError as exc:
        return _trace_validation_result(
            None,
            trace_ref=str(trace_or_ref),
            errors=[f"Trace JSON could not be parsed: {exc}."],
            warnings=warnings,
        )
    except TypeError as exc:
        return _trace_validation_result(
            None,
            trace_ref=str(trace_or_ref),
            errors=[str(exc)],
            warnings=warnings,
        )

    if not isinstance(trace_or_ref, Mapping):
        trace_ref = str(trace_or_ref)

    if trace.get("schemaVersion") != TRACE_SCHEMA_VERSION:
        errors.append(f"Unsupported trace schemaVersion={trace.get('schemaVersion')!r}.")
    for key in ("status", "reason", "steps"):
        if key not in trace:
            errors.append(f"Trace missing required key {key!r}.")
    if not isinstance(trace.get("steps", []), list):
        errors.append("Trace key 'steps' must be a list.")

    inline_issues = _inline_payload_issues(trace)
    errors.extend(inline_issues)

    screenshot_refs = _unique_strings([
        *_refs_from_explicit_list(trace.get("screenshotRefs")),
        *_collect_screenshot_refs(trace),
    ])
    artifact_refs = _unique_strings([
        *_refs_from_explicit_list(trace.get("artifactRefs")),
        *_collect_artifact_refs(trace),
    ])
    final_artifact_refs = _unique_strings([
        *(_refs_inside(trace.get("finalArtifactRef"), prefer_image=False) if trace.get("finalArtifactRef") else []),
        *_refs_from_explicit_list(trace.get("finalArtifactRefs")),
        *_collect_final_artifact_refs(trace),
    ])
    trace_refs = _unique_strings(_refs_from_explicit_list(trace.get("traceRefs")))

    if not screenshot_refs:
        warnings.append("Trace has no promoted screenshotRefs.")
    request_metadata = _request_metadata_from_trace(trace)
    if trace.get("status") == "completed" and _metadata_requires_final_artifact(request_metadata):
        if not final_artifact_refs:
            errors.append(
                "Trace completed with requiresFinalArtifact metadata but has no finalArtifactRef/finalArtifactRefs."
            )
    if trace.get("status") == "completed" and _metadata_requires_directory_evidence(request_metadata):
        directory_refs = _trace_directory_evidence_refs(trace, _refs_from_explicit_list(trace.get("artifactRefs")))
        final_observation_ref = trace.get("finalObservationRef")
        if not isinstance(final_observation_ref, str) or not _looks_like_screenshot_ref(final_observation_ref):
            errors.append(
                "Trace completed with directory evidence metadata but has no current final observation screenshot ref."
            )
        if not final_artifact_refs:
            errors.append(
                "Trace completed with directory evidence metadata but has no finalArtifactRef/finalArtifactRefs."
            )
        if not directory_refs["artifactRefs"] or not directory_refs["dataRefs"]:
            errors.append(
                "Trace completed with directory evidence metadata but has no file-list artifact/data refs."
            )

    return _trace_validation_result(
        trace,
        trace_ref=trace_ref,
        errors=errors,
        warnings=warnings,
        screenshot_refs=screenshot_refs,
        artifact_refs=artifact_refs,
        final_artifact_refs=final_artifact_refs,
        trace_refs=trace_refs,
    )


def _step_to_trace(step: Any) -> dict[str, Any]:
    screenshot_refs, artifact_refs = _promoted_observation_refs([
        step.before,
        step.after,
    ])
    return {
        "index": step.index,
        "status": step.status,
        "beforeRef": step.before.ref,
        "beforeSummary": step.before.summary,
        "afterRef": step.after.ref if step.after else None,
        "screenshotRefs": screenshot_refs,
        "artifactRefs": artifact_refs,
        "action": _action_to_trace(step.plan),
        "grounding": _compact_dataclass(step.grounding),
        "execution": _compact_dataclass(step.execution),
        "verification": _compact_dataclass(step.verification),
        "failureReason": step.failure_reason,
        "budgetDebitRefs": list(step.budget_debit_refs),
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
    if _inline_payload_issues(value):
        raise ValueError("Computer Use trace must be file-ref-only and cannot contain inline image payloads.")


def _inline_payload_issues(value: Any) -> list[str]:
    issues: list[str] = []
    _collect_inline_payload_issues(value, issues, path="$")
    return _unique_strings(issues)


def _collect_inline_payload_issues(value: Any, issues: list[str], *, path: str) -> None:
    if isinstance(value, Mapping):
        for key, item in value.items():
            key_text = str(key)
            normalized = key_text.replace("_", "").replace("-", "").lower()
            if normalized in {"rawscreenshot", "rawimage", "base64", "imagebase64"}:
                issues.append(f"Trace contains forbidden inline payload key {key_text!r} at {path}.")
            _collect_inline_payload_issues(item, issues, path=f"{path}.{key_text}")
        return
    if isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            _collect_inline_payload_issues(item, issues, path=f"{path}[{index}]")
        return
    if isinstance(value, str):
        if "data:image/" in value or ";base64," in value:
            issues.append("Trace must be file-ref-only and cannot contain inline image payloads.")


def _promoted_result_refs(result: ComputerUseResult) -> tuple[list[str], list[str]]:
    observations: list[Any] = []
    for step in result.steps:
        observations.append(step.before)
        observations.append(step.after)
    observations.append(result.final_observation)
    return _promoted_observation_refs(observations)


def _promoted_final_artifact_refs(result: ComputerUseResult) -> list[str]:
    refs = list(getattr(result, "final_artifact_refs", ()) or ())
    refs.extend(_collect_final_artifact_refs(getattr(result.final_observation, "artifacts", None)))
    refs.extend(_collect_final_artifact_refs(getattr(result.final_observation, "metadata", None)))
    for step in reversed(list(result.steps)):
        verification = getattr(step, "verification", None)
        refs.extend(_collect_final_artifact_refs(getattr(verification, "metadata", None)))
        if refs:
            break
    return _unique_strings(ref for ref in refs if _looks_like_final_artifact_ref(ref))


def _promoted_observation_refs(observations: Iterable[Any]) -> tuple[list[str], list[str]]:
    screenshot_refs: list[str] = []
    artifact_refs: list[str] = []
    for observation in observations:
        if observation is None:
            continue
        ref = getattr(observation, "ref", None)
        if isinstance(ref, str) and ref.strip():
            screenshot_refs.append(ref)
        artifacts = getattr(observation, "artifacts", None)
        metadata = getattr(observation, "metadata", None)
        screenshot_refs.extend(_collect_screenshot_refs(artifacts))
        screenshot_refs.extend(_collect_screenshot_refs(metadata))
        artifact_refs.extend(_collect_artifact_refs(artifacts))
        artifact_refs.extend(_collect_artifact_refs(metadata))
    return _unique_strings(screenshot_refs), _unique_strings(artifact_refs)


def _collect_screenshot_refs(value: Any) -> list[str]:
    return _collect_refs(value, _is_screenshot_key, prefer_image=True)


def _collect_artifact_refs(value: Any) -> list[str]:
    return _collect_refs(value, _is_artifact_key, prefer_image=False)


def _collect_final_artifact_refs(value: Any) -> list[str]:
    refs: list[str] = []
    if isinstance(value, Mapping):
        if _looks_like_visible_artifact_record(value):
            refs.extend(_refs_inside({
                "artifactRef": value.get("artifactRef") or value.get("artifact_ref"),
                "dataRef": value.get("dataRef") or value.get("data_ref"),
                "outputRef": value.get("outputRef") or value.get("output_ref"),
                "path": value.get("path"),
                "ref": value.get("ref"),
            }, prefer_image=False))
        for key, item in value.items():
            normalized = str(key).replace("_", "").replace("-", "").lower()
            if normalized in {"finalartifactref", "finalartifactrefs", "finalartifact", "finalartifacts"}:
                refs.extend(_refs_inside(item, prefer_image=False))
            elif isinstance(item, (Mapping, list, tuple)):
                refs.extend(_collect_final_artifact_refs(item))
    elif isinstance(value, (list, tuple)):
        for item in value:
            refs.extend(_collect_final_artifact_refs(item))
    return _unique_strings(ref for ref in refs if _looks_like_final_artifact_ref(ref))


def _collect_refs(value: Any, key_predicate: Any, *, prefer_image: bool) -> list[str]:
    refs: list[str] = []
    if isinstance(value, Mapping):
        for key, item in value.items():
            key_text = str(key)
            if key_predicate(key_text):
                refs.extend(_refs_inside(item, prefer_image=prefer_image))
                if isinstance(item, str) and _looks_like_ref(item) and (not prefer_image or _looks_like_screenshot_ref(item)):
                    refs.append(item)
            elif isinstance(item, (Mapping, list, tuple)):
                refs.extend(_collect_refs(item, key_predicate, prefer_image=prefer_image))
    elif isinstance(value, (list, tuple)):
        for item in value:
            refs.extend(_collect_refs(item, key_predicate, prefer_image=prefer_image))
    return _unique_strings(refs)


def _refs_inside(value: Any, *, prefer_image: bool) -> list[str]:
    refs: list[str] = []
    if isinstance(value, str):
        if _looks_like_ref(value) and (not prefer_image or _looks_like_screenshot_ref(value)):
            refs.append(value)
    elif isinstance(value, Mapping):
        for key in ("path", "uri", "ref", "id", "artifactRef", "dataRef", "outputRef", "rawRef"):
            item = value.get(key)
            if isinstance(item, str) and _looks_like_ref(item):
                if not prefer_image or _looks_like_screenshot_ref(item) or _is_screenshot_key(key):
                    refs.append(item)
        for item in value.values():
            refs.extend(_refs_inside(item, prefer_image=prefer_image))
    elif isinstance(value, (list, tuple)):
        for item in value:
            refs.extend(_refs_inside(item, prefer_image=prefer_image))
    return _unique_strings(refs)


def _refs_from_explicit_list(value: Any) -> list[str]:
    if isinstance(value, (list, tuple)):
        return _unique_strings([item for item in value if isinstance(item, str) and item.strip()])
    return []


def _is_screenshot_key(key: str) -> bool:
    normalized = key.replace("_", "").replace("-", "").lower()
    return any(token in normalized for token in ("screenshot", "image", "capture", "focusref", "focusrefs"))


def _is_artifact_key(key: str) -> bool:
    normalized = key.replace("_", "").replace("-", "").lower()
    return any(token in normalized for token in ("artifact", "output", "dataref", "rawref", "resultref"))


def _looks_like_visible_artifact_record(value: Mapping[str, Any]) -> bool:
    if _looks_like_directory_evidence_record(value):
        return False
    schema = str(value.get("schemaVersion") or value.get("schema_version") or "")
    delivery = str(value.get("delivery") or "")
    status = str(value.get("status") or "")
    kind = str(value.get("kind") or value.get("type") or "")
    return (
        schema == "sciforge.computer-use.virtual-remote-artifact.v1"
        or delivery == "virtual-remote-session-artifact"
        or status in {"visible-and-saved", "saved", "final"}
        or any(token in kind.lower() for token in ("artifact", "document", "index", "report", "deck", "presentation"))
    )


def _looks_like_ref(value: str) -> bool:
    text = value.strip()
    return (
        text.startswith(("artifact:", "file:", "workEvidence:", "budgetDebit:", "audit:", "approval:", "ref:", "trace:"))
        or text.startswith(("EU-", ".sciforge/", "/"))
        or text.lower().endswith((".json", ".md", ".txt", ".csv", ".tsv", ".xlsx", ".ppt", ".pptx", ".pdf", ".png", ".jpg", ".jpeg", ".webp"))
    )


def _looks_like_screenshot_ref(value: str) -> bool:
    text = value.strip().lower()
    return text.endswith((".png", ".jpg", ".jpeg", ".webp")) or text.startswith(("screenshot:", "capture:"))


def _looks_like_final_artifact_ref(value: str) -> bool:
    text = value.strip()
    return (
        bool(text)
        and _looks_like_ref(text)
        and not _looks_like_screenshot_ref(text)
        and not _looks_like_control_evidence_ref(text)
    )


def _request_metadata_from_trace(trace: Mapping[str, Any]) -> Any:
    request = trace.get("request")
    if isinstance(request, Mapping):
        metadata = request.get("metadata")
        if isinstance(metadata, Mapping):
            return metadata
    for key in ("requestMetadata", "request_metadata", "metadata"):
        metadata = trace.get(key)
        if isinstance(metadata, Mapping):
            return metadata
    return {}


def _metadata_requires_final_artifact(value: Any) -> bool:
    if isinstance(value, Mapping):
        for key, item in value.items():
            normalized = str(key).replace("_", "").replace("-", "").lower()
            if normalized in {"requiresfinalartifact", "finalartifactrequired"} and _truthy_metadata_flag(item):
                return True
            if normalized in {"artifactpolicy", "acceptance"} and isinstance(item, Mapping):
                if _metadata_requires_final_artifact(item):
                    return True
        return False
    if isinstance(value, (list, tuple)):
        return any(_metadata_requires_final_artifact(item) for item in value)
    return False


def _metadata_requires_directory_evidence(value: Any) -> bool:
    if isinstance(value, Mapping):
        for key, item in value.items():
            normalized = str(key).replace("_", "").replace("-", "").lower()
            if normalized in {
                "requiresdirectoryevidence",
                "directoryevidencerequired",
                "filelistevidencerequired",
                "requiresfilelistevidence",
            } and _truthy_metadata_flag(item):
                return True
            if normalized in {"artifactpolicy", "acceptance"} and isinstance(item, Mapping):
                if _metadata_requires_directory_evidence(item):
                    return True
        return False
    if isinstance(value, (list, tuple)):
        return any(_metadata_requires_directory_evidence(item) for item in value)
    return False


def _truthy_metadata_flag(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "required", "require"}
    return False


def _trace_directory_evidence_refs(trace: Mapping[str, Any], artifact_refs: list[str]) -> dict[str, list[str]]:
    file_list_artifact_refs: list[str] = []
    file_list_data_refs: list[str] = []
    for ref in artifact_refs:
        if _looks_like_directory_data_ref(ref):
            file_list_data_refs.append(ref)
        elif _looks_like_directory_artifact_ref(ref):
            file_list_artifact_refs.append(ref)
    for key in ("finalObservation", "finalObservationMetadata", "final_observation_metadata"):
        refs = _directory_evidence_refs_from_value(trace.get(key))
        file_list_artifact_refs.extend(refs["artifactRefs"])
        file_list_data_refs.extend(refs["dataRefs"])
    for step in trace.get("steps", []):
        if not isinstance(step, Mapping):
            continue
        verification = step.get("verification")
        if not isinstance(verification, Mapping):
            continue
        refs = _directory_evidence_refs_from_value(verification.get("metadata") or verification)
        file_list_artifact_refs.extend(refs["artifactRefs"])
        file_list_data_refs.extend(refs["dataRefs"])
    return {
        "artifactRefs": _unique_strings(
            ref for ref in file_list_artifact_refs if _looks_like_final_artifact_ref(ref)
        ),
        "dataRefs": _unique_strings(
            ref for ref in file_list_data_refs if _looks_like_final_artifact_ref(ref)
        ),
    }


def _directory_evidence_refs_from_value(value: Any, *, in_directory_record: bool = False) -> dict[str, list[str]]:
    artifact_refs: list[str] = []
    data_refs: list[str] = []
    if isinstance(value, Mapping):
        record_context = in_directory_record or _looks_like_directory_evidence_record(value)
        for key, item in value.items():
            normalized = str(key).replace("_", "").replace("-", "").lower()
            key_context = record_context or any(
                token in normalized for token in ("filelist", "directorylisting", "directoryevidence")
            )
            if key_context:
                if normalized in {"dataref", "datarefs", "rawref", "rawrefs", "filelistdataref", "filelistdatarefs"}:
                    data_refs.extend(_refs_inside(item, prefer_image=False))
                elif normalized in {
                    "artifactref",
                    "artifactrefs",
                    "outputref",
                    "outputrefs",
                    "ref",
                    "refs",
                    "path",
                    "filelistartifactref",
                    "filelistartifactrefs",
                    "directorylistingref",
                    "directorylistingrefs",
                }:
                    artifact_refs.extend(_refs_inside(item, prefer_image=False))
            if isinstance(item, (Mapping, list, tuple)):
                nested = _directory_evidence_refs_from_value(item, in_directory_record=key_context)
                artifact_refs.extend(nested["artifactRefs"])
                data_refs.extend(nested["dataRefs"])
    elif isinstance(value, (list, tuple)):
        for item in value:
            nested = _directory_evidence_refs_from_value(item, in_directory_record=in_directory_record)
            artifact_refs.extend(nested["artifactRefs"])
            data_refs.extend(nested["dataRefs"])
    return {
        "artifactRefs": _unique_strings(artifact_refs),
        "dataRefs": _unique_strings(data_refs),
    }


def _looks_like_directory_evidence_record(value: Mapping[str, Any]) -> bool:
    schema = str(value.get("schemaVersion") or value.get("schema_version") or "").lower()
    kind = str(value.get("kind") or value.get("type") or "").lower()
    return (
        "file-list" in schema
        or "filelist" in schema
        or "directory" in schema
        or "file-list" in kind
        or "filelist" in kind
        or "directory" in kind
    )


def _looks_like_directory_artifact_ref(value: str) -> bool:
    name = value.strip().split("/")[-1].lower()
    return (
        _looks_like_final_artifact_ref(value)
        and ("file-list" in name or "filelist" in name or "directory" in name)
        and "data" not in name
    )


def _looks_like_directory_data_ref(value: str) -> bool:
    name = value.strip().split("/")[-1].lower()
    return (
        _looks_like_final_artifact_ref(value)
        and ("file-list" in name or "filelist" in name or "directory" in name)
        and "data" in name
    )


def _looks_like_control_evidence_ref(value: str) -> bool:
    name = value.strip().split("/")[-1].lower()
    return name in {
        "vision-trace.json",
        "host-ports.json",
        "tool-payload.json",
        "gui-present.json",
        "gui-ask-user.json",
        "computer-use-request.json",
        "gateway-request.json",
        "request.json",
        "independent-input-adapter.json",
        "virtual-remote-session.json",
        "action-ledger.json",
        "failure-diagnostics.json",
        "cu-user-acceptance-manifest.json",
        "cu-user-acceptance-input.json",
        "cu-l3-independent-input-verifier.json",
    }


def _unique_strings(values: Iterable[Any]) -> list[str]:
    seen: set[str] = set()
    unique: list[str] = []
    for value in values:
        if not isinstance(value, str):
            continue
        text = value.strip()
        if not text or text in seen:
            continue
        seen.add(text)
        unique.append(text)
    return unique


def _load_trace(
    trace_or_ref: Mapping[str, Any] | str | Path,
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> Mapping[str, Any]:
    if isinstance(trace_or_ref, Mapping):
        return trace_or_ref
    if isinstance(trace_or_ref, str) and trace_or_ref.startswith("trace:"):
        if resolver is None:
            raise FileNotFoundError(f"{trace_or_ref} (durable refs require a host resolver)")
        resolved = resolver(trace_or_ref)
        if resolved == trace_or_ref:
            raise FileNotFoundError(f"{trace_or_ref} (resolver returned the original ref)")
        return _load_trace(resolved, resolver=None)
    path = Path(trace_or_ref)
    if not path.exists():
        raise FileNotFoundError(str(path))
    parsed = json.loads(path.read_text(encoding="utf8"))
    if not isinstance(parsed, Mapping):
        raise TypeError("Trace JSON root must be an object.")
    return parsed


def _load_mapping_with_ref(value: Mapping[str, Any] | str | Path) -> tuple[Mapping[str, Any], str | None]:
    if isinstance(value, Mapping):
        return value, None
    path = Path(value).expanduser()
    parsed = json.loads(path.read_text(encoding="utf8"))
    if not isinstance(parsed, Mapping):
        raise TypeError("JSON root must be an object.")
    return parsed, str(path.resolve())


def _load_repair_mapping_with_ref(
    value: Mapping[str, Any] | str | Path,
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> tuple[Mapping[str, Any], str | None]:
    if isinstance(value, Mapping):
        return value, None
    text = str(value)
    path = Path(value).expanduser()
    if path.exists() or resolver is None:
        return _load_mapping_with_ref(path)
    resolved = resolver(text)
    payload, resolved_ref = _load_repair_mapping_with_ref(resolved, resolver=None)
    return payload, text if resolved_ref is None else resolved_ref


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _list_of_mappings(value: Any) -> list[Mapping[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, Mapping)]


def _first_mapping(*values: Any) -> Mapping[str, Any]:
    for value in values:
        if isinstance(value, Mapping):
            return value
        if isinstance(value, list):
            for item in value:
                if isinstance(item, Mapping):
                    return item
    return {}


def _first_replay_step_with_grounding(value: Any) -> Mapping[str, Any]:
    fallback = _first_mapping(value)
    if not isinstance(value, list):
        return fallback
    for item in value:
        step = _mapping(item)
        metadata = _mapping(_mapping(step.get("grounding")).get("metadata"))
        if _string_or_none(metadata.get("elementId")):
            return step
    return fallback


def _first_replay_step_with_action(value: Any, action_kind: str) -> Mapping[str, Any]:
    if not isinstance(value, list):
        return {}
    for item in value:
        step = _mapping(item)
        action = _mapping(step.get("action"))
        if action.get("kind") == action_kind:
            return step
    return {}


def _candidate_ids(value: Any) -> list[str]:
    ids: list[str] = []
    if isinstance(value, list):
        for item in value:
            record = _mapping(item)
            candidate = _string_or_none(record.get("id") or record.get("elementId"))
            if candidate:
                ids.append(candidate)
    return _unique_strings(ids)


def _candidate_id_list(value: Any) -> list[str]:
    if not isinstance(value, (list, tuple)):
        return []
    return _unique_strings(item.strip() for item in value if isinstance(item, str) and item.strip())


def _int_or_none(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return None
    return None


def _string_or_none(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    return text or None


def _scroll_delta_from_state_update(state_update: Mapping[str, Any], action: Mapping[str, Any]) -> dict[str, Any]:
    details = _mapping(state_update.get("details"))
    delta_x = _number_or_zero(details.get("deltaX"))
    delta_y = _number_or_zero(details.get("deltaY"))
    return {
        "direction": details.get("direction") or action.get("direction"),
        "amount": action.get("amount"),
        "deltaX": delta_x,
        "deltaY": delta_y,
    }


def _number_or_zero(value: Any) -> float:
    return float(value) if isinstance(value, (int, float)) else 0.0


def _nonzero_scroll_delta(value: Mapping[str, Any]) -> bool:
    return bool(_number_or_zero(value.get("deltaX")) or _number_or_zero(value.get("deltaY")))


def _repair_replay_error(
    code: str,
    message: str,
    path: str,
    *,
    expected: Any | None = None,
    actual: Any | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "code": code,
        "message": message,
        "path": path,
        "severity": "error",
    }
    if expected is not None:
        payload["expected"] = expected
    if actual is not None:
        payload["actual"] = actual
    return payload


def _viewport_recovery_validation_result(
    evidence: Mapping[str, Any] | None,
    *,
    evidence_ref: str | None,
    errors: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "schemaVersion": VIEWPORT_RECOVERY_EVIDENCE_VALIDATION_SCHEMA_VERSION,
        "ok": not errors,
        "evidenceRef": evidence_ref,
        "status": evidence.get("status") if evidence else None,
        "errors": errors,
        "warnings": [],
        "sourceFailureManifestRef": evidence.get("sourceFailureManifestRef") if evidence else None,
        "replayResultRef": evidence.get("replayResultRef") if evidence else None,
        "replayTraceRefs": _refs_from_explicit_list(evidence.get("replayTraceRefs")) if evidence else [],
        "failureClass": evidence.get("failureClass") if evidence else None,
        "selectedElementId": _string_or_none(evidence.get("selectedElementId")) if evidence else None,
        "afterMatchCount": _int_or_none(evidence.get("afterMatchCount")) if evidence else None,
        "diagnosticOnly": evidence.get("diagnosticOnly") if evidence else None,
        "realWindowEvidence": evidence.get("realWindowEvidence") if evidence else None,
    }


def _trace_validation_result(
    trace: Mapping[str, Any] | None,
    *,
    trace_ref: str | None,
    errors: list[str],
    warnings: list[str],
    screenshot_refs: list[str] | None = None,
    artifact_refs: list[str] | None = None,
    final_artifact_refs: list[str] | None = None,
    trace_refs: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "schemaVersion": TRACE_VALIDATION_SCHEMA_VERSION,
        "ok": not errors,
        "traceRef": trace_ref,
        "status": trace.get("status") if trace else None,
        "errors": errors,
        "warnings": warnings,
        "screenshotRefs": screenshot_refs or [],
        "artifactRefs": artifact_refs or [],
        "finalArtifactRefs": final_artifact_refs or [],
        "traceRefs": trace_refs or [],
    }


def _real_window_target_binding_validation_errors(
    target_binding_validation: Mapping[str, Any],
    *,
    context: str,
) -> list[dict[str, Any]]:
    if target_binding_validation.get("ok") is not True:
        return [_repair_replay_error(
            "target_binding_validation_missing",
            f"Real-window {context} evidence must include a successful targetBindingValidation.",
            "$.targetBindingValidation",
        )]
    errors: list[dict[str, Any]] = []
    if target_binding_validation.get("requireExistingRefs") is not True:
        errors.append(_repair_replay_error(
            "target_binding_existing_refs_missing",
            f"Real-window {context} evidence must include targetBindingValidation with requireExistingRefs=true.",
            "$.targetBindingValidation.requireExistingRefs",
            expected=True,
            actual=target_binding_validation.get("requireExistingRefs"),
        ))
    if target_binding_validation.get("bindingStatus") != "bound":
        errors.append(_repair_replay_error(
            "target_binding_status_not_bound",
            f"Real-window {context} evidence requires bindingStatus=bound.",
            "$.targetBindingValidation.bindingStatus",
            expected="bound",
            actual=target_binding_validation.get("bindingStatus"),
        ))
    target_environment_kind = _string_or_none(target_binding_validation.get("targetEnvironmentKind"))
    if not target_environment_kind:
        errors.append(_repair_replay_error(
            "target_binding_environment_missing",
            f"Real-window {context} evidence requires a targetEnvironmentKind.",
            "$.targetBindingValidation.targetEnvironmentKind",
        ))
    elif _target_environment_is_virtual_or_diagnostic(target_environment_kind):
        errors.append(_repair_replay_error(
            "target_binding_environment_virtual_or_diagnostic",
            f"Real-window {context} evidence cannot use a virtual, diagnostic, scripted, or state-only target environment.",
            "$.targetBindingValidation.targetEnvironmentKind",
            actual=target_environment_kind,
        ))
    if not _string_or_none(target_binding_validation.get("adapterManifestRef")):
        errors.append(_repair_replay_error(
            "target_binding_adapter_manifest_ref_missing",
            f"Real-window {context} evidence requires adapterManifestRef.",
            "$.targetBindingValidation.adapterManifestRef",
        ))
    if not _string_or_none(target_binding_validation.get("targetWindowRef")):
        errors.append(_repair_replay_error(
            "target_binding_target_window_ref_missing",
            f"Real-window {context} evidence requires targetWindowRef.",
            "$.targetBindingValidation.targetWindowRef",
        ))
    if not _refs_from_explicit_list(target_binding_validation.get("evidenceRefs")):
        errors.append(_repair_replay_error(
            "target_binding_evidence_refs_missing",
            f"Real-window {context} evidence requires target binding evidenceRefs.",
            "$.targetBindingValidation.evidenceRefs",
        ))
    if target_binding_validation.get("executeChangesTargetEnvironment") is not True:
        errors.append(_repair_replay_error(
            "target_binding_execution_not_real_target",
            f"Real-window {context} evidence requires executeChangesTargetEnvironment=true.",
            "$.targetBindingValidation.executeChangesTargetEnvironment",
            expected=True,
            actual=target_binding_validation.get("executeChangesTargetEnvironment"),
        ))
    if target_binding_validation.get("realWindowEvidenceCapable") is not True:
        errors.append(_repair_replay_error(
            "target_binding_real_window_capability_missing",
            f"Real-window {context} evidence requires realWindowEvidenceCapable=true.",
            "$.targetBindingValidation.realWindowEvidenceCapable",
            expected=True,
            actual=target_binding_validation.get("realWindowEvidenceCapable"),
        ))
    if target_binding_validation.get("errors"):
        errors.append(_repair_replay_error(
            "target_binding_validation_contains_errors",
            f"Real-window {context} evidence cannot carry targetBindingValidation.errors.",
            "$.targetBindingValidation.errors",
        ))
    return errors


def _existing_ref_errors(refs: Sequence[Any]) -> list[dict[str, Any]]:
    for ref in _unique_strings(ref for ref in refs if isinstance(ref, str) and ref):
        if not Path(ref).expanduser().is_file():
            return [_repair_replay_error(
                "evidence_ref_not_found",
                "Evidence ref must point to an existing local file.",
                "$",
                actual=ref,
            )]
    return []


def _target_environment_is_virtual_or_diagnostic(value: str) -> bool:
    normalized = value.strip().replace("_", "-").lower()
    compact = normalized.replace("-", "")
    blocked_tokens = (
        "diagnostic",
        "dryrun",
        "fixture",
        "mock",
        "packagelocal",
        "scripted",
        "simulatedonly",
        "stateonly",
        "test",
        "virtual",
    )
    return any(token in compact for token in blocked_tokens)

from .target_bound_evidence import (  # noqa: E402 - keep trace.* public API stable.
    TARGET_BOUND_REAL_WINDOW_EVIDENCE_SCHEMA_VERSION,
    TARGET_BOUND_REAL_WINDOW_EVIDENCE_VALIDATION_SCHEMA_VERSION,
    build_target_bound_real_window_probe_evidence,
    validate_target_bound_real_window_probe_evidence,
)
