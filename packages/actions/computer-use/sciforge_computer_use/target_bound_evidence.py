"""Target-bound real-window evidence helpers for Computer Use."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from .virtual_input_adapter import TARGET_BOUND_READY_INPUT_CHANNEL_VALUES

TARGET_BOUND_REAL_WINDOW_EVIDENCE_SCHEMA_VERSION = "sciforge.computer-use.target-bound-real-window-probe-evidence.v1"
TARGET_BOUND_REAL_WINDOW_EVIDENCE_VALIDATION_SCHEMA_VERSION = (
    "sciforge.computer-use.target-bound-real-window-probe-evidence-validation.v1"
)

from .trace import (  # noqa: E402 - imported late through trace compatibility boundary.
    _collect_final_artifact_refs,
    _collect_screenshot_refs,
    _existing_ref_errors,
    _inline_payload_issues,
    _int_or_none,
    _list_of_mappings,
    _load_mapping_with_ref,
    _load_repair_mapping_with_ref,
    _looks_like_screenshot_ref,
    _mapping,
    _real_window_target_binding_validation_errors,
    _refs_from_explicit_list,
    _refs_inside,
    _repair_replay_error,
    _string_or_none,
    _trace_directory_evidence_refs,
    _truthy_metadata_flag,
    _unique_strings,
)


def build_target_bound_real_window_probe_evidence(
    preflight_manifest_or_ref: Mapping[str, Any] | str | Path,
    result_or_ref: Mapping[str, Any] | str | Path,
    trace_or_ref: Mapping[str, Any] | str | Path,
    *,
    target_binding_validation: Mapping[str, Any],
    real_window_evidence_refs: Sequence[str],
    initial_screenshot_ref: str,
    final_screenshot_ref: str,
    final_artifact_ref: str,
    result_ref_override: str | None = None,
    file_list_artifact_ref: str | None = None,
    file_list_data_ref: str | None = None,
    input_channel: str | None = None,
    executor_provider: str | None = None,
    minimum_action_count: int | None = None,
    requires_current_step_screenshots: bool = False,
    forbid_prior_round_completion_evidence: bool = False,
    requires_directory_evidence: bool = False,
    required_input_modalities: Sequence[str] | None = None,
    metadata: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Build refs-first evidence for a future target-bound real-window probe."""

    preflight_manifest, preflight_ref = _load_mapping_with_ref(preflight_manifest_or_ref)
    result, loaded_result_ref = _load_mapping_with_ref(result_or_ref)
    trace, trace_ref = _load_mapping_with_ref(trace_or_ref)
    trace_refs = _unique_strings([
        *_refs_from_explicit_list(result.get("traceRefs")),
        *_refs_from_explicit_list(trace.get("traceRefs")),
        *([trace_ref] if trace_ref else []),
    ])
    evidence = {
        "schemaVersion": TARGET_BOUND_REAL_WINDOW_EVIDENCE_SCHEMA_VERSION,
        "status": "completed",
        "reason": "",
        "preflightRef": preflight_ref,
        "preflightStatus": preflight_manifest.get("status"),
        "resultRef": result_ref_override or loaded_result_ref,
        "traceRefs": trace_refs,
        "initialScreenshotRef": initial_screenshot_ref,
        "finalScreenshotRef": final_screenshot_ref,
        "realWindowEvidenceRefs": _unique_strings(real_window_evidence_refs),
        "targetBindingValidation": dict(target_binding_validation),
        "inputChannel": input_channel or target_binding_validation.get("inputChannel"),
        "executorProvider": executor_provider,
        "inputExecuted": True,
        "executeFailClosed": False,
        "osInputExecuted": False,
        "realOsInputExecuted": False,
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
        "realWindowEvidence": True,
        "diagnosticOnly": False,
        "finalArtifactRef": final_artifact_ref,
        "fileListArtifactRef": file_list_artifact_ref,
        "fileListDataRef": file_list_data_ref,
        "requiresDirectoryEvidence": bool(requires_directory_evidence),
        "workflowRequirements": _target_bound_real_window_workflow_requirements(
            minimum_action_count=minimum_action_count,
            requires_current_step_screenshots=requires_current_step_screenshots,
            forbid_prior_round_completion_evidence=forbid_prior_round_completion_evidence,
            requires_directory_evidence=requires_directory_evidence,
            required_input_modalities=required_input_modalities,
        ),
        "metadata": dict(metadata or {}),
    }
    validation = validate_target_bound_real_window_probe_evidence(evidence)
    evidence["status"] = "completed" if validation["ok"] else "blocked"
    evidence["reason"] = (
        "Target-bound real-window probe evidence satisfies refs-first contract."
        if validation["ok"]
        else "; ".join(error["message"] for error in validation["errors"])
    )
    evidence["errors"] = validation["errors"]
    return evidence


def validate_target_bound_real_window_probe_evidence(
    evidence_or_ref: Mapping[str, Any] | str | Path,
    *,
    require_existing_refs: bool = False,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None = None,
) -> dict[str, Any]:
    """Validate refs-first target-bound real-window probe evidence."""

    try:
        evidence, evidence_ref = _load_repair_mapping_with_ref(evidence_or_ref, resolver=resolver)
    except (OSError, json.JSONDecodeError, TypeError) as exc:
        return _target_bound_real_window_validation_result(
            None,
            evidence_ref=str(evidence_or_ref),
            errors=[_repair_replay_error("evidence_load_failed", f"Target-bound real-window evidence could not be loaded: {exc}.", "$")],
        )

    errors: list[dict[str, Any]] = []
    if evidence.get("schemaVersion") != TARGET_BOUND_REAL_WINDOW_EVIDENCE_SCHEMA_VERSION:
        errors.append(_repair_replay_error(
            "unsupported_schema_version",
            "Target-bound real-window evidence schemaVersion is invalid.",
            "$.schemaVersion",
            expected=TARGET_BOUND_REAL_WINDOW_EVIDENCE_SCHEMA_VERSION,
            actual=evidence.get("schemaVersion"),
        ))
    if evidence.get("status") != "completed":
        errors.append(_repair_replay_error("status_not_completed", "Target-bound real-window evidence status must be completed.", "$.status", expected="completed", actual=evidence.get("status")))
    if evidence.get("preflightStatus") != "ready":
        errors.append(_repair_replay_error("preflight_not_ready", "Target-bound real-window evidence requires preflightStatus=ready.", "$.preflightStatus", expected="ready", actual=evidence.get("preflightStatus")))
    if evidence.get("inputExecuted") is not True:
        errors.append(_repair_replay_error("input_not_executed", "Target-bound real-window evidence requires inputExecuted=true.", "$.inputExecuted", expected=True, actual=evidence.get("inputExecuted")))
    if evidence.get("executeFailClosed") is not False:
        errors.append(_repair_replay_error("execute_fail_closed", "Target-bound real-window evidence cannot be fail-closed execution.", "$.executeFailClosed", expected=False, actual=evidence.get("executeFailClosed")))
    for key in ("osInputExecuted", "realOsInputExecuted", "sharedSystemInputUsed", "systemPointerMoved", "systemKeyboardEventsSent"):
        if evidence.get(key) is not False:
            errors.append(_repair_replay_error(
                "side_effect_flag_not_false",
                f"Target-bound real-window evidence requires {key}=false.",
                f"$.{key}",
                expected=False,
                actual=evidence.get(key),
            ))
    if evidence.get("realWindowEvidence") is not True:
        errors.append(_repair_replay_error("real_window_evidence_not_true", "realWindowEvidence must be true.", "$.realWindowEvidence", expected=True, actual=evidence.get("realWindowEvidence")))
    if evidence.get("diagnosticOnly") is not False:
        errors.append(_repair_replay_error("diagnostic_only_not_false", "diagnosticOnly must be false.", "$.diagnosticOnly", expected=False, actual=evidence.get("diagnosticOnly")))

    input_channel = _string_or_none(evidence.get("inputChannel"))
    allowed_channels = set(TARGET_BOUND_READY_INPUT_CHANNEL_VALUES)
    if input_channel not in allowed_channels:
        errors.append(_repair_replay_error(
            "input_channel_not_target_bound",
            "Target-bound real-window evidence requires a ready target-bound input channel.",
            "$.inputChannel",
            expected=sorted(allowed_channels),
            actual=input_channel,
        ))
    initial_screenshot_ref = _string_or_none(evidence.get("initialScreenshotRef"))
    final_screenshot_ref = _string_or_none(evidence.get("finalScreenshotRef"))
    if not initial_screenshot_ref:
        errors.append(_repair_replay_error("initial_screenshot_ref_missing", "initialScreenshotRef is required.", "$.initialScreenshotRef"))
    if not final_screenshot_ref:
        errors.append(_repair_replay_error("final_screenshot_ref_missing", "finalScreenshotRef is required.", "$.finalScreenshotRef"))
    if initial_screenshot_ref and final_screenshot_ref and initial_screenshot_ref == final_screenshot_ref:
        errors.append(_repair_replay_error("screenshot_refs_not_distinct", "Initial and final screenshot refs must be distinct current observations.", "$"))
    real_window_evidence_refs = _refs_from_explicit_list(evidence.get("realWindowEvidenceRefs"))
    if not real_window_evidence_refs:
        errors.append(_repair_replay_error("real_window_evidence_refs_missing", "realWindowEvidenceRefs must include explicit refs.", "$.realWindowEvidenceRefs"))
    if not _string_or_none(evidence.get("preflightRef")):
        errors.append(_repair_replay_error("preflight_ref_missing", "preflightRef is required.", "$.preflightRef"))
    if not _string_or_none(evidence.get("resultRef")):
        errors.append(_repair_replay_error("result_ref_missing", "resultRef is required.", "$.resultRef"))
    trace_refs = _refs_from_explicit_list(evidence.get("traceRefs"))
    if not trace_refs:
        errors.append(_repair_replay_error("trace_refs_missing", "traceRefs are required.", "$.traceRefs"))
    if not _string_or_none(evidence.get("finalArtifactRef")):
        errors.append(_repair_replay_error("final_artifact_ref_missing", "finalArtifactRef is required.", "$.finalArtifactRef"))
    workflow_requirements = _mapping(evidence.get("workflowRequirements"))
    requires_directory_evidence = (
        evidence.get("requiresDirectoryEvidence") is True
        or workflow_requirements.get("requiresDirectoryEvidence") is True
    )
    minimum_action_count = _int_or_none(workflow_requirements.get("minimumActionCount"))
    required_input_modalities = _workflow_required_input_modalities(workflow_requirements.get("requiredInputModalities"))
    requires_current_step_screenshots = workflow_requirements.get("requiresCurrentStepScreenshots") is True
    forbid_prior_round_completion_evidence = workflow_requirements.get("forbidPriorRoundCompletionEvidence") is True
    strict_workflow_required = bool(
        minimum_action_count
        or required_input_modalities
        or requires_current_step_screenshots
        or forbid_prior_round_completion_evidence
        or requires_directory_evidence
    )
    if requires_directory_evidence:
        if not _string_or_none(evidence.get("fileListArtifactRef")):
            errors.append(_repair_replay_error("file_list_artifact_ref_missing", "fileListArtifactRef is required when directory evidence is required.", "$.fileListArtifactRef"))
        if not _string_or_none(evidence.get("fileListDataRef")):
            errors.append(_repair_replay_error("file_list_data_ref_missing", "fileListDataRef is required when directory evidence is required.", "$.fileListDataRef"))
    target_binding_validation = _mapping(evidence.get("targetBindingValidation"))
    errors.extend(_real_window_target_binding_validation_errors(
        target_binding_validation,
        context="target-bound real-window probe",
    ))
    for issue in _inline_payload_issues(evidence):
        errors.append(_repair_replay_error("inline_payload_forbidden", issue, "$"))
    if strict_workflow_required:
        errors.extend(_target_bound_real_window_workflow_validation_errors(
            evidence,
            result_ref=_string_or_none(evidence.get("resultRef")),
            trace_refs=trace_refs,
            minimum_action_count=minimum_action_count,
            requires_current_step_screenshots=requires_current_step_screenshots,
            forbid_prior_round_completion_evidence=forbid_prior_round_completion_evidence,
            requires_directory_evidence=requires_directory_evidence,
            required_input_modalities=required_input_modalities,
            resolver=resolver,
        ))
    if require_existing_refs:
        errors.extend(_existing_ref_errors([
            *real_window_evidence_refs,
            *trace_refs,
            *[ref for ref in (
                evidence.get("preflightRef"),
                evidence.get("resultRef"),
                initial_screenshot_ref,
                final_screenshot_ref,
                evidence.get("finalArtifactRef"),
                evidence.get("fileListArtifactRef"),
                evidence.get("fileListDataRef"),
            ) if isinstance(ref, str) and ref],
        ]))
    return _target_bound_real_window_validation_result(
        evidence,
        evidence_ref=evidence_ref,
        errors=errors,
        require_existing_refs=require_existing_refs,
    )



def _target_bound_real_window_validation_result(
    evidence: Mapping[str, Any] | None,
    *,
    evidence_ref: str | None,
    errors: list[dict[str, Any]],
    require_existing_refs: bool = False,
) -> dict[str, Any]:
    return {
        "schemaVersion": TARGET_BOUND_REAL_WINDOW_EVIDENCE_VALIDATION_SCHEMA_VERSION,
        "ok": not errors,
        "evidenceRef": evidence_ref,
        "status": evidence.get("status") if evidence else None,
        "errors": errors,
        "warnings": [],
        "requireExistingRefs": bool(require_existing_refs),
        "preflightRef": evidence.get("preflightRef") if evidence else None,
        "preflightStatus": evidence.get("preflightStatus") if evidence else None,
        "resultRef": evidence.get("resultRef") if evidence else None,
        "traceRefs": _refs_from_explicit_list(evidence.get("traceRefs")) if evidence else [],
        "realWindowEvidenceRefs": _refs_from_explicit_list(evidence.get("realWindowEvidenceRefs")) if evidence else [],
        "targetBindingValidation": _mapping(evidence.get("targetBindingValidation")) if evidence else {},
        "inputChannel": evidence.get("inputChannel") if evidence else None,
        "inputExecuted": evidence.get("inputExecuted") if evidence else None,
        "executeFailClosed": evidence.get("executeFailClosed") if evidence else None,
        "sharedSystemInputUsed": evidence.get("sharedSystemInputUsed") if evidence else None,
        "realWindowEvidence": evidence.get("realWindowEvidence") if evidence else None,
        "diagnosticOnly": evidence.get("diagnosticOnly") if evidence else None,
        "finalArtifactRef": evidence.get("finalArtifactRef") if evidence else None,
        "fileListArtifactRef": evidence.get("fileListArtifactRef") if evidence else None,
        "fileListDataRef": evidence.get("fileListDataRef") if evidence else None,
        "workflowRequirements": _mapping(evidence.get("workflowRequirements")) if evidence else {},
    }


def _target_bound_real_window_workflow_requirements(
    *,
    minimum_action_count: int | None,
    requires_current_step_screenshots: bool,
    forbid_prior_round_completion_evidence: bool,
    requires_directory_evidence: bool,
    required_input_modalities: Sequence[str] | None = None,
) -> dict[str, Any]:
    requirements: dict[str, Any] = {}
    if minimum_action_count is not None:
        requirements["minimumActionCount"] = minimum_action_count
    modalities = _workflow_required_input_modalities(required_input_modalities)
    if modalities:
        requirements["requiredInputModalities"] = modalities
    if requires_current_step_screenshots:
        requirements["requiresCurrentStepScreenshots"] = True
    if forbid_prior_round_completion_evidence:
        requirements["forbidPriorRoundCompletionEvidence"] = True
    if requires_directory_evidence:
        requirements["requiresDirectoryEvidence"] = True
    return requirements


def _target_bound_real_window_workflow_validation_errors(
    evidence: Mapping[str, Any],
    *,
    result_ref: str | None,
    trace_refs: list[str],
    minimum_action_count: int | None,
    requires_current_step_screenshots: bool,
    forbid_prior_round_completion_evidence: bool,
    requires_directory_evidence: bool,
    required_input_modalities: Sequence[str],
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    result = _load_target_bound_workflow_ref(result_ref, resolver=resolver, kind="result", errors=errors)
    traces = [
        trace
        for trace_ref in trace_refs
        if (trace := _load_target_bound_workflow_ref(trace_ref, resolver=resolver, kind="trace", errors=errors)) is not None
    ]

    workflow_payloads: list[Mapping[str, Any]] = [evidence]
    resolved_workflow_payloads: list[Mapping[str, Any]] = []
    if result is not None:
        workflow_payloads.append(result)
        resolved_workflow_payloads.append(result)
    workflow_payloads.extend(traces)
    resolved_workflow_payloads.extend(traces)

    if result is None:
        errors.append(_repair_replay_error(
            "workflow_result_ref_unreadable",
            "Target-bound workflow requirements require a readable resultRef.",
            "$.resultRef",
            actual=result_ref,
        ))
    elif result.get("status") != "completed":
        errors.append(_repair_replay_error(
            "workflow_result_not_completed",
            "Target-bound workflow resultRef must resolve to completed result evidence.",
            "$.resultRef.status",
            expected="completed",
            actual=result.get("status"),
        ))
    if not traces:
        errors.append(_repair_replay_error(
            "workflow_trace_refs_unreadable",
            "Target-bound workflow requirements require at least one readable traceRef.",
            "$.traceRefs",
            actual=trace_refs,
        ))
    for index, trace in enumerate(traces):
        if trace.get("status") != "completed":
            errors.append(_repair_replay_error(
                "workflow_trace_not_completed",
                "Target-bound workflow traceRefs must resolve to completed trace evidence.",
                f"$.traceRefs[{index}].status",
                expected="completed",
                actual=trace.get("status"),
            ))

    step_source = result if result is not None and isinstance(result.get("steps"), list) else _first_trace_with_steps(traces)
    steps = list(step_source.get("steps") or []) if step_source is not None else []
    if minimum_action_count is not None and len(steps) < minimum_action_count:
        errors.append(_repair_replay_error(
            "minimum_action_count_not_met",
            "Target-bound workflow evidence has fewer action steps than required.",
            "$.workflowRequirements.minimumActionCount",
            expected=minimum_action_count,
            actual=len(steps),
        ))
    if required_input_modalities:
        observed_modalities = _observed_input_modalities(steps)
        event_log_summary = _target_bound_input_event_log_summary(workflow_payloads, resolver=resolver)
        errors.extend(event_log_summary["errors"])
        for modality in required_input_modalities:
            if modality not in observed_modalities:
                errors.append(_repair_replay_error(
                    "required_input_modality_missing",
                    "Target-bound workflow evidence is missing a required input modality.",
                    "$.workflowRequirements.requiredInputModalities",
                    expected=modality,
                    actual=sorted(observed_modalities),
                ))
                break
            if (
                modality in event_log_summary["specificRefsSeen"]
                and modality not in event_log_summary["specificModalities"]
            ):
                errors.append(_repair_replay_error(
                    "required_input_event_log_missing",
                    "Target-bound workflow evidence is missing events in the required modality-specific input log.",
                    "$.workflowRequirements.requiredInputModalities",
                    expected=modality,
                    actual=sorted(event_log_summary["specificModalities"]),
                ))
                break
            if modality not in event_log_summary["modalities"]:
                errors.append(_repair_replay_error(
                    "required_input_event_log_missing",
                    "Target-bound workflow evidence is missing a required target input event log modality.",
                    "$.workflowRequirements.requiredInputModalities",
                    expected=modality,
                    actual=sorted(event_log_summary["modalities"]),
                ))
                break
            required_step_indexes = _step_indexes_for_modality(steps, modality)
            if required_step_indexes and required_step_indexes.isdisjoint(event_log_summary["actionIndexesByModality"].get(modality, set())):
                errors.append(_repair_replay_error(
                    "required_input_event_action_index_missing",
                    "Target-bound input event logs must reference the action index that exercised the required modality.",
                    "$.workflowRequirements.requiredInputModalities",
                    expected=sorted(required_step_indexes),
                    actual=sorted(event_log_summary["actionIndexesByModality"].get(modality, set())),
                ))
                break
    if requires_current_step_screenshots:
        for index, step in enumerate(steps):
            if not isinstance(step, Mapping) or not _step_current_screenshot_refs(step):
                errors.append(_repair_replay_error(
                    "current_step_screenshot_ref_missing",
                    "Each target-bound workflow step must include a current screenshot or observation ref.",
                    f"$.steps[{index}]",
                ))
                break

    final_visual_ref = _string_or_none(evidence.get("finalScreenshotRef"))
    if not final_visual_ref or not _looks_like_screenshot_ref(final_visual_ref):
        errors.append(_repair_replay_error(
            "final_visual_ref_missing",
            "Target-bound workflow evidence requires a final visual screenshot ref.",
            "$.finalScreenshotRef",
            actual=final_visual_ref,
        ))
    final_artifact_ref = _string_or_none(evidence.get("finalArtifactRef"))
    final_artifact_refs = _unique_strings([
        *[
            ref
            for payload in resolved_workflow_payloads
            for ref in _target_bound_final_artifact_refs(payload)
        ],
    ])
    if final_artifact_ref and final_artifact_ref not in final_artifact_refs:
        errors.append(_repair_replay_error(
            "final_artifact_ref_not_in_result_or_trace",
            "Target-bound workflow finalArtifactRef must be visible in result or trace refs.",
            "$.finalArtifactRef",
            actual=final_artifact_ref,
        ))
    errors.extend(_target_bound_artifact_causality_errors(
        evidence,
        workflow_payloads,
        steps=steps,
        resolver=resolver,
    ))
    if requires_directory_evidence:
        file_list_artifact_ref = _string_or_none(evidence.get("fileListArtifactRef"))
        file_list_data_ref = _string_or_none(evidence.get("fileListDataRef"))
        directory_refs = _target_bound_directory_refs(resolved_workflow_payloads)
        if file_list_artifact_ref and file_list_artifact_ref not in directory_refs["artifactRefs"] and file_list_artifact_ref not in directory_refs["allRefs"]:
            errors.append(_repair_replay_error(
                "file_list_artifact_ref_not_in_result_or_trace",
                "Target-bound workflow fileListArtifactRef must be visible in result or trace refs.",
                "$.fileListArtifactRef",
                actual=file_list_artifact_ref,
            ))
        if file_list_data_ref and file_list_data_ref not in directory_refs["dataRefs"] and file_list_data_ref not in directory_refs["allRefs"]:
            errors.append(_repair_replay_error(
                "file_list_data_ref_not_in_result_or_trace",
                "Target-bound workflow fileListDataRef must be visible in result or trace refs.",
                "$.fileListDataRef",
                actual=file_list_data_ref,
            ))

    if forbid_prior_round_completion_evidence:
        for issue in _prior_round_completion_evidence_issues(workflow_payloads):
            errors.append(_repair_replay_error(
                "prior_round_completion_evidence_forbidden",
                issue,
                "$",
            ))
            break
    return errors


def _load_target_bound_workflow_ref(
    ref: str | None,
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
    kind: str,
    errors: list[dict[str, Any]],
) -> Mapping[str, Any] | None:
    if not ref:
        return None
    try:
        payload, _ = _load_repair_mapping_with_ref(ref, resolver=resolver)
    except (OSError, json.JSONDecodeError, TypeError) as exc:
        errors.append(_repair_replay_error(
            f"workflow_{kind}_ref_load_failed",
            f"Target-bound workflow {kind} ref could not be loaded: {exc}.",
            "$",
            actual=ref,
        ))
        return None
    return payload


def _first_trace_with_steps(traces: list[Mapping[str, Any]]) -> Mapping[str, Any] | None:
    for trace in traces:
        if isinstance(trace.get("steps"), list):
            return trace
    return None


def _step_current_screenshot_refs(step: Mapping[str, Any]) -> list[str]:
    return _unique_strings([
        *[
            ref for key in (
                "afterRef",
                "currentObservationRef",
                "observationRef",
                "screenshotRef",
                "currentScreenshotRef",
            )
            if (ref := _string_or_none(step.get(key))) and _looks_like_screenshot_ref(ref)
        ],
        *_refs_from_explicit_list(step.get("screenshotRefs")),
        *_collect_screenshot_refs(step.get("observation")),
        *_collect_screenshot_refs(step.get("currentObservation")),
    ])


def _workflow_required_input_modalities(value: Any) -> list[str]:
    if isinstance(value, str):
        candidates = [value]
    elif isinstance(value, Sequence) and not isinstance(value, (bytes, bytearray)):
        candidates = [str(item) for item in value]
    else:
        candidates = []
    modalities: list[str] = []
    for candidate in candidates:
        normalized = candidate.strip().replace("_", "-").lower()
        if normalized in {"mouse", "pointer", "click", "scroll", "drag"}:
            normalized = "pointer"
        elif normalized in {"keyboard", "key", "typing", "text"}:
            normalized = "keyboard"
        if normalized in {"pointer", "keyboard"} and normalized not in modalities:
            modalities.append(normalized)
    return modalities


def _observed_input_modalities(steps: Sequence[Any]) -> set[str]:
    observed: set[str] = set()
    for step in steps:
        if not isinstance(step, Mapping):
            continue
        action = _mapping(step.get("action"))
        kind = _string_or_none(action.get("kind")) or _string_or_none(action.get("type"))
        observed.update(_input_modalities_for_action_kind(kind))
        execution = _mapping(step.get("execution"))
        metadata = _mapping(execution.get("metadata"))
        observed.update(_workflow_required_input_modalities(metadata.get("inputModalities")))
        observed.update(_workflow_required_input_modalities(metadata.get("inputModality")))
    return observed


def _input_modalities_for_action_kind(kind: str | None) -> set[str]:
    normalized = (kind or "").strip().lower()
    modalities: set[str] = set()
    if normalized in {"click", "double_click", "drag", "scroll", "focus"}:
        modalities.add("pointer")
    if normalized in {"type_text", "press_key", "hotkey", "save"}:
        modalities.add("keyboard")
    return modalities


def _step_indexes_for_modality(steps: Sequence[Any], modality: str) -> set[int]:
    indexes: set[int] = set()
    for fallback_index, step in enumerate(steps):
        if not isinstance(step, Mapping):
            continue
        action = _mapping(step.get("action"))
        kind = _string_or_none(action.get("kind")) or _string_or_none(action.get("type"))
        if modality not in _input_modalities_for_action_kind(kind):
            execution = _mapping(step.get("execution"))
            metadata = _mapping(execution.get("metadata"))
            if modality not in _workflow_required_input_modalities(metadata.get("inputModalities")):
                continue
        step_index = _int_or_none(step.get("index"))
        indexes.add(fallback_index if step_index is None else step_index)
    return indexes


def _target_bound_input_event_log_summary(
    payloads: Sequence[Mapping[str, Any]],
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> dict[str, Any]:
    refs = _target_bound_input_event_log_refs(payloads)
    modalities: set[str] = set()
    specific_modalities: set[str] = set()
    specific_refs_seen: set[str] = set()
    action_indexes_by_modality: dict[str, set[int]] = {"pointer": set(), "keyboard": set()}
    errors: list[dict[str, Any]] = []
    for ref in refs:
        try:
            payload, _ = _load_repair_mapping_with_ref(ref, resolver=resolver)
        except (OSError, json.JSONDecodeError, TypeError, UnicodeDecodeError) as exc:
            errors.append(_repair_replay_error(
                "input_event_log_ref_unreadable",
                f"Target-bound input event log ref could not be loaded: {exc}.",
                "$.realWindowEvidenceRefs",
                actual=ref,
            ))
            continue
        schema = _string_or_none(payload.get("schemaVersion")) or ""
        event_modality: str | None = None
        if schema.endswith(".target-pointer-state.v1"):
            event_modality = "pointer"
        elif schema.endswith(".target-keyboard-state.v1"):
            event_modality = "keyboard"
        if event_modality is not None:
            specific_refs_seen.add(event_modality)
        events = _list_of_mappings(payload.get("events"))
        event_count = _int_or_none(payload.get("eventCount"))
        if event_count is not None and event_count != len(events):
            errors.append(_repair_replay_error(
                "input_event_log_count_mismatch",
                "Target-bound input event log eventCount must match events length.",
                "$.realWindowEvidenceRefs",
                expected=event_count,
                actual=len(events),
            ))
        for event in events:
            modality = event_modality or _string_or_none(event.get("modality"))
            if modality not in {"pointer", "keyboard"}:
                continue
            modalities.add(modality)
            if event_modality == modality:
                specific_modalities.add(modality)
            action_index = _int_or_none(event.get("actionIndex"))
            if action_index is not None:
                action_indexes_by_modality[modality].add(action_index)
    return {
        "modalities": modalities,
        "specificModalities": specific_modalities,
        "specificRefsSeen": specific_refs_seen,
        "actionIndexesByModality": action_indexes_by_modality,
        "errors": errors,
    }


_TARGET_BOUND_INPUT_EVENT_REF_KEYS = {
    "targetPointerStateRef",
    "targetKeyboardStateRef",
    "targetInputEventLogRef",
    "pointerEventLogRef",
    "keyboardEventLogRef",
    "inputEventLogRef",
}


def _target_bound_input_event_log_refs(payloads: Sequence[Mapping[str, Any]]) -> list[str]:
    refs: list[str] = []
    for payload in payloads:
        refs.extend(_collect_refs_by_keys(payload, _TARGET_BOUND_INPUT_EVENT_REF_KEYS))
        refs.extend(ref for ref in _refs_from_explicit_list(payload.get("realWindowEvidenceRefs")) if ref.endswith(".json"))
    return _unique_strings(refs)


def _collect_refs_by_keys(value: Any, keys: set[str]) -> list[str]:
    refs: list[str] = []
    if isinstance(value, Mapping):
        for key, item in value.items():
            if key in keys and isinstance(item, str) and item:
                refs.append(item)
            else:
                refs.extend(_collect_refs_by_keys(item, keys))
    elif isinstance(value, list):
        for item in value:
            refs.extend(_collect_refs_by_keys(item, keys))
    return refs


def _target_bound_final_artifact_refs(payload: Mapping[str, Any]) -> list[str]:
    return _unique_strings([
        *(_refs_inside(payload.get("finalArtifactRef"), prefer_image=False) if payload.get("finalArtifactRef") else []),
        *_refs_from_explicit_list(payload.get("finalArtifactRefs")),
        *_collect_final_artifact_refs(payload),
    ])


def _target_bound_directory_refs(payloads: list[Mapping[str, Any]]) -> dict[str, list[str]]:
    artifact_refs: list[str] = []
    data_refs: list[str] = []
    all_refs: list[str] = []
    for payload in payloads:
        explicit_artifact_ref = _string_or_none(payload.get("fileListArtifactRef"))
        explicit_data_ref = _string_or_none(payload.get("fileListDataRef"))
        if explicit_artifact_ref:
            artifact_refs.append(explicit_artifact_ref)
            all_refs.append(explicit_artifact_ref)
        if explicit_data_ref:
            data_refs.append(explicit_data_ref)
            all_refs.append(explicit_data_ref)
        all_refs.extend(_refs_from_explicit_list(payload.get("artifactRefs")))
        all_refs.extend(_refs_from_explicit_list(payload.get("finalArtifactRefs")))
        direct_final_ref = _string_or_none(payload.get("finalArtifactRef"))
        if direct_final_ref:
            all_refs.append(direct_final_ref)
        refs = _trace_directory_evidence_refs(payload, _refs_from_explicit_list(payload.get("artifactRefs")))
        artifact_refs.extend(refs["artifactRefs"])
        data_refs.extend(refs["dataRefs"])
        all_refs.extend(refs["artifactRefs"])
        all_refs.extend(refs["dataRefs"])
    return {
        "artifactRefs": _unique_strings(artifact_refs),
        "dataRefs": _unique_strings(data_refs),
        "allRefs": _unique_strings(all_refs),
    }


def _target_bound_artifact_causality_errors(
    evidence: Mapping[str, Any],
    payloads: Sequence[Mapping[str, Any]],
    *,
    steps: Sequence[Any],
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> list[dict[str, Any]]:
    final_artifact_ref = _string_or_none(evidence.get("finalArtifactRef"))
    if not final_artifact_ref:
        return []
    metadata_candidates = _artifact_metadata_candidates(payloads)
    if not metadata_candidates:
        return []
    matching_metadata = [
        metadata
        for metadata in metadata_candidates
        if _string_or_none(metadata.get("finalArtifactRef")) == final_artifact_ref
    ]
    if not matching_metadata:
        return [_repair_replay_error(
            "artifact_causality_final_ref_mismatch",
            "Target-bound artifact metadata must name the same finalArtifactRef as the evidence.",
            "$.metadata.artifactMetadata.finalArtifactRef",
            expected=final_artifact_ref,
            actual=[metadata.get("finalArtifactRef") for metadata in metadata_candidates],
        )]
    metadata = matching_metadata[0]
    save_action_index = _int_or_none(metadata.get("savedByActionIndex"))
    if save_action_index is None:
        return [_repair_replay_error(
            "artifact_save_action_index_missing",
            "Target-bound artifact metadata must include savedByActionIndex.",
            "$.metadata.artifactMetadata.savedByActionIndex",
        )]
    save_step = _step_by_action_index(steps, save_action_index)
    if not save_step:
        return [_repair_replay_error(
            "artifact_save_action_index_missing",
            "savedByActionIndex must point to a workflow step.",
            "$.metadata.artifactMetadata.savedByActionIndex",
            actual=save_action_index,
        )]
    action = _mapping(save_step.get("action"))
    if not _is_save_action(action):
        return [_repair_replay_error(
            "artifact_save_action_not_found",
            "savedByActionIndex must point to a generic save action such as save or Ctrl/Cmd+S.",
            "$.metadata.artifactMetadata.savedByActionIndex",
            actual=action,
        )]
    event_log_summary = _target_bound_input_event_log_summary(payloads, resolver=resolver)
    keyboard_action_indexes = event_log_summary["actionIndexesByModality"].get("keyboard", set())
    errors = list(event_log_summary["errors"])
    if save_action_index not in keyboard_action_indexes:
        errors.append(_repair_replay_error(
            "artifact_save_keyboard_event_missing",
            "The save action that caused the artifact must have a matching keyboard input event.",
            "$.metadata.artifactMetadata.savedByActionIndex",
            expected=save_action_index,
            actual=sorted(keyboard_action_indexes),
        ))
    return errors


def _artifact_metadata_candidates(payloads: Sequence[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    candidates: list[Mapping[str, Any]] = []
    for payload in payloads:
        for key in ("artifactMetadata", "artifactCausality"):
            value = payload.get(key)
            if _is_artifact_causality_metadata(value):
                candidates.append(value)
        diagnostics = _mapping(payload.get("failureDiagnostics"))
        value = diagnostics.get("artifactMetadata")
        if _is_artifact_causality_metadata(value):
            candidates.append(value)
        metadata = _mapping(payload.get("metadata"))
        value = metadata.get("artifactMetadata")
        if _is_artifact_causality_metadata(value):
            candidates.append(value)
        for step in _list_of_mappings(payload.get("steps")):
            execution_metadata = _mapping(_mapping(step.get("execution")).get("metadata"))
            value = execution_metadata.get("artifactCausality")
            if _is_artifact_causality_metadata(value):
                candidates.append(value)
    return candidates


def _is_artifact_causality_metadata(value: Any) -> bool:
    return isinstance(value, Mapping) and any(
        key in value
        for key in ("finalArtifactRef", "savedByActionIndex", "savedByInputModality", "artifactValidationRef", "pptxValidationRef")
    )


def _step_by_action_index(steps: Sequence[Any], action_index: int) -> Mapping[str, Any]:
    for fallback_index, step in enumerate(steps):
        if not isinstance(step, Mapping):
            continue
        step_index = _int_or_none(step.get("index"))
        if (fallback_index if step_index is None else step_index) == action_index:
            return step
    return {}


def _is_save_action(action: Mapping[str, Any]) -> bool:
    kind = (_string_or_none(action.get("kind")) or _string_or_none(action.get("type")) or "").lower()
    if kind == "save":
        return True
    if kind not in {"press_key", "hotkey"}:
        return False
    key_text = " ".join(str(item) for item in action.get("keys") or [])
    key_text = _string_or_none(action.get("key")) or key_text
    normalized = key_text.replace(" ", "").replace("-", "+").lower()
    return normalized in {"ctrl+s", "cmd+s", "meta+s", "super+s", "control+s", "command+s"}


def _prior_round_completion_evidence_issues(payloads: list[Mapping[str, Any]]) -> list[str]:
    issues: list[str] = []
    for index, payload in enumerate(payloads):
        _collect_prior_round_completion_evidence_issues(payload, issues, path=f"$[{index}]")
    return _unique_strings(issues)


def _collect_prior_round_completion_evidence_issues(value: Any, issues: list[str], *, path: str) -> None:
    if isinstance(value, Mapping):
        for key, item in value.items():
            key_text = str(key)
            normalized = key_text.replace("_", "").replace("-", "").lower()
            if normalized in {
                "historicaldone",
                "ledgerdone",
                "priorrounddone",
                "priorroundcompletionevidence",
                "priorroundledgerdone",
            } and _truthy_metadata_flag(item):
                issues.append(f"Prior-round completion key {key_text!r} is forbidden at {path}.")
            if normalized in {"completionevidencesource", "donesource"} and isinstance(item, str):
                compact = item.replace("_", "").replace("-", "").lower()
                if "prior" in compact or "ledger" in compact or "historical" in compact:
                    issues.append(f"Prior-round completion source {key_text!r} is forbidden at {path}.")
            _collect_prior_round_completion_evidence_issues(item, issues, path=f"{path}.{key_text}")
        return
    if isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            _collect_prior_round_completion_evidence_issues(item, issues, path=f"{path}[{index}]")

