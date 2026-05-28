import json
import subprocess
import sys
from collections.abc import Mapping
from pathlib import Path

import pytest

from sciforge_computer_use.isolated_desktop_contracts import (
    BACKEND_KIND,
    BACKEND_READINESS_PROOF_SCHEMA_VERSION,
    EXECUTOR_COMMAND_EVENT_LOG_SCHEMA,
    ISOLATED_RUNTIME_RESOURCE_ALLOCATION_SCHEMA_VERSION,
    ISOLATED_TARGET_WINDOW_SCHEMA_VERSION,
    LEGACY_L1_RUNTIME_RESOURCE_ALLOCATION_SCHEMA_VERSION,
)
from sciforge_computer_use.isolated_desktop_l3_workflow_evidence import (
    REQUIRED_TOP_LEVEL_REFS,
    validate_isolated_desktop_l3_workflow_evidence,
)
from sciforge_computer_use.isolated_desktop_l3_workflow_probe import (
    EXECUTION_BOUNDARY_SCHEMA,
    ISOLATED_DESKTOP_L3_WORKFLOW_PROBE_SCHEMA,
    MANIFEST_NAME,
    REQUIRED_L3_RUNTIME_COMPONENTS,
    _start_l3_file_preview_process,
    build_isolated_desktop_l3_workflow_probe_manifest,
)


PACKAGE_ROOT = Path(__file__).resolve().parents[1]


def test_l3_workflow_probe_blocks_without_linux_backend_or_runtime_components(tmp_path):
    manifest = build_isolated_desktop_l3_workflow_probe_manifest(
        output_dir=tmp_path / "l3",
        platform_system="Darwin",
        command_resolver=lambda _command: None,
        path_exists=lambda _path: False,
    )

    assert manifest["schemaVersion"] == ISOLATED_DESKTOP_L3_WORKFLOW_PROBE_SCHEMA
    assert manifest["status"] == "blocked"
    assert manifest["category"] == "isolated-desktop-l3-workflow-readiness-blocked"
    assert manifest["backendKind"] == BACKEND_KIND
    assert manifest["backendReadinessStatus"] == "blocked"
    assert manifest["readinessStatus"] == "blocked"
    assert manifest["diagnosticOnly"] is True
    assert manifest["realWindowEvidence"] is False
    assert manifest["userAcceptanceEligible"] is False
    assert manifest["readinessOnly"] is True
    assert manifest["runAttempted"] is False
    assert manifest["realRunnerImplemented"] is False
    assert manifest["completionEvidenceRef"] is None
    assert manifest["executeFailClosed"] is True
    assert manifest["inputExecuted"] is False
    assert manifest["sharedSystemInputUsed"] is False
    assert manifest["systemPointerMoved"] is False
    assert manifest["systemKeyboardEventsSent"] is False
    assert manifest["l3Workflow"]["completed"] is False
    assert manifest["l3Workflow"]["realWindowEvidence"] is False
    assert manifest["traceRefs"] == []
    assert manifest["artifactRefs"] == []
    assert Path(manifest["manifestRef"]).name == MANIFEST_NAME
    assert Path(manifest["manifestRef"]).is_file()
    assert Path(manifest["backendReadinessRef"]).is_file()


def test_l3_workflow_probe_ready_dependencies_still_blocks_without_execute(tmp_path):
    manifest = build_isolated_desktop_l3_workflow_probe_manifest(
        output_dir=tmp_path / "l3",
        platform_system="Linux",
        command_resolver=lambda command: _ready_command_paths().get(command),
        path_exists=lambda path: path == "/usr/share/novnc",
    )

    assert manifest["status"] == "blocked"
    assert manifest["backendReadinessStatus"] == "ready"
    assert manifest["readinessStatus"] == "ready"
    assert manifest["commandPlan"]["executeRequested"] is False
    assert manifest["commandPlan"]["runnerStatus"] == "not-implemented"
    assert manifest["runnerExecutionBoundaryRef"] is None
    assert manifest["runnerExecutionBoundary"] is None
    assert manifest["runAttempted"] is False
    assert manifest["requiredRuntimeComponents"].keys() == REQUIRED_L3_RUNTIME_COMPONENTS.keys()
    assert manifest["observedRuntimeComponents"]["isolatedInputTool"]["path"] == "/usr/bin/xdotool"
    assert manifest["observedRuntimeComponents"]["screenshotTool"]["path"] == "/usr/bin/import"
    assert manifest["observedRuntimeComponents"]["filePreviewTool"]["path"] == "/usr/bin/xdg-open"
    assert all(app["ready"] for app in manifest["applicationReadiness"])
    assert manifest["workflowRequirements"]["targetWindowSchemaRef"] == ISOLATED_TARGET_WINDOW_SCHEMA_VERSION
    assert manifest["workflowRequirements"]["resourceAllocationSchemaRef"] == ISOLATED_RUNTIME_RESOURCE_ALLOCATION_SCHEMA_VERSION
    assert manifest["workflowRequirements"]["legacyResourceAllocationSchemaRef"] == LEGACY_L1_RUNTIME_RESOURCE_ALLOCATION_SCHEMA_VERSION
    assert "requiresSessionBoundRuntimeProofs" in manifest["workflowRequirements"]
    assert "requiresGuiSavedArtifactCausality" in manifest["workflowRequirements"]
    assert "requiresGuiDirectoryPreviewCausality" in manifest["workflowRequirements"]
    assert any("execute flag was not set" in reason for reason in manifest["blockedReasons"])
    assert manifest["projectClaimLimit"]


def test_l3_workflow_probe_execute_is_fail_closed_even_when_dependencies_are_ready(tmp_path):
    manifest = build_isolated_desktop_l3_workflow_probe_manifest(
        output_dir=tmp_path / "l3",
        execute=True,
        platform_system="Linux",
        command_resolver=lambda command: _ready_command_paths().get(command),
        path_exists=lambda path: path == "/usr/share/novnc",
    )

    assert manifest["status"] == "blocked"
    assert manifest["category"] == "isolated-desktop-l3-workflow-runner-blocked"
    assert manifest["backendReadinessStatus"] == "ready"
    assert manifest["readinessStatus"] == "ready"
    assert manifest["commandPlan"]["executeRequested"] is True
    assert manifest["commandPlan"]["runnerStatus"] == "attempted-blocked"
    assert manifest["commandPlan"]["executionBoundaryRef"] == manifest["runnerExecutionBoundaryRef"]
    assert Path(manifest["runnerExecutionBoundaryRef"]).is_file()
    boundary = json.loads(Path(manifest["runnerExecutionBoundaryRef"]).read_text(encoding="utf8"))
    assert boundary["schemaVersion"] == EXECUTION_BOUNDARY_SCHEMA
    assert boundary["status"] == "blocked"
    assert boundary["blockedStage"] == "same-session-l3-runner-not-implemented"
    assert boundary["artifactPolicy"]["forbidShellDirectArtifactWrite"] is True
    assert boundary["artifactPolicy"]["finalArtifactMustBeSavedThroughGui"] is True
    assert "savedByCommandEventRef" in boundary["artifactPolicy"]["artifactCausalityRequiredFields"]
    assert "shellDirectArtifactWrite" in boundary["artifactPolicy"]["artifactCausalityRequiredFields"]
    assert boundary["directoryPreviewPolicy"]["previewMustBeGuiBacked"] is True
    assert boundary["directoryPreviewPolicy"]["previewInputModality"] == "pointer"
    assert boundary["directoryPreviewPolicy"]["shellDirectoryListingOnlyAllowed"] is False
    assert "previewedByActionIndex" in boundary["directoryPreviewPolicy"]["directoryEvidenceRequiredFields"]
    assert boundary["inputPolicy"]["sharedSystemInputAllowed"] is False
    assert boundary["inputPolicy"]["requiresExecutorCommandProvenance"] is True
    assert boundary["inputPolicy"]["requiresWindowBoundPointerProof"] is True
    assert boundary["inputPolicy"]["targetWindowSchemaRef"] == ISOLATED_TARGET_WINDOW_SCHEMA_VERSION
    assert boundary["runtimeProofPolicy"]["requiredRefs"] == [
        "backendReadinessProofRef",
        "executorCommandEventLogRef",
        "processRef",
        "resourceAllocationRef",
    ]
    assert boundary["runtimeProofPolicy"]["resourceAllocationSchemaRef"] == ISOLATED_RUNTIME_RESOURCE_ALLOCATION_SCHEMA_VERSION
    assert boundary["runtimeProofPolicy"]["legacyResourceAllocationSchemaRef"] == LEGACY_L1_RUNTIME_RESOURCE_ALLOCATION_SCHEMA_VERSION
    for ref in [
        "backendReadinessProofRef",
        "executorCommandEventLogRef",
        "processRef",
        "resourceAllocationRef",
        "targetWindowRef",
        "windowBoundPointerProofRef",
    ]:
        assert ref in boundary["requiredCompletedRefs"]
    assert boundary["sessionPolicy"]["sameVirtualSession"] is True
    assert boundary["sessionPolicy"]["processRefMustShareSession"] is True
    assert boundary["sessionPolicy"]["resourceAllocationRefMustShareSession"] is True
    assert [phase["name"] for phase in boundary["phaseGate"]] == [
        "launch-session",
        "capture-source",
        "write-artifact",
        "save-through-gui",
        "preview-directory",
        "validate-and-present",
    ]
    assert manifest["runnerExecutionBoundary"]["phaseCount"] == 6
    assert manifest["runnerExecutionBoundary"]["userAcceptanceEligible"] is False
    assert manifest["runAttempted"] is True
    assert manifest["realRunnerImplemented"] is True
    assert manifest["completionEvidenceRef"] is None
    assert manifest["partialRunRef"] is None
    assert manifest["partialRuntimeRefs"] is None
    assert manifest["executeFailClosed"] is True
    assert manifest["rawPayloadWritten"] is False
    assert manifest["inlineImageWritten"] is False
    assert any("partial runner failed before workflow actions completed" in reason for reason in manifest["blockedReasons"])


def test_l3_workflow_probe_execute_partial_runner_reports_same_session_refs_but_stays_blocked(tmp_path):
    manifest = build_isolated_desktop_l3_workflow_probe_manifest(
        output_dir=tmp_path / "l3",
        execute=True,
        platform_system="Linux",
        command_resolver=lambda command: _ready_command_paths().get(command),
        path_exists=lambda path: path == "/usr/share/novnc",
        display=":128",
        vnc_port=21128,
        novnc_port=22128,
        resource_lock_root=tmp_path / "locks",
        partial_runner=_fake_l3_partial_same_session_runner,
    )

    assert manifest["status"] == "blocked"
    assert manifest["category"] == "isolated-desktop-l3-workflow-actions-blocked"
    assert manifest["backendReadinessStatus"] == "ready"
    assert manifest["readinessStatus"] == "ready"
    assert manifest["runAttempted"] is True
    assert manifest["realRunnerImplemented"] is True
    assert manifest["blockedStage"] == "l3-workflow-actions-not-completed"
    assert manifest["completionEvidenceRef"] is None
    assert manifest["userAcceptanceEligible"] is False
    assert manifest["diagnosticOnly"] is True
    assert manifest["l3Workflow"]["completed"] is False
    assert manifest["l3Workflow"]["sameVirtualSession"] is True
    assert manifest["partialRunRef"]
    assert Path(manifest["partialRunRef"]).is_file()
    assert manifest["partialRuntimeRefs"]["completionEvidenceEligible"] is False

    for ref in REQUIRED_TOP_LEVEL_REFS:
        assert ref in manifest
        assert not manifest[ref]

    for ref in [
        "sessionManifestRef",
        "virtualDisplayRef",
        "captureStreamRef",
        "noVncViewerRef",
        "processRef",
        "resourceAllocationRef",
        "backendReadinessProofRef",
        "executorCommandEventLogRef",
    ]:
        assert manifest[ref] is None
        partial_ref = manifest["partialRuntimeRefs"]["refs"][ref]
        assert Path(partial_ref).is_file()

    _assert_l3_partial_refs_share_session_and_display(manifest)
    _assert_l3_partial_refs_only_in_partial_manifest_namespaces(manifest)
    boundary = _read_test_json(manifest["runnerExecutionBoundaryRef"])
    assert "partialRunRef" not in boundary
    validation = validate_isolated_desktop_l3_workflow_evidence(manifest, require_existing_refs=False)
    codes = {error["code"] for error in validation["errors"]}

    assert validation["ok"] is False
    assert "unsupported_schema_version" in codes
    assert "status_not_completed" in codes
    assert "user_acceptance_not_eligible" in codes
    assert "l3_workflow_status_not_completed" in codes


def test_l3_workflow_probe_blocks_when_file_preview_readiness_is_missing(tmp_path):
    command_paths = _ready_command_paths()
    command_paths.pop("xdg-open")

    manifest = build_isolated_desktop_l3_workflow_probe_manifest(
        output_dir=tmp_path / "l3",
        execute=True,
        platform_system="Linux",
        command_resolver=lambda command: command_paths.get(command),
        path_exists=lambda path: path == "/usr/share/novnc",
    )

    assert manifest["status"] == "blocked"
    assert manifest["backendReadinessStatus"] == "ready"
    assert manifest["readinessStatus"] == "blocked"
    assert manifest["observedRuntimeComponents"]["filePreviewTool"]["status"] == "missing"
    assert any("filePreviewTool" in reason for reason in manifest["blockedReasons"])
    assert any(not app["ready"] and app["role"] == "file-preview" for app in manifest["applicationReadiness"])


def test_l3_workflow_probe_manifest_cannot_validate_as_completed_l3_evidence(tmp_path):
    manifest = build_isolated_desktop_l3_workflow_probe_manifest(
        output_dir=tmp_path / "l3",
        execute=True,
        platform_system="Linux",
        command_resolver=lambda command: _ready_command_paths().get(command),
        path_exists=lambda path: path == "/usr/share/novnc",
    )

    validation = validate_isolated_desktop_l3_workflow_evidence(manifest, require_existing_refs=False)
    codes = {error["code"] for error in validation["errors"]}

    assert validation["ok"] is False
    assert "unsupported_schema_version" in codes
    assert "status_not_completed" in codes
    assert "user_acceptance_not_eligible" in codes
    assert "l3_workflow_status_not_completed" in codes
    assert "existing_refs_required_for_l3" in codes


def test_l3_workflow_probe_cli_writes_blocked_manifest(tmp_path):
    output_dir = tmp_path / "l3"
    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "sciforge_computer_use.isolated_desktop_l3_workflow_probe",
            "--output-dir",
            str(output_dir),
        ],
        cwd=PACKAGE_ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )

    assert completed.returncode == 1
    assert completed.stderr == ""
    payload = json.loads(completed.stdout)
    assert payload["schemaVersion"] == ISOLATED_DESKTOP_L3_WORKFLOW_PROBE_SCHEMA
    assert payload["status"] == "blocked"
    assert (output_dir / MANIFEST_NAME).is_file()


def test_l3_file_preview_launcher_records_completed_launcher_without_long_running_process(tmp_path):
    process_records = []
    process_ref = tmp_path / "backend-processes.json"
    runner = _RunOnlyCommandRunner(returncode=0, stdout="opened directory\n")

    process = _start_l3_file_preview_process(
        command_runner=runner,
        runtime_components={"filePreviewTool": {"command": "xdg-open", "path": "/usr/bin/xdg-open"}},
        filesystem_root=tmp_path / "filesystem-root",
        env={"DISPLAY": ":128", "SCIFORGE_ISOLATED_SESSION_ID": "l3-preview-launcher"},
        process_records=process_records,
        process_ref=process_ref,
        timeout_seconds=3.0,
    )

    assert process is None
    assert runner.commands == [["/usr/bin/xdg-open", str(tmp_path / "filesystem-root")]]
    assert process_records[0]["role"] == "file-preview"
    assert process_records[0]["status"] == "launcher-completed"
    assert process_records[0]["returncode"] == 0
    payload = _read_test_json(process_ref)
    assert payload["processes"][0]["sessionId"] == "l3-preview-launcher"
    assert payload["processes"][0]["display"] == ":128"
    assert Path(payload["processes"][0]["stdoutLogRef"]).read_text(encoding="utf8") == "opened directory\n"
    assert Path(payload["processes"][0]["stderrLogRef"]).is_file()


def test_l3_file_preview_gio_launcher_records_gio_open_command(tmp_path):
    process_records = []
    process_ref = tmp_path / "backend-processes.json"
    runner = _RunOnlyCommandRunner(returncode=0)

    process = _start_l3_file_preview_process(
        command_runner=runner,
        runtime_components={"filePreviewTool": {"command": "gio", "path": "/usr/bin/gio"}},
        filesystem_root=tmp_path / "filesystem-root",
        env={"DISPLAY": ":129", "SCIFORGE_ISOLATED_SESSION_ID": "l3-gio-launcher"},
        process_records=process_records,
        process_ref=process_ref,
        timeout_seconds=3.0,
    )

    assert process is None
    assert runner.commands == [["/usr/bin/gio", "open", str(tmp_path / "filesystem-root")]]
    assert process_records[0]["status"] == "launcher-completed"
    assert process_records[0]["longRunningExpected"] is False


def test_l3_file_preview_file_manager_quick_success_is_launcher_completed(tmp_path):
    process_records = []
    process_ref = tmp_path / "backend-processes.json"
    runner = _PopenOnlyCommandRunner(returncode=0)

    process = _start_l3_file_preview_process(
        command_runner=runner,
        runtime_components={"filePreviewTool": {"command": "thunar", "path": "/usr/bin/thunar"}},
        filesystem_root=tmp_path / "filesystem-root",
        env={"DISPLAY": ":130", "SCIFORGE_ISOLATED_SESSION_ID": "l3-thunar-launcher"},
        process_records=process_records,
        process_ref=process_ref,
        timeout_seconds=3.0,
    )

    assert process is None
    assert runner.commands == [["/usr/bin/thunar", str(tmp_path / "filesystem-root")]]
    assert process_records[0]["status"] == "launcher-completed"
    assert process_records[0]["returncode"] == 0
    assert process_records[0]["processKind"] == "delegating-launcher-or-file-manager"


def test_l3_file_preview_file_manager_quick_failure_blocks(tmp_path):
    process_records = []
    process_ref = tmp_path / "backend-processes.json"
    runner = _PopenOnlyCommandRunner(returncode=2)

    with pytest.raises(Exception, match="file-preview process exited"):
        _start_l3_file_preview_process(
            command_runner=runner,
            runtime_components={"filePreviewTool": {"command": "nautilus", "path": "/usr/bin/nautilus"}},
            filesystem_root=tmp_path / "filesystem-root",
            env={"DISPLAY": ":131", "SCIFORGE_ISOLATED_SESSION_ID": "l3-nautilus-failed"},
            process_records=process_records,
            process_ref=process_ref,
            timeout_seconds=3.0,
        )

    assert process_records[0]["status"] == "launcher-failed"
    assert process_records[0]["returncode"] == 2
    payload = _read_test_json(process_ref)
    assert payload["processes"][0]["status"] == "launcher-failed"


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


class _RunOnlyCommandRunner:
    def __init__(self, *, returncode=0, stdout="", stderr=""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr
        self.commands = []

    def run(self, args, *, env=None, timeout=None):
        self.commands.append(list(args))
        return subprocess.CompletedProcess(list(args), self.returncode, self.stdout, self.stderr)


class _PopenOnlyCommandRunner:
    def __init__(self, *, returncode=None, pid=4800):
        self.returncode = returncode
        self.pid = pid
        self.commands = []

    def popen(self, args, *, env=None, stdout=None, stderr=None):
        self.commands.append(list(args))
        return _FakeProcess(returncode=self.returncode, pid=self.pid)


class _FakeProcess:
    def __init__(self, *, returncode=None, pid=4800):
        self.returncode = returncode
        self.pid = pid

    def poll(self):
        return self.returncode


def _fake_l3_partial_same_session_runner(*args, **kwargs):
    context = {}
    for arg in args:
        if isinstance(arg, Mapping):
            context.update(arg)
        elif isinstance(arg, (str, Path)) and "output_dir" not in context:
            context["output_dir"] = arg
    context.update(kwargs)
    root_value = context.get("output_dir") or context.get("root") or context.get("run_dir")
    assert root_value is not None, "partial_runner must receive an output_dir/root/run_dir context"
    root = Path(root_value).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)

    session_id = context.get("session_id") or "l3-partial-session-001"
    display = context.get("display") or ":128"
    vnc_port = int(context.get("vnc_port") or 21128)
    novnc_port = int(context.get("novnc_port") or 22128)
    session_ref = root / "partial-session-manifest.json"
    virtual_display_ref = root / "partial-virtual-display.json"
    capture_stream_ref = root / "partial-capture-stream.json"
    replay_bundle_ref = root / "partial-replay-bundle.json"
    novnc_viewer_ref = root / "partial-novnc-viewer.json"
    process_ref = root / "partial-backend-processes.json"
    resource_allocation_ref = Path(context.get("resource_allocation_ref") or root / "partial-resource-allocation.json")
    backend_readiness_ref = root / "partial-backend-readiness-proof.json"
    executor_command_log_ref = root / "partial-l3-executor-command-events.json"
    partial_run_ref = root / "isolated-desktop-l3-partial-run.json"

    process_records = _partial_process_records(
        root=root,
        display=display,
        session_id=session_id,
    )
    _write_test_json(
        session_ref,
        {
            "schemaVersion": "sciforge.computer-use.virtual-desktop-session.v1",
            "status": "open",
            "sessionId": session_id,
            "backend": {"kind": BACKEND_KIND, "status": "running", "noVncBackendStarted": True},
            "refs": {
                "virtualDisplayRef": str(virtual_display_ref),
                "captureStreamRef": str(capture_stream_ref),
                "replayBundleRef": str(replay_bundle_ref),
                "noVncViewerRef": str(novnc_viewer_ref),
                "processRef": str(process_ref),
                "resourceAllocationRef": str(resource_allocation_ref),
            },
            "diagnosticOnly": True,
            "realWindowEvidence": True,
        },
    )
    _write_test_json(
        virtual_display_ref,
        {
            "schemaVersion": "sciforge.computer-use.virtual-display-ref.v1",
            "status": "running",
            "display": display,
            "sessionId": session_id,
            "viewport": {"width": 1280, "height": 720},
            "sharedSystemInputUsed": False,
        },
    )
    _write_test_json(
        capture_stream_ref,
        {
            "schemaVersion": "sciforge.computer-use.capture-stream-ref.v1",
            "status": "running",
            "captureSource": "novnc-isolated-desktop",
            "display": display,
            "sessionId": session_id,
            "frameRefs": [],
        },
    )
    _write_test_json(
        replay_bundle_ref,
        {
            "schemaVersion": "sciforge.computer-use.replay-bundle-ref.v1",
            "status": "running",
            "display": display,
            "sessionId": session_id,
            "timelineRefs": [],
        },
    )
    _write_test_json(
        novnc_viewer_ref,
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
    _write_test_json(
        process_ref,
        {
            "schemaVersion": "sciforge.computer-use.backend-processes.v1",
            "display": display,
            "sessionId": session_id,
            "processes": process_records,
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
        },
    )
    _write_test_json(
        resource_allocation_ref,
        {
            "schemaVersion": ISOLATED_RUNTIME_RESOURCE_ALLOCATION_SCHEMA_VERSION,
            "status": "allocated",
            "display": display,
            "sessionId": session_id,
            "vncPort": vnc_port,
            "novncPort": novnc_port,
            "localhostOnly": True,
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
        },
    )
    _write_test_json(
        backend_readiness_ref,
        {
            "schemaVersion": BACKEND_READINESS_PROOF_SCHEMA_VERSION,
            "status": "ready",
            "backendKind": BACKEND_KIND,
            "display": display,
            "localhostOnly": True,
            "xDisplay": {"display": display, "ready": True},
            "vnc": {"host": "127.0.0.1", "port": vnc_port, "ready": True},
            "novnc": {
                "host": "127.0.0.1",
                "port": novnc_port,
                "ready": True,
                "viewerPath": "/vnc.html",
            },
            "processRef": str(process_ref),
            "processRoles": [record["role"] for record in process_records],
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
        },
    )
    _write_test_json(
        executor_command_log_ref,
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

    payload = {
        "schemaVersion": "sciforge.computer-use.isolated-desktop-l3-partial-run.v1",
        "status": "blocked",
        "blockedStage": "l3-workflow-actions-not-completed",
        "workflowStatus": "runtime-ready-actions-blocked",
        "sameVirtualSession": True,
        "realWindowEvidence": True,
        "runAttempted": True,
        "realRunnerImplemented": True,
        "completionEvidenceRef": None,
        "partialRunRef": str(partial_run_ref),
        "sessionManifestRef": str(session_ref),
        "virtualDisplayRef": str(virtual_display_ref),
        "captureStreamRef": str(capture_stream_ref),
        "replayBundleRef": str(replay_bundle_ref),
        "filesystemRootRef": str(root),
        "noVncViewerRef": str(novnc_viewer_ref),
        "processRef": str(process_ref),
        "resourceAllocationRef": str(resource_allocation_ref),
        "backendReadinessProofRef": str(backend_readiness_ref),
        "executorCommandEventLogRef": str(executor_command_log_ref),
        "diagnosticOnly": True,
        "userAcceptanceEligible": False,
    }
    _write_test_json(partial_run_ref, payload)
    return payload


def _partial_process_records(*, root, display, session_id):
    records = []
    for index, role in enumerate([
        "virtual-display",
        "window-manager",
        "vnc-server",
        "novnc-proxy",
        "source-reader",
        "document-writer",
        "file-preview",
    ], start=1):
        stdout_ref = root / f"{role}-stdout.log"
        stderr_ref = root / f"{role}-stderr.log"
        stdout_ref.write_text("", encoding="utf8")
        stderr_ref.write_text("", encoding="utf8")
        records.append({
            "role": role,
            "pid": 4100 + index,
            "display": display,
            "sessionId": session_id,
            "status": "running",
            "stdoutLogRef": str(stdout_ref),
            "stderrLogRef": str(stderr_ref),
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
        })
    return records


def _assert_l3_partial_refs_share_session_and_display(manifest):
    refs = manifest["partialRuntimeRefs"]["refs"]
    session = _read_test_json(refs["sessionManifestRef"])
    display = _read_test_json(refs["virtualDisplayRef"])
    capture = _read_test_json(refs["captureStreamRef"])
    viewer = _read_test_json(refs["noVncViewerRef"])
    processes = _read_test_json(refs["processRef"])
    allocation = _read_test_json(refs["resourceAllocationRef"])
    readiness = _read_test_json(refs["backendReadinessProofRef"])
    command_log = _read_test_json(refs["executorCommandEventLogRef"])
    session_id = session["sessionId"]
    display_name = display["display"]

    assert display["sessionId"] == session_id
    assert capture["sessionId"] == session_id
    assert capture["display"] == display_name
    assert viewer["sessionId"] == session_id
    assert viewer["localhostOnly"] is True
    assert processes["sessionId"] == session_id
    assert processes["display"] == display_name
    assert allocation["sessionId"] == session_id
    assert allocation["display"] == display_name
    assert allocation["localhostOnly"] is True
    assert readiness["status"] == "ready"
    assert readiness["display"] == display_name
    assert readiness["processRef"] == refs["processRef"]
    assert command_log["schemaVersion"] == EXECUTOR_COMMAND_EVENT_LOG_SCHEMA
    assert command_log["eventCount"] == 0
    assert command_log["events"] == []
    assert command_log["workflowInputExecuted"] is False

    roles = {record["role"] for record in processes["processes"]}
    assert {"source-reader", "document-writer", "file-preview"} <= roles
    for record in processes["processes"]:
        assert record["sessionId"] == session_id
        assert record["display"] == display_name
        assert Path(record["stdoutLogRef"]).is_file()
        assert Path(record["stderrLogRef"]).is_file()


def _assert_l3_partial_refs_only_in_partial_manifest_namespaces(manifest):
    partial_values = {manifest["partialRunRef"]}
    partial_values.update(manifest["partialRuntimeRefs"]["refs"].values())
    partial_values.update(manifest["partialRuntimeRefs"].get("screenshotRefs") or [])
    partial_values = {value for value in partial_values if isinstance(value, str) and value}
    assert partial_values

    leaks = []
    allowed_roots = {("partialRunRef",), ("partialRuntimeRefs",)}

    def visit(value, path):
        if any(path[: len(root)] == root for root in allowed_roots):
            return
        if isinstance(value, str) and value in partial_values:
            leaks.append(".".join(path))
        elif isinstance(value, Mapping):
            for key, child in value.items():
                visit(child, (*path, str(key)))
        elif isinstance(value, list):
            for index, child in enumerate(value):
                visit(child, (*path, str(index)))

    visit(manifest, ())
    assert leaks == []


def _write_test_json(path, payload):
    Path(path).write_text(f"{json.dumps(payload, indent=2, sort_keys=True)}\n", encoding="utf8")


def _read_test_json(path):
    return json.loads(Path(path).read_text(encoding="utf8"))
