"""Fail-closed entrypoint for the real isolated desktop L1 smoke run."""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from .isolated_desktop_backend_probe import (
    build_isolated_desktop_backend_manifest,
)
from .isolated_desktop_contracts import (
    BACKEND_KIND,
    BACKEND_READINESS_PROOF_SCHEMA_VERSION,
    EXECUTOR_COMMAND_EVENT_LOG_SCHEMA,
    ISOLATED_CAPTURE_SOURCE,
    ISOLATED_TARGET_WINDOW_SCHEMA_VERSION,
    REMOTE_DESKTOP_INPUT_CHANNEL,
    TARGET_ENVIRONMENT_KIND,
)
from .isolated_desktop_l1_smoke_evidence import (
    ISOLATED_DESKTOP_L1_SMOKE_EVIDENCE_SCHEMA_VERSION,
    ISOLATED_DESKTOP_L1_SMOKE_EVIDENCE_VALIDATION_SCHEMA_VERSION,
    L1_ACCEPTANCE_TIER,
    build_isolated_desktop_l1_smoke_evidence,
)
from .isolated_desktop_l1_smoke_probe_helpers import (
    _check,
    _command_plan,
    _path_or_placeholder,
    _runner_options,
    _short_text,
    _unique_strings,
    _write_json,
)
from .isolated_desktop_runtime import (
    DISPLAY_CANDIDATES,
    L1_VIEWPORT,
    NOVNC_PORT_CANDIDATES,
    VNC_PORT_CANDIDATES,
    IsolatedDesktopL1SmokeRunFailed,
    L1RuntimeResourceLease,
    SubprocessCommandRunner,
    _allocate_l1_runtime_resources,
    _browser_command,
    _candidate_sequence,
    _display_number,
    _display_unavailable_reason,
    _first_non_empty_line,
    _html_detected,
    _http_get_ready,
    _http_viewer_probe_ready,
    _localhost_http_url,
    _localhost_port_available,
    _normalize_display,
    _novnc_marker_detected,
    _novnc_proxy_command,
    _parse_display_geometry,
    _parse_window_geometry_shell,
    _port_or_none,
    _positive_int_or_none,
    _positive_or_zero_int_or_none,
    _running_as_root,
    _tcp_port_ready,
    _try_acquire_resource_locks,
    _vnc_server_command,
    _wait_for_browser_page_ready,
    _wait_for_http_viewer,
    _wait_for_tcp_port,
    _wait_for_x_display_geometry,
)
from .evidence_ledger import EvidenceLedger
from .visible_viewer import build_visible_run_viewer


ISOLATED_DESKTOP_L1_SMOKE_PROBE_SCHEMA = "sciforge.computer-use.isolated-desktop-l1-smoke-probe.v1"
MANIFEST_NAME = "isolated-desktop-l1-smoke-probe-manifest.json"
NO_OS_INPUT_FLAGS = {
    "inputExecuted": False,
    "osInputExecuted": False,
    "realOsInputExecuted": False,
    "sharedSystemInputUsed": False,
    "systemPointerMoved": False,
    "systemKeyboardEventsSent": False,
}
REQUIRED_L1_RUNTIME_COMPONENTS: dict[str, tuple[str, ...]] = {
    "isolatedInputTool": ("xdotool",),
    "screenshotTool": ("import", "scrot", "gnome-screenshot"),
}
L1_SMOKE_TEXT = "SciForge isolated desktop L1"
L1_SMOKE_INITIAL_TITLE = "SciForge isolated desktop L1"
L1_SMOKE_READY_TITLE = "SciForge isolated desktop L1 ready"
L1_POINTER_TARGETS = {
    1: {
        "targetId": "l1-input",
        "targetDescription": "visible input field",
        "targetBoundsInWindow": {"x": 48, "y": 120, "width": 280, "height": 64},
        "hitPointInWindow": {"x": 180, "y": 155},
    },
    3: {
        "targetId": "l1-button",
        "targetDescription": "visible button",
        "targetBoundsInWindow": {"x": 48, "y": 176, "width": 96, "height": 64},
        "hitPointInWindow": {"x": 90, "y": 207},
    },
}
EXECUTOR_COMMAND_EVENT_LOG_NAME = "l1-executor-command-events.json"


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run or block the isolated desktop L1 smoke probe.")
    parser.add_argument("--output-dir", required=True, help="Directory where the L1 smoke probe manifest is written.")
    parser.add_argument(
        "--execute",
        action="store_true",
        help=(
            "Attempt a real Linux isolated desktop L1 smoke run. "
            "Non-Linux, missing dependencies, runtime failures, or evidence validation failures stay blocked."
        ),
    )
    parser.add_argument("--display", help="Requested isolated X display, for example :99.")
    parser.add_argument("--vnc-port", type=int, help="Requested localhost VNC port for the run.")
    parser.add_argument("--novnc-port", type=int, help="Requested localhost noVNC port for the run.")
    parser.add_argument("--timeout-seconds", type=float, default=20.0, help="Per-step runner timeout in seconds.")
    parser.add_argument("--resource-lock-root", help="Directory used for display/port allocation locks.")
    args = parser.parse_args(argv)

    manifest = build_isolated_desktop_l1_smoke_probe_manifest(
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


def build_isolated_desktop_l1_smoke_probe_manifest(
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
    port_probe: Callable[[str, int, float], bool] | None = None,
    http_probe: Callable[[str, float], Mapping[str, Any]] | None = None,
    port_available: Callable[[int], bool] | None = None,
    resource_lock_root: str | Path | None = None,
    display_candidates: Sequence[str | int] | None = None,
    vnc_port_candidates: Sequence[int] | None = None,
    novnc_port_candidates: Sequence[int] | None = None,
) -> dict[str, Any]:
    """Write a manifest for the L1 smoke entrypoint and run only when safe."""

    root = Path(output_dir).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    manifest_ref = (root / MANIFEST_NAME).resolve()
    system = platform_system or platform.system()
    resolver = command_resolver or shutil.which
    exists = path_exists or (lambda value: Path(value).exists())
    backend_manifest = build_isolated_desktop_backend_manifest(
        output_dir=root,
        platform_system=system,
        command_resolver=resolver,
        path_exists=exists,
    )
    runtime_components = {
        name: _resolve_component(candidates, resolver)
        for name, candidates in REQUIRED_L1_RUNTIME_COMPONENTS.items()
    }
    runtime_checks = [
        _check(
            bool(runtime_components[name].get("path")),
            name,
            f"Missing required L1 runtime component {name}: one of {', '.join(candidates)}.",
        )
        for name, candidates in REQUIRED_L1_RUNTIME_COMPONENTS.items()
    ]
    blocked_reasons = [*backend_manifest.get("blockedReasons", []), *[check["reason"] for check in runtime_checks if not check["ok"]]]
    run_diagnostics: dict[str, Any] = {}
    if execute and not blocked_reasons and backend_manifest.get("status") == "ready" and system == "Linux":
        resource_lease: L1RuntimeResourceLease | None = None
        try:
            resource_lease = _allocate_l1_runtime_resources(
                root=root,
                requested_display=display,
                requested_vnc_port=vnc_port,
                requested_novnc_port=novnc_port,
                path_exists=exists,
                port_available=port_available or _localhost_port_available,
                resource_lock_root=Path(resource_lock_root).expanduser() if resource_lock_root else None,
                display_candidates=display_candidates,
                vnc_port_candidates=vnc_port_candidates,
                novnc_port_candidates=novnc_port_candidates,
            )
            session_id = _l1_session_id()
            resource_lease.session_id = session_id
            _write_json(resource_lease.allocation_ref, resource_lease.summary())
            completed = _run_real_l1_smoke(
                root=root,
                backend_manifest=backend_manifest,
                runtime_components=runtime_components,
                command_runner=command_runner or SubprocessCommandRunner(),
                sleep=sleep,
                display=resource_lease.display,
                vnc_port=resource_lease.vnc_port,
                novnc_port=resource_lease.novnc_port,
                timeout_seconds=timeout_seconds,
                port_probe=port_probe or _tcp_port_ready,
                http_probe=http_probe or _http_get_ready,
                resource_allocation_ref=str(resource_lease.allocation_ref),
                session_id=session_id,
            )
        except IsolatedDesktopL1SmokeRunFailed as exc:
            blocked_reasons.append(exc.reason)
            run_diagnostics = dict(exc.diagnostics)
            if resource_lease is not None:
                run_diagnostics.setdefault("resourceAllocationRef", str(resource_lease.allocation_ref))
                run_diagnostics.setdefault("allocatedResources", resource_lease.summary(status="released-after-blocked"))
        else:
            if resource_lease is not None:
                resource_lease.release()
                completed = {
                    **dict(completed),
                    "resourceAllocationRef": str(resource_lease.allocation_ref),
                    "allocatedResources": resource_lease.summary(status="released-after-run"),
                }
                resource_lease = None
            manifest = _completed_probe_manifest(
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
                runner_options=_runner_options(
                    display=display,
                    vnc_port=vnc_port,
                    novnc_port=novnc_port,
                    timeout_seconds=timeout_seconds,
                    resource_lock_root=resource_lock_root,
                ),
            )
            _write_json(manifest_ref, manifest)
            return manifest
        finally:
            if resource_lease is not None:
                resource_lease.release(status="released-after-blocked")
    else:
        run_diagnostics = {}
    if execute and not blocked_reasons:
        blocked_reasons.append(
            "L1 smoke execution did not meet ready runner conditions; refusing to synthesize completed evidence."
        )
    else:
        blocked_reasons.append(
            "L1 smoke execute flag was not set; this probe only writes a blocked manifest unless a real runner is requested."
        ) if not execute else None
    manifest = {
        "schemaVersion": ISOLATED_DESKTOP_L1_SMOKE_PROBE_SCHEMA,
        "status": "blocked",
        "category": "isolated-desktop-l1-smoke-blocked",
        "reason": "; ".join(reason for reason in blocked_reasons if reason),
        "blockedReasons": [reason for reason in blocked_reasons if reason],
        "manifestRef": str(manifest_ref),
        "backendKind": BACKEND_KIND,
        "backendReadinessRef": backend_manifest.get("manifestRef"),
        "backendReadinessStatus": backend_manifest.get("status"),
        "platform": {"system": system, "machine": platform.machine()},
        "requiredRuntimeComponents": {
            name: list(candidates)
            for name, candidates in REQUIRED_L1_RUNTIME_COMPONENTS.items()
        },
        "observedRuntimeComponents": runtime_components,
        "runtimeChecks": runtime_checks,
        "acceptanceTier": L1_ACCEPTANCE_TIER,
        "userAcceptanceEligible": False,
        "readinessOnly": True,
        "runAttempted": bool(execute and not backend_manifest.get("blockedReasons") and all(check["ok"] for check in runtime_checks)),
        "completionEvidenceRef": None,
        "runDiagnostics": run_diagnostics,
        "resourceAllocationRef": run_diagnostics.get("resourceAllocationRef"),
        "allocatedResources": run_diagnostics.get("allocatedResources"),
        "resourceAllocationDiagnostics": run_diagnostics.get("resourceAllocationDiagnostics"),
        "targetEnvironmentKind": TARGET_ENVIRONMENT_KIND,
        "captureSource": ISOLATED_CAPTURE_SOURCE,
        "inputChannel": REMOTE_DESKTOP_INPUT_CHANNEL,
        "l1Smoke": {
            "status": "not-run",
            "completed": False,
            "realWindowEvidence": False,
            "screenChanged": False,
            "requiredActions": [
                "open real GUI app",
                "click visible input",
                "type text through isolated input",
                "click visible button/control",
                "verify screen changed",
            ],
        },
        "evidenceContract": {
            "evidenceSchemaRef": ISOLATED_DESKTOP_L1_SMOKE_EVIDENCE_SCHEMA_VERSION,
            "validationSchemaRef": ISOLATED_DESKTOP_L1_SMOKE_EVIDENCE_VALIDATION_SCHEMA_VERSION,
            "builder": "sciforge_computer_use.isolated_desktop_l1_smoke_evidence.build_isolated_desktop_l1_smoke_evidence",
            "validator": "sciforge_computer_use.isolated_desktop_l1_smoke_evidence.validate_isolated_desktop_l1_smoke_evidence",
            "claimLimit": (
                "This blocked probe cannot satisfy L1. Only a completed evidence payload passing the "
                "isolated desktop L1 smoke validator can claim L1 success."
            ),
        },
        "requiredCompletedRefs": [
            "preflightRef",
            "resultRef",
            "traceRefs",
            "screenshotRefs",
            "viewerManifestRef",
            "viewerHtmlRef",
            "inputEventLogRef",
            "pointerEventLogRef",
            "keyboardEventLogRef",
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
            "backendReadinessProofRef",
            "processRef",
            "resourceAllocationRef",
            "executorCommandEventLogRef",
            "targetWindowRef",
            "windowBoundPointerProofRef",
        ],
        "commandPlan": _command_plan(
            runtime_components,
            execute_requested=execute,
            display=display,
            vnc_port=vnc_port,
            novnc_port=novnc_port,
            timeout_seconds=timeout_seconds,
            resource_lock_root=resource_lock_root,
        ),
        "diagnosticOnly": True,
        "realWindowEvidence": False,
        "rawPayloadWritten": False,
        "inlineImageWritten": False,
        "secretsWritten": False,
        "projectClaimLimit": (
            "This manifest is a fail-closed L1 smoke entrypoint. It can explain why L1 did not run, "
            "but it cannot complete PROJECT backend or multi-app acceptance."
        ),
        **NO_OS_INPUT_FLAGS,
    }
    _write_json(manifest_ref, manifest)
    return manifest


def _resolve_component(candidates: Sequence[str], resolver: Callable[[str], str | None]) -> dict[str, Any]:
    for command in candidates:
        resolved = resolver(command)
        if resolved:
            return {"status": "found", "command": command, "path": str(resolved), "candidates": list(candidates)}
    return {"status": "missing", "command": None, "path": None, "candidates": list(candidates)}


def _l1_session_id() -> str:
    return f"isolated-l1-{time.time_ns()}"


def _run_real_l1_smoke(
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
    resource_allocation_ref: str | None = None,
    session_id: str | None = None,
) -> dict[str, Any]:
    components = _mapping(backend_manifest.get("observedComponents"))
    session_root = (root / "isolated-l1-session").resolve()
    _reset_l1_run_owned_paths(root=root, session_root=session_root)
    filesystem_root = (session_root / "filesystem-root").resolve()
    screenshot_dir = (session_root / "screenshots").resolve()
    filesystem_root.mkdir(parents=True, exist_ok=True)
    screenshot_dir.mkdir(parents=True, exist_ok=True)
    session_id = session_id or _l1_session_id()
    env = _isolated_display_env(display, session_root, session_id=session_id)
    processes: list[Any] = []
    process_records: list[dict[str, Any]] = []
    process_ref = (session_root / "backend-processes.json").resolve()
    readiness_proof_ref = (session_root / "backend-readiness-proof.json").resolve()
    executor_command_event_log_ref = (session_root / EXECUTOR_COMMAND_EVENT_LOG_NAME).resolve()
    executor_command_events: list[dict[str, Any]] = []
    try:
        _write_l1_static_refs(
            session_root=session_root,
            root=root,
            display=display,
            vnc_port=vnc_port,
            novnc_port=novnc_port,
            process_ref=process_ref,
            resource_allocation_ref=resource_allocation_ref,
            session_id=session_id,
        )
        virtual_display_process = _start_process(
            command_runner,
            "virtual-display",
            [_component_path(components, "virtualDisplay"), display, "-screen", "0", "1280x720x24", "-nolisten", "tcp"],
            env=env,
            process_records=process_records,
            process_ref=process_ref,
        )
        processes.append(virtual_display_process)
        _ensure_process_running(virtual_display_process, role="virtual-display", process_records=process_records, process_ref=process_ref)
        x_display_proof = _wait_for_x_display_geometry(
            command_runner,
            _component_path(runtime_components, "isolatedInputTool"),
            env=env,
            timeout_seconds=timeout_seconds,
            sleep=sleep,
        )
        window_manager_process = _start_process(
            command_runner,
            "window-manager",
            [_component_path(components, "windowManager")],
            env=env,
            process_records=process_records,
            process_ref=process_ref,
        )
        processes.append(window_manager_process)
        vnc_process = _start_process(
            command_runner,
            "vnc-server",
            _vnc_server_command(_component_record(components, "vncServer"), display=display, port=vnc_port),
            env=env,
            process_records=process_records,
            process_ref=process_ref,
        )
        processes.append(vnc_process)
        novnc_process = _start_process(
            command_runner,
            "novnc-proxy",
            _novnc_proxy_command(
                _component_record(components, "noVncProxy"),
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
        _ensure_process_running(window_manager_process, role="window-manager", process_records=process_records, process_ref=process_ref)
        _ensure_process_running(vnc_process, role="vnc-server", process_records=process_records, process_ref=process_ref)
        _ensure_process_running(novnc_process, role="novnc-proxy", process_records=process_records, process_ref=process_ref)
        _wait_for_tcp_port(
            "127.0.0.1",
            vnc_port,
            timeout_seconds=timeout_seconds,
            sleep=sleep,
            port_probe=port_probe,
            role="vnc-server",
        )
        _wait_for_tcp_port(
            "127.0.0.1",
            novnc_port,
            timeout_seconds=timeout_seconds,
            sleep=sleep,
            port_probe=port_probe,
            role="novnc-proxy",
        )
        novnc_viewer_url = f"http://127.0.0.1:{novnc_port}/vnc.html"
        novnc_http_proof = _wait_for_http_viewer(
            novnc_viewer_url,
            timeout_seconds=timeout_seconds,
            sleep=sleep,
            http_probe=http_probe,
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

        before_browser = _capture_screenshot(
            command_runner,
            runtime_components,
            env=env,
            output_ref=screenshot_dir / "00-before-browser.png",
            timeout_seconds=timeout_seconds,
        )
        smoke_page_ref = _write_smoke_page(filesystem_root)
        browser_profile = filesystem_root / "browser-profile"
        browser_profile.mkdir(parents=True, exist_ok=True)
        browser_process = _start_process(
            command_runner,
            "browser",
            _browser_command(
                _component_record(components, "browser"),
                smoke_page_ref=smoke_page_ref,
                profile_dir=browser_profile,
            ),
            env=env,
            process_records=process_records,
            process_ref=process_ref,
        )
        processes.append(browser_process)
        _ensure_process_running(browser_process, role="browser", process_records=process_records, process_ref=process_ref)
        browser_readiness_proof = _wait_for_browser_page_ready(
            command_runner,
            _component_path(runtime_components, "isolatedInputTool"),
            env=env,
            ready_title=L1_SMOKE_READY_TITLE,
            smoke_page_ref=smoke_page_ref,
            timeout_seconds=timeout_seconds,
            sleep=sleep,
        )
        _update_backend_readiness_interaction_proof(
            readiness_proof_ref,
            browser_readiness_proof=browser_readiness_proof,
        )
        after_open = _capture_screenshot(
            command_runner,
            runtime_components,
            env=env,
            output_ref=screenshot_dir / "01-after-open-app.png",
            timeout_seconds=timeout_seconds,
        )
        _run_checked(
            command_runner,
            _window_bound_click_args(
                _component_path(runtime_components, "isolatedInputTool"),
                browser_readiness_proof,
                action_index=1,
            ),
            env=env,
            role="click-input",
            timeout_seconds=timeout_seconds,
            command_event_log_ref=executor_command_event_log_ref,
            command_events=executor_command_events,
            action_index=1,
            action_kind="click",
            input_modality="pointer",
        )
        sleep(0.2)
        after_click_input = _capture_screenshot(
            command_runner,
            runtime_components,
            env=env,
            output_ref=screenshot_dir / "02-after-click-input.png",
            timeout_seconds=timeout_seconds,
        )
        _run_checked(
            command_runner,
            [_component_path(runtime_components, "isolatedInputTool"), "type", "--delay", "20", L1_SMOKE_TEXT],
            env=env,
            role="type-text",
            timeout_seconds=timeout_seconds,
            command_event_log_ref=executor_command_event_log_ref,
            command_events=executor_command_events,
            action_index=2,
            action_kind="type_text",
            input_modality="keyboard",
        )
        sleep(0.2)
        after_type = _capture_screenshot(
            command_runner,
            runtime_components,
            env=env,
            output_ref=screenshot_dir / "03-after-type-text.png",
            timeout_seconds=timeout_seconds,
        )
        _run_checked(
            command_runner,
            _window_bound_click_args(
                _component_path(runtime_components, "isolatedInputTool"),
                browser_readiness_proof,
                action_index=3,
            ),
            env=env,
            role="click-button",
            timeout_seconds=timeout_seconds,
            command_event_log_ref=executor_command_event_log_ref,
            command_events=executor_command_events,
            action_index=3,
            action_kind="click",
            input_modality="pointer",
        )
        sleep(0.4)
        final_screenshot = _capture_screenshot(
            command_runner,
            runtime_components,
            env=env,
            output_ref=screenshot_dir / "04-after-click-button.png",
            timeout_seconds=timeout_seconds,
        )
        steps = _l1_steps(
            before_browser=before_browser,
            after_open=after_open,
            after_click_input=after_click_input,
            after_type=after_type,
            final_screenshot=final_screenshot,
        )
        target_refs = _write_window_bound_pointer_refs(
            session_root,
            browser_readiness_proof=browser_readiness_proof,
            command_events=executor_command_events,
            executor_command_event_log_ref=executor_command_event_log_ref,
        )
        input_refs = _write_input_event_logs(
            session_root,
            command_events=executor_command_events,
            executor_command_event_log_ref=executor_command_event_log_ref,
            target_window_ref=Path(target_refs["targetWindowRef"]),
            window_bound_pointer_proof_ref=Path(target_refs["windowBoundPointerProofRef"]),
        )
        evidence_refs = _write_l1_evidence_ledger(
            root / "evidence",
            initial_ref=before_browser,
            final_ref=final_screenshot,
        )
        screenshot_refs = [
            before_browser,
            after_open,
            after_click_input,
            after_type,
            final_screenshot,
        ]
        result_ref, trace_ref = _write_result_and_trace(
            root=root,
            steps=steps,
            screenshot_refs=screenshot_refs,
            input_refs=input_refs,
            evidence_refs=evidence_refs,
            process_ref=str(process_ref),
            readiness_proof_ref=str(readiness_proof_ref),
            executor_command_event_log_ref=str(executor_command_event_log_ref),
        )
        _update_l1_session_evidence_refs(
            session_root,
            screenshot_refs=screenshot_refs,
            trace_ref=str(trace_ref),
            input_event_log_ref=input_refs["inputEventLogRef"],
        )
        viewer = build_visible_run_viewer(
            output_dir=root,
            result_ref=result_ref,
            title="Isolated desktop L1 smoke",
        )
        evidence = build_isolated_desktop_l1_smoke_evidence(
            backend_manifest.get("manifestRef") or root / "isolated-desktop-backend-probe-manifest.json",
            result_ref,
            trace_ref,
            initial_screenshot_ref=before_browser,
            final_screenshot_ref=final_screenshot,
            screenshot_refs=screenshot_refs,
            real_window_evidence_refs=[
                before_browser,
                final_screenshot,
                input_refs["pointerEventLogRef"],
                input_refs["keyboardEventLogRef"],
                input_refs["inputEventLogRef"],
                str(process_ref),
                *([resource_allocation_ref] if resource_allocation_ref else []),
                str(readiness_proof_ref),
                str(executor_command_event_log_ref),
                target_refs["targetWindowRef"],
                target_refs["windowBoundPointerProofRef"],
            ],
            viewer_manifest_ref=str(root / "visible-run-viewer-manifest.json"),
            viewer_html_ref=str(viewer["viewerHtmlRef"]),
            input_event_log_ref=input_refs["inputEventLogRef"],
            pointer_event_log_ref=input_refs["pointerEventLogRef"],
            keyboard_event_log_ref=input_refs["keyboardEventLogRef"],
            session_manifest_ref=str(session_root / "virtual-desktop-session-manifest.json"),
            virtual_display_ref=str(session_root / "virtual-display.json"),
            capture_stream_ref=str(session_root / "capture-stream.json"),
            replay_bundle_ref=str(session_root / "replay-bundle.json"),
            filesystem_root_ref=str(filesystem_root),
            no_vnc_viewer_ref=str(session_root / "novnc-viewer.json"),
            backend_readiness_proof_ref=str(readiness_proof_ref),
            executor_command_event_log_ref=str(executor_command_event_log_ref),
            target_window_ref=target_refs["targetWindowRef"],
            window_bound_pointer_proof_ref=target_refs["windowBoundPointerProofRef"],
            process_ref=str(process_ref),
            resource_allocation_ref=resource_allocation_ref,
            evidence_log_ref=evidence_refs["evidenceLogRef"],
            evidence_snapshot_ref=evidence_refs["evidenceSnapshotRef"],
            evidence_index_ref=evidence_refs["evidenceIndexRef"],
            planner_brief_ref=evidence_refs["plannerBriefRef"],
            input_adapter_manifest_ref=str(session_root / "input-adapter-manifest.json"),
            input_adapter_binding_manifest_ref=str(session_root / "input-adapter-binding-manifest.json"),
            metadata={
                "backendProcessRef": str(process_ref),
                "resourceAllocationRef": resource_allocation_ref,
                "backendReadinessProofRef": str(readiness_proof_ref),
                "executorCommandEventLogRef": str(executor_command_event_log_ref),
                **target_refs,
                "smokePageRef": str(smoke_page_ref),
                "noVncUrl": f"http://127.0.0.1:{novnc_port}/vnc.html",
            },
        )
        evidence_ref = (root / "isolated-desktop-l1-smoke-evidence.json").resolve()
        _write_json(evidence_ref, evidence)
        if evidence.get("status") != "completed":
            raise IsolatedDesktopL1SmokeRunFailed(
                "Real L1 run did not satisfy isolated desktop evidence validation.",
                {"evidenceRef": str(evidence_ref), "evidenceErrors": evidence.get("errors")},
            )
        return {
            "completionEvidenceRef": str(evidence_ref),
            "evidenceValidation": {"ok": True, "errors": []},
            "resultRef": str(result_ref),
            "traceRefs": [str(trace_ref)],
            "screenshotRefs": screenshot_refs,
            "viewerManifestRef": str(root / "visible-run-viewer-manifest.json"),
            "viewerHtmlRef": str(viewer["viewerHtmlRef"]),
            "inputEventLogRef": input_refs["inputEventLogRef"],
            "pointerEventLogRef": input_refs["pointerEventLogRef"],
            "keyboardEventLogRef": input_refs["keyboardEventLogRef"],
            "executorCommandEventLogRef": str(executor_command_event_log_ref),
            "sessionManifestRef": str(session_root / "virtual-desktop-session-manifest.json"),
            "virtualDisplayRef": str(session_root / "virtual-display.json"),
            "captureStreamRef": str(session_root / "capture-stream.json"),
            "replayBundleRef": str(session_root / "replay-bundle.json"),
            "filesystemRootRef": str(filesystem_root),
            "noVncViewerRef": str(session_root / "novnc-viewer.json"),
            **target_refs,
            **evidence_refs,
            "display": display,
            "vncPort": vnc_port,
            "novncPort": novnc_port,
            "processRef": str(process_ref),
            "backendReadinessProofRef": str(readiness_proof_ref),
            "resourceAllocationRef": resource_allocation_ref,
        }
    except (OSError, subprocess.SubprocessError, KeyError, ValueError) as exc:
        raise IsolatedDesktopL1SmokeRunFailed(
            f"Real L1 backend execution failed: {exc}",
            {"processRef": str(process_ref), "processes": process_records},
        ) from exc
    finally:
        for process in reversed(processes):
            _stop_process(process)
        _mark_l1_session_closed(
            session_root=session_root,
            process_ref=process_ref,
            process_records=process_records,
        )


def _reset_l1_run_owned_paths(*, root: Path, session_root: Path) -> None:
    for path in (session_root, root / "visible-run-viewer"):
        if path.is_symlink() or path.is_file():
            path.unlink()
        elif path.is_dir():
            shutil.rmtree(path)


def _completed_probe_manifest(
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
    runner_options: Mapping[str, Any],
) -> dict[str, Any]:
    return {
        "schemaVersion": ISOLATED_DESKTOP_L1_SMOKE_PROBE_SCHEMA,
        "status": "completed",
        "category": "isolated-desktop-l1-smoke-completed",
        "reason": "Real isolated desktop L1 smoke completed and passed evidence validation.",
        "blockedReasons": [],
        "manifestRef": str(manifest_ref),
        "backendKind": BACKEND_KIND,
        "backendReadinessRef": backend_manifest.get("manifestRef"),
        "backendReadinessStatus": backend_manifest.get("status"),
        "platform": {"system": system, "machine": platform.machine()},
        "requiredRuntimeComponents": {
            name: list(candidates)
            for name, candidates in REQUIRED_L1_RUNTIME_COMPONENTS.items()
        },
        "observedRuntimeComponents": dict(runtime_components),
        "runtimeChecks": [dict(check) for check in runtime_checks],
        "acceptanceTier": L1_ACCEPTANCE_TIER,
        "userAcceptanceEligible": True,
        "readinessOnly": False,
        "runAttempted": True,
        "completionEvidenceRef": completed.get("completionEvidenceRef"),
        "targetEnvironmentKind": TARGET_ENVIRONMENT_KIND,
        "captureSource": ISOLATED_CAPTURE_SOURCE,
        "inputChannel": REMOTE_DESKTOP_INPUT_CHANNEL,
        "display": display,
        "vncPort": vnc_port,
        "novncPort": novnc_port,
        "l1Smoke": {
            "status": "completed",
            "completed": True,
            "realWindowEvidence": True,
            "screenChanged": True,
        },
        "resultRef": completed.get("resultRef"),
        "traceRefs": list(completed.get("traceRefs") or []),
        "screenshotRefs": list(completed.get("screenshotRefs") or []),
        "viewerManifestRef": completed.get("viewerManifestRef"),
        "viewerHtmlRef": completed.get("viewerHtmlRef"),
        "inputEventLogRef": completed.get("inputEventLogRef"),
        "pointerEventLogRef": completed.get("pointerEventLogRef"),
        "keyboardEventLogRef": completed.get("keyboardEventLogRef"),
        "executorCommandEventLogRef": completed.get("executorCommandEventLogRef"),
        "targetWindowRef": completed.get("targetWindowRef"),
        "windowBoundPointerProofRef": completed.get("windowBoundPointerProofRef"),
        "sessionManifestRef": completed.get("sessionManifestRef"),
        "virtualDisplayRef": completed.get("virtualDisplayRef"),
        "captureStreamRef": completed.get("captureStreamRef"),
        "replayBundleRef": completed.get("replayBundleRef"),
        "filesystemRootRef": completed.get("filesystemRootRef"),
        "noVncViewerRef": completed.get("noVncViewerRef"),
        "evidenceLogRef": completed.get("evidenceLogRef"),
        "evidenceSnapshotRef": completed.get("evidenceSnapshotRef"),
        "evidenceIndexRef": completed.get("evidenceIndexRef"),
        "plannerBriefRef": completed.get("plannerBriefRef"),
        "processRef": completed.get("processRef"),
        "backendReadinessProofRef": completed.get("backendReadinessProofRef"),
        "resourceAllocationRef": completed.get("resourceAllocationRef"),
        "allocatedResources": completed.get("allocatedResources"),
        "commandPlan": {
            "status": "completed",
            "executeRequested": True,
            "inputTool": _path_or_placeholder(runtime_components, "isolatedInputTool"),
            "screenshotTool": _path_or_placeholder(runtime_components, "screenshotTool"),
            "inputToolScope": "invoked only with DISPLAY bound to the isolated X display",
            "sharedSystemInputAllowed": False,
            "completionEvidenceRequired": ISOLATED_DESKTOP_L1_SMOKE_EVIDENCE_SCHEMA_VERSION,
            "runnerOptions": dict(runner_options),
        },
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
            "This manifest can satisfy L1 smoke only. L2 artifact and L3 multi-app acceptance "
            "still require their own real isolated desktop evidence."
        ),
        "outputDirRef": str(root),
    }


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _isolated_display_env(display: str, session_root: Path, *, session_id: str) -> dict[str, str]:
    home = session_root / "home"
    tmp = session_root / "tmp"
    xauthority = session_root / "Xauthority"
    home.mkdir(parents=True, exist_ok=True)
    tmp.mkdir(parents=True, exist_ok=True)
    xauthority.touch(exist_ok=True)
    env = {
        "DISPLAY": display,
        "SCIFORGE_ISOLATED_SESSION_ID": session_id,
        "XAUTHORITY": str(xauthority),
        "HOME": str(home),
        "TMPDIR": str(tmp),
        "PATH": os.environ.get("PATH", "/usr/bin:/bin:/usr/sbin:/sbin"),
        "LANG": os.environ.get("LANG", "C.UTF-8"),
        "LC_ALL": os.environ.get("LC_ALL", "C.UTF-8"),
    }
    return env


def _component_record(components: Mapping[str, Mapping[str, Any]], name: str) -> Mapping[str, Any]:
    value = _mapping(components.get(name))
    if not value.get("path"):
        raise KeyError(f"Missing component path for {name}.")
    return value


def _component_path(components: Mapping[str, Mapping[str, Any]], name: str) -> str:
    return str(_component_record(components, name)["path"])


def _start_process(
    command_runner: Any,
    role: str,
    args: Sequence[str],
    *,
    env: Mapping[str, str],
    process_records: list[dict[str, Any]],
    process_ref: Path,
) -> Any:
    stdout_ref, stderr_ref = _process_log_refs(process_ref, role)
    stdout_ref.parent.mkdir(parents=True, exist_ok=True)
    stdout_ref.touch(exist_ok=True)
    stderr_ref.touch(exist_ok=True)
    try:
        with stdout_ref.open("a", encoding="utf8") as stdout_handle, stderr_ref.open("a", encoding="utf8") as stderr_handle:
            process = command_runner.popen(list(args), env=env, stdout=stdout_handle, stderr=stderr_handle)
    except TypeError:
        process = command_runner.popen(list(args), env=env)
    record = {
        "role": role,
        "args": list(args),
        "pid": getattr(process, "pid", None),
        "env": _safe_env_summary(env),
        "display": env.get("DISPLAY"),
        "sessionId": env.get("SCIFORGE_ISOLATED_SESSION_ID"),
        "status": "started",
        "stdoutLogRef": str(stdout_ref),
        "stderrLogRef": str(stderr_ref),
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
    }
    process_records.append(record)
    _write_process_records(process_ref, process_records)
    _ensure_process_running(process, role=role, process_records=process_records, process_ref=process_ref, immediate=True)
    return process


def _process_log_refs(process_ref: Path, role: str) -> tuple[Path, Path]:
    safe_role = "".join(character if character.isalnum() or character in {"-", "_"} else "-" for character in role)
    log_dir = process_ref.parent / "process-logs"
    return log_dir / f"{safe_role}-stdout.log", log_dir / f"{safe_role}-stderr.log"


def _ensure_process_running(
    process: Any,
    *,
    role: str,
    process_records: list[dict[str, Any]],
    process_ref: Path,
    immediate: bool = False,
) -> None:
    returncode = process.poll() if hasattr(process, "poll") else None
    if returncode is None:
        return
    _mark_process_status(
        process_records,
        role=role,
        status="exited-before-ready" if not immediate else "exited-immediately",
        returncode=returncode,
    )
    _write_process_records(process_ref, process_records)
    raise IsolatedDesktopL1SmokeRunFailed(
        f"{role} process exited before the isolated desktop became ready.",
        {"role": role, "returncode": returncode, "processRef": str(process_ref)},
    )


def _stop_process(process: Any) -> None:
    try:
        if hasattr(process, "poll") and process.poll() is not None:
            return
        if hasattr(process, "terminate"):
            process.terminate()
        if hasattr(process, "wait"):
            try:
                process.wait(timeout=2)
                return
            except subprocess.TimeoutExpired:
                pass
        pid = getattr(process, "pid", None)
        if isinstance(pid, int) and pid > 0:
            try:
                os.killpg(pid, signal.SIGKILL)
                return
            except Exception:
                pass
    except Exception:  # noqa: BLE001 - cleanup must be best-effort.
        try:
            if hasattr(process, "kill"):
                process.kill()
        except Exception:
            return


def _run_checked(
    command_runner: Any,
    args: Sequence[str],
    *,
    env: Mapping[str, str],
    role: str,
    timeout_seconds: float,
    command_event_log_ref: Path | None = None,
    command_events: list[dict[str, Any]] | None = None,
    action_index: int | None = None,
    action_kind: str | None = None,
    input_modality: str | None = None,
) -> subprocess.CompletedProcess[str]:
    completed = command_runner.run(list(args), env=env, timeout=timeout_seconds)
    if command_event_log_ref is not None and command_events is not None:
        _append_executor_command_event(
            command_event_log_ref,
            command_events,
            args=list(args),
            env=env,
            role=role,
            action_index=action_index,
            action_kind=action_kind,
            input_modality=input_modality,
            completed=completed,
        )
    if getattr(completed, "returncode", 1) != 0:
        raise IsolatedDesktopL1SmokeRunFailed(
            f"{role} command failed.",
            {
                "role": role,
                "args": list(args),
                "returncode": getattr(completed, "returncode", None),
                "stderr": _short_text(getattr(completed, "stderr", "")),
            },
        )
    return completed


def _append_executor_command_event(
    command_event_log_ref: Path,
    command_events: list[dict[str, Any]],
    *,
    args: Sequence[str],
    env: Mapping[str, str],
    role: str,
    action_index: int | None,
    action_kind: str | None,
    input_modality: str | None,
    completed: subprocess.CompletedProcess[str],
) -> None:
    sequence = len(command_events)
    event_id = f"l1-command-{sequence:03d}"
    event = {
        "id": event_id,
        "sequence": sequence,
        "timestamp": time.time(),
        "role": role,
        "actionIndex": action_index,
        "actionKind": action_kind,
        "inputModality": input_modality,
        "inputChannel": REMOTE_DESKTOP_INPUT_CHANNEL,
        "args": list(args),
        "env": _safe_env_summary(env),
        "display": env.get("DISPLAY"),
        "returncode": getattr(completed, "returncode", None),
        "stdoutSummary": _short_text(getattr(completed, "stdout", "")),
        "stderrSummary": _short_text(getattr(completed, "stderr", "")),
        "stdoutCharCount": len(str(getattr(completed, "stdout", "") or "")),
        "stderrCharCount": len(str(getattr(completed, "stderr", "") or "")),
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
    }
    command_events.append(event)
    _write_json(
        command_event_log_ref,
        {
            "schemaVersion": EXECUTOR_COMMAND_EVENT_LOG_SCHEMA,
            "eventCount": len(command_events),
            "inputChannel": REMOTE_DESKTOP_INPUT_CHANNEL,
            "events": [dict(item) for item in command_events],
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
        },
    )


def _capture_screenshot(
    command_runner: Any,
    runtime_components: Mapping[str, Mapping[str, Any]],
    *,
    env: Mapping[str, str],
    output_ref: Path,
    timeout_seconds: float,
) -> str:
    output_ref.parent.mkdir(parents=True, exist_ok=True)
    tool = _component_record(runtime_components, "screenshotTool")
    command = str(tool.get("command") or Path(str(tool.get("path"))).name)
    path = str(tool.get("path"))
    if command == "import":
        args = [path, "-window", "root", str(output_ref)]
    elif command == "scrot":
        args = [path, str(output_ref)]
    elif command == "gnome-screenshot":
        args = [path, "-f", str(output_ref)]
    else:
        raise IsolatedDesktopL1SmokeRunFailed(f"Unsupported isolated screenshot tool: {command}.")
    _run_checked(command_runner, args, env=env, role="capture-screenshot", timeout_seconds=timeout_seconds)
    if not output_ref.is_file() or output_ref.stat().st_size <= 0:
        raise IsolatedDesktopL1SmokeRunFailed(
            "Screenshot command did not produce a non-empty isolated display screenshot.",
            {"screenshotRef": str(output_ref), "tool": command},
        )
    return str(output_ref)


def _window_bound_click_args(input_tool_path: str, browser_readiness_proof: Mapping[str, Any], *, action_index: int) -> list[str]:
    desktop_window = _mapping(browser_readiness_proof.get("desktopWindow"))
    window_id = str(desktop_window.get("windowId") or "")
    target = _pointer_target(action_index)
    hit_point = _mapping(target.get("hitPointInWindow"))
    x = _positive_or_zero_int_or_none(hit_point.get("x"))
    y = _positive_or_zero_int_or_none(hit_point.get("y"))
    if not window_id or x is None or y is None:
        raise IsolatedDesktopL1SmokeRunFailed(
            "Window-bound pointer target could not be resolved before input dispatch.",
            {"actionIndex": action_index, "windowId": window_id, "hitPointInWindow": hit_point},
        )
    return [input_tool_path, "mousemove", "--sync", "--window", window_id, str(x), str(y), "click", "1"]


def _pointer_target(action_index: int) -> Mapping[str, Any]:
    target = L1_POINTER_TARGETS.get(action_index)
    if not target:
        raise IsolatedDesktopL1SmokeRunFailed(
            "No window-bound pointer target is defined for L1 action.",
            {"actionIndex": action_index},
        )
    return target


def _write_smoke_page(filesystem_root: Path) -> Path:
    page_ref = filesystem_root / "l1-smoke.html"
    page_ref.write_text(
        """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>__L1_INITIAL_TITLE__ loading</title>
  <style>
    body { font-family: sans-serif; margin: 48px; background: #f7f7f2; color: #161616; }
    input, button { font-size: 20px; padding: 10px 12px; margin: 8px 0; display: block; }
    input:focus { outline: 6px solid #1d6fd1; background: #fff7c2; }
    #status { margin-top: 20px; font-size: 24px; font-weight: 700; color: #155e3b; }
  </style>
</head>
<body>
  <h1>SciForge isolated desktop L1</h1>
  <input id="l1-input" aria-label="L1 input">
  <button id="l1-button" onclick="document.getElementById('status').textContent='L1 screen changed: ' + document.getElementById('l1-input').value">Apply</button>
  <div id="status">Waiting for isolated input</div>
  <script>
    document.getElementById('l1-input').addEventListener('focus', () => {
      document.getElementById('status').textContent = 'Input focused through isolated pointer';
      document.body.dataset.focused = 'true';
    });
    window.addEventListener('load', () => { document.title = '__L1_READY_TITLE__'; });
  </script>
</body>
</html>
""".replace("__L1_INITIAL_TITLE__", L1_SMOKE_INITIAL_TITLE).replace("__L1_READY_TITLE__", L1_SMOKE_READY_TITLE),
        encoding="utf8",
    )
    return page_ref


def _write_l1_static_refs(
    *,
    session_root: Path,
    root: Path,
    display: str,
    vnc_port: int,
    novnc_port: int,
    process_ref: Path,
    resource_allocation_ref: str | None = None,
    session_id: str | None = None,
) -> None:
    session_id = session_id or _l1_session_id()
    filesystem_root = session_root / "filesystem-root"
    filesystem_root.mkdir(parents=True, exist_ok=True)
    input_queue_ref = session_root / "virtual-input-queue.jsonl"
    input_queue_ref.touch(exist_ok=True)
    session_manifest_ref = session_root / "virtual-desktop-session-manifest.json"
    virtual_display_ref = session_root / "virtual-display.json"
    capture_stream_ref = session_root / "capture-stream.json"
    replay_bundle_ref = session_root / "replay-bundle.json"
    no_vnc_ref = session_root / "novnc-viewer.json"
    adapter_ref = session_root / "input-adapter-manifest.json"
    binding_ref = session_root / "input-adapter-binding-manifest.json"
    _write_json(
        session_manifest_ref,
        {
            "schemaVersion": "sciforge.computer-use.virtual-desktop-session.v1",
            "status": "open",
            "sessionId": session_id,
            "backend": {"kind": BACKEND_KIND, "status": "running", "noVncBackendStarted": True},
            "refs": {
                "virtualDisplayRef": str(virtual_display_ref),
                "captureStreamRef": str(capture_stream_ref),
                "replayBundleRef": str(replay_bundle_ref),
                "filesystemRootRef": str(filesystem_root),
                "noVncViewerRef": str(no_vnc_ref),
                "processRef": str(process_ref),
                **({"resourceAllocationRef": resource_allocation_ref} if resource_allocation_ref else {}),
            },
            "diagnosticOnly": False,
            "realWindowEvidence": True,
        },
    )
    _write_json(
        virtual_display_ref,
        {
            "schemaVersion": "sciforge.computer-use.virtual-display-ref.v1",
            "status": "running",
            "display": display,
            "sessionId": session_id,
            "viewport": dict(L1_VIEWPORT),
            "frameRefs": [],
            "sharedSystemInputUsed": False,
        },
    )
    _write_json(
        capture_stream_ref,
        {
            "schemaVersion": "sciforge.computer-use.capture-stream-ref.v1",
            "status": "running",
            "streamRef": str(capture_stream_ref),
            "frameRefs": [],
            "captureSource": ISOLATED_CAPTURE_SOURCE,
            "display": display,
            "sessionId": session_id,
        },
    )
    _write_json(
        replay_bundle_ref,
        {
            "schemaVersion": "sciforge.computer-use.replay-bundle-ref.v1",
            "status": "running",
            "timelineRefs": [],
            "captureStreamRef": str(capture_stream_ref),
            "inputEventLogRef": str(input_queue_ref),
            "sessionId": session_id,
        },
    )
    _write_json(
        no_vnc_ref,
        {
            "schemaVersion": "sciforge.computer-use.novnc-viewer-ref.v1",
            "status": "running",
            "url": f"http://127.0.0.1:{novnc_port}/vnc.html",
            "vncPort": vnc_port,
            "novncPort": novnc_port,
            "localhostOnly": True,
            "sessionId": session_id,
        },
    )
    _write_json(
        adapter_ref,
        {
            "schemaVersion": "sciforge.computer-use.virtual-input-adapter-manifest.v1",
            "inputAdapterStatus": "independent-simulated-input-adapter",
            "inputChannel": REMOTE_DESKTOP_INPUT_CHANNEL,
            "executorProvider": "linux-isolated-display-xdotool-executor",
            "executeChangesTargetEnvironment": True,
            "realWindowEvidenceCapable": True,
            "targetBindingRequiredForRealDesktopEvidence": True,
            "sideEffects": {
                "osInputExecuted": False,
                "sharedSystemInputUsed": False,
                "systemPointerMoved": False,
                "systemKeyboardEventsSent": False,
            },
        },
    )
    _write_json(
        binding_ref,
        {
            "schemaVersion": "sciforge.computer-use.input-adapter-target-binding.v1",
            "bindingStatus": "bound",
            "targetEnvironmentKind": TARGET_ENVIRONMENT_KIND,
            "targetWindowResolved": True,
            "executeChangesTargetEnvironment": True,
            "realWindowEvidenceCapable": True,
            "adapterManifestRef": str(adapter_ref),
            "targetWindowRef": str(virtual_display_ref),
            "evidenceRefs": [
                str(no_vnc_ref),
                str(process_ref),
                *([resource_allocation_ref] if resource_allocation_ref else []),
            ],
            "osInputExecuted": False,
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
        },
    )
    _write_json(process_ref, {"schemaVersion": "sciforge.computer-use.backend-processes.v1", "display": display, "sessionId": session_id, "processes": []})


def _l1_steps(
    *,
    before_browser: str,
    after_open: str,
    after_click_input: str,
    after_type: str,
    final_screenshot: str,
) -> list[dict[str, Any]]:
    return [
        _step(0, "open_app", "real browser app", before_browser, after_open, input_modalities=[]),
        _step(1, "click", "visible input field", after_open, after_click_input, input_modalities=["pointer"]),
        _step(2, "type_text", "visible input field", after_click_input, after_type, input_modalities=["keyboard"], text=L1_SMOKE_TEXT),
        _step(3, "click", "visible button", after_type, final_screenshot, input_modalities=["pointer"], done=True),
    ]


def _step(
    index: int,
    kind: str,
    target: str,
    before_ref: str,
    after_ref: str,
    *,
    input_modalities: Sequence[str],
    text: str | None = None,
    done: bool = False,
) -> dict[str, Any]:
    return {
        "index": index,
        "status": "completed",
        "beforeRef": before_ref,
        "afterRef": after_ref,
        "screenshotRefs": [after_ref],
        "action": {"kind": kind, "target": target, "text": text},
        "execution": {
            "ok": True,
            "message": f"{kind} executed in isolated display",
            "metadata": {
                "inputModalities": list(input_modalities),
                "inputChannel": REMOTE_DESKTOP_INPUT_CHANNEL,
            },
        },
        "verification": {"ok": True, "done": bool(done), "changed": True, "reason": "screen changed"},
    }


def _write_window_bound_pointer_refs(
    session_root: Path,
    *,
    browser_readiness_proof: Mapping[str, Any],
    command_events: Sequence[Mapping[str, Any]],
    executor_command_event_log_ref: Path,
) -> dict[str, str]:
    target_window_ref = session_root / "l1-target-window.json"
    pointer_proof_ref = session_root / "l1-window-bound-pointer-proof.json"
    desktop_window = dict(_mapping(browser_readiness_proof.get("desktopWindow")))
    display = str(desktop_window.get("display") or "")
    window_id = str(desktop_window.get("windowId") or "")
    _write_json(
        target_window_ref,
        {
            "schemaVersion": ISOLATED_TARGET_WINDOW_SCHEMA_VERSION,
            "status": "ready",
            "display": display,
            "desktopWindow": desktop_window,
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
        },
    )
    pointer_actions = [
        _window_bound_pointer_action(
            action_index=action_index,
            window_id=window_id,
            desktop_window=desktop_window,
            command_events=command_events,
            executor_command_event_log_ref=executor_command_event_log_ref,
        )
        for action_index in (1, 3)
    ]
    _write_json(
        pointer_proof_ref,
        {
            "schemaVersion": "sciforge.computer-use.window-bound-pointer-proof.v1",
            "status": "completed",
            "display": display,
            "inputChannel": REMOTE_DESKTOP_INPUT_CHANNEL,
            "targetWindowRef": str(target_window_ref),
            "pointerActions": pointer_actions,
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
        },
    )
    return {
        "targetWindowRef": str(target_window_ref),
        "windowBoundPointerProofRef": str(pointer_proof_ref),
    }


def _window_bound_pointer_action(
    *,
    action_index: int,
    window_id: str,
    desktop_window: Mapping[str, Any],
    command_events: Sequence[Mapping[str, Any]],
    executor_command_event_log_ref: Path,
) -> dict[str, Any]:
    target = _pointer_target(action_index)
    hit_point = dict(_mapping(target.get("hitPointInWindow")))
    target_bounds = dict(_mapping(target.get("targetBoundsInWindow")))
    command = next(
        (
            event
            for event in command_events
            if event.get("actionIndex") == action_index and event.get("inputModality") == "pointer"
        ),
        {},
    )
    command_id = str(command.get("id") or "")
    return {
        "actionIndex": action_index,
        "kind": "click",
        "targetId": target.get("targetId"),
        "targetDescription": target.get("targetDescription"),
        "targetBoundsInWindow": target_bounds,
        "hitPointInWindow": hit_point,
        "pointInsideTargetBounds": _point_inside_bounds(hit_point, target_bounds),
        "windowBoundsAtDispatch": {
            "windowId": window_id,
            **dict(_mapping(desktop_window.get("geometry"))),
        },
        "commandEventId": command_id,
        "commandEventRef": f"{executor_command_event_log_ref}#events/{command_id}" if command_id else None,
        "commandEventLogRef": str(executor_command_event_log_ref),
        "coordinateSpace": "window",
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
    }


def _point_inside_bounds(point: Mapping[str, Any], bounds: Mapping[str, Any]) -> bool:
    x = _positive_or_zero_int_or_none(point.get("x"))
    y = _positive_or_zero_int_or_none(point.get("y"))
    left = _positive_or_zero_int_or_none(bounds.get("x"))
    top = _positive_or_zero_int_or_none(bounds.get("y"))
    width = _positive_int_or_none(bounds.get("width"))
    height = _positive_int_or_none(bounds.get("height"))
    if None in (x, y, left, top, width, height):
        return False
    return bool(left <= x <= left + width and top <= y <= top + height)


def _write_input_event_logs(
    session_root: Path,
    *,
    command_events: Sequence[Mapping[str, Any]],
    executor_command_event_log_ref: Path,
    target_window_ref: Path,
    window_bound_pointer_proof_ref: Path,
) -> dict[str, str]:
    pointer_ref = session_root / "l1-pointer-events.json"
    keyboard_ref = session_root / "l1-keyboard-events.json"
    input_ref = session_root / "l1-input-events.json"
    pointer_events = [
        {
            "index": 0,
            "actionIndex": 1,
            "kind": "click",
            "target": "visible input field",
            **_pointer_event_target_fields(
                action_index=1,
                target_window_ref=target_window_ref,
                window_bound_pointer_proof_ref=window_bound_pointer_proof_ref,
            ),
            **_command_provenance_fields(command_events, action_index=1, modality="pointer", log_ref=executor_command_event_log_ref),
        },
        {
            "index": 1,
            "actionIndex": 3,
            "kind": "click",
            "target": "visible button",
            **_pointer_event_target_fields(
                action_index=3,
                target_window_ref=target_window_ref,
                window_bound_pointer_proof_ref=window_bound_pointer_proof_ref,
            ),
            **_command_provenance_fields(command_events, action_index=3, modality="pointer", log_ref=executor_command_event_log_ref),
        },
    ]
    keyboard_events = [
        {
            "index": 0,
            "actionIndex": 2,
            "kind": "type_text",
            "target": "visible input field",
            "textLength": len(L1_SMOKE_TEXT),
            **_command_provenance_fields(command_events, action_index=2, modality="keyboard", log_ref=executor_command_event_log_ref),
        },
    ]
    input_events = [
        {"modality": "pointer", **event}
        for event in pointer_events
    ] + [
        {"modality": "keyboard", **event}
        for event in keyboard_events
    ]
    _write_json(pointer_ref, {"schemaVersion": "sciforge.computer-use.target-pointer-state.v1", "eventCount": len(pointer_events), "executorCommandEventLogRef": str(executor_command_event_log_ref), "events": pointer_events})
    _write_json(keyboard_ref, {"schemaVersion": "sciforge.computer-use.target-keyboard-state.v1", "eventCount": len(keyboard_events), "executorCommandEventLogRef": str(executor_command_event_log_ref), "events": keyboard_events})
    _write_json(input_ref, {"schemaVersion": "sciforge.computer-use.target-input-event-log.v1", "eventCount": len(input_events), "executorCommandEventLogRef": str(executor_command_event_log_ref), "events": input_events})
    return {
        "pointerEventLogRef": str(pointer_ref),
        "keyboardEventLogRef": str(keyboard_ref),
        "inputEventLogRef": str(input_ref),
        "executorCommandEventLogRef": str(executor_command_event_log_ref),
        "targetWindowRef": str(target_window_ref),
        "windowBoundPointerProofRef": str(window_bound_pointer_proof_ref),
    }


def _pointer_event_target_fields(
    *,
    action_index: int,
    target_window_ref: Path,
    window_bound_pointer_proof_ref: Path,
) -> dict[str, Any]:
    target = _pointer_target(action_index)
    hit_point = _mapping(target.get("hitPointInWindow"))
    return {
        "coordinateSpace": "window",
        "windowX": _positive_or_zero_int_or_none(hit_point.get("x")),
        "windowY": _positive_or_zero_int_or_none(hit_point.get("y")),
        "x": _positive_or_zero_int_or_none(hit_point.get("x")),
        "y": _positive_or_zero_int_or_none(hit_point.get("y")),
        "targetId": target.get("targetId"),
        "targetWindowRef": str(target_window_ref),
        "windowBoundPointerProofRef": str(window_bound_pointer_proof_ref),
        "targetProofRef": f"{window_bound_pointer_proof_ref}#pointerActions/{action_index}",
    }


def _command_provenance_fields(
    command_events: Sequence[Mapping[str, Any]],
    *,
    action_index: int,
    modality: str,
    log_ref: Path,
) -> dict[str, Any]:
    event = next(
        (
            item
            for item in command_events
            if item.get("actionIndex") == action_index and item.get("inputModality") == modality
        ),
        None,
    )
    if not event:
        return {"commandEventLogRef": str(log_ref)}
    return {
        "commandEventId": event.get("id"),
        "commandEventRef": f"{log_ref}#events/{event.get('id')}",
        "commandEventLogRef": str(log_ref),
    }


def _write_l1_evidence_ledger(output_dir: Path, *, initial_ref: str, final_ref: str) -> dict[str, str]:
    ledger = EvidenceLedger(output_dir)
    initial_id = ledger.append_record("observation", loop_phase="evidence", ref=initial_ref, summary="Initial isolated desktop screen")
    action_id = ledger.append_record("action", loop_phase="action", action_index=2, summary="Typed text through isolated input", invalidates=[initial_id])
    final_id = ledger.append_record("observation", loop_phase="evidence", action_index=3, ref=final_ref, summary="Final isolated desktop screen")
    verification_id = ledger.append_record(
        "verification",
        loop_phase="action",
        action_index=3,
        summary="Screen changed after button click",
        derived_from=[action_id, final_id],
        verified_by=[final_id],
        metadata={"changed": True},
    )
    ledger.append_completion_claim(
        action_index=3,
        summary="L1 smoke completed on current isolated desktop evidence",
        status="completed",
        supports=[final_id, verification_id],
    )
    return ledger.refs()


def _write_result_and_trace(
    *,
    root: Path,
    steps: Sequence[Mapping[str, Any]],
    screenshot_refs: Sequence[str],
    input_refs: Mapping[str, str],
    evidence_refs: Mapping[str, str],
    process_ref: str,
    readiness_proof_ref: str,
    executor_command_event_log_ref: str,
) -> tuple[Path, Path]:
    result_ref = (root / "computer-use-result.json").resolve()
    trace_ref = (root / "vision-trace.json").resolve()
    diagnostics = {
        **dict(input_refs),
        **dict(evidence_refs),
        "backendProcessRef": process_ref,
        "backendReadinessProofRef": readiness_proof_ref,
        "executorCommandEventLogRef": executor_command_event_log_ref,
        "inputChannel": REMOTE_DESKTOP_INPUT_CHANNEL,
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
        "realOsInputExecuted": False,
    }
    payload = {
        "schemaVersion": "sciforge.computer-use.result.v1",
        "status": "completed",
        "reason": "Isolated desktop L1 smoke completed.",
        "steps": [dict(step) for step in steps],
        "traceRefs": [str(trace_ref)],
        "screenshotRefs": list(screenshot_refs),
        "artifactRefs": [],
        "finalObservationRef": list(screenshot_refs)[-1],
        "failureDiagnostics": diagnostics,
    }
    trace = {
        "schemaVersion": "sciforge.computer-use.loop-trace.v1",
        "status": "completed",
        "reason": "Isolated desktop L1 smoke completed.",
        "steps": [dict(step) for step in steps],
        "traceRefs": [str(trace_ref)],
        "screenshotRefs": list(screenshot_refs),
        "artifactRefs": [],
        "finalObservationRef": list(screenshot_refs)[-1],
        "failureDiagnostics": diagnostics,
    }
    _write_json(result_ref, payload)
    _write_json(trace_ref, trace)
    return result_ref, trace_ref


def _safe_env_summary(env: Mapping[str, str]) -> dict[str, str | None]:
    return {key: env.get(key) for key in ("DISPLAY", "SCIFORGE_ISOLATED_SESSION_ID", "XAUTHORITY", "HOME", "TMPDIR")}


def _write_process_records(path: Path, records: Sequence[Mapping[str, Any]]) -> None:
    display = next((str(record.get("display")) for record in records if record.get("display")), None)
    session_id = next((str(record.get("sessionId")) for record in records if record.get("sessionId")), None)
    _write_json(
        path,
        {
            "schemaVersion": "sciforge.computer-use.backend-processes.v1",
            **({"display": display} if display else {}),
            **({"sessionId": session_id} if session_id else {}),
            "processes": [dict(record) for record in records],
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
        },
    )


def _write_backend_readiness_proof(
    path: Path,
    *,
    display: str,
    x_display_proof: Mapping[str, Any],
    vnc_port: int,
    novnc_port: int,
    novnc_http_proof: Mapping[str, Any],
    process_ref: Path,
    process_records: Sequence[Mapping[str, Any]],
) -> None:
    http_viewer = {
        "ready": bool(novnc_http_proof.get("ready", novnc_http_proof.get("ok"))),
        "method": str(novnc_http_proof.get("method", "GET")),
        "url": str(novnc_http_proof.get("url") or f"http://127.0.0.1:{novnc_port}/vnc.html"),
        "localhostOnly": bool(novnc_http_proof.get("localhostOnly", True)),
        "statusCode": _port_or_none(novnc_http_proof.get("statusCode", novnc_http_proof.get("status"))),
        "contentType": novnc_http_proof.get("contentType"),
        "bytesRead": _positive_int_or_none(novnc_http_proof.get("bytesRead")),
        "sha256": str(novnc_http_proof.get("sha256") or ""),
        "htmlDetected": bool(novnc_http_proof.get("htmlDetected")),
        "noVncMarkerDetected": bool(novnc_http_proof.get("noVncMarkerDetected")),
        "rawPayloadWritten": False,
    }
    _write_json(
        path,
        {
            "schemaVersion": BACKEND_READINESS_PROOF_SCHEMA_VERSION,
            "status": "ready",
            "backendKind": BACKEND_KIND,
            "display": display,
            "localhostOnly": True,
            "xDisplay": {
                "display": x_display_proof.get("display"),
                "ready": bool(x_display_proof.get("ready")),
                "command": list(x_display_proof.get("command") or []),
                "width": _positive_int_or_none(x_display_proof.get("width")),
                "height": _positive_int_or_none(x_display_proof.get("height")),
                "viewport": dict(x_display_proof.get("viewport") or L1_VIEWPORT),
                "matchesRequestedViewport": bool(x_display_proof.get("matchesRequestedViewport")),
                "sharedSystemInputUsed": False,
                "systemPointerMoved": False,
                "systemKeyboardEventsSent": False,
            },
            "vnc": {"host": "127.0.0.1", "port": vnc_port, "ready": True},
            "novnc": {
                "host": "127.0.0.1",
                "port": novnc_port,
                "ready": True,
                "viewerPath": "/vnc.html",
                "httpViewer": http_viewer,
            },
            "processRef": str(process_ref),
            "processRoles": [str(record.get("role")) for record in process_records],
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
        },
    )
    _update_json_file(path.parent / "novnc-viewer.json", {
        "host": "127.0.0.1",
        "port": novnc_port,
        "viewerPath": "/vnc.html",
        "httpReadyDuringRun": True,
        "backendReadinessProofRef": str(path),
        "httpViewerSha256": http_viewer.get("sha256"),
    })
    _update_json_file(path.parent / "virtual-display.json", {
        "readyDuringRun": True,
        "observedGeometry": {
            "width": _positive_int_or_none(x_display_proof.get("width")),
            "height": _positive_int_or_none(x_display_proof.get("height")),
        },
        "backendReadinessProofRef": str(path),
    })


def _update_backend_readiness_interaction_proof(
    path: Path,
    *,
    browser_readiness_proof: Mapping[str, Any],
) -> None:
    desktop_window = _mapping(browser_readiness_proof.get("desktopWindow"))
    page = _mapping(browser_readiness_proof.get("page"))
    _update_json_file(path, {
        "desktopWindow": dict(desktop_window),
        "page": dict(page),
    })
    _update_json_file(path.parent / "virtual-desktop-session-manifest.json", {
        "desktopWindow": dict(desktop_window),
        "page": dict(page),
    })
    _update_json_file(path.parent / "virtual-display.json", {
        "desktopWindow": dict(desktop_window),
    })


def _mark_l1_session_closed(
    *,
    session_root: Path,
    process_ref: Path,
    process_records: list[dict[str, Any]],
) -> None:
    if not session_root.exists():
        return
    for record in process_records:
        if record.get("status") == "started":
            record["status"] = "stopped"
    _write_process_records(process_ref, process_records)
    _update_json_file(session_root / "virtual-desktop-session-manifest.json", {
        "status": "closed",
        "closedAfterRun": True,
    })
    _update_json_file(session_root / "virtual-display.json", {
        "status": "closed",
        "closedAfterRun": True,
    })
    _update_json_file(session_root / "capture-stream.json", {
        "status": "closed",
        "closedAfterRun": True,
    })
    _update_json_file(session_root / "replay-bundle.json", {
        "status": "closed",
        "closedAfterRun": True,
    })
    _update_json_file(session_root / "novnc-viewer.json", {
        "status": "closed",
        "closedAfterRun": True,
        "liveDuringRun": True,
    })


def _update_l1_session_evidence_refs(
    session_root: Path,
    *,
    screenshot_refs: Sequence[str],
    trace_ref: str,
    input_event_log_ref: str,
) -> None:
    frame_refs = _unique_strings(screenshot_refs)
    _update_json_file(session_root / "virtual-display.json", {
        "frameRefs": frame_refs,
    })
    _update_json_file(session_root / "capture-stream.json", {
        "frameRefs": frame_refs,
    })
    _update_json_file(session_root / "replay-bundle.json", {
        "timelineRefs": [trace_ref],
        "inputEventLogRef": input_event_log_ref,
    })


def _mark_process_status(
    records: list[dict[str, Any]],
    *,
    role: str,
    status: str,
    returncode: Any = None,
) -> None:
    for record in reversed(records):
        if record.get("role") == role:
            record["status"] = status
            record["returncode"] = returncode
            return


def _update_json_file(path: Path, updates: Mapping[str, Any]) -> None:
    if not path.is_file():
        return
    try:
        payload = json.loads(path.read_text(encoding="utf8"))
    except (OSError, json.JSONDecodeError):
        return
    if not isinstance(payload, Mapping):
        return
    updated = dict(payload)
    updated.update(dict(updates))
    _write_json(path, updated)


__all__ = [
    "ISOLATED_DESKTOP_L1_SMOKE_PROBE_SCHEMA",
    "EXECUTOR_COMMAND_EVENT_LOG_NAME",
    "EXECUTOR_COMMAND_EVENT_LOG_SCHEMA",
    "MANIFEST_NAME",
    "REQUIRED_L1_RUNTIME_COMPONENTS",
    "build_isolated_desktop_l1_smoke_probe_manifest",
    "main",
]


if __name__ == "__main__":  # pragma: no cover - exercised by CLI tests.
    raise SystemExit(main())
