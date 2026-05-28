import inspect
import json
import os
import subprocess
import sys
from pathlib import Path
import hashlib

import pytest

from sciforge_computer_use.isolated_desktop_contracts import (
    EXECUTOR_COMMAND_EVENT_LOG_SCHEMA,
    ISOLATED_RUNTIME_RESOURCE_ALLOCATION_SCHEMA_VERSION,
    ISOLATED_TARGET_WINDOW_SCHEMA_VERSION,
    REMOTE_DESKTOP_INPUT_CHANNEL,
)
from sciforge_computer_use.isolated_desktop_l1_smoke_probe import (
    ISOLATED_DESKTOP_L1_SMOKE_PROBE_SCHEMA,
    MANIFEST_NAME,
    REQUIRED_L1_RUNTIME_COMPONENTS,
    _browser_command,
    _run_real_l1_smoke,
    build_isolated_desktop_l1_smoke_probe_manifest,
)
from sciforge_computer_use.isolated_desktop_l1_smoke_evidence import (
    validate_isolated_desktop_l1_smoke_evidence,
)
from sciforge_computer_use.isolated_desktop_runtime import (
    DEFAULT_VIEWPORT,
    L1_VIEWPORT,
    IsolatedDesktopL1SmokeRunFailed,
    IsolatedDesktopResourceLease,
    IsolatedDesktopRunFailed,
    L1RuntimeResourceLease,
    allocate_isolated_runtime_resources,
)


PACKAGE_ROOT = Path(__file__).resolve().parents[1]


def test_l1_smoke_probe_blocks_without_linux_backend_or_runtime_components(tmp_path):
    manifest = build_isolated_desktop_l1_smoke_probe_manifest(
        output_dir=tmp_path / "l1",
        platform_system="Darwin",
        command_resolver=lambda _command: None,
        path_exists=lambda _path: False,
    )

    assert manifest["schemaVersion"] == ISOLATED_DESKTOP_L1_SMOKE_PROBE_SCHEMA
    assert manifest["status"] == "blocked"
    assert manifest["diagnosticOnly"] is True
    assert manifest["realWindowEvidence"] is False
    assert manifest["inputExecuted"] is False
    assert manifest["sharedSystemInputUsed"] is False
    assert manifest["systemPointerMoved"] is False
    assert manifest["systemKeyboardEventsSent"] is False
    assert manifest["l1Smoke"]["completed"] is False
    assert manifest["userAcceptanceEligible"] is False
    assert manifest["readinessOnly"] is True
    assert manifest["runAttempted"] is False
    assert manifest["completionEvidenceRef"] is None
    assert manifest["inputChannel"] == REMOTE_DESKTOP_INPUT_CHANNEL
    assert "builder" in manifest["evidenceContract"]
    assert Path(manifest["manifestRef"]).name == MANIFEST_NAME
    assert Path(manifest["manifestRef"]).is_file()
    assert Path(manifest["backendReadinessRef"]).is_file()


def test_l1_smoke_probe_still_blocks_when_dependencies_exist_until_real_runner_is_wired(tmp_path):
    command_paths = {
        "Xvfb": "/usr/bin/Xvfb",
        "openbox": "/usr/bin/openbox",
        "x11vnc": "/usr/bin/x11vnc",
        "websockify": "/usr/bin/websockify",
        "libreoffice": "/usr/bin/libreoffice",
        "chromium": "/usr/bin/chromium",
        "xdotool": "/usr/bin/xdotool",
        "import": "/usr/bin/import",
    }
    manifest = build_isolated_desktop_l1_smoke_probe_manifest(
        output_dir=tmp_path / "l1",
        execute=True,
        platform_system="Linux",
        command_resolver=lambda command: command_paths.get(command),
        path_exists=lambda path: path == "/usr/share/novnc",
        command_runner=FailingCommandRunner(),
        port_probe=lambda _host, _port, _timeout: True,
        http_probe=fake_http_viewer_probe,
    )

    assert manifest["status"] == "blocked"
    assert manifest["backendReadinessStatus"] == "ready"
    assert manifest["commandPlan"]["executeRequested"] is True
    assert manifest["observedRuntimeComponents"]["isolatedInputTool"]["path"] == "/usr/bin/xdotool"
    assert manifest["observedRuntimeComponents"]["screenshotTool"]["path"] == "/usr/bin/import"
    assert manifest["requiredRuntimeComponents"].keys() == REQUIRED_L1_RUNTIME_COMPONENTS.keys()
    assert manifest["runAttempted"] is True
    assert any("capture-screenshot command failed" in reason for reason in manifest["blockedReasons"])
    assert manifest["l1Smoke"]["status"] == "not-run"
    assert manifest["projectClaimLimit"]


def test_l1_smoke_probe_completes_with_isolated_linux_runner_contract(tmp_path):
    command_paths = {
        "Xvfb": "/usr/bin/Xvfb",
        "openbox": "/usr/bin/openbox",
        "x11vnc": "/usr/bin/x11vnc",
        "websockify": "/usr/bin/websockify",
        "libreoffice": "/usr/bin/libreoffice",
        "chromium": "/usr/bin/chromium",
        "xdotool": "/usr/bin/xdotool",
        "import": "/usr/bin/import",
    }
    runner = FakeCommandRunner()

    manifest = build_isolated_desktop_l1_smoke_probe_manifest(
        output_dir=tmp_path / "l1",
        execute=True,
        platform_system="Linux",
        command_resolver=lambda command: command_paths.get(command),
        path_exists=lambda path: path == "/usr/share/novnc",
        command_runner=runner,
        sleep=lambda _seconds: None,
        display=":77",
        vnc_port=5917,
        novnc_port=6097,
        port_probe=lambda _host, _port, _timeout: True,
        http_probe=fake_http_viewer_probe,
    )

    assert manifest["status"] == "completed"
    assert manifest["readinessOnly"] is False
    assert manifest["runAttempted"] is True
    assert manifest["userAcceptanceEligible"] is True
    assert manifest["diagnosticOnly"] is False
    assert manifest["realWindowEvidence"] is True
    assert manifest["inputExecuted"] is True
    assert manifest["sharedSystemInputUsed"] is False
    assert Path(manifest["completionEvidenceRef"]).is_file()
    assert len(manifest["screenshotRefs"]) >= 5
    assert all(Path(ref).is_file() for ref in manifest["screenshotRefs"])
    assert validate_isolated_desktop_l1_smoke_evidence(manifest["completionEvidenceRef"])["ok"] is True
    assert Path(manifest["backendReadinessProofRef"]).is_file()
    readiness_proof = json.loads(Path(manifest["backendReadinessProofRef"]).read_text(encoding="utf8"))
    allocation = json.loads(Path(manifest["resourceAllocationRef"]).read_text(encoding="utf8"))
    process_payload = json.loads(Path(manifest["processRef"]).read_text(encoding="utf8"))
    session_manifest = json.loads(Path(manifest["sessionManifestRef"]).read_text(encoding="utf8"))
    assert allocation["sessionId"] == session_manifest["sessionId"]
    assert process_payload["sessionId"] == session_manifest["sessionId"]
    assert all(process["sessionId"] == session_manifest["sessionId"] for process in process_payload["processes"])
    assert readiness_proof["status"] == "ready"
    assert readiness_proof["xDisplay"]["ready"] is True
    assert readiness_proof["xDisplay"]["width"] == 1280
    assert readiness_proof["xDisplay"]["height"] == 720
    assert readiness_proof["novnc"]["httpViewer"]["ready"] is True
    assert readiness_proof["novnc"]["httpViewer"]["statusCode"] == 200
    assert readiness_proof["novnc"]["httpViewer"]["sha256"] == fake_http_viewer_sha256()
    assert readiness_proof["desktopWindow"]["ready"] is True
    assert readiness_proof["desktopWindow"]["windowId"] == "1001"
    assert readiness_proof["page"]["ready"] is True
    assert readiness_proof["page"]["readinessStrategy"] == "window-title-marker"
    assert Path(manifest["targetWindowRef"]).is_file()
    target_window = json.loads(Path(manifest["targetWindowRef"]).read_text(encoding="utf8"))
    assert target_window["schemaVersion"] == ISOLATED_TARGET_WINDOW_SCHEMA_VERSION
    assert Path(manifest["windowBoundPointerProofRef"]).is_file()
    pointer_proof = json.loads(Path(manifest["windowBoundPointerProofRef"]).read_text(encoding="utf8"))
    assert pointer_proof["pointerActions"][0]["pointInsideTargetBounds"] is True
    button_action = pointer_proof["pointerActions"][1]
    assert button_action["targetId"] == "l1-button"
    assert button_action["hitPointInWindow"] == {"x": 90, "y": 207}
    assert button_action["targetBoundsInWindow"] == {"x": 48, "y": 176, "width": 96, "height": 64}
    pointer_calls = [call["args"] for call in runner.run_calls if call["args"][:2] == ["/usr/bin/xdotool", "mousemove"]]
    assert pointer_calls
    assert all("--window" in call and "1001" in call for call in pointer_calls)
    assert not any(call[:5] == ["/usr/bin/xdotool", "mousemove", "180", "155", "click"] for call in pointer_calls)
    assert Path(manifest["executorCommandEventLogRef"]).is_file()
    command_log = json.loads(Path(manifest["executorCommandEventLogRef"]).read_text(encoding="utf8"))
    assert command_log["schemaVersion"] == EXECUTOR_COMMAND_EVENT_LOG_SCHEMA
    assert command_log["eventCount"] == 3
    assert [event["actionIndex"] for event in command_log["events"]] == [1, 2, 3]
    assert {event["inputModality"] for event in command_log["events"]} == {"pointer", "keyboard"}
    input_log = json.loads(Path(manifest["inputEventLogRef"]).read_text(encoding="utf8"))
    assert all(event["commandEventId"] for event in input_log["events"])
    assert all(event["commandEventLogRef"] == manifest["executorCommandEventLogRef"] for event in input_log["events"])
    session_manifest = json.loads(Path(manifest["sessionManifestRef"]).read_text(encoding="utf8"))
    novnc_viewer = json.loads(Path(manifest["noVncViewerRef"]).read_text(encoding="utf8"))
    process_manifest = json.loads(Path(manifest["processRef"]).read_text(encoding="utf8"))
    assert session_manifest["status"] == "closed"
    assert session_manifest["closedAfterRun"] is True
    assert novnc_viewer["status"] == "closed"
    assert novnc_viewer["liveDuringRun"] is True
    assert {process["status"] for process in process_manifest["processes"]} == {"stopped"}
    assert all(Path(process["stdoutLogRef"]).is_file() for process in process_manifest["processes"])
    assert all(Path(process["stderrLogRef"]).is_file() for process in process_manifest["processes"])
    assert manifest["commandPlan"]["runnerOptions"] == {
        "display": ":77",
        "vncPort": 5917,
        "novncPort": 6097,
        "timeoutSeconds": 20.0,
        "resourceLockRoot": None,
    }
    assert any(call["args"][0] == "/usr/bin/xdotool" for call in runner.run_calls)
    assert all(call["env"].get("DISPLAY") == ":77" for call in runner.run_calls)
    assert all(call["env"].get("HOME", "").startswith(str(tmp_path / "l1")) for call in runner.run_calls)


def test_l1_smoke_probe_resets_run_owned_session_state_before_execute(tmp_path):
    command_paths = {
        "Xvfb": "/usr/bin/Xvfb",
        "openbox": "/usr/bin/openbox",
        "x11vnc": "/usr/bin/x11vnc",
        "websockify": "/usr/bin/websockify",
        "libreoffice": "/usr/bin/libreoffice",
        "chromium": "/usr/bin/chromium",
        "xdotool": "/usr/bin/xdotool",
        "import": "/usr/bin/import",
    }
    root = tmp_path / "l1"
    stale_profile_lock = root / "isolated-l1-session" / "filesystem-root" / "browser-profile" / "SingletonLock"
    stale_profile_lock.parent.mkdir(parents=True, exist_ok=True)
    stale_profile_lock.write_text("stale chromium profile lock", encoding="utf8")
    stale_viewer_file = root / "visible-run-viewer" / "stale.html"
    stale_viewer_file.parent.mkdir(parents=True, exist_ok=True)
    stale_viewer_file.write_text("stale viewer", encoding="utf8")

    manifest = build_isolated_desktop_l1_smoke_probe_manifest(
        output_dir=root,
        execute=True,
        platform_system="Linux",
        command_resolver=lambda command: command_paths.get(command),
        path_exists=lambda path: path == "/usr/share/novnc",
        command_runner=FakeCommandRunner(),
        sleep=lambda _seconds: None,
        display=":77",
        vnc_port=5917,
        novnc_port=6097,
        port_probe=lambda _host, _port, _timeout: True,
        http_probe=fake_http_viewer_probe,
    )

    assert manifest["status"] == "completed"
    assert not stale_profile_lock.exists()
    assert not stale_viewer_file.exists()


def test_l1_smoke_probe_allocates_unoccupied_display_and_ports_by_default(tmp_path):
    command_paths = {
        "Xvfb": "/usr/bin/Xvfb",
        "openbox": "/usr/bin/openbox",
        "x11vnc": "/usr/bin/x11vnc",
        "websockify": "/usr/bin/websockify",
        "libreoffice": "/usr/bin/libreoffice",
        "chromium": "/usr/bin/chromium",
        "xdotool": "/usr/bin/xdotool",
        "import": "/usr/bin/import",
    }
    busy_paths = {"/tmp/.X90-lock", "/tmp/.X11-unix/X91"}
    busy_ports = {5900, 6080}
    runner = FakeCommandRunner()

    manifest = build_isolated_desktop_l1_smoke_probe_manifest(
        output_dir=tmp_path / "l1",
        execute=True,
        platform_system="Linux",
        command_resolver=lambda command: command_paths.get(command),
        path_exists=lambda path: path == "/usr/share/novnc" or path in busy_paths,
        command_runner=runner,
        sleep=lambda _seconds: None,
        port_available=lambda port: port not in busy_ports,
        resource_lock_root=tmp_path / "locks",
        display_candidates=(90, 91, 92),
        vnc_port_candidates=(5900, 5901),
        novnc_port_candidates=(6080, 6081),
        port_probe=lambda _host, _port, _timeout: True,
        http_probe=fake_http_viewer_probe,
    )

    assert manifest["status"] == "completed"
    assert manifest["display"] == ":92"
    assert manifest["vncPort"] == 5901
    assert manifest["novncPort"] == 6081
    assert Path(manifest["resourceAllocationRef"]).is_file()
    allocation = json.loads(Path(manifest["resourceAllocationRef"]).read_text(encoding="utf8"))
    assert allocation["schemaVersion"] == ISOLATED_RUNTIME_RESOURCE_ALLOCATION_SCHEMA_VERSION
    assert allocation["status"] == "released-after-run"
    assert allocation["display"] == ":92"
    assert allocation["vncPort"] == 5901
    assert allocation["novncPort"] == 6081
    assert allocation["sessionId"]
    assert all(call["env"].get("DISPLAY") == ":92" for call in runner.run_calls)


def test_isolated_runtime_resource_allocator_has_generic_compatibility_aliases(tmp_path, monkeypatch):
    lock_root = tmp_path / "generic-locks"
    monkeypatch.setenv("SCIFORGE_COMPUTER_USE_RESOURCE_LOCK_DIR", str(lock_root))
    monkeypatch.setenv("SCIFORGE_COMPUTER_USE_L1_LOCK_DIR", str(tmp_path / "legacy-locks"))

    lease = allocate_isolated_runtime_resources(
        root=tmp_path / "runtime",
        requested_display=None,
        requested_vnc_port=None,
        requested_novnc_port=None,
        path_exists=lambda _path: False,
        port_available=lambda _port: True,
        resource_lock_root=None,
        display_candidates=(101,),
        vnc_port_candidates=(25000,),
        novnc_port_candidates=(25001,),
    )

    assert isinstance(lease, IsolatedDesktopResourceLease)
    assert isinstance(lease, L1RuntimeResourceLease)
    assert IsolatedDesktopL1SmokeRunFailed is IsolatedDesktopRunFailed
    assert DEFAULT_VIEWPORT is L1_VIEWPORT
    assert lease.summary()["schemaVersion"] == ISOLATED_RUNTIME_RESOURCE_ALLOCATION_SCHEMA_VERSION
    assert all(str(ref).startswith(str(lock_root)) for ref in lease.lock_refs)
    lease.release()


def test_l1_smoke_probe_blocks_when_runtime_resources_cannot_be_allocated(tmp_path):
    command_paths = {
        "Xvfb": "/usr/bin/Xvfb",
        "openbox": "/usr/bin/openbox",
        "x11vnc": "/usr/bin/x11vnc",
        "websockify": "/usr/bin/websockify",
        "libreoffice": "/usr/bin/libreoffice",
        "chromium": "/usr/bin/chromium",
        "xdotool": "/usr/bin/xdotool",
        "import": "/usr/bin/import",
    }
    runner = FakeCommandRunner()

    manifest = build_isolated_desktop_l1_smoke_probe_manifest(
        output_dir=tmp_path / "l1",
        execute=True,
        platform_system="Linux",
        command_resolver=lambda command: command_paths.get(command),
        path_exists=lambda path: path == "/usr/share/novnc",
        command_runner=runner,
        display=":77",
        vnc_port=5917,
        novnc_port=6097,
        port_available=lambda _port: False,
        resource_lock_root=tmp_path / "locks",
        port_probe=lambda _host, _port, _timeout: True,
    )

    assert manifest["status"] == "blocked"
    assert any("Unable to allocate an isolated display" in reason for reason in manifest["blockedReasons"])
    assert manifest["runDiagnostics"]["runAttempted"] is False
    assert Path(manifest["runDiagnostics"]["resourceAllocationRef"]).is_file()
    assert not runner.popen_calls


def test_l1_smoke_probe_blocks_when_backend_process_exits_before_ready(tmp_path):
    command_paths = {
        "Xvfb": "/usr/bin/Xvfb",
        "openbox": "/usr/bin/openbox",
        "x11vnc": "/usr/bin/x11vnc",
        "websockify": "/usr/bin/websockify",
        "libreoffice": "/usr/bin/libreoffice",
        "chromium": "/usr/bin/chromium",
        "xdotool": "/usr/bin/xdotool",
        "import": "/usr/bin/import",
    }

    manifest = build_isolated_desktop_l1_smoke_probe_manifest(
        output_dir=tmp_path / "l1",
        execute=True,
        platform_system="Linux",
        command_resolver=lambda command: command_paths.get(command),
        path_exists=lambda path: path == "/usr/share/novnc",
        command_runner=ExitingCommandRunner(exit_role="/usr/bin/Xvfb"),
        sleep=lambda _seconds: None,
        port_probe=lambda _host, _port, _timeout: True,
    )

    assert manifest["status"] == "blocked"
    assert manifest["runAttempted"] is True
    assert any("virtual-display process exited before" in reason for reason in manifest["blockedReasons"])
    assert manifest["runDiagnostics"]["processRef"]


def test_l1_smoke_probe_blocks_when_vnc_ports_never_become_ready(tmp_path):
    command_paths = {
        "Xvfb": "/usr/bin/Xvfb",
        "openbox": "/usr/bin/openbox",
        "x11vnc": "/usr/bin/x11vnc",
        "websockify": "/usr/bin/websockify",
        "libreoffice": "/usr/bin/libreoffice",
        "chromium": "/usr/bin/chromium",
        "xdotool": "/usr/bin/xdotool",
        "import": "/usr/bin/import",
    }

    manifest = build_isolated_desktop_l1_smoke_probe_manifest(
        output_dir=tmp_path / "l1",
        execute=True,
        platform_system="Linux",
        command_resolver=lambda command: command_paths.get(command),
        path_exists=lambda path: path == "/usr/share/novnc",
        command_runner=FakeCommandRunner(),
        sleep=lambda _seconds: None,
        timeout_seconds=0.01,
        port_probe=lambda _host, _port, _timeout: False,
    )

    assert manifest["status"] == "blocked"
    assert manifest["runAttempted"] is True
    assert any("did not expose localhost TCP port" in reason for reason in manifest["blockedReasons"])


def test_l1_smoke_probe_blocks_when_x_display_is_not_queryable(tmp_path):
    command_paths = {
        "Xvfb": "/usr/bin/Xvfb",
        "openbox": "/usr/bin/openbox",
        "x11vnc": "/usr/bin/x11vnc",
        "websockify": "/usr/bin/websockify",
        "libreoffice": "/usr/bin/libreoffice",
        "chromium": "/usr/bin/chromium",
        "xdotool": "/usr/bin/xdotool",
        "import": "/usr/bin/import",
    }

    runner = XDisplayFailingCommandRunner()
    manifest = build_isolated_desktop_l1_smoke_probe_manifest(
        output_dir=tmp_path / "l1",
        execute=True,
        platform_system="Linux",
        command_resolver=lambda command: command_paths.get(command),
        path_exists=lambda path: path == "/usr/share/novnc",
        command_runner=runner,
        sleep=lambda _seconds: None,
        timeout_seconds=0.01,
        port_probe=lambda _host, _port, _timeout: True,
        http_probe=fake_http_viewer_probe,
    )

    assert manifest["status"] == "blocked"
    assert manifest["runAttempted"] is True
    assert any("did not expose a queryable isolated X display" in reason for reason in manifest["blockedReasons"])
    assert not any(call["args"][0] == "/usr/bin/import" for call in runner.run_calls)


def test_l1_smoke_probe_blocks_when_novnc_http_viewer_is_not_ready(tmp_path):
    command_paths = {
        "Xvfb": "/usr/bin/Xvfb",
        "openbox": "/usr/bin/openbox",
        "x11vnc": "/usr/bin/x11vnc",
        "websockify": "/usr/bin/websockify",
        "libreoffice": "/usr/bin/libreoffice",
        "chromium": "/usr/bin/chromium",
        "xdotool": "/usr/bin/xdotool",
        "import": "/usr/bin/import",
    }

    manifest = build_isolated_desktop_l1_smoke_probe_manifest(
        output_dir=tmp_path / "l1",
        execute=True,
        platform_system="Linux",
        command_resolver=lambda command: command_paths.get(command),
        path_exists=lambda path: path == "/usr/share/novnc",
        command_runner=FakeCommandRunner(),
        sleep=lambda _seconds: None,
        port_probe=lambda _host, _port, _timeout: True,
        http_probe=lambda url, _timeout: {
            "ok": False,
            "ready": False,
            "method": "GET",
            "url": url,
            "localhostOnly": True,
            "statusCode": 404,
            "rawPayloadWritten": False,
        },
    )

    assert manifest["status"] == "blocked"
    assert manifest["runAttempted"] is True
    assert any("did not serve localhost noVNC viewer" in reason for reason in manifest["blockedReasons"])
    assert manifest["completionEvidenceRef"] is None


def test_l1_smoke_probe_blocks_when_browser_page_is_not_ready(tmp_path):
    command_paths = {
        "Xvfb": "/usr/bin/Xvfb",
        "openbox": "/usr/bin/openbox",
        "x11vnc": "/usr/bin/x11vnc",
        "websockify": "/usr/bin/websockify",
        "libreoffice": "/usr/bin/libreoffice",
        "chromium": "/usr/bin/chromium",
        "xdotool": "/usr/bin/xdotool",
        "import": "/usr/bin/import",
    }
    runner = BrowserWindowFailingCommandRunner()

    manifest = build_isolated_desktop_l1_smoke_probe_manifest(
        output_dir=tmp_path / "l1",
        execute=True,
        platform_system="Linux",
        command_resolver=lambda command: command_paths.get(command),
        path_exists=lambda path: path == "/usr/share/novnc",
        command_runner=runner,
        sleep=lambda _seconds: None,
        timeout_seconds=0.01,
        port_probe=lambda _host, _port, _timeout: True,
        http_probe=fake_http_viewer_probe,
    )

    assert manifest["status"] == "blocked"
    assert any("did not expose ready visible window title" in reason for reason in manifest["blockedReasons"])
    assert not any(call["args"][:2] == ["/usr/bin/xdotool", "mousemove"] for call in runner.run_calls)


def test_l1_smoke_probe_manifest_cannot_validate_as_completed_l1_evidence(tmp_path):
    manifest = build_isolated_desktop_l1_smoke_probe_manifest(
        output_dir=tmp_path / "l1",
        platform_system="Linux",
        command_resolver=lambda _command: None,
        path_exists=lambda _path: False,
    )

    validation = validate_isolated_desktop_l1_smoke_evidence(manifest)
    codes = {error["code"] for error in validation["errors"]}

    assert validation["ok"] is False
    assert "unsupported_schema_version" in codes
    assert "status_not_completed" in codes
    assert "l1_smoke_not_completed" in codes


def test_l1_smoke_probe_cli_writes_blocked_manifest(tmp_path):
    output_dir = tmp_path / "l1"
    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "sciforge_computer_use.isolated_desktop_l1_smoke_probe",
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
    assert payload["schemaVersion"] == ISOLATED_DESKTOP_L1_SMOKE_PROBE_SCHEMA
    assert payload["status"] == "blocked"
    assert (output_dir / MANIFEST_NAME).is_file()


def test_l1_smoke_probe_cli_records_runner_options(tmp_path):
    output_dir = tmp_path / "l1"
    lock_root = tmp_path / "locks"
    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "sciforge_computer_use.isolated_desktop_l1_smoke_probe",
            "--output-dir",
            str(output_dir),
            "--display",
            ":88",
            "--vnc-port",
            "5922",
            "--novnc-port",
            "6102",
            "--timeout-seconds",
            "7.5",
            "--resource-lock-root",
            str(lock_root),
        ],
        cwd=PACKAGE_ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )

    assert completed.returncode == 1
    payload = json.loads(completed.stdout)
    assert payload["status"] == "blocked"
    assert payload["commandPlan"]["runnerOptions"] == {
        "display": ":88",
        "vncPort": 5922,
        "novncPort": 6102,
        "timeoutSeconds": 7.5,
        "resourceLockRoot": str(lock_root),
    }


def test_l1_smoke_probe_execute_real_linux_backend_when_explicitly_enabled(tmp_path):
    if os.environ.get("SCIFORGE_RUN_REAL_L1_SMOKE") != "1":
        pytest.skip("Set SCIFORGE_RUN_REAL_L1_SMOKE=1 on a Linux host with noVNC/Xvfb/browser deps to run.")

    output_dir = tmp_path / "real-l1"
    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "sciforge_computer_use.isolated_desktop_l1_smoke_probe",
            "--output-dir",
            str(output_dir),
            "--execute",
            "--timeout-seconds",
            os.environ.get("SCIFORGE_RUN_REAL_L1_SMOKE_TIMEOUT", "30"),
        ],
        cwd=PACKAGE_ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    payload = json.loads(completed.stdout)
    if payload.get("status") != "completed":
        pytest.skip(f"Real L1 smoke dependencies not ready: {payload.get('blockedReasons') or payload.get('reason')}")

    assert completed.returncode == 0
    assert payload["readinessOnly"] is False
    assert payload["runAttempted"] is True
    assert payload["userAcceptanceEligible"] is True
    assert validate_isolated_desktop_l1_smoke_evidence(payload["completionEvidenceRef"])["ok"] is True


def test_l1_smoke_browser_command_adds_container_safe_chromium_flags(tmp_path, monkeypatch):
    monkeypatch.setattr("os.geteuid", lambda: 0)
    args = _browser_command(
        {"path": "/usr/bin/chromium", "command": "chromium"},
        smoke_page_ref=tmp_path / "l1-smoke.html",
        profile_dir=tmp_path / "profile",
    )

    assert "--no-sandbox" in args
    assert "--test-type" in args
    assert "--no-default-browser-check" in args
    assert "--disable-background-networking" in args
    assert "--disable-features=TranslateUI" in args
    assert any(arg.startswith("--app=file://") for arg in args)


def test_l1_smoke_real_runner_does_not_cap_readiness_waits_at_five_seconds():
    source = inspect.getsource(_run_real_l1_smoke)

    assert "timeout_seconds=min(timeout_seconds, 5.0)" not in source


def test_l1_smoke_page_click_focus_visibly_changes_page(tmp_path):
    from sciforge_computer_use.isolated_desktop_l1_smoke_probe import _write_smoke_page

    page = _write_smoke_page(tmp_path)
    html = page.read_text(encoding="utf8")

    assert "autofocus" not in html
    assert "Input focused through isolated pointer" in html
    assert "input:focus" in html


class FakeProcess:
    pid = 4242

    def __init__(self, returncode=None):
        self.returncode = returncode

    def poll(self):
        return self.returncode

    def terminate(self):
        return None

    def wait(self, timeout=None):
        return 0


class FakeCommandRunner:
    def __init__(self):
        self.popen_calls = []
        self.run_calls = []

    def popen(self, args, *, env=None, cwd=None, stdout=None, stderr=None):
        self.popen_calls.append({"args": list(args), "env": dict(env or {}), "cwd": cwd, "stdout": stdout, "stderr": stderr})
        return FakeProcess()

    def run(self, args, *, env=None, cwd=None, timeout=None):
        args = list(args)
        self.run_calls.append({"args": args, "env": dict(env or {}), "cwd": cwd, "timeout": timeout})
        if args[:2] == ["/usr/bin/xdotool", "getdisplaygeometry"]:
            return subprocess.CompletedProcess(args, 0, stdout="1280 720\n", stderr="")
        if args[:3] == ["/usr/bin/xdotool", "search", "--onlyvisible"]:
            return subprocess.CompletedProcess(args, 0, stdout="1001\n", stderr="")
        if args[:3] == ["/usr/bin/xdotool", "getwindowgeometry", "--shell"]:
            return subprocess.CompletedProcess(args, 0, stdout="X=0\nY=0\nWIDTH=1280\nHEIGHT=720\n", stderr="")
        if args and args[0] == "/usr/bin/import":
            Path(args[-1]).write_bytes(b"\x89PNG\r\n\x1a\n" + str(args[-1]).encode("utf8"))
        return subprocess.CompletedProcess(args, 0, stdout="", stderr="")


class FailingCommandRunner(FakeCommandRunner):
    def run(self, args, *, env=None, cwd=None, timeout=None):
        args = list(args)
        self.run_calls.append({"args": args, "env": dict(env or {}), "cwd": cwd, "timeout": timeout})
        if args[:2] == ["/usr/bin/xdotool", "getdisplaygeometry"]:
            return subprocess.CompletedProcess(args, 0, stdout="1280 720\n", stderr="")
        if args[:3] == ["/usr/bin/xdotool", "search", "--onlyvisible"]:
            return subprocess.CompletedProcess(args, 0, stdout="1001\n", stderr="")
        if args[:3] == ["/usr/bin/xdotool", "getwindowgeometry", "--shell"]:
            return subprocess.CompletedProcess(args, 0, stdout="X=0\nY=0\nWIDTH=1280\nHEIGHT=720\n", stderr="")
        return subprocess.CompletedProcess(args, 1, stdout="", stderr="capture failed")


class XDisplayFailingCommandRunner(FakeCommandRunner):
    def run(self, args, *, env=None, cwd=None, timeout=None):
        args = list(args)
        self.run_calls.append({"args": args, "env": dict(env or {}), "cwd": cwd, "timeout": timeout})
        if args[:2] == ["/usr/bin/xdotool", "getdisplaygeometry"]:
            return subprocess.CompletedProcess(args, 1, stdout="", stderr="display unavailable")
        return super().run(args, env=env, cwd=cwd, timeout=timeout)


class BrowserWindowFailingCommandRunner(FakeCommandRunner):
    def run(self, args, *, env=None, cwd=None, timeout=None):
        args = list(args)
        self.run_calls.append({"args": args, "env": dict(env or {}), "cwd": cwd, "timeout": timeout})
        if args[:2] == ["/usr/bin/xdotool", "getdisplaygeometry"]:
            return subprocess.CompletedProcess(args, 0, stdout="1280 720\n", stderr="")
        if args[:3] == ["/usr/bin/xdotool", "search", "--onlyvisible"]:
            return subprocess.CompletedProcess(args, 1, stdout="", stderr="no visible ready window")
        if args and args[0] == "/usr/bin/import":
            Path(args[-1]).write_bytes(b"\x89PNG\r\n\x1a\n" + str(args[-1]).encode("utf8"))
        return subprocess.CompletedProcess(args, 0, stdout="", stderr="")


class ExitingCommandRunner(FakeCommandRunner):
    def __init__(self, *, exit_role):
        super().__init__()
        self.exit_role = exit_role

    def popen(self, args, *, env=None, cwd=None, stdout=None, stderr=None):
        self.popen_calls.append({"args": list(args), "env": dict(env or {}), "cwd": cwd, "stdout": stdout, "stderr": stderr})
        return FakeProcess(returncode=2 if args and args[0] == self.exit_role else None)


def fake_http_viewer_body() -> bytes:
    return b"<!doctype html><html><title>noVNC</title><script>var RFB = true;</script></html>"


def fake_http_viewer_sha256() -> str:
    return hashlib.sha256(fake_http_viewer_body()).hexdigest()


def fake_http_viewer_probe(url, _timeout):
    body = fake_http_viewer_body()
    return {
        "ok": True,
        "ready": True,
        "method": "GET",
        "url": url,
        "localhostOnly": True,
        "statusCode": 200,
        "contentType": "text/html",
        "bytesRead": len(body),
        "sha256": hashlib.sha256(body).hexdigest(),
        "htmlDetected": True,
        "noVncMarkerDetected": True,
        "rawPayloadWritten": False,
    }
