import json
from pathlib import Path

from sciforge_computer_use.isolated_desktop_l3_workflow_evidence import (
    REQUIRED_TOP_LEVEL_REFS,
    validate_isolated_desktop_l3_workflow_evidence,
)
from sciforge_computer_use.isolated_desktop_l3_workflow_probe import (
    build_isolated_desktop_l3_workflow_probe_manifest,
)
from test_isolated_desktop_l3_workflow_evidence import (
    valid_l3_evidence_from_refs,
    write_valid_l3_bundle,
)


def test_l3_workflow_probe_promotes_completed_runner_refs_without_partial_refs(tmp_path):
    manifest = build_isolated_desktop_l3_workflow_probe_manifest(
        output_dir=tmp_path / "l3",
        execute=True,
        platform_system="Linux",
        command_resolver=lambda command: _ready_command_paths().get(command),
        path_exists=lambda path: path == "/usr/share/novnc",
        display=":148",
        vnc_port=21148,
        novnc_port=22148,
        resource_lock_root=tmp_path / "locks",
        partial_runner=_fake_l3_completed_runner,
    )

    run_root = tmp_path / "l3"
    completed_evidence_ref = run_root / manifest["completionEvidenceRef"]
    completed_evidence = _read_json(completed_evidence_ref)
    partial_refs = _partial_ref_values(manifest)

    assert manifest["status"] == "completed"
    assert manifest["diagnosticOnly"] is False
    assert manifest["userAcceptanceEligible"] is True
    assert manifest["completionEvidenceRef"] == "completed-run/isolated-desktop-l3-workflow-evidence.json"
    assert validate_isolated_desktop_l3_workflow_evidence(completed_evidence_ref)["ok"] is True

    for ref_name in REQUIRED_TOP_LEVEL_REFS:
        assert manifest[ref_name]
        assert manifest[ref_name] == completed_evidence[ref_name]
        assert not Path(str(manifest[ref_name]).split("#", 1)[0]).is_absolute()
        assert manifest[ref_name] not in partial_refs

    assert manifest["partialRunRef"] not in {
        manifest[ref_name] for ref_name in REQUIRED_TOP_LEVEL_REFS
    }
    if manifest.get("partialRuntimeRefs"):
        for ref in manifest["partialRuntimeRefs"].get("refs", {}).values():
            assert ref not in {
                manifest[ref_name] for ref_name in REQUIRED_TOP_LEVEL_REFS
            }


def _fake_l3_completed_runner(*args, **kwargs):
    context = {}
    for arg in args:
        if isinstance(arg, dict):
            context.update(arg)
    context.update(kwargs)
    root = Path(context["root"]).expanduser().resolve()
    session_id = str(context["session_id"])
    display = str(context["display"])
    vnc_port = int(context["vnc_port"])
    novnc_port = int(context["novnc_port"])
    completed_root = root / "completed-run"
    completed_root.mkdir(parents=True, exist_ok=True)
    resource_allocation_ref = completed_root / "l3-runtime-resource-allocation.json"
    completed_refs = write_valid_l3_bundle(completed_root)
    _retarget_valid_l3_bundle(
        completed_refs,
        session_id=session_id,
        display=display,
        vnc_port=vnc_port,
        novnc_port=novnc_port,
        resource_allocation_ref=resource_allocation_ref,
    )
    completed_evidence = valid_l3_evidence_from_refs(completed_refs)
    completion_evidence_ref = completed_root / "isolated-desktop-l3-workflow-evidence.json"
    _write_json(completion_evidence_ref, completed_evidence)

    partial_root = root / "diagnostic-partial-run"
    partial_run_ref, partial_runtime_refs = _write_diagnostic_partial_refs(partial_root)

    return {
        "schemaVersion": "sciforge.computer-use.isolated-desktop-l3-runner-result.v1",
        "status": "completed",
        "workflowStatus": "completed",
        "sameVirtualSession": True,
        "realWindowEvidence": True,
        "runAttempted": True,
        "realRunnerImplemented": True,
        "completionEvidenceRef": str(completion_evidence_ref),
        "completedRefs": {
            ref_name: completed_evidence[ref_name]
            for ref_name in REQUIRED_TOP_LEVEL_REFS
        },
        "traceRefs": list(completed_evidence["traceRefs"]),
        "screenshotRefs": list(completed_evidence["screenshotRefs"]),
        "artifactRefs": [completed_evidence["finalArtifactRef"]],
        "inputExecuted": True,
        "executeFailClosed": False,
        "diagnosticOnly": False,
        "userAcceptanceEligible": True,
        "partialRunRef": str(partial_run_ref),
        "partialRuntimeRefs": {
            "schemaVersion": "sciforge.computer-use.isolated-desktop-l3-partial-runtime-refs.v1",
            "partialRunRef": str(partial_run_ref),
            "diagnosticOnly": True,
            "userAcceptanceEligible": False,
            "completionEvidenceEligible": False,
            "refs": partial_runtime_refs,
        },
    }


def _retarget_valid_l3_bundle(
    refs,
    *,
    session_id,
    display,
    vnc_port,
    novnc_port,
    resource_allocation_ref,
):
    refs["resource_allocation"] = Path(resource_allocation_ref)
    novnc_url = f"http://127.0.0.1:{novnc_port}/vnc.html"

    backend_readiness = _read_json(refs["backend_readiness_proof"])
    backend_readiness["display"] = display
    backend_readiness["vnc"]["port"] = vnc_port
    backend_readiness["novnc"]["port"] = novnc_port
    backend_readiness["novnc"]["httpViewer"]["url"] = novnc_url
    backend_readiness["xDisplay"]["display"] = display
    _write_json(refs["backend_readiness_proof"], backend_readiness)

    processes = _read_json(refs["process_ref"])
    processes["sessionId"] = session_id
    processes["display"] = display
    for process in processes["processes"]:
        process["sessionId"] = session_id
        process["display"] = display
    _write_json(refs["process_ref"], processes)

    allocation = {
        "schemaVersion": "sciforge.computer-use.isolated-runtime-resource-allocation.v1",
        "status": "allocated",
        "sessionId": session_id,
        "display": display,
        "vncPort": vnc_port,
        "novncPort": novnc_port,
        "localhostOnly": True,
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
    }
    _write_json(refs["resource_allocation"], allocation)

    target_window = _read_json(refs["target_window"])
    target_window["display"] = display
    target_window["desktopWindow"]["display"] = display
    _write_json(refs["target_window"], target_window)

    pointer_proof = _read_json(refs["window_bound_pointer_proof"])
    pointer_proof["display"] = display
    _write_json(refs["window_bound_pointer_proof"], pointer_proof)

    executor_log = _read_json(refs["executor_command_log"])
    for event in executor_log["events"]:
        event["display"] = display
        event["env"]["DISPLAY"] = display
    _write_json(refs["executor_command_log"], executor_log)

    session_manifest = _read_json(refs["session_manifest"])
    session_manifest["sessionId"] = session_id
    session_manifest["display"] = display
    session_manifest["refs"] = {
        **session_manifest.get("refs", {}),
        "resourceAllocationRef": str(refs["resource_allocation"]),
    }
    _write_json(refs["session_manifest"], session_manifest)

    for ref_name in ("virtual_display", "capture_stream", "replay_bundle"):
        payload = _read_json(refs[ref_name])
        payload["sessionId"] = session_id
        payload["display"] = display
        _write_json(refs[ref_name], payload)

    novnc_viewer = _read_json(refs["novnc_viewer"])
    novnc_viewer["sessionId"] = session_id
    novnc_viewer["display"] = display
    novnc_viewer["url"] = novnc_url
    novnc_viewer["port"] = novnc_port
    _write_json(refs["novnc_viewer"], novnc_viewer)


def _write_diagnostic_partial_refs(root):
    root.mkdir(parents=True, exist_ok=True)
    partial_run_ref = root / "isolated-desktop-l3-partial-run.json"
    runtime_refs = {
        "preflightRef": root / "partial-preflight.json",
        "resultRef": root / "partial-result.json",
        "viewerManifestRef": root / "partial-viewer-manifest.json",
        "viewerHtmlRef": root / "partial-viewer.html",
        "inputEventLogRef": root / "partial-input-events.json",
        "pointerEventLogRef": root / "partial-pointer-events.json",
        "keyboardEventLogRef": root / "partial-keyboard-events.json",
        "backendReadinessProofRef": root / "partial-backend-readiness-proof.json",
        "executorCommandEventLogRef": root / "partial-executor-command-events.json",
        "targetWindowRef": root / "partial-target-window.json",
        "windowBoundPointerProofRef": root / "partial-window-bound-pointer-proof.json",
        "processRef": root / "partial-processes.json",
        "resourceAllocationRef": root / "partial-resource-allocation.json",
        "sessionManifestRef": root / "partial-session-manifest.json",
        "virtualDisplayRef": root / "partial-virtual-display.json",
        "captureStreamRef": root / "partial-capture-stream.json",
        "replayBundleRef": root / "partial-replay-bundle.json",
        "filesystemRootRef": root / "partial-filesystem-root",
        "noVncViewerRef": root / "partial-novnc-viewer.json",
        "evidenceLogRef": root / "partial-evidence-log.jsonl",
        "evidenceSnapshotRef": root / "partial-evidence-snapshot.json",
        "evidenceIndexRef": root / "partial-evidence-index.json",
        "plannerBriefRef": root / "partial-planner-brief.json",
        "finalArtifactRef": root / "partial-artifact.docx",
        "artifactValidationRef": root / "partial-artifact.validation.json",
        "fileListArtifactRef": root / "partial-file-list-artifact.json",
        "fileListDataRef": root / "partial-file-list-data.json",
        "guiPresentRef": root / "partial-gui-present.json",
    }
    runtime_refs["filesystemRootRef"].mkdir(parents=True, exist_ok=True)
    for ref_name, path in runtime_refs.items():
        if ref_name == "filesystemRootRef":
            continue
        Path(path).write_text("partial diagnostic ref\n", encoding="utf8")

    payload = {
        "schemaVersion": "sciforge.computer-use.isolated-desktop-l3-partial-run.v1",
        "status": "blocked",
        "diagnosticOnly": True,
        "userAcceptanceEligible": False,
        "completionEvidenceEligible": False,
        "refs": {ref_name: str(path) for ref_name, path in runtime_refs.items()},
    }
    _write_json(partial_run_ref, payload)
    return partial_run_ref, {ref_name: str(path) for ref_name, path in runtime_refs.items()}


def _partial_ref_values(manifest):
    values = set()
    partial_run_ref = manifest.get("partialRunRef")
    if partial_run_ref:
        values.add(partial_run_ref)
    partial_runtime_refs = manifest.get("partialRuntimeRefs") or {}
    values.update(
        ref
        for ref in partial_runtime_refs.get("refs", {}).values()
        if isinstance(ref, str) and ref
    )
    return values


def _ready_command_paths():
    return {
        "Xvfb": "/usr/bin/Xvfb",
        "openbox": "/usr/bin/openbox",
        "x11vnc": "/usr/bin/x11vnc",
        "websockify": "/usr/bin/websockify",
        "libreoffice": "/usr/bin/libreoffice",
        "chromium": "/usr/bin/chromium",
        "xdotool": "/usr/bin/xdotool",
        "import": "/usr/bin/import",
        "xdg-open": "/usr/bin/xdg-open",
    }


def _write_json(path, payload):
    Path(path).write_text(f"{json.dumps(payload, indent=2, sort_keys=True)}\n", encoding="utf8")


def _read_json(path):
    return json.loads(Path(path).read_text(encoding="utf8"))
