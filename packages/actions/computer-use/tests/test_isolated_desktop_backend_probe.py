import json
import subprocess
import sys
from pathlib import Path

from sciforge_computer_use.isolated_desktop_backend_probe import (
    ISOLATED_DESKTOP_BACKEND_SCHEMA,
    MANIFEST_NAME,
    REQUIRED_COMPONENTS,
    build_isolated_desktop_backend_manifest,
)


PACKAGE_ROOT = Path(__file__).resolve().parents[1]


def test_isolated_desktop_backend_probe_blocks_without_linux_components(tmp_path):
    manifest = build_isolated_desktop_backend_manifest(
        output_dir=tmp_path / "backend",
        platform_system="Darwin",
        command_resolver=lambda _command: None,
        path_exists=lambda _path: False,
    )

    assert manifest["schemaVersion"] == ISOLATED_DESKTOP_BACKEND_SCHEMA
    assert manifest["status"] == "blocked"
    assert manifest["backendKind"] == "linux-novnc-libreoffice-browser"
    assert manifest["diagnosticOnly"] is True
    assert manifest["realWindowEvidence"] is False
    assert manifest["inputExecuted"] is False
    assert manifest["sharedSystemInputUsed"] is False
    assert manifest["systemPointerMoved"] is False
    assert manifest["systemKeyboardEventsSent"] is False
    assert any(check["category"] == "platform" and not check["ok"] for check in manifest["preflightChecks"])
    assert any(check["category"] == "novnc-web-root" and not check["ok"] for check in manifest["preflightChecks"])
    assert Path(manifest["manifestRef"]).name == MANIFEST_NAME
    assert Path(manifest["manifestRef"]).is_file()


def test_isolated_desktop_backend_probe_ready_when_all_dependencies_declared(tmp_path):
    command_paths = {
        "Xvfb": "/usr/bin/Xvfb",
        "openbox": "/usr/bin/openbox",
        "x11vnc": "/usr/bin/x11vnc",
        "websockify": "/usr/bin/websockify",
        "libreoffice": "/usr/bin/libreoffice",
        "chromium": "/usr/bin/chromium",
    }

    manifest = build_isolated_desktop_backend_manifest(
        output_dir=tmp_path / "backend",
        platform_system="Linux",
        command_resolver=lambda command: command_paths.get(command),
        path_exists=lambda path: path == "/usr/share/novnc",
    )

    assert manifest["status"] == "ready"
    assert manifest["blockedReasons"] == []
    assert all(check["ok"] for check in manifest["preflightChecks"])
    assert set(manifest["requiredComponents"]) == set(REQUIRED_COMPONENTS)
    assert manifest["observedComponents"]["virtualDisplay"]["path"] == "/usr/bin/Xvfb"
    assert manifest["observedComponents"]["documentApp"]["path"] == "/usr/bin/libreoffice"
    assert manifest["observedComponents"]["browser"]["path"] == "/usr/bin/chromium"
    assert manifest["noVncWebRoot"] == "/usr/share/novnc"
    assert manifest["l1Smoke"]["completed"] is False
    assert manifest["l1Smoke"]["realWindowEvidence"] is False
    assert manifest["launchPlan"]["noVncBackendStarted"] is False
    assert manifest["projectClaimLimit"]


def test_isolated_desktop_backend_probe_cli_writes_manifest(tmp_path):
    output_dir = tmp_path / "backend"
    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "sciforge_computer_use.isolated_desktop_backend_probe",
            "--output-dir",
            str(output_dir),
        ],
        cwd=PACKAGE_ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )

    assert completed.returncode in {0, 1}
    assert completed.stderr == ""
    payload = json.loads(completed.stdout)
    assert payload["schemaVersion"] == ISOLATED_DESKTOP_BACKEND_SCHEMA
    assert (output_dir / MANIFEST_NAME).is_file()
