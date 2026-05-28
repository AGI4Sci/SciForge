import json
import hashlib
from pathlib import Path

import pytest

from sciforge_computer_use.evidence_ledger import EvidenceLedger
from sciforge_computer_use.isolated_desktop_contracts import (
    BACKEND_KIND,
    BACKEND_READINESS_PROOF_SCHEMA_VERSION,
    EXECUTOR_COMMAND_EVENT_LOG_SCHEMA,
    ISOLATED_CAPTURE_SOURCE,
    ISOLATED_RUNTIME_RESOURCE_ALLOCATION_SCHEMA_VERSION,
    ISOLATED_TARGET_WINDOW_SCHEMA_VERSION,
    LEGACY_L1_RUNTIME_RESOURCE_ALLOCATION_SCHEMA_VERSION,
    LEGACY_L1_TARGET_WINDOW_SCHEMA_VERSION,
    REMOTE_DESKTOP_INPUT_CHANNEL,
    TARGET_ENVIRONMENT_KIND,
)
from sciforge_computer_use.isolated_desktop_l3_workflow_evidence import (
    ISOLATED_DESKTOP_L3_WORKFLOW_EVIDENCE_SCHEMA_VERSION,
    build_isolated_desktop_l3_workflow_evidence,
    validate_isolated_desktop_l3_workflow_evidence,
)
from sciforge_computer_use.visible_viewer import build_visible_run_viewer


PACKAGE_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(autouse=True)
def _relative_modality_tokens_resolve_in_tmp(tmp_path, monkeypatch):
    (tmp_path / "pointer").write_text("", encoding="utf8")
    monkeypatch.chdir(tmp_path)


def test_l3_workflow_builder_and_validator_accept_complete_contract(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)

    built = build_isolated_desktop_l3_workflow_evidence(payload=evidence)
    validation = validate_isolated_desktop_l3_workflow_evidence(built)

    assert built["schemaVersion"] == ISOLATED_DESKTOP_L3_WORKFLOW_EVIDENCE_SCHEMA_VERSION
    assert built["status"] == "completed"
    assert validation["ok"] is True
    assert validation["acceptanceTier"] == "l3-multi-app-workflow"
    assert validation["userAcceptanceEligible"] is True


def test_l3_workflow_validator_requires_existing_refs(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(
        evidence,
        require_existing_refs=False,
    )["errors"]}

    assert "existing_refs_required_for_l3" in codes


def test_l3_workflow_validator_rejects_shape_only_preflight_ref(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    Path(evidence["preflightRef"]).write_text(
        json.dumps({
            "schemaVersion": "sciforge.computer-use.isolated-desktop-backend-probe.v1",
            "status": "ready",
        }),
        encoding="utf8",
    )

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "preflight_backend_kind_mismatch" in codes
    assert "preflight_platform_not_linux" in codes
    assert "preflight_observed_components_missing" in codes
    assert "preflight_novnc_web_root_missing" in codes


def test_l3_workflow_validator_rejects_readiness_only_l3_probe_as_preflight(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    Path(evidence["preflightRef"]).write_text(
        json.dumps({
            "schemaVersion": "sciforge.computer-use.isolated-desktop-l3-workflow-probe.v1",
            "status": "blocked",
            "backendKind": BACKEND_KIND,
            "platform": {"system": "Linux"},
            "userAcceptanceEligible": False,
            "readinessOnly": True,
            "diagnosticOnly": True,
            "executeFailClosed": True,
            "observedRuntimeComponents": {
                "isolatedInputTool": {"status": "found", "path": "/usr/bin/xdotool"},
                "screenshotTool": {"status": "found", "path": "/usr/bin/import"},
                "filePreviewTool": {"status": "found", "path": "/usr/bin/xdg-open"},
            },
        }),
        encoding="utf8",
    )

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "preflight_schema_invalid" in codes
    assert "preflight_not_ready" in codes
    assert "preflight_diagnostic_only" in codes
    assert "preflight_not_acceptance_eligible" in codes
    assert "preflight_readiness_only" in codes
    assert "preflight_fail_closed" in codes


def test_l3_workflow_validator_rejects_target_bound_cross_app_fixture():
    fixture = json.loads((PACKAGE_ROOT / "fixtures/target-bound-cross-app-document-workflow.json").read_text(encoding="utf8"))

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(
        fixture,
        require_existing_refs=False,
    )["errors"]}

    assert "unsupported_schema_version" in codes
    assert "acceptance_tier_not_l3" in codes
    assert "target_environment_kind_not_real_backend" in codes
    assert "user_acceptance_not_eligible" in codes


def test_l3_workflow_validator_rejects_l1_schema_even_with_l3_shaped_fields(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    evidence["schemaVersion"] = "sciforge.computer-use.isolated-desktop-l1-smoke-evidence.v1"
    evidence["acceptanceTier"] = "l1-isolated-smoke"

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "unsupported_schema_version" in codes
    assert "acceptance_tier_not_l3" in codes


def test_l3_workflow_validator_requires_same_session_for_each_app(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    other_session = tmp_path / "other-session.json"
    other_session.write_text(json.dumps({"schemaVersion": "sciforge.computer-use.virtual-desktop-session.v1"}), encoding="utf8")
    evidence["applicationEvidence"][1]["sessionManifestRef"] = str(other_session)

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "application_session_ref_mismatch" in codes


def test_l3_workflow_validator_requires_runtime_refs_same_session(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    capture_stream_ref = Path(evidence["captureStreamRef"])
    capture_stream = json.loads(capture_stream_ref.read_text(encoding="utf8"))
    capture_stream["sessionId"] = "different-session"
    capture_stream_ref.write_text(json.dumps(capture_stream), encoding="utf8")

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "session_runtime_session_id_mismatch" in codes


def test_l3_workflow_validator_requires_runtime_refs_same_display(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    replay_bundle_ref = Path(evidence["replayBundleRef"])
    replay_bundle = json.loads(replay_bundle_ref.read_text(encoding="utf8"))
    replay_bundle["display"] = ":100"
    replay_bundle_ref.write_text(json.dumps(replay_bundle), encoding="utf8")

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "session_runtime_display_mismatch" in codes


def test_l3_workflow_validator_requires_novnc_viewer_localhost(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    novnc_ref = Path(evidence["noVncViewerRef"])
    novnc = json.loads(novnc_ref.read_text(encoding="utf8"))
    novnc["url"] = "http://0.0.0.0:6080/vnc.html"
    novnc["host"] = "0.0.0.0"
    novnc_ref.write_text(json.dumps(novnc), encoding="utf8")

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "novnc_viewer_not_localhost" in codes


def test_l3_workflow_validator_requires_capture_stream_workflow_screenshots(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    capture_stream_ref = Path(evidence["captureStreamRef"])
    capture_stream = json.loads(capture_stream_ref.read_text(encoding="utf8"))
    capture_stream["frameRefs"] = [evidence["screenshotRefs"][0], evidence["screenshotRefs"][1]]
    capture_stream_ref.write_text(json.dumps(capture_stream), encoding="utf8")

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "capture_stream_workflow_frames_missing" in codes


def test_l3_workflow_validator_requires_current_step_screenshots(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    result = json.loads(Path(evidence["resultRef"]).read_text(encoding="utf8"))
    result["steps"][2].pop("afterRef")
    result["steps"][2]["screenshotRefs"] = []
    Path(evidence["resultRef"]).write_text(json.dumps(result), encoding="utf8")

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "current_step_screenshot_ref_missing" in codes


def test_l3_workflow_validator_rejects_stale_completion_support(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    index_ref = Path(evidence["evidenceIndexRef"])
    index = json.loads(index_ref.read_text(encoding="utf8"))
    completion_id = next(record["id"] for record in _read_jsonl(evidence["evidenceLogRef"]) if record["type"] == "completion-claim")
    index["current"] = [completion_id]
    index_ref.write_text(json.dumps(index), encoding="utf8")

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "completion_claim_supports_stale_evidence" in codes
    assert "final_artifact_not_current" in codes


def test_l3_workflow_validator_requires_artifact_validation_to_match_final_artifact(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    validation_ref = Path(evidence["artifactValidationRef"])
    validation = json.loads(validation_ref.read_text(encoding="utf8"))
    validation["path"] = str(tmp_path / "different.docx")
    validation_ref.write_text(json.dumps(validation), encoding="utf8")

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "artifact_validation_path_mismatch" in codes


def test_l3_workflow_validator_requires_file_list_to_show_final_artifact(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    Path(evidence["fileListDataRef"]).write_text(json.dumps({"files": ["unrelated.txt"]}), encoding="utf8")

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "file_list_missing_final_artifact" in codes


def test_l3_workflow_validator_requires_gui_saved_artifact_causality(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    evidence["artifactCausality"]["savedByInputModality"] = "shell"
    evidence["artifactCausality"]["savedThroughGui"] = False
    evidence["artifactCausality"]["shellDirectArtifactWrite"] = True
    evidence["artifactCausality"]["finalArtifactRef"] = str(tmp_path / "unrelated.docx")
    evidence["artifactCausality"]["artifactValidationRef"] = str(tmp_path / "unrelated.validation.json")
    evidence["artifactCausality"]["savedByCommandEventRef"] = "missing-command-ref"

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "artifact_save_keyboard_event_missing" in codes
    assert "artifact_not_saved_through_gui" in codes
    assert "artifact_shell_direct_write_not_forbidden" in codes
    assert "artifact_causality_final_artifact_ref_mismatch" in codes
    assert "artifact_causality_validation_ref_mismatch" in codes
    assert "artifact_save_command_event_mismatch" in codes


def test_l3_workflow_validator_requires_gui_directory_preview_causality(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    evidence["directoryEvidence"]["previewedThroughGui"] = False
    evidence["directoryEvidence"]["shellDirectoryListingOnly"] = True
    evidence["directoryEvidence"]["previewedByActionIndex"] = 2
    evidence["directoryEvidence"]["previewedByInputModality"] = "keyboard"

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "directory_preview_not_gui_backed" in codes
    assert "directory_shell_listing_not_forbidden" in codes
    assert "directory_preview_pointer_event_missing" in codes
    assert "directory_preview_input_modality_invalid" in codes


def test_l3_workflow_validator_requires_source_fact_schema_and_text(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    Path(evidence["derivedContentEvidence"]["supportedFactRefs"][0]).write_text(
        json.dumps({"schemaVersion": "wrong", "fact": "Recovery improved by 12 percent."}),
        encoding="utf8",
    )
    Path(evidence["derivedContentEvidence"]["supportedFactRefs"][1]).write_text(
        json.dumps({"schemaVersion": "sciforge.computer-use.source-fact.v1", "fact": ""}),
        encoding="utf8",
    )

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "source_fact_schema_invalid" in codes
    assert "source_fact_text_missing" in codes


def test_l3_workflow_validator_requires_artifact_validation_hash_to_match_final_artifact(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    validation_ref = Path(evidence["artifactValidationRef"])
    validation = json.loads(validation_ref.read_text(encoding="utf8"))
    validation["sha256"] = "f" * 64
    validation_ref.write_text(json.dumps(validation), encoding="utf8")

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "artifact_validation_sha256_mismatch" in codes


def test_l3_workflow_validator_requires_artifact_validation_text_runs(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    validation_ref = Path(evidence["artifactValidationRef"])
    validation = json.loads(validation_ref.read_text(encoding="utf8"))
    validation.pop("textRuns")
    validation.pop("normalizedText", None)
    validation.pop("plainText", None)
    validation_ref.write_text(json.dumps(validation), encoding="utf8")

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "artifact_validation_text_missing" in codes


def test_l3_workflow_validator_rejects_artifact_without_supported_fact_content(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    validation_ref = Path(evidence["artifactValidationRef"])
    validation = json.loads(validation_ref.read_text(encoding="utf8"))
    validation["textRuns"] = ["An unrelated summary with no supported source fact."]
    validation_ref.write_text(json.dumps(validation), encoding="utf8")

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "artifact_text_missing_supported_source_fact" in codes


def test_l3_workflow_validator_requires_pointer_events_for_pointer_steps(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    pointer_ref = Path(evidence["pointerEventLogRef"])
    pointer_log = json.loads(pointer_ref.read_text(encoding="utf8"))
    pointer_log["events"] = [event for event in pointer_log["events"] if event["actionIndex"] != 4]
    pointer_log["eventCount"] = len(pointer_log["events"])
    pointer_ref.write_text(json.dumps(pointer_log), encoding="utf8")
    input_ref = Path(evidence["inputEventLogRef"])
    input_log = json.loads(input_ref.read_text(encoding="utf8"))
    input_log["events"] = [event for event in input_log["events"] if event["actionIndex"] != 4]
    input_log["eventCount"] = len(input_log["events"])
    input_ref.write_text(json.dumps(input_log), encoding="utf8")

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "input_event_action_indexes_missing" in codes


def test_l3_workflow_validator_requires_keyboard_events_for_type_and_save_steps(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    keyboard_ref = Path(evidence["keyboardEventLogRef"])
    keyboard_log = json.loads(keyboard_ref.read_text(encoding="utf8"))
    keyboard_log["events"] = [event for event in keyboard_log["events"] if event["actionIndex"] != 2]
    keyboard_log["eventCount"] = len(keyboard_log["events"])
    keyboard_ref.write_text(json.dumps(keyboard_log), encoding="utf8")
    input_ref = Path(evidence["inputEventLogRef"])
    input_log = json.loads(input_ref.read_text(encoding="utf8"))
    input_log["events"] = [event for event in input_log["events"] if event["actionIndex"] != 2]
    input_log["eventCount"] = len(input_log["events"])
    input_ref.write_text(json.dumps(input_log), encoding="utf8")

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "input_event_action_indexes_missing" in codes


def test_l3_workflow_validator_requires_runtime_substrate_refs(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    evidence.pop("backendReadinessProofRef")
    evidence.pop("executorCommandEventLogRef")
    evidence.pop("processRef")
    evidence.pop("resourceAllocationRef")

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "required_ref_missing" in codes


def test_l3_workflow_validator_rejects_invalid_backend_readiness_proof(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    proof_ref = Path(evidence["backendReadinessProofRef"])
    proof = json.loads(proof_ref.read_text(encoding="utf8"))
    proof["xDisplay"]["ready"] = False
    proof["novnc"]["httpViewer"]["url"] = "http://0.0.0.0:6080/vnc.html"
    proof_ref.write_text(json.dumps(proof), encoding="utf8")

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "backend_readiness_x_display_invalid" in codes
    assert "backend_readiness_http_viewer_not_localhost" in codes


def test_l3_workflow_validator_rejects_missing_command_provenance(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    input_ref = Path(evidence["inputEventLogRef"])
    input_log = json.loads(input_ref.read_text(encoding="utf8"))
    input_log["events"][0].pop("commandEventId")
    input_log["events"][0].pop("commandEventRef")
    input_ref.write_text(json.dumps(input_log), encoding="utf8")

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "input_event_command_provenance_missing" in codes


def test_l3_workflow_validator_requires_window_bound_pointer_proof(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    evidence.pop("targetWindowRef")
    evidence.pop("windowBoundPointerProofRef")

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "required_ref_missing" in codes
    assert "window_bound_pointer_action_missing" in codes


def test_l3_workflow_validator_rejects_non_window_bound_pointer_command(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    command_ref = Path(evidence["executorCommandEventLogRef"])
    command_log = json.loads(command_ref.read_text(encoding="utf8"))
    command_log["events"][0]["args"] = ["/usr/bin/xdotool", "mousemove", "120", "120", "click", "1"]
    command_ref.write_text(json.dumps(command_log), encoding="utf8")

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "window_bound_pointer_command_not_window_bound" in codes


def test_l3_workflow_validator_rejects_pointer_event_without_target_ref(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    pointer_ref = Path(evidence["pointerEventLogRef"])
    pointer_log = json.loads(pointer_ref.read_text(encoding="utf8"))
    pointer_log["events"][0].pop("targetWindowRef")
    pointer_log["events"][0].pop("windowBoundPointerProofRef")
    pointer_ref.write_text(json.dumps(pointer_log), encoding="utf8")

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "input_event_window_bound_ref_missing" in codes


def test_l3_workflow_validator_rejects_window_bound_proof_target_mismatch(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    proof_ref = Path(evidence["windowBoundPointerProofRef"])
    proof = json.loads(proof_ref.read_text(encoding="utf8"))
    proof["targetWindowRef"] = str(tmp_path / "different-target-window.json")
    proof_ref.write_text(json.dumps(proof), encoding="utf8")

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "window_bound_pointer_target_window_mismatch" in codes


def test_l3_workflow_validator_requires_generic_target_window_schema(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    target_ref = Path(evidence["targetWindowRef"])
    target_window = json.loads(target_ref.read_text(encoding="utf8"))
    target_window["schemaVersion"] = LEGACY_L1_TARGET_WINDOW_SCHEMA_VERSION
    target_ref.write_text(json.dumps(target_window), encoding="utf8")

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "target_window_ref_invalid" in codes


def test_l3_workflow_validator_rejects_window_bound_display_mismatch(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    target_ref = Path(evidence["targetWindowRef"])
    target_window = json.loads(target_ref.read_text(encoding="utf8"))
    target_window["display"] = ":100"
    target_ref.write_text(json.dumps(target_window), encoding="utf8")
    proof_ref = Path(evidence["windowBoundPointerProofRef"])
    proof = json.loads(proof_ref.read_text(encoding="utf8"))
    proof["display"] = ":100"
    proof_ref.write_text(json.dumps(proof), encoding="utf8")

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "target_window_display_mismatch" in codes
    assert "window_bound_pointer_display_mismatch" in codes


def test_l3_workflow_validator_rejects_window_bound_target_miss(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    proof_ref = Path(evidence["windowBoundPointerProofRef"])
    proof = json.loads(proof_ref.read_text(encoding="utf8"))
    proof["pointerActions"][0]["hitPointInWindow"] = {"x": 999, "y": 999}
    proof_ref.write_text(json.dumps(proof), encoding="utf8")

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "window_bound_pointer_target_hit_invalid" in codes


def test_l3_workflow_validator_rejects_window_bound_command_window_mismatch(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    command_ref = Path(evidence["executorCommandEventLogRef"])
    command_log = json.loads(command_ref.read_text(encoding="utf8"))
    args = command_log["events"][0]["args"]
    args[args.index("--window") + 1] = "9999"
    command_ref.write_text(json.dumps(command_log), encoding="utf8")

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "window_bound_pointer_command_window_mismatch" in codes


def test_l3_workflow_validator_rejects_window_bound_command_point_mismatch(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    command_ref = Path(evidence["executorCommandEventLogRef"])
    command_log = json.loads(command_ref.read_text(encoding="utf8"))
    command_log["events"][0]["args"] = ["/usr/bin/xdotool", "mousemove", "--sync", "--window", "3001", "999", "999", "click", "1"]
    command_ref.write_text(json.dumps(command_log), encoding="utf8")

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "window_bound_pointer_command_point_mismatch" in codes


def test_l3_workflow_validator_rejects_window_bound_command_spoofed_point_tokens(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    command_ref = Path(evidence["executorCommandEventLogRef"])
    command_log = json.loads(command_ref.read_text(encoding="utf8"))
    command_log["events"][0]["args"] = [
        "/usr/bin/xdotool",
        "mousemove",
        "--sync",
        "--window",
        "3001",
        "999",
        "999",
        "click",
        "1",
        "120",
        "120",
    ]
    command_ref.write_text(json.dumps(command_log), encoding="utf8")

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "window_bound_pointer_command_not_window_bound" in codes


def test_l3_workflow_validator_rejects_window_bound_target_or_proof_side_effect_flags(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    target_ref = Path(evidence["targetWindowRef"])
    target_window = json.loads(target_ref.read_text(encoding="utf8"))
    target_window["sharedSystemInputUsed"] = True
    target_ref.write_text(json.dumps(target_window), encoding="utf8")
    proof_ref = Path(evidence["windowBoundPointerProofRef"])
    proof = json.loads(proof_ref.read_text(encoding="utf8"))
    proof["systemPointerMoved"] = True
    proof_ref.write_text(json.dumps(proof), encoding="utf8")

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "window_bound_pointer_side_effect_flag" in codes


def test_l3_workflow_validator_rejects_command_display_mismatch(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    command_ref = Path(evidence["executorCommandEventLogRef"])
    command_log = json.loads(command_ref.read_text(encoding="utf8"))
    command_log["events"][0]["display"] = ":100"
    command_log["events"][0]["env"]["DISPLAY"] = ":100"
    command_ref.write_text(json.dumps(command_log), encoding="utf8")

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "input_command_display_mismatch" in codes


def test_l3_workflow_validator_rejects_process_records_without_log_refs(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    process_ref = Path(evidence["processRef"])
    process_payload = json.loads(process_ref.read_text(encoding="utf8"))
    process_payload["processes"][0].pop("stdoutLogRef")
    process_ref.write_text(json.dumps(process_payload), encoding="utf8")

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "process_log_refs_missing" in codes


def test_l3_workflow_validator_rejects_process_ref_session_mismatch(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    process_ref = Path(evidence["processRef"])
    process_payload = json.loads(process_ref.read_text(encoding="utf8"))
    process_payload["sessionId"] = "other-session"
    process_ref.write_text(json.dumps(process_payload), encoding="utf8")

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "process_ref_session_id_mismatch" in codes


def test_l3_workflow_validator_rejects_process_record_session_mismatch(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    process_ref = Path(evidence["processRef"])
    process_payload = json.loads(process_ref.read_text(encoding="utf8"))
    process_payload["processes"][0]["sessionId"] = "other-session"
    process_ref.write_text(json.dumps(process_payload), encoding="utf8")

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "process_record_session_id_mismatch" in codes


def test_l3_workflow_validator_rejects_process_record_display_mismatch(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    process_ref = Path(evidence["processRef"])
    process_payload = json.loads(process_ref.read_text(encoding="utf8"))
    process_payload["processes"][0]["display"] = ":100"
    process_ref.write_text(json.dumps(process_payload), encoding="utf8")

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "process_record_display_mismatch" in codes


def test_l3_workflow_validator_rejects_resource_allocation_display_mismatch(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    resource_ref = Path(evidence["resourceAllocationRef"])
    resource_payload = json.loads(resource_ref.read_text(encoding="utf8"))
    resource_payload["display"] = ":100"
    resource_ref.write_text(json.dumps(resource_payload), encoding="utf8")

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "resource_allocation_display_mismatch" in codes


def test_l3_workflow_validator_rejects_resource_allocation_session_mismatch(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    resource_ref = Path(evidence["resourceAllocationRef"])
    resource_payload = json.loads(resource_ref.read_text(encoding="utf8"))
    resource_payload["sessionId"] = "other-session"
    resource_ref.write_text(json.dumps(resource_payload), encoding="utf8")

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "resource_allocation_session_id_mismatch" in codes


def test_l3_workflow_validator_accepts_legacy_resource_allocation_schema(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    resource_ref = Path(evidence["resourceAllocationRef"])
    resource_payload = json.loads(resource_ref.read_text(encoding="utf8"))
    resource_payload["schemaVersion"] = LEGACY_L1_RUNTIME_RESOURCE_ALLOCATION_SCHEMA_VERSION
    resource_ref.write_text(json.dumps(resource_payload), encoding="utf8")

    assert validate_isolated_desktop_l3_workflow_evidence(evidence)["ok"] is True


def test_l3_workflow_validator_rejects_invalid_resource_allocation_schema(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    resource_ref = Path(evidence["resourceAllocationRef"])
    resource_payload = json.loads(resource_ref.read_text(encoding="utf8"))
    resource_payload["schemaVersion"] = "wrong"
    resource_ref.write_text(json.dumps(resource_payload), encoding="utf8")

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "resource_allocation_schema_invalid" in codes


def test_l3_workflow_validator_rejects_all_identical_screenshot_content(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    for ref in evidence["screenshotRefs"]:
        Path(ref).write_bytes(b"\x89PNG\r\n\x1a\nsame-l3-frame")

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "screenshot_content_diversity_too_low" in codes


def test_l3_workflow_validator_rejects_filesystem_root_file(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    bad_root = tmp_path / "filesystem-root-as-file"
    bad_root.write_text("not a directory", encoding="utf8")
    evidence["filesystemRootRef"] = str(bad_root)

    codes = {error["code"] for error in validate_isolated_desktop_l3_workflow_evidence(evidence)["errors"]}

    assert "filesystem_root_ref_not_directory" in codes


def test_l3_workflow_validator_rejects_final_artifact_symlink_escape(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    final_artifact = Path(evidence["finalArtifactRef"])
    outside_artifact = tmp_path.parent / f"{tmp_path.name}-outside-final-artifact.docx"
    outside_artifact.write_bytes(final_artifact.read_bytes())
    final_artifact.unlink()
    final_artifact.symlink_to(outside_artifact)

    validation = validate_isolated_desktop_l3_workflow_evidence(evidence, require_existing_refs=True)
    codes = {error["code"] for error in validation["errors"]}

    assert validation["ok"] is False
    assert "evidence_ref_symlink_forbidden" in codes


def test_l3_workflow_validator_rejects_absolute_final_artifact_ref(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    evidence["finalArtifactRef"] = str(Path(evidence["finalArtifactRef"]).resolve())
    evidence["artifactCausality"]["finalArtifactRef"] = evidence["finalArtifactRef"]

    validation = validate_isolated_desktop_l3_workflow_evidence(evidence, require_existing_refs=True)
    codes = {error["code"] for error in validation["errors"]}

    assert validation["ok"] is False
    assert "evidence_ref_absolute_forbidden" in codes


def test_l3_workflow_validator_rejects_nested_evidence_symlink_escape(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    source_fact = Path(evidence["sourceEvidence"]["sourceFactRefs"][0])
    outside_fact = tmp_path.parent / f"{tmp_path.name}-outside-source-fact.json"
    outside_fact.write_bytes(source_fact.read_bytes())
    source_fact.unlink()
    source_fact.symlink_to(outside_fact)

    validation = validate_isolated_desktop_l3_workflow_evidence(evidence, require_existing_refs=True)
    codes = {error["code"] for error in validation["errors"]}

    assert validation["ok"] is False
    assert "evidence_ref_symlink_forbidden" in codes


def test_l3_workflow_validator_rejects_nested_evidence_parent_escape(tmp_path):
    evidence = valid_l3_evidence_payload(tmp_path)
    outside_preview = tmp_path.parent / f"{tmp_path.name}-outside-preview.png"
    outside_preview.write_bytes(Path(evidence["directoryEvidence"]["previewObservationRef"]).read_bytes())
    evidence["directoryEvidence"]["previewObservationRef"] = f"../{outside_preview.name}"

    validation = validate_isolated_desktop_l3_workflow_evidence(evidence, require_existing_refs=True)
    codes = {error["code"] for error in validation["errors"]}

    assert validation["ok"] is False
    assert "evidence_ref_parent_traversal_forbidden" in codes


def valid_l3_evidence_payload(tmp_path):
    return valid_l3_evidence_from_refs(write_valid_l3_bundle(tmp_path))


def valid_l3_evidence_from_refs(refs):
    evidence = {
        "schemaVersion": ISOLATED_DESKTOP_L3_WORKFLOW_EVIDENCE_SCHEMA_VERSION,
        "status": "completed",
        "acceptanceTier": "l3-multi-app-workflow",
        "userAcceptanceEligible": True,
        "backendKind": BACKEND_KIND,
        "targetEnvironmentKind": TARGET_ENVIRONMENT_KIND,
        "captureSource": ISOLATED_CAPTURE_SOURCE,
        "inputChannel": REMOTE_DESKTOP_INPUT_CHANNEL,
        "preflightRef": str(refs["preflight"]),
        "preflightStatus": "ready",
        "resultRef": str(refs["result"]),
        "traceRefs": [str(refs["trace"])],
        "screenshotRefs": [str(refs[key]) for key in refs["screenshot_keys"]],
        "viewerManifestRef": str(refs["viewer_manifest"]),
        "viewerHtmlRef": str(refs["viewer_html"]),
        "inputEventLogRef": str(refs["input_log"]),
        "pointerEventLogRef": str(refs["pointer_log"]),
        "keyboardEventLogRef": str(refs["keyboard_log"]),
        "backendReadinessProofRef": str(refs["backend_readiness_proof"]),
        "executorCommandEventLogRef": str(refs["executor_command_log"]),
        "targetWindowRef": str(refs["target_window"]),
        "windowBoundPointerProofRef": str(refs["window_bound_pointer_proof"]),
        "processRef": str(refs["process_ref"]),
        "resourceAllocationRef": str(refs["resource_allocation"]),
        "sessionManifestRef": str(refs["session_manifest"]),
        "virtualDisplayRef": str(refs["virtual_display"]),
        "captureStreamRef": str(refs["capture_stream"]),
        "replayBundleRef": str(refs["replay_bundle"]),
        "filesystemRootRef": str(refs["filesystem_root"]),
        "noVncViewerRef": str(refs["novnc_viewer"]),
        "evidenceLogRef": str(refs["evidence_log"]),
        "evidenceSnapshotRef": str(refs["evidence_snapshot"]),
        "evidenceIndexRef": str(refs["evidence_index"]),
        "plannerBriefRef": str(refs["planner_brief"]),
        "finalArtifactRef": str(refs["final_artifact"]),
        "artifactValidationRef": str(refs["artifact_validation"]),
        "fileListArtifactRef": str(refs["file_list_artifact"]),
        "fileListDataRef": str(refs["file_list_data"]),
        "guiPresentRef": str(refs["gui_present"]),
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
            "workflowKind": "multi-app-document-artifact",
            "sameVirtualSession": True,
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
                "sessionManifestRef": str(refs["session_manifest"]),
                "firstScreenshotRef": str(refs["source_first"]),
                "lastScreenshotRef": str(refs["source_last"]),
                "windowEvidenceRefs": [str(refs["source_first"]), str(refs["source_last"])],
            },
            {
                "appKind": "word-document-writer",
                "sessionManifestRef": str(refs["session_manifest"]),
                "firstScreenshotRef": str(refs["writer_first"]),
                "lastScreenshotRef": str(refs["writer_last"]),
                "windowEvidenceRefs": [str(refs["writer_first"]), str(refs["writer_last"])],
            },
            {
                "appKind": "file-manager-preview",
                "sessionManifestRef": str(refs["session_manifest"]),
                "firstScreenshotRef": str(refs["preview_first"]),
                "lastScreenshotRef": str(refs["preview_last"]),
                "windowEvidenceRefs": [str(refs["preview_first"]), str(refs["preview_last"])],
            },
        ],
        "crossAppTransitions": [
            {
                "fromAppKind": "source-reader",
                "toAppKind": "word-document-writer",
                "sessionManifestRef": str(refs["session_manifest"]),
                "screenshotRef": str(refs["transition_source_writer"]),
            },
            {
                "fromAppKind": "word-document-writer",
                "toAppKind": "file-manager-preview",
                "sessionManifestRef": str(refs["session_manifest"]),
                "screenshotRef": str(refs["transition_writer_preview"]),
            },
        ],
        "sourceEvidence": {
            "sourceObservationRefs": [str(refs["source_last"])],
            "sourceFactRefs": [str(refs["source_fact_recovery"]), str(refs["source_fact_cohorts"])],
        },
        "derivedContentEvidence": {
            "supportedFactRefs": [str(refs["source_fact_recovery"]), str(refs["source_fact_cohorts"])],
        },
        "artifactCausality": {
            "savedByActionIndex": 3,
            "savedByInputModality": "keyboard",
            "savedByCommandEventRef": f"{refs['executor_command_log']}#events/l3-command-003",
            "finalArtifactRef": str(refs["final_artifact"]),
            "artifactValidationRef": str(refs["artifact_validation"]),
            "savedThroughGui": True,
            "shellDirectArtifactWrite": False,
        },
        "directoryEvidence": {
            "fileListArtifactRef": str(refs["file_list_artifact"]),
            "fileListDataRef": str(refs["file_list_data"]),
            "previewObservationRef": str(refs["preview_last"]),
            "directoryObservationAfterSaveRef": str(refs["preview_first"]),
            "previewedByActionIndex": 5,
            "previewedByInputModality": "pointer",
            "previewedThroughGui": True,
            "shellDirectoryListingOnly": False,
        },
        "presentationEvidence": {
            "guiPresentRef": str(refs["gui_present"]),
        },
    }
    return _bundle_local_refs(evidence, refs["root"])


def write_valid_l3_bundle(tmp_path):
    paths = {
        "root": tmp_path,
        "preflight": tmp_path / "isolated-desktop-backend-probe-manifest.json",
        "result": tmp_path / "computer-use-result.json",
        "trace": tmp_path / "vision-trace.json",
        "source_first": tmp_path / "source-first.png",
        "source_last": tmp_path / "source-last.png",
        "writer_first": tmp_path / "writer-first.png",
        "writer_last": tmp_path / "writer-last.png",
        "preview_first": tmp_path / "preview-first.png",
        "preview_last": tmp_path / "preview-last.png",
        "transition_source_writer": tmp_path / "transition-source-writer.png",
        "transition_writer_preview": tmp_path / "transition-writer-preview.png",
        "pointer_log": tmp_path / "input-pointer.json",
        "keyboard_log": tmp_path / "input-keyboard.json",
        "input_log": tmp_path / "input-events.json",
        "backend_readiness_proof": tmp_path / "backend-readiness-proof.json",
        "executor_command_log": tmp_path / "l3-executor-command-events.json",
        "target_window": tmp_path / "l3-target-window.json",
        "window_bound_pointer_proof": tmp_path / "l3-window-bound-pointer-proof.json",
        "process_ref": tmp_path / "backend-processes.json",
        "resource_allocation": tmp_path / "l3-runtime-resource-allocation.json",
        "session_manifest": tmp_path / "virtual-desktop-session-manifest.json",
        "virtual_display": tmp_path / "virtual-display.json",
        "capture_stream": tmp_path / "capture-stream.json",
        "replay_bundle": tmp_path / "replay-bundle.json",
        "filesystem_root": tmp_path / "filesystem-root",
        "novnc_viewer": tmp_path / "novnc-viewer.json",
        "final_artifact": tmp_path / "source-summary.docx",
        "artifact_validation": tmp_path / "source-summary.docx.validation.json",
        "file_list_artifact": tmp_path / "file-list.json",
        "file_list_data": tmp_path / "file-list-data.json",
        "source_fact_recovery": tmp_path / "source-fact-recovery.json",
        "source_fact_cohorts": tmp_path / "source-fact-cohorts.json",
        "gui_present": tmp_path / "gui-present.json",
    }
    paths["screenshot_keys"] = [
        "source_first",
        "source_last",
        "writer_first",
        "writer_last",
        "preview_first",
        "preview_last",
        "transition_source_writer",
        "transition_writer_preview",
    ]
    for index in range(6):
        paths[f"step_{index}_before"] = tmp_path / f"step-{index}-before.png"
        paths[f"step_{index}_after"] = tmp_path / f"step-{index}-after.png"
        paths["screenshot_keys"].append(f"step_{index}_after")

    paths["filesystem_root"].mkdir(parents=True, exist_ok=True)
    for key in paths["screenshot_keys"]:
        paths[key].write_bytes(b"\x89PNG\r\n\x1a\n" + key.encode("utf8"))
    for index in range(6):
        paths[f"step_{index}_before"].write_bytes(b"\x89PNG\r\n\x1a\n" + f"step-{index}-before".encode("utf8"))

    steps = [
        _step(0, "click", "source reader", paths["step_0_before"], paths["source_last"]),
        _step(1, "click", "document body", paths["source_last"], paths["writer_first"]),
        _step(2, "type_text", "document body", paths["writer_first"], paths["writer_last"], text="source summary"),
        _step(3, "save", "document", paths["writer_last"], paths["transition_writer_preview"]),
        _step(4, "click", "file manager", paths["transition_writer_preview"], paths["preview_first"]),
        _step(5, "click", "preview pane", paths["preview_first"], paths["preview_last"], done=True),
    ]
    result = {
        "schemaVersion": "sciforge.computer-use.result.v1",
        "status": "completed",
        "reason": "L3 workflow completed",
        "traceRefs": [str(paths["trace"])],
        "screenshotRefs": [str(paths[key]) for key in paths["screenshot_keys"]],
        "artifactRefs": [str(paths["final_artifact"])],
        "finalArtifactRef": str(paths["final_artifact"]),
        "finalObservationRef": str(paths["preview_last"]),
        "steps": steps,
        "failureDiagnostics": {
            "inputEventLogRef": str(paths["input_log"]),
            "pointerEventLogRef": str(paths["pointer_log"]),
            "keyboardEventLogRef": str(paths["keyboard_log"]),
            "executorCommandEventLogRef": str(paths["executor_command_log"]),
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
        },
    }
    trace = {
        "schemaVersion": "sciforge.computer-use.loop-trace.v1",
        "status": "completed",
        "reason": "L3 workflow completed",
        "traceRefs": [],
        "screenshotRefs": result["screenshotRefs"],
        "artifactRefs": result["artifactRefs"],
        "finalArtifactRef": result["finalArtifactRef"],
        "finalObservationRef": result["finalObservationRef"],
        "steps": steps,
    }
    artifact_text_runs = ["Recovery improved by 12 percent.", "Use two validation cohorts."]
    final_artifact_bytes = ("\n".join(artifact_text_runs) + "\n").encode("utf8")
    paths["final_artifact"].write_bytes(final_artifact_bytes)
    artifact_text = " ".join(artifact_text_runs).strip().casefold()
    session_id = "l3-session"
    display = ":99"
    window_id = "3001"
    vnc_port = 5900
    novnc_port = 6080
    novnc_url = f"http://127.0.0.1:{novnc_port}/vnc.html"
    pointer_targets = {
        0: {"targetId": "source-reader-open", "targetDescription": "source reader", "x": 120, "y": 120, "bounds": {"x": 100, "y": 100, "width": 160, "height": 80}},
        1: {"targetId": "document-body-focus", "targetDescription": "document body", "x": 180, "y": 160, "bounds": {"x": 140, "y": 130, "width": 360, "height": 260}},
        4: {"targetId": "file-manager-open", "targetDescription": "file manager", "x": 220, "y": 180, "bounds": {"x": 190, "y": 150, "width": 240, "height": 160}},
        5: {"targetId": "preview-pane-open", "targetDescription": "preview pane", "x": 260, "y": 200, "bounds": {"x": 230, "y": 170, "width": 260, "height": 180}},
    }
    preflight_components = {
        "virtualDisplay": {"status": "found", "command": "Xvfb", "path": "/usr/bin/Xvfb"},
        "windowManager": {"status": "found", "command": "openbox", "path": "/usr/bin/openbox"},
        "vncServer": {"status": "found", "command": "x11vnc", "path": "/usr/bin/x11vnc"},
        "noVncProxy": {"status": "found", "command": "websockify", "path": "/usr/bin/websockify"},
        "documentApp": {"status": "found", "command": "libreoffice", "path": "/usr/bin/libreoffice"},
        "browser": {"status": "found", "command": "chromium", "path": "/usr/bin/chromium"},
    }
    json_payloads = {
        "preflight": {
            "schemaVersion": "sciforge.computer-use.isolated-desktop-backend-probe.v1",
            "status": "ready",
            "backendKind": BACKEND_KIND,
            "platform": {"system": "Linux", "machine": "x86_64"},
            "observedComponents": preflight_components,
            "noVncWebRoot": "/usr/share/novnc",
            "preflightChecks": [
                {"category": "platform", "ok": True, "reason": ""},
                {"category": "novnc-web-root", "ok": True, "reason": ""},
                *[
                    {"category": name, "ok": True, "reason": ""}
                    for name in preflight_components
                ],
            ],
            "diagnosticOnly": False,
            "userAcceptanceEligible": True,
            "readinessOnly": False,
            "executeFailClosed": False,
        },
        "result": result,
        "trace": trace,
        "backend_readiness_proof": {
            "schemaVersion": BACKEND_READINESS_PROOF_SCHEMA_VERSION,
            "status": "ready",
            "backendKind": BACKEND_KIND,
            "display": display,
            "localhostOnly": True,
            "processRef": str(paths["process_ref"]),
            "xDisplay": {
                "display": display,
                "ready": True,
                "width": 1280,
                "height": 720,
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
                "httpViewer": {
                    "ready": True,
                    "method": "GET",
                    "url": novnc_url,
                    "localhostOnly": True,
                    "statusCode": 200,
                    "bytesRead": 4096,
                    "sha256": "a" * 64,
                    "htmlDetected": True,
                    "noVncMarkerDetected": True,
                    "rawPayloadWritten": False,
                },
            },
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
        },
        "process_ref": {
            "schemaVersion": "sciforge.computer-use.backend-processes.v1",
            "sessionId": session_id,
            "display": display,
            "processes": [
                {
                    "role": role,
                    "status": "running",
                    "sessionId": session_id,
                    "display": display,
                    "pid": index + 1000,
                    "stdoutLogRef": str(tmp_path / f"{role}-stdout.log"),
                    "stderrLogRef": str(tmp_path / f"{role}-stderr.log"),
                    "sharedSystemInputUsed": False,
                    "systemPointerMoved": False,
                    "systemKeyboardEventsSent": False,
                }
                for index, role in enumerate(("virtual-display", "window-manager", "vnc-server", "novnc-proxy", "source-reader", "document-writer", "file-preview"))
            ],
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
        },
        "resource_allocation": {
            "schemaVersion": ISOLATED_RUNTIME_RESOURCE_ALLOCATION_SCHEMA_VERSION,
            "status": "allocated",
            "sessionId": session_id,
            "display": display,
            "vncPort": vnc_port,
            "novncPort": novnc_port,
            "localhostOnly": True,
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
        },
        "target_window": {
            "schemaVersion": ISOLATED_TARGET_WINDOW_SCHEMA_VERSION,
            "status": "ready",
            "display": display,
            "desktopWindow": {
                "windowId": window_id,
                "display": display,
                "title": "SciForge L3 workflow source/writer/preview",
                "visible": True,
                "geometry": {"x": 0, "y": 0, "width": 1280, "height": 720},
            },
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
        },
        "window_bound_pointer_proof": {
            "schemaVersion": "sciforge.computer-use.window-bound-pointer-proof.v1",
            "status": "completed",
            "display": display,
            "inputChannel": REMOTE_DESKTOP_INPUT_CHANNEL,
            "targetWindowRef": str(paths["target_window"]),
            "pointerActions": [
                _window_bound_pointer_action(
                    paths["executor_command_log"],
                    action_index,
                    target,
                    window_id=window_id,
                )
                for action_index, target in pointer_targets.items()
            ],
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
        },
        "executor_command_log": _executor_command_log(paths["executor_command_log"], display, window_id=window_id, pointer_targets=pointer_targets),
        "pointer_log": {
            "schemaVersion": "sciforge.computer-use.target-pointer-state.v1",
            "eventCount": 4,
            "events": [
                _pointer_input_event(paths, 0, pointer_targets[0]),
                _pointer_input_event(paths, 1, pointer_targets[1]),
                _pointer_input_event(paths, 4, pointer_targets[4]),
                _pointer_input_event(paths, 5, pointer_targets[5]),
            ],
        },
        "keyboard_log": {
            "schemaVersion": "sciforge.computer-use.target-keyboard-state.v1",
            "eventCount": 2,
            "events": [
                _input_event(paths["executor_command_log"], 2, "keyboard", "type_text", textLength=14),
                _input_event(paths["executor_command_log"], 3, "keyboard", "hotkey", keys=["Ctrl", "S"]),
            ],
        },
        "input_log": {
            "schemaVersion": "sciforge.computer-use.target-input-event-log.v1",
            "eventCount": 6,
            "events": [
                _pointer_input_event(paths, 0, pointer_targets[0]),
                _pointer_input_event(paths, 1, pointer_targets[1]),
                _input_event(paths["executor_command_log"], 2, "keyboard", "type_text"),
                _input_event(paths["executor_command_log"], 3, "keyboard", "hotkey"),
                _pointer_input_event(paths, 4, pointer_targets[4]),
                _pointer_input_event(paths, 5, pointer_targets[5]),
            ],
        },
        "session_manifest": {
            "schemaVersion": "sciforge.computer-use.virtual-desktop-session.v1",
            "status": "open",
            "sessionId": session_id,
            "display": display,
            "backendKind": BACKEND_KIND,
        },
        "virtual_display": {
            "schemaVersion": "sciforge.computer-use.virtual-display-ref.v1",
            "status": "running",
            "sessionId": session_id,
            "display": display,
        },
        "capture_stream": {
            "schemaVersion": "sciforge.computer-use.capture-stream-ref.v1",
            "status": "running",
            "sessionId": session_id,
            "display": display,
            "frameRefs": [str(paths[key]) for key in paths["screenshot_keys"]],
        },
        "replay_bundle": {
            "schemaVersion": "sciforge.computer-use.replay-bundle-ref.v1",
            "status": "completed",
            "sessionId": session_id,
            "display": display,
            "timelineRefs": [str(paths["trace"])],
        },
        "novnc_viewer": {
            "schemaVersion": "sciforge.computer-use.novnc-viewer-ref.v1",
            "status": "running",
            "sessionId": session_id,
            "display": display,
            "url": novnc_url,
            "host": "127.0.0.1",
            "port": novnc_port,
        },
        "artifact_validation": {
            "schemaVersion": "sciforge.computer-use.docx-validation.v1",
            "ok": True,
            "path": str(paths["final_artifact"].resolve()),
            "sizeBytes": 128,
            "sha256": hashlib.sha256(final_artifact_bytes).hexdigest(),
            "paragraphCount": 4,
            "tableCount": 1,
            "macrosForbidden": True,
            "textRuns": artifact_text_runs,
            "textRunCount": len(artifact_text_runs),
            "textCharCount": sum(len(text) for text in artifact_text_runs),
            "normalizedTextSha256": hashlib.sha256(artifact_text.encode("utf8")).hexdigest(),
            "errors": [],
        },
        "file_list_artifact": {
            "schemaVersion": "sciforge.computer-use.file-list-evidence.v1",
            "entries": [{"name": paths["final_artifact"].name, "type": "file"}],
        },
        "file_list_data": {"files": [paths["final_artifact"].name, paths["file_list_artifact"].name]},
        "source_fact_recovery": {"schemaVersion": "sciforge.computer-use.source-fact.v1", "fact": "Recovery improved by 12 percent."},
        "source_fact_cohorts": {"schemaVersion": "sciforge.computer-use.source-fact.v1", "fact": "Use two validation cohorts."},
        "gui_present": {
            "schemaVersion": "sciforge.gui.present-payload.v1",
            "artifactRefs": [str(paths["final_artifact"])],
            "traceRefs": [str(paths["trace"])],
        },
    }
    for payload in json_payloads["process_ref"]["processes"]:
        Path(payload["stdoutLogRef"]).write_text("", encoding="utf8")
        Path(payload["stderrLogRef"]).write_text("", encoding="utf8")
    for key, payload in json_payloads.items():
        paths[key].write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf8")

    evidence_dir = tmp_path / "evidence"
    ledger = EvidenceLedger(evidence_dir)
    source_id = ledger.append_record("observation", loop_phase="evidence", ref=str(paths["source_last"]), summary="Source facts visible")
    artifact_id = ledger.append_record("artifact", loop_phase="evidence", action_index=3, ref=str(paths["final_artifact"]), summary="Saved source summary")
    directory_id = ledger.append_record("observation", loop_phase="evidence", action_index=5, ref=str(paths["preview_last"]), summary="Directory preview visible")
    verification_id = ledger.append_record(
        "verification",
        loop_phase="action",
        action_index=5,
        refs=[str(paths["file_list_artifact"]), str(paths["file_list_data"])],
        summary="Artifact and directory preview verified",
        derived_from=[source_id, artifact_id, directory_id],
        verified_by=[directory_id],
    )
    ledger.append_completion_claim(
        action_index=5,
        summary="L3 workflow complete",
        status="completed",
        supports=[source_id, artifact_id, directory_id, verification_id],
    )
    paths.update({
        "evidence_log": evidence_dir / "evidence-log.jsonl",
        "evidence_snapshot": evidence_dir / "evidence-snapshot.json",
        "evidence_index": evidence_dir / "evidence-index.json",
        "planner_brief": evidence_dir / "planner-brief.json",
    })

    viewer = build_visible_run_viewer(output_dir=tmp_path, result=result, result_ref=paths["result"], title="L3 workflow")
    paths["viewer_manifest"] = tmp_path / "visible-run-viewer-manifest.json"
    paths["viewer_html"] = Path(viewer["viewerHtmlRef"])
    _rewrite_bundle_files_with_local_refs(tmp_path)
    return paths


def _rewrite_bundle_files_with_local_refs(root):
    root_prefix = f"{root}/"
    for path in root.rglob("*"):
        if path.suffix not in {".json", ".jsonl"}:
            continue
        path.write_text(path.read_text(encoding="utf8").replace(root_prefix, ""), encoding="utf8")


def _bundle_local_refs(value, root):
    if isinstance(value, dict):
        return {key: _bundle_local_refs(item, root) for key, item in value.items()}
    if isinstance(value, list):
        return [_bundle_local_refs(item, root) for item in value]
    if not isinstance(value, str):
        return value
    path_text, separator, fragment = value.partition("#")
    root_prefix = f"{root}/"
    if path_text.startswith(root_prefix):
        return path_text.removeprefix(root_prefix) + (separator + fragment if separator else "")
    return value


def _step(index, kind, target, before_ref, after_ref, *, text=None, done=False):
    return {
        "index": index,
        "status": "completed",
        "beforeRef": str(before_ref),
        "afterRef": str(after_ref),
        "screenshotRefs": [str(after_ref)],
        "action": {"kind": kind, "target": target, "text": text},
        "verification": {"ok": True, "done": done, "changed": True, "reason": "screen changed"},
    }


def _input_event(command_log_ref, action_index, modality, kind, **extra):
    command_id = f"l3-command-{action_index:03d}"
    return {
        "modality": modality,
        "actionIndex": action_index,
        "kind": kind,
        "commandEventId": command_id,
        "commandEventLogRef": str(command_log_ref),
        "commandEventRef": f"{command_log_ref}#events/{command_id}",
        **extra,
    }


def _pointer_input_event(paths, action_index, target):
    return _input_event(
        paths["executor_command_log"],
        action_index,
        "pointer",
        "click",
        coordinateSpace="window",
        windowX=target["x"],
        windowY=target["y"],
        x=target["x"],
        y=target["y"],
        targetId=target["targetId"],
        targetWindowRef=str(paths["target_window"]),
        windowBoundPointerProofRef=str(paths["window_bound_pointer_proof"]),
        targetProofRef=f"{paths['window_bound_pointer_proof']}#pointerActions/{action_index}",
    )


def _window_bound_pointer_action(command_log_ref, action_index, target, *, window_id):
    return {
        "actionIndex": action_index,
        "kind": "click",
        "targetId": target["targetId"],
        "targetDescription": target["targetDescription"],
        "targetBoundsInWindow": target["bounds"],
        "hitPointInWindow": {"x": target["x"], "y": target["y"]},
        "pointInsideTargetBounds": True,
        "windowBoundsAtDispatch": {"windowId": window_id, "x": 0, "y": 0, "width": 1280, "height": 720},
        "commandEventId": f"l3-command-{action_index:03d}",
        "commandEventLogRef": str(command_log_ref),
        "commandEventRef": f"{command_log_ref}#events/l3-command-{action_index:03d}",
        "coordinateSpace": "window",
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
    }


def _executor_command_log(command_log_ref, display, *, window_id, pointer_targets):
    events = []
    for action_index, modality, kind, args in (
        (0, "pointer", "click", _window_bound_click_args(window_id, pointer_targets[0])),
        (1, "pointer", "click", _window_bound_click_args(window_id, pointer_targets[1])),
        (2, "keyboard", "type_text", ["/usr/bin/xdotool", "type", "--delay", "20", "source summary"]),
        (3, "keyboard", "hotkey", ["/usr/bin/xdotool", "key", "ctrl+s"]),
        (4, "pointer", "click", _window_bound_click_args(window_id, pointer_targets[4])),
        (5, "pointer", "click", _window_bound_click_args(window_id, pointer_targets[5])),
    ):
        events.append({
            "id": f"l3-command-{action_index:03d}",
            "sequence": action_index,
            "timestamp": 1000.0 + action_index,
            "role": kind,
            "actionIndex": action_index,
            "actionKind": kind,
            "inputModality": modality,
            "inputChannel": REMOTE_DESKTOP_INPUT_CHANNEL,
            "args": args,
            "env": {"DISPLAY": display},
            "display": display,
            "returncode": 0,
            "stdoutSummary": "",
            "stderrSummary": "",
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
        })
    return {
        "schemaVersion": EXECUTOR_COMMAND_EVENT_LOG_SCHEMA,
        "eventCount": len(events),
        "inputChannel": REMOTE_DESKTOP_INPUT_CHANNEL,
        "events": events,
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
    }


def _window_bound_click_args(window_id, target):
    return [
        "/usr/bin/xdotool",
        "mousemove",
        "--sync",
        "--window",
        window_id,
        str(target["x"]),
        str(target["y"]),
        "click",
        "1",
    ]


def _read_jsonl(path):
    return [json.loads(line) for line in Path(path).read_text(encoding="utf8").splitlines() if line.strip()]
