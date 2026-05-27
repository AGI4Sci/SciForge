import json
import os
import subprocess
import sys
from pathlib import Path

from sciforge_computer_use.visible_viewer import validate_visible_run_viewer_manifest


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
PPTX_FIXTURE = PACKAGE_ROOT / "fixtures" / "target-bound-one-page-pptx.json"


def run_visible(*args):
    env = {
        **os.environ,
        "PYTHONPATH": str(PACKAGE_ROOT),
    }
    return subprocess.run(
        [sys.executable, "-m", "sciforge_computer_use.visible_run", *args],
        cwd=PACKAGE_ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        check=False,
    )


def test_visible_run_target_bound_pptx_writes_replay_viewer(tmp_path):
    output_dir = tmp_path / "visible-pptx"
    completed = run_visible(
        "--mode",
        "target-bound-window",
        "--request-json",
        json.dumps({
            "task": "create a visible one-page target-bound presentation deck",
            "maxSteps": 4,
            "metadata": {"requiresFinalArtifact": True},
        }),
        "--scenario-file",
        str(PPTX_FIXTURE),
        "--output-dir",
        str(output_dir),
        "--title",
        "Visible PPTX run",
    )

    assert completed.returncode == 0, completed.stdout
    assert completed.stderr == ""
    payload = json.loads(completed.stdout)
    viewer_manifest_ref = Path(payload["failureDiagnostics"]["visibleRunViewerManifestRef"])
    viewer_html_ref = Path(payload["failureDiagnostics"]["visibleRunViewerHtmlRef"])
    viewer = json.loads(viewer_manifest_ref.read_text(encoding="utf8"))
    html = viewer_html_ref.read_text(encoding="utf8")

    assert payload["status"] == "completed"
    assert viewer["schemaVersion"] == "sciforge.computer-use.visible-run-viewer.v1"
    assert viewer["validation"]["ok"] is True
    assert validate_visible_run_viewer_manifest(viewer_manifest_ref, require_existing_refs=True)["ok"] is True
    assert viewer["isolation"]["sharedSystemInputUsed"] is False
    assert viewer["isolation"]["systemPointerMoved"] is False
    assert viewer["isolation"]["systemKeyboardEventsSent"] is False
    assert viewer["inputSummary"]["pointerEventCount"] >= 1
    assert viewer["inputSummary"]["keyboardEventCount"] >= 1
    assert len(viewer["frames"]) >= 2
    assert len(viewer["actions"]) >= 3
    assert Path(viewer["finalArtifactRef"]).suffix == ".pptx"
    assert "Visible PPTX run" in html
    assert "Virtual input only" in html
    assert "../.sciforge/vision-runs/target-bound-pptx/" in html
    assert "data:image" not in html


def test_visible_viewer_validation_rejects_shared_system_input():
    validation = validate_visible_run_viewer_manifest({
        "schemaVersion": "sciforge.computer-use.visible-run-viewer.v1",
        "status": "completed",
        "viewerHtmlRef": "/tmp/missing.html",
        "resultRef": "/tmp/missing-result.json",
        "frames": [{"index": 0, "screenshotRef": "/tmp/missing.png"}],
        "actions": [{"index": 0, "kind": "click", "status": "completed"}],
        "isolation": {
            "sharedSystemInputUsed": True,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
        },
        "rawPayloadWritten": False,
        "inlineImageWritten": False,
    })

    assert validation["ok"] is False
    assert any(error["code"] == "input_isolation_flag_not_false" for error in validation["errors"])
