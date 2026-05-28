import json
import os
import subprocess
import sys
import zipfile
from pathlib import Path

from sciforge_computer_use.artifact_renderers import validate_docx_artifact
from sciforge_computer_use.visible_viewer import build_visible_run_viewer, validate_visible_run_viewer_manifest


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
PPTX_FIXTURE = PACKAGE_ROOT / "fixtures" / "target-bound-one-page-pptx.json"
CSV_FIXTURE = PACKAGE_ROOT / "fixtures" / "target-bound-csv-table-edit.json"
THREE_PAGE_PPTX_FIXTURE = PACKAGE_ROOT / "fixtures" / "target-bound-visible-three-page-pptx.json"
DOCX_FIXTURE = PACKAGE_ROOT / "fixtures" / "target-bound-docx-document.json"
HIGH_RISK_VISIBLE_FIXTURE = PACKAGE_ROOT / "fixtures" / "target-bound-visible-high-risk-confirmation.json"
CROSS_APP_FIXTURE = PACKAGE_ROOT / "fixtures" / "target-bound-cross-app-document-workflow.json"


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


def minimal_visible_payload(**overrides):
    payload = {
        "schemaVersion": "sciforge.computer-use.result.v1",
        "status": "failed-with-reason",
        "reason": "Capture was unavailable before a screenshot frame could be recorded.",
        "task": "diagnose missing visible frame",
        "steps": [{
            "index": 0,
            "status": "failed",
            "action": {"kind": "wait", "reason": "Wait for capture frame"},
            "verification": {"reason": "Capture provider returned no frame ref."},
        }],
        "failureDiagnostics": {
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
            "failedStage": "capture",
        },
    }
    payload.update(overrides)
    return payload


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
    assert "Driven by generic actions" in html
    assert "../.sciforge/vision-runs/target-bound-pptx/" in html
    assert "data:image" not in html


def test_visible_run_target_bound_csv_uses_same_generic_viewer(tmp_path):
    output_dir = tmp_path / "visible-csv"
    completed = run_visible(
        "--mode",
        "target-bound-window",
        "--request-json",
        json.dumps({
            "task": "edit a visible CSV table through target-bound pointer and keyboard actions",
            "maxSteps": 4,
            "metadata": {"requiresFinalArtifact": True},
        }),
        "--scenario-file",
        str(CSV_FIXTURE),
        "--output-dir",
        str(output_dir),
        "--title",
        "Visible CSV run",
    )

    assert completed.returncode == 0, completed.stdout
    payload = json.loads(completed.stdout)
    viewer_manifest_ref = Path(payload["failureDiagnostics"]["visibleRunViewerManifestRef"])
    viewer_html_ref = Path(payload["failureDiagnostics"]["visibleRunViewerHtmlRef"])
    viewer = json.loads(viewer_manifest_ref.read_text(encoding="utf8"))
    html = viewer_html_ref.read_text(encoding="utf8")

    assert payload["status"] == "completed"
    assert Path(viewer["finalArtifactRef"]).suffix == ".csv"
    assert viewer["validation"]["ok"] is True
    assert viewer["inputSummary"]["pointerEventCount"] >= 1
    assert viewer["inputSummary"]["keyboardEventCount"] >= 1
    assert "Visible CSV run" in html
    assert "Ada,98,ready" in html
    assert "data:image" not in html


def test_visible_run_target_bound_docx_uses_same_generic_viewer(tmp_path):
    output_dir = tmp_path / "visible-docx"
    completed = run_visible(
        "--mode",
        "target-bound-window",
        "--request-json",
        json.dumps({
            "task": "create a visible Word-compatible target-bound report",
            "maxSteps": 4,
            "metadata": {"requiresFinalArtifact": True},
        }),
        "--scenario-file",
        str(DOCX_FIXTURE),
        "--output-dir",
        str(output_dir),
        "--title",
        "Visible DOCX run",
    )

    assert completed.returncode == 0, completed.stdout
    payload = json.loads(completed.stdout)
    viewer_manifest_ref = Path(payload["failureDiagnostics"]["visibleRunViewerManifestRef"])
    viewer_html_ref = Path(payload["failureDiagnostics"]["visibleRunViewerHtmlRef"])
    viewer = json.loads(viewer_manifest_ref.read_text(encoding="utf8"))
    html = viewer_html_ref.read_text(encoding="utf8")
    docx_validation = validate_docx_artifact(Path(viewer["finalArtifactRef"]))

    assert payload["status"] == "completed"
    assert Path(viewer["finalArtifactRef"]).suffix == ".docx"
    assert docx_validation["ok"] is True
    assert payload["failureDiagnostics"]["artifactMetadata"]["docxValidation"]["ok"] is True
    assert viewer["validation"]["ok"] is True
    assert viewer["inputSummary"]["pointerEventCount"] >= 1
    assert viewer["inputSummary"]["keyboardEventCount"] >= 1
    assert "Visible DOCX run" in html
    assert "word-compatible-report.docx" in html
    assert "data:image" not in html


def test_visible_run_target_bound_three_page_pptx_uses_generic_actions(tmp_path):
    output_dir = tmp_path / "visible-three-page-pptx"
    completed = run_visible(
        "--mode",
        "target-bound-window",
        "--request-json",
        json.dumps({
            "task": "create a visible three-page target-bound presentation deck with generic virtual input",
            "maxSteps": 9,
            "metadata": {"requiresFinalArtifact": True},
        }),
        "--scenario-file",
        str(THREE_PAGE_PPTX_FIXTURE),
        "--output-dir",
        str(output_dir),
        "--title",
        "Visible Three-Page PPTX Run",
    )

    assert completed.returncode == 0, completed.stdout
    payload = json.loads(completed.stdout)
    viewer_manifest_ref = Path(payload["failureDiagnostics"]["visibleRunViewerManifestRef"])
    viewer_html_ref = Path(payload["failureDiagnostics"]["visibleRunViewerHtmlRef"])
    viewer = json.loads(viewer_manifest_ref.read_text(encoding="utf8"))
    html = viewer_html_ref.read_text(encoding="utf8")

    assert payload["status"] == "completed"
    assert payload["failureDiagnostics"]["artifactMetadata"]["slideCount"] == 3
    assert payload["failureDiagnostics"]["artifactMetadata"]["pptxValidation"]["ok"] is True
    assert payload["failureDiagnostics"]["inputModalities"] == ["keyboard", "pointer"]
    assert viewer["validation"]["ok"] is True
    assert len(viewer["actions"]) == 7
    assert "Visible Three-Page PPTX Run" in html
    assert "New slide" in html
    assert "Not A PPT-Only Path" in html
    assert "data:image" not in html


def test_visible_run_target_bound_high_risk_confirmation_blocks_action_but_writes_viewer(tmp_path):
    output_dir = tmp_path / "visible-high-risk-confirmation"
    completed = run_visible(
        "--mode",
        "target-bound-window",
        "--request-json",
        json.dumps({
            "task": "fill safe transfer fields and stop before sending the external transfer",
            "maxSteps": 6,
            "metadata": {"requiresFinalArtifact": True},
        }),
        "--scenario-file",
        str(HIGH_RISK_VISIBLE_FIXTURE),
        "--output-dir",
        str(output_dir),
        "--title",
        "Visible High Risk Confirmation Run",
    )

    assert completed.returncode == 0, completed.stdout
    assert completed.stderr == ""
    payload = json.loads(completed.stdout)
    viewer_manifest_ref = Path(payload["failureDiagnostics"]["visibleRunViewerManifestRef"])
    viewer_html_ref = Path(payload["failureDiagnostics"]["visibleRunViewerHtmlRef"])
    viewer = json.loads(viewer_manifest_ref.read_text(encoding="utf8"))
    html = viewer_html_ref.read_text(encoding="utf8")
    result_copy = json.loads(Path(viewer["resultRef"]).read_text(encoding="utf8"))
    input_event_log = json.loads(Path(payload["failureDiagnostics"]["inputEventLogRef"]).read_text(encoding="utf8"))

    assert payload["status"] == "needs-confirmation"
    assert payload["finalArtifactRef"] is None
    assert payload["finalArtifactRefs"] == []
    assert payload["artifactRefs"] == []
    assert viewer["finalArtifactRef"] is None
    assert viewer["artifactRefs"] == []
    assert viewer["validation"]["ok"] is True
    assert validate_visible_run_viewer_manifest(viewer_manifest_ref, require_existing_refs=True)["ok"] is True

    for surface in [payload["failureDiagnostics"], viewer["isolation"]]:
        assert surface["sharedSystemInputUsed"] is False
        assert surface["systemPointerMoved"] is False
        assert surface["systemKeyboardEventsSent"] is False

    assert [step["status"] for step in payload["steps"]] == ["done", "done", "done", "done", "blocked"]
    blocked_step = payload["steps"][-1]
    assert blocked_step["action"]["kind"] == "click"
    assert blocked_step["action"]["target"] == "Send transfer button"
    assert blocked_step["action"]["riskLevel"] == "high"
    assert blocked_step["action"]["requiresConfirmation"] is True
    assert blocked_step["execution"] is None
    assert blocked_step["afterRef"] is None
    assert "screen-04-review-ready.png" in blocked_step["beforeRef"]

    assert input_event_log["eventCount"] == 4
    assert {event["actionIndex"] for event in input_event_log["events"]} == {0, 1, 2, 3}
    assert all(event.get("target") != "Send transfer button" for event in input_event_log["events"])
    assert viewer["inputSummary"]["pointerEventCount"] >= 1
    assert viewer["inputSummary"]["keyboardEventCount"] >= 3

    approval = payload["approvalRequest"]
    confirmation_text = "Approve sending the visible demo transfer from the package-owned target window."
    assert approval["action_kind"] == "click"
    assert approval["risk_level"] == "high"
    assert approval["blocked_action_index"] == 4
    assert approval["confirmation_text"] == confirmation_text
    assert approval["refs"] == [blocked_step["beforeRef"]]
    assert approval["id"].startswith("approval:computer-use:")
    assert result_copy["approvalRequest"]["confirmation_text"] == confirmation_text
    assert result_copy["approvalRequest"]["refs"] == [blocked_step["beforeRef"]]

    assert viewer["actions"][-1]["status"] == "blocked"
    assert viewer["actions"][-1]["target"] == "Send transfer button"
    assert "external transfer send action" in viewer["actions"][-1]["reason"]
    assert "Visible High Risk Confirmation Run" in html
    assert "needs-confirmation" in html
    assert "Send transfer button" in html
    assert "external transfer send action" in html
    assert "Virtual input only" in html
    assert "data:image" not in html


def test_visible_run_target_bound_cross_app_document_workflow_diagnostic(tmp_path):
    output_dir = tmp_path / "visible-cross-app"
    completed = run_visible(
        "--mode",
        "target-bound-window",
        "--request-json",
        json.dumps({
            "task": "read visible source notes, write a Word-compatible summary, save it, and preview directory evidence",
            "maxSteps": 7,
            "metadata": {
                "requiresFinalArtifact": True,
                "requiresDirectoryEvidence": True,
            },
        }),
        "--scenario-file",
        str(CROSS_APP_FIXTURE),
        "--output-dir",
        str(output_dir),
        "--title",
        "Visible Cross App Diagnostic",
    )

    assert completed.returncode == 0, completed.stdout
    payload = json.loads(completed.stdout)
    viewer_manifest_ref = Path(payload["failureDiagnostics"]["visibleRunViewerManifestRef"])
    viewer_html_ref = Path(payload["failureDiagnostics"]["visibleRunViewerHtmlRef"])
    viewer = json.loads(viewer_manifest_ref.read_text(encoding="utf8"))
    html = viewer_html_ref.read_text(encoding="utf8")
    artifact_ref = Path(payload["finalArtifactRef"])
    docx_validation = validate_docx_artifact(artifact_ref)
    with zipfile.ZipFile(artifact_ref) as archive:
        document_xml = archive.read("word/document.xml").decode("utf8")

    assert payload["status"] == "completed"
    assert artifact_ref.suffix == ".docx"
    assert docx_validation["ok"] is True
    assert docx_validation["titleParagraphCount"] == 1
    assert docx_validation["bulletParagraphCount"] == 2
    assert docx_validation["tableCount"] == 1
    assert "CRISPR assay improved recovery by 12 percent" in document_xml
    assert "two validation cohorts" in document_xml
    assert payload["failureDiagnostics"]["fileListArtifactRef"]
    assert payload["failureDiagnostics"]["fileListDataRef"]
    assert "source-summary.docx" in Path(payload["failureDiagnostics"]["fileListArtifactRef"]).read_text(encoding="utf8")
    assert payload["failureDiagnostics"]["inputModalities"] == ["keyboard", "pointer"]
    assert payload["failureDiagnostics"]["targetBoundRealWindowEvidenceRef"]
    assert payload["failureDiagnostics"]["evidenceLogRef"]
    assert viewer["validation"]["ok"] is True
    assert validate_visible_run_viewer_manifest(viewer_manifest_ref, require_existing_refs=True)["ok"] is True
    assert viewer["inputSummary"]["pointerEventCount"] >= 3
    assert viewer["inputSummary"]["keyboardEventCount"] >= 2
    assert viewer["finalArtifactRef"] == str(artifact_ref)
    assert "Visible Cross App Diagnostic" in html
    assert "Source reader window" in html
    assert "source-summary.docx" in html
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


def test_visible_viewer_builds_explained_placeholder_when_screenshot_refs_missing(tmp_path):
    viewer = build_visible_run_viewer(
        output_dir=tmp_path,
        result=minimal_visible_payload(),
        title="Missing screenshot run",
    )
    html = Path(viewer["viewerHtmlRef"]).read_text(encoding="utf8")

    assert viewer["validation"]["ok"] is True
    assert viewer["validation"]["frameCounts"] == {"screenshot": 0, "placeholder": 1}
    assert viewer["screenshotRefs"] == []
    assert len(viewer["frames"]) == 1
    frame = viewer["frames"][0]
    assert frame["kind"] == "placeholder"
    assert frame["reason"] == "screenshot_refs_missing"
    assert "screenshotRef" not in frame
    assert frame["explanation"]
    assert frame["sourceRefs"] == [str((tmp_path / "computer-use-result.json").resolve())]
    assert frame["sourceContext"]["failedStage"] == "capture"
    assert validate_visible_run_viewer_manifest(viewer, require_existing_refs=True)["ok"] is True
    assert "Frame unavailable" in html
    assert "This is not a screenshot." in html
    assert "<img" not in html
    assert "data:image" not in html


def test_visible_viewer_builds_placeholder_for_missing_screenshot_file(tmp_path):
    missing_ref = tmp_path / "missing-frame.png"
    viewer = build_visible_run_viewer(
        output_dir=tmp_path,
        result=minimal_visible_payload(screenshotRefs=[str(missing_ref)]),
        title="Missing file run",
    )
    html = Path(viewer["viewerHtmlRef"]).read_text(encoding="utf8")

    assert viewer["validation"]["ok"] is True
    assert viewer["validation"]["frameCounts"] == {"screenshot": 0, "placeholder": 1}
    assert viewer["screenshotRefs"] == []
    frame = viewer["frames"][0]
    assert frame["kind"] == "placeholder"
    assert frame["reason"] == "screenshot_ref_unavailable"
    assert frame["missingScreenshotRef"] == str(missing_ref.resolve())
    assert "screenshotRef" not in frame
    assert validate_visible_run_viewer_manifest(viewer, require_existing_refs=True)["ok"] is True
    assert "Missing screenshot ref" in html
    assert "missing-frame.png" in html
    assert "<img" not in html


def test_visible_viewer_validation_requires_placeholder_explanation_and_source():
    validation = validate_visible_run_viewer_manifest({
        "schemaVersion": "sciforge.computer-use.visible-run-viewer.v1",
        "status": "failed-with-reason",
        "viewerHtmlRef": "/tmp/missing.html",
        "resultRef": "/tmp/missing-result.json",
        "frames": [{"index": 0, "kind": "placeholder", "reason": "screenshot_refs_missing"}],
        "actions": [{"index": 0, "kind": "wait", "status": "failed"}],
        "isolation": {
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
        },
        "rawPayloadWritten": False,
        "inlineImageWritten": False,
    })

    codes = {error["code"] for error in validation["errors"]}
    assert validation["ok"] is False
    assert "placeholder_explanation_missing" in codes
    assert "placeholder_source_refs_missing" in codes
    assert "placeholder_source_context_missing" in codes
