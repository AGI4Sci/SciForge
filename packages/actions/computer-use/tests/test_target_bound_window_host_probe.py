import json
import os
import subprocess
import sys
import zipfile
from pathlib import Path

from sciforge_computer_use.artifact_renderers import validate_docx_artifact
from sciforge_computer_use.trace import (
    validate_repair_replay_evidence,
    validate_target_bound_real_window_probe_evidence,
    validate_viewport_recovery_evidence,
)


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
SIX_STEP_FIXTURE = PACKAGE_ROOT / "fixtures" / "virtual-desktop-six-step.json"
AMBIGUOUS_FIXTURE = PACKAGE_ROOT / "fixtures" / "virtual-desktop-ambiguous-before-after.json"
PPTX_FIXTURE = PACKAGE_ROOT / "fixtures" / "target-bound-one-page-pptx.json"
CSV_FIXTURE = PACKAGE_ROOT / "fixtures" / "target-bound-csv-table-edit.json"
FORM_DIALOG_FIXTURE = PACKAGE_ROOT / "fixtures" / "target-bound-form-dialog.json"
FORM_HIGH_RISK_FIXTURE = PACKAGE_ROOT / "fixtures" / "target-bound-form-high-risk-submit.json"
MENU_HOTKEY_FIXTURE = PACKAGE_ROOT / "fixtures" / "target-bound-menu-hotkey.json"
PREVIEW_DIRECTORY_FIXTURE = PACKAGE_ROOT / "fixtures" / "target-bound-preview-directory.json"
DOCX_FIXTURE = PACKAGE_ROOT / "fixtures" / "target-bound-docx-document.json"


def run_target_probe(*args):
    env = {
        **os.environ,
        "PYTHONPATH": str(PACKAGE_ROOT),
    }
    return subprocess.run(
        [sys.executable, "-m", "sciforge_computer_use.target_bound_window_host_probe", *args],
        cwd=PACKAGE_ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        check=False,
    )


def test_target_bound_window_host_task_a_single_app_artifact_evidence(tmp_path):
    scenario_file = write_scenario(tmp_path, single_app_artifact_scenario())
    output_dir = tmp_path / "target-bound-a"
    completed = run_target_probe(
        "--request-json",
        json.dumps({
            "task": "create target-bound package window markdown note",
            "maxSteps": 3,
            "metadata": {"requiresFinalArtifact": True},
        }),
        "--scenario-file",
        str(scenario_file),
        "--output-dir",
        str(output_dir),
    )

    assert completed.returncode == 0, completed.stdout
    assert completed.stderr == ""
    payload = json.loads(completed.stdout)
    evidence_ref = Path(payload["failureDiagnostics"]["targetBoundRealWindowEvidenceRef"])
    evidence = json.loads(evidence_ref.read_text(encoding="utf8"))

    assert payload["status"] == "completed"
    assert payload["failureDiagnostics"]["inputExecuted"] is True
    assert payload["failureDiagnostics"]["sharedSystemInputUsed"] is False
    assert payload["failureDiagnostics"]["realWindowEvidence"] is True
    assert Path(payload["finalArtifactRef"]).read_text(encoding="utf8").startswith("# Target Bound Task A")
    assert evidence["preflightStatus"] == "ready"
    assert evidence["inputExecuted"] is True
    assert evidence["executeFailClosed"] is False
    assert evidence["realWindowEvidence"] is True
    assert evidence["diagnosticOnly"] is False
    assert validate_target_bound_real_window_probe_evidence(evidence_ref, require_existing_refs=True)["ok"] is True


def test_target_bound_window_host_unknown_action_kind_fails_closed(tmp_path):
    scenario_file = write_scenario(tmp_path, unsupported_action_scenario())
    output_dir = tmp_path / "target-bound-unsupported"
    completed = run_target_probe(
        "--request-json",
        json.dumps({"task": "reject unsupported target-bound action", "maxSteps": 1}),
        "--scenario-file",
        str(scenario_file),
        "--output-dir",
        str(output_dir),
    )

    assert completed.returncode == 1, completed.stdout
    assert completed.stderr == ""
    payload = json.loads(completed.stdout)

    assert payload["status"] == "failed-with-reason"
    assert payload["failureDiagnostics"]["failedStage"] == "execution"
    assert "does not support action kind 'open_app'" in payload["reason"]
    assert "targetBoundRealWindowEvidenceRef" not in payload["failureDiagnostics"]


def test_target_bound_window_host_can_create_one_page_pptx_artifact(tmp_path):
    output_dir = tmp_path / "target-bound-pptx"
    completed = run_target_probe(
        "--request-json",
        json.dumps({
            "task": "create a one-page target-bound presentation deck",
            "maxSteps": 4,
            "metadata": {"requiresFinalArtifact": True},
        }),
        "--scenario-file",
        str(PPTX_FIXTURE),
        "--output-dir",
        str(output_dir),
    )

    assert completed.returncode == 0, completed.stdout
    payload = json.loads(completed.stdout)
    artifact_ref = Path(payload["finalArtifactRef"])
    evidence_ref = Path(payload["failureDiagnostics"]["targetBoundRealWindowEvidenceRef"])
    evidence = json.loads(evidence_ref.read_text(encoding="utf8"))

    assert payload["status"] == "completed"
    assert artifact_ref.suffix == ".pptx"
    assert zipfile.is_zipfile(artifact_ref)
    with zipfile.ZipFile(artifact_ref) as deck:
        names = set(deck.namelist())
        slide_xml = deck.read("ppt/slides/slide1.xml").decode("utf8")
    assert "ppt/presentation.xml" in names
    assert "ppt/slides/slide1.xml" in names
    assert "Computer Use Can Make Slides" in slide_xml
    assert "target-bound window host" in slide_xml
    validation_ref = Path(payload["failureDiagnostics"]["artifactMetadata"]["pptxValidationRef"])
    validation = json.loads(validation_ref.read_text(encoding="utf8"))
    assert validation["ok"] is True
    assert validation["slideCount"] == 1
    assert payload["failureDiagnostics"]["inputModalities"] == ["keyboard", "pointer"]
    assert Path(payload["failureDiagnostics"]["pointerEventLogRef"]).is_file()
    assert Path(payload["failureDiagnostics"]["keyboardEventLogRef"]).is_file()
    assert evidence["workflowRequirements"]["requiredInputModalities"] == ["pointer", "keyboard"]
    assert evidence["realWindowEvidence"] is True
    assert evidence["inputExecuted"] is True
    assert validate_target_bound_real_window_probe_evidence(evidence_ref, require_existing_refs=True)["ok"] is True


def test_target_bound_window_host_can_create_word_compatible_docx_artifact(tmp_path):
    output_dir = tmp_path / "target-bound-docx"
    completed = run_target_probe(
        "--request-json",
        json.dumps({
            "task": "create a Word-compatible target-bound report",
            "maxSteps": 4,
            "metadata": {"requiresFinalArtifact": True},
        }),
        "--scenario-file",
        str(DOCX_FIXTURE),
        "--output-dir",
        str(output_dir),
    )

    assert completed.returncode == 0, completed.stdout
    payload = json.loads(completed.stdout)
    artifact_ref = Path(payload["finalArtifactRef"])
    evidence_ref = Path(payload["failureDiagnostics"]["targetBoundRealWindowEvidenceRef"])
    evidence = json.loads(evidence_ref.read_text(encoding="utf8"))
    docx_validation = validate_docx_artifact(artifact_ref)

    assert payload["status"] == "completed"
    assert artifact_ref.suffix == ".docx"
    assert docx_validation["ok"] is True
    assert docx_validation["titleParagraphCount"] == 1
    assert docx_validation["bulletParagraphCount"] == 2
    assert docx_validation["tableCount"] == 1
    assert payload["failureDiagnostics"]["artifactMetadata"]["docxValidationRef"]
    assert (
        evidence["metadata"]["artifactMetadata"]["docxValidationRef"]
        == payload["failureDiagnostics"]["artifactMetadata"]["docxValidationRef"]
    )
    assert evidence["finalArtifactRef"] == str(artifact_ref)
    assert evidence["workflowRequirements"]["requiredInputModalities"] == ["pointer", "keyboard"]
    assert evidence["realWindowEvidence"] is True
    assert evidence["diagnosticOnly"] is False
    assert validate_target_bound_real_window_probe_evidence(evidence_ref, require_existing_refs=True)["ok"] is True


def test_target_bound_window_host_can_edit_csv_table_with_pointer_and_keyboard(tmp_path):
    output_dir = tmp_path / "target-bound-csv"
    completed = run_target_probe(
        "--request-json",
        json.dumps({
            "task": "edit a CSV table through target-bound pointer and keyboard actions",
            "maxSteps": 4,
            "metadata": {"requiresFinalArtifact": True},
        }),
        "--scenario-file",
        str(CSV_FIXTURE),
        "--output-dir",
        str(output_dir),
    )

    assert completed.returncode == 0, completed.stdout
    payload = json.loads(completed.stdout)
    artifact_ref = Path(payload["finalArtifactRef"])
    evidence_ref = Path(payload["failureDiagnostics"]["targetBoundRealWindowEvidenceRef"])
    evidence = json.loads(evidence_ref.read_text(encoding="utf8"))

    assert payload["status"] == "completed"
    assert artifact_ref.suffix == ".csv"
    assert artifact_ref.read_text(encoding="utf8") == "Name,Score,Status\nAda,98,ready\nGrace,95,review\n"
    assert payload["failureDiagnostics"]["inputModalities"] == ["keyboard", "pointer"]
    assert evidence["workflowRequirements"]["requiredInputModalities"] == ["pointer", "keyboard"]
    assert validate_target_bound_real_window_probe_evidence(evidence_ref, require_existing_refs=True)["ok"] is True


def test_target_bound_window_host_can_complete_form_dialog_with_tab_enter_confirmation(tmp_path):
    output_dir = tmp_path / "target-bound-form-dialog"
    completed = run_target_probe(
        "--request-json",
        json.dumps({
            "task": "fill a local form and save a reviewed confirmation",
            "maxSteps": 6,
            "metadata": {"requiresFinalArtifact": True},
        }),
        "--scenario-file",
        str(FORM_DIALOG_FIXTURE),
        "--output-dir",
        str(output_dir),
    )

    assert completed.returncode == 0, completed.stdout
    payload = json.loads(completed.stdout)
    artifact_ref = Path(payload["finalArtifactRef"])
    evidence_ref = Path(payload["failureDiagnostics"]["targetBoundRealWindowEvidenceRef"])
    evidence = json.loads(evidence_ref.read_text(encoding="utf8"))

    assert payload["status"] == "completed"
    assert artifact_ref.name == "form-confirmation.md"
    artifact_text = artifact_ref.read_text(encoding="utf8")
    assert "Name: Ada Lovelace" in artifact_text
    assert "Email: ada@example.test" in artifact_text
    assert [step["action"]["kind"] for step in payload["steps"]] == [
        "click",
        "type_text",
        "press_key",
        "type_text",
        "press_key",
    ]
    assert payload["failureDiagnostics"]["inputModalities"] == ["keyboard", "pointer"]
    assert evidence["workflowRequirements"]["minimumActionCount"] == 5
    assert validate_target_bound_real_window_probe_evidence(evidence_ref, require_existing_refs=True)["ok"] is True


def test_target_bound_window_host_high_risk_form_submit_needs_confirmation_without_execution(tmp_path):
    output_dir = tmp_path / "target-bound-form-high-risk"
    blocked = run_target_probe(
        "--request-json",
        json.dumps({
            "task": "try to submit a high-risk local form",
            "maxSteps": 2,
            "metadata": {"requiresFinalArtifact": True},
        }),
        "--scenario-file",
        str(FORM_HIGH_RISK_FIXTURE),
        "--output-dir",
        str(output_dir),
    )

    assert blocked.returncode == 0, blocked.stdout
    payload = json.loads(blocked.stdout)
    repair_manifest = json.loads((output_dir / "blocked-repair-manifest.json").read_text(encoding="utf8"))

    assert payload["status"] == "needs-confirmation"
    assert payload["approvalRequest"]["action_kind"] == "click"
    assert payload["steps"][0]["status"] == "blocked"
    assert payload["steps"][0]["execution"] is None
    assert payload["failureDiagnostics"]["inputExecuted"] is False
    assert payload["failureDiagnostics"]["sharedSystemInputUsed"] is False
    assert payload["failureDiagnostics"]["realWindowEvidence"] is True
    assert "targetBoundRealWindowEvidenceRef" not in payload["failureDiagnostics"]
    assert repair_manifest["inputExecuted"] is False
    assert repair_manifest["realWindowEvidence"] is True


def test_target_bound_window_host_high_risk_dialog_confirmation_blocks_after_safe_form_steps(tmp_path):
    scenario_file = write_scenario(tmp_path, high_risk_dialog_confirmation_scenario(), name="dialog-risk.json")
    output_dir = tmp_path / "target-bound-dialog-risk"
    blocked = run_target_probe(
        "--request-json",
        json.dumps({
            "task": "fill a local form but stop before high-risk dialog confirmation",
            "maxSteps": 6,
            "metadata": {"requiresFinalArtifact": True},
        }),
        "--scenario-file",
        str(scenario_file),
        "--output-dir",
        str(output_dir),
    )

    assert blocked.returncode == 0, blocked.stdout
    payload = json.loads(blocked.stdout)
    repair_manifest = json.loads((output_dir / "blocked-repair-manifest.json").read_text(encoding="utf8"))

    assert payload["status"] == "needs-confirmation"
    assert [step["action"]["kind"] for step in payload["steps"]] == [
        "click",
        "type_text",
        "press_key",
        "type_text",
        "click",
    ]
    assert payload["steps"][-1]["status"] == "blocked"
    assert payload["steps"][-1]["execution"] is None
    assert payload["approvalRequest"]["action_kind"] == "click"
    assert "Confirm button" in payload["approvalRequest"]["confirmation_text"]
    assert payload["failureDiagnostics"]["inputExecuted"] is True
    assert payload["failureDiagnostics"]["sharedSystemInputUsed"] is False
    assert "targetBoundRealWindowEvidenceRef" not in payload["failureDiagnostics"]
    assert repair_manifest["inputExecuted"] is True
    assert repair_manifest["realWindowEvidence"] is True


def test_target_bound_window_host_can_complete_menu_hotkey_workflow_with_save_causality(tmp_path):
    output_dir = tmp_path / "target-bound-menu-hotkey"
    completed = run_target_probe(
        "--request-json",
        json.dumps({
            "task": "open a menu, type a note, and save with a hotkey",
            "maxSteps": 5,
            "metadata": {"requiresFinalArtifact": True},
        }),
        "--scenario-file",
        str(MENU_HOTKEY_FIXTURE),
        "--output-dir",
        str(output_dir),
    )

    assert completed.returncode == 0, completed.stdout
    payload = json.loads(completed.stdout)
    artifact_ref = Path(payload["finalArtifactRef"])
    evidence_ref = Path(payload["failureDiagnostics"]["targetBoundRealWindowEvidenceRef"])

    assert payload["status"] == "completed"
    assert artifact_ref.read_text(encoding="utf8") == "# Menu Hotkey Note\n\n- Opened menu with pointer\n- Saved with hotkey\n"
    assert [step["action"]["kind"] for step in payload["steps"]] == ["click", "press_key", "type_text", "hotkey"]
    artifact_metadata = payload["failureDiagnostics"]["artifactMetadata"]
    assert artifact_metadata["savedByActionIndex"] == 3
    assert artifact_metadata["savedByInputModality"] == "keyboard"
    assert payload["steps"][3]["action"]["key"] == "Ctrl+S"
    assert validate_target_bound_real_window_probe_evidence(evidence_ref, require_existing_refs=True)["ok"] is True


def test_target_bound_window_host_can_preview_saved_file_and_promote_directory_refs(tmp_path):
    output_dir = tmp_path / "target-bound-preview-directory"
    completed = run_target_probe(
        "--request-json",
        json.dumps({
            "task": "save a note and confirm it in the file preview directory",
            "maxSteps": 6,
            "metadata": {
                "requiresFinalArtifact": True,
                "requiresDirectoryEvidence": True,
            },
        }),
        "--scenario-file",
        str(PREVIEW_DIRECTORY_FIXTURE),
        "--output-dir",
        str(output_dir),
    )

    assert completed.returncode == 0, completed.stdout
    payload = json.loads(completed.stdout)
    evidence_ref = Path(payload["failureDiagnostics"]["targetBoundRealWindowEvidenceRef"])
    evidence = json.loads(evidence_ref.read_text(encoding="utf8"))
    file_list_ref = Path(payload["failureDiagnostics"]["fileListArtifactRef"])
    file_list_data_ref = Path(payload["failureDiagnostics"]["fileListDataRef"])

    assert payload["status"] == "completed"
    assert Path(payload["finalArtifactRef"]).read_text(encoding="utf8").startswith("# Preview Note")
    assert payload["failureDiagnostics"]["inputModalities"] == ["keyboard", "pointer"]
    assert file_list_ref.is_file()
    assert file_list_data_ref.is_file()
    assert "preview-note.md" in file_list_ref.read_text(encoding="utf8")
    assert evidence["workflowRequirements"]["requiresDirectoryEvidence"] is True
    assert evidence["fileListArtifactRef"] == str(file_list_ref)
    assert evidence["fileListDataRef"] == str(file_list_data_ref)
    assert validate_target_bound_real_window_probe_evidence(evidence_ref, require_existing_refs=True)["ok"] is True


def test_target_bound_window_host_task_b_six_step_workflow_evidence(tmp_path):
    scenario = target_six_step_scenario()
    scenario_file = write_scenario(tmp_path, scenario)
    output_dir = tmp_path / "target-bound-b"
    completed = run_target_probe(
        "--request-json",
        json.dumps({
            "task": "complete target-bound six-step file evidence workflow",
            "maxSteps": 6,
            "metadata": {
                "requiresFinalArtifact": True,
                "requiresDirectoryEvidence": True,
            },
        }),
        "--scenario-file",
        str(scenario_file),
        "--output-dir",
        str(output_dir),
    )

    assert completed.returncode == 0, completed.stdout
    payload = json.loads(completed.stdout)
    evidence_ref = Path(payload["failureDiagnostics"]["targetBoundRealWindowEvidenceRef"])
    evidence = json.loads(evidence_ref.read_text(encoding="utf8"))

    assert payload["status"] == "completed"
    assert len(payload["steps"]) == 6
    assert payload["failureDiagnostics"]["targetBindingValidation"]["ok"] is True
    assert payload["failureDiagnostics"]["targetEnvironmentKind"] == "package-owned-target-bound-window"
    assert evidence["workflowRequirements"] == {
        "minimumActionCount": 6,
        "requiredInputModalities": ["pointer", "keyboard"],
        "requiresCurrentStepScreenshots": True,
        "forbidPriorRoundCompletionEvidence": True,
        "requiresDirectoryEvidence": True,
    }
    assert evidence["fileListArtifactRef"]
    assert evidence["fileListDataRef"]
    assert validate_target_bound_real_window_probe_evidence(evidence_ref, require_existing_refs=True)["ok"] is True
    serialized = json.dumps({
        "payload": payload,
        "evidence": evidence,
        "trace": json.loads((output_dir / "vision-trace.json").read_text(encoding="utf8")),
    })
    for forbidden in ("ledgerDone", "priorRoundDone", "historicalDone", "prior-ledger"):
        assert forbidden not in serialized


def test_target_bound_window_host_task_b_rejects_prior_ledger_completion(tmp_path):
    scenario_file = write_scenario(tmp_path, target_six_step_scenario())
    output_dir = tmp_path / "target-bound-b-ledger"
    completed = run_target_probe(
        "--request-json",
        json.dumps({
            "task": "complete target-bound six-step file evidence workflow",
            "maxSteps": 6,
            "metadata": {
                "requiresFinalArtifact": True,
                "requiresDirectoryEvidence": True,
            },
        }),
        "--scenario-file",
        str(scenario_file),
        "--output-dir",
        str(output_dir),
    )
    assert completed.returncode == 0, completed.stdout
    payload = json.loads(completed.stdout)
    evidence = json.loads(Path(payload["failureDiagnostics"]["targetBoundRealWindowEvidenceRef"]).read_text(encoding="utf8"))
    trace = json.loads((output_dir / "vision-trace.json").read_text(encoding="utf8"))
    trace["failureDiagnostics"] = {"ledgerDone": True}
    (output_dir / "vision-trace.json").write_text(json.dumps(trace), encoding="utf8")

    codes = {error["code"] for error in validate_target_bound_real_window_probe_evidence(evidence)["errors"]}

    assert "prior_round_completion_evidence_forbidden" in codes


def test_target_bound_window_host_evidence_rejects_missing_keyboard_modality(tmp_path):
    scenario_file = write_scenario(tmp_path, target_six_step_scenario())
    output_dir = tmp_path / "target-bound-modality"
    completed = run_target_probe(
        "--request-json",
        json.dumps({
            "task": "complete target-bound six-step file evidence workflow",
            "maxSteps": 6,
            "metadata": {
                "requiresFinalArtifact": True,
                "requiresDirectoryEvidence": True,
            },
        }),
        "--scenario-file",
        str(scenario_file),
        "--output-dir",
        str(output_dir),
    )
    assert completed.returncode == 0, completed.stdout
    payload = json.loads(completed.stdout)
    evidence = json.loads(Path(payload["failureDiagnostics"]["targetBoundRealWindowEvidenceRef"]).read_text(encoding="utf8"))
    result = json.loads((output_dir / "computer-use-result.json").read_text(encoding="utf8"))
    for step in result["steps"]:
        step["action"]["kind"] = "click"
        step.get("execution", {}).get("metadata", {}).pop("inputModalities", None)
    (output_dir / "computer-use-result.json").write_text(json.dumps(result), encoding="utf8")

    codes = {error["code"] for error in validate_target_bound_real_window_probe_evidence(evidence)["errors"]}

    assert "required_input_modality_missing" in codes


def test_target_bound_window_host_evidence_rejects_missing_keyboard_event_log(tmp_path):
    scenario_file = write_scenario(tmp_path, target_six_step_scenario())
    output_dir = tmp_path / "target-bound-event-log"
    completed = run_target_probe(
        "--request-json",
        json.dumps({
            "task": "complete target-bound six-step file evidence workflow",
            "maxSteps": 6,
            "metadata": {
                "requiresFinalArtifact": True,
                "requiresDirectoryEvidence": True,
            },
        }),
        "--scenario-file",
        str(scenario_file),
        "--output-dir",
        str(output_dir),
    )
    assert completed.returncode == 0, completed.stdout
    payload = json.loads(completed.stdout)
    evidence = json.loads(Path(payload["failureDiagnostics"]["targetBoundRealWindowEvidenceRef"]).read_text(encoding="utf8"))
    for keyboard_log_ref in output_dir.glob("*-keyboard.json"):
        keyboard_log = json.loads(keyboard_log_ref.read_text(encoding="utf8"))
        keyboard_log["events"] = []
        keyboard_log["eventCount"] = 0
        keyboard_log_ref.write_text(json.dumps(keyboard_log), encoding="utf8")

    codes = {error["code"] for error in validate_target_bound_real_window_probe_evidence(evidence)["errors"]}

    assert "required_input_event_log_missing" in codes


def test_target_bound_window_host_rejects_pptx_without_save_causality(tmp_path):
    output_dir = tmp_path / "target-bound-pptx-causality"
    completed = run_target_probe(
        "--request-json",
        json.dumps({
            "task": "create a one-page target-bound presentation deck",
            "maxSteps": 4,
            "metadata": {"requiresFinalArtifact": True},
        }),
        "--scenario-file",
        str(PPTX_FIXTURE),
        "--output-dir",
        str(output_dir),
    )
    assert completed.returncode == 0, completed.stdout
    payload = json.loads(completed.stdout)
    evidence = json.loads(Path(payload["failureDiagnostics"]["targetBoundRealWindowEvidenceRef"]).read_text(encoding="utf8"))
    result = json.loads((output_dir / "computer-use-result.json").read_text(encoding="utf8"))
    result["steps"][2]["action"]["key"] = "Enter"
    (output_dir / "computer-use-result.json").write_text(json.dumps(result), encoding="utf8")

    codes = {error["code"] for error in validate_target_bound_real_window_probe_evidence(evidence)["errors"]}

    assert "artifact_save_action_not_found" in codes


def test_target_bound_window_host_task_c_ambiguous_repair_replay_is_real_window(tmp_path):
    failed_scenario = target_ambiguous_scenario()
    failed_scenario["plans"] = [{"type": "click", "targetDescription": "Save button"}]
    failed_file = write_scenario(tmp_path, failed_scenario, name="ambiguous-failed.json")
    failed_dir = tmp_path / "ambiguous-failed"
    failed = run_target_probe(
        "--request-json",
        json.dumps({"task": "fail broad target-bound ambiguous Save target", "maxSteps": 1}),
        "--scenario-file",
        str(failed_file),
        "--output-dir",
        str(failed_dir),
    )
    assert failed.returncode == 1, failed.stdout
    failed_payload = json.loads(failed.stdout)
    source_manifest_ref = failed_payload["failureDiagnostics"]["repairManifestRef"]
    assert json.loads(Path(source_manifest_ref).read_text(encoding="utf8"))["realWindowEvidence"] is True

    replay_file = write_scenario(tmp_path, target_ambiguous_scenario(), name="ambiguous-replayed.json")
    replay_dir = tmp_path / "ambiguous-replayed"
    completed = run_target_probe(
        "--request-json",
        json.dumps({"task": "replay repaired target-bound ambiguous Save target", "maxSteps": 2}),
        "--scenario-file",
        str(replay_file),
        "--output-dir",
        str(replay_dir),
        "--source-repair-manifest",
        source_manifest_ref,
    )

    assert completed.returncode == 0, completed.stdout
    payload = json.loads(completed.stdout)
    evidence_ref = Path(payload["failureDiagnostics"]["repairReplayEvidenceRef"])
    evidence = json.loads(evidence_ref.read_text(encoding="utf8"))
    assert evidence["realWindowEvidence"] is True
    assert evidence["diagnosticOnly"] is False
    assert evidence["targetBindingValidation"]["ok"] is True
    assert evidence["realWindowEvidenceRefs"]
    assert validate_repair_replay_evidence(evidence_ref, require_existing_refs=True)["ok"] is True


def test_target_bound_window_host_task_c_viewport_recovery_is_real_window(tmp_path):
    failed_file = write_scenario(tmp_path, viewport_failure_scenario(), name="viewport-failed.json")
    failed_dir = tmp_path / "viewport-failed"
    failed = run_target_probe(
        "--request-json",
        json.dumps({"task": "fail offscreen target-bound save location", "maxSteps": 1}),
        "--scenario-file",
        str(failed_file),
        "--output-dir",
        str(failed_dir),
    )
    assert failed.returncode == 1, failed.stdout
    source_manifest_ref = json.loads(failed.stdout)["failureDiagnostics"]["repairManifestRef"]

    replay_file = write_scenario(tmp_path, viewport_repaired_scenario(), name="viewport-repaired.json")
    replay_dir = tmp_path / "viewport-replayed"
    completed = run_target_probe(
        "--request-json",
        json.dumps({"task": "scroll and select offscreen target-bound save location", "maxSteps": 2}),
        "--scenario-file",
        str(replay_file),
        "--output-dir",
        str(replay_dir),
        "--source-repair-manifest",
        source_manifest_ref,
    )

    assert completed.returncode == 0, completed.stdout
    payload = json.loads(completed.stdout)
    evidence_ref = Path(payload["failureDiagnostics"]["viewportRecoveryEvidenceRef"])
    evidence = json.loads(evidence_ref.read_text(encoding="utf8"))
    assert evidence["realWindowEvidence"] is True
    assert evidence["diagnosticOnly"] is False
    assert evidence["targetBindingValidation"]["ok"] is True
    assert evidence["selectedElementId"] == "archive-save-location"
    assert validate_viewport_recovery_evidence(evidence_ref, require_existing_refs=True)["ok"] is True


def test_target_bound_window_host_task_c_long_scroll_viewport_recovery_is_real_window(tmp_path):
    failed_file = write_scenario(tmp_path, viewport_failure_scenario(), name="long-viewport-failed.json")
    failed_dir = tmp_path / "long-viewport-failed"
    failed = run_target_probe(
        "--request-json",
        json.dumps({"task": "fail deeply offscreen target-bound save location", "maxSteps": 1}),
        "--scenario-file",
        str(failed_file),
        "--output-dir",
        str(failed_dir),
    )
    assert failed.returncode == 1, failed.stdout
    source_manifest_ref = json.loads(failed.stdout)["failureDiagnostics"]["repairManifestRef"]

    replay_file = write_scenario(tmp_path, long_scroll_viewport_repaired_scenario(), name="long-viewport-repaired.json")
    replay_dir = tmp_path / "long-viewport-replayed"
    completed = run_target_probe(
        "--request-json",
        json.dumps({"task": "scroll repeatedly and select deeply offscreen target-bound save location", "maxSteps": 4}),
        "--scenario-file",
        str(replay_file),
        "--output-dir",
        str(replay_dir),
        "--source-repair-manifest",
        source_manifest_ref,
    )

    assert completed.returncode == 0, completed.stdout
    payload = json.loads(completed.stdout)
    evidence_ref = Path(payload["failureDiagnostics"]["viewportRecoveryEvidenceRef"])
    evidence = json.loads(evidence_ref.read_text(encoding="utf8"))
    scroll_steps = [step for step in payload["steps"] if step["action"]["kind"] == "scroll"]

    assert len(scroll_steps) == 3
    assert [step["execution"]["metadata"]["stateUpdate"]["details"]["deltaY"] for step in scroll_steps] == [1, 1, 1]
    assert evidence["realWindowEvidence"] is True
    assert evidence["diagnosticOnly"] is False
    assert evidence["selectedElementId"] == "archive-save-location"
    assert evidence["targetBindingValidation"]["ok"] is True
    assert validate_viewport_recovery_evidence(evidence_ref, require_existing_refs=True)["ok"] is True


def write_scenario(tmp_path, scenario, *, name="scenario.json"):
    path = tmp_path / name
    path.write_text(json.dumps(scenario), encoding="utf8")
    return path


def target_six_step_scenario():
    scenario = json.loads(SIX_STEP_FIXTURE.read_text(encoding="utf8"))
    scenario["schemaVersion"] = "sciforge.computer-use.target-bound-window-scenario.v1"
    scenario["id"] = "target-bound-window-six-step"
    scenario["targetWindow"] = {"title": "Package Owned Task B Window"}
    scenario["workflowRequirements"] = {
        "minimumActionCount": 6,
        "requiredInputModalities": ["pointer", "keyboard"],
        "requiresCurrentStepScreenshots": True,
        "forbidPriorRoundCompletionEvidence": True,
        "requiresDirectoryEvidence": True,
    }
    return scenario


def single_app_artifact_scenario():
    base = ".sciforge/vision-runs/target-bound-task-a"
    final_ref = f"{base}/cu-cli-note.md"
    return {
        "schemaVersion": "sciforge.computer-use.target-bound-window-scenario.v1",
        "id": "target-bound-task-a",
        "targetWindow": {"title": "Package Owned Task A Editor"},
        "initialDocumentLines": [],
        "finalArtifactRef": final_ref,
        "screens": [
            screen("a-start", f"{base}/screen-00-start.png", "markdown editor input area"),
            screen("a-focused", f"{base}/screen-01-focused.png", "markdown editor input area"),
            screen("a-content", f"{base}/screen-02-content.png", "markdown editor input area"),
            {
                **screen("a-saved", f"{base}/screen-03-saved.png", "cu-cli-note.md saved entry"),
                "artifacts": {
                    "finalArtifactRef": final_ref,
                    "visibleArtifacts": [{"artifactRef": final_ref, "status": "visible-and-saved"}],
                },
            },
        ],
        "plans": [
            {"type": "click", "targetDescription": "markdown editor input area"},
            {"type": "type_text", "text": "# Target Bound Task A\n\n- title\n- timestamp\n- checklist\n"},
            {"type": "press_key", "key": "Ctrl+S"},
        ],
        "verification": [
            {"ok": True, "done": False, "reason": "editor focused"},
            {"ok": True, "done": False, "reason": "content visible"},
            {"ok": True, "done": True, "reason": "artifact saved", "metadata": {"finalArtifactRef": final_ref}},
        ],
        "files": {},
    }


def one_page_pptx_scenario():
    base = ".sciforge/vision-runs/target-bound-pptx"
    final_ref = f"{base}/computer-use-one-page.pptx"
    return {
        "schemaVersion": "sciforge.computer-use.target-bound-window-scenario.v1",
        "id": "target-bound-one-page-pptx",
        "targetWindow": {"title": "Package Owned Slide Editor"},
        "finalArtifactRef": final_ref,
        "artifactSpec": {"kind": "slide-deck", "slideCount": 1},
        "workflowRequirements": {
            "minimumActionCount": 3,
            "requiredInputModalities": ["pointer", "keyboard"],
            "requiresCurrentStepScreenshots": True,
        },
        "screens": [
            screen("ppt-start", f"{base}/screen-00-start.png", "slide title field"),
            screen("ppt-title", f"{base}/screen-01-title.png", "slide title field focused"),
            screen("ppt-content", f"{base}/screen-02-content.png", "slide body field"),
            {
                **screen("ppt-saved", f"{base}/screen-03-saved.png", "computer-use-one-page.pptx saved entry"),
                "artifacts": {
                    "finalArtifactRef": final_ref,
                    "visibleArtifacts": [{"artifactRef": final_ref, "kind": "slide-deck", "status": "visible-and-saved"}],
                },
            },
        ],
        "plans": [
            {"type": "click", "targetDescription": "slide title field"},
            {
                "type": "type_text",
                "text": "# Computer Use Can Make Slides\n\n- Driven by generic actions\n- Saved by target-bound window host\n- Verified through refs-first evidence\n",
            },
            {"type": "press_key", "key": "Ctrl+S"},
        ],
        "verification": [
            {"ok": True, "done": False, "reason": "slide title field focused"},
            {"ok": True, "done": False, "reason": "slide content visible"},
            {"ok": True, "done": True, "reason": "pptx artifact saved", "metadata": {"finalArtifactRef": final_ref}},
        ],
        "files": {},
    }


def high_risk_dialog_confirmation_scenario():
    scenario = json.loads(FORM_DIALOG_FIXTURE.read_text(encoding="utf8"))
    scenario["id"] = "target-bound-form-dialog-risk"
    scenario["plans"] = [
        {"type": "click", "targetDescription": "Name field"},
        {"type": "type_text", "text": "Name: Ada Lovelace\n"},
        {"type": "press_key", "key": "Tab", "reason": "move to Email field"},
        {"type": "type_text", "text": "Email: ada@example.test\n"},
        {
            "type": "click",
            "targetDescription": "Confirm button",
            "riskLevel": "high",
            "requiresConfirmation": True,
            "reason": "external confirmation dialog action must not execute without approval",
        },
    ]
    scenario["verification"] = [
        {"ok": True, "done": False, "changed": True, "reason": "name field focused"},
        {"ok": True, "done": False, "changed": True, "reason": "name value visible"},
        {"ok": True, "done": False, "changed": True, "reason": "keyboard navigation reached email field"},
        {"ok": True, "done": False, "changed": True, "reason": "review dialog visible"},
    ]
    scenario.pop("finalArtifactRef", None)
    scenario.pop("workflowRequirements", None)
    return scenario


def target_ambiguous_scenario():
    scenario = json.loads(AMBIGUOUS_FIXTURE.read_text(encoding="utf8"))
    scenario["schemaVersion"] = "sciforge.computer-use.target-bound-window-scenario.v1"
    scenario["id"] = "target-bound-ambiguous-before-after"
    scenario["targetWindow"] = {"title": "Package Owned Ambiguous Window"}
    return scenario


def viewport_failure_scenario():
    base = ".sciforge/vision-runs/target-bound-viewport"
    return {
        "schemaVersion": "sciforge.computer-use.target-bound-window-scenario.v1",
        "id": "target-bound-viewport-failure",
        "targetWindow": {"title": "Package Owned Viewport Window"},
        "screens": [
            {
                **screen("viewport-start", f"{base}/screen-00-start.png", "Visible save area"),
                "elements": [
                    element("archive-save-location", "Archive save location", visibility="offscreen"),
                ],
            }
        ],
        "plans": [{"type": "click", "targetDescription": "Archive save location"}],
        "verification": [],
        "files": {},
    }


def unsupported_action_scenario():
    base = ".sciforge/vision-runs/target-bound-unsupported"
    return {
        "schemaVersion": "sciforge.computer-use.target-bound-window-scenario.v1",
        "id": "target-bound-unsupported-action",
        "targetWindow": {"title": "Package Owned Unsupported Action Window"},
        "screens": [
            screen("unsupported-start", f"{base}/screen-00-start.png", "Tooltip target"),
        ],
        "plans": [{"type": "open_app", "appName": "Example App"}],
        "verification": [{"ok": True, "done": True, "reason": "should not be reached"}],
        "files": {},
    }


def viewport_repaired_scenario():
    base = ".sciforge/vision-runs/target-bound-viewport"
    return {
        "schemaVersion": "sciforge.computer-use.target-bound-window-scenario.v1",
        "id": "target-bound-viewport-repaired",
        "targetWindow": {"title": "Package Owned Viewport Window"},
        "screens": [
            screen("viewport-start", f"{base}/screen-10-before-scroll.png", "Visible save area"),
            {
                **screen("viewport-after-scroll", f"{base}/screen-11-after-scroll.png", "Archive save location"),
                "elements": [element("archive-save-location", "Archive save location")],
            },
            {
                **screen("viewport-selected", f"{base}/screen-12-selected.png", "Archive save location selected"),
                "elements": [element("archive-save-location", "Archive save location")],
            },
        ],
        "plans": [
            {"type": "scroll", "direction": "down", "amount": 3},
            {"type": "click", "targetDescription": "Archive save location"},
        ],
        "verification": [
            {"ok": True, "done": False, "reason": "target scrolled into view"},
            {"ok": True, "done": True, "reason": "offscreen target selected"},
        ],
        "files": {},
    }


def long_scroll_viewport_repaired_scenario():
    base = ".sciforge/vision-runs/target-bound-viewport-long"
    return {
        "schemaVersion": "sciforge.computer-use.target-bound-window-scenario.v1",
        "id": "target-bound-viewport-long-repaired",
        "targetWindow": {"title": "Package Owned Long Viewport Window"},
        "screens": [
            screen("long-viewport-start", f"{base}/screen-10-before-scroll.png", "Visible save area"),
            screen("long-viewport-page-1", f"{base}/screen-11-scroll-page-1.png", "Recent locations"),
            screen("long-viewport-page-2", f"{base}/screen-12-scroll-page-2.png", "Older locations"),
            {
                **screen("long-viewport-after-scroll", f"{base}/screen-13-after-scroll.png", "Archive save location"),
                "elements": [element("archive-save-location", "Archive save location")],
            },
            {
                **screen("long-viewport-selected", f"{base}/screen-14-selected.png", "Archive save location selected"),
                "elements": [element("archive-save-location", "Archive save location")],
            },
        ],
        "plans": [
            {"type": "scroll", "direction": "down", "amount": 1},
            {"type": "scroll", "direction": "down", "amount": 1},
            {"type": "scroll", "direction": "down", "amount": 1},
            {"type": "click", "targetDescription": "Archive save location"},
        ],
        "verification": [
            {"ok": True, "done": False, "reason": "first viewport page scrolled"},
            {"ok": True, "done": False, "reason": "second viewport page scrolled"},
            {"ok": True, "done": False, "reason": "target scrolled into view after long scroll"},
            {"ok": True, "done": True, "reason": "deep offscreen target selected"},
        ],
        "files": {},
    }


def screen(screen_id, ref, label):
    return {
        "id": screen_id,
        "ref": ref,
        "summary": label,
        "visibleTexts": [label],
        "elements": [element(label.replace(" ", "-").lower(), label)],
        "metadata": {"realWindowEvidence": True},
    }


def element(element_id, label, *, visibility="visible"):
    return {
        "id": element_id,
        "role": "button",
        "label": label,
        "description": label,
        "visibility": visibility,
        "bounds": {"x": 20, "y": 20, "width": 100, "height": 30},
    }
