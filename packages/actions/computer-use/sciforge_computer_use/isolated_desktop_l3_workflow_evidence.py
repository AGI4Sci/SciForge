"""Evidence contract for real isolated desktop L3 multi-app workflows."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence
from urllib.parse import urlparse

from .isolated_desktop_contracts import (
    BACKEND_READINESS_PROOF_SCHEMA_VERSION,
    BACKEND_KIND,
    EXECUTOR_COMMAND_EVENT_LOG_SCHEMA,
    ISOLATED_CAPTURE_SOURCE,
    ISOLATED_TARGET_WINDOW_SCHEMA_VERSION,
    REMOTE_DESKTOP_INPUT_CHANNEL,
)
from .isolated_desktop_preflight_evidence import (
    REQUIRED_BACKEND_COMPONENTS,
    validate_isolated_desktop_backend_preflight_payload,
)
from .isolated_desktop_runtime_proof_evidence import (
    display_id as _display_id,
    session_id as _session_id,
    validate_backend_process_payload,
    validate_runtime_resource_allocation_payload,
)
from .isolated_desktop_window_bound_pointer_evidence import (
    _load_window_bound_pointer_context,
    _validate_pointer_event_window_binding,
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


ISOLATED_DESKTOP_L3_WORKFLOW_EVIDENCE_SCHEMA_VERSION = (
    "sciforge.computer-use.isolated-desktop-l3-workflow-evidence.v1"
)
ISOLATED_DESKTOP_L3_WORKFLOW_EVIDENCE_VALIDATION_SCHEMA_VERSION = (
    "sciforge.computer-use.isolated-desktop-l3-workflow-evidence-validation.v1"
)
L3_ACCEPTANCE_TIER = "l3-multi-app-workflow"
L3_WORKFLOW_KIND = "multi-app-document-artifact"
REQUIRED_TOP_LEVEL_REFS = (
    "preflightRef",
    "resultRef",
    "viewerManifestRef",
    "viewerHtmlRef",
    "inputEventLogRef",
    "pointerEventLogRef",
    "keyboardEventLogRef",
    "backendReadinessProofRef",
    "executorCommandEventLogRef",
    "targetWindowRef",
    "windowBoundPointerProofRef",
    "processRef",
    "resourceAllocationRef",
    "sessionManifestRef",
    "virtualDisplayRef",
    "captureStreamRef",
    "replayBundleRef",
    "filesystemRootRef",
    "noVncViewerRef",
    "evidenceLogRef",
    "evidenceSnapshotRef",
    "evidenceIndexRef",
    "plannerBriefRef",
    "finalArtifactRef",
    "artifactValidationRef",
    "fileListArtifactRef",
    "fileListDataRef",
    "guiPresentRef",
)


def build_isolated_desktop_l3_workflow_evidence(
    *,
    payload: Mapping[str, Any],
    require_existing_refs: bool = True,
) -> dict[str, Any]:
    """Return a validated L3 evidence payload without synthesizing success."""

    evidence = dict(payload)
    validation = validate_isolated_desktop_l3_workflow_evidence(
        evidence,
        require_existing_refs=require_existing_refs,
    )
    evidence["status"] = "completed" if validation["ok"] else "blocked"
    if validation["ok"]:
        evidence.setdefault("evidenceKind", "isolated-L3")
        workflow = evidence.get("l3Workflow")
        if isinstance(workflow, dict):
            workflow.setdefault("sameSession", True)
            workflow.setdefault("sourceToWriterToPreviewCausality", True)
    evidence["reason"] = (
        "Isolated desktop L3 multi-app workflow evidence satisfies the contract."
        if validation["ok"]
        else "; ".join(error["message"] for error in validation["errors"])
    )
    evidence["errors"] = validation["errors"]
    return evidence


def validate_isolated_desktop_l3_workflow_evidence(
    evidence_or_ref: Mapping[str, Any] | str | Path,
    *,
    require_existing_refs: bool = True,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None = None,
) -> dict[str, Any]:
    """Validate that a payload can claim real L3 multi-app acceptance."""

    try:
        evidence, evidence_ref = _load_repair_mapping_with_ref(evidence_or_ref, resolver=resolver)
    except (OSError, json.JSONDecodeError, TypeError) as exc:
        return _validation_result(
            None,
            evidence_ref=str(evidence_or_ref),
            errors=[_repair_replay_error("evidence_load_failed", f"Isolated desktop L3 evidence could not be loaded: {exc}.", "$")],
            require_existing_refs=require_existing_refs,
        )

    ref_resolver = resolver or _bundle_resolver_from_evidence_ref(evidence_ref)

    errors: list[dict[str, Any]] = []
    _validate_top_level(evidence, errors)
    _validate_refs(evidence, errors, require_existing_refs=require_existing_refs, resolver=ref_resolver)
    _validate_workflow_blocks(evidence, errors)
    _validate_application_evidence(evidence, errors)
    _validate_source_and_artifact_causality(evidence, errors)
    _validate_presentation_evidence(evidence, errors)
    _validate_resolved_evidence_refs(evidence, errors, require_existing_refs=require_existing_refs, resolver=ref_resolver)
    for issue in _inline_payload_issues(evidence):
        errors.append(_repair_replay_error("inline_payload_forbidden", issue, "$"))
    if require_existing_refs:
        errors.extend(_existing_ref_errors(
            _all_refs(evidence),
            bundle_root=_bundle_root_from_evidence_ref(evidence_ref),
        ))
    return _validation_result(
        evidence,
        evidence_ref=evidence_ref,
        errors=errors,
        require_existing_refs=require_existing_refs,
    )


def _validate_top_level(evidence: Mapping[str, Any], errors: list[dict[str, Any]]) -> None:
    if evidence.get("schemaVersion") != ISOLATED_DESKTOP_L3_WORKFLOW_EVIDENCE_SCHEMA_VERSION:
        errors.append(_repair_replay_error(
            "unsupported_schema_version",
            "Isolated desktop L3 evidence schemaVersion is invalid.",
            "$.schemaVersion",
            expected=ISOLATED_DESKTOP_L3_WORKFLOW_EVIDENCE_SCHEMA_VERSION,
            actual=evidence.get("schemaVersion"),
        ))
    if evidence.get("status") != "completed":
        errors.append(_repair_replay_error("status_not_completed", "Isolated desktop L3 evidence status must be completed.", "$.status", expected="completed", actual=evidence.get("status")))
    if evidence.get("acceptanceTier") != L3_ACCEPTANCE_TIER:
        errors.append(_repair_replay_error("acceptance_tier_not_l3", "Isolated desktop L3 evidence requires acceptanceTier=l3-multi-app-workflow.", "$.acceptanceTier", expected=L3_ACCEPTANCE_TIER, actual=evidence.get("acceptanceTier")))
    if evidence.get("userAcceptanceEligible") is not True:
        errors.append(_repair_replay_error("user_acceptance_not_eligible", "L3 evidence must explicitly be user acceptance eligible.", "$.userAcceptanceEligible", expected=True, actual=evidence.get("userAcceptanceEligible")))
    if evidence.get("backendKind") != BACKEND_KIND:
        errors.append(_repair_replay_error("backend_kind_not_supported", "L3 evidence requires the real Linux noVNC backend.", "$.backendKind", expected=BACKEND_KIND, actual=evidence.get("backendKind")))
    if evidence.get("captureSource") != ISOLATED_CAPTURE_SOURCE:
        errors.append(_repair_replay_error("capture_source_not_isolated_display", "L3 evidence must capture from the isolated virtual display.", "$.captureSource", expected=ISOLATED_CAPTURE_SOURCE, actual=evidence.get("captureSource")))
    if evidence.get("inputChannel") != REMOTE_DESKTOP_INPUT_CHANNEL:
        errors.append(_repair_replay_error("input_channel_not_remote_desktop", "L3 evidence must use remote-desktop isolated input.", "$.inputChannel", expected=REMOTE_DESKTOP_INPUT_CHANNEL, actual=evidence.get("inputChannel")))
    target_environment_kind = _string_or_none(evidence.get("targetEnvironmentKind")) or ""
    if not target_environment_kind or _target_environment_is_package_or_diagnostic(target_environment_kind):
        errors.append(_repair_replay_error("target_environment_kind_not_real_backend", "L3 evidence cannot use package-owned, diagnostic, fixture, mock, virtual, or state-only target environments.", "$.targetEnvironmentKind", actual=target_environment_kind))
    for key, expected in {
        "preflightStatus": "ready",
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
        if evidence.get(key) != expected:
            errors.append(_repair_replay_error("l3_flag_mismatch", f"L3 evidence requires {key}={expected!r}.", f"$.{key}", expected=expected, actual=evidence.get(key)))


def _validate_refs(
    evidence: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    require_existing_refs: bool,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> None:
    for key in REQUIRED_TOP_LEVEL_REFS:
        if not _string_or_none(evidence.get(key)):
            errors.append(_repair_replay_error("required_ref_missing", f"{key} is required for L3 workflow evidence.", f"$.{key}"))
    if not _refs_from_explicit_list(evidence.get("traceRefs")):
        errors.append(_repair_replay_error("trace_refs_missing", "traceRefs are required.", "$.traceRefs"))
    if not require_existing_refs:
        errors.append(_repair_replay_error(
            "existing_refs_required_for_l3",
            "L3 workflow acceptance requires readable existing refs; shape-only validation cannot be user acceptance eligible.",
            "$",
            expected=True,
            actual=False,
        ))
    screenshot_refs = _refs_from_explicit_list(evidence.get("screenshotRefs"))
    if len(screenshot_refs) < 3:
        errors.append(_repair_replay_error("screenshot_refs_too_few", "L3 evidence requires multiple current app screenshots.", "$.screenshotRefs", expected=">=3", actual=len(screenshot_refs)))
    bad_screenshot_refs = [ref for ref in screenshot_refs if not _looks_like_screenshot_ref(ref)]
    if bad_screenshot_refs:
        errors.append(_repair_replay_error("screenshot_refs_not_images", "L3 screenshotRefs must point to image refs.", "$.screenshotRefs", actual=bad_screenshot_refs))
    final_artifact_ref = _string_or_none(evidence.get("finalArtifactRef"))
    if final_artifact_ref and _looks_like_screenshot_ref(final_artifact_ref):
        errors.append(_repair_replay_error("final_artifact_ref_not_document_artifact", "L3 finalArtifactRef must be a document/artifact ref, not a screenshot.", "$.finalArtifactRef", actual=final_artifact_ref))
    if require_existing_refs:
        filesystem_root_ref = _string_or_none(evidence.get("filesystemRootRef"))
        filesystem_root_path = _resolved_path_from_ref(filesystem_root_ref, resolver=resolver)
        if filesystem_root_ref and (filesystem_root_path is None or not filesystem_root_path.is_dir()):
            errors.append(_repair_replay_error("filesystem_root_ref_not_directory", "filesystemRootRef must point to an existing local directory.", "$.filesystemRootRef", actual=filesystem_root_ref))
        _validate_screenshot_content_diversity(evidence, errors, resolver=resolver)


def _validate_workflow_blocks(evidence: Mapping[str, Any], errors: list[dict[str, Any]]) -> None:
    workflow = _mapping(evidence.get("l3Workflow"))
    if workflow.get("status") != "completed":
        errors.append(_repair_replay_error("l3_workflow_status_not_completed", "l3Workflow.status must be completed.", "$.l3Workflow.status", expected="completed", actual=workflow.get("status")))
    if workflow.get("completed") is not True:
        errors.append(_repair_replay_error("l3_workflow_not_completed", "l3Workflow.completed must be true.", "$.l3Workflow.completed", expected=True, actual=workflow.get("completed")))
    if workflow.get("workflowKind") != L3_WORKFLOW_KIND:
        errors.append(_repair_replay_error("l3_workflow_kind_invalid", "l3Workflow.workflowKind must be multi-app-document-artifact.", "$.l3Workflow.workflowKind", expected=L3_WORKFLOW_KIND, actual=workflow.get("workflowKind")))
    if workflow.get("sameVirtualSession") is not True:
        errors.append(_repair_replay_error("l3_workflow_not_same_session", "L3 workflow must prove all apps ran in the same virtual session.", "$.l3Workflow.sameVirtualSession", expected=True, actual=workflow.get("sameVirtualSession")))

    requirements = _mapping(evidence.get("workflowRequirements"))
    if (_int_or_none(requirements.get("minimumAppCount")) or 0) < 3:
        errors.append(_repair_replay_error("minimum_app_count_not_met", "L3 workflow must require at least three app roles.", "$.workflowRequirements.minimumAppCount", expected=">=3", actual=requirements.get("minimumAppCount")))
    for key in (
        "requiresCurrentStepScreenshots",
        "forbidPriorRoundCompletionEvidence",
        "requiresDirectoryEvidence",
        "requiresArtifactPreview",
        "requiresWindowBoundPointerProof",
    ):
        if requirements.get(key) is not True:
            errors.append(_repair_replay_error("workflow_requirement_must_be_true", f"L3 workflow requires {key}=true.", f"$.workflowRequirements.{key}", expected=True, actual=requirements.get(key)))
    modalities = _required_modalities(requirements.get("requiredInputModalities"))
    if not {"pointer", "keyboard"}.issubset(set(modalities)):
        errors.append(_repair_replay_error("required_input_modalities_missing", "L3 workflow must require pointer and keyboard input.", "$.workflowRequirements.requiredInputModalities", expected=["pointer", "keyboard"], actual=modalities))


def _validate_application_evidence(evidence: Mapping[str, Any], errors: list[dict[str, Any]]) -> None:
    applications = _list_of_mappings(evidence.get("applicationEvidence"))
    if len(applications) < 3:
        errors.append(_repair_replay_error("application_evidence_too_few", "L3 evidence requires source, writer, and file preview app evidence.", "$.applicationEvidence", expected=">=3", actual=len(applications)))
    roles = {_app_role(app.get("appKind")) for app in applications}
    for role in ("source", "writer", "file-preview"):
        if role not in roles:
            errors.append(_repair_replay_error("application_role_missing", "L3 evidence is missing a required app role.", "$.applicationEvidence", expected=role, actual=sorted(roles)))
            break
    for index, app in enumerate(applications):
        session_ref = _string_or_none(app.get("sessionManifestRef")) or _string_or_none(app.get("sessionRef"))
        top_level_session_ref = _string_or_none(evidence.get("sessionManifestRef"))
        if not session_ref:
            errors.append(_repair_replay_error("application_session_ref_missing", "Each L3 app evidence block must cite the shared session manifest ref.", f"$.applicationEvidence[{index}].sessionManifestRef"))
            break
        if top_level_session_ref and session_ref != top_level_session_ref:
            errors.append(_repair_replay_error("application_session_ref_mismatch", "Each L3 app evidence block must use the top-level isolated session manifest ref.", f"$.applicationEvidence[{index}].sessionManifestRef", expected=top_level_session_ref, actual=session_ref))
            break
        first_ref = _string_or_none(app.get("firstScreenshotRef"))
        last_ref = _string_or_none(app.get("lastScreenshotRef"))
        if not first_ref or not last_ref:
            errors.append(_repair_replay_error("application_screenshot_refs_missing", "Each L3 app evidence block requires first/last screenshot refs.", f"$.applicationEvidence[{index}]"))
            break
        if not _looks_like_screenshot_ref(first_ref) or not _looks_like_screenshot_ref(last_ref):
            errors.append(_repair_replay_error("application_screenshot_refs_not_images", "Each L3 app evidence block must use image refs for first/last screenshots.", f"$.applicationEvidence[{index}]"))
            break
        refs = _refs_from_explicit_list(app.get("windowEvidenceRefs"))
        if not refs:
            errors.append(_repair_replay_error("application_window_evidence_refs_missing", "Each L3 app evidence block requires windowEvidenceRefs.", f"$.applicationEvidence[{index}].windowEvidenceRefs"))
            break
    transitions = _list_of_mappings(evidence.get("crossAppTransitions"))
    if len(transitions) < 2:
        errors.append(_repair_replay_error("cross_app_transitions_too_few", "L3 evidence requires current screenshot-backed app transitions.", "$.crossAppTransitions", expected=">=2", actual=len(transitions)))
    for index, transition in enumerate(transitions):
        session_ref = _string_or_none(transition.get("sessionManifestRef")) or _string_or_none(transition.get("sessionRef"))
        top_level_session_ref = _string_or_none(evidence.get("sessionManifestRef"))
        if not session_ref:
            errors.append(_repair_replay_error("cross_app_transition_session_ref_missing", "Each L3 cross-app transition must cite the shared session manifest ref.", f"$.crossAppTransitions[{index}].sessionManifestRef"))
            break
        if top_level_session_ref and session_ref != top_level_session_ref:
            errors.append(_repair_replay_error("cross_app_transition_session_ref_mismatch", "Each L3 cross-app transition must stay inside the same isolated session.", f"$.crossAppTransitions[{index}].sessionManifestRef", expected=top_level_session_ref, actual=session_ref))
            break
        if not _transition_screenshot_refs(transition):
            errors.append(_repair_replay_error("cross_app_transition_screenshot_missing", "Each L3 cross-app transition requires a current screenshot ref.", f"$.crossAppTransitions[{index}]"))
            break


def _validate_source_and_artifact_causality(evidence: Mapping[str, Any], errors: list[dict[str, Any]]) -> None:
    source = _mapping(evidence.get("sourceEvidence"))
    source_observation_refs = _refs_from_explicit_list(source.get("sourceObservationRefs"))
    source_fact_refs = _refs_from_explicit_list(source.get("sourceFactRefs"))
    if not source_observation_refs:
        errors.append(_repair_replay_error("source_observation_refs_missing", "L3 sourceEvidence requires sourceObservationRefs.", "$.sourceEvidence.sourceObservationRefs"))
    if not source_fact_refs:
        errors.append(_repair_replay_error("source_fact_refs_missing", "L3 sourceEvidence requires sourceFactRefs.", "$.sourceEvidence.sourceFactRefs"))
    derived = _mapping(evidence.get("derivedContentEvidence"))
    supported_fact_refs = _refs_from_explicit_list(derived.get("supportedFactRefs"))
    if not supported_fact_refs:
        errors.append(_repair_replay_error("derived_content_fact_refs_missing", "L3 derived content must cite source fact refs.", "$.derivedContentEvidence.supportedFactRefs"))
    elif source_fact_refs and not set(supported_fact_refs).issubset(set(source_fact_refs)):
        errors.append(_repair_replay_error("derived_content_fact_refs_not_source_backed", "L3 derived content may only cite facts observed from sourceEvidence.", "$.derivedContentEvidence.supportedFactRefs", expected=source_fact_refs, actual=supported_fact_refs))
    artifact = _mapping(evidence.get("artifactCausality"))
    if _int_or_none(artifact.get("savedByActionIndex")) is None:
        errors.append(_repair_replay_error("artifact_save_action_index_missing", "L3 artifactCausality requires savedByActionIndex.", "$.artifactCausality.savedByActionIndex"))
    if artifact.get("savedByInputModality") != "keyboard":
        errors.append(_repair_replay_error("artifact_save_keyboard_event_missing", "L3 artifact must be saved by keyboard input evidence.", "$.artifactCausality.savedByInputModality", expected="keyboard", actual=artifact.get("savedByInputModality")))
    if artifact.get("savedThroughGui") is not True:
        errors.append(_repair_replay_error("artifact_not_saved_through_gui", "L3 artifactCausality must prove the final artifact was saved through GUI input.", "$.artifactCausality.savedThroughGui", expected=True, actual=artifact.get("savedThroughGui")))
    if artifact.get("shellDirectArtifactWrite") is not False:
        errors.append(_repair_replay_error("artifact_shell_direct_write_not_forbidden", "L3 artifactCausality must explicitly forbid shell/direct artifact writes.", "$.artifactCausality.shellDirectArtifactWrite", expected=False, actual=artifact.get("shellDirectArtifactWrite")))
    if not _string_or_none(artifact.get("savedByCommandEventRef")):
        errors.append(_repair_replay_error("artifact_save_command_event_missing", "L3 artifactCausality requires savedByCommandEventRef for the GUI save input command.", "$.artifactCausality.savedByCommandEventRef"))
    final_artifact_ref = _string_or_none(evidence.get("finalArtifactRef"))
    artifact_final_ref = _string_or_none(artifact.get("finalArtifactRef"))
    if final_artifact_ref and artifact_final_ref != final_artifact_ref:
        errors.append(_repair_replay_error("artifact_causality_final_artifact_ref_mismatch", "artifactCausality.finalArtifactRef must match the top-level finalArtifactRef.", "$.artifactCausality.finalArtifactRef", expected=final_artifact_ref, actual=artifact_final_ref))
    artifact_validation_ref = _string_or_none(evidence.get("artifactValidationRef"))
    causality_validation_ref = _string_or_none(artifact.get("artifactValidationRef"))
    if artifact_validation_ref and causality_validation_ref != artifact_validation_ref:
        errors.append(_repair_replay_error("artifact_causality_validation_ref_mismatch", "artifactCausality.artifactValidationRef must match the top-level artifactValidationRef.", "$.artifactCausality.artifactValidationRef", expected=artifact_validation_ref, actual=causality_validation_ref))
    directory = _mapping(evidence.get("directoryEvidence"))
    for key in ("fileListArtifactRef", "fileListDataRef", "previewObservationRef", "directoryObservationAfterSaveRef"):
        if not _string_or_none(directory.get(key)):
            errors.append(_repair_replay_error("directory_evidence_ref_missing", f"L3 directoryEvidence requires {key}.", f"$.directoryEvidence.{key}"))
    if directory.get("previewedThroughGui") is not True:
        errors.append(_repair_replay_error("directory_preview_not_gui_backed", "L3 directoryEvidence must prove the saved artifact was previewed through GUI input.", "$.directoryEvidence.previewedThroughGui", expected=True, actual=directory.get("previewedThroughGui")))
    if directory.get("shellDirectoryListingOnly") is not False:
        errors.append(_repair_replay_error("directory_shell_listing_not_forbidden", "L3 directoryEvidence must explicitly reject shell-only directory listings as preview evidence.", "$.directoryEvidence.shellDirectoryListingOnly", expected=False, actual=directory.get("shellDirectoryListingOnly")))
    if _int_or_none(directory.get("previewedByActionIndex")) is None:
        errors.append(_repair_replay_error("directory_preview_action_index_missing", "L3 directoryEvidence requires previewedByActionIndex.", "$.directoryEvidence.previewedByActionIndex"))
    if directory.get("previewedByInputModality") != "pointer":
        errors.append(_repair_replay_error("directory_preview_input_modality_invalid", "L3 directory preview must be backed by pointer input evidence.", "$.directoryEvidence.previewedByInputModality", expected="pointer", actual=directory.get("previewedByInputModality")))
    for key in ("fileListArtifactRef", "fileListDataRef"):
        top_level_ref = _string_or_none(evidence.get(key))
        directory_ref = _string_or_none(directory.get(key))
        if top_level_ref and directory_ref and top_level_ref != directory_ref:
            errors.append(_repair_replay_error("directory_evidence_ref_mismatch", f"L3 directoryEvidence.{key} must match the top-level {key}.", f"$.directoryEvidence.{key}", expected=top_level_ref, actual=directory_ref))


def _validate_presentation_evidence(evidence: Mapping[str, Any], errors: list[dict[str, Any]]) -> None:
    presentation = _mapping(evidence.get("presentationEvidence"))
    gui_present_ref = _string_or_none(presentation.get("guiPresentRef"))
    tool_payload_ref = _string_or_none(presentation.get("toolPayloadRef"))
    top_level_gui_present_ref = _string_or_none(evidence.get("guiPresentRef"))
    if not gui_present_ref and not tool_payload_ref:
        errors.append(_repair_replay_error("presentation_evidence_ref_missing", "L3 evidence requires presentationEvidence.guiPresentRef or presentationEvidence.toolPayloadRef.", "$.presentationEvidence"))
    if top_level_gui_present_ref and gui_present_ref and top_level_gui_present_ref != gui_present_ref:
        errors.append(_repair_replay_error("presentation_gui_present_ref_mismatch", "presentationEvidence.guiPresentRef must match the top-level guiPresentRef.", "$.presentationEvidence.guiPresentRef", expected=top_level_gui_present_ref, actual=gui_present_ref))


def _validate_resolved_evidence_refs(
    evidence: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    require_existing_refs: bool,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> None:
    if not require_existing_refs:
        return
    _validate_preflight_payload(evidence, errors, resolver=resolver)
    result = _load_ref_mapping(
        evidence.get("resultRef"),
        errors,
        resolver=resolver,
        code="result_ref_unreadable",
        message="L3 resultRef could not be loaded.",
    )
    traces = [
        payload
        for ref in _refs_from_explicit_list(evidence.get("traceRefs"))
        if (payload := _load_ref_mapping(
            ref,
            errors,
            resolver=resolver,
            code="trace_ref_unreadable",
            message="L3 traceRef could not be loaded.",
        )) is not None
    ]
    _validate_result_and_trace_payloads(evidence, result, traces, errors)
    _validate_viewer_payload(evidence, errors, resolver=resolver)
    _validate_session_ref_payloads(evidence, errors, resolver=resolver)
    _validate_runtime_substrate_refs(evidence, errors, resolver=resolver)
    event_summary = _validate_input_event_logs(evidence, [payload for payload in [result, *traces] if payload], errors, resolver=resolver)
    _validate_input_events_cover_workflow_steps(evidence, [payload for payload in [result, *traces] if payload], event_summary, errors)
    _validate_executor_command_provenance(evidence, [payload for payload in [result, *traces] if payload], errors, resolver=resolver)
    _validate_artifact_and_directory_payloads(evidence, event_summary, errors, resolver=resolver)
    _validate_evidence_ledger_payloads(evidence, errors, resolver=resolver)
    _validate_gui_present_payload(evidence, errors, resolver=resolver)


def _validate_result_and_trace_payloads(
    evidence: Mapping[str, Any],
    result: Mapping[str, Any] | None,
    traces: Sequence[Mapping[str, Any]],
    errors: list[dict[str, Any]],
) -> None:
    if result is not None:
        if result.get("schemaVersion") != "sciforge.computer-use.result.v1":
            errors.append(_repair_replay_error("result_schema_invalid", "resultRef must resolve to a Computer Use result.", "$.resultRef", actual=result.get("schemaVersion")))
        if result.get("status") != "completed":
            errors.append(_repair_replay_error("result_status_not_completed", "L3 resultRef must be completed.", "$.resultRef.status", expected="completed", actual=result.get("status")))
        final_artifact_ref = _string_or_none(evidence.get("finalArtifactRef"))
        result_final_artifact_ref = _string_or_none(result.get("finalArtifactRef"))
        if final_artifact_ref and result_final_artifact_ref and final_artifact_ref != result_final_artifact_ref:
            errors.append(_repair_replay_error("result_final_artifact_ref_mismatch", "resultRef finalArtifactRef must match L3 finalArtifactRef.", "$.resultRef.finalArtifactRef", expected=final_artifact_ref, actual=result_final_artifact_ref))
    if not traces:
        return
    for index, trace in enumerate(traces):
        if trace.get("schemaVersion") != "sciforge.computer-use.loop-trace.v1":
            errors.append(_repair_replay_error("trace_schema_invalid", "traceRefs must resolve to Computer Use traces.", f"$.traceRefs[{index}].schemaVersion", actual=trace.get("schemaVersion")))
            break
        if trace.get("status") != "completed":
            errors.append(_repair_replay_error("trace_status_not_completed", "L3 traceRefs must be completed.", f"$.traceRefs[{index}].status", expected="completed", actual=trace.get("status")))
            break
    steps = _steps_from_result_or_traces(result, traces)
    if not steps:
        errors.append(_repair_replay_error("workflow_steps_missing", "L3 result/trace refs must include workflow steps.", "$.steps"))
        return
    if len(steps) < (_int_or_none(_mapping(evidence.get("workflowRequirements")).get("minimumActionCount")) or 6):
        errors.append(_repair_replay_error("workflow_action_count_too_low", "L3 workflow must contain enough state-changing GUI steps to cover source, writer, save, directory, and preview.", "$.steps", expected=">=6", actual=len(steps)))
    if _mapping(evidence.get("workflowRequirements")).get("requiresCurrentStepScreenshots") is True:
        for index, step in enumerate(steps):
            if _state_changing_step(step) and not _step_current_screenshot_refs(step):
                errors.append(_repair_replay_error("current_step_screenshot_ref_missing", "Each state-changing L3 workflow step must include a current screenshot or observation ref.", f"$.steps[{index}]"))
                break
    if _mapping(evidence.get("workflowRequirements")).get("forbidPriorRoundCompletionEvidence") is True:
        for issue in _prior_round_completion_evidence_issues([payload for payload in [result, *traces] if payload]):
            errors.append(_repair_replay_error("prior_round_completion_evidence_forbidden", issue, "$"))
            break


def _validate_viewer_payload(
    evidence: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> None:
    viewer_ref = _string_or_none(evidence.get("viewerManifestRef"))
    if not viewer_ref:
        return
    resolved_viewer_ref = _resolve_ref_or_value(viewer_ref, resolver=resolver)
    validation = validate_visible_run_viewer_manifest(resolved_viewer_ref, require_existing_refs=True)
    if not validation.get("ok"):
        errors.append(_repair_replay_error("viewer_manifest_invalid", "L3 viewerManifestRef must resolve to a valid visible-run viewer manifest.", "$.viewerManifestRef", actual=validation.get("errors")))
    frame_counts = _mapping(validation.get("frameCounts"))
    if (_int_or_none(frame_counts.get("screenshot")) or 0) < 3:
        errors.append(_repair_replay_error("viewer_real_frames_too_few", "L3 viewer must contain screenshot frames for the multi-app workflow, not placeholders only.", "$.viewerManifestRef", expected=">=3", actual=frame_counts.get("screenshot")))


def _validate_preflight_payload(
    evidence: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> None:
    preflight = _load_ref_mapping(
        evidence.get("preflightRef"),
        errors,
        resolver=resolver,
        code="preflight_ref_unreadable",
        message="L3 preflightRef could not be loaded.",
    )
    if preflight is None:
        return
    validate_isolated_desktop_backend_preflight_payload(
        preflight,
        errors,
        tier_label="L3",
        allow_diagnostic_only=False,
        require_acceptance_eligible=True,
    )


def _validate_session_ref_payloads(
    evidence: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> None:
    expected_schemas = {
        "sessionManifestRef": "sciforge.computer-use.virtual-desktop-session.v1",
        "virtualDisplayRef": "sciforge.computer-use.virtual-display-ref.v1",
        "captureStreamRef": "sciforge.computer-use.capture-stream-ref.v1",
        "replayBundleRef": "sciforge.computer-use.replay-bundle-ref.v1",
        "noVncViewerRef": "sciforge.computer-use.novnc-viewer-ref.v1",
    }
    payloads: dict[str, Mapping[str, Any]] = {}
    for key, expected_schema in expected_schemas.items():
        payload = _load_ref_mapping(
            evidence.get(key),
            errors,
            resolver=resolver,
            code="session_ref_unreadable",
            message=f"{key} could not be loaded.",
        )
        if payload is None:
            continue
        payloads[key] = payload
        if payload.get("schemaVersion") != expected_schema:
            errors.append(_repair_replay_error("session_ref_schema_invalid", f"{key} has the wrong schemaVersion.", f"$.{key}.schemaVersion", expected=expected_schema, actual=payload.get("schemaVersion")))
    _validate_session_runtime_identity(payloads, errors)
    _validate_novnc_viewer_payload(payloads.get("noVncViewerRef"), errors)
    _validate_capture_stream_workflow_frames(evidence, payloads.get("captureStreamRef"), errors)


def _validate_session_runtime_identity(
    payloads: Mapping[str, Mapping[str, Any]],
    errors: list[dict[str, Any]],
) -> None:
    session_manifest = payloads.get("sessionManifestRef")
    if session_manifest is None:
        return
    expected_session_id = _session_id(session_manifest)
    if not expected_session_id:
        errors.append(_repair_replay_error(
            "session_manifest_session_id_missing",
            "sessionManifestRef must include a sessionId for same-session L3 proof.",
            "$.sessionManifestRef.sessionId",
        ))
    for key in ("virtualDisplayRef", "captureStreamRef", "replayBundleRef", "noVncViewerRef"):
        payload = payloads.get(key)
        if payload is None:
            continue
        actual_session_id = _session_id(payload)
        if not actual_session_id:
            errors.append(_repair_replay_error(
                "session_runtime_session_id_missing",
                f"{key} must include the shared isolated sessionId.",
                f"$.{key}.sessionId",
                expected=expected_session_id,
            ))
            break
        if expected_session_id and actual_session_id != expected_session_id:
            errors.append(_repair_replay_error(
                "session_runtime_session_id_mismatch",
                f"{key} must use the same isolated sessionId as sessionManifestRef.",
                f"$.{key}.sessionId",
                expected=expected_session_id,
                actual=actual_session_id,
            ))
            break

    virtual_display = payloads.get("virtualDisplayRef")
    expected_display = _display_id(virtual_display) if virtual_display is not None else None
    if not expected_display:
        errors.append(_repair_replay_error(
            "virtual_display_id_missing",
            "virtualDisplayRef must include the isolated display identifier.",
            "$.virtualDisplayRef.display",
        ))
        return
    for key in ("sessionManifestRef", "captureStreamRef", "replayBundleRef", "noVncViewerRef"):
        payload = payloads.get(key)
        if payload is None:
            continue
        actual_display = _display_id(payload)
        if not actual_display:
            errors.append(_repair_replay_error(
                "session_runtime_display_missing",
                f"{key} must include the shared isolated display identifier.",
                f"$.{key}.display",
                expected=expected_display,
            ))
            break
        if actual_display != expected_display:
            errors.append(_repair_replay_error(
                "session_runtime_display_mismatch",
                f"{key} must use the same isolated display as virtualDisplayRef.",
                f"$.{key}.display",
                expected=expected_display,
                actual=actual_display,
            ))
            break


def _validate_novnc_viewer_payload(
    payload: Mapping[str, Any] | None,
    errors: list[dict[str, Any]],
) -> None:
    if payload is None:
        return
    host, port = _novnc_host_port(payload)
    if host not in {"127.0.0.1", "localhost", "::1"}:
        errors.append(_repair_replay_error(
            "novnc_viewer_not_localhost",
            "noVncViewerRef must expose a localhost-only noVNC viewer.",
            "$.noVncViewerRef",
            expected="127.0.0.1/localhost/::1",
            actual=host,
        ))
    if port is None:
        errors.append(_repair_replay_error(
            "novnc_viewer_port_missing",
            "noVncViewerRef must include a noVNC viewer port.",
            "$.noVncViewerRef",
        ))


def _validate_capture_stream_workflow_frames(
    evidence: Mapping[str, Any],
    payload: Mapping[str, Any] | None,
    errors: list[dict[str, Any]],
) -> None:
    if payload is None:
        return
    workflow_refs = _workflow_screenshot_refs(evidence)
    if not workflow_refs:
        return
    frame_refs = _capture_stream_frame_refs(payload)
    if not frame_refs:
        errors.append(_repair_replay_error(
            "capture_stream_frames_missing",
            "captureStreamRef must contain captured workflow frame refs.",
            "$.captureStreamRef.frameRefs",
        ))
        return
    missing_refs = [ref for ref in workflow_refs if ref not in frame_refs]
    if missing_refs:
        errors.append(_repair_replay_error(
            "capture_stream_workflow_frames_missing",
            "captureStreamRef.frameRefs must include the L3 workflow screenshot refs.",
            "$.captureStreamRef.frameRefs",
            expected=workflow_refs,
            actual={"missing": missing_refs, "frameRefs": frame_refs},
        ))


def _novnc_host_port(payload: Mapping[str, Any]) -> tuple[str | None, int | None]:
    for key in ("url", "viewerUrl", "noVncUrl", "novncUrl"):
        url = _string_or_none(payload.get(key))
        if not url:
            continue
        parsed = urlparse(url if "://" in url else f"http://{url}")
        if parsed.hostname:
            return parsed.hostname, parsed.port or _int_or_none(payload.get("port"))
    host = _string_or_none(payload.get("host"))
    port = _int_or_none(payload.get("port"))
    if host:
        return host, port
    for key in ("novnc", "noVnc", "endpoint", "viewerEndpoint"):
        endpoint = _mapping(payload.get(key))
        endpoint_host = _string_or_none(endpoint.get("host"))
        if endpoint_host:
            return endpoint_host, _int_or_none(endpoint.get("port"))
    return None, port


def _capture_stream_frame_refs(payload: Mapping[str, Any]) -> list[str]:
    refs = [
        *_refs_from_explicit_list(payload.get("frameRefs")),
        *_refs_from_explicit_list(payload.get("screenshotRefs")),
        *_refs_from_explicit_list(payload.get("captureRefs")),
    ]
    for key in ("frames", "captures", "segments"):
        for item in _list_of_mappings(payload.get(key)):
            for ref_key in ("ref", "path", "screenshotRef", "frameRef", "imageRef"):
                ref = _string_or_none(item.get(ref_key))
                if ref and _looks_like_screenshot_ref(ref):
                    refs.append(ref)
    return _unique_strings([ref for ref in refs if _looks_like_screenshot_ref(ref)])


def _validate_input_event_logs(
    evidence: Mapping[str, Any],
    workflow_payloads: Sequence[Mapping[str, Any]],
    errors: list[dict[str, Any]],
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> dict[str, Any]:
    refs = _unique_strings([
        *_input_event_log_refs(evidence),
        *[ref for payload in workflow_payloads for ref in _input_event_log_refs(payload)],
    ])
    modalities: set[str] = set()
    action_indexes_by_modality: dict[str, set[int]] = {"pointer": set(), "keyboard": set()}
    command_refs_by_action_index: dict[str, dict[int, set[str]]] = {"pointer": {}, "keyboard": {}}
    for ref in refs:
        payload = _load_ref_mapping(
            ref,
            errors,
            resolver=resolver,
            code="input_event_log_ref_unreadable",
            message="L3 input event log ref could not be loaded.",
        )
        if payload is None:
            continue
        schema_modality = _schema_log_modality(_string_or_none(payload.get("schemaVersion")) or "")
        events = _list_of_mappings(payload.get("events"))
        event_count = _int_or_none(payload.get("eventCount"))
        if event_count is not None and event_count != len(events):
            errors.append(_repair_replay_error("input_event_log_count_mismatch", "Input event log eventCount must match events length.", "$", expected=event_count, actual=len(events)))
        saw_schema_modality_event = False
        for event in events:
            modality = schema_modality or _normalize_modality(_string_or_none(event.get("modality")))
            if modality not in {"pointer", "keyboard"}:
                continue
            if schema_modality == modality:
                saw_schema_modality_event = True
            modalities.add(modality)
            action_index = _int_or_none(event.get("actionIndex"))
            if action_index is not None:
                action_indexes_by_modality[modality].add(action_index)
                command_ref = _string_or_none(event.get("commandEventRef"))
                if command_ref:
                    command_refs_by_action_index.setdefault(modality, {}).setdefault(action_index, set()).add(command_ref)
        if schema_modality and not saw_schema_modality_event:
            errors.append(_repair_replay_error("required_input_event_log_missing", "L3 modality-specific input event log must contain events.", "$", expected=schema_modality, actual=0))
    required_modalities = _required_modalities(_mapping(evidence.get("workflowRequirements")).get("requiredInputModalities") or ("pointer", "keyboard"))
    for modality in required_modalities:
        if modality not in modalities:
            errors.append(_repair_replay_error("required_input_event_log_missing", "L3 input event logs are missing a required modality.", "$.workflowRequirements.requiredInputModalities", expected=modality, actual=sorted(modalities)))
            break
    return {
        "modalities": modalities,
        "actionIndexesByModality": action_indexes_by_modality,
        "commandRefsByActionIndex": command_refs_by_action_index,
    }


def _validate_artifact_and_directory_payloads(
    evidence: Mapping[str, Any],
    event_summary: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> None:
    artifact_validation = _load_ref_mapping(
        evidence.get("artifactValidationRef"),
        errors,
        resolver=resolver,
        code="artifact_validation_ref_unreadable",
        message="L3 artifactValidationRef could not be loaded.",
    )
    final_artifact_ref = _string_or_none(evidence.get("finalArtifactRef"))
    if artifact_validation is not None:
        if artifact_validation.get("ok") is not True:
            errors.append(_repair_replay_error("artifact_validation_not_ok", "L3 artifactValidationRef must report ok=true.", "$.artifactValidationRef.ok", expected=True, actual=artifact_validation.get("ok")))
        if artifact_validation.get("macrosForbidden") is not True:
            errors.append(_repair_replay_error("artifact_validation_macros_not_forbidden", "L3 artifact validation must forbid macros.", "$.artifactValidationRef.macrosForbidden", expected=True, actual=artifact_validation.get("macrosForbidden")))
        validation_path = _string_or_none(artifact_validation.get("path"))
        if final_artifact_ref and validation_path and str(Path(validation_path).expanduser().resolve()) != str(Path(final_artifact_ref).expanduser().resolve()):
            errors.append(_repair_replay_error("artifact_validation_path_mismatch", "L3 artifactValidationRef must validate the finalArtifactRef.", "$.artifactValidationRef.path", expected=final_artifact_ref, actual=validation_path))
        _validate_artifact_validation_hash(final_artifact_ref, artifact_validation, errors)
        _validate_supported_source_facts_in_artifact_text(evidence, artifact_validation, errors, resolver=resolver)
    saved_index = _int_or_none(_mapping(evidence.get("artifactCausality")).get("savedByActionIndex"))
    saved_command_ref = _string_or_none(_mapping(evidence.get("artifactCausality")).get("savedByCommandEventRef"))
    keyboard_indexes = _mapping(event_summary.get("actionIndexesByModality")).get("keyboard", set())
    if saved_index is not None and saved_index not in keyboard_indexes:
        errors.append(_repair_replay_error("artifact_save_keyboard_event_missing", "L3 artifact save action must have matching keyboard input event evidence.", "$.artifactCausality.savedByActionIndex", expected=sorted(keyboard_indexes), actual=saved_index))
    if saved_index is not None and saved_command_ref:
        actual_command_refs = _event_command_refs(event_summary, "keyboard", saved_index)
        if saved_command_ref not in actual_command_refs:
            errors.append(_repair_replay_error("artifact_save_command_event_mismatch", "artifactCausality.savedByCommandEventRef must match the keyboard input event for savedByActionIndex.", "$.artifactCausality.savedByCommandEventRef", expected=sorted(actual_command_refs), actual=saved_command_ref))
    directory = _mapping(evidence.get("directoryEvidence"))
    preview_index = _int_or_none(directory.get("previewedByActionIndex"))
    pointer_indexes = _mapping(event_summary.get("actionIndexesByModality")).get("pointer", set())
    if preview_index is not None and preview_index not in pointer_indexes:
        errors.append(_repair_replay_error("directory_preview_pointer_event_missing", "directoryEvidence.previewedByActionIndex must match pointer input evidence for opening the preview.", "$.directoryEvidence.previewedByActionIndex", expected=sorted(pointer_indexes), actual=preview_index))
    for key in ("fileListArtifactRef", "fileListDataRef"):
        payload = _load_ref_mapping(
            evidence.get(key),
            errors,
            resolver=resolver,
            code="file_list_ref_unreadable",
            message=f"L3 {key} could not be loaded.",
        )
        if payload is not None and final_artifact_ref and not _payload_mentions_artifact(payload, final_artifact_ref):
            errors.append(_repair_replay_error("file_list_missing_final_artifact", f"L3 {key} must mention the final artifact.", f"$.{key}", expected=Path(final_artifact_ref).name))
            break


def _event_command_refs(
    event_summary: Mapping[str, Any],
    modality: str,
    action_index: int,
) -> set[str]:
    refs_by_modality = _mapping(event_summary.get("commandRefsByActionIndex"))
    refs_by_index = refs_by_modality.get(modality)
    if not isinstance(refs_by_index, Mapping):
        return set()
    refs = refs_by_index.get(action_index)
    if refs is None:
        refs = refs_by_index.get(str(action_index))
    if isinstance(refs, set):
        return {str(ref) for ref in refs if ref}
    if isinstance(refs, Sequence) and not isinstance(refs, (str, bytes, bytearray)):
        return {str(ref) for ref in refs if ref}
    return set()


def _validate_input_events_cover_workflow_steps(
    evidence: Mapping[str, Any],
    workflow_payloads: Sequence[Mapping[str, Any]],
    event_summary: Mapping[str, Any],
    errors: list[dict[str, Any]],
) -> None:
    result = workflow_payloads[0] if workflow_payloads else None
    traces = workflow_payloads[1:] if len(workflow_payloads) > 1 else []
    steps = _steps_from_result_or_traces(result, traces)
    expected_by_modality = _action_indexes_by_modality(steps)
    actual_by_modality = _mapping(event_summary.get("actionIndexesByModality"))
    required_modalities = _required_modalities(_mapping(evidence.get("workflowRequirements")).get("requiredInputModalities") or ("pointer", "keyboard"))
    for modality in required_modalities:
        expected = expected_by_modality.get(modality, set())
        actual_value = actual_by_modality.get(modality, set())
        actual = actual_value if isinstance(actual_value, set) else set(actual_value or [])
        missing = sorted(index for index in expected if index not in actual)
        if missing:
            errors.append(_repair_replay_error(
                "input_event_action_indexes_missing",
                "L3 input event logs must cite every workflow action index that used a required input modality.",
                "$.workflowRequirements.requiredInputModalities",
                expected={"modality": modality, "actionIndexes": sorted(expected)},
                actual={"modality": modality, "actionIndexes": sorted(actual), "missing": missing},
            ))
            break


def _validate_runtime_substrate_refs(
    evidence: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> None:
    expected_display = _expected_l3_display(evidence, resolver=resolver)
    expected_session_id = _expected_l3_session_id(evidence, resolver=resolver)
    readiness = _load_ref_mapping(
        evidence.get("backendReadinessProofRef"),
        errors,
        resolver=resolver,
        code="backend_readiness_proof_unreadable",
        message="L3 backendReadinessProofRef could not be loaded.",
    )
    if readiness is not None:
        _validate_backend_readiness_payload(evidence, readiness, errors, resolver=resolver, expected_display=expected_display)

    process_payload = _load_ref_mapping(
        evidence.get("processRef"),
        errors,
        resolver=resolver,
        code="process_ref_unreadable",
        message="L3 processRef could not be loaded.",
    )
    if process_payload is not None:
        validate_backend_process_payload(
            evidence_process_ref=_string_or_none(evidence.get("processRef")),
            readiness_payload=readiness,
            process_payload=process_payload,
            errors=errors,
            expected_display=expected_display,
            expected_session_id=expected_session_id,
            require_existing_log_refs=True,
            resolver=resolver,
        )

    resource_payload = _load_ref_mapping(
        evidence.get("resourceAllocationRef"),
        errors,
        resolver=resolver,
        code="resource_allocation_ref_unreadable",
        message="L3 resourceAllocationRef could not be loaded.",
    )
    if resource_payload is not None:
        validate_runtime_resource_allocation_payload(
            resource_payload,
            errors,
            expected_display=expected_display,
            expected_session_id=expected_session_id,
        )


def _validate_backend_readiness_payload(
    evidence: Mapping[str, Any],
    payload: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
    expected_display: str | None,
) -> None:
    if payload.get("schemaVersion") != BACKEND_READINESS_PROOF_SCHEMA_VERSION:
        errors.append(_repair_replay_error(
            "backend_readiness_proof_schema_invalid",
            "L3 backendReadinessProofRef must resolve to the runtime backend readiness proof schema.",
            "$.backendReadinessProofRef.schemaVersion",
            expected=BACKEND_READINESS_PROOF_SCHEMA_VERSION,
            actual=payload.get("schemaVersion"),
        ))
    if payload.get("status") != "ready":
        errors.append(_repair_replay_error("backend_readiness_proof_not_ready", "L3 backendReadinessProofRef must prove ready runtime state.", "$.backendReadinessProofRef.status", expected="ready", actual=payload.get("status")))
    if payload.get("backendKind") != evidence.get("backendKind"):
        errors.append(_repair_replay_error("backend_readiness_proof_backend_mismatch", "backendReadinessProofRef backendKind must match L3 evidence backendKind.", "$.backendReadinessProofRef.backendKind", expected=evidence.get("backendKind"), actual=payload.get("backendKind")))
    if payload.get("localhostOnly") is not True:
        errors.append(_repair_replay_error("backend_readiness_proof_not_localhost_only", "L3 backend readiness proof must expose localhost-only VNC/noVNC endpoints.", "$.backendReadinessProofRef.localhostOnly", expected=True, actual=payload.get("localhostOnly")))
    if expected_display and _display_id(payload) != expected_display:
        errors.append(_repair_replay_error("backend_readiness_display_mismatch", "backendReadinessProofRef display must match the isolated virtual display.", "$.backendReadinessProofRef.display", expected=expected_display, actual=_display_id(payload)))

    x_display = _mapping(payload.get("xDisplay"))
    if x_display.get("ready") is not True or _display_id(x_display) != _display_id(payload) or _int_or_none(x_display.get("width")) is None or _int_or_none(x_display.get("height")) is None:
        errors.append(_repair_replay_error(
            "backend_readiness_x_display_invalid",
            "backendReadinessProofRef.xDisplay must prove a queryable isolated X display with positive geometry.",
            "$.backendReadinessProofRef.xDisplay",
            actual=x_display,
        ))
    for endpoint_name in ("vnc", "novnc"):
        endpoint = _mapping(payload.get(endpoint_name))
        if endpoint.get("host") != "127.0.0.1" or endpoint.get("ready") is not True or _int_or_none(endpoint.get("port")) is None:
            errors.append(_repair_replay_error(
                "backend_readiness_endpoint_not_ready",
                f"backendReadinessProofRef.{endpoint_name} must contain a ready localhost endpoint.",
                f"$.backendReadinessProofRef.{endpoint_name}",
                expected={"host": "127.0.0.1", "ready": True, "port": "integer"},
                actual=endpoint,
            ))
            break
    _validate_backend_readiness_http_viewer(evidence, payload, errors, resolver=resolver)
    _validate_no_side_effect_flags(payload, errors, path="$.backendReadinessProofRef")


def _validate_backend_readiness_http_viewer(
    evidence: Mapping[str, Any],
    payload: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> None:
    novnc = _mapping(payload.get("novnc"))
    http_viewer = _mapping(novnc.get("httpViewer"))
    if not http_viewer:
        errors.append(_repair_replay_error("backend_readiness_http_viewer_missing", "backendReadinessProofRef.novnc.httpViewer must prove the noVNC viewer was served over localhost HTTP.", "$.backendReadinessProofRef.novnc.httpViewer"))
        return
    actual_url = _string_or_none(http_viewer.get("url"))
    status = _int_or_none(http_viewer.get("statusCode"))
    bytes_read = _int_or_none(http_viewer.get("bytesRead"))
    if http_viewer.get("ready") is not True or str(http_viewer.get("method", "")).upper() != "GET" or status is None or not (200 <= status < 400) or bytes_read is None or bytes_read <= 0:
        errors.append(_repair_replay_error("backend_readiness_http_viewer_invalid", "backendReadinessProofRef.novnc.httpViewer must record a ready GET 2xx/3xx response with non-empty body.", "$.backendReadinessProofRef.novnc.httpViewer", actual=http_viewer))
    if http_viewer.get("localhostOnly") is not True or not actual_url or not _is_localhost_novnc_url(actual_url):
        errors.append(_repair_replay_error("backend_readiness_http_viewer_not_localhost", "backendReadinessProofRef.novnc.httpViewer.url must be a localhost /vnc.html URL.", "$.backendReadinessProofRef.novnc.httpViewer.url", actual=actual_url))
    sha = _string_or_none(http_viewer.get("sha256"))
    if not sha or len(sha) != 64 or http_viewer.get("rawPayloadWritten") is not False:
        errors.append(_repair_replay_error("backend_readiness_http_viewer_body_invalid", "backendReadinessProofRef.novnc.httpViewer must store only sha256/body metadata, not raw viewer payload.", "$.backendReadinessProofRef.novnc.httpViewer", actual=http_viewer))
    viewer_ref = _string_or_none(evidence.get("noVncViewerRef"))
    if viewer_ref and actual_url:
        viewer = _load_ref_mapping(
            viewer_ref,
            [],
            resolver=resolver,
            code="novnc_viewer_ref_unreadable",
            message="noVncViewerRef could not be loaded.",
        )
        viewer_url = _string_or_none(_mapping(viewer).get("url"))
        if viewer_url and viewer_url != actual_url:
            errors.append(_repair_replay_error("backend_readiness_http_viewer_ref_mismatch", "noVncViewerRef.url must match backendReadinessProofRef.novnc.httpViewer.url.", "$.noVncViewerRef.url", expected=actual_url, actual=viewer_url))


def _validate_executor_command_provenance(
    evidence: Mapping[str, Any],
    workflow_payloads: Sequence[Mapping[str, Any]],
    errors: list[dict[str, Any]],
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> None:
    log_refs = _executor_command_event_log_refs([evidence, *workflow_payloads])
    if not log_refs:
        errors.append(_repair_replay_error("command_event_log_ref_missing", "L3 input evidence must expose executorCommandEventLogRef.", "$.executorCommandEventLogRef"))
        return
    command_events_by_ref_id: dict[tuple[str, str], Mapping[str, Any]] = {}
    for ref in log_refs:
        payload = _load_ref_mapping(
            ref,
            errors,
            resolver=resolver,
            code="command_event_log_ref_unreadable",
            message="L3 executorCommandEventLogRef could not be loaded.",
        )
        if payload is None:
            continue
        if payload.get("schemaVersion") != EXECUTOR_COMMAND_EVENT_LOG_SCHEMA:
            errors.append(_repair_replay_error("command_event_log_schema_invalid", "L3 executor command event log schemaVersion is invalid.", "$.executorCommandEventLogRef.schemaVersion", expected=EXECUTOR_COMMAND_EVENT_LOG_SCHEMA, actual=payload.get("schemaVersion")))
        _validate_no_side_effect_flags(payload, errors, path="$.executorCommandEventLogRef")
        events = _list_of_mappings(payload.get("events"))
        if (_int_or_none(payload.get("eventCount")) is not None) and _int_or_none(payload.get("eventCount")) != len(events):
            errors.append(_repair_replay_error("command_event_log_count_mismatch", "Executor command event log eventCount must match events length.", "$.executorCommandEventLogRef.eventCount", expected=payload.get("eventCount"), actual=len(events)))
        _validate_command_event_sequence(events, errors)
        for event in events:
            _validate_no_side_effect_flags(event, errors, path="$.executorCommandEventLogRef.events")
            command_id = _string_or_none(event.get("id"))
            if command_id:
                command_events_by_ref_id[(ref, command_id)] = event
    if not command_events_by_ref_id:
        return

    expected_display = _expected_l3_display(evidence, resolver=resolver)
    pointer_context = _load_window_bound_pointer_context(
        evidence,
        errors,
        resolver=resolver,
        expected_display=expected_display,
        allowed_target_window_schemas=(ISOLATED_TARGET_WINDOW_SCHEMA_VERSION,),
    )
    for input_ref in _unique_strings([ref for payload in [evidence, *workflow_payloads] for ref in _input_event_log_refs(payload)]):
        input_payload = _load_ref_mapping(
            input_ref,
            errors,
            resolver=resolver,
            code="input_event_log_ref_unreadable",
            message="L3 input event log ref could not be loaded.",
        )
        if input_payload is None:
            continue
        schema_modality = _schema_log_modality(_string_or_none(input_payload.get("schemaVersion")) or "")
        for event in _list_of_mappings(input_payload.get("events")):
            modality = schema_modality or _normalize_modality(_string_or_none(event.get("modality")))
            if modality not in {"pointer", "keyboard"}:
                continue
            command_id = _input_event_command_id(event)
            command_log_ref = _string_or_none(event.get("commandEventLogRef"))
            if not command_id or not command_log_ref:
                errors.append(_repair_replay_error("input_event_command_provenance_missing", "Every L3 input event must cite commandEventId and commandEventLogRef.", "$.inputEventLogRef.events", actual={"inputEventRef": input_ref, "event": event}))
                continue
            command_ref = _string_or_none(event.get("commandEventRef"))
            expected_command_ref = f"{command_log_ref}#events/{command_id}"
            if command_ref != expected_command_ref:
                errors.append(_repair_replay_error("input_event_command_ref_mismatch", "L3 input event commandEventRef must point into executorCommandEventLogRef.", "$.inputEventLogRef.events.commandEventRef", expected=expected_command_ref, actual=command_ref))
            command_event = command_events_by_ref_id.get((command_log_ref, command_id))
            if command_event is None:
                errors.append(_repair_replay_error("input_event_command_event_not_found", "L3 input event commandEventId must resolve inside executorCommandEventLogRef.", "$.inputEventLogRef.events.commandEventId", actual=command_id))
                continue
            _validate_input_event_command_match(
                event,
                command_event,
                errors,
                modality=modality,
                expected_display=expected_display,
                pointer_context=pointer_context,
            )


def _validate_input_event_command_match(
    event: Mapping[str, Any],
    command_event: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    modality: str,
    expected_display: str | None,
    pointer_context: Mapping[str, Any],
) -> None:
    action_index = _int_or_none(event.get("actionIndex"))
    if action_index is None or _int_or_none(command_event.get("actionIndex")) != action_index:
        errors.append(_repair_replay_error("input_event_command_action_index_mismatch", "L3 input event actionIndex must match the cited executor command event.", "$.inputEventLogRef.events.actionIndex", expected=action_index, actual=command_event.get("actionIndex")))
    command_modality = _normalize_modality(_string_or_none(command_event.get("inputModality")))
    if command_modality != modality:
        errors.append(_repair_replay_error("input_event_command_modality_mismatch", "L3 input event modality must match the cited executor command event modality.", "$.inputEventLogRef.events.modality", expected=modality, actual=command_modality))
    event_kind = _normalize_action_kind(_string_or_none(event.get("kind")))
    command_kind = _normalize_action_kind(_string_or_none(command_event.get("actionKind")) or _string_or_none(command_event.get("role")))
    if event_kind and command_kind and event_kind != command_kind:
        errors.append(_repair_replay_error("input_event_command_kind_mismatch", "L3 input event kind must match the cited executor command event kind.", "$.inputEventLogRef.events.kind", expected=event_kind, actual=command_kind))
    if _int_or_none(command_event.get("returncode")) != 0:
        errors.append(_repair_replay_error("input_command_returncode_nonzero", "Completed L3 input events must cite executor commands that returned zero.", "$.executorCommandEventLogRef.events.returncode", actual=command_event.get("returncode")))
    command_display = _string_or_none(command_event.get("display")) or _string_or_none(_mapping(command_event.get("env")).get("DISPLAY"))
    if expected_display and command_display != expected_display:
        errors.append(_repair_replay_error("input_command_display_mismatch", "Executor command DISPLAY must match the isolated virtual display.", "$.executorCommandEventLogRef.events.display", expected=expected_display, actual=command_display))
    args = command_event.get("args")
    if not isinstance(args, list) or not args:
        errors.append(_repair_replay_error("input_command_args_missing", "Executor command event must include command args.", "$.executorCommandEventLogRef.events.args"))
    elif _executor_args_look_untrusted(args):
        errors.append(_repair_replay_error("input_command_executor_untrusted", "Executor command event must reference a direct isolated input executor, not a shell or system input wrapper.", "$.executorCommandEventLogRef.events.args", actual=args[:3]))
    if "stdout" in command_event or "stderr" in command_event:
        errors.append(_repair_replay_error("input_command_raw_output_forbidden", "Executor command events may store stdoutSummary/stderrSummary, not raw stdout/stderr payloads.", "$.executorCommandEventLogRef.events"))
    if modality == "pointer":
        _validate_pointer_event_window_binding(
            event,
            command_event,
            errors,
            pointer_context=pointer_context,
            action_index=action_index,
        )


def _executor_command_event_log_refs(payloads: Sequence[Mapping[str, Any]]) -> list[str]:
    refs = []
    for payload in payloads:
        ref = _string_or_none(payload.get("executorCommandEventLogRef"))
        if ref:
            refs.append(ref)
        diagnostics = _mapping(payload.get("failureDiagnostics"))
        diagnostic_ref = _string_or_none(diagnostics.get("executorCommandEventLogRef"))
        if diagnostic_ref:
            refs.append(diagnostic_ref)
        metadata_ref = _string_or_none(_mapping(payload.get("metadata")).get("executorCommandEventLogRef"))
        if metadata_ref:
            refs.append(metadata_ref)
    return _unique_strings(refs)


def _input_event_command_id(event: Mapping[str, Any]) -> str | None:
    command_id = _string_or_none(event.get("commandEventId"))
    if command_id:
        return command_id
    command_ref = _string_or_none(event.get("commandEventRef"))
    if not command_ref:
        return None
    marker = "#events/"
    if marker in command_ref:
        return command_ref.rsplit(marker, 1)[-1] or None
    return None


def _validate_command_event_sequence(events: Sequence[Mapping[str, Any]], errors: list[dict[str, Any]]) -> None:
    sequences: list[int] = []
    timestamps: list[float] = []
    for event in events:
        sequence = _int_or_none(event.get("sequence"))
        if sequence is None:
            errors.append(_repair_replay_error("input_command_sequence_invalid", "Executor command events must include integer sequence values.", "$.executorCommandEventLogRef.events.sequence"))
            return
        sequences.append(sequence)
        timestamp = event.get("timestamp")
        if not isinstance(timestamp, (int, float)):
            errors.append(_repair_replay_error("input_command_timestamp_invalid", "Executor command events must include numeric timestamps.", "$.executorCommandEventLogRef.events.timestamp", actual=timestamp))
            return
        timestamps.append(float(timestamp))
    if len(set(sequences)) != len(sequences) or sequences != sorted(sequences):
        errors.append(_repair_replay_error("input_command_sequence_invalid", "Executor command event sequence values must be unique and increasing.", "$.executorCommandEventLogRef.events.sequence", actual=sequences))
    if timestamps != sorted(timestamps):
        errors.append(_repair_replay_error("input_command_timestamp_invalid", "Executor command event timestamps must not move backwards.", "$.executorCommandEventLogRef.events.timestamp", actual=timestamps))


def _expected_l3_display(
    evidence: Mapping[str, Any],
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> str | None:
    for key in ("virtualDisplayRef", "backendReadinessProofRef"):
        ref = _string_or_none(evidence.get(key))
        if not ref:
            continue
        payload = _load_ref_mapping(ref, [], resolver=resolver, code="", message="")
        display = _display_id(_mapping(payload))
        if display:
            return display
    return None


def _expected_l3_session_id(
    evidence: Mapping[str, Any],
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> str | None:
    for key in ("sessionManifestRef", "virtualDisplayRef"):
        ref = _string_or_none(evidence.get(key))
        if not ref:
            continue
        payload = _load_ref_mapping(ref, [], resolver=resolver, code="", message="")
        session_id = _session_id(_mapping(payload))
        if session_id:
            return session_id
    return None


def _normalize_action_kind(value: str | None) -> str | None:
    text = (value or "").strip().replace("-", "_").lower()
    if text in {"click_input", "click_button", "click"}:
        return "click"
    if text in {"type", "type_text", "type_text_through_isolated_input"}:
        return "type_text"
    if text in {"key", "hotkey", "press_key", "save"}:
        return "hotkey" if text == "key" else text
    return text or None


def _executor_args_look_untrusted(args: Sequence[Any]) -> bool:
    if not args:
        return True
    executable = Path(str(args[0])).name.strip().lower()
    if executable in {"sh", "bash", "zsh", "osascript", "cliclick", "xdg-open"}:
        return True
    return any(str(arg).strip() in {";", "&&", "||", "|", "`"} for arg in args)


def _is_localhost_novnc_url(url: str) -> bool:
    parsed = urlparse(url if "://" in url else f"http://{url}")
    return parsed.scheme in {"http", "https"} and parsed.hostname in {"127.0.0.1", "localhost", "::1"} and parsed.path == "/vnc.html"


def _validate_no_side_effect_flags(payload: Mapping[str, Any], errors: list[dict[str, Any]], *, path: str) -> None:
    for key in ("sharedSystemInputUsed", "systemPointerMoved", "systemKeyboardEventsSent"):
        if payload.get(key) is not False:
            errors.append(_repair_replay_error("runtime_side_effect_flag", f"L3 runtime proof requires {key}=false.", f"{path}.{key}", expected=False, actual=payload.get(key)))
            break


def _action_indexes_by_modality(steps: Sequence[Mapping[str, Any]]) -> dict[str, set[int]]:
    indexes: dict[str, set[int]] = {"pointer": set(), "keyboard": set()}
    for fallback_index, step in enumerate(steps):
        action = _mapping(step.get("action"))
        kind = (_string_or_none(action.get("kind")) or _string_or_none(action.get("type")) or "").lower()
        step_index = _int_or_none(step.get("index"))
        index = fallback_index if step_index is None else step_index
        for modality in _modalities_for_action_kind(kind):
            indexes[modality].add(index)
    return indexes


def _modalities_for_action_kind(kind: str) -> set[str]:
    if kind in {"click", "double_click", "drag", "scroll", "focus"}:
        return {"pointer"}
    if kind in {"type_text", "press_key", "hotkey", "save"}:
        return {"keyboard"}
    return set()


def _validate_artifact_validation_hash(
    final_artifact_ref: str | None,
    artifact_validation: Mapping[str, Any],
    errors: list[dict[str, Any]],
) -> None:
    if not final_artifact_ref:
        return
    declared_sha = _string_or_none(artifact_validation.get("sha256"))
    if not declared_sha:
        errors.append(_repair_replay_error(
            "artifact_validation_sha256_missing",
            "L3 artifactValidationRef must include the final artifact sha256.",
            "$.artifactValidationRef.sha256",
        ))
        return
    try:
        path = Path(final_artifact_ref).expanduser()
        if not path.is_file():
            return
        actual_sha = hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return
    if declared_sha != actual_sha:
        errors.append(_repair_replay_error(
            "artifact_validation_sha256_mismatch",
            "L3 artifactValidationRef sha256 must match the finalArtifactRef file.",
            "$.artifactValidationRef.sha256",
            expected=actual_sha,
            actual=declared_sha,
        ))


def _validate_supported_source_facts_in_artifact_text(
    evidence: Mapping[str, Any],
    artifact_validation: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> None:
    supported_fact_refs = _refs_from_explicit_list(_mapping(evidence.get("derivedContentEvidence")).get("supportedFactRefs"))
    if not supported_fact_refs:
        return
    artifact_text = _artifact_validation_normalized_text(artifact_validation)
    if not artifact_text:
        errors.append(_repair_replay_error(
            "artifact_validation_text_missing",
            "L3 artifactValidationRef must include extracted artifact text for source-fact causality.",
            "$.artifactValidationRef.textRuns",
        ))
        return
    for ref in supported_fact_refs:
        payload = _load_ref_mapping(
            ref,
            errors,
            resolver=resolver,
            code="source_fact_ref_unreadable",
            message="L3 source fact ref could not be loaded.",
        )
        if payload is None:
            continue
        if payload.get("schemaVersion") != "sciforge.computer-use.source-fact.v1":
            errors.append(_repair_replay_error(
                "source_fact_schema_invalid",
                "L3 supportedFactRefs must resolve to source fact payloads.",
                "$.derivedContentEvidence.supportedFactRefs",
                expected="sciforge.computer-use.source-fact.v1",
                actual=payload.get("schemaVersion"),
            ))
            continue
        fact_text = _string_or_none(payload.get("fact"))
        if not fact_text:
            errors.append(_repair_replay_error(
                "source_fact_text_missing",
                "L3 source fact payloads must contain non-empty fact text.",
                "$.derivedContentEvidence.supportedFactRefs",
                actual=ref,
            ))
            continue
        normalized_fact = _normalize_artifact_text(fact_text)
        if normalized_fact and normalized_fact not in artifact_text:
            errors.append(_repair_replay_error(
                "artifact_text_missing_supported_source_fact",
                "L3 final artifact text must include every supported source fact.",
                "$.artifactValidationRef.textRuns",
                expected=fact_text,
                actual=artifact_validation.get("textRuns"),
            ))
            break


def _artifact_validation_normalized_text(payload: Mapping[str, Any]) -> str:
    text_runs = payload.get("textRuns")
    if isinstance(text_runs, Sequence) and not isinstance(text_runs, (str, bytes, bytearray)):
        return _normalize_artifact_text(" ".join(str(item) for item in text_runs if str(item).strip()))
    for key in ("normalizedText", "text", "plainText"):
        value = _string_or_none(payload.get(key))
        if value:
            return _normalize_artifact_text(value)
    return ""


def _normalize_artifact_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip().casefold()


def _validate_evidence_ledger_payloads(
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
        records = _load_jsonl_records(log_ref, resolver=resolver)
        index = _load_json_mapping(index_ref, resolver=resolver)
        snapshot = _load_json_mapping(snapshot_ref, resolver=resolver)
        planner = _load_json_mapping(planner_ref, resolver=resolver)
    except (OSError, json.JSONDecodeError, TypeError, UnicodeDecodeError) as exc:
        errors.append(_repair_replay_error("evidence_ledger_unreadable", f"L3 evidence ledger refs could not be loaded: {exc}.", "$"))
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
        errors.append(_repair_replay_error("current_completion_claim_missing", "L3 evidence ledger requires a current completion-claim.", "$.evidenceLogRef"))
        return
    latest_claim = completion_claims[-1]
    support_ids = _refs_from_explicit_list(latest_claim.get("supports"))
    if not support_ids:
        errors.append(_repair_replay_error("completion_claim_supports_missing", "L3 completion-claim must cite current source/artifact/directory evidence ids.", "$.evidenceLogRef"))
    stale_supports = [support_id for support_id in support_ids if support_id not in current_ids]
    if stale_supports:
        errors.append(_repair_replay_error("completion_claim_supports_stale_evidence", "L3 completion-claim cannot support stale evidence records.", "$.evidenceLogRef", actual=stale_supports))
    final_artifact_ref = _string_or_none(evidence.get("finalArtifactRef"))
    artifact_records = [
        record
        for record in records
        if record.get("type") == "artifact"
        and record.get("id") in current_ids
        and _string_or_none(record.get("ref")) == final_artifact_ref
    ]
    if final_artifact_ref and not artifact_records:
        errors.append(_repair_replay_error("final_artifact_not_current", "finalArtifactRef must be represented by a current artifact record in the evidence ledger.", "$.finalArtifactRef", actual=final_artifact_ref))
    artifact_ids = [str(record.get("id")) for record in artifact_records if _string_or_none(record.get("id"))]
    if artifact_ids and set(artifact_ids).isdisjoint(support_ids):
        errors.append(_repair_replay_error("completion_claim_missing_final_artifact_support", "L3 completion-claim must directly support the current final artifact record.", "$.evidenceLogRef", expected=artifact_ids, actual=support_ids))


def _validate_gui_present_payload(
    evidence: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> None:
    gui_present = _load_ref_mapping(
        evidence.get("guiPresentRef"),
        errors,
        resolver=resolver,
        code="gui_present_ref_unreadable",
        message="L3 guiPresentRef could not be loaded.",
    )
    if gui_present is None:
        return
    final_artifact_ref = _string_or_none(evidence.get("finalArtifactRef"))
    if final_artifact_ref and not _payload_mentions_artifact(gui_present, final_artifact_ref):
        errors.append(_repair_replay_error("gui_present_missing_final_artifact", "L3 guiPresentRef must present the final artifact ref.", "$.guiPresentRef", expected=final_artifact_ref))


def _validation_result(
    evidence: Mapping[str, Any] | None,
    *,
    evidence_ref: str | None,
    errors: list[dict[str, Any]],
    require_existing_refs: bool,
) -> dict[str, Any]:
    return {
        "schemaVersion": ISOLATED_DESKTOP_L3_WORKFLOW_EVIDENCE_VALIDATION_SCHEMA_VERSION,
        "ok": not errors,
        "evidenceRef": evidence_ref,
        "status": evidence.get("status") if evidence else None,
        "errors": errors,
        "warnings": [],
        "requireExistingRefs": bool(require_existing_refs),
        "acceptanceTier": evidence.get("acceptanceTier") if evidence else None,
        "userAcceptanceEligible": evidence.get("userAcceptanceEligible") if evidence else None,
    }


def _all_refs(evidence: Mapping[str, Any]) -> list[str]:
    refs = [
        *[
            str(evidence.get(key))
            for key in REQUIRED_TOP_LEVEL_REFS
            if key != "filesystemRootRef"
            if _string_or_none(evidence.get(key))
        ],
        *_refs_from_explicit_list(evidence.get("traceRefs")),
        *_refs_from_explicit_list(evidence.get("screenshotRefs")),
    ]
    for app in _list_of_mappings(evidence.get("applicationEvidence")):
        refs.extend(_refs_from_explicit_list(app.get("windowEvidenceRefs")))
        refs.extend(ref for ref in (app.get("firstScreenshotRef"), app.get("lastScreenshotRef")) if isinstance(ref, str))
        refs.extend(ref for ref in (app.get("sessionManifestRef"), app.get("sessionRef")) if isinstance(ref, str))
    for transition in _list_of_mappings(evidence.get("crossAppTransitions")):
        refs.extend(_transition_screenshot_refs(transition))
        refs.extend(ref for ref in (transition.get("sessionManifestRef"), transition.get("sessionRef")) if isinstance(ref, str))
    source = _mapping(evidence.get("sourceEvidence"))
    refs.extend(_refs_from_explicit_list(source.get("sourceObservationRefs")))
    refs.extend(_refs_from_explicit_list(source.get("sourceFactRefs")))
    derived = _mapping(evidence.get("derivedContentEvidence"))
    refs.extend(_refs_from_explicit_list(derived.get("supportedFactRefs")))
    directory = _mapping(evidence.get("directoryEvidence"))
    for key in ("fileListArtifactRef", "fileListDataRef", "previewObservationRef", "directoryObservationAfterSaveRef"):
        ref = _string_or_none(directory.get(key))
        if ref:
            refs.append(ref)
    presentation = _mapping(evidence.get("presentationEvidence"))
    refs.extend(ref for ref in presentation.values() if isinstance(ref, str))
    return _unique_strings(refs)


def _validate_screenshot_content_diversity(
    evidence: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> None:
    screenshot_refs = _workflow_screenshot_refs(evidence)
    if len(screenshot_refs) < 3:
        return
    hashes = {
        ref: digest
        for ref in screenshot_refs
        if (digest := _file_sha256(ref, resolver=resolver)) is not None
    }
    if len(hashes) < 3:
        return
    unique_hashes = set(hashes.values())
    if len(unique_hashes) < 3:
        errors.append(_repair_replay_error(
            "screenshot_content_diversity_too_low",
            "L3 multi-app evidence requires visually distinct screenshot file content across source, writer, and preview states.",
            "$.screenshotRefs",
            expected=">=3 unique screenshot file hashes",
            actual={"uniqueHashCount": len(unique_hashes), "screenshotRefCount": len(hashes)},
        ))


def _workflow_screenshot_refs(evidence: Mapping[str, Any]) -> list[str]:
    refs = [ref for ref in _refs_from_explicit_list(evidence.get("screenshotRefs")) if _looks_like_screenshot_ref(ref)]
    for app in _list_of_mappings(evidence.get("applicationEvidence")):
        refs.extend(ref for ref in (app.get("firstScreenshotRef"), app.get("lastScreenshotRef")) if isinstance(ref, str) and _looks_like_screenshot_ref(ref))
        refs.extend(ref for ref in _refs_from_explicit_list(app.get("windowEvidenceRefs")) if _looks_like_screenshot_ref(ref))
    for transition in _list_of_mappings(evidence.get("crossAppTransitions")):
        refs.extend(_transition_screenshot_refs(transition))
    return _unique_strings(refs)


def _file_sha256(
    ref: str,
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> str | None:
    try:
        resolved = _resolve_ref_or_value(ref, resolver=resolver)
        if isinstance(resolved, Mapping):
            return None
        path = Path(resolved).expanduser()
        if not path.is_file() or path.stat().st_size <= 0:
            return None
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except (OSError, TypeError, ValueError):
        return None


def _transition_screenshot_refs(transition: Mapping[str, Any]) -> list[str]:
    refs = []
    for key in ("screenshotRef", "currentScreenshotRef", "beforeScreenshotRef", "afterScreenshotRef"):
        ref = _string_or_none(transition.get(key))
        if ref and _looks_like_screenshot_ref(ref):
            refs.append(ref)
    refs.extend(ref for ref in _refs_from_explicit_list(transition.get("screenshotRefs")) if _looks_like_screenshot_ref(ref))
    return _unique_strings(refs)


def _load_ref_mapping(
    ref_value: Any,
    errors: list[dict[str, Any]],
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
    code: str,
    message: str,
) -> Mapping[str, Any] | None:
    ref = _string_or_none(ref_value)
    if not ref:
        return None
    try:
        payload, _ = _load_repair_mapping_with_ref(_resolve_ref_or_value(ref, resolver=resolver), resolver=None)
    except (OSError, json.JSONDecodeError, TypeError, UnicodeDecodeError) as exc:
        errors.append(_repair_replay_error(code, f"{message} {exc}.", "$", actual=ref))
        return None
    return payload


def _resolve_ref_or_value(
    ref: str,
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> Mapping[str, Any] | str | Path:
    if resolver is None:
        return ref
    resolved = resolver(ref)
    return ref if resolved is None else resolved


def _bundle_root_from_evidence_ref(evidence_ref: str | None) -> Path | None:
    if not evidence_ref:
        return None
    return Path(evidence_ref).expanduser().resolve().parent


def _bundle_resolver_from_evidence_ref(
    evidence_ref: str | None,
) -> Callable[[str], Mapping[str, Any] | str | Path] | None:
    bundle_root = _bundle_root_from_evidence_ref(evidence_ref)
    if bundle_root is None:
        return None

    def _resolve_bundle_ref(ref: str) -> str | Path:
        path_text = ref.split("#", 1)[0].strip()
        if not path_text:
            return ref
        if urlparse(path_text).scheme or Path(path_text).expanduser().is_absolute():
            return ref
        return bundle_root / path_text

    return _resolve_bundle_ref


def _resolved_path_from_ref(
    ref: str | None,
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> Path | None:
    if not ref:
        return None
    resolved = _resolve_ref_or_value(ref, resolver=resolver)
    if isinstance(resolved, Mapping):
        return None
    return Path(str(resolved).split("#", 1)[0]).expanduser()


def _load_json_mapping(
    ref: str,
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> Mapping[str, Any]:
    payload, _ = _load_repair_mapping_with_ref(_resolve_ref_or_value(ref, resolver=resolver), resolver=None)
    return payload


def _load_jsonl_records(
    ref: str,
    *,
    resolver: Callable[[str], Mapping[str, Any] | str | Path] | None,
) -> list[Mapping[str, Any]]:
    path_or_payload = _resolve_ref_or_value(ref, resolver=resolver)
    if isinstance(path_or_payload, Mapping):
        records = path_or_payload.get("records")
        if isinstance(records, list):
            return [record for record in records if isinstance(record, Mapping)]
        return [path_or_payload]
    records: list[Mapping[str, Any]] = []
    for line in Path(path_or_payload).expanduser().read_text(encoding="utf8").splitlines():
        if not line.strip():
            continue
        parsed = json.loads(line)
        if isinstance(parsed, Mapping):
            records.append(parsed)
    return records


def _steps_from_result_or_traces(
    result: Mapping[str, Any] | None,
    traces: Sequence[Mapping[str, Any]],
) -> list[Mapping[str, Any]]:
    if isinstance(result, Mapping) and isinstance(result.get("steps"), list):
        return _list_of_mappings(result.get("steps"))
    for trace in traces:
        if isinstance(trace.get("steps"), list):
            return _list_of_mappings(trace.get("steps"))
    return []


def _state_changing_step(step: Mapping[str, Any]) -> bool:
    action = _mapping(step.get("action"))
    kind = (_string_or_none(action.get("kind")) or _string_or_none(action.get("type")) or "").lower()
    return kind in {
        "open_app",
        "click",
        "double_click",
        "drag",
        "type_text",
        "press_key",
        "hotkey",
        "scroll",
        "focus",
        "save",
    }


def _step_current_screenshot_refs(step: Mapping[str, Any]) -> list[str]:
    refs = []
    for key in ("afterRef", "currentObservationRef", "observationRef", "screenshotRef", "currentScreenshotRef"):
        ref = _string_or_none(step.get(key))
        if ref and _looks_like_screenshot_ref(ref):
            refs.append(ref)
    refs.extend(ref for ref in _refs_from_explicit_list(step.get("screenshotRefs")) if _looks_like_screenshot_ref(ref))
    for key in ("observation", "currentObservation", "before", "after"):
        value = _mapping(step.get(key))
        ref = _string_or_none(value.get("ref"))
        if ref and _looks_like_screenshot_ref(ref):
            refs.append(ref)
    return _unique_strings(refs)


def _input_event_log_refs(payload: Mapping[str, Any]) -> list[str]:
    refs = []
    for key in (
        "inputEventLogRef",
        "pointerEventLogRef",
        "keyboardEventLogRef",
        "targetInputEventLogRef",
        "targetPointerStateRef",
        "targetKeyboardStateRef",
    ):
        ref = _string_or_none(payload.get(key))
        if ref:
            refs.append(ref)
    refs.extend(ref for ref in _refs_from_explicit_list(payload.get("realWindowEvidenceRefs")) if ref.endswith(".json"))
    diagnostics = _mapping(payload.get("failureDiagnostics"))
    if diagnostics:
        refs.extend(_input_event_log_refs(diagnostics))
    return _unique_strings(refs)


def _schema_log_modality(schema: str) -> str | None:
    text = schema.lower()
    if text.endswith("pointer-state.v1") or text.endswith("pointer-event-log.v1"):
        return "pointer"
    if text.endswith("keyboard-state.v1") or text.endswith("keyboard-event-log.v1"):
        return "keyboard"
    return None


def _normalize_modality(value: str | None) -> str | None:
    normalized = (value or "").strip().replace("_", "-").lower()
    if normalized in {"mouse", "pointer", "click", "drag", "scroll"}:
        return "pointer"
    if normalized in {"keyboard", "key", "typing", "text"}:
        return "keyboard"
    return normalized or None


def _prior_round_completion_evidence_issues(payloads: Sequence[Mapping[str, Any]]) -> list[str]:
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
                "reusedcompletionclaim",
                "stalecompletionclaim",
            } and _truthy(item):
                issues.append(f"{path}.{key_text} contains prior-round completion evidence")
            _collect_prior_round_completion_evidence_issues(item, issues, path=f"{path}.{key_text}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            _collect_prior_round_completion_evidence_issues(item, issues, path=f"{path}[{index}]")


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "done", "completed"}
    if isinstance(value, (int, float)):
        return value != 0
    return bool(value)


def _payload_mentions_artifact(payload: Mapping[str, Any], final_artifact_ref: str) -> bool:
    basename = Path(final_artifact_ref).name
    payload_text = json.dumps(payload, sort_keys=True)
    return final_artifact_ref in payload_text or bool(basename and basename in payload_text)


def _required_modalities(value: Any) -> list[str]:
    if isinstance(value, str):
        values = [value]
    elif isinstance(value, Sequence) and not isinstance(value, (bytes, bytearray)):
        values = [str(item) for item in value]
    else:
        values = []
    modalities: list[str] = []
    for value in values:
        normalized = value.strip().replace("_", "-").lower()
        if normalized in {"mouse", "pointer", "click", "drag", "scroll"}:
            normalized = "pointer"
        elif normalized in {"keyboard", "key", "typing", "text"}:
            normalized = "keyboard"
        if normalized in {"pointer", "keyboard"} and normalized not in modalities:
            modalities.append(normalized)
    return modalities


def _app_role(value: Any) -> str:
    normalized = str(value or "").strip().replace("_", "-").lower()
    if any(token in normalized for token in ("source", "browser", "reader")):
        return "source"
    if any(token in normalized for token in ("writer", "document", "word", "presentation", "slides", "impress")):
        return "writer"
    if any(token in normalized for token in ("file", "finder", "manager", "preview")):
        return "file-preview"
    return normalized


def _target_environment_is_package_or_diagnostic(value: str) -> bool:
    compact = value.strip().replace("_", "").replace("-", "").lower()
    blocked_tokens = (
        "diagnostic",
        "dryrun",
        "fixture",
        "logicalapp",
        "mock",
        "packageowned",
        "packagelocal",
        "scripted",
        "simulatedonly",
        "stateonly",
        "test",
        "virtual",
    )
    return any(token in compact for token in blocked_tokens)


def _unique_strings(values: Sequence[str | None]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if not isinstance(value, str):
            continue
        text = value.strip()
        if not text or text in seen:
            continue
        seen.add(text)
        result.append(text)
    return result


__all__ = [
    "ISOLATED_DESKTOP_L3_WORKFLOW_EVIDENCE_SCHEMA_VERSION",
    "ISOLATED_DESKTOP_L3_WORKFLOW_EVIDENCE_VALIDATION_SCHEMA_VERSION",
    "L3_ACCEPTANCE_TIER",
    "build_isolated_desktop_l3_workflow_evidence",
    "validate_isolated_desktop_l3_workflow_evidence",
]
