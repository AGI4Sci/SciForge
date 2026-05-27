import json
import os
import subprocess
import sys
from pathlib import Path

from sciforge_computer_use import validateRepairReplayEvidence, validate_repair_replay_evidence, validate_trace
from sciforge_computer_use import virtual_desktop_probe
from sciforge_computer_use.trace import validate_viewport_recovery_evidence


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
SIX_STEP_FIXTURE = PACKAGE_ROOT / "fixtures" / "virtual-desktop-six-step.json"
AMBIGUOUS_REPAIRED_FIXTURE = PACKAGE_ROOT / "fixtures" / "virtual-desktop-ambiguous-before-after.json"


def run_virtual_probe(*args):
    env = {
        **os.environ,
        "PYTHONPATH": str(PACKAGE_ROOT),
    }
    return subprocess.run(
        [sys.executable, "-m", "sciforge_computer_use.virtual_desktop_probe", *args],
        cwd=PACKAGE_ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        check=False,
    )


def test_virtual_desktop_probe_rejects_absolute_or_parent_refs_outside_run_bundle(tmp_path):
    output_dir = tmp_path / "probe"

    for ref in ("/tmp/outside.png", "../outside.png"):
        try:
            virtual_desktop_probe._local_ref_path(ref, output_dir)
        except ValueError as exc:
            assert "probe output directory" in str(exc)
        else:
            raise AssertionError(f"ref {ref!r} should not resolve outside output dir")

    safe = virtual_desktop_probe._local_ref_path(".sciforge/vision-runs/virtual-desktop/before.png", output_dir)
    assert safe == (output_dir / ".sciforge/vision-runs/virtual-desktop/before.png").resolve()


def test_virtual_desktop_probe_runs_six_step_stdio_with_virtual_input_refs(tmp_path):
    scenario_file = write_scenario(tmp_path, six_step_scenario())
    output_dir = tmp_path / "virtual-desktop"
    completed = run_virtual_probe(
        "--request-json",
        json.dumps({
            "task": "complete task B shape through virtual desktop host ports",
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
    assert completed.stderr == ""
    payload = json.loads(completed.stdout)
    trace_path = output_dir / "vision-trace.json"
    manifest_path = output_dir / "virtual-desktop-probe-manifest.json"

    assert payload["status"] == "completed"
    assert len(payload["steps"]) == 6
    assert payload["traceRefs"] == [str(trace_path.resolve())]
    assert Path(payload["finalArtifactRef"]).read_text(encoding="utf8").startswith("# Virtual Desktop Task")
    assert payload["failureDiagnostics"]["inputAdapterStatus"] == "independent-simulated-input-adapter"
    assert payload["failureDiagnostics"]["inputChannel"] == "virtual-session"
    assert payload["failureDiagnostics"]["inputExecuted"] is False
    assert payload["failureDiagnostics"]["sharedSystemInputUsed"] is False
    assert payload["failureDiagnostics"]["realWindowEvidence"] is False
    assert Path(payload["failureDiagnostics"]["virtualInputStateRefs"]["virtualInputStateRef"]).is_file()

    manifest = json.loads(manifest_path.read_text(encoding="utf8"))
    assert manifest["schemaVersion"] == "sciforge.computer-use.virtual-desktop-probe-manifest.v1"
    assert manifest["mode"] == "package-local-virtual-desktop-host-ports"
    assert manifest["protocolSchemas"] == {
        "hostPortCall": "sciforge.computer-use.host-port-call.v1",
        "hostPortResult": "sciforge.computer-use.host-port-result.v1",
        "finalResult": "sciforge.computer-use.cli-final-result.v1",
    }
    assert manifest["requiredHostPorts"] == ["capture", "plan", "locate", "execute", "verify", "writeTrace", "emitEvent"]
    assert manifest["unreachedHostPorts"] == []
    assert manifest["inputChannel"] == "virtual-session"
    assert manifest["executorProvider"] == "virtual-input-state-executor"
    assert manifest["bindingStatus"] == "virtual-state-only"
    assert manifest["executeChangesTargetEnvironment"] is False
    assert manifest["realWindowEvidenceCapable"] is False
    assert manifest["stateOnlyActionsExecuted"] is True
    assert manifest["osInputExecuted"] is False
    assert manifest["realOsInputExecuted"] is False
    assert manifest["systemPointerMoved"] is False
    assert manifest["systemKeyboardEventsSent"] is False
    assert manifest["realWindowStateChanged"] is False
    assert manifest["diagnosticOnly"] is True
    assert manifest["realWindowEvidence"] is False
    assert manifest["note"].endswith("It is not real-window desktop evidence.")
    assert manifest["fileListArtifactRef"].endswith("virtual-desktop-file-list.json")
    assert manifest["fileListDataRef"].endswith("virtual-desktop-file-list-data.json")
    assert [call["port"] for call in manifest["hostPortCalls"]].count("execute") == 6
    assert Path(manifest["inputAdapterManifestRef"]).is_file()
    assert manifest["virtualInputStateRef"] == manifest["virtualInputStateRefs"]["virtualInputStateRef"]
    assert set(manifest["virtualInputStateRefs"]) == {
        "virtualInputStateRef",
        "virtualPointerStateRef",
        "virtualKeyboardStateRef",
    }

    trace_validation = validate_trace(trace_path)
    assert trace_validation["ok"] is True
    assert payload["finalArtifactRef"] in trace_validation["finalArtifactRefs"]
    assert trace_validation["finalArtifactRefs"] == [payload["finalArtifactRef"]]
    assert any("virtual-desktop-file-list.json" in ref for ref in trace_validation["artifactRefs"])


def test_virtual_desktop_probe_reports_ambiguous_grounding_as_repairable_failure(tmp_path):
    scenario_file = write_scenario(tmp_path, ambiguous_scenario())
    output_dir = tmp_path / "virtual-ambiguous"
    failed = run_virtual_probe(
        "--request-json",
        json.dumps({"task": "click the ambiguous Save control", "maxSteps": 1}),
        "--scenario-file",
        str(scenario_file),
        "--output-dir",
        str(output_dir),
    )

    assert failed.returncode == 1
    assert failed.stderr == ""
    payload = json.loads(failed.stdout)
    assert payload["status"] == "failed-with-reason"
    assert payload["failureDiagnostics"]["failedStage"] == "grounding"
    assert payload["failureDiagnostics"]["virtualDesktopLocateFailures"][0]["matchCount"] == 2
    assert payload["failureDiagnostics"]["stateOnlyActionsExecuted"] is False
    repair_manifest_ref = Path(payload["failureDiagnostics"]["repairManifestRef"])
    assert repair_manifest_ref == (output_dir / "blocked-repair-manifest.json").resolve()
    assert repair_manifest_ref.is_file()
    repair_manifest = json.loads(repair_manifest_ref.read_text(encoding="utf8"))
    assert repair_manifest["schemaVersion"] == "sciforge.computer-use.repair-manifest.v1"
    assert repair_manifest["failedStage"] == "grounding"
    assert repair_manifest["locateFailures"][0]["matchCount"] == 2
    assert repair_manifest["inputAdapterStatus"] == "independent-simulated-input-adapter"
    assert repair_manifest["inputExecuted"] is False
    assert repair_manifest["realWindowEvidence"] is False
    assert repair_manifest["traceRefs"] == [str((output_dir / "vision-trace.json").resolve())]
    assert "disambiguating target" in repair_manifest["repairHint"]
    manifest = json.loads((output_dir / "virtual-desktop-probe-manifest.json").read_text(encoding="utf8"))
    assert manifest["locateFailures"][0]["targetDescription"] == "Save"
    assert manifest["repairManifestRef"] == str(repair_manifest_ref)
    assert manifest["inputExecuted"] is False
    assert manifest["stateOnlyActionsExecuted"] is False
    assert validate_trace(output_dir / "vision-trace.json")["ok"] is True


def test_virtual_desktop_probe_does_not_promote_control_files_as_final_artifacts(tmp_path):
    scenario_file = write_scenario(tmp_path, control_artifact_scenario())
    output_dir = tmp_path / "virtual-control-artifact"
    failed = run_virtual_probe(
        "--request-json",
        json.dumps({
            "task": "reject control file as final artifact",
            "maxSteps": 1,
            "metadata": {"requiresFinalArtifact": True},
        }),
        "--scenario-file",
        str(scenario_file),
        "--output-dir",
        str(output_dir),
    )

    assert failed.returncode == 1
    payload = json.loads(failed.stdout)
    assert payload["status"] == "failed-with-reason"
    assert payload["failureDiagnostics"]["failedStage"] == "final-artifact-evidence"
    assert payload["finalArtifactRef"] is None
    assert payload["finalArtifactRefs"] == []
    assert not (output_dir / ".sciforge/vision-runs/virtual-desktop/tool-payload.json").exists()
    trace = json.loads((output_dir / "vision-trace.json").read_text(encoding="utf8"))
    assert trace["finalArtifactRef"] is None
    assert trace["finalArtifactRefs"] == []


def test_virtual_desktop_probe_runs_repository_six_step_fixture(tmp_path):
    output_dir = tmp_path / "repo-six-step"
    completed = run_virtual_probe(
        "--request-json",
        json.dumps({
            "task": "run repository virtual desktop six step fixture",
            "maxSteps": 8,
            "metadata": {
                "requiresFinalArtifact": True,
                "requiresDirectoryEvidence": True,
            },
        }),
        "--scenario-file",
        str(SIX_STEP_FIXTURE),
        "--output-dir",
        str(output_dir),
    )

    assert completed.returncode == 0, completed.stdout
    payload = json.loads(completed.stdout)
    assert payload["status"] == "completed"
    assert len(payload["steps"]) == 6
    assert payload["failureDiagnostics"]["realWindowEvidence"] is False
    assert payload["failureDiagnostics"]["fileListArtifactRef"].endswith("task-b-file-list.json")
    assert payload["finalArtifactRefs"] == [payload["finalArtifactRef"]]
    assert validate_trace(output_dir / "vision-trace.json")["ok"] is True


def test_virtual_desktop_probe_runs_repository_ambiguous_repaired_fixture(tmp_path):
    output_dir = tmp_path / "repo-ambiguous-repaired"
    completed = run_virtual_probe(
        "--request-json",
        json.dumps({
            "task": "run repository repaired ambiguous fixture",
            "maxSteps": 2,
            "metadata": {
                "requiresFinalArtifact": True,
                "requiresDirectoryEvidence": True,
            },
        }),
        "--scenario-file",
        str(AMBIGUOUS_REPAIRED_FIXTURE),
        "--output-dir",
        str(output_dir),
    )

    assert completed.returncode == 0, completed.stdout
    payload = json.loads(completed.stdout)
    assert payload["status"] == "completed"
    assert len(payload["steps"]) == 1
    assert payload["steps"][0]["grounding"]["metadata"]["elementId"] == "lower-right-blue-save-button"
    assert payload["failureDiagnostics"]["realWindowEvidence"] is False
    assert validate_trace(output_dir / "vision-trace.json")["ok"] is True


def test_virtual_desktop_probe_writes_repair_replay_evidence_from_source_manifest(tmp_path):
    failed_scenario = json.loads(AMBIGUOUS_REPAIRED_FIXTURE.read_text(encoding="utf8"))
    failed_scenario["plans"] = [{"type": "click", "targetDescription": "Save button"}]
    failed_scenario_file = write_scenario(tmp_path, failed_scenario)
    failed_dir = tmp_path / "repo-ambiguous-failed"
    failed = run_virtual_probe(
        "--request-json",
        json.dumps({"task": "fail broad ambiguous Save target", "maxSteps": 1}),
        "--scenario-file",
        str(failed_scenario_file),
        "--output-dir",
        str(failed_dir),
    )
    assert failed.returncode == 1, failed.stdout
    failure_payload = json.loads(failed.stdout)
    source_manifest_ref = failure_payload["failureDiagnostics"]["repairManifestRef"]

    replay_dir = tmp_path / "repo-ambiguous-replayed"
    completed = run_virtual_probe(
        "--request-json",
        json.dumps({
            "task": "run repository repaired ambiguous fixture",
            "maxSteps": 2,
            "metadata": {
                "requiresFinalArtifact": True,
                "requiresDirectoryEvidence": True,
            },
        }),
        "--scenario-file",
        str(AMBIGUOUS_REPAIRED_FIXTURE),
        "--output-dir",
        str(replay_dir),
        "--source-repair-manifest",
        source_manifest_ref,
    )

    assert completed.returncode == 0, completed.stdout
    payload = json.loads(completed.stdout)
    evidence_ref = Path(payload["failureDiagnostics"]["repairReplayEvidenceRef"])
    assert evidence_ref == (replay_dir / "repair-replay-evidence.json").resolve()
    evidence = json.loads(evidence_ref.read_text(encoding="utf8"))
    assert evidence["schemaVersion"] == "sciforge.computer-use.repair-replay-evidence.v1"
    assert evidence["status"] == "completed"
    assert evidence["sourceFailureManifestRef"] == source_manifest_ref
    assert evidence["originalTargetDescription"] == "Save button"
    assert evidence["beforeMatchCount"] > 1
    assert evidence["afterMatchCount"] == 1
    assert evidence["selectedElementId"] == "lower-right-blue-save-button"
    assert evidence["selectedElementWasFailedCandidate"] is True
    assert evidence["realWindowEvidence"] is False
    assert evidence["diagnosticOnly"] is True
    assert evidence["errors"] == []
    validation_from_path = validate_repair_replay_evidence(evidence_ref)
    validation_from_mapping = validateRepairReplayEvidence(evidence)
    assert validation_from_path["ok"] is True
    assert validation_from_mapping["ok"] is True
    assert validation_from_path["replayResultRef"] == str((replay_dir / "computer-use-result.json").resolve())
    assert validation_from_path["replayTraceRefs"] == [str((replay_dir / "vision-trace.json").resolve())]


def test_repair_replay_validator_rejects_non_converged_or_unreferenced_evidence(tmp_path):
    valid = {
        "schemaVersion": "sciforge.computer-use.repair-replay-evidence.v1",
        "status": "completed",
        "sourceFailureManifestRef": "blocked-repair-manifest.json",
        "replayResultRef": "computer-use-result.json",
        "replayTraceRefs": ["vision-trace.json"],
        "failedStage": "grounding",
        "beforeMatchCount": 2,
        "beforeCandidateElementIds": ["upper-save", "lower-save"],
        "afterMatchCount": 1,
        "selectedElementId": "lower-save",
        "selectedElementWasFailedCandidate": True,
        "realWindowEvidence": False,
        "diagnosticOnly": True,
    }
    valid_ref = tmp_path / "valid-replay-evidence.json"
    valid_ref.write_text(json.dumps(valid), encoding="utf8")
    assert validate_repair_replay_evidence(valid)["ok"] is True
    assert validate_repair_replay_evidence(valid_ref)["ok"] is True
    strict_missing_codes = {
        error["code"] for error in validate_repair_replay_evidence(valid, require_existing_refs=True)["errors"]
    }
    assert "evidence_ref_not_found" in strict_missing_codes

    source_ref = tmp_path / "blocked-repair-manifest.json"
    result_ref = tmp_path / "computer-use-result.json"
    trace_ref = tmp_path / "vision-trace.json"
    for ref in (source_ref, result_ref, trace_ref):
        ref.write_text("{}", encoding="utf8")
    local_valid = {
        **valid,
        "sourceFailureManifestRef": str(source_ref),
        "replayResultRef": str(result_ref),
        "replayTraceRefs": [str(trace_ref)],
    }
    assert validate_repair_replay_evidence(local_valid, require_existing_refs=True)["ok"] is True

    invalid = {
        **valid,
        "status": "blocked",
        "replayResultRef": "",
        "replayTraceRefs": [],
        "beforeMatchCount": 1,
        "afterMatchCount": None,
        "selectedElementId": "not-a-prior-candidate",
        "selectedElementWasFailedCandidate": False,
        "realWindowEvidence": False,
        "diagnosticOnly": False,
    }
    validation = validate_repair_replay_evidence(invalid)
    codes = {error["code"] for error in validation["errors"]}

    assert validation["ok"] is False
    assert {
        "status_not_completed",
        "replay_result_ref_missing",
        "replay_trace_refs_missing",
        "before_match_count_not_ambiguous",
        "after_match_count_missing",
        "selected_element_not_failed_candidate",
        "selected_element_membership_flag_not_true",
        "real_window_flags_inconsistent",
    } <= codes

    missing_flags = {key: value for key, value in valid.items() if key not in {"realWindowEvidence", "diagnosticOnly"}}
    missing_flags_codes = {error["code"] for error in validate_repair_replay_evidence(missing_flags)["errors"]}
    assert {"real_window_evidence_missing", "diagnostic_only_missing"} <= missing_flags_codes

    bad_candidate_shape = {**valid, "beforeCandidateElementIds": "lower-save", "selectedElementId": "lower-save"}
    bad_candidate_codes = {error["code"] for error in validate_repair_replay_evidence(bad_candidate_shape)["errors"]}
    assert "before_candidate_ids_invalid" in bad_candidate_codes

    whitespace_refs = {
        **valid,
        "sourceFailureManifestRef": "   ",
        "replayResultRef": "   ",
        "failedStage": "   ",
    }
    whitespace_codes = {error["code"] for error in validate_repair_replay_evidence(whitespace_refs)["errors"]}
    assert {
        "source_failure_manifest_ref_missing",
        "replay_result_ref_missing",
        "failed_stage_missing",
    } <= whitespace_codes

    self_declared_real = {
        **valid,
        "realWindowEvidence": True,
        "diagnosticOnly": False,
    }
    self_declared_real_codes = {
        error["code"] for error in validate_repair_replay_evidence(self_declared_real)["errors"]
    }
    assert {"real_window_evidence_refs_missing", "target_binding_validation_missing"} <= self_declared_real_codes

    real_with_shallow_binding = {
        **self_declared_real,
        "realWindowEvidenceRefs": ["native-target-window-binding-proof.json"],
        "targetBindingValidation": {"ok": True},
    }
    shallow_binding_codes = {
        error["code"] for error in validate_repair_replay_evidence(real_with_shallow_binding)["errors"]
    }
    assert {
        "target_binding_existing_refs_missing",
        "target_binding_status_not_bound",
        "target_binding_environment_missing",
        "target_binding_adapter_manifest_ref_missing",
        "target_binding_target_window_ref_missing",
        "target_binding_evidence_refs_missing",
        "target_binding_execution_not_real_target",
        "target_binding_real_window_capability_missing",
    } <= shallow_binding_codes

    real_with_binding = {
        **self_declared_real,
        "realWindowEvidenceRefs": ["native-target-window-binding-proof.json"],
        "targetBindingValidation": real_window_target_binding_validation(),
    }
    assert validate_repair_replay_evidence(real_with_binding)["ok"] is True

    inline_payload = {**valid, "debug": "data:image/png;base64,AAAA"}
    inline_codes = {error["code"] for error in validate_repair_replay_evidence(inline_payload)["errors"]}
    assert "inline_payload_forbidden" in inline_codes


def test_build_repair_replay_evidence_uses_later_grounded_replay_step(tmp_path):
    failure_manifest = {
        "schemaVersion": "sciforge.computer-use.repair-manifest.v1",
        "failedStage": "grounding",
        "locateFailures": [
            {
                "targetDescription": "Save",
                "matchCount": 2,
                "matches": [{"id": "upper-save"}, {"id": "lower-save"}],
            }
        ],
        "failureDiagnostics": {"realWindowEvidence": False},
    }
    replay_result = {
        "status": "completed",
        "traceRefs": ["vision-trace.json"],
        "steps": [
            {
                "action": {"target": "First step"},
                "grounding": {"metadata": {}},
            },
            {
                "action": {"target": "Save lower"},
                "grounding": {"metadata": {"elementId": "lower-save", "matchCount": 1}},
            },
        ],
        "failureDiagnostics": {"realWindowEvidence": False},
    }

    failure_ref = tmp_path / "blocked-repair-manifest.json"
    replay_ref = tmp_path / "computer-use-result.json"
    failure_ref.write_text(json.dumps(failure_manifest), encoding="utf8")
    replay_ref.write_text(json.dumps(replay_result), encoding="utf8")

    from sciforge_computer_use import buildRepairReplayEvidence

    evidence = buildRepairReplayEvidence(failure_ref, replay_ref)

    assert evidence["status"] == "completed"
    assert evidence["replayedTargetDescription"] == "Save lower"
    assert evidence["selectedElementId"] == "lower-save"
    assert evidence["afterMatchCount"] == 1


def test_virtual_desktop_probe_writes_viewport_failure_and_scroll_recovery_evidence(tmp_path):
    failed_scenario_file = write_scenario(tmp_path, offscreen_failure_scenario())
    failed_dir = tmp_path / "offscreen-failed"
    failed = run_virtual_probe(
        "--request-json",
        json.dumps({"task": "click the offscreen Export button", "maxSteps": 1}),
        "--scenario-file",
        str(failed_scenario_file),
        "--output-dir",
        str(failed_dir),
    )

    assert failed.returncode == 1, failed.stdout
    failure_payload = json.loads(failed.stdout)
    viewport_failures = failure_payload["failureDiagnostics"]["virtualDesktopViewportFailures"]
    assert viewport_failures[0]["failureClass"] == "offscreen-target"
    assert viewport_failures[0]["visibleMatchCount"] == 0
    assert viewport_failures[0]["offscreenCandidateElementIds"] == ["export-button"]
    source_manifest_ref = failure_payload["failureDiagnostics"]["repairManifestRef"]
    source_manifest = json.loads(Path(source_manifest_ref).read_text(encoding="utf8"))
    assert source_manifest["viewportFailures"][0]["targetDescription"] == "Export button"
    assert source_manifest["stateOnlyActionsExecuted"] is False

    replay_scenario_file = write_scenario(tmp_path, offscreen_recovery_scenario())
    replay_dir = tmp_path / "offscreen-replayed"
    completed = run_virtual_probe(
        "--request-json",
        json.dumps({"task": "scroll to and click the offscreen Export button", "maxSteps": 3}),
        "--scenario-file",
        str(replay_scenario_file),
        "--output-dir",
        str(replay_dir),
        "--source-repair-manifest",
        source_manifest_ref,
    )

    assert completed.returncode == 0, completed.stdout
    payload = json.loads(completed.stdout)
    evidence_ref = Path(payload["failureDiagnostics"]["viewportRecoveryEvidenceRef"])
    evidence = json.loads(evidence_ref.read_text(encoding="utf8"))

    assert evidence["schemaVersion"] == "sciforge.computer-use.viewport-recovery-evidence.v1"
    assert evidence["status"] == "completed"
    assert evidence["sourceFailureManifestRef"] == source_manifest_ref
    assert evidence["failureClass"] == "offscreen-target"
    assert evidence["visibleMatchCount"] == 0
    assert evidence["offscreenCandidateElementIds"] == ["export-button"]
    assert evidence["recoveryAction"]["kind"] == "scroll"
    assert evidence["scrollDelta"]["deltaY"] > 0
    assert evidence["scrollStateBeforeRef"].endswith("0000-input-state.json")
    assert evidence["scrollStateAfterRef"].endswith("0001-input-state.json")
    assert evidence["afterMatchCount"] == 1
    assert evidence["selectedElementId"] == "export-button"
    assert evidence["selectedElementWasOffscreenCandidate"] is True
    assert evidence["realWindowEvidence"] is False
    assert evidence["diagnosticOnly"] is True
    assert validate_viewport_recovery_evidence(evidence_ref)["ok"] is True


def test_viewport_recovery_validator_rejects_missing_scroll_or_wrong_candidate(tmp_path):
    valid = {
        "schemaVersion": "sciforge.computer-use.viewport-recovery-evidence.v1",
        "status": "completed",
        "sourceFailureManifestRef": "blocked-repair-manifest.json",
        "replayResultRef": "computer-use-result.json",
        "replayTraceRefs": ["vision-trace.json"],
        "failedStage": "grounding",
        "failureClass": "offscreen-target",
        "visibleMatchCount": 0,
        "offscreenCandidateElementIds": ["export-button"],
        "recoveryAction": {"kind": "scroll", "direction": "down"},
        "scrollStateBeforeRef": "before-input-state.json",
        "scrollStateAfterRef": "after-input-state.json",
        "scrollDelta": {"deltaX": 0, "deltaY": 4},
        "afterMatchCount": 1,
        "selectedElementId": "export-button",
        "selectedElementWasOffscreenCandidate": True,
        "realWindowEvidence": False,
        "diagnosticOnly": True,
    }
    assert validate_viewport_recovery_evidence(valid)["ok"] is True
    strict_missing_codes = {
        error["code"] for error in validate_viewport_recovery_evidence(valid, require_existing_refs=True)["errors"]
    }
    assert "evidence_ref_not_found" in strict_missing_codes

    refs = {
        "sourceFailureManifestRef": tmp_path / "blocked-repair-manifest.json",
        "replayResultRef": tmp_path / "computer-use-result.json",
        "trace": tmp_path / "vision-trace.json",
        "scrollStateBeforeRef": tmp_path / "before-input-state.json",
        "scrollStateAfterRef": tmp_path / "after-input-state.json",
    }
    for ref in refs.values():
        ref.write_text("{}", encoding="utf8")
    local_valid = {
        **valid,
        "sourceFailureManifestRef": str(refs["sourceFailureManifestRef"]),
        "replayResultRef": str(refs["replayResultRef"]),
        "replayTraceRefs": [str(refs["trace"])],
        "scrollStateBeforeRef": str(refs["scrollStateBeforeRef"]),
        "scrollStateAfterRef": str(refs["scrollStateAfterRef"]),
    }
    assert validate_viewport_recovery_evidence(local_valid, require_existing_refs=True)["ok"] is True

    invalid = {
        **valid,
        "replayTraceRefs": [],
        "recoveryAction": {"kind": "click"},
        "scrollDelta": {"deltaX": 0, "deltaY": 0},
        "selectedElementId": "other",
        "selectedElementWasOffscreenCandidate": False,
        "realWindowEvidence": False,
        "diagnosticOnly": False,
    }
    codes = {error["code"] for error in validate_viewport_recovery_evidence(invalid)["errors"]}
    assert {
        "replay_trace_refs_missing",
        "recovery_action_not_scroll",
        "scroll_delta_missing",
        "selected_element_not_offscreen_candidate",
        "selected_element_membership_flag_not_true",
        "real_window_flags_inconsistent",
    } <= codes

    self_declared_real = {
        **valid,
        "realWindowEvidence": True,
        "diagnosticOnly": False,
    }
    self_declared_real_codes = {
        error["code"] for error in validate_viewport_recovery_evidence(self_declared_real)["errors"]
    }
    assert {"real_window_evidence_refs_missing", "target_binding_validation_missing"} <= self_declared_real_codes

    synthetic_real_binding = {
        **valid,
        "realWindowEvidence": True,
        "diagnosticOnly": False,
        "realWindowEvidenceRefs": ["real-window-before.png", "real-window-after.png"],
        "targetBindingValidation": {
            "ok": True,
            "bindingStatus": "bound",
            "targetEnvironmentKind": "package-local-virtual-desktop",
            "adapterManifestRef": "adapter-manifest.json",
            "targetWindowRef": "target-window.json",
            "evidenceRefs": ["binding-proof.json"],
            "executeChangesTargetEnvironment": True,
            "realWindowEvidenceCapable": True,
            "errors": [],
        },
    }
    synthetic_codes = {
        error["code"] for error in validate_viewport_recovery_evidence(synthetic_real_binding)["errors"]
    }
    assert {
        "target_binding_existing_refs_missing",
        "target_binding_environment_virtual_or_diagnostic",
    } <= synthetic_codes

    inline_payload = {**valid, "debug": "data:image/png;base64,AAAA"}
    inline_codes = {error["code"] for error in validate_viewport_recovery_evidence(inline_payload)["errors"]}
    assert "inline_payload_forbidden" in inline_codes


def write_scenario(tmp_path, payload):
    path = tmp_path / "scenario.json"
    path.write_text(json.dumps(payload), encoding="utf8")
    return path


def six_step_scenario():
    final_artifact = ".sciforge/vision-runs/virtual-desktop/virtual-desktop-task.md"
    file_list = ".sciforge/vision-runs/virtual-desktop/virtual-desktop-file-list.json"
    file_list_data = ".sciforge/vision-runs/virtual-desktop/virtual-desktop-file-list-data.json"
    return {
        "schemaVersion": "sciforge.computer-use.virtual-desktop-scenario.v1",
        "id": "virtual-desktop-six-step",
        "screens": [
            screen("start", "Virtual editor before focus.", [element("editor", "Virtual editor input area", x=10, y=20)]),
            screen("focused", "Virtual editor focused.", [element("editor", "Virtual editor input area", x=10, y=20)]),
            screen("typed", "Markdown content is visible.", [element("save", "Save document button", x=200, y=20)]),
            screen("saved", "Document is saved.", [element("files", "Files sidebar", x=5, y=120)]),
            screen("files", "File list shows saved document.", [element("file-entry", "virtual-desktop-task.md file entry", x=30, y=140)]),
            screen("preview", "Preview shows the saved markdown.", [element("directory", "virtual-desktop-file-list.json entry", x=50, y=160)]),
            {
                **screen("directory", "Final directory evidence is visible.", [element("directory", "virtual-desktop-file-list.json entry", x=50, y=160)]),
                "artifacts": {
                    "finalArtifactRef": final_artifact,
                    "fileList": {
                        "schemaVersion": "sciforge.computer-use.virtual-desktop-file-list.v1",
                        "kind": "directory-file-list-artifact",
                        "status": "visible-and-saved",
                        "artifactRef": file_list,
                        "dataRef": file_list_data,
                    },
                },
            },
        ],
        "plans": [
            {"type": "click", "targetDescription": "Virtual editor input area"},
            {"type": "type_text", "text": "# Virtual Desktop Task\n\n- isolated input\n- stdio loop\n- directory evidence\n"},
            {"type": "press_key", "keys": ["Ctrl", "S"], "metadata": {"intent": "save", "saveRef": final_artifact}},
            {"type": "click", "targetDescription": "Files sidebar"},
            {"type": "double_click", "targetDescription": "virtual-desktop-task.md file entry"},
            {"type": "click", "targetDescription": "virtual-desktop-file-list.json entry"},
        ],
        "verification": [
            {"ok": True, "done": False, "reason": "editor focused"},
            {"ok": True, "done": False, "reason": "text entered"},
            {"ok": True, "done": False, "reason": "save state ref written"},
            {"ok": True, "done": False, "reason": "file view focused"},
            {"ok": True, "done": False, "reason": "preview opened"},
            {
                "ok": True,
                "done": True,
                "reason": "final artifact and directory evidence are visible in virtual desktop",
                "metadata": {
                    "finalArtifactRef": final_artifact,
                    "fileListArtifactRef": file_list,
                    "fileListDataRef": file_list_data,
                },
            },
        ],
        "files": {
            final_artifact: "# Virtual Desktop Task\n\n- isolated input\n- stdio loop\n- directory evidence\n",
            file_list: {
                "schemaVersion": "sciforge.computer-use.file-list-evidence.v1",
                "entries": [
                    {"name": "virtual-desktop-task.md", "type": "file"},
                    {"name": "virtual-desktop-file-list.json", "type": "file"},
                    {"name": "virtual-desktop-file-list-data.json", "type": "file"},
                ],
            },
            file_list_data: {
                "files": [
                    "virtual-desktop-task.md",
                    "virtual-desktop-file-list.json",
                    "virtual-desktop-file-list-data.json",
                ],
            },
        },
    }


def ambiguous_scenario():
    return {
        "schemaVersion": "sciforge.computer-use.virtual-desktop-scenario.v1",
        "id": "virtual-desktop-ambiguous",
        "screens": [
            screen(
                "ambiguous",
                "Two Save controls are visible.",
                [
                    element("save-toolbar", "Save", role="button", x=10, y=10),
                    element("save-template", "Save", role="menuitem", x=100, y=10),
                ],
            ),
        ],
        "plans": [{"type": "click", "targetDescription": "Save"}],
    }


def control_artifact_scenario():
    return {
        "schemaVersion": "sciforge.computer-use.virtual-desktop-scenario.v1",
        "id": "virtual-desktop-control-artifact",
        "screens": [
            {
                **screen("control", "Only a control artifact is visible.", [element("control", "Trace details", x=10, y=10)]),
                "artifacts": {
                    "finalArtifactRef": ".sciforge/vision-runs/virtual-desktop/tool-payload.json",
                },
            }
        ],
        "plans": [{"done": True, "reason": "planner must not complete from control artifact"}],
    }


def offscreen_failure_scenario():
    return {
        "schemaVersion": "sciforge.computer-use.virtual-desktop-scenario.v1",
        "id": "virtual-desktop-offscreen-failure",
        "screens": [
            screen(
                "top",
                "The export button exists below the current viewport.",
                [
                    element("editor", "Document body", x=10, y=10),
                    {**element("export-button", "Export button", role="button", x=20, y=900), "visibility": "offscreen"},
                ],
            )
        ],
        "plans": [{"type": "click", "targetDescription": "Export button"}],
    }


def offscreen_recovery_scenario():
    return {
        "schemaVersion": "sciforge.computer-use.virtual-desktop-scenario.v1",
        "id": "virtual-desktop-offscreen-recovery",
        "screens": [
            screen(
                "top",
                "The export button exists below the current viewport.",
                [
                    element("editor", "Document body", x=10, y=10),
                    {**element("export-button", "Export button", role="button", x=20, y=900), "visibility": "offscreen"},
                ],
            ),
            screen(
                "scrolled",
                "After scrolling, the export button is visible.",
                [element("export-button", "Export button", role="button", x=20, y=120)],
            ),
            screen(
                "exported",
                "Export confirmation is visible.",
                [element("export-done", "Export complete", role="status", x=20, y=120)],
            ),
        ],
        "plans": [
            {"type": "scroll", "direction": "down", "amount": 4},
            {"type": "click", "targetDescription": "Export button"},
        ],
        "transitions": [
            {"fromScreenId": "top", "actionKind": "scroll", "direction": "down", "toScreenId": "scrolled"},
            {"fromScreenId": "scrolled", "actionKind": "click", "elementId": "export-button", "toScreenId": "exported"},
        ],
        "verification": [
            {"ok": True, "done": False, "reason": "viewport scrolled"},
            {"ok": True, "done": True, "reason": "export action reached visible target"},
        ],
    }


def screen(screen_id, summary, elements):
    return {
        "id": screen_id,
        "ref": f".sciforge/vision-runs/virtual-desktop/{screen_id}.png",
        "summary": summary,
        "elements": elements,
    }


def element(element_id, text, *, role="textbox", x=0, y=0):
    return {
        "id": element_id,
        "text": text,
        "role": role,
        "description": text,
        "bounds": {"x": x, "y": y, "width": 20, "height": 10},
    }


def real_window_target_binding_validation():
    return {
        "schemaVersion": "sciforge.computer-use.input-adapter-target-binding-validation.v1",
        "ok": True,
        "errors": [],
        "requireExistingRefs": True,
        "bindingStatus": "bound",
        "targetEnvironmentKind": "native-window-isolated-session",
        "adapterManifestRef": "adapter-manifest.json",
        "targetWindowRef": "target-window.json",
        "evidenceRefs": ["target-binding-proof.json"],
        "targetWindowResolved": True,
        "executeChangesTargetEnvironment": True,
        "realWindowEvidenceCapable": True,
    }
