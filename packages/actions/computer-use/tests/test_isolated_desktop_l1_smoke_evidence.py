import hashlib
import json
from pathlib import Path

from sciforge_computer_use.evidence_ledger import EvidenceLedger
from sciforge_computer_use.isolated_desktop_backend_probe import build_isolated_desktop_backend_manifest
from sciforge_computer_use.isolated_desktop_contracts import (
    BACKEND_KIND,
    BACKEND_READINESS_PROOF_SCHEMA_VERSION,
    EXECUTOR_COMMAND_EVENT_LOG_SCHEMA,
    ISOLATED_DESKTOP_BACKEND_PROBE_SCHEMA_VERSION,
    ISOLATED_RUNTIME_RESOURCE_ALLOCATION_SCHEMA_VERSION,
    LEGACY_L1_TARGET_WINDOW_SCHEMA_VERSION,
    REMOTE_DESKTOP_INPUT_CHANNEL,
)
from sciforge_computer_use.isolated_desktop_l1_smoke_evidence import (
    ISOLATED_DESKTOP_L1_SMOKE_EVIDENCE_SCHEMA_VERSION,
    build_isolated_desktop_l1_smoke_evidence,
    validate_isolated_desktop_l1_smoke_evidence,
)
from sciforge_computer_use.visible_viewer import build_visible_run_viewer


def test_l1_smoke_validator_rejects_readiness_probe_manifest(tmp_path):
    command_paths = {
        "Xvfb": "/usr/bin/Xvfb",
        "openbox": "/usr/bin/openbox",
        "x11vnc": "/usr/bin/x11vnc",
        "websockify": "/usr/bin/websockify",
        "libreoffice": "/usr/bin/libreoffice",
        "chromium": "/usr/bin/chromium",
    }
    readiness = build_isolated_desktop_backend_manifest(
        output_dir=tmp_path / "backend",
        platform_system="Linux",
        command_resolver=lambda command: command_paths.get(command),
        path_exists=lambda path: path == "/usr/share/novnc",
    )

    validation = validate_isolated_desktop_l1_smoke_evidence(readiness)
    codes = {error["code"] for error in validation["errors"]}

    assert validation["ok"] is False
    assert "unsupported_schema_version" in codes
    assert "acceptance_tier_not_l1" in codes
    assert "l1_smoke_not_completed" in codes
    assert "l1_flag_mismatch" in codes


def test_l1_smoke_builder_and_validator_accept_complete_real_backend_contract(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)

    evidence = build_isolated_desktop_l1_smoke_evidence(
        refs["preflight"],
        refs["result"],
        refs["trace"],
        initial_screenshot_ref=str(refs["before"]),
        final_screenshot_ref=str(refs["after"]),
        screenshot_refs=[str(refs["before"]), str(refs["after"]), str(refs["step_0_after"]), str(refs["step_3_after"])],
        real_window_evidence_refs=[
            str(refs["before"]),
            str(refs["after"]),
            str(refs["pointer_log"]),
            str(refs["keyboard_log"]),
            str(refs["input_log"]),
            str(refs["backend_readiness_proof"]),
            str(refs["executor_command_log"]),
            str(refs["target_window"]),
            str(refs["window_bound_pointer_proof"]),
            str(refs["process_ref"]),
            str(refs["resource_allocation"]),
        ],
        viewer_manifest_ref=str(refs["viewer_manifest"]),
        viewer_html_ref=str(refs["viewer_html"]),
        input_event_log_ref=str(refs["input_log"]),
        pointer_event_log_ref=str(refs["pointer_log"]),
        keyboard_event_log_ref=str(refs["keyboard_log"]),
        session_manifest_ref=str(refs["session_manifest"]),
        virtual_display_ref=str(refs["virtual_display"]),
        capture_stream_ref=str(refs["capture_stream"]),
        replay_bundle_ref=str(refs["replay_bundle"]),
        filesystem_root_ref=str(refs["filesystem_root"]),
        no_vnc_viewer_ref=str(refs["novnc_viewer"]),
        backend_readiness_proof_ref=str(refs["backend_readiness_proof"]),
        executor_command_event_log_ref=str(refs["executor_command_log"]),
        target_window_ref=str(refs["target_window"]),
        window_bound_pointer_proof_ref=str(refs["window_bound_pointer_proof"]),
        process_ref=str(refs["process_ref"]),
        resource_allocation_ref=str(refs["resource_allocation"]),
        evidence_log_ref=str(refs["evidence_log"]),
        evidence_snapshot_ref=str(refs["evidence_snapshot"]),
        evidence_index_ref=str(refs["evidence_index"]),
        planner_brief_ref=str(refs["planner_brief"]),
        input_adapter_manifest_ref=str(refs["input_adapter_manifest"]),
        input_adapter_binding_manifest_ref=str(refs["input_adapter_binding_manifest"]),
    )

    assert evidence["schemaVersion"] == ISOLATED_DESKTOP_L1_SMOKE_EVIDENCE_SCHEMA_VERSION
    assert evidence["status"] == "completed"
    assert evidence["inputChannel"] == REMOTE_DESKTOP_INPUT_CHANNEL
    assert evidence["diagnosticOnly"] is False
    assert evidence["realWindowEvidence"] is True
    assert evidence["processRef"] == str(refs["process_ref"])
    assert evidence["resourceAllocationRef"] == str(refs["resource_allocation"])

    validation = validate_isolated_desktop_l1_smoke_evidence(evidence, require_existing_refs=True)
    assert validation["ok"] is True
    assert validation["acceptanceTier"] == "l1-isolated-smoke"
    assert validation["userAcceptanceEligible"] is True


def test_l1_smoke_builder_blocks_when_required_refs_do_not_exist(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    refs["session_manifest"].unlink()

    evidence = build_isolated_desktop_l1_smoke_evidence(
        refs["preflight"],
        refs["result"],
        refs["trace"],
        initial_screenshot_ref=str(refs["before"]),
        final_screenshot_ref=str(refs["after"]),
        screenshot_refs=[str(refs["before"]), str(refs["after"])],
        real_window_evidence_refs=[str(refs["before"]), str(refs["after"])],
        viewer_manifest_ref=str(refs["viewer_manifest"]),
        viewer_html_ref=str(refs["viewer_html"]),
        input_event_log_ref=str(refs["input_log"]),
        pointer_event_log_ref=str(refs["pointer_log"]),
        keyboard_event_log_ref=str(refs["keyboard_log"]),
        session_manifest_ref=str(refs["session_manifest"]),
        virtual_display_ref=str(refs["virtual_display"]),
        capture_stream_ref=str(refs["capture_stream"]),
        replay_bundle_ref=str(refs["replay_bundle"]),
        filesystem_root_ref=str(refs["filesystem_root"]),
        no_vnc_viewer_ref=str(refs["novnc_viewer"]),
        evidence_log_ref=str(refs["evidence_log"]),
        evidence_snapshot_ref=str(refs["evidence_snapshot"]),
        evidence_index_ref=str(refs["evidence_index"]),
        planner_brief_ref=str(refs["planner_brief"]),
    )

    assert evidence["status"] == "blocked"
    assert any(error["code"] == "evidence_ref_not_found" for error in evidence["errors"])


def test_l1_smoke_validator_requires_filesystem_root_directory(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    bad_root = tmp_path / "filesystem-root-as-file"
    bad_root.write_text("not a directory", encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)
    evidence["filesystemRootRef"] = str(bad_root)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "filesystem_root_ref_not_directory" in codes


def test_l1_smoke_validator_rejects_target_bound_fixture_channel(tmp_path):
    evidence = valid_l1_evidence_payload(tmp_path)
    evidence["inputChannel"] = "target-bound-simulated-input"
    evidence["targetEnvironmentKind"] = "package-owned-target-bound-window"

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "input_channel_not_remote_desktop" in codes
    assert "target_environment_kind_not_real_backend" in codes


def test_l1_smoke_validator_requires_shared_target_environment_kind(tmp_path):
    evidence = valid_l1_evidence_payload(tmp_path)
    evidence["targetEnvironmentKind"] = "linux-rdp-session"

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "target_environment_kind_not_isolated_desktop" in codes


def test_l1_smoke_validator_semantically_validates_preflight_schema(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    preflight = json.loads(refs["preflight"].read_text(encoding="utf8"))
    preflight["schemaVersion"] = "wrong"
    refs["preflight"].write_text(json.dumps(preflight), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "preflight_schema_invalid" in codes


def test_l1_smoke_validator_accepts_backend_probe_diagnostic_only_preflight(tmp_path):
    evidence = valid_l1_evidence_payload(tmp_path)

    validation = validate_isolated_desktop_l1_smoke_evidence(evidence)
    codes = {error["code"] for error in validation["errors"]}

    assert validation["ok"] is True
    assert "preflight_diagnostic_only" not in codes
    assert "preflight_not_acceptance_eligible" not in codes


def test_l1_smoke_validator_rejects_non_linux_preflight(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    preflight = json.loads(refs["preflight"].read_text(encoding="utf8"))
    preflight["platform"]["system"] = "Darwin"
    refs["preflight"].write_text(json.dumps(preflight), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "preflight_platform_not_linux" in codes


def test_l1_smoke_validator_rejects_wrong_preflight_backend(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    preflight = json.loads(refs["preflight"].read_text(encoding="utf8"))
    preflight["backendKind"] = "linux-rdp-browser"
    refs["preflight"].write_text(json.dumps(preflight), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "preflight_backend_kind_mismatch" in codes


def test_l1_smoke_validator_rejects_missing_preflight_component(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    preflight = json.loads(refs["preflight"].read_text(encoding="utf8"))
    preflight["observedComponents"].pop("browser")
    refs["preflight"].write_text(json.dumps(preflight), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "preflight_observed_components_missing" in codes


def test_l1_smoke_validator_rejects_not_ready_preflight_component(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    preflight = json.loads(refs["preflight"].read_text(encoding="utf8"))
    preflight["observedComponents"]["browser"] = {"status": "missing", "command": "chromium", "path": None}
    refs["preflight"].write_text(json.dumps(preflight), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "preflight_observed_components_not_ready" in codes


def test_l1_smoke_validator_rejects_missing_preflight_novnc_root(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    preflight = json.loads(refs["preflight"].read_text(encoding="utf8"))
    preflight.pop("noVncWebRoot")
    refs["preflight"].write_text(json.dumps(preflight), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "preflight_novnc_web_root_missing" in codes


def test_l1_smoke_validator_rejects_failed_preflight_checks(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    preflight = json.loads(refs["preflight"].read_text(encoding="utf8"))
    preflight["preflightChecks"][0]["ok"] = False
    preflight["preflightChecks"][0]["reason"] = "wrong-os"
    refs["preflight"].write_text(json.dumps(preflight), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "preflight_checks_not_ok" in codes


def test_l1_smoke_validator_rejects_readiness_only_or_fail_closed_preflight(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    preflight = json.loads(refs["preflight"].read_text(encoding="utf8"))
    preflight["readinessOnly"] = True
    preflight["executeFailClosed"] = True
    refs["preflight"].write_text(json.dumps(preflight), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "preflight_readiness_only" in codes
    assert "preflight_fail_closed" in codes


def test_l1_smoke_validator_requires_distinct_before_after_screenshots(tmp_path):
    evidence = valid_l1_evidence_payload(tmp_path)
    evidence["finalScreenshotRef"] = evidence["initialScreenshotRef"]

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "screenshot_refs_not_distinct" in codes


def test_l1_smoke_validator_rejects_identical_before_after_screenshot_content(tmp_path):
    evidence = valid_l1_evidence_payload(tmp_path)
    Path(evidence["finalScreenshotRef"]).write_bytes(Path(evidence["initialScreenshotRef"]).read_bytes())

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "screenshot_content_not_changed" in codes


def test_l1_smoke_validator_rejects_unchanged_last_step_screenshot_content(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    refs["step_3_before"].write_bytes(refs["after"].read_bytes())
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "step_screenshot_content_not_changed" in codes


def test_l1_smoke_validator_rejects_placeholder_only_viewer(tmp_path):
    refs = write_valid_l1_bundle(tmp_path, with_screenshots=False)
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "viewer_real_frames_too_few" in codes


def test_l1_smoke_validator_requires_pointer_and_keyboard_logs(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    evidence = valid_l1_evidence_from_refs(refs)
    Path(evidence["keyboardEventLogRef"]).write_text(
        json.dumps({
            "schemaVersion": "sciforge.computer-use.target-keyboard-state.v1",
            "eventCount": 0,
            "events": [],
        }),
        encoding="utf8",
    )

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "required_input_event_log_missing" in codes


def test_l1_smoke_validator_requires_backend_readiness_proof_ref(tmp_path):
    evidence = valid_l1_evidence_payload(tmp_path)
    evidence.pop("backendReadinessProofRef")

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "required_ref_missing" in codes


def test_l1_smoke_validator_requires_process_and_resource_allocation_refs(tmp_path):
    evidence = valid_l1_evidence_payload(tmp_path)
    evidence.pop("processRef")
    evidence.pop("resourceAllocationRef")

    validation = validate_isolated_desktop_l1_smoke_evidence(evidence)
    missing_paths = {
        error["path"]
        for error in validation["errors"]
        if error["code"] == "required_ref_missing"
    }

    assert "$.processRef" in missing_paths
    assert "$.resourceAllocationRef" in missing_paths


def test_l1_smoke_validator_requires_executor_command_event_log_ref(tmp_path):
    evidence = valid_l1_evidence_payload(tmp_path)
    evidence.pop("executorCommandEventLogRef")
    result = json.loads(Path(evidence["resultRef"]).read_text(encoding="utf8"))
    result["failureDiagnostics"].pop("executorCommandEventLogRef")
    Path(evidence["resultRef"]).write_text(json.dumps(result), encoding="utf8")

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "required_ref_missing" in codes
    assert "command_event_log_ref_missing" in codes


def test_l1_smoke_validator_rejects_invalid_backend_readiness_proof_payload(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    refs["backend_readiness_proof"].write_text(
        json.dumps({
            "schemaVersion": BACKEND_READINESS_PROOF_SCHEMA_VERSION,
            "status": "blocked",
            "backendKind": "linux-novnc-libreoffice-browser",
            "localhostOnly": False,
            "vnc": {"host": "0.0.0.0", "port": 5900, "ready": False},
            "novnc": {"host": "127.0.0.1", "port": 6080, "ready": True},
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
        }),
        encoding="utf8",
    )
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "backend_readiness_proof_not_ready" in codes
    assert "backend_readiness_proof_not_localhost_only" in codes
    assert "backend_readiness_endpoint_not_ready" in codes


def test_l1_smoke_validator_requires_novnc_http_viewer_proof(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    proof = json.loads(refs["backend_readiness_proof"].read_text(encoding="utf8"))
    proof["novnc"].pop("httpViewer")
    refs["backend_readiness_proof"].write_text(json.dumps(proof), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "backend_readiness_http_viewer_missing" in codes


def test_l1_smoke_validator_rejects_process_records_without_log_refs(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    process_payload = json.loads(refs["process_ref"].read_text(encoding="utf8"))
    process_payload["processes"][0].pop("stdoutLogRef")
    refs["process_ref"].write_text(json.dumps(process_payload), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "process_log_refs_missing" in codes


def test_l1_smoke_validator_requires_runtime_process_role_coverage(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    process_payload = json.loads(refs["process_ref"].read_text(encoding="utf8"))
    process_payload["processes"] = [
        process
        for process in process_payload["processes"]
        if process.get("role") != "browser"
    ]
    refs["process_ref"].write_text(json.dumps(process_payload), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "process_required_roles_missing" in codes


def test_l1_smoke_validator_requires_existing_process_log_refs(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    refs["process_browser_stdout"].unlink()
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "process_log_ref_not_found" in codes


def test_l1_smoke_validator_rejects_backend_readiness_process_ref_mismatch(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    proof = json.loads(refs["backend_readiness_proof"].read_text(encoding="utf8"))
    proof["processRef"] = str(tmp_path / "other-backend-processes.json")
    refs["backend_readiness_proof"].write_text(json.dumps(proof), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "backend_readiness_process_ref_mismatch" in codes


def test_l1_smoke_validator_requires_backend_readiness_process_ref(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    proof = json.loads(refs["backend_readiness_proof"].read_text(encoding="utf8"))
    proof.pop("processRef")
    refs["backend_readiness_proof"].write_text(json.dumps(proof), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "backend_readiness_process_ref_missing" in codes


def test_l1_smoke_validator_rejects_invalid_resource_allocation_schema(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    allocation = json.loads(refs["resource_allocation"].read_text(encoding="utf8"))
    allocation["schemaVersion"] = "wrong"
    refs["resource_allocation"].write_text(json.dumps(allocation), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "resource_allocation_schema_invalid" in codes


def test_l1_smoke_validator_rejects_blocked_resource_allocation(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    allocation = json.loads(refs["resource_allocation"].read_text(encoding="utf8"))
    allocation["status"] = "blocked-port-conflict"
    refs["resource_allocation"].write_text(json.dumps(allocation), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "resource_allocation_blocked" in codes


def test_l1_smoke_validator_rejects_released_after_blocked_resource_allocation(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    allocation = json.loads(refs["resource_allocation"].read_text(encoding="utf8"))
    allocation["status"] = "released-after-blocked"
    refs["resource_allocation"].write_text(json.dumps(allocation), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "resource_allocation_blocked" in codes


def test_l1_smoke_validator_rejects_resource_allocation_display_mismatch(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    allocation = json.loads(refs["resource_allocation"].read_text(encoding="utf8"))
    allocation["display"] = ":100"
    refs["resource_allocation"].write_text(json.dumps(allocation), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "resource_allocation_display_mismatch" in codes


def test_l1_smoke_validator_rejects_resource_allocation_vnc_port_mismatch(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    allocation = json.loads(refs["resource_allocation"].read_text(encoding="utf8"))
    allocation["vncPort"] = 5901
    refs["resource_allocation"].write_text(json.dumps(allocation), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "resource_allocation_vnc_port_mismatch" in codes


def test_l1_smoke_validator_rejects_resource_allocation_port_collision(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    allocation = json.loads(refs["resource_allocation"].read_text(encoding="utf8"))
    readiness = json.loads(refs["backend_readiness_proof"].read_text(encoding="utf8"))
    allocation["novncPort"] = allocation["vncPort"]
    readiness["novnc"]["port"] = allocation["vncPort"]
    refs["resource_allocation"].write_text(json.dumps(allocation), encoding="utf8")
    refs["backend_readiness_proof"].write_text(json.dumps(readiness), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "resource_allocation_ports_collide" in codes


def test_l1_smoke_validator_rejects_resource_allocation_novnc_port_mismatch(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    allocation = json.loads(refs["resource_allocation"].read_text(encoding="utf8"))
    allocation["novncPort"] = 6081
    refs["resource_allocation"].write_text(json.dumps(allocation), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "resource_allocation_novnc_port_mismatch" in codes


def test_l1_smoke_validator_requires_x_display_readiness_proof(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    proof = json.loads(refs["backend_readiness_proof"].read_text(encoding="utf8"))
    proof.pop("xDisplay")
    refs["backend_readiness_proof"].write_text(json.dumps(proof), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "backend_readiness_x_display_missing" in codes


def test_l1_smoke_validator_requires_browser_window_and_page_proof(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    proof = json.loads(refs["backend_readiness_proof"].read_text(encoding="utf8"))
    proof.pop("desktopWindow")
    proof.pop("page")
    refs["backend_readiness_proof"].write_text(json.dumps(proof), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "backend_readiness_desktop_window_missing" in codes


def test_l1_smoke_validator_requires_window_bound_pointer_proof(tmp_path):
    evidence = valid_l1_evidence_payload(tmp_path)
    evidence.pop("windowBoundPointerProofRef")

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "required_ref_missing" in codes


def test_l1_smoke_validator_rejects_bare_global_pointer_command(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    command_log = json.loads(refs["executor_command_log"].read_text(encoding="utf8"))
    command_log["events"][0]["args"] = ["/usr/bin/xdotool", "mousemove", "100", "120", "click", "1"]
    refs["executor_command_log"].write_text(json.dumps(command_log), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "window_bound_pointer_command_not_window_bound" in codes


def test_l1_smoke_validator_rejects_empty_pointer_command_args_without_throwing(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    command_log = json.loads(refs["executor_command_log"].read_text(encoding="utf8"))
    command_log["events"][0]["args"] = []
    refs["executor_command_log"].write_text(json.dumps(command_log), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    validation = validate_isolated_desktop_l1_smoke_evidence(evidence)
    codes = {error["code"] for error in validation["errors"]}

    assert validation["ok"] is False
    assert "window_bound_pointer_command_not_window_bound" in codes


def test_l1_smoke_validator_rejects_incomplete_pointer_command_args_without_throwing(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    command_log = json.loads(refs["executor_command_log"].read_text(encoding="utf8"))
    command_log["events"][0]["args"] = ["/usr/bin/xdotool"]
    refs["executor_command_log"].write_text(json.dumps(command_log), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    validation = validate_isolated_desktop_l1_smoke_evidence(evidence)
    codes = {error["code"] for error in validation["errors"]}

    assert validation["ok"] is False
    assert "window_bound_pointer_command_not_window_bound" in codes


def test_l1_smoke_validator_rejects_invalid_novnc_http_viewer_proof(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    proof = json.loads(refs["backend_readiness_proof"].read_text(encoding="utf8"))
    proof["novnc"]["httpViewer"] = {
        "ready": False,
        "method": "POST",
        "url": "http://0.0.0.0:6080/vnc.html",
        "localhostOnly": False,
        "statusCode": 404,
        "bytesRead": 0,
        "sha256": "bad",
        "htmlDetected": False,
        "noVncMarkerDetected": False,
        "rawPayloadWritten": True,
    }
    refs["backend_readiness_proof"].write_text(json.dumps(proof), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "backend_readiness_http_viewer_not_ready" in codes
    assert "backend_readiness_http_viewer_not_localhost" in codes
    assert "backend_readiness_http_viewer_status_invalid" in codes
    assert "backend_readiness_http_viewer_body_invalid" in codes
    assert "backend_readiness_http_viewer_raw_payload_forbidden" in codes


def test_l1_smoke_validator_requires_input_event_command_provenance(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    input_log = json.loads(refs["input_log"].read_text(encoding="utf8"))
    input_log["events"][0].pop("commandEventId")
    input_log["events"][0].pop("commandEventRef")
    refs["input_log"].write_text(json.dumps(input_log), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "input_event_command_provenance_missing" in codes


def test_l1_smoke_validator_rejects_missing_command_event(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    input_log = json.loads(refs["input_log"].read_text(encoding="utf8"))
    input_log["events"][1]["commandEventId"] = "missing-command"
    refs["input_log"].write_text(json.dumps(input_log), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "input_event_command_event_not_found" in codes


def test_l1_smoke_validator_rejects_failed_input_command(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    command_log = json.loads(refs["executor_command_log"].read_text(encoding="utf8"))
    command_log["events"][1]["returncode"] = 1
    refs["executor_command_log"].write_text(json.dumps(command_log), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "input_command_returncode_nonzero" in codes


def test_l1_smoke_validator_rejects_input_command_display_mismatch(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    command_log = json.loads(refs["executor_command_log"].read_text(encoding="utf8"))
    command_log["events"][0]["display"] = ":12"
    command_log["events"][0]["env"]["DISPLAY"] = ":12"
    refs["executor_command_log"].write_text(json.dumps(command_log), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "input_command_display_mismatch" in codes


def test_l1_smoke_validator_rejects_input_event_command_modality_mismatch(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    input_log = json.loads(refs["input_log"].read_text(encoding="utf8"))
    input_log["events"][0]["commandEventId"] = "l1-command-001"
    input_log["events"][0]["commandEventRef"] = f"{refs['executor_command_log']}#events/l1-command-001"
    refs["input_log"].write_text(json.dumps(input_log), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "input_event_command_action_index_mismatch" in codes
    assert "input_event_command_modality_mismatch" in codes


def test_l1_smoke_validator_rejects_input_event_command_log_mismatch(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    other_log = tmp_path / "other-command-events.json"
    other_log.write_text(json.dumps({"schemaVersion": EXECUTOR_COMMAND_EVENT_LOG_SCHEMA, "eventCount": 0, "events": []}), encoding="utf8")
    input_log = json.loads(refs["input_log"].read_text(encoding="utf8"))
    input_log["events"][0]["commandEventLogRef"] = str(other_log)
    input_log["events"][0]["commandEventRef"] = f"{other_log}#events/l1-command-000"
    refs["input_log"].write_text(json.dumps(input_log), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "input_event_command_log_ref_mismatch" in codes


def test_l1_smoke_validator_rejects_input_event_command_ref_mismatch(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    input_log = json.loads(refs["input_log"].read_text(encoding="utf8"))
    input_log["events"][0]["commandEventRef"] = f"{refs['executor_command_log']}#events/l1-command-999"
    refs["input_log"].write_text(json.dumps(input_log), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "input_event_command_ref_mismatch" in codes


def test_l1_smoke_validator_rejects_command_event_side_effect_flags(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    command_log = json.loads(refs["executor_command_log"].read_text(encoding="utf8"))
    command_log["sharedSystemInputUsed"] = True
    command_log["events"][0]["systemPointerMoved"] = True
    refs["executor_command_log"].write_text(json.dumps(command_log), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "input_command_side_effect_flag" in codes


def test_l1_smoke_validator_requires_result_final_observation_matches_final_screenshot(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    unrelated = tmp_path / "unrelated-final.png"
    unrelated.write_bytes(b"\x89PNG\r\n\x1a\nunrelated-final")
    result = json.loads(refs["result"].read_text(encoding="utf8"))
    result["finalObservationRef"] = str(unrelated)
    refs["result"].write_text(json.dumps(result), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "result_final_observation_ref_mismatch" in codes


def test_l1_smoke_validator_requires_trace_final_observation_matches_final_screenshot(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    unrelated = tmp_path / "unrelated-trace-final.png"
    unrelated.write_bytes(b"\x89PNG\r\n\x1a\nunrelated-trace-final")
    trace = json.loads(refs["trace"].read_text(encoding="utf8"))
    trace["finalObservationRef"] = str(unrelated)
    refs["trace"].write_text(json.dumps(trace), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "trace_final_observation_ref_mismatch" in codes


def test_l1_smoke_validator_requires_last_step_after_ref_matches_final_screenshot(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    result = json.loads(refs["result"].read_text(encoding="utf8"))
    result["steps"][-1]["afterRef"] = str(refs["step_2_after"])
    result["steps"][-1]["screenshotRefs"] = [str(refs["step_2_after"])]
    refs["result"].write_text(json.dumps(result), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "last_step_after_ref_mismatch" in codes


def test_l1_smoke_validator_requires_capture_stream_contains_initial_and_final_refs(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    capture_stream = json.loads(refs["capture_stream"].read_text(encoding="utf8"))
    capture_stream["frameRefs"] = [str(refs["before"])]
    refs["capture_stream"].write_text(json.dumps(capture_stream), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "capture_stream_initial_final_frames_missing" in codes


def test_l1_smoke_validator_requires_current_step_screenshots(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    result = json.loads(refs["result"].read_text(encoding="utf8"))
    result["steps"][1].pop("afterRef")
    result["steps"][1]["screenshotRefs"] = []
    refs["result"].write_text(json.dumps(result), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "current_step_screenshot_ref_missing" in codes


def test_l1_smoke_validator_cannot_disable_current_step_screenshot_requirement(tmp_path):
    evidence = valid_l1_evidence_payload(tmp_path)
    result = json.loads(Path(evidence["resultRef"]).read_text(encoding="utf8"))
    result["steps"][1].pop("afterRef")
    result["steps"][1]["screenshotRefs"] = []
    Path(evidence["resultRef"]).write_text(json.dumps(result), encoding="utf8")
    evidence["workflowRequirements"]["requiresCurrentStepScreenshots"] = False

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "workflow_requirement_must_be_true" in codes
    assert "current_step_screenshot_ref_missing" in codes


def test_l1_smoke_validator_rejects_prior_round_completion_evidence(tmp_path):
    evidence = valid_l1_evidence_payload(tmp_path)
    trace = json.loads(Path(evidence["traceRefs"][0]).read_text(encoding="utf8"))
    trace["metadata"] = {"priorRoundLedgerDone": True}
    Path(evidence["traceRefs"][0]).write_text(json.dumps(trace), encoding="utf8")

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "prior_round_completion_evidence_forbidden" in codes


def test_l1_smoke_validator_cannot_disable_prior_round_guard(tmp_path):
    evidence = valid_l1_evidence_payload(tmp_path)
    trace = json.loads(Path(evidence["traceRefs"][0]).read_text(encoding="utf8"))
    trace["metadata"] = {"priorRoundLedgerDone": True}
    Path(evidence["traceRefs"][0]).write_text(json.dumps(trace), encoding="utf8")
    evidence["workflowRequirements"]["forbidPriorRoundCompletionEvidence"] = False

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "workflow_requirement_must_be_true" in codes
    assert "prior_round_completion_evidence_forbidden" in codes


def test_l1_smoke_validator_rejects_stale_completion_support(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    index = json.loads(refs["evidence_index"].read_text(encoding="utf8"))
    completion_id = next(record["id"] for record in _read_jsonl(refs["evidence_log"]) if record["type"] == "completion-claim")
    index["current"] = [completion_id]
    refs["evidence_index"].write_text(json.dumps(index), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "completion_claim_supports_stale_evidence" in codes


def test_l1_smoke_validator_requires_completion_claim_supports_final_observation(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    records = _read_jsonl(refs["evidence_log"])
    final_id = next(record["id"] for record in records if record["type"] == "observation" and record["ref"] == str(refs["after"]))
    for record in records:
        if record["type"] == "completion-claim":
            record["supports"] = [support for support in record["supports"] if support != final_id]
    refs["evidence_log"].write_text("".join(f"{json.dumps(record)}\n" for record in records), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "completion_claim_missing_final_observation_support" in codes


def test_l1_smoke_validator_rejects_viewer_without_initial_final_frames(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    unrelated_a = tmp_path / "unrelated-a.png"
    unrelated_b = tmp_path / "unrelated-b.png"
    unrelated_a.write_bytes(b"\x89PNG\r\n\x1a\n")
    unrelated_b.write_bytes(b"\x89PNG\r\n\x1a\n")
    viewer = json.loads(refs["viewer_manifest"].read_text(encoding="utf8"))
    viewer["screenshotRefs"] = [str(unrelated_a), str(unrelated_b)]
    viewer["frames"] = [
        {"index": 0, "kind": "screenshot", "screenshotRef": str(unrelated_a), "caption": "unrelated a"},
        {"index": 1, "kind": "screenshot", "screenshotRef": str(unrelated_b), "caption": "unrelated b"},
    ]
    refs["viewer_manifest"].write_text(json.dumps(viewer), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "viewer_initial_final_frames_missing" in codes


def test_l1_smoke_validator_rejects_invalid_session_ref_payload_schemas(tmp_path):
    refs = write_valid_l1_bundle(tmp_path)
    refs["virtual_display"].write_text(json.dumps({"schemaVersion": "wrong"}), encoding="utf8")
    evidence = valid_l1_evidence_from_refs(refs)

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "session_ref_schema_invalid" in codes


def test_l1_smoke_validator_rejects_inline_screenshot_payloads(tmp_path):
    evidence = valid_l1_evidence_payload(tmp_path)
    evidence["metadata"] = {"rawScreenshot": "data:image/png;base64,SECRET"}

    codes = {error["code"] for error in validate_isolated_desktop_l1_smoke_evidence(evidence)["errors"]}

    assert "inline_payload_forbidden" in codes


def valid_l1_evidence_payload(tmp_path):
    return valid_l1_evidence_from_refs(write_valid_l1_bundle(tmp_path))


def valid_l1_evidence_from_refs(refs):
    return {
        "schemaVersion": ISOLATED_DESKTOP_L1_SMOKE_EVIDENCE_SCHEMA_VERSION,
        "status": "completed",
        "acceptanceTier": "l1-isolated-smoke",
        "userAcceptanceEligible": True,
        "backendKind": "linux-novnc-libreoffice-browser",
        "targetEnvironmentKind": "linux-isolated-desktop-session",
        "captureSource": "isolated-virtual-display",
        "preflightRef": str(refs["preflight"]),
        "preflightStatus": "ready",
        "resultRef": str(refs["result"]),
        "traceRefs": [str(refs["trace"])],
        "screenshotRefs": [str(refs["before"]), str(refs["after"]), str(refs["step_0_after"]), str(refs["step_3_after"])],
        "initialScreenshotRef": str(refs["before"]),
        "finalScreenshotRef": str(refs["after"]),
        "realWindowEvidenceRefs": [
            str(refs["before"]),
            str(refs["after"]),
            str(refs["pointer_log"]),
            str(refs["keyboard_log"]),
            str(refs["input_log"]),
            str(refs["backend_readiness_proof"]),
            str(refs["executor_command_log"]),
            str(refs["process_ref"]),
            str(refs["resource_allocation"]),
        ],
        "viewerManifestRef": str(refs["viewer_manifest"]),
        "viewerHtmlRef": str(refs["viewer_html"]),
        "inputEventLogRef": str(refs["input_log"]),
        "pointerEventLogRef": str(refs["pointer_log"]),
        "keyboardEventLogRef": str(refs["keyboard_log"]),
        "sessionManifestRef": str(refs["session_manifest"]),
        "virtualDisplayRef": str(refs["virtual_display"]),
        "captureStreamRef": str(refs["capture_stream"]),
        "replayBundleRef": str(refs["replay_bundle"]),
        "filesystemRootRef": str(refs["filesystem_root"]),
        "noVncViewerRef": str(refs["novnc_viewer"]),
        "backendReadinessProofRef": str(refs["backend_readiness_proof"]),
        "executorCommandEventLogRef": str(refs["executor_command_log"]),
        "targetWindowRef": str(refs["target_window"]),
        "windowBoundPointerProofRef": str(refs["window_bound_pointer_proof"]),
        "processRef": str(refs["process_ref"]),
        "resourceAllocationRef": str(refs["resource_allocation"]),
        "evidenceLogRef": str(refs["evidence_log"]),
        "evidenceSnapshotRef": str(refs["evidence_snapshot"]),
        "evidenceIndexRef": str(refs["evidence_index"]),
        "plannerBriefRef": str(refs["planner_brief"]),
        "inputAdapterManifestRef": str(refs["input_adapter_manifest"]),
        "inputAdapterBindingManifestRef": str(refs["input_adapter_binding_manifest"]),
        "inputChannel": REMOTE_DESKTOP_INPUT_CHANNEL,
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
        "l1Smoke": {
            "status": "completed",
            "completed": True,
            "screenChanged": True,
            "requiredActions": [
                "open-real-gui-app",
                "click-or-focus-visible-input",
                "type-text-through-isolated-input",
                "click-visible-button-or-control",
                "verify-screen-changed",
            ],
        },
        "workflowRequirements": {
            "minimumActionCount": 4,
            "requiredInputModalities": ["pointer", "keyboard"],
            "requiresCurrentStepScreenshots": True,
            "forbidPriorRoundCompletionEvidence": True,
        },
    }


def fake_http_viewer_body():
    return b"<!doctype html><html><title>noVNC</title><script>var RFB = true;</script></html>"


def write_valid_l1_bundle(tmp_path, *, with_screenshots=True):
    paths = {
        "preflight": tmp_path / "isolated-desktop-backend-probe-manifest.json",
        "result": tmp_path / "computer-use-result.json",
        "trace": tmp_path / "vision-trace.json",
        "before": tmp_path / "before.png",
        "after": tmp_path / "after.png",
        "pointer_log": tmp_path / "input-pointer.json",
        "keyboard_log": tmp_path / "input-keyboard.json",
        "input_log": tmp_path / "input-events.json",
        "backend_readiness_proof": tmp_path / "backend-readiness-proof.json",
        "executor_command_log": tmp_path / "l1-executor-command-events.json",
        "target_window": tmp_path / "l1-target-window.json",
        "window_bound_pointer_proof": tmp_path / "l1-window-bound-pointer-proof.json",
        "process_ref": tmp_path / "backend-processes.json",
        "resource_allocation": tmp_path / "isolated-runtime-resource-allocation.json",
        "process_virtual_display_stdout": tmp_path / "backend-process-virtual-display.stdout.log",
        "process_virtual_display_stderr": tmp_path / "backend-process-virtual-display.stderr.log",
        "process_window_manager_stdout": tmp_path / "backend-process-window-manager.stdout.log",
        "process_window_manager_stderr": tmp_path / "backend-process-window-manager.stderr.log",
        "process_vnc_server_stdout": tmp_path / "backend-process-vnc-server.stdout.log",
        "process_vnc_server_stderr": tmp_path / "backend-process-vnc-server.stderr.log",
        "process_novnc_proxy_stdout": tmp_path / "backend-process-novnc-proxy.stdout.log",
        "process_novnc_proxy_stderr": tmp_path / "backend-process-novnc-proxy.stderr.log",
        "process_browser_stdout": tmp_path / "backend-process-browser.stdout.log",
        "process_browser_stderr": tmp_path / "backend-process-browser.stderr.log",
        "session_manifest": tmp_path / "virtual-desktop-session-manifest.json",
        "virtual_display": tmp_path / "virtual-display.json",
        "capture_stream": tmp_path / "capture-stream.json",
        "replay_bundle": tmp_path / "replay-bundle.json",
        "filesystem_root": tmp_path / "filesystem-root",
        "novnc_viewer": tmp_path / "novnc-viewer.json",
        "input_adapter_manifest": tmp_path / "input-adapter-manifest.json",
        "input_adapter_binding_manifest": tmp_path / "input-adapter-binding-manifest.json",
    }
    for index in range(4):
        paths[f"step_{index}_before"] = tmp_path / f"step-{index}-before.png"
        paths[f"step_{index}_after"] = tmp_path / f"step-{index}-after.png"

    steps = [
        _step(0, "open_app", "LibreOffice Writer", paths["step_0_before"], paths["step_0_after"]),
        _step(1, "click", "visible input field", paths["step_1_before"], paths["step_1_after"]),
        _step(2, "type_text", "visible input field", paths["step_2_before"], paths["step_2_after"], text="hello isolated desktop"),
        _step(3, "click", "submit button", paths["step_3_before"], paths["after"], done=True),
    ]
    result = {
        "schemaVersion": "sciforge.computer-use.result.v1",
        "status": "completed",
        "reason": "L1 smoke completed",
        "traceRefs": [str(paths["trace"])],
        "screenshotRefs": [str(paths["before"]), str(paths["after"]), *[str(paths[f"step_{index}_after"]) for index in range(4)]],
        "finalObservationRef": str(paths["after"]),
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
        "reason": "L1 smoke completed",
        "traceRefs": [],
        "screenshotRefs": result["screenshotRefs"],
        "finalObservationRef": str(paths["after"]),
        "steps": steps,
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
            "schemaVersion": ISOLATED_DESKTOP_BACKEND_PROBE_SCHEMA_VERSION,
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
            "diagnosticOnly": True,
            "realWindowEvidence": False,
            "userAcceptanceEligible": False,
            "readinessOnly": False,
            "executeFailClosed": False,
        },
        "result": result,
        "trace": trace,
        "pointer_log": {
            "schemaVersion": "sciforge.computer-use.target-pointer-state.v1",
            "eventCount": 2,
            "executorCommandEventLogRef": str(paths["executor_command_log"]),
            "events": [
                _pointer_event(paths, 1, "l1-input", 100, 120, "l1-command-000"),
                _pointer_event(paths, 3, "l1-button", 160, 180, "l1-command-002"),
            ],
        },
        "keyboard_log": {
            "schemaVersion": "sciforge.computer-use.target-keyboard-state.v1",
            "eventCount": 1,
            "executorCommandEventLogRef": str(paths["executor_command_log"]),
            "events": [{"actionIndex": 2, "kind": "type_text", "textLength": 22, "commandEventId": "l1-command-001", "commandEventRef": f"{paths['executor_command_log']}#events/l1-command-001", "commandEventLogRef": str(paths["executor_command_log"])}],
        },
        "input_log": {
            "schemaVersion": "sciforge.computer-use.target-input-event-log.v1",
            "eventCount": 3,
            "executorCommandEventLogRef": str(paths["executor_command_log"]),
            "events": [
                {"modality": "pointer", **_pointer_event(paths, 1, "l1-input", 100, 120, "l1-command-000")},
                {"modality": "keyboard", "actionIndex": 2, "kind": "type_text", "commandEventId": "l1-command-001", "commandEventRef": f"{paths['executor_command_log']}#events/l1-command-001", "commandEventLogRef": str(paths["executor_command_log"])},
                {"modality": "pointer", **_pointer_event(paths, 3, "l1-button", 160, 180, "l1-command-002")},
            ],
        },
        "executor_command_log": {
            "schemaVersion": EXECUTOR_COMMAND_EVENT_LOG_SCHEMA,
            "eventCount": 3,
            "inputChannel": REMOTE_DESKTOP_INPUT_CHANNEL,
            "events": [
                _command_event("l1-command-000", 0, 1, "click-input", "click", "pointer", ":99", ["/usr/bin/xdotool", "mousemove", "--sync", "--window", "1001", "100", "120", "click", "1"]),
                _command_event("l1-command-001", 1, 2, "type-text", "type_text", "keyboard", ":99", ["/usr/bin/xdotool", "type", "--delay", "20", "hello isolated desktop"]),
                _command_event("l1-command-002", 2, 3, "click-button", "click", "pointer", ":99", ["/usr/bin/xdotool", "mousemove", "--sync", "--window", "1001", "160", "180", "click", "1"]),
            ],
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
        },
        "backend_readiness_proof": {
            "schemaVersion": BACKEND_READINESS_PROOF_SCHEMA_VERSION,
            "status": "ready",
            "backendKind": "linux-novnc-libreoffice-browser",
            "display": ":99",
            "localhostOnly": True,
            "xDisplay": {
                "display": ":99",
                "ready": True,
                "command": ["/usr/bin/xdotool", "getdisplaygeometry"],
                "width": 1280,
                "height": 720,
                "viewport": {"width": 1280, "height": 720},
                "matchesRequestedViewport": True,
                "sharedSystemInputUsed": False,
                "systemPointerMoved": False,
                "systemKeyboardEventsSent": False,
            },
            "desktopWindow": {
                "display": ":99",
                "ready": True,
                "visible": True,
                "windowId": "1001",
                "title": "SciForge isolated desktop L1 ready",
                "geometry": {"x": 0, "y": 0, "width": 1280, "height": 720},
                "searchCommand": ["/usr/bin/xdotool", "search", "--onlyvisible", "--name", "SciForge isolated desktop L1 ready"],
                "geometryCommand": ["/usr/bin/xdotool", "getwindowgeometry", "--shell", "1001"],
                "coordinateSpace": "screen",
                "sharedSystemInputUsed": False,
                "systemPointerMoved": False,
                "systemKeyboardEventsSent": False,
            },
            "page": {
                "ready": True,
                "readyTitle": "SciForge isolated desktop L1 ready",
                "titleMatched": True,
                "smokePageRef": str(tmp_path / "filesystem-root" / "l1-smoke.html"),
                "readinessStrategy": "window-title-marker",
                "sharedSystemInputUsed": False,
                "systemPointerMoved": False,
                "systemKeyboardEventsSent": False,
            },
            "vnc": {"host": "127.0.0.1", "port": 5900, "ready": True},
            "novnc": {
                "host": "127.0.0.1",
                "port": 6080,
                "ready": True,
                "viewerPath": "/vnc.html",
                "httpViewer": {
                    "ready": True,
                    "method": "GET",
                    "url": "http://127.0.0.1:6080/vnc.html",
                    "localhostOnly": True,
                    "statusCode": 200,
                    "contentType": "text/html",
                    "bytesRead": len(fake_http_viewer_body()),
                    "sha256": hashlib.sha256(fake_http_viewer_body()).hexdigest(),
                    "htmlDetected": True,
                    "noVncMarkerDetected": True,
                    "rawPayloadWritten": False,
                },
            },
            "processRef": str(tmp_path / "backend-processes.json"),
            "processRoles": ["virtual-display", "window-manager", "vnc-server", "novnc-proxy", "browser"],
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
        },
        "process_ref": {
            "schemaVersion": "sciforge.computer-use.backend-processes.v1",
            "status": "ready",
            "backendKind": BACKEND_KIND,
            "display": ":99",
            "sessionId": "l1-smoke-session-001",
            "processes": [
                _backend_process(paths, "virtual-display", 4101, "/usr/bin/Xvfb", "process_virtual_display_stdout", "process_virtual_display_stderr"),
                _backend_process(paths, "window-manager", 4102, "/usr/bin/openbox", "process_window_manager_stdout", "process_window_manager_stderr"),
                _backend_process(paths, "vnc-server", 4103, "/usr/bin/x11vnc", "process_vnc_server_stdout", "process_vnc_server_stderr"),
                _backend_process(paths, "novnc-proxy", 4104, "/usr/bin/websockify", "process_novnc_proxy_stdout", "process_novnc_proxy_stderr"),
                _backend_process(paths, "browser", 4105, "/usr/bin/chromium", "process_browser_stdout", "process_browser_stderr"),
            ],
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
        },
        "resource_allocation": {
            "schemaVersion": ISOLATED_RUNTIME_RESOURCE_ALLOCATION_SCHEMA_VERSION,
            "status": "released-after-run",
            "backendKind": BACKEND_KIND,
            "display": ":99",
            "sessionId": "l1-smoke-session-001",
            "vncPort": 5900,
            "novncPort": 6080,
            "localhostOnly": True,
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
        },
        "target_window": {
            "schemaVersion": LEGACY_L1_TARGET_WINDOW_SCHEMA_VERSION,
            "status": "ready",
            "display": ":99",
            "desktopWindow": {
                "display": ":99",
                "ready": True,
                "visible": True,
                "windowId": "1001",
                "title": "SciForge isolated desktop L1 ready",
                "geometry": {"x": 0, "y": 0, "width": 1280, "height": 720},
            },
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
        },
        "window_bound_pointer_proof": {
            "schemaVersion": "sciforge.computer-use.window-bound-pointer-proof.v1",
            "status": "completed",
            "display": ":99",
            "inputChannel": REMOTE_DESKTOP_INPUT_CHANNEL,
            "targetWindowRef": str(paths["target_window"]),
            "pointerActions": [
                _pointer_action(paths, 1, "l1-input", "visible input field", 100, 120, "l1-command-000"),
                _pointer_action(paths, 3, "l1-button", "submit button", 160, 180, "l1-command-002"),
            ],
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
        },
        "session_manifest": {
            "schemaVersion": "sciforge.computer-use.virtual-desktop-session.v1",
            "status": "open",
            "backendKind": "linux-novnc-libreoffice-browser",
            "sessionId": "l1-smoke-session-001",
        },
        "virtual_display": {
            "schemaVersion": "sciforge.computer-use.virtual-display-ref.v1",
            "status": "running",
            "display": ":99",
            "sessionId": "l1-smoke-session-001",
        },
        "capture_stream": {
            "schemaVersion": "sciforge.computer-use.capture-stream-ref.v1",
            "status": "running",
            "frameRefs": [str(paths["before"]), str(paths["after"])],
        },
        "replay_bundle": {
            "schemaVersion": "sciforge.computer-use.replay-bundle-ref.v1",
            "status": "completed",
            "timelineRefs": [str(paths["trace"])],
        },
        "novnc_viewer": {
            "schemaVersion": "sciforge.computer-use.novnc-viewer-ref.v1",
            "status": "running",
            "url": "http://127.0.0.1:6080/vnc.html",
        },
        "input_adapter_manifest": {"inputChannel": REMOTE_DESKTOP_INPUT_CHANNEL},
        "input_adapter_binding_manifest": {"bindingStatus": "bound", "targetEnvironmentKind": "linux-isolated-desktop-session"},
    }
    paths["filesystem_root"].mkdir(parents=True, exist_ok=True)
    for key, path in paths.items():
        if key == "filesystem_root":
            continue
        if key in json_payloads:
            path.write_text(json.dumps(json_payloads[key], indent=2, sort_keys=True), encoding="utf8")
        elif path.suffix == ".png":
            if with_screenshots:
                path.write_bytes(b"\x89PNG\r\n\x1a\n" + key.encode("utf8"))
        else:
            path.write_text(key, encoding="utf8")

    evidence_dir = tmp_path / "evidence"
    ledger = EvidenceLedger(evidence_dir)
    before_id = ledger.append_record("observation", loop_phase="evidence", ref=str(paths["before"]), summary="Initial L1 screen")
    action_id = ledger.append_record("action", loop_phase="action", action_index=2, summary="type text", invalidates=[before_id])
    final_id = ledger.append_record("observation", loop_phase="evidence", action_index=3, ref=str(paths["after"]), summary="Final L1 screen")
    verification_id = ledger.append_record("verification", loop_phase="action", action_index=3, summary="screen changed", derived_from=[action_id, final_id], verified_by=[final_id])
    ledger.append_completion_claim(action_index=3, summary="L1 smoke complete", status="completed", supports=[final_id, verification_id])
    paths.update({
        "evidence_log": evidence_dir / "evidence-log.jsonl",
        "evidence_snapshot": evidence_dir / "evidence-snapshot.json",
        "evidence_index": evidence_dir / "evidence-index.json",
        "planner_brief": evidence_dir / "planner-brief.json",
    })

    viewer = build_visible_run_viewer(output_dir=tmp_path, result=result, result_ref=paths["result"], title="L1 smoke")
    paths["viewer_manifest"] = tmp_path / "visible-run-viewer-manifest.json"
    paths["viewer_html"] = Path(viewer["viewerHtmlRef"])
    return paths


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


def _pointer_event(paths, action_index, target_id, x, y, command_id):
    return {
        "actionIndex": action_index,
        "kind": "click",
        "targetId": target_id,
        "x": x,
        "y": y,
        "windowX": x,
        "windowY": y,
        "coordinateSpace": "window",
        "targetWindowRef": str(paths["target_window"]),
        "windowBoundPointerProofRef": str(paths["window_bound_pointer_proof"]),
        "targetProofRef": f"{paths['window_bound_pointer_proof']}#pointerActions/{action_index}",
        "commandEventId": command_id,
        "commandEventRef": f"{paths['executor_command_log']}#events/{command_id}",
        "commandEventLogRef": str(paths["executor_command_log"]),
    }


def _pointer_action(paths, action_index, target_id, target_description, x, y, command_id):
    return {
        "actionIndex": action_index,
        "kind": "click",
        "targetId": target_id,
        "targetDescription": target_description,
        "targetBoundsInWindow": {"x": max(x - 32, 0), "y": max(y - 24, 0), "width": 128, "height": 72},
        "hitPointInWindow": {"x": x, "y": y},
        "pointInsideTargetBounds": True,
        "windowBoundsAtDispatch": {"windowId": "1001", "x": 0, "y": 0, "width": 1280, "height": 720},
        "commandEventId": command_id,
        "commandEventRef": f"{paths['executor_command_log']}#events/{command_id}",
        "commandEventLogRef": str(paths["executor_command_log"]),
        "coordinateSpace": "window",
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
    }


def _backend_process(paths, role, pid, command, stdout_key, stderr_key):
    return {
        "role": role,
        "pid": pid,
        "command": command,
        "display": ":99",
        "sessionId": "l1-smoke-session-001",
        "status": "running",
        "stdoutLogRef": str(paths[stdout_key]),
        "stderrLogRef": str(paths[stderr_key]),
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
    }


def _command_event(command_id, sequence, action_index, role, action_kind, modality, display, args):
    return {
        "id": command_id,
        "sequence": sequence,
        "timestamp": 1779900000 + sequence,
        "role": role,
        "actionIndex": action_index,
        "actionKind": action_kind,
        "inputModality": modality,
        "inputChannel": REMOTE_DESKTOP_INPUT_CHANNEL,
        "args": args,
        "env": {"DISPLAY": display, "HOME": "/tmp/sciforge-l1", "TMPDIR": "/tmp", "XAUTHORITY": None},
        "display": display,
        "returncode": 0,
        "stdoutSummary": "",
        "stderrSummary": "",
        "stdoutCharCount": 0,
        "stderrCharCount": 0,
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
    }


def _read_jsonl(path):
    return [json.loads(line) for line in Path(path).read_text(encoding="utf8").splitlines() if line.strip()]
