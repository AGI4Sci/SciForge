"""Shared constants and helper functions for the isolated desktop L3 workflow probe."""

from __future__ import annotations

import hashlib
import json
import platform
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from .evidence_ledger import EvidenceLedger
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
from .isolated_desktop_l1_smoke_probe import (
    _capture_screenshot as _l1_capture_screenshot,
    _process_log_refs as _l1_process_log_refs,
    _write_process_records as _l1_write_process_records,
)
from .isolated_desktop_l3_workflow_evidence import (
    ISOLATED_DESKTOP_L3_WORKFLOW_EVIDENCE_SCHEMA_VERSION,
    L3_ACCEPTANCE_TIER,
    L3_WORKFLOW_KIND,
    REQUIRED_TOP_LEVEL_REFS,
)
from .isolated_desktop_runtime import IsolatedDesktopRunFailed, _parse_window_geometry_shell


ISOLATED_DESKTOP_L3_WORKFLOW_PROBE_SCHEMA = (
    "sciforge.computer-use.isolated-desktop-l3-workflow-probe.v1"
)
MANIFEST_NAME = "isolated-desktop-l3-workflow-probe-manifest.json"
EXECUTION_BOUNDARY_NAME = "isolated-desktop-l3-runner-execution-boundary.json"
EXECUTION_BOUNDARY_SCHEMA = "sciforge.computer-use.isolated-desktop-l3-runner-execution-boundary.v1"
NO_OS_INPUT_FLAGS = {
    "inputExecuted": False,
    "executeFailClosed": True,
    "osInputExecuted": False,
    "realOsInputExecuted": False,
    "sharedSystemInputUsed": False,
    "systemPointerMoved": False,
    "systemKeyboardEventsSent": False,
}

REQUIRED_L3_RUNTIME_COMPONENTS: dict[str, tuple[str, ...]] = {
    "isolatedInputTool": ("xdotool",),
    "screenshotTool": ("import", "scrot", "gnome-screenshot"),
    "filePreviewTool": ("xdg-open", "gio", "nautilus", "dolphin", "thunar", "pcmanfm", "nemo"),
}
L3_SOURCE_READY_TITLE = "SciForge isolated desktop L3 source ready"
PARTIAL_RUN_REF_NAME = "isolated-desktop-l3-partial-run.json"
L3_SOURCE_FACTS = (
    "Improved.",
    "Use two validation cohorts.",
)
L3_TYPED_DOCUMENT_PREFIX = "Start"
L3_FINAL_ARTIFACT_NAME = "source-summary.docx"
L3_EXECUTOR_COMMAND_EVENT_LOG_NAME = "l3-executor-command-events.json"


def _reset_l3_run_owned_paths(*, root: Path, session_root: Path) -> None:
    for path in (session_root, root / "visible-run-viewer"):
        if path.is_symlink() or path.is_file():
            path.unlink()
        elif path.is_dir():
            shutil.rmtree(path)


def _capture_l3_screenshot(
    command_runner: Any,
    runtime_components: Mapping[str, Mapping[str, Any]],
    *,
    env: Mapping[str, str],
    screenshot_dir: Path,
    name: str,
    timeout_seconds: float,
) -> str:
    return _l1_capture_screenshot(
        command_runner,
        runtime_components,
        env=env,
        output_ref=screenshot_dir / name,
        timeout_seconds=timeout_seconds,
    )


def _wait_for_any_visible_window(
    command_runner: Any,
    input_tool_path: str,
    *,
    env: Mapping[str, str],
    names: Sequence[str],
    timeout_seconds: float,
    sleep: Callable[[float], None],
) -> dict[str, Any]:
    deadline = time.monotonic() + max(timeout_seconds, 0.1)
    last_error = ""
    while time.monotonic() <= deadline:
        for name in names:
            search_args = [input_tool_path, "search", "--onlyvisible", "--name", str(name)]
            search = command_runner.run(search_args, env=env, timeout=0.5)
            if getattr(search, "returncode", 1) != 0:
                last_error = _short_text(getattr(search, "stderr", "")) or f"search returncode={getattr(search, 'returncode', None)}"
                continue
            window_id = _first_non_empty_line(getattr(search, "stdout", ""))
            if not window_id:
                last_error = "visible window search returned no window id"
                continue
            geometry_args = [input_tool_path, "getwindowgeometry", "--shell", window_id]
            geometry_result = command_runner.run(geometry_args, env=env, timeout=0.5)
            if getattr(geometry_result, "returncode", 1) != 0:
                last_error = _short_text(getattr(geometry_result, "stderr", "")) or f"geometry returncode={getattr(geometry_result, 'returncode', None)}"
                continue
            geometry = _parse_window_geometry_shell(getattr(geometry_result, "stdout", ""))
            if not geometry:
                last_error = f"invalid window geometry output: {getattr(geometry_result, 'stdout', '')!r}"
                continue
            title = _window_title_or_name(command_runner, input_tool_path, env=env, window_id=window_id, fallback=str(name))
            return {
                "display": env.get("DISPLAY"),
                "ready": True,
                "visible": True,
                "windowId": window_id,
                "title": title,
                "geometry": geometry,
                "searchCommand": search_args,
                "geometryCommand": geometry_args,
                "coordinateSpace": "screen",
                "sharedSystemInputUsed": False,
                "systemPointerMoved": False,
                "systemKeyboardEventsSent": False,
            }
        sleep(0.1)
    raise IsolatedDesktopRunFailed(
        "Visible isolated desktop window was not found.",
        {"names": list(names), "lastError": last_error},
    )


def _window_title_or_name(
    command_runner: Any,
    input_tool_path: str,
    *,
    env: Mapping[str, str],
    window_id: str,
    fallback: str,
) -> str:
    completed = command_runner.run([input_tool_path, "getwindowname", window_id], env=env, timeout=0.5)
    if getattr(completed, "returncode", 1) == 0:
        title = _first_non_empty_line(getattr(completed, "stdout", ""))
        if title:
            return title
    return fallback


def _l3_window_bound_click(
    *,
    command_runner: Any,
    input_tool_path: str,
    env: Mapping[str, str],
    timeout_seconds: float,
    command_event_log_ref: Path,
    command_events: list[dict[str, Any]],
    pointer_actions: list[dict[str, Any]],
    pointer_events: list[dict[str, Any]],
    action_index: int,
    target_id: str,
    target_description: str,
    desktop_window: Mapping[str, Any],
    target_bounds: Mapping[str, int],
    hit_point: Mapping[str, int],
) -> None:
    window_id = str(desktop_window.get("windowId") or "")
    if not window_id:
        raise IsolatedDesktopRunFailed(
            "Window-bound L3 pointer target could not resolve a window id.",
            {"actionIndex": action_index, "targetId": target_id},
        )
    args = [
        input_tool_path,
        "mousemove",
        "--sync",
        "--window",
        window_id,
        str(hit_point["x"]),
        str(hit_point["y"]),
        "click",
        "1",
    ]
    _run_l3_checked(
        command_runner,
        args,
        env=env,
        role="click",
        timeout_seconds=timeout_seconds,
        command_event_log_ref=command_event_log_ref,
        command_events=command_events,
        action_index=action_index,
        action_kind="click",
        input_modality="pointer",
    )
    command_id = str(command_events[-1]["id"])
    action = {
        "actionIndex": action_index,
        "kind": "click",
        "targetId": target_id,
        "targetDescription": target_description,
        "targetBoundsInWindow": dict(target_bounds),
        "hitPointInWindow": dict(hit_point),
        "pointInsideTargetBounds": _point_inside_bounds(hit_point, target_bounds),
        "windowBoundsAtDispatch": {
            "windowId": window_id,
            **dict(_mapping(desktop_window.get("geometry"))),
        },
        "commandEventId": command_id,
        "commandEventLogRef": str(command_event_log_ref),
        "commandEventRef": f"{command_event_log_ref}#events/{command_id}",
        "coordinateSpace": "window",
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
    }
    pointer_actions.append(action)
    pointer_events.append({
        "index": len(pointer_events),
        "actionIndex": action_index,
        "kind": "click",
        "target": target_description,
        "coordinateSpace": "window",
        "windowX": hit_point["x"],
        "windowY": hit_point["y"],
        "x": hit_point["x"],
        "y": hit_point["y"],
        "targetId": target_id,
        "targetWindowRef": "",
        "windowBoundPointerProofRef": "",
        "targetProofRef": "",
        "commandEventId": command_id,
        "commandEventLogRef": str(command_event_log_ref),
        "commandEventRef": f"{command_event_log_ref}#events/{command_id}",
    })


def _l3_keyboard_command(
    *,
    command_runner: Any,
    args: Sequence[str],
    env: Mapping[str, str],
    timeout_seconds: float,
    command_event_log_ref: Path,
    command_events: list[dict[str, Any]],
    keyboard_events: list[dict[str, Any]],
    action_index: int,
    action_kind: str,
    target: str,
    text_length: int | None = None,
    keys: Sequence[str] | None = None,
) -> None:
    _run_l3_checked(
        command_runner,
        args,
        env=env,
        role=action_kind,
        timeout_seconds=timeout_seconds,
        command_event_log_ref=command_event_log_ref,
        command_events=command_events,
        action_index=action_index,
        action_kind=action_kind,
        input_modality="keyboard",
    )
    command_id = str(command_events[-1]["id"])
    event: dict[str, Any] = {
        "index": len(keyboard_events),
        "actionIndex": action_index,
        "kind": action_kind,
        "target": target,
        "commandEventId": command_id,
        "commandEventLogRef": str(command_event_log_ref),
        "commandEventRef": f"{command_event_log_ref}#events/{command_id}",
    }
    if text_length is not None:
        event["textLength"] = text_length
    if keys is not None:
        event["keys"] = list(keys)
    keyboard_events.append(event)


def _run_l3_checked(
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
        _append_l3_executor_command_event(
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
        raise IsolatedDesktopRunFailed(
            f"{role} command failed.",
            {
                "role": role,
                "args": list(args),
                "returncode": getattr(completed, "returncode", None),
                "stderr": _short_text(getattr(completed, "stderr", "")),
            },
        )
    return completed


def _append_l3_executor_command_event(
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
    event_id = f"l3-command-{sequence:03d}"
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
    _write_l3_executor_command_event_log(
        command_event_log_ref,
        display=str(env.get("DISPLAY") or ""),
        session_id=str(env.get("SCIFORGE_ISOLATED_SESSION_ID") or ""),
        command_events=command_events,
    )


def _write_l3_executor_command_event_log(
    path: Path,
    *,
    display: str,
    session_id: str,
    command_events: Sequence[Mapping[str, Any]],
) -> None:
    _write_json(
        path,
        {
            "schemaVersion": EXECUTOR_COMMAND_EVENT_LOG_SCHEMA,
            "status": "completed" if command_events else "running",
            "display": display,
            "sessionId": session_id,
            "eventCount": len(command_events),
            "inputChannel": REMOTE_DESKTOP_INPUT_CHANNEL,
            "events": [dict(item) for item in command_events],
            "workflowInputExecuted": bool(command_events),
            "diagnosticOnly": False,
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
        },
    )


def _write_l3_target_and_pointer_refs(
    *,
    target_window_ref: Path,
    pointer_proof_ref: Path,
    display: str,
    target_window: Mapping[str, Any],
    pointer_actions: Sequence[Mapping[str, Any]],
) -> None:
    _write_json(
        target_window_ref,
        {
            "schemaVersion": ISOLATED_TARGET_WINDOW_SCHEMA_VERSION,
            "status": "ready",
            "display": display,
            "desktopWindow": dict(target_window),
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
        },
    )
    _write_json(
        pointer_proof_ref,
        {
            "schemaVersion": "sciforge.computer-use.window-bound-pointer-proof.v1",
            "status": "completed",
            "display": display,
            "inputChannel": REMOTE_DESKTOP_INPUT_CHANNEL,
            "targetWindowRef": str(target_window_ref),
            "pointerActions": [dict(action) for action in pointer_actions],
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
        },
    )


def _write_l3_input_event_logs(
    *,
    pointer_event_log_ref: Path,
    keyboard_event_log_ref: Path,
    input_event_log_ref: Path,
    executor_command_event_log_ref: Path,
    pointer_events: Sequence[Mapping[str, Any]],
    keyboard_events: Sequence[Mapping[str, Any]],
) -> None:
    pointer_ref = str(pointer_event_log_ref)
    target_window_ref = str(pointer_event_log_ref.parent / "l3-target-window.json")
    pointer_proof_ref = str(pointer_event_log_ref.parent / "l3-window-bound-pointer-proof.json")
    hydrated_pointer_events = []
    for event in pointer_events:
        action_index = event.get("actionIndex")
        hydrated_pointer_events.append({
            **dict(event),
            "targetWindowRef": target_window_ref,
            "windowBoundPointerProofRef": pointer_proof_ref,
            "targetProofRef": f"{pointer_proof_ref}#pointerActions/{action_index}",
        })
    input_events = [
        {"modality": "pointer", **event}
        for event in hydrated_pointer_events
    ] + [
        {"modality": "keyboard", **dict(event)}
        for event in keyboard_events
    ]
    _write_json(
        pointer_event_log_ref,
        {
            "schemaVersion": "sciforge.computer-use.target-pointer-state.v1",
            "eventCount": len(hydrated_pointer_events),
            "executorCommandEventLogRef": str(executor_command_event_log_ref),
            "events": hydrated_pointer_events,
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
        },
    )
    _write_json(
        keyboard_event_log_ref,
        {
            "schemaVersion": "sciforge.computer-use.target-keyboard-state.v1",
            "eventCount": len(keyboard_events),
            "executorCommandEventLogRef": str(executor_command_event_log_ref),
            "events": [dict(event) for event in keyboard_events],
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
        },
    )
    _write_json(
        input_event_log_ref,
        {
            "schemaVersion": "sciforge.computer-use.target-input-event-log.v1",
            "eventCount": len(input_events),
            "executorCommandEventLogRef": str(executor_command_event_log_ref),
            "events": input_events,
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
        },
    )
    if not pointer_ref:
        raise IsolatedDesktopRunFailed("L3 pointer event log ref could not be written.", {})


def _wait_for_file(path: Path, *, timeout_seconds: float, sleep: Callable[[float], None]) -> None:
    deadline = time.monotonic() + max(timeout_seconds, 0.1)
    while time.monotonic() <= deadline:
        if path.is_file() and path.stat().st_size > 0:
            return
        sleep(0.1)
    raise IsolatedDesktopRunFailed(
        "GUI save did not produce the expected final artifact.",
        {"finalArtifactRef": str(path)},
    )


def _write_l3_file_list_refs(
    *,
    file_list_artifact_ref: Path,
    file_list_data_ref: Path,
    final_artifact_ref: Path,
) -> None:
    size_bytes = final_artifact_ref.stat().st_size if final_artifact_ref.is_file() else 0
    sha256 = hashlib.sha256(final_artifact_ref.read_bytes()).hexdigest() if final_artifact_ref.is_file() else ""
    entry = {
        "name": final_artifact_ref.name,
        "path": str(final_artifact_ref),
        "ref": str(final_artifact_ref),
        "type": "file",
        "sizeBytes": size_bytes,
        "sha256": sha256,
    }
    _write_json(
        file_list_artifact_ref,
        {
            "schemaVersion": "sciforge.computer-use.file-list-evidence.v1",
            "entries": [entry],
            "finalArtifactRef": str(final_artifact_ref),
            "observedThroughGui": True,
            "shellDirectoryListingOnly": False,
        },
    )
    _write_json(
        file_list_data_ref,
        {
            "schemaVersion": "sciforge.computer-use.file-list-data.v1",
            "files": [entry],
            "finalArtifactRef": str(final_artifact_ref),
        },
    )


def _write_l3_source_fact_refs(output_dir: Path) -> list[str]:
    output_dir.mkdir(parents=True, exist_ok=True)
    refs: list[str] = []
    for index, fact in enumerate(L3_SOURCE_FACTS, start=1):
        ref = output_dir / f"source-fact-{index}.json"
        _write_json(
            ref,
            {
                "schemaVersion": "sciforge.computer-use.source-fact.v1",
                "fact": fact,
                "source": "isolated desktop L3 source page",
            },
        )
        refs.append(str(ref))
    return refs


def _write_l3_gui_present_ref(
    *,
    gui_present_ref: Path,
    final_artifact_ref: Path,
    trace_ref: Path,
    screenshot_refs: Sequence[str],
) -> None:
    _write_json(
        gui_present_ref,
        {
            "schemaVersion": "sciforge.gui.present-payload.v1",
            "artifactRefs": [str(final_artifact_ref)],
            "finalArtifactRef": str(final_artifact_ref),
            "traceRefs": [str(trace_ref)],
            "screenshotRefs": list(screenshot_refs),
            "presentedThroughGui": True,
        },
    )


def _write_l3_evidence_ledger(
    output_dir: Path,
    *,
    source_ref: str,
    final_artifact_ref: str,
    directory_ref: str,
    file_list_refs: Sequence[str],
) -> dict[str, str]:
    ledger = EvidenceLedger(output_dir)
    source_id = ledger.append_record("observation", loop_phase="evidence", ref=source_ref, summary="Source facts visible in isolated browser.")
    artifact_id = ledger.append_record("artifact", loop_phase="evidence", action_index=8, ref=final_artifact_ref, summary="DOCX saved through isolated GUI.")
    directory_id = ledger.append_record("observation", loop_phase="evidence", action_index=9, ref=directory_ref, summary="Directory preview shows the saved artifact.")
    verification_id = ledger.append_record(
        "verification",
        loop_phase="action",
        action_index=9,
        refs=list(file_list_refs),
        summary="Artifact, source facts, and GUI directory preview were verified.",
        derived_from=[source_id, artifact_id, directory_id],
        verified_by=[directory_id],
    )
    ledger.append_completion_claim(
        action_index=9,
        summary="L3 source-to-document-to-preview workflow complete.",
        status="completed",
        supports=[source_id, artifact_id, directory_id, verification_id],
    )
    refs = ledger.refs()
    return {
        "evidenceLogRef": str(refs["evidenceLogRef"]),
        "evidenceSnapshotRef": str(refs["evidenceSnapshotRef"]),
        "evidenceIndexRef": str(refs["evidenceIndexRef"]),
        "plannerBriefRef": str(refs["plannerBriefRef"]),
    }


def _write_l3_completed_preflight_ref(
    path: Path,
    *,
    backend_manifest: Mapping[str, Any],
    platform_system: str,
) -> None:
    payload = dict(backend_manifest)
    payload.update({
        "schemaVersion": "sciforge.computer-use.isolated-desktop-backend-probe.v1",
        "status": "ready",
        "manifestRef": str(path),
        "backendKind": BACKEND_KIND,
        "platform": {
            "system": platform_system,
            "machine": platform.machine(),
        },
        "diagnosticOnly": False,
        "userAcceptanceEligible": True,
        "readinessOnly": False,
        "executeFailClosed": False,
        "inputExecuted": True,
        "realWindowEvidence": True,
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
    })
    _write_json(path, payload)


def _update_l3_completed_session_refs(
    *,
    session_root: Path,
    screenshot_refs: Sequence[str],
    trace_ref: str,
    input_event_log_ref: str,
) -> None:
    frame_refs = _unique_strings(screenshot_refs)
    _update_json_file(session_root / "virtual-display.json", {"frameRefs": frame_refs})
    _update_json_file(session_root / "capture-stream.json", {"frameRefs": frame_refs})
    _update_json_file(session_root / "replay-bundle.json", {
        "status": "completed",
        "timelineRefs": [trace_ref],
        "inputEventLogRef": input_event_log_ref,
    })


def _l3_screenshot_refs(screenshots: Mapping[str, str]) -> list[str]:
    ordered_keys = [
        "source_first",
        "source_last",
        "writer_first",
        "writer_focused",
        "writer_last",
        "save_dialog_open",
        "save_dialog_filename",
        "save_dialog_dropdown",
        "save_dialog_docx",
        "confirm_dialog",
        "writer_saved",
        "preview_first",
        "preview_last",
    ]
    return _unique_strings([str(screenshots[key]) for key in ordered_keys if screenshots.get(key)])


def _l3_completed_steps(screenshots: Mapping[str, str]) -> list[dict[str, Any]]:
    return [
        _l3_step(0, "click", "source reader source facts", screenshots["source_first"], screenshots["source_last"], input_modalities=["pointer"]),
        _l3_step(1, "click", "document body", screenshots["writer_first"], screenshots["writer_focused"], input_modalities=["pointer"]),
        _l3_step(2, "type_text", "document body", screenshots["writer_focused"], screenshots["writer_last"], input_modalities=["keyboard"], text="source facts"),
        _l3_step(3, "save", "document save dialog", screenshots["writer_last"], screenshots["save_dialog_open"], input_modalities=["keyboard"]),
        _l3_step(4, "type_text", "save dialog filename", screenshots["save_dialog_open"], screenshots["save_dialog_filename"], input_modalities=["keyboard"]),
        _l3_step(5, "click", "save dialog file type dropdown", screenshots["save_dialog_filename"], screenshots["save_dialog_dropdown"], input_modalities=["pointer"]),
        _l3_step(6, "press_key", "Word 2007-365 docx file type", screenshots["save_dialog_dropdown"], screenshots["save_dialog_docx"], input_modalities=["keyboard"]),
        _l3_step(7, "click", "save dialog Save button", screenshots["save_dialog_docx"], screenshots["confirm_dialog"], input_modalities=["pointer"]),
        _l3_step(8, "click", "Use Word 2007-365 Format button", screenshots["confirm_dialog"], screenshots["writer_saved"], input_modalities=["pointer"]),
        _l3_step(9, "click", "saved artifact entry in directory preview", screenshots["preview_first"], screenshots["preview_last"], input_modalities=["pointer"], done=True),
    ]


def _l3_step(
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
        "verification": {"ok": True, "done": bool(done), "changed": True, "reason": "current screenshot captured"},
    }


def _l3_result_diagnostics(
    *,
    input_event_log_ref: Path,
    pointer_event_log_ref: Path,
    keyboard_event_log_ref: Path,
    backend_readiness_proof_ref: Path,
    executor_command_event_log_ref: Path,
    process_ref: Path,
    resource_allocation_ref: str,
    target_window_ref: Path,
    window_bound_pointer_proof_ref: Path,
) -> dict[str, Any]:
    return {
        "inputEventLogRef": str(input_event_log_ref),
        "pointerEventLogRef": str(pointer_event_log_ref),
        "keyboardEventLogRef": str(keyboard_event_log_ref),
        "backendReadinessProofRef": str(backend_readiness_proof_ref),
        "executorCommandEventLogRef": str(executor_command_event_log_ref),
        "backendProcessRef": str(process_ref),
        "processRef": str(process_ref),
        "resourceAllocationRef": resource_allocation_ref,
        "targetWindowRef": str(target_window_ref),
        "windowBoundPointerProofRef": str(window_bound_pointer_proof_ref),
        "inputChannel": REMOTE_DESKTOP_INPUT_CHANNEL,
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
        "realOsInputExecuted": False,
    }


def _l3_result_payload(
    *,
    steps: Sequence[Mapping[str, Any]],
    screenshot_refs: Sequence[str],
    trace_ref: Path,
    final_artifact_ref: Path,
    final_observation_ref: str,
    diagnostics: Mapping[str, Any],
) -> dict[str, Any]:
    return {
        "schemaVersion": "sciforge.computer-use.result.v1",
        "status": "completed",
        "reason": "Isolated desktop L3 source-to-DOCX-to-preview workflow completed.",
        "steps": [dict(step) for step in steps],
        "traceRefs": [str(trace_ref)],
        "screenshotRefs": list(screenshot_refs),
        "artifactRefs": [str(final_artifact_ref)],
        "finalArtifactRef": str(final_artifact_ref),
        "finalObservationRef": final_observation_ref,
        "failureDiagnostics": dict(diagnostics),
    }


def _l3_completed_evidence_payload(
    *,
    preflight_ref: Path,
    result_ref: Path,
    trace_ref: Path,
    screenshot_refs: Sequence[str],
    viewer_manifest_ref: Path,
    viewer_html_ref: Path,
    input_event_log_ref: Path,
    pointer_event_log_ref: Path,
    keyboard_event_log_ref: Path,
    backend_readiness_proof_ref: Path,
    executor_command_event_log_ref: Path,
    target_window_ref: Path,
    window_bound_pointer_proof_ref: Path,
    process_ref: Path,
    resource_allocation_ref: Path,
    session_manifest_ref: Path,
    virtual_display_ref: Path,
    capture_stream_ref: Path,
    replay_bundle_ref: Path,
    filesystem_root_ref: Path,
    no_vnc_viewer_ref: Path,
    evidence_refs: Mapping[str, str],
    final_artifact_ref: Path,
    artifact_validation_ref: Path,
    file_list_artifact_ref: Path,
    file_list_data_ref: Path,
    source_fact_refs: Sequence[str],
    gui_present_ref: Path,
    screenshots: Mapping[str, str],
) -> dict[str, Any]:
    return {
        "schemaVersion": ISOLATED_DESKTOP_L3_WORKFLOW_EVIDENCE_SCHEMA_VERSION,
        "evidenceKind": "isolated-L3",
        "status": "completed",
        "acceptanceTier": L3_ACCEPTANCE_TIER,
        "userAcceptanceEligible": True,
        "backendKind": BACKEND_KIND,
        "targetEnvironmentKind": TARGET_ENVIRONMENT_KIND,
        "captureSource": ISOLATED_CAPTURE_SOURCE,
        "inputChannel": REMOTE_DESKTOP_INPUT_CHANNEL,
        "preflightRef": str(preflight_ref),
        "preflightStatus": "ready",
        "resultRef": str(result_ref),
        "traceRefs": [str(trace_ref)],
        "screenshotRefs": list(screenshot_refs),
        "viewerManifestRef": str(viewer_manifest_ref),
        "viewerHtmlRef": str(viewer_html_ref),
        "inputEventLogRef": str(input_event_log_ref),
        "pointerEventLogRef": str(pointer_event_log_ref),
        "keyboardEventLogRef": str(keyboard_event_log_ref),
        "backendReadinessProofRef": str(backend_readiness_proof_ref),
        "executorCommandEventLogRef": str(executor_command_event_log_ref),
        "targetWindowRef": str(target_window_ref),
        "windowBoundPointerProofRef": str(window_bound_pointer_proof_ref),
        "processRef": str(process_ref),
        "resourceAllocationRef": str(resource_allocation_ref),
        "sessionManifestRef": str(session_manifest_ref),
        "virtualDisplayRef": str(virtual_display_ref),
        "captureStreamRef": str(capture_stream_ref),
        "replayBundleRef": str(replay_bundle_ref),
        "filesystemRootRef": str(filesystem_root_ref),
        "noVncViewerRef": str(no_vnc_viewer_ref),
        **dict(evidence_refs),
        "finalArtifactRef": str(final_artifact_ref),
        "artifactValidationRef": str(artifact_validation_ref),
        "fileListArtifactRef": str(file_list_artifact_ref),
        "fileListDataRef": str(file_list_data_ref),
        "guiPresentRef": str(gui_present_ref),
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
        "l3Workflow": {
            "status": "completed",
            "completed": True,
            "workflowKind": L3_WORKFLOW_KIND,
            "sameVirtualSession": True,
            "sameSession": True,
            "sourceToWriterToPreviewCausality": True,
        },
        "workflowRequirements": {
            "minimumAppCount": 3,
            "minimumActionCount": 6,
            "requiredInputModalities": ["pointer", "keyboard"],
            "requiresCurrentStepScreenshots": True,
            "forbidPriorRoundCompletionEvidence": True,
            "requiresDirectoryEvidence": True,
            "requiresArtifactPreview": True,
            "requiresWindowBoundPointerProof": True,
        },
        "applicationEvidence": [
            {
                "appKind": "source-reader",
                "sessionManifestRef": str(session_manifest_ref),
                "firstScreenshotRef": screenshots["source_first"],
                "lastScreenshotRef": screenshots["source_last"],
                "windowEvidenceRefs": [screenshots["source_first"], screenshots["source_last"]],
            },
            {
                "appKind": "word-document-writer",
                "sessionManifestRef": str(session_manifest_ref),
                "firstScreenshotRef": screenshots["writer_first"],
                "lastScreenshotRef": screenshots["writer_saved"],
                "windowEvidenceRefs": [screenshots["writer_first"], screenshots["writer_last"], screenshots["writer_saved"]],
            },
            {
                "appKind": "file-manager-preview",
                "sessionManifestRef": str(session_manifest_ref),
                "firstScreenshotRef": screenshots["preview_first"],
                "lastScreenshotRef": screenshots["preview_last"],
                "windowEvidenceRefs": [screenshots["preview_first"], screenshots["preview_last"]],
            },
        ],
        "crossAppTransitions": [
            {
                "fromAppKind": "source-reader",
                "toAppKind": "word-document-writer",
                "sessionManifestRef": str(session_manifest_ref),
                "screenshotRef": screenshots["writer_first"],
            },
            {
                "fromAppKind": "word-document-writer",
                "toAppKind": "file-manager-preview",
                "sessionManifestRef": str(session_manifest_ref),
                "screenshotRef": screenshots["preview_first"],
            },
        ],
        "sourceEvidence": {
            "sourceObservationRefs": [screenshots["source_last"]],
            "sourceFactRefs": list(source_fact_refs),
        },
        "derivedContentEvidence": {
            "supportedFactRefs": list(source_fact_refs),
        },
        "artifactCausality": {
            "savedByActionIndex": 3,
            "savedByInputModality": "keyboard",
            "savedByCommandEventRef": f"{executor_command_event_log_ref}#events/l3-command-003",
            "finalArtifactRef": str(final_artifact_ref),
            "artifactValidationRef": str(artifact_validation_ref),
            "savedThroughGui": True,
            "shellDirectArtifactWrite": False,
        },
        "directoryEvidence": {
            "fileListArtifactRef": str(file_list_artifact_ref),
            "fileListDataRef": str(file_list_data_ref),
            "previewObservationRef": screenshots["preview_last"],
            "directoryObservationAfterSaveRef": screenshots["preview_first"],
            "previewedByActionIndex": 9,
            "previewedByInputModality": "pointer",
            "previewedThroughGui": True,
            "shellDirectoryListingOnly": False,
        },
        "presentationEvidence": {
            "guiPresentRef": str(gui_present_ref),
        },
    }


def _write_l3_static_refs(
    *,
    session_root: Path,
    display: str,
    vnc_port: int,
    novnc_port: int,
    process_ref: Path,
    resource_allocation_ref: str,
    session_id: str,
    diagnostic_only: bool = True,
) -> None:
    filesystem_root = session_root / "filesystem-root"
    filesystem_root.mkdir(parents=True, exist_ok=True)
    input_queue_ref = session_root / "virtual-input-queue.jsonl"
    input_queue_ref.touch(exist_ok=True)
    session_manifest_ref = session_root / "virtual-desktop-session-manifest.json"
    virtual_display_ref = session_root / "virtual-display.json"
    capture_stream_ref = session_root / "capture-stream.json"
    replay_bundle_ref = session_root / "replay-bundle.json"
    no_vnc_ref = session_root / "novnc-viewer.json"
    _write_json(
        session_manifest_ref,
        {
            "schemaVersion": "sciforge.computer-use.virtual-desktop-session.v1",
            "status": "open",
            "sessionId": session_id,
            "display": display,
            "backend": {"kind": BACKEND_KIND, "status": "running", "noVncBackendStarted": True},
            "refs": {
                "virtualDisplayRef": str(virtual_display_ref),
                "captureStreamRef": str(capture_stream_ref),
                "replayBundleRef": str(replay_bundle_ref),
                "filesystemRootRef": str(filesystem_root),
                "noVncViewerRef": str(no_vnc_ref),
                "processRef": str(process_ref),
                "resourceAllocationRef": resource_allocation_ref,
            },
            "diagnosticOnly": bool(diagnostic_only),
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
            "viewport": {"width": 1280, "height": 720},
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
            "display": display,
            "sessionId": session_id,
        },
    )
    _write_json(
        no_vnc_ref,
        {
            "schemaVersion": "sciforge.computer-use.novnc-viewer-ref.v1",
            "status": "running",
            "url": f"http://127.0.0.1:{novnc_port}/vnc.html",
            "host": "127.0.0.1",
            "port": novnc_port,
            "vncPort": vnc_port,
            "novncPort": novnc_port,
            "localhostOnly": True,
            "display": display,
            "sessionId": session_id,
        },
    )


def _write_l3_source_page(filesystem_root: Path) -> Path:
    page_ref = filesystem_root / "l3-source.html"
    fact_items = "\n".join(f"      <li>{fact}</li>" for fact in L3_SOURCE_FACTS)
    page_ref.write_text(
        """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>SciForge isolated desktop L3 source loading</title>
  <style>
    body { font-family: sans-serif; margin: 48px; background: #f4f6f7; color: #111; }
    main { max-width: 760px; }
    li { margin: 8px 0; }
  </style>
</head>
<body>
  <main>
    <h1>Source Notes</h1>
    <ul>
__FACT_ITEMS__
    </ul>
  </main>
  <script>
    window.addEventListener('load', () => { document.title = '__L3_READY_TITLE__'; });
  </script>
</body>
</html>
""".replace("__FACT_ITEMS__", fact_items).replace("__L3_READY_TITLE__", L3_SOURCE_READY_TITLE),
        encoding="utf8",
    )
    return page_ref


def _document_writer_command(component: Mapping[str, Any]) -> list[str]:
    path = str(component.get("path"))
    command = str(component.get("command") or Path(path).name)
    if command == "libreoffice":
        return [path, "--writer", "--norestore", "--nofirststartwizard"]
    return [path]


def _file_preview_command(
    runtime_components: Mapping[str, Mapping[str, Any]],
    filesystem_root: Path,
) -> list[str]:
    tool = _mapping(runtime_components.get("filePreviewTool"))
    path = str(tool.get("path"))
    command = str(tool.get("command") or Path(path).name)
    if command == "gio":
        return [path, "open", str(filesystem_root)]
    return [path, str(filesystem_root)]


def _write_l3_empty_executor_command_event_log(path: Path, *, display: str, session_id: str) -> None:
    _write_json(
        path,
        {
            "schemaVersion": EXECUTOR_COMMAND_EVENT_LOG_SCHEMA,
            "status": "partial-runtime-no-workflow-input",
            "display": display,
            "sessionId": session_id,
            "eventCount": 0,
            "events": [],
            "workflowInputExecuted": False,
            "diagnosticOnly": True,
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
        },
    )


def _start_l3_file_preview_process(
    *,
    command_runner: Any,
    runtime_components: Mapping[str, Mapping[str, Any]],
    filesystem_root: Path,
    env: Mapping[str, str],
    process_records: list[dict[str, Any]],
    process_ref: Path,
    timeout_seconds: float,
) -> Any | None:
    command = _file_preview_command(runtime_components, filesystem_root)
    stdout_ref, stderr_ref = _l1_process_log_refs(process_ref, "file-preview")
    stdout_ref.parent.mkdir(parents=True, exist_ok=True)
    if not _is_l3_file_preview_launcher(runtime_components):
        stdout_ref.touch(exist_ok=True)
        stderr_ref.touch(exist_ok=True)
        try:
            with stdout_ref.open("a", encoding="utf8") as stdout_handle, stderr_ref.open("a", encoding="utf8") as stderr_handle:
                process = command_runner.popen(list(command), env=env, stdout=stdout_handle, stderr=stderr_handle)
        except TypeError:
            process = command_runner.popen(list(command), env=env)
        returncode = process.poll() if hasattr(process, "poll") else None
        record = _l3_file_preview_process_record(
            command=command,
            env=env,
            stdout_ref=stdout_ref,
            stderr_ref=stderr_ref,
            status="started" if returncode is None else ("launcher-completed" if returncode == 0 else "launcher-failed"),
            returncode=returncode,
            pid=getattr(process, "pid", None),
        )
        process_records.append(record)
        _l1_write_process_records(process_ref, process_records)
        if returncode is None:
            return process
        if returncode != 0:
            raise IsolatedDesktopRunFailed(
                "file-preview process exited before the isolated directory preview could be requested.",
                {"role": "file-preview", "returncode": returncode, "processRef": str(process_ref)},
            )
        return None

    completed = command_runner.run(list(command), env=env, timeout=timeout_seconds)
    stdout_ref.write_text(str(getattr(completed, "stdout", "") or ""), encoding="utf8")
    stderr_ref.write_text(str(getattr(completed, "stderr", "") or ""), encoding="utf8")
    record = _l3_file_preview_process_record(
        command=command,
        env=env,
        stdout_ref=stdout_ref,
        stderr_ref=stderr_ref,
        status="launcher-completed" if getattr(completed, "returncode", 1) == 0 else "launcher-failed",
        returncode=getattr(completed, "returncode", None),
        pid=None,
    )
    process_records.append(record)
    _l1_write_process_records(process_ref, process_records)
    if getattr(completed, "returncode", 1) != 0:
        raise IsolatedDesktopRunFailed(
            "file-preview launcher failed before the isolated directory preview could be requested.",
            {"role": "file-preview", "returncode": getattr(completed, "returncode", None), "processRef": str(process_ref)},
        )
    return None


def _l3_file_preview_process_record(
    *,
    command: Sequence[str],
    env: Mapping[str, str],
    stdout_ref: Path,
    stderr_ref: Path,
    status: str,
    returncode: int | None,
    pid: int | None,
) -> dict[str, Any]:
    return {
        "role": "file-preview",
        "args": list(command),
        "pid": pid,
        "env": {
            "DISPLAY": env.get("DISPLAY"),
            "SCIFORGE_ISOLATED_SESSION_ID": env.get("SCIFORGE_ISOLATED_SESSION_ID"),
        },
        "display": env.get("DISPLAY"),
        "sessionId": env.get("SCIFORGE_ISOLATED_SESSION_ID"),
        "status": status,
        "returncode": returncode,
        "processKind": "delegating-launcher-or-file-manager",
        "longRunningExpected": False,
        "stdoutLogRef": str(stdout_ref),
        "stderrLogRef": str(stderr_ref),
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
    }


def _ensure_l3_file_preview_process_ready(
    process: Any,
    *,
    process_records: list[dict[str, Any]],
    process_ref: Path,
) -> None:
    returncode = process.poll() if hasattr(process, "poll") else None
    if returncode is None:
        return
    _mark_l3_process_status(
        process_records,
        role="file-preview",
        status="launcher-completed" if returncode == 0 else "launcher-failed",
        returncode=returncode,
    )
    _l1_write_process_records(process_ref, process_records)
    if returncode != 0:
        raise IsolatedDesktopRunFailed(
            "file-preview process exited before the isolated directory preview could be requested.",
            {"role": "file-preview", "returncode": returncode, "processRef": str(process_ref)},
        )


def _mark_l3_process_status(
    process_records: list[dict[str, Any]],
    *,
    role: str,
    status: str,
    returncode: int | None,
) -> None:
    for record in reversed(process_records):
        if record.get("role") == role:
            record["status"] = status
            record["returncode"] = returncode
            return


def _is_l3_file_preview_launcher(runtime_components: Mapping[str, Mapping[str, Any]]) -> bool:
    tool = _mapping(runtime_components.get("filePreviewTool"))
    command = str(tool.get("command") or Path(str(tool.get("path") or "")).name)
    return command in {"xdg-open", "gio"}


def _update_l3_runtime_frame_refs(*, session_root: Path, screenshot_refs: Sequence[str]) -> None:
    for name in ("virtual-display.json", "capture-stream.json"):
        path = session_root / name
        payload = _load_json_object(path)
        payload["frameRefs"] = list(screenshot_refs)
        _write_json(path, payload)


def _load_json_object(path: Path) -> dict[str, Any]:
    try:
        parsed = json.loads(path.read_text(encoding="utf8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return dict(parsed) if isinstance(parsed, Mapping) else {}


def _partial_runtime_refs(partial_run: Mapping[str, Any] | None) -> dict[str, Any] | None:
    partial = _mapping(partial_run)
    if not partial:
        return None
    keys = (
        "sessionManifestRef",
        "virtualDisplayRef",
        "captureStreamRef",
        "replayBundleRef",
        "filesystemRootRef",
        "noVncViewerRef",
        "backendReadinessProofRef",
        "executorCommandEventLogRef",
        "processRef",
        "resourceAllocationRef",
    )
    return {
        "schemaVersion": "sciforge.computer-use.isolated-desktop-l3-partial-runtime-refs.v1",
        "partialRunRef": partial.get("partialRunRef"),
        "diagnosticOnly": True,
        "userAcceptanceEligible": False,
        "completionEvidenceEligible": False,
        "refs": {key: partial.get(key) for key in keys if partial.get(key)},
        "screenshotRefs": list(partial.get("screenshotRefs") or []),
        "policy": "Partial runtime refs prove launch/session only and cannot satisfy completed L3 requiredRefs.",
    }


def _application_readiness(
    backend_manifest: Mapping[str, Any],
    runtime_components: Mapping[str, Mapping[str, Any]],
) -> list[dict[str, Any]]:
    backend_components = _mapping(backend_manifest.get("observedComponents"))
    return [
        {
            "role": "source",
            "appKind": "source-reader",
            "component": "browser",
            "command": _component_command(backend_components, "browser"),
            "path": _component_path(backend_components, "browser"),
            "ready": bool(_component_path(backend_components, "browser")),
        },
        {
            "role": "writer",
            "appKind": "word-document-writer",
            "component": "documentApp",
            "command": _component_command(backend_components, "documentApp"),
            "path": _component_path(backend_components, "documentApp"),
            "ready": bool(_component_path(backend_components, "documentApp")),
        },
        {
            "role": "file-preview",
            "appKind": "file-manager-preview",
            "component": "filePreviewTool",
            "command": _component_command(runtime_components, "filePreviewTool"),
            "path": _component_path(runtime_components, "filePreviewTool"),
            "ready": bool(_component_path(runtime_components, "filePreviewTool")),
        },
    ]


def _command_plan(
    *,
    backend_manifest: Mapping[str, Any],
    runtime_components: Mapping[str, Mapping[str, Any]],
    execute_requested: bool,
    execution_boundary_ref: str | None,
    partial_run: Mapping[str, Any] | None,
    run_attempted: bool,
    runner_options: Mapping[str, Any],
) -> dict[str, Any]:
    backend_components = _mapping(backend_manifest.get("observedComponents"))
    return {
        "status": "partial-runtime-ready" if partial_run is not None else "not-started",
        "executeRequested": bool(execute_requested),
        "runnerStatus": "partial-blocked" if partial_run is not None else ("attempted-blocked" if run_attempted else "not-implemented"),
        "executionBoundaryRef": execution_boundary_ref,
        "runnerOptions": dict(runner_options),
        "sourceReader": _component_path(backend_components, "browser"),
        "documentWriter": _component_path(backend_components, "documentApp"),
        "filePreviewTool": _component_path(runtime_components, "filePreviewTool"),
        "inputTool": _component_path(runtime_components, "isolatedInputTool"),
        "screenshotTool": _component_path(runtime_components, "screenshotTool"),
        "inputToolScope": "must be invoked only with DISPLAY bound to the isolated X display",
        "artifactPolicy": "forbid shell direct file writes; final artifact must be saved through GUI input evidence",
        "sessionPolicy": "source reader, document writer, and file preview must run in the same isolated session",
        "sharedSystemInputAllowed": False,
        "completionEvidenceRequired": ISOLATED_DESKTOP_L3_WORKFLOW_EVIDENCE_SCHEMA_VERSION,
    }


def _write_execution_boundary(
    path: Path,
    *,
    backend_manifest: Mapping[str, Any],
    runtime_components: Mapping[str, Mapping[str, Any]],
    readiness_checks: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    backend_components = _mapping(backend_manifest.get("observedComponents"))
    payload = {
        "schemaVersion": EXECUTION_BOUNDARY_SCHEMA,
        "status": "blocked",
        "blockedStage": "same-session-l3-runner-not-implemented",
        "reason": (
            "Prerequisites are ready, but the same-session GUI runner has not yet produced "
            "completed L3 refs."
        ),
        "backendKind": BACKEND_KIND,
        "backendReadinessRef": backend_manifest.get("manifestRef"),
        "targetEnvironmentKind": TARGET_ENVIRONMENT_KIND,
        "captureSource": ISOLATED_CAPTURE_SOURCE,
        "inputChannel": REMOTE_DESKTOP_INPUT_CHANNEL,
        "acceptanceTier": L3_ACCEPTANCE_TIER,
        "readinessChecks": [dict(check) for check in readiness_checks],
        "runtimeComponents": {
            "sourceReader": _component_path(backend_components, "browser"),
            "documentWriter": _component_path(backend_components, "documentApp"),
            "filePreviewTool": _component_path(runtime_components, "filePreviewTool"),
            "isolatedInputTool": _component_path(runtime_components, "isolatedInputTool"),
            "screenshotTool": _component_path(runtime_components, "screenshotTool"),
        },
        "phaseGate": [
            _phase_gate("launch-session", "Start isolated X display, VNC/noVNC, source reader, writer, and file preview in one session.", []),
            _phase_gate("capture-source", "Capture visible source material and write source observation/fact refs.", ["source", "keyboard", "pointer"]),
            _phase_gate("write-artifact", "Create the report through the document writer GUI using isolated input.", ["writer", "keyboard", "pointer"]),
            _phase_gate("save-through-gui", "Save the artifact through the writer/file dialog with keyboard input causality.", ["writer", "keyboard"]),
            _phase_gate("preview-directory", "Open the saved artifact or containing directory with a file preview app.", ["file-preview", "pointer"]),
            _phase_gate("validate-and-present", "Validate artifact text/source causality, directory evidence, viewer frames, and gui.present refs.", ["source", "writer", "file-preview"]),
        ],
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
        "artifactPolicy": {
            "forbidShellDirectArtifactWrite": True,
            "forbidDomShortcut": True,
            "forbidAccessibilityTreeShortcut": True,
            "finalArtifactMustBeSavedThroughGui": True,
            "artifactCausalityRequiredFields": [
                "savedByActionIndex",
                "savedByInputModality",
                "savedByCommandEventRef",
                "finalArtifactRef",
                "artifactValidationRef",
                "savedThroughGui",
                "shellDirectArtifactWrite",
            ],
            "artifactValidationRequired": True,
            "supportedSourceFactsMustAppearInArtifactText": True,
        },
        "directoryPreviewPolicy": {
            "directoryEvidenceRequiredFields": [
                "fileListArtifactRef",
                "fileListDataRef",
                "previewObservationRef",
                "directoryObservationAfterSaveRef",
                "previewedByActionIndex",
                "previewedByInputModality",
                "previewedThroughGui",
                "shellDirectoryListingOnly",
            ],
            "previewMustBeGuiBacked": True,
            "previewInputModality": "pointer",
            "shellDirectoryListingOnlyAllowed": False,
        },
        "inputPolicy": {
            "inputToolScope": "only DISPLAY-bound isolated input executor commands are eligible",
            "requiredInputModalities": ["pointer", "keyboard"],
            "requiresActionIndexCoverage": True,
            "requiresExecutorCommandProvenance": True,
            "executorCommandEventLogSchemaRef": EXECUTOR_COMMAND_EVENT_LOG_SCHEMA,
            "requiredCommandEventFields": ["commandEventId", "commandEventRef", "commandEventLogRef"],
            "requiresWindowBoundPointerProof": True,
            "targetWindowSchemaRef": ISOLATED_TARGET_WINDOW_SCHEMA_VERSION,
            "requiredWindowBoundProofRefs": ["targetWindowRef", "windowBoundPointerProofRef"],
            "sharedSystemInputAllowed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
        },
        "sessionPolicy": {
            "sameVirtualSession": True,
            "minimumAppCount": 3,
            "requiredApplicationRoles": ["source", "writer", "file-preview"],
            "captureStreamMustContainWorkflowScreenshots": True,
            "noVncViewerMustBeLocalhostOnly": True,
            "processRefMustShareSessionDisplay": True,
            "resourceAllocationRefMustShareDisplay": True,
            "processRefMustShareSession": True,
            "resourceAllocationRefMustShareSession": True,
        },
        "runtimeProofPolicy": {
            "requiresBackendReadinessProof": True,
            "backendReadinessProofSchemaRef": BACKEND_READINESS_PROOF_SCHEMA_VERSION,
            "requiresQueryableXDisplay": True,
            "requiresNoVncHttpViewerProof": True,
            "requiresExecutorCommandProvenance": True,
            "executorCommandEventLogSchemaRef": EXECUTOR_COMMAND_EVENT_LOG_SCHEMA,
            "requiresProcessLogRefs": True,
            "requiresRuntimeResourceAllocation": True,
            "resourceAllocationSchemaRef": ISOLATED_RUNTIME_RESOURCE_ALLOCATION_SCHEMA_VERSION,
            "legacyResourceAllocationSchemaRef": LEGACY_L1_RUNTIME_RESOURCE_ALLOCATION_SCHEMA_VERSION,
            "requiredRefs": [
                "backendReadinessProofRef",
                "executorCommandEventLogRef",
                "processRef",
                "resourceAllocationRef",
            ],
        },
        "realRunnerImplemented": False,
        "userAcceptanceEligible": False,
        "diagnosticOnly": True,
        "rawPayloadWritten": False,
        "inlineImageWritten": False,
        "secretsWritten": False,
        **NO_OS_INPUT_FLAGS,
    }
    _write_json(path, payload)
    return payload


def _phase_gate(name: str, description: str, roles: Sequence[str]) -> dict[str, Any]:
    return {
        "name": name,
        "description": description,
        "requiredRoles": list(roles),
        "status": "pending-real-runner",
    }


def _boundary_summary(boundary: Mapping[str, Any] | None) -> dict[str, Any] | None:
    if boundary is None:
        return None
    return {
        "schemaVersion": boundary.get("schemaVersion"),
        "status": boundary.get("status"),
        "blockedStage": boundary.get("blockedStage"),
        "phaseCount": len(boundary.get("phaseGate") or []),
        "realRunnerImplemented": boundary.get("realRunnerImplemented"),
        "userAcceptanceEligible": boundary.get("userAcceptanceEligible"),
    }


def _resolve_component(candidates: Sequence[str], resolver: Callable[[str], str | None]) -> dict[str, Any]:
    for command in candidates:
        resolved = resolver(command)
        if resolved:
            return {"status": "found", "command": command, "path": str(resolved), "candidates": list(candidates)}
    return {"status": "missing", "command": None, "path": None, "candidates": list(candidates)}


def _check(ok: bool, category: str, reason: str) -> dict[str, Any]:
    return {"category": category, "ok": bool(ok), "reason": "" if ok else reason}


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _string_or_none(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _refs_from_completed(*payloads: Mapping[str, Any], key: str) -> list[str]:
    refs: list[str] = []
    for payload in payloads:
        value = payload.get(key)
        if isinstance(value, str):
            refs.append(value)
        elif isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
            refs.extend(str(item) for item in value if isinstance(item, str) and item.strip())
    return _unique_strings(refs)


def _l3_session_id() -> str:
    return f"isolated-l3-{int(time.time() * 1000)}"


def _component_path(components: Mapping[str, Mapping[str, Any]], name: str) -> str | None:
    value = _mapping(components.get(name))
    path = value.get("path")
    return str(path) if path else None


def _component_command(components: Mapping[str, Mapping[str, Any]], name: str) -> str | None:
    value = _mapping(components.get(name))
    command = value.get("command")
    return str(command) if command else None


def _first_non_empty_line(value: Any) -> str:
    for line in str(value or "").splitlines():
        stripped = line.strip()
        if stripped:
            return stripped
    return ""


def _safe_env_summary(env: Mapping[str, str]) -> dict[str, str | None]:
    return {key: env.get(key) for key in ("DISPLAY", "SCIFORGE_ISOLATED_SESSION_ID", "XAUTHORITY", "HOME", "TMPDIR")}


def _short_text(value: Any, *, limit: int = 500) -> str:
    return str(value or "")[:limit]


def _unique_strings(values: Sequence[str]) -> list[str]:
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


def _point_inside_bounds(point: Mapping[str, Any], bounds: Mapping[str, Any]) -> bool:
    x = _int_or_none(point.get("x"))
    y = _int_or_none(point.get("y"))
    left = _int_or_none(bounds.get("x"))
    top = _int_or_none(bounds.get("y"))
    width = _int_or_none(bounds.get("width"))
    height = _int_or_none(bounds.get("height"))
    if None in (x, y, left, top, width, height) or width <= 0 or height <= 0:
        return False
    return bool(left <= x <= left + width and top <= y <= top + height)


def _int_or_none(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _update_json_file(path: Path, updates: Mapping[str, Any]) -> None:
    if not path.is_file():
        return
    payload = _load_json_object(path)
    if not payload:
        return
    payload.update(dict(updates))
    _write_json(path, payload)


def _write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{json.dumps(payload, indent=2, sort_keys=True)}\n", encoding="utf8")
