"""Fail-closed readiness and execute probe for isolated desktop L3 workflows.

Without ``--execute`` this module records readiness only. With ``--execute`` and
all Linux/noVNC/LibreOffice/browser dependencies ready, it runs a real
same-session source -> writer -> file-preview workflow and promotes completed
refs only after the L3 evidence validator accepts existing refs.
"""

from __future__ import annotations

import argparse
import json
import platform
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from .artifact_renderers import validate_docx_artifact
from .isolated_desktop_backend_probe import (
    build_isolated_desktop_backend_manifest,
)
from .isolated_desktop_contracts import (
    BACKEND_KIND,
    BACKEND_READINESS_PROOF_SCHEMA_VERSION,
    EXECUTOR_COMMAND_EVENT_LOG_SCHEMA,
    ISOLATED_CAPTURE_SOURCE,
    ISOLATED_RUNTIME_RESOURCE_ALLOCATION_SCHEMA_VERSION,
    ISOLATED_TARGET_WINDOW_SCHEMA_VERSION,
    LEGACY_L1_RUNTIME_RESOURCE_ALLOCATION_SCHEMA_VERSION,
    REMOTE_DESKTOP_INPUT_CHANNEL,
    TARGET_ENVIRONMENT_KIND,
)
from .isolated_desktop_l3_workflow_evidence import (
    ISOLATED_DESKTOP_L3_WORKFLOW_EVIDENCE_SCHEMA_VERSION,
    ISOLATED_DESKTOP_L3_WORKFLOW_EVIDENCE_VALIDATION_SCHEMA_VERSION,
    L3_ACCEPTANCE_TIER,
    L3_WORKFLOW_KIND,
    REQUIRED_TOP_LEVEL_REFS,
)
from .isolated_desktop_l1_smoke_probe import (
    _browser_command,
    _component_path as _l1_component_path,
    _component_record as _l1_component_record,
    _ensure_process_running as _l1_ensure_process_running,
    _capture_screenshot as _l1_capture_screenshot,
    _isolated_display_env,
    _mark_l1_session_closed,
    _start_process as _l1_start_process,
    _stop_process as _l1_stop_process,
    _wait_for_browser_page_ready,
    _wait_for_http_viewer,
    _wait_for_tcp_port,
    _wait_for_x_display_geometry,
    _write_backend_readiness_proof,
    _update_backend_readiness_interaction_proof,
)
from .isolated_desktop_runtime import (
    DISPLAY_CANDIDATES,
    NOVNC_PORT_CANDIDATES,
    VNC_PORT_CANDIDATES,
    IsolatedDesktopL1SmokeRunFailed,
    IsolatedDesktopRunFailed,
    SubprocessCommandRunner,
    allocate_isolated_runtime_resources,
    _http_get_ready,
    _localhost_port_available,
    _tcp_port_ready,
    _vnc_server_command,
    _novnc_proxy_command,
)
from .isolated_desktop_l3_workflow_result import (
    _bundle_localize_json_payload_files,
    assemble_isolated_desktop_l3_workflow_completion,
)
from .visible_viewer import build_visible_run_viewer


from .isolated_desktop_l3_workflow_probe_helpers import (
    EXECUTION_BOUNDARY_NAME,
    EXECUTION_BOUNDARY_SCHEMA,
    ISOLATED_DESKTOP_L3_WORKFLOW_PROBE_SCHEMA,
    L3_EXECUTOR_COMMAND_EVENT_LOG_NAME,
    L3_FINAL_ARTIFACT_NAME,
    L3_SOURCE_FACTS,
    L3_SOURCE_READY_TITLE,
    L3_TYPED_DOCUMENT_PREFIX,
    MANIFEST_NAME,
    NO_OS_INPUT_FLAGS,
    PARTIAL_RUN_REF_NAME,
    REQUIRED_L3_RUNTIME_COMPONENTS,
    _application_readiness,
    _boundary_summary,
    _capture_l3_screenshot,
    _check,
    _command_plan,
    _component_path,
    _document_writer_command,
    _ensure_l3_file_preview_process_ready,
    _l3_completed_evidence_payload,
    _l3_completed_steps,
    _l3_keyboard_command,
    _l3_result_diagnostics,
    _l3_result_payload,
    _l3_screenshot_refs,
    _l3_session_id,
    _l3_window_bound_click,
    _load_json_object,
    _mapping,
    _partial_runtime_refs,
    _refs_from_completed,
    _reset_l3_run_owned_paths,
    _resolve_component,
    _start_l3_file_preview_process,
    _string_or_none,
    _update_l3_completed_session_refs,
    _update_l3_runtime_frame_refs,
    _wait_for_any_visible_window,
    _wait_for_file,
    _write_execution_boundary,
    _write_json,
    _write_l3_completed_preflight_ref,
    _write_l3_empty_executor_command_event_log,
    _write_l3_evidence_ledger,
    _write_l3_executor_command_event_log,
    _write_l3_file_list_refs,
    _write_l3_gui_present_ref,
    _write_l3_input_event_logs,
    _write_l3_source_fact_refs,
    _write_l3_source_page,
    _write_l3_static_refs,
    _write_l3_target_and_pointer_refs,
)

def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Probe isolated desktop L3 workflow readiness.")
    parser.add_argument("--output-dir", required=True, help="Directory where the L3 workflow probe manifest is written.")
    parser.add_argument("--display", help="Optional isolated X display to request for a real partial L3 run, e.g. :120.")
    parser.add_argument("--vnc-port", type=int, help="Optional localhost VNC port to request for a real partial L3 run.")
    parser.add_argument("--novnc-port", type=int, help="Optional localhost noVNC port to request for a real partial L3 run.")
    parser.add_argument("--timeout-seconds", type=float, default=20.0, help="Timeout budget for each real L3 readiness or execute phase.")
    parser.add_argument("--resource-lock-root", help="Optional lock directory for isolated display/VNC/noVNC resource leases.")
    parser.add_argument(
        "--execute",
        action="store_true",
        help=(
            "Request a real L3 isolated desktop workflow run. The probe remains fail-closed "
            "unless the same-session multi-app runner produces validator-accepted completed L3 refs."
        ),
    )
    args = parser.parse_args(argv)

    manifest = build_isolated_desktop_l3_workflow_probe_manifest(
        output_dir=Path(args.output_dir).expanduser(),
        execute=bool(args.execute),
        display=args.display,
        vnc_port=args.vnc_port,
        novnc_port=args.novnc_port,
        timeout_seconds=args.timeout_seconds,
        resource_lock_root=Path(args.resource_lock_root).expanduser() if args.resource_lock_root else None,
    )
    json.dump(manifest, sys.stdout, sort_keys=True)
    sys.stdout.write("\n")
    sys.stdout.flush()
    return 0 if manifest.get("status") == "completed" else 1


def build_isolated_desktop_l3_workflow_probe_manifest(
    *,
    output_dir: str | Path,
    execute: bool = False,
    platform_system: str | None = None,
    command_resolver: Callable[[str], str | None] | None = None,
    path_exists: Callable[[str], bool] | None = None,
    command_runner: Any | None = None,
    sleep: Callable[[float], None] = time.sleep,
    display: str | None = None,
    vnc_port: int | None = None,
    novnc_port: int | None = None,
    timeout_seconds: float = 20.0,
    resource_lock_root: str | Path | None = None,
    port_available: Callable[[int], bool] = _localhost_port_available,
    port_probe: Callable[[str, int, float], bool] = _tcp_port_ready,
    http_probe: Callable[[str, float], Mapping[str, Any]] = _http_get_ready,
    display_candidates: Sequence[str | int] | None = None,
    vnc_port_candidates: Sequence[int] | None = None,
    novnc_port_candidates: Sequence[int] | None = None,
    partial_runner: Callable[..., Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """Write a blocked/readiness manifest for a future real L3 workflow runner."""

    root = Path(output_dir).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    manifest_ref = (root / MANIFEST_NAME).resolve()
    system = platform_system or platform.system()
    resolver = command_resolver or shutil.which
    backend_manifest = build_isolated_desktop_backend_manifest(
        output_dir=root,
        platform_system=system,
        command_resolver=resolver,
        path_exists=path_exists,
    )
    runtime_components = {
        name: _resolve_component(candidates, resolver)
        for name, candidates in REQUIRED_L3_RUNTIME_COMPONENTS.items()
    }
    runtime_checks = [
        _check(
            bool(runtime_components[name].get("path")),
            name,
            f"Missing required L3 runtime component {name}: one of {', '.join(candidates)}.",
        )
        for name, candidates in REQUIRED_L3_RUNTIME_COMPONENTS.items()
    ]
    readiness_checks = [
        _check(
            backend_manifest.get("status") == "ready",
            "isolated-desktop-backend",
            "Linux noVNC + LibreOffice/browser backend readiness is not satisfied.",
        ),
        *runtime_checks,
    ]
    readiness_status = "ready" if all(check["ok"] for check in readiness_checks) else "blocked"
    execution_boundary: dict[str, Any] | None = None
    execution_boundary_ref: Path | None = None
    if execute and readiness_status == "ready":
        execution_boundary_ref = (root / EXECUTION_BOUNDARY_NAME).resolve()
        execution_boundary = _write_execution_boundary(
            execution_boundary_ref,
            backend_manifest=backend_manifest,
            runtime_components=runtime_components,
            readiness_checks=readiness_checks,
        )
    partial_run: dict[str, Any] | None = None
    run_diagnostics: dict[str, Any] = {}
    run_attempted = False
    real_runner_implemented = False
    resource_lease = None
    release_status = "released-after-blocked"
    if execute and readiness_status == "ready":
        real_runner_implemented = True
        try:
            runner = command_runner or SubprocessCommandRunner()
            resource_lease = allocate_isolated_runtime_resources(
                root=root,
                requested_display=display,
                requested_vnc_port=vnc_port,
                requested_novnc_port=novnc_port,
                path_exists=path_exists or (lambda candidate: Path(candidate).exists()),
                port_available=port_available,
                resource_lock_root=Path(resource_lock_root).expanduser() if resource_lock_root else None,
                display_candidates=display_candidates or DISPLAY_CANDIDATES,
                vnc_port_candidates=vnc_port_candidates or VNC_PORT_CANDIDATES,
                novnc_port_candidates=novnc_port_candidates or NOVNC_PORT_CANDIDATES,
            )
            session_id = _l3_session_id()
            resource_lease.session_id = session_id
            _write_json(resource_lease.allocation_ref, resource_lease.summary(status="allocated"))
            run_attempted = True
            runner_impl = partial_runner or _run_real_l3_workflow_completed
            partial_run = dict(runner_impl(
                root=root,
                backend_manifest=backend_manifest,
                runtime_components=runtime_components,
                command_runner=runner,
                sleep=sleep,
                display=resource_lease.display,
                vnc_port=resource_lease.vnc_port,
                novnc_port=resource_lease.novnc_port,
                timeout_seconds=timeout_seconds,
                port_probe=port_probe,
                http_probe=http_probe,
                resource_allocation_ref=str(resource_lease.allocation_ref),
                session_id=session_id,
            ))
            partial_run["resourceAllocationRef"] = str(resource_lease.allocation_ref)
            partial_run["display"] = resource_lease.display
            partial_run["vncPort"] = resource_lease.vnc_port
            partial_run["novncPort"] = resource_lease.novnc_port
            run_diagnostics = {"blockedStage": partial_run.get("blockedStage")}
            if partial_run.get("status") == "completed" and partial_run.get("completionEvidenceRef"):
                release_status = "released-after-run"
                resource_lease.release(status=release_status)
                completed = {
                    **partial_run,
                    "resourceAllocationRef": str(resource_lease.allocation_ref),
                    "allocatedResources": resource_lease.summary(status=release_status),
                }
                resource_lease = None
                if execution_boundary is not None and execution_boundary_ref is not None:
                    execution_boundary = {
                        **execution_boundary,
                        "status": "completed",
                        "blockedStage": None,
                        "reason": "Same-session GUI runner produced completed L3 evidence refs.",
                        "realRunnerImplemented": True,
                        "completionEvidenceEligible": True,
                        "diagnosticOnly": False,
                        "userAcceptanceEligible": True,
                    }
                    _write_json(execution_boundary_ref, execution_boundary)
                manifest = _completed_l3_probe_manifest(
                    root=root,
                    manifest_ref=manifest_ref,
                    backend_manifest=backend_manifest,
                    runtime_components=runtime_components,
                    runtime_checks=runtime_checks,
                    completed=completed,
                    system=system,
                    display=completed.get("display"),
                    vnc_port=completed.get("vncPort"),
                    novnc_port=completed.get("novncPort"),
                    execution_boundary_ref=str(execution_boundary_ref) if execution_boundary_ref else None,
                    execution_boundary=execution_boundary,
                    runner_options={
                        "display": display,
                        "vncPort": vnc_port,
                        "novncPort": novnc_port,
                        "timeoutSeconds": float(timeout_seconds),
                        "resourceLockRoot": str(resource_lock_root) if resource_lock_root else None,
                    },
                )
                _write_json(manifest_ref, manifest)
                return manifest
        except (IsolatedDesktopRunFailed, IsolatedDesktopL1SmokeRunFailed) as exc:
            run_attempted = bool(exc.diagnostics.get("runAttempted", run_attempted))
            run_diagnostics = {
                "reason": f"Real L3 partial runner failed before workflow actions completed: {exc.reason}",
                **exc.diagnostics,
            }
        except (OSError, ValueError, KeyError) as exc:
            run_attempted = True
            run_diagnostics = {"reason": f"Real L3 partial runner failed before workflow actions completed: {exc}"}
        finally:
            if resource_lease is not None:
                resource_lease.release(status=release_status)
    blocked_reasons = [
        *[str(reason) for reason in backend_manifest.get("blockedReasons", []) if reason],
        *[check["reason"] for check in runtime_checks if not check["ok"]],
    ]
    if partial_run is not None:
        if execution_boundary is not None and execution_boundary_ref is not None:
            execution_boundary = {
                **execution_boundary,
                "blockedStage": "l3-workflow-actions-not-completed",
                "realRunnerImplemented": True,
                "partialRuntimeRunnerImplemented": True,
                "completionEvidenceEligible": False,
            }
            _write_json(execution_boundary_ref, execution_boundary)
        blocked_reasons.append(
            "L3 same-session runtime partial run reached the action boundary, but source-to-writer-to-preview GUI workflow actions are not completed."
        )
    elif execute and readiness_status == "ready":
        blocked_reasons.append(
            str(run_diagnostics.get("reason") or "Real isolated desktop L3 partial runner did not produce completed workflow evidence.")
        )
    elif execute:
        blocked_reasons.append(
            "L3 workflow prerequisites are missing; refusing to launch a partial or synthetic multi-app run."
        )
    else:
        blocked_reasons.append(
            "L3 workflow execute flag was not set; this probe is readiness-only and cannot claim completed evidence."
        )

    manifest = {
        "schemaVersion": ISOLATED_DESKTOP_L3_WORKFLOW_PROBE_SCHEMA,
        "status": "blocked",
        "category": (
            "isolated-desktop-l3-workflow-actions-blocked"
            if partial_run is not None
            else "isolated-desktop-l3-workflow-runner-blocked"
            if execute and readiness_status == "ready"
            else "isolated-desktop-l3-workflow-readiness-blocked"
        ),
        "reason": "; ".join(reason for reason in blocked_reasons if reason),
        "blockedReasons": [reason for reason in blocked_reasons if reason],
        "manifestRef": str(manifest_ref),
        "backendKind": BACKEND_KIND,
        "backendReadinessRef": backend_manifest.get("manifestRef"),
        "backendReadinessStatus": backend_manifest.get("status"),
        "platform": {"system": system, "machine": platform.machine()},
        "requiredRuntimeComponents": {
            name: list(candidates)
            for name, candidates in REQUIRED_L3_RUNTIME_COMPONENTS.items()
        },
        "observedRuntimeComponents": runtime_components,
        "readinessStatus": readiness_status,
        "readinessChecks": readiness_checks,
        "runtimeChecks": runtime_checks,
        "acceptanceTier": L3_ACCEPTANCE_TIER,
        "userAcceptanceEligible": False,
        "readinessOnly": not (execute and readiness_status == "ready"),
        "runAttempted": run_attempted,
        "realRunnerImplemented": real_runner_implemented,
        "blockedStage": _string_or_none(_mapping(partial_run).get("blockedStage")) or (
            "same-session-l3-runner-not-implemented"
            if execute and readiness_status == "ready" and partial_run is None
            else None
        ),
        "runDiagnostics": run_diagnostics,
        "runnerExecutionBoundaryRef": str(execution_boundary_ref) if execution_boundary_ref else None,
        "runnerExecutionBoundary": _boundary_summary(execution_boundary),
        "partialRunRef": _mapping(partial_run).get("partialRunRef"),
        "partialRuntimeRefs": _partial_runtime_refs(partial_run),
        "completionEvidenceRef": None,
        "targetEnvironmentKind": TARGET_ENVIRONMENT_KIND,
        "captureSource": ISOLATED_CAPTURE_SOURCE,
        "inputChannel": REMOTE_DESKTOP_INPUT_CHANNEL,
        "l3Workflow": {
            "status": _string_or_none(_mapping(partial_run).get("workflowStatus")) or "not-run",
            "completed": False,
            "workflowKind": L3_WORKFLOW_KIND,
            "sameVirtualSession": bool(_mapping(partial_run).get("sameVirtualSession")),
            "sameVirtualSessionRequired": True,
            "realWindowEvidence": bool(_mapping(partial_run).get("realWindowEvidence")),
            "sourceToArtifactCausalityProven": False,
            "artifactPreviewVerified": False,
            "directoryEvidenceVerified": False,
        },
        "workflowRequirements": {
            "workflowKind": L3_WORKFLOW_KIND,
            "minimumAppCount": 3,
            "minimumActionCount": 6,
            "requiredApplicationRoles": ["source", "writer", "file-preview"],
            "sameVirtualSession": True,
            "requiredInputModalities": ["pointer", "keyboard"],
            "requiresCurrentStepScreenshots": True,
            "forbidPriorRoundCompletionEvidence": True,
            "requiresDirectoryEvidence": True,
            "requiresArtifactPreview": True,
            "requiresGuiSavedArtifactCausality": "artifactCausality must cite finalArtifactRef, artifactValidationRef, savedThroughGui=true, shellDirectArtifactWrite=false and the keyboard savedByCommandEventRef for savedByActionIndex",
            "requiresGuiDirectoryPreviewCausality": "directoryEvidence must cite previewedThroughGui=true, shellDirectoryListingOnly=false and a pointer-backed previewedByActionIndex",
            "requiresSourceFactCitations": True,
            "partialRunSchemaRef": "sciforge.computer-use.isolated-desktop-l3-partial-run.v1",
            "partialRuntimeRefsPolicy": "partialRuntimeRefs may prove same-session runtime launch only; they are diagnostic and must not be copied into completed L3 top-level required refs",
            "forbidPartialRefsAsCompletedRefs": True,
            "requiresSessionBoundRuntimeProofs": "processRef and resourceAllocationRef must include sessionId/display values that match sessionManifestRef and virtualDisplayRef",
            "requiresBackendReadinessProof": "backendReadinessProofRef must prove ready Linux/noVNC runtime, queryable isolated X display, localhost noVNC HTTP viewer, and no shared/system input side effects before L3 input begins",
            "backendReadinessProofSchemaRef": BACKEND_READINESS_PROOF_SCHEMA_VERSION,
            "requiresExecutorCommandProvenance": "executorCommandEventLogRef must cite successful isolated input executor commands for every pointer/keyboard workflow action index, with matching modality, DISPLAY, returncode and no shared/system side-effect flags",
            "executorCommandEventLogSchemaRef": EXECUTOR_COMMAND_EVENT_LOG_SCHEMA,
            "requiresRuntimeResourceAllocation": "resourceAllocationRef must prove per-run isolated DISPLAY plus VNC/noVNC localhost ports were allocated for this L3 run",
            "resourceAllocationSchemaRef": ISOLATED_RUNTIME_RESOURCE_ALLOCATION_SCHEMA_VERSION,
            "legacyResourceAllocationSchemaRef": LEGACY_L1_RUNTIME_RESOURCE_ALLOCATION_SCHEMA_VERSION,
            "requiresProcessLogRefs": "processRef must expose long-running backend/app process records with stdout/stderr log refs",
            "requiresWindowBoundPointerProof": "L3 pointer events must cite target window/window-bound proof refs showing window-local coordinate dispatch and bounds hit-testing equivalent to L1",
            "targetWindowSchemaRef": ISOLATED_TARGET_WINDOW_SCHEMA_VERSION,
            "forbidBoundaryCompletionClaim": True,
            "forbidShellDirectArtifactWrite": True,
        },
        "applicationReadiness": _application_readiness(backend_manifest, runtime_components),
        "commandPlan": _command_plan(
            backend_manifest=backend_manifest,
            runtime_components=runtime_components,
            execute_requested=execute,
            execution_boundary_ref=str(execution_boundary_ref) if execution_boundary_ref else None,
            partial_run=partial_run,
            run_attempted=run_attempted,
            runner_options={
                "display": display,
                "vncPort": vnc_port,
                "novncPort": novnc_port,
                "timeoutSeconds": float(timeout_seconds),
                "resourceLockRoot": str(resource_lock_root) if resource_lock_root else None,
            },
        ),
        "evidenceContract": {
            "evidenceSchemaRef": ISOLATED_DESKTOP_L3_WORKFLOW_EVIDENCE_SCHEMA_VERSION,
            "validationSchemaRef": ISOLATED_DESKTOP_L3_WORKFLOW_EVIDENCE_VALIDATION_SCHEMA_VERSION,
            "builder": "sciforge_computer_use.isolated_desktop_l3_workflow_evidence.build_isolated_desktop_l3_workflow_evidence",
            "validator": "sciforge_computer_use.isolated_desktop_l3_workflow_evidence.validate_isolated_desktop_l3_workflow_evidence",
            "claimLimit": (
                "This blocked probe cannot satisfy L3. Only a completed payload from a real Linux "
                "isolated desktop session, with existing refs accepted by the L3 validator, can claim success."
            ),
        },
        "requiredCompletedRefs": [
            *REQUIRED_TOP_LEVEL_REFS,
            "traceRefs",
            "screenshotRefs",
            "applicationEvidence",
            "crossAppTransitions",
            "sourceEvidence",
            "derivedContentEvidence",
            "artifactCausality",
            "directoryEvidence",
            "presentationEvidence",
            "targetWindowRef",
            "windowBoundPointerProofRef",
        ],
        "blockedInputs": [
            "package-owned-target-bound-window",
            "target-bound-simulated-input",
            "readiness-only-manifest",
            "l1-smoke-only-evidence",
            "placeholder-only-viewer",
            "shape-only-refs",
            "partial-l3-runtime-refs",
            "partial-run-manifest",
            "runtime-launch-only-refs",
            "shell-direct-artifact-write",
            "prior-round-completion",
        ],
        "traceRefs": [],
        "screenshotRefs": [],
        "artifactRefs": [],
        "preflightRef": None,
        "resultRef": None,
        "viewerManifestRef": None,
        "viewerHtmlRef": None,
        "inputEventLogRef": None,
        "pointerEventLogRef": None,
        "keyboardEventLogRef": None,
        "backendReadinessProofRef": None,
        "executorCommandEventLogRef": None,
        "processRef": None,
        "resourceAllocationRef": None,
        "targetWindowRef": None,
        "windowBoundPointerProofRef": None,
        "sessionManifestRef": None,
        "virtualDisplayRef": None,
        "captureStreamRef": None,
        "replayBundleRef": None,
        "filesystemRootRef": None,
        "noVncViewerRef": None,
        "evidenceLogRef": None,
        "evidenceSnapshotRef": None,
        "evidenceIndexRef": None,
        "plannerBriefRef": None,
        "finalArtifactRef": None,
        "artifactValidationRef": None,
        "fileListArtifactRef": None,
        "fileListDataRef": None,
        "guiPresentRef": None,
        "diagnosticOnly": True,
        "realWindowEvidence": False,
        "rawPayloadWritten": False,
        "inlineImageWritten": False,
        "secretsWritten": False,
        "projectClaimLimit": (
            "This manifest is a fail-closed L3 readiness/runner-boundary probe. It can explain "
            "missing Linux/noVNC/LibreOffice/browser/file-preview readiness or partial same-session "
            "runtime launch refs, but partialRunRef/partialRuntimeRefs cannot complete PROJECT cross-app "
            "document workflow acceptance."
        ),
        **NO_OS_INPUT_FLAGS,
    }
    _write_json(manifest_ref, manifest)
    return manifest


def _completed_l3_probe_manifest(
    *,
    root: Path,
    manifest_ref: Path,
    backend_manifest: Mapping[str, Any],
    runtime_components: Mapping[str, Mapping[str, Any]],
    runtime_checks: Sequence[Mapping[str, Any]],
    completed: Mapping[str, Any],
    system: str,
    display: str | None,
    vnc_port: int | None,
    novnc_port: int | None,
    execution_boundary_ref: str | None,
    execution_boundary: Mapping[str, Any] | None,
    runner_options: Mapping[str, Any],
) -> dict[str, Any]:
    completion_evidence_ref = _string_or_none(completed.get("completionEvidenceRef"))
    completed_evidence_path = _root_resolved_ref(root, completion_evidence_ref)
    completed_evidence = _load_json_object(completed_evidence_path) if completed_evidence_path else {}
    completed_refs = dict(_mapping(completed.get("completedRefs")))
    for ref_name in REQUIRED_TOP_LEVEL_REFS:
        if _string_or_none(completed_evidence.get(ref_name)):
            completed_refs[ref_name] = completed_evidence[ref_name]
        elif _string_or_none(completed.get(ref_name)):
            completed_refs[ref_name] = completed[ref_name]
    trace_refs = _refs_from_completed(completed_evidence, completed, key="traceRefs")
    screenshot_refs = _refs_from_completed(completed_evidence, completed, key="screenshotRefs")
    artifact_refs = _refs_from_completed(completed_evidence, completed, key="artifactRefs")
    if not artifact_refs and _string_or_none(completed_refs.get("finalArtifactRef")):
        artifact_refs = [str(completed_refs["finalArtifactRef"])]
    return {
        "schemaVersion": ISOLATED_DESKTOP_L3_WORKFLOW_PROBE_SCHEMA,
        "status": "completed",
        "category": "isolated-desktop-l3-workflow-completed",
        "reason": "Real isolated desktop L3 multi-app workflow completed and passed evidence validation.",
        "blockedReasons": [],
        "manifestRef": str(manifest_ref),
        "backendKind": BACKEND_KIND,
        "backendReadinessRef": backend_manifest.get("manifestRef"),
        "backendReadinessStatus": backend_manifest.get("status"),
        "platform": {"system": system, "machine": platform.machine()},
        "requiredRuntimeComponents": {
            name: list(candidates)
            for name, candidates in REQUIRED_L3_RUNTIME_COMPONENTS.items()
        },
        "observedRuntimeComponents": dict(runtime_components),
        "readinessStatus": "ready",
        "readinessChecks": [{"category": "isolated-desktop-backend", "ok": True, "reason": ""}, *[dict(check) for check in runtime_checks]],
        "runtimeChecks": [dict(check) for check in runtime_checks],
        "acceptanceTier": L3_ACCEPTANCE_TIER,
        "userAcceptanceEligible": True,
        "readinessOnly": False,
        "runAttempted": True,
        "realRunnerImplemented": True,
        "blockedStage": None,
        "runDiagnostics": {"completionEvidenceRef": completion_evidence_ref},
        "runnerExecutionBoundaryRef": execution_boundary_ref,
        "runnerExecutionBoundary": _boundary_summary(execution_boundary),
        "partialRunRef": None,
        "partialRuntimeRefs": None,
        "completionEvidenceRef": _root_local_ref(root, completion_evidence_ref),
        "completionAssemblyRef": completed.get("completionAssemblyRef"),
        "targetEnvironmentKind": TARGET_ENVIRONMENT_KIND,
        "captureSource": ISOLATED_CAPTURE_SOURCE,
        "inputChannel": REMOTE_DESKTOP_INPUT_CHANNEL,
        "display": display,
        "vncPort": vnc_port,
        "novncPort": novnc_port,
        "l3Workflow": {
            "status": "completed",
            "completed": True,
            "workflowKind": L3_WORKFLOW_KIND,
            "sameVirtualSession": True,
            "sameVirtualSessionRequired": True,
            "realWindowEvidence": True,
            "sourceToArtifactCausalityProven": True,
            "artifactPreviewVerified": True,
            "directoryEvidenceVerified": True,
        },
        "workflowRequirements": {
            "workflowKind": L3_WORKFLOW_KIND,
            "minimumAppCount": 3,
            "minimumActionCount": 6,
            "requiredApplicationRoles": ["source", "writer", "file-preview"],
            "sameVirtualSession": True,
            "requiredInputModalities": ["pointer", "keyboard"],
            "requiresCurrentStepScreenshots": True,
            "forbidPriorRoundCompletionEvidence": True,
            "requiresDirectoryEvidence": True,
            "requiresArtifactPreview": True,
            "requiresWindowBoundPointerProof": True,
            "forbidPartialRefsAsCompletedRefs": True,
            "forbidShellDirectArtifactWrite": True,
        },
        "applicationReadiness": _application_readiness(backend_manifest, runtime_components),
        "commandPlan": {
            "status": "completed",
            "executeRequested": True,
            "runnerStatus": "completed",
            "executionBoundaryRef": execution_boundary_ref,
            "runnerOptions": dict(runner_options),
            "inputTool": _component_path(runtime_components, "isolatedInputTool"),
            "screenshotTool": _component_path(runtime_components, "screenshotTool"),
            "filePreviewTool": _component_path(runtime_components, "filePreviewTool"),
            "inputToolScope": "invoked only with DISPLAY bound to the isolated X display",
            "artifactPolicy": "final artifact saved through GUI and validated from refs",
            "sessionPolicy": "source reader, document writer, and file preview ran in the same isolated session",
            "sharedSystemInputAllowed": False,
            "completionEvidenceRequired": ISOLATED_DESKTOP_L3_WORKFLOW_EVIDENCE_SCHEMA_VERSION,
        },
        "evidenceContract": {
            "evidenceSchemaRef": ISOLATED_DESKTOP_L3_WORKFLOW_EVIDENCE_SCHEMA_VERSION,
            "validationSchemaRef": ISOLATED_DESKTOP_L3_WORKFLOW_EVIDENCE_VALIDATION_SCHEMA_VERSION,
            "validator": "sciforge_computer_use.isolated_desktop_l3_workflow_evidence.validate_isolated_desktop_l3_workflow_evidence",
            "assembler": "sciforge_computer_use.isolated_desktop_l3_workflow_result.assemble_isolated_desktop_l3_workflow_completion",
        },
        "requiredCompletedRefs": [
            *REQUIRED_TOP_LEVEL_REFS,
            "traceRefs",
            "screenshotRefs",
            "applicationEvidence",
            "crossAppTransitions",
            "sourceEvidence",
            "derivedContentEvidence",
            "artifactCausality",
            "directoryEvidence",
            "presentationEvidence",
            "targetWindowRef",
            "windowBoundPointerProofRef",
        ],
        "traceRefs": [_root_local_ref(root, ref) for ref in trace_refs],
        "screenshotRefs": [_root_local_ref(root, ref) for ref in screenshot_refs],
        "artifactRefs": [_root_local_ref(root, ref) for ref in artifact_refs],
        **{ref_name: _root_local_ref(root, completed_refs.get(ref_name)) for ref_name in REQUIRED_TOP_LEVEL_REFS},
        "diagnosticOnly": False,
        "realWindowEvidence": True,
        "inputExecuted": True,
        "executeFailClosed": False,
        "osInputExecuted": False,
        "realOsInputExecuted": False,
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
        "rawPayloadWritten": False,
        "inlineImageWritten": False,
        "secretsWritten": False,
        "projectClaimLimit": (
            "This manifest points to completed L3 evidence validated from existing refs. "
            "Partial runtime refs, if produced by a runner for diagnostics, are not promoted."
        ),
        "outputDirRef": str(root),
    }


def _root_resolved_ref(root: Path, ref: str | None) -> Path | None:
    if not ref:
        return None
    path_text = ref.split("#", 1)[0].strip()
    if not path_text:
        return None
    path = Path(path_text).expanduser()
    return path if path.is_absolute() else root / path


def _root_local_ref(root: Path, ref: Any) -> Any:
    if not isinstance(ref, str) or not ref:
        return ref
    path_text, separator, fragment = ref.partition("#")
    path = Path(path_text).expanduser()
    if not path.is_absolute():
        return ref
    try:
        relative = path.resolve(strict=False).relative_to(root.resolve(strict=False))
    except ValueError:
        return ref
    return relative.as_posix() + (separator + fragment if separator else "")


def _run_real_l3_workflow_completed(
    *,
    root: Path,
    backend_manifest: Mapping[str, Any],
    runtime_components: Mapping[str, Mapping[str, Any]],
    command_runner: Any,
    sleep: Callable[[float], None],
    display: str,
    vnc_port: int,
    novnc_port: int,
    timeout_seconds: float,
    port_probe: Callable[[str, int, float], bool],
    http_probe: Callable[[str, float], Mapping[str, Any]],
    resource_allocation_ref: str,
    session_id: str,
) -> dict[str, Any]:
    components = _mapping(backend_manifest.get("observedComponents"))
    session_root = (root / "isolated-l3-session").resolve()
    _reset_l3_run_owned_paths(root=root, session_root=session_root)
    filesystem_root = (session_root / "filesystem-root").resolve()
    artifact_dir = (filesystem_root / "out").resolve()
    screenshot_dir = (session_root / "screenshots").resolve()
    artifact_dir.mkdir(parents=True, exist_ok=True)
    screenshot_dir.mkdir(parents=True, exist_ok=True)

    final_artifact_ref = (artifact_dir / L3_FINAL_ARTIFACT_NAME).resolve()
    process_ref = (session_root / "backend-processes.json").resolve()
    readiness_proof_ref = (session_root / "backend-readiness-proof.json").resolve()
    command_event_log_ref = (session_root / L3_EXECUTOR_COMMAND_EVENT_LOG_NAME).resolve()
    target_window_ref = (session_root / "l3-target-window.json").resolve()
    window_bound_pointer_proof_ref = (session_root / "l3-window-bound-pointer-proof.json").resolve()
    input_event_log_ref = (session_root / "l3-input-events.json").resolve()
    pointer_event_log_ref = (session_root / "l3-pointer-events.json").resolve()
    keyboard_event_log_ref = (session_root / "l3-keyboard-events.json").resolve()
    preflight_ref = (root / "isolated-desktop-l3-backend-preflight.json").resolve()
    result_ref = (root / "computer-use-result.json").resolve()
    trace_ref = (root / "vision-trace.json").resolve()
    file_list_artifact_ref = (artifact_dir / "file-list.json").resolve()
    file_list_data_ref = (artifact_dir / "file-list-data.json").resolve()
    gui_present_ref = (root / "gui-present.json").resolve()

    env = _isolated_display_env(display, session_root, session_id=session_id)
    input_tool_path = _component_path(runtime_components, "isolatedInputTool")
    processes: list[Any] = []
    process_records: list[dict[str, Any]] = []
    command_events: list[dict[str, Any]] = []
    pointer_actions: list[dict[str, Any]] = []
    pointer_events: list[dict[str, Any]] = []
    keyboard_events: list[dict[str, Any]] = []
    screenshots: dict[str, str] = {}

    try:
        _write_l3_static_refs(
            session_root=session_root,
            display=display,
            vnc_port=vnc_port,
            novnc_port=novnc_port,
            process_ref=process_ref,
            resource_allocation_ref=resource_allocation_ref,
            session_id=session_id,
            diagnostic_only=False,
        )
        _write_l3_executor_command_event_log(
            command_event_log_ref,
            display=display,
            session_id=session_id,
            command_events=command_events,
        )

        virtual_display_process = _l1_start_process(
            command_runner,
            "virtual-display",
            [_l1_component_path(components, "virtualDisplay"), display, "-screen", "0", "1280x720x24", "-nolisten", "tcp"],
            env=env,
            process_records=process_records,
            process_ref=process_ref,
        )
        processes.append(virtual_display_process)
        _l1_ensure_process_running(virtual_display_process, role="virtual-display", process_records=process_records, process_ref=process_ref)
        x_display_proof = _wait_for_x_display_geometry(
            command_runner,
            input_tool_path,
            env=env,
            timeout_seconds=timeout_seconds,
            sleep=sleep,
        )
        window_manager_process = _l1_start_process(
            command_runner,
            "window-manager",
            [_l1_component_path(components, "windowManager")],
            env=env,
            process_records=process_records,
            process_ref=process_ref,
        )
        processes.append(window_manager_process)
        vnc_process = _l1_start_process(
            command_runner,
            "vnc-server",
            _vnc_server_command(_l1_component_record(components, "vncServer"), display=display, port=vnc_port),
            env=env,
            process_records=process_records,
            process_ref=process_ref,
        )
        processes.append(vnc_process)
        novnc_process = _l1_start_process(
            command_runner,
            "novnc-proxy",
            _novnc_proxy_command(
                _l1_component_record(components, "noVncProxy"),
                novnc_web_root=str(backend_manifest.get("noVncWebRoot") or ""),
                vnc_port=vnc_port,
                novnc_port=novnc_port,
            ),
            env=env,
            process_records=process_records,
            process_ref=process_ref,
        )
        processes.append(novnc_process)
        sleep(0.5)
        for process, role in (
            (window_manager_process, "window-manager"),
            (vnc_process, "vnc-server"),
            (novnc_process, "novnc-proxy"),
        ):
            _l1_ensure_process_running(process, role=role, process_records=process_records, process_ref=process_ref)
        _wait_for_tcp_port("127.0.0.1", vnc_port, timeout_seconds=timeout_seconds, sleep=sleep, port_probe=port_probe, role="vnc-server")
        _wait_for_tcp_port("127.0.0.1", novnc_port, timeout_seconds=timeout_seconds, sleep=sleep, port_probe=port_probe, role="novnc-proxy")
        novnc_viewer_url = f"http://127.0.0.1:{novnc_port}/vnc.html"
        novnc_http_proof = _wait_for_http_viewer(
            novnc_viewer_url,
            timeout_seconds=timeout_seconds,
            sleep=sleep,
            http_probe=http_probe,
        )

        source_page_ref = _write_l3_source_page(filesystem_root)
        source_profile = filesystem_root / "source-browser-profile"
        source_profile.mkdir(parents=True, exist_ok=True)
        source_process = _l1_start_process(
            command_runner,
            "source-reader",
            _browser_command(
                _l1_component_record(components, "browser"),
                smoke_page_ref=source_page_ref,
                profile_dir=source_profile,
            ),
            env=env,
            process_records=process_records,
            process_ref=process_ref,
        )
        processes.append(source_process)
        source_readiness = _wait_for_browser_page_ready(
            command_runner,
            input_tool_path,
            env=env,
            ready_title=L3_SOURCE_READY_TITLE,
            smoke_page_ref=source_page_ref,
            timeout_seconds=timeout_seconds,
            sleep=sleep,
        )
        _write_backend_readiness_proof(
            readiness_proof_ref,
            display=display,
            x_display_proof=x_display_proof,
            vnc_port=vnc_port,
            novnc_port=novnc_port,
            novnc_http_proof=novnc_http_proof,
            process_ref=process_ref,
            process_records=process_records,
        )
        _update_backend_readiness_interaction_proof(
            readiness_proof_ref,
            browser_readiness_proof=source_readiness,
        )
        source_window = dict(_mapping(source_readiness.get("desktopWindow")))
        screenshots["source_first"] = _capture_l3_screenshot(
            command_runner,
            runtime_components,
            env=env,
            screenshot_dir=screenshot_dir,
            name="00-source-first.png",
            timeout_seconds=timeout_seconds,
        )
        _l3_window_bound_click(
            command_runner=command_runner,
            input_tool_path=input_tool_path,
            env=env,
            timeout_seconds=timeout_seconds,
            command_event_log_ref=command_event_log_ref,
            command_events=command_events,
            pointer_actions=pointer_actions,
            pointer_events=pointer_events,
            action_index=0,
            target_id="source-reader-open",
            target_description="source reader source facts",
            desktop_window=source_window,
            target_bounds={"x": 60, "y": 90, "width": 720, "height": 260},
            hit_point={"x": 180, "y": 170},
        )
        screenshots["source_last"] = _capture_l3_screenshot(
            command_runner,
            runtime_components,
            env=env,
            screenshot_dir=screenshot_dir,
            name="01-source-clicked.png",
            timeout_seconds=timeout_seconds,
        )

        writer_process = _l1_start_process(
            command_runner,
            "document-writer",
            _document_writer_command(_l1_component_record(components, "documentApp")),
            env=env,
            process_records=process_records,
            process_ref=process_ref,
        )
        processes.append(writer_process)
        writer_window = _wait_for_any_visible_window(
            command_runner,
            input_tool_path,
            env=env,
            names=("LibreOffice", "Untitled", "Writer"),
            timeout_seconds=timeout_seconds,
            sleep=sleep,
        )
        screenshots["writer_first"] = _capture_l3_screenshot(
            command_runner,
            runtime_components,
            env=env,
            screenshot_dir=screenshot_dir,
            name="02-writer-first.png",
            timeout_seconds=timeout_seconds,
        )
        _l3_window_bound_click(
            command_runner=command_runner,
            input_tool_path=input_tool_path,
            env=env,
            timeout_seconds=timeout_seconds,
            command_event_log_ref=command_event_log_ref,
            command_events=command_events,
            pointer_actions=pointer_actions,
            pointer_events=pointer_events,
            action_index=1,
            target_id="document-body-focus",
            target_description="document body",
            desktop_window=writer_window,
            target_bounds={"x": 160, "y": 140, "width": 820, "height": 470},
            hit_point={"x": 420, "y": 350},
        )
        screenshots["writer_focused"] = _capture_l3_screenshot(
            command_runner,
            runtime_components,
            env=env,
            screenshot_dir=screenshot_dir,
            name="03-writer-focused.png",
            timeout_seconds=timeout_seconds,
        )
        sleep(0.5)
        _l3_keyboard_command(
            command_runner=command_runner,
            args=[input_tool_path, "type", "--delay", "10", f"{L3_TYPED_DOCUMENT_PREFIX} {' '.join(L3_SOURCE_FACTS)}"],
            env=env,
            timeout_seconds=timeout_seconds,
            command_event_log_ref=command_event_log_ref,
            command_events=command_events,
            keyboard_events=keyboard_events,
            action_index=2,
            action_kind="type_text",
            target="document body",
            text_length=sum(len(fact) for fact in L3_SOURCE_FACTS),
        )
        screenshots["writer_last"] = _capture_l3_screenshot(
            command_runner,
            runtime_components,
            env=env,
            screenshot_dir=screenshot_dir,
            name="04-writer-typed.png",
            timeout_seconds=timeout_seconds,
        )
        _l3_keyboard_command(
            command_runner=command_runner,
            args=[input_tool_path, "key", "ctrl+shift+s"],
            env=env,
            timeout_seconds=timeout_seconds,
            command_event_log_ref=command_event_log_ref,
            command_events=command_events,
            keyboard_events=keyboard_events,
            action_index=3,
            action_kind="save",
            target="document save dialog",
            keys=["Ctrl", "Shift", "S"],
        )
        save_dialog = _wait_for_any_visible_window(
            command_runner,
            input_tool_path,
            env=env,
            names=("Save as", "Save As"),
            timeout_seconds=timeout_seconds,
            sleep=sleep,
        )
        screenshots["save_dialog_open"] = _capture_l3_screenshot(
            command_runner,
            runtime_components,
            env=env,
            screenshot_dir=screenshot_dir,
            name="05-save-dialog-open.png",
            timeout_seconds=timeout_seconds,
        )
        _l3_keyboard_command(
            command_runner=command_runner,
            args=[input_tool_path, "key", "--window", str(save_dialog["windowId"]), "ctrl+a", "type", "--delay", "5", str(final_artifact_ref.with_suffix(""))],
            env=env,
            timeout_seconds=timeout_seconds,
            command_event_log_ref=command_event_log_ref,
            command_events=command_events,
            keyboard_events=keyboard_events,
            action_index=4,
            action_kind="type_text",
            target="save dialog filename",
            text_length=len(str(final_artifact_ref.with_suffix(""))),
        )
        screenshots["save_dialog_filename"] = _capture_l3_screenshot(
            command_runner,
            runtime_components,
            env=env,
            screenshot_dir=screenshot_dir,
            name="06-save-dialog-filename.png",
            timeout_seconds=timeout_seconds,
        )
        _l3_window_bound_click(
            command_runner=command_runner,
            input_tool_path=input_tool_path,
            env=env,
            timeout_seconds=timeout_seconds,
            command_event_log_ref=command_event_log_ref,
            command_events=command_events,
            pointer_actions=pointer_actions,
            pointer_events=pointer_events,
            action_index=5,
            target_id="save-dialog-file-type-dropdown",
            target_description="save dialog file type dropdown",
            desktop_window=save_dialog,
            target_bounds={"x": 540, "y": 276, "width": 70, "height": 36},
            hit_point={"x": 566, "y": 291},
        )
        sleep(0.2)
        screenshots["save_dialog_dropdown"] = _capture_l3_screenshot(
            command_runner,
            runtime_components,
            env=env,
            screenshot_dir=screenshot_dir,
            name="07-save-dialog-file-type-dropdown.png",
            timeout_seconds=timeout_seconds,
        )
        _l3_keyboard_command(
            command_runner=command_runner,
            args=[input_tool_path, "key", "--window", str(save_dialog["windowId"]), "Down", "Down", "Down", "Down", "Return"],
            env=env,
            timeout_seconds=timeout_seconds,
            command_event_log_ref=command_event_log_ref,
            command_events=command_events,
            keyboard_events=keyboard_events,
            action_index=6,
            action_kind="press_key",
            target="Word 2007-365 docx file type",
            keys=["Down", "Down", "Down", "Down", "Return"],
        )
        screenshots["save_dialog_docx"] = _capture_l3_screenshot(
            command_runner,
            runtime_components,
            env=env,
            screenshot_dir=screenshot_dir,
            name="08-save-dialog-docx-selected.png",
            timeout_seconds=timeout_seconds,
        )
        _l3_window_bound_click(
            command_runner=command_runner,
            input_tool_path=input_tool_path,
            env=env,
            timeout_seconds=timeout_seconds,
            command_event_log_ref=command_event_log_ref,
            command_events=command_events,
            pointer_actions=pointer_actions,
            pointer_events=pointer_events,
            action_index=7,
            target_id="save-dialog-save-button",
            target_description="save dialog Save button",
            desktop_window=save_dialog,
            target_bounds={"x": 585, "y": 245, "width": 95, "height": 42},
            hit_point={"x": 631, "y": 262},
        )
        confirm_dialog = _wait_for_any_visible_window(
            command_runner,
            input_tool_path,
            env=env,
            names=("Confirm File Format", "Confirm"),
            timeout_seconds=timeout_seconds,
            sleep=sleep,
        )
        screenshots["confirm_dialog"] = _capture_l3_screenshot(
            command_runner,
            runtime_components,
            env=env,
            screenshot_dir=screenshot_dir,
            name="09-confirm-file-format.png",
            timeout_seconds=timeout_seconds,
        )
        _l3_window_bound_click(
            command_runner=command_runner,
            input_tool_path=input_tool_path,
            env=env,
            timeout_seconds=timeout_seconds,
            command_event_log_ref=command_event_log_ref,
            command_events=command_events,
            pointer_actions=pointer_actions,
            pointer_events=pointer_events,
            action_index=8,
            target_id="confirm-docx-format-button",
            target_description="Use Word 2007-365 Format button",
            desktop_window=confirm_dialog,
            target_bounds={"x": 285, "y": 120, "width": 230, "height": 42},
            hit_point={"x": 380, "y": 134},
        )
        _wait_for_file(final_artifact_ref, timeout_seconds=timeout_seconds, sleep=sleep)
        screenshots["writer_saved"] = _capture_l3_screenshot(
            command_runner,
            runtime_components,
            env=env,
            screenshot_dir=screenshot_dir,
            name="10-writer-saved.png",
            timeout_seconds=timeout_seconds,
        )

        artifact_validation_ref = final_artifact_ref.with_suffix(final_artifact_ref.suffix + ".validation.json").resolve()
        artifact_validation = validate_docx_artifact(final_artifact_ref)
        _write_json(artifact_validation_ref, artifact_validation)
        if artifact_validation.get("ok") is not True:
            raise IsolatedDesktopRunFailed(
                "Real L3 GUI-saved DOCX did not pass artifact validation.",
                {"artifactValidationRef": str(artifact_validation_ref), "errors": artifact_validation.get("errors")},
            )

        preview_profile = filesystem_root / "file-preview-browser-profile"
        preview_profile.mkdir(parents=True, exist_ok=True)
        preview_process = _l1_start_process(
            command_runner,
            "file-preview",
            _browser_command(
                _l1_component_record(components, "browser"),
                smoke_page_ref=artifact_dir,
                profile_dir=preview_profile,
            ),
            env=env,
            process_records=process_records,
            process_ref=process_ref,
        )
        processes.append(preview_process)
        preview_window = _wait_for_any_visible_window(
            command_runner,
            input_tool_path,
            env=env,
            names=("Index of", L3_FINAL_ARTIFACT_NAME, "Chromium"),
            timeout_seconds=timeout_seconds,
            sleep=sleep,
        )
        screenshots["preview_first"] = _capture_l3_screenshot(
            command_runner,
            runtime_components,
            env=env,
            screenshot_dir=screenshot_dir,
            name="11-preview-directory.png",
            timeout_seconds=timeout_seconds,
        )
        _l3_window_bound_click(
            command_runner=command_runner,
            input_tool_path=input_tool_path,
            env=env,
            timeout_seconds=timeout_seconds,
            command_event_log_ref=command_event_log_ref,
            command_events=command_events,
            pointer_actions=pointer_actions,
            pointer_events=pointer_events,
            action_index=9,
            target_id="preview-final-artifact-entry",
            target_description="saved artifact entry in directory preview",
            desktop_window=preview_window,
            target_bounds={"x": 20, "y": 110, "width": 360, "height": 120},
            hit_point={"x": 110, "y": 170},
        )
        screenshots["preview_last"] = _capture_l3_screenshot(
            command_runner,
            runtime_components,
            env=env,
            screenshot_dir=screenshot_dir,
            name="12-preview-entry-clicked.png",
            timeout_seconds=timeout_seconds,
        )

        _write_l3_file_list_refs(
            file_list_artifact_ref=file_list_artifact_ref,
            file_list_data_ref=file_list_data_ref,
            final_artifact_ref=final_artifact_ref,
        )
        source_fact_refs = _write_l3_source_fact_refs(root / "source-facts")
        _write_l3_target_and_pointer_refs(
            target_window_ref=target_window_ref,
            pointer_proof_ref=window_bound_pointer_proof_ref,
            display=display,
            target_window=source_window,
            pointer_actions=pointer_actions,
        )
        _write_l3_input_event_logs(
            pointer_event_log_ref=pointer_event_log_ref,
            keyboard_event_log_ref=keyboard_event_log_ref,
            input_event_log_ref=input_event_log_ref,
            executor_command_event_log_ref=command_event_log_ref,
            pointer_events=pointer_events,
            keyboard_events=keyboard_events,
        )

        screenshot_refs = _l3_screenshot_refs(screenshots)
        steps = _l3_completed_steps(screenshots)
        diagnostics = _l3_result_diagnostics(
            input_event_log_ref=input_event_log_ref,
            pointer_event_log_ref=pointer_event_log_ref,
            keyboard_event_log_ref=keyboard_event_log_ref,
            backend_readiness_proof_ref=readiness_proof_ref,
            executor_command_event_log_ref=command_event_log_ref,
            process_ref=process_ref,
            resource_allocation_ref=resource_allocation_ref,
            target_window_ref=target_window_ref,
            window_bound_pointer_proof_ref=window_bound_pointer_proof_ref,
        )
        result = _l3_result_payload(
            steps=steps,
            screenshot_refs=screenshot_refs,
            trace_ref=trace_ref,
            final_artifact_ref=final_artifact_ref,
            final_observation_ref=screenshots["preview_last"],
            diagnostics=diagnostics,
        )
        trace = {
            "schemaVersion": "sciforge.computer-use.loop-trace.v1",
            "status": "completed",
            "reason": "Isolated desktop L3 source-to-DOCX-to-preview workflow completed.",
            "steps": [dict(step) for step in steps],
            "traceRefs": [],
            "screenshotRefs": screenshot_refs,
            "artifactRefs": [str(final_artifact_ref)],
            "finalArtifactRef": str(final_artifact_ref),
            "finalObservationRef": screenshots["preview_last"],
            "failureDiagnostics": diagnostics,
        }
        _write_json(result_ref, result)
        _write_json(trace_ref, trace)
        viewer = build_visible_run_viewer(
            output_dir=root,
            result=result,
            result_ref=result_ref,
            title="Isolated desktop L3 workflow",
        )
        viewer_manifest_ref = (root / "visible-run-viewer-manifest.json").resolve()
        viewer_html_ref = Path(str(viewer.get("viewerHtmlRef"))).resolve()
        _write_l3_gui_present_ref(
            gui_present_ref=gui_present_ref,
            final_artifact_ref=final_artifact_ref,
            trace_ref=trace_ref,
            screenshot_refs=screenshot_refs,
        )
        evidence_refs = _write_l3_evidence_ledger(
            root / "evidence",
            source_ref=screenshots["source_last"],
            final_artifact_ref=str(final_artifact_ref),
            directory_ref=screenshots["preview_last"],
            file_list_refs=[str(file_list_artifact_ref), str(file_list_data_ref)],
        )
        _write_l3_completed_preflight_ref(
            preflight_ref,
            backend_manifest=backend_manifest,
            platform_system="Linux",
        )
        _update_l3_completed_session_refs(
            session_root=session_root,
            screenshot_refs=screenshot_refs,
            trace_ref=str(trace_ref),
            input_event_log_ref=str(input_event_log_ref),
        )

        evidence_payload = _l3_completed_evidence_payload(
            preflight_ref=preflight_ref,
            result_ref=result_ref,
            trace_ref=trace_ref,
            screenshot_refs=screenshot_refs,
            viewer_manifest_ref=viewer_manifest_ref,
            viewer_html_ref=viewer_html_ref,
            input_event_log_ref=input_event_log_ref,
            pointer_event_log_ref=pointer_event_log_ref,
            keyboard_event_log_ref=keyboard_event_log_ref,
            backend_readiness_proof_ref=readiness_proof_ref,
            executor_command_event_log_ref=command_event_log_ref,
            target_window_ref=target_window_ref,
            window_bound_pointer_proof_ref=window_bound_pointer_proof_ref,
            process_ref=process_ref,
            resource_allocation_ref=Path(resource_allocation_ref),
            session_manifest_ref=session_root / "virtual-desktop-session-manifest.json",
            virtual_display_ref=session_root / "virtual-display.json",
            capture_stream_ref=session_root / "capture-stream.json",
            replay_bundle_ref=session_root / "replay-bundle.json",
            filesystem_root_ref=filesystem_root,
            no_vnc_viewer_ref=session_root / "novnc-viewer.json",
            evidence_refs=evidence_refs,
            final_artifact_ref=final_artifact_ref,
            artifact_validation_ref=artifact_validation_ref,
            file_list_artifact_ref=file_list_artifact_ref,
            file_list_data_ref=file_list_data_ref,
            source_fact_refs=source_fact_refs,
            gui_present_ref=gui_present_ref,
            screenshots=screenshots,
        )
        assembly = assemble_isolated_desktop_l3_workflow_completion(
            payload=evidence_payload,
            output_dir=root,
        )
        if assembly.get("status") != "completed" or not assembly.get("completionEvidenceRef"):
            raise IsolatedDesktopRunFailed(
                "Real L3 run did not satisfy isolated desktop workflow validation.",
                {
                    "assemblyRef": assembly.get("manifestRef"),
                    "errors": assembly.get("errors"),
                    "validation": assembly.get("validation"),
                },
            )
        return {
            "schemaVersion": "sciforge.computer-use.isolated-desktop-l3-completed-run.v1",
            "status": "completed",
            "completionEvidenceRef": assembly.get("completionEvidenceRef"),
            "completionAssemblyRef": assembly.get("manifestRef"),
            "evidenceValidation": {"ok": True, "errors": []},
            "preflightRef": str(preflight_ref),
            "resultRef": str(result_ref),
            "traceRefs": [str(trace_ref)],
            "screenshotRefs": screenshot_refs,
            "viewerManifestRef": str(viewer_manifest_ref),
            "viewerHtmlRef": str(viewer_html_ref),
            "inputEventLogRef": str(input_event_log_ref),
            "pointerEventLogRef": str(pointer_event_log_ref),
            "keyboardEventLogRef": str(keyboard_event_log_ref),
            "backendReadinessProofRef": str(readiness_proof_ref),
            "executorCommandEventLogRef": str(command_event_log_ref),
            "targetWindowRef": str(target_window_ref),
            "windowBoundPointerProofRef": str(window_bound_pointer_proof_ref),
            "processRef": str(process_ref),
            "resourceAllocationRef": resource_allocation_ref,
            "sessionManifestRef": str(session_root / "virtual-desktop-session-manifest.json"),
            "virtualDisplayRef": str(session_root / "virtual-display.json"),
            "captureStreamRef": str(session_root / "capture-stream.json"),
            "replayBundleRef": str(session_root / "replay-bundle.json"),
            "filesystemRootRef": str(filesystem_root),
            "noVncViewerRef": str(session_root / "novnc-viewer.json"),
            "evidenceLogRef": evidence_refs["evidenceLogRef"],
            "evidenceSnapshotRef": evidence_refs["evidenceSnapshotRef"],
            "evidenceIndexRef": evidence_refs["evidenceIndexRef"],
            "plannerBriefRef": evidence_refs["plannerBriefRef"],
            "finalArtifactRef": str(final_artifact_ref),
            "artifactValidationRef": str(artifact_validation_ref),
            "fileListArtifactRef": str(file_list_artifact_ref),
            "fileListDataRef": str(file_list_data_ref),
            "guiPresentRef": str(gui_present_ref),
            "display": display,
            "vncPort": vnc_port,
            "novncPort": novnc_port,
            "sameVirtualSession": True,
            "realWindowEvidence": True,
            "userAcceptanceEligible": True,
            "diagnosticOnly": False,
        }
    except (OSError, subprocess.SubprocessError, KeyError, ValueError, IsolatedDesktopL1SmokeRunFailed) as exc:
        raise IsolatedDesktopRunFailed(
            f"Real L3 backend execution failed: {exc}",
            {
                "runAttempted": True,
                "processRef": str(process_ref),
                "executorCommandEventLogRef": str(command_event_log_ref),
                "processes": process_records,
            },
        ) from exc
    finally:
        for process in reversed(processes):
            _l1_stop_process(process)
        _mark_l1_session_closed(
            session_root=session_root,
            process_ref=process_ref,
            process_records=process_records,
        )
        _bundle_localize_json_payload_files(root)


def _run_real_l3_workflow_partial(
    *,
    root: Path,
    backend_manifest: Mapping[str, Any],
    runtime_components: Mapping[str, Mapping[str, Any]],
    command_runner: Any,
    sleep: Callable[[float], None],
    display: str,
    vnc_port: int,
    novnc_port: int,
    timeout_seconds: float,
    port_probe: Callable[[str, int, float], bool],
    http_probe: Callable[[str, float], Mapping[str, Any]],
    resource_allocation_ref: str,
    session_id: str,
) -> dict[str, Any]:
    components = _mapping(backend_manifest.get("observedComponents"))
    session_root = (root / "isolated-l3-session").resolve()
    filesystem_root = (session_root / "filesystem-root").resolve()
    screenshot_dir = (session_root / "screenshots").resolve()
    filesystem_root.mkdir(parents=True, exist_ok=True)
    screenshot_dir.mkdir(parents=True, exist_ok=True)
    process_ref = (session_root / "backend-processes.json").resolve()
    readiness_proof_ref = (session_root / "backend-readiness-proof.json").resolve()
    command_event_log_ref = (session_root / "l3-executor-command-events.json").resolve()
    partial_run_ref = (root / PARTIAL_RUN_REF_NAME).resolve()
    env = _isolated_display_env(display, session_root, session_id=session_id)
    processes: list[Any] = []
    process_records: list[dict[str, Any]] = []
    try:
        _write_l3_static_refs(
            session_root=session_root,
            display=display,
            vnc_port=vnc_port,
            novnc_port=novnc_port,
            process_ref=process_ref,
            resource_allocation_ref=resource_allocation_ref,
            session_id=session_id,
        )
        _write_l3_empty_executor_command_event_log(
            command_event_log_ref,
            display=display,
            session_id=session_id,
        )
        virtual_display_process = _l1_start_process(
            command_runner,
            "virtual-display",
            [_l1_component_path(components, "virtualDisplay"), display, "-screen", "0", "1280x720x24", "-nolisten", "tcp"],
            env=env,
            process_records=process_records,
            process_ref=process_ref,
        )
        processes.append(virtual_display_process)
        _l1_ensure_process_running(virtual_display_process, role="virtual-display", process_records=process_records, process_ref=process_ref)
        x_display_proof = _wait_for_x_display_geometry(
            command_runner,
            _component_path(runtime_components, "isolatedInputTool"),
            env=env,
            timeout_seconds=timeout_seconds,
            sleep=sleep,
        )
        window_manager_process = _l1_start_process(
            command_runner,
            "window-manager",
            [_l1_component_path(components, "windowManager")],
            env=env,
            process_records=process_records,
            process_ref=process_ref,
        )
        processes.append(window_manager_process)
        vnc_process = _l1_start_process(
            command_runner,
            "vnc-server",
            _vnc_server_command(_l1_component_record(components, "vncServer"), display=display, port=vnc_port),
            env=env,
            process_records=process_records,
            process_ref=process_ref,
        )
        processes.append(vnc_process)
        novnc_process = _l1_start_process(
            command_runner,
            "novnc-proxy",
            _novnc_proxy_command(
                _l1_component_record(components, "noVncProxy"),
                novnc_web_root=str(backend_manifest.get("noVncWebRoot") or ""),
                vnc_port=vnc_port,
                novnc_port=novnc_port,
            ),
            env=env,
            process_records=process_records,
            process_ref=process_ref,
        )
        processes.append(novnc_process)
        sleep(0.5)
        for process, role in (
            (window_manager_process, "window-manager"),
            (vnc_process, "vnc-server"),
            (novnc_process, "novnc-proxy"),
        ):
            _l1_ensure_process_running(process, role=role, process_records=process_records, process_ref=process_ref)
        _wait_for_tcp_port("127.0.0.1", vnc_port, timeout_seconds=timeout_seconds, sleep=sleep, port_probe=port_probe, role="vnc-server")
        _wait_for_tcp_port("127.0.0.1", novnc_port, timeout_seconds=timeout_seconds, sleep=sleep, port_probe=port_probe, role="novnc-proxy")
        novnc_viewer_url = f"http://127.0.0.1:{novnc_port}/vnc.html"
        novnc_http_proof = _wait_for_http_viewer(
            novnc_viewer_url,
            timeout_seconds=timeout_seconds,
            sleep=sleep,
            http_probe=http_probe,
        )
        source_page_ref = _write_l3_source_page(filesystem_root)
        browser_profile = filesystem_root / "browser-profile"
        browser_profile.mkdir(parents=True, exist_ok=True)
        source_process = _l1_start_process(
            command_runner,
            "source-reader",
            _browser_command(
                _l1_component_record(components, "browser"),
                smoke_page_ref=source_page_ref,
                profile_dir=browser_profile,
            ),
            env=env,
            process_records=process_records,
            process_ref=process_ref,
        )
        processes.append(source_process)
        source_readiness = _wait_for_browser_page_ready(
            command_runner,
            _component_path(runtime_components, "isolatedInputTool"),
            env=env,
            ready_title=L3_SOURCE_READY_TITLE,
            smoke_page_ref=source_page_ref,
            timeout_seconds=timeout_seconds,
            sleep=sleep,
        )
        writer_process = _l1_start_process(
            command_runner,
            "document-writer",
            _document_writer_command(_l1_component_record(components, "documentApp")),
            env=env,
            process_records=process_records,
            process_ref=process_ref,
        )
        processes.append(writer_process)
        preview_process = _start_l3_file_preview_process(
            command_runner=command_runner,
            runtime_components=runtime_components,
            filesystem_root=filesystem_root,
            env=env,
            process_records=process_records,
            process_ref=process_ref,
            timeout_seconds=timeout_seconds,
        )
        if preview_process is not None:
            processes.append(preview_process)
        for process, role in (
            (source_process, "source-reader"),
            (writer_process, "document-writer"),
        ):
            _l1_ensure_process_running(process, role=role, process_records=process_records, process_ref=process_ref)
        if preview_process is not None:
            _ensure_l3_file_preview_process_ready(
                preview_process,
                process_records=process_records,
                process_ref=process_ref,
            )
        _write_backend_readiness_proof(
            readiness_proof_ref,
            display=display,
            x_display_proof=x_display_proof,
            vnc_port=vnc_port,
            novnc_port=novnc_port,
            novnc_http_proof=novnc_http_proof,
            process_ref=process_ref,
            process_records=process_records,
        )
        screenshot_ref = _l1_capture_screenshot(
            command_runner,
            runtime_components,
            env=env,
            output_ref=screenshot_dir / "00-partial-runtime.png",
            timeout_seconds=timeout_seconds,
        )
        _update_l3_runtime_frame_refs(
            session_root=session_root,
            screenshot_refs=[screenshot_ref],
        )
        payload = {
            "schemaVersion": "sciforge.computer-use.isolated-desktop-l3-partial-run.v1",
            "status": "blocked",
            "blockedStage": "l3-workflow-actions-not-completed",
            "reason": "Same-session isolated runtime launched, but source-to-writer-to-preview GUI workflow actions are not completed.",
            "runAttempted": True,
            "realRunnerImplemented": True,
            "completionEvidenceRef": None,
            "sessionId": session_id,
            "display": display,
            "vncPort": vnc_port,
            "novncPort": novnc_port,
            "partialRunRef": str(partial_run_ref),
            "sessionManifestRef": str(session_root / "virtual-desktop-session-manifest.json"),
            "virtualDisplayRef": str(session_root / "virtual-display.json"),
            "captureStreamRef": str(session_root / "capture-stream.json"),
            "replayBundleRef": str(session_root / "replay-bundle.json"),
            "filesystemRootRef": str(filesystem_root),
            "noVncViewerRef": str(session_root / "novnc-viewer.json"),
            "backendReadinessProofRef": str(readiness_proof_ref),
            "executorCommandEventLogRef": str(command_event_log_ref),
            "processRef": str(process_ref),
            "resourceAllocationRef": resource_allocation_ref,
            "screenshotRefs": [screenshot_ref],
            "workflowStatus": "runtime-ready-actions-blocked",
            "sameVirtualSession": True,
            "realWindowEvidence": True,
            "applicationLaunches": [
                {"role": role, "status": "started", "display": display, "sessionId": session_id}
                for role in ("source-reader", "document-writer", "file-preview")
            ],
            "sourceReadiness": source_readiness,
            "diagnosticOnly": True,
            "userAcceptanceEligible": False,
            "rawPayloadWritten": False,
            "inlineImageWritten": False,
            "secretsWritten": False,
            **NO_OS_INPUT_FLAGS,
        }
        _write_json(partial_run_ref, payload)
        return payload
    finally:
        for process in reversed(processes):
            _l1_stop_process(process)
        _mark_l1_session_closed(
            session_root=session_root,
            process_ref=process_ref,
            process_records=process_records,
        )



__all__ = [
    "ISOLATED_DESKTOP_L3_WORKFLOW_PROBE_SCHEMA",
    "EXECUTION_BOUNDARY_NAME",
    "EXECUTION_BOUNDARY_SCHEMA",
    "MANIFEST_NAME",
    "REQUIRED_L3_RUNTIME_COMPONENTS",
    "build_isolated_desktop_l3_workflow_probe_manifest",
    "main",
]


if __name__ == "__main__":  # pragma: no cover - exercised by CLI tests.
    raise SystemExit(main())
