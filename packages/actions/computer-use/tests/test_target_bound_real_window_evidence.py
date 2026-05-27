import json
from pathlib import Path

from sciforge_computer_use.trace import (
    build_target_bound_real_window_probe_evidence,
    validate_target_bound_real_window_probe_evidence,
)
from sciforge_computer_use.virtual_input_adapter import (
    INPUT_ADAPTER_BINDING_STATUS_BOUND,
    build_input_adapter_target_binding_manifest,
    build_target_bound_input_adapter_manifest,
    validate_input_adapter_target_binding_manifest,
)


def test_target_bound_real_window_probe_evidence_requires_full_refs_and_binding(tmp_path):
    refs = write_valid_refs(tmp_path)
    target_binding_validation = valid_target_binding_validation(tmp_path)

    evidence = build_target_bound_real_window_probe_evidence(
        refs["preflight"],
        refs["result"],
        refs["trace"],
        target_binding_validation=target_binding_validation,
        real_window_evidence_refs=[str(refs["before"]), str(refs["after"]), str(refs["binding_proof"])],
        initial_screenshot_ref=str(refs["before"]),
        final_screenshot_ref=str(refs["after"]),
        final_artifact_ref=str(refs["artifact"]),
        file_list_artifact_ref=str(refs["file_list_artifact"]),
        file_list_data_ref=str(refs["file_list_data"]),
        input_channel="isolated-window",
        executor_provider="native-independent-executor",
        minimum_action_count=6,
        requires_current_step_screenshots=True,
        forbid_prior_round_completion_evidence=True,
        requires_directory_evidence=True,
    )

    assert evidence["schemaVersion"] == "sciforge.computer-use.target-bound-real-window-probe-evidence.v1"
    assert evidence["status"] == "completed"
    assert evidence["realWindowEvidence"] is True
    assert evidence["diagnosticOnly"] is False
    assert evidence["preflightStatus"] == "ready"
    assert evidence["inputExecuted"] is True
    assert evidence["executeFailClosed"] is False
    assert evidence["sharedSystemInputUsed"] is False
    assert evidence["targetBindingValidation"]["ok"] is True
    assert evidence["finalArtifactRef"] == str(refs["artifact"])

    validation = validate_target_bound_real_window_probe_evidence(evidence, require_existing_refs=True)
    assert validation["ok"] is True
    assert validation["requireExistingRefs"] is True
    assert validation["finalArtifactRef"] == str(refs["artifact"])
    assert validation["fileListArtifactRef"] == str(refs["file_list_artifact"])
    assert validation["fileListDataRef"] == str(refs["file_list_data"])
    assert validation["workflowRequirements"]["minimumActionCount"] == 6


def test_target_bound_real_window_probe_evidence_rejects_preflight_and_input_shortcuts(tmp_path):
    refs = write_valid_refs(tmp_path)
    evidence = valid_evidence_payload(tmp_path)
    evidence["preflightStatus"] = "blocked"
    evidence["inputExecuted"] = False
    evidence["executeFailClosed"] = True
    evidence["sharedSystemInputUsed"] = True

    codes = {error["code"] for error in validate_target_bound_real_window_probe_evidence(evidence)["errors"]}

    assert "preflight_not_ready" in codes
    assert "input_not_executed" in codes
    assert "execute_fail_closed" in codes
    assert "side_effect_flag_not_false" in codes

    missing_directory_refs = {
        **valid_evidence_payload(tmp_path),
        "requiresDirectoryEvidence": True,
        "fileListArtifactRef": None,
        "fileListDataRef": None,
    }
    directory_codes = {
        error["code"] for error in validate_target_bound_real_window_probe_evidence(missing_directory_refs)["errors"]
    }
    assert "file_list_artifact_ref_missing" in directory_codes
    assert "file_list_data_ref_missing" in directory_codes
    assert refs["preflight"].is_file()


def test_target_bound_real_window_probe_evidence_rejects_shallow_binding_or_inline_payload(tmp_path):
    shallow_binding = {
        **valid_evidence_payload(tmp_path),
        "targetBindingValidation": {"ok": True},
    }
    shallow_codes = {
        error["code"] for error in validate_target_bound_real_window_probe_evidence(shallow_binding)["errors"]
    }
    assert "target_binding_existing_refs_missing" in shallow_codes
    assert "target_binding_status_not_bound" in shallow_codes

    inline_payload = {
        **valid_evidence_payload(tmp_path),
        "metadata": {"rawScreenshot": "data:image/png;base64,SECRET"},
    }
    inline_codes = {
        error["code"] for error in validate_target_bound_real_window_probe_evidence(inline_payload)["errors"]
    }
    assert "inline_payload_forbidden" in inline_codes


def test_target_bound_real_window_probe_evidence_valid_six_step_shape_passes(tmp_path):
    evidence = valid_complex_evidence_payload(tmp_path)

    validation = validate_target_bound_real_window_probe_evidence(evidence, require_existing_refs=True)

    assert validation["ok"] is True


def test_target_bound_real_window_probe_evidence_five_step_shape_fails(tmp_path):
    evidence = valid_complex_evidence_payload(tmp_path, step_count=5)

    codes = {error["code"] for error in validate_target_bound_real_window_probe_evidence(evidence)["errors"]}

    assert "minimum_action_count_not_met" in codes


def test_target_bound_real_window_probe_evidence_missing_current_screenshot_fails(tmp_path):
    evidence = valid_complex_evidence_payload(tmp_path)
    result = json.loads(Path(evidence["resultRef"]).read_text(encoding="utf8"))
    result["steps"][2].pop("afterRef")
    result["steps"][2]["screenshotRefs"] = []
    Path(evidence["resultRef"]).write_text(json.dumps(result), encoding="utf8")

    codes = {error["code"] for error in validate_target_bound_real_window_probe_evidence(evidence)["errors"]}

    assert "current_step_screenshot_ref_missing" in codes


def test_target_bound_real_window_probe_evidence_prior_round_ledger_done_fails(tmp_path):
    evidence = valid_complex_evidence_payload(tmp_path)
    trace = json.loads(Path(evidence["traceRefs"][0]).read_text(encoding="utf8"))
    trace["failureDiagnostics"] = {"ledgerDone": True}
    Path(evidence["traceRefs"][0]).write_text(json.dumps(trace), encoding="utf8")

    codes = {error["code"] for error in validate_target_bound_real_window_probe_evidence(evidence)["errors"]}

    assert "prior_round_completion_evidence_forbidden" in codes


def valid_evidence_payload(tmp_path):
    refs = write_valid_refs(tmp_path)
    return {
        "schemaVersion": "sciforge.computer-use.target-bound-real-window-probe-evidence.v1",
        "status": "completed",
        "preflightRef": str(refs["preflight"]),
        "preflightStatus": "ready",
        "resultRef": str(refs["result"]),
        "traceRefs": [str(refs["trace"])],
        "initialScreenshotRef": str(refs["before"]),
        "finalScreenshotRef": str(refs["after"]),
        "realWindowEvidenceRefs": [str(refs["before"]), str(refs["after"]), str(refs["binding_proof"])],
        "targetBindingValidation": valid_target_binding_validation(tmp_path),
        "inputChannel": "isolated-window",
        "inputExecuted": True,
        "executeFailClosed": False,
        "osInputExecuted": False,
        "realOsInputExecuted": False,
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
        "realWindowEvidence": True,
        "diagnosticOnly": False,
        "finalArtifactRef": str(refs["artifact"]),
        "requiresDirectoryEvidence": False,
    }


def valid_complex_evidence_payload(tmp_path, *, step_count: int = 6):
    evidence = valid_evidence_payload(tmp_path)
    refs = write_valid_refs(tmp_path, step_count=step_count)
    evidence.update({
        "resultRef": str(refs["result"]),
        "traceRefs": [str(refs["trace"])],
        "realWindowEvidenceRefs": [str(refs["before"]), str(refs["after"]), str(refs["binding_proof"])],
        "initialScreenshotRef": str(refs["before"]),
        "finalScreenshotRef": str(refs["after"]),
        "finalArtifactRef": str(refs["artifact"]),
        "fileListArtifactRef": str(refs["file_list_artifact"]),
        "fileListDataRef": str(refs["file_list_data"]),
        "requiresDirectoryEvidence": True,
        "workflowRequirements": {
            "minimumActionCount": 6,
            "requiresCurrentStepScreenshots": True,
            "forbidPriorRoundCompletionEvidence": True,
            "requiresDirectoryEvidence": True,
        },
    })
    return evidence


def valid_target_binding_validation(tmp_path):
    refs = write_valid_refs(tmp_path)
    adapter_ref = refs["adapter"]
    adapter_ref.write_text(
        json.dumps(build_target_bound_input_adapter_manifest(executor_provider="native-independent-executor")),
        encoding="utf8",
    )
    binding = build_input_adapter_target_binding_manifest(
        binding_status=INPUT_ADAPTER_BINDING_STATUS_BOUND,
        target_environment_kind="native-window-isolated-session",
        target_window_resolved=True,
        execute_changes_target_environment=True,
        real_window_evidence_capable=True,
        adapter_manifest_ref=str(adapter_ref),
        target_window_ref=str(refs["target_window"]),
        evidence_refs=[str(refs["binding_proof"])],
    )
    return validate_input_adapter_target_binding_manifest(binding, require_existing_refs=True)


def write_valid_refs(tmp_path, *, step_count: int = 6) -> dict[str, Path]:
    paths = {
        "preflight": tmp_path / "desktop-host-port-preflight-manifest.json",
        "result": tmp_path / "computer-use-result.json",
        "trace": tmp_path / "vision-trace.json",
        "before": tmp_path / "before.png",
        "after": tmp_path / "after.png",
        "binding_proof": tmp_path / "target-binding-proof.json",
        "adapter": tmp_path / "adapter-manifest.json",
        "target_window": tmp_path / "target-window.json",
        "artifact": tmp_path / "final.md",
        "file_list_artifact": tmp_path / "file-list.md",
        "file_list_data": tmp_path / "file-list.json",
    }
    for index in range(step_count):
        paths[f"step_{index}_before"] = tmp_path / f"step-{index}-before.png"
        paths[f"step_{index}_after"] = tmp_path / f"step-{index}-after.png"
    steps = [
        {
            "index": index,
            "status": "completed",
            "beforeRef": str(paths[f"step_{index}_before"]),
            "afterRef": str(paths[f"step_{index}_after"]),
            "screenshotRefs": [str(paths[f"step_{index}_after"])],
            "action": {"kind": "click", "target": f"target {index}"},
            "verification": {"ok": True, "done": index == step_count - 1},
        }
        for index in range(step_count)
    ]
    json_payloads = {
        "preflight": {"status": "ready"},
        "result": {
            "status": "completed",
            "traceRefs": [str(paths["trace"])],
            "screenshotRefs": [str(paths[f"step_{index}_after"]) for index in range(step_count)],
            "artifactRefs": [str(paths["file_list_artifact"]), str(paths["file_list_data"])],
            "finalArtifactRef": str(paths["artifact"]),
            "finalArtifactRefs": [str(paths["artifact"])],
            "steps": steps,
        },
        "trace": {
            "schemaVersion": "sciforge.computer-use.loop-trace.v1",
            "status": "completed",
            "reason": "completed",
            "traceRefs": [],
            "screenshotRefs": [str(paths[f"step_{index}_after"]) for index in range(step_count)],
            "artifactRefs": [str(paths["file_list_artifact"]), str(paths["file_list_data"])],
            "finalObservationRef": str(paths["after"]),
            "finalArtifactRef": str(paths["artifact"]),
            "finalArtifactRefs": [str(paths["artifact"])],
            "steps": steps,
        },
        "binding_proof": {"ok": True},
        "target_window": {"title": "Fixture Editor"},
        "file_list_data": {"files": ["final.md"]},
    }
    for key, path in paths.items():
        if key in json_payloads:
            path.write_text(json.dumps(json_payloads[key]), encoding="utf8")
        elif path.suffix == ".png":
            path.write_bytes(b"\x89PNG\r\n\x1a\n")
        else:
            path.write_text(key, encoding="utf8")
    return paths
