import json
from pathlib import Path

import sciforge_computer_use.virtual_input_adapter as virtual_input_adapter
from sciforge_computer_use.contracts import ActionPlan, ActionTarget, ComputerUseRequest, Grounding
from sciforge_computer_use.virtual_input_adapter import (
    INPUT_ADAPTER_BINDING_STATUS_BOUND,
    INPUT_ADAPTER_BINDING_STATUS_UNBOUND,
    INPUT_ADAPTER_BINDING_STATUS_VIRTUAL_STATE_ONLY,
    INPUT_ADAPTER_MANIFEST_VALIDATION_SCHEMA,
    INPUT_ADAPTER_TARGET_BINDING_SCHEMA,
    INPUT_ADAPTER_TARGET_BINDING_VALIDATION_SCHEMA,
    VIRTUAL_INPUT_ADAPTER_STATUS,
    VIRTUAL_INPUT_CHANNEL,
    VirtualInputAdapter,
    apply_virtual_input_action,
    build_input_adapter_target_binding_manifest,
    build_target_bound_input_adapter_manifest,
    create_virtual_input_state,
    get_virtual_input_adapter_manifest,
    load_input_adapter_manifest,
    load_input_adapter_target_binding_manifest,
    load_virtual_input_state,
    validate_input_adapter_manifest_for_real_desktop,
    validate_input_adapter_target_binding_manifest,
)


def test_virtual_input_manifest_declares_independent_no_os_input():
    manifest = get_virtual_input_adapter_manifest()

    assert manifest["schemaVersion"] == "sciforge.computer-use.virtual-input-adapter-manifest.v1"
    assert manifest["inputAdapterStatus"] == VIRTUAL_INPUT_ADAPTER_STATUS
    assert manifest["inputChannel"] == VIRTUAL_INPUT_CHANNEL
    assert manifest["hostPortUsage"]["port"] == "execute"
    assert {"click", "type_text", "save", "focus", "scroll"} <= set(manifest["supportedActions"])
    assert manifest["sideEffects"] == {
        "simulatedStateOnly": True,
        "realOsInput": False,
        "sharedSystemInput": False,
        "systemPointerMove": False,
        "systemKeyboardEvent": False,
    }
    assert "high-risk-action" in manifest["failClosedFor"]
    assert "shared-system" in manifest["blockedInputModes"]
    assert manifest["bindingStatus"] == "unbound"
    assert manifest["bindingManifestSchema"] == INPUT_ADAPTER_TARGET_BINDING_SCHEMA
    assert manifest["targetBindingRequiredForRealDesktopEvidence"] is True
    assert manifest["executeChangesTargetEnvironment"] is False
    assert manifest["realWindowEvidenceCapable"] is False


def test_target_binding_helpers_are_public_module_surface():
    exported = set(virtual_input_adapter.__all__)

    assert {
        "INPUT_ADAPTER_BINDING_STATUS_BOUND",
        "INPUT_ADAPTER_BINDING_STATUS_UNBOUND",
        "INPUT_ADAPTER_BINDING_STATUS_VIRTUAL_STATE_ONLY",
        "INPUT_ADAPTER_MANIFEST_VALIDATION_SCHEMA",
        "INPUT_ADAPTER_TARGET_BINDING_SCHEMA",
        "INPUT_ADAPTER_TARGET_BINDING_VALIDATION_SCHEMA",
        "build_target_bound_input_adapter_manifest",
        "build_input_adapter_target_binding_manifest",
        "load_input_adapter_manifest",
        "load_input_adapter_target_binding_manifest",
        "validate_input_adapter_manifest_for_real_desktop",
        "validate_input_adapter_target_binding_manifest",
    } <= exported


def test_target_bound_input_adapter_manifest_declares_real_desktop_preflight_capability(tmp_path):
    manifest = build_target_bound_input_adapter_manifest(
        executor_provider="native-independent-executor",
        input_channel="isolated-window",
        metadata={"apiKey": "must-redact"},
    )

    assert manifest["schemaVersion"] == "sciforge.computer-use.virtual-input-adapter-manifest.v1"
    assert manifest["inputAdapterStatus"] == VIRTUAL_INPUT_ADAPTER_STATUS
    assert manifest["inputChannel"] == "isolated-window"
    assert manifest["executorProvider"] == "native-independent-executor"
    assert manifest["executeChangesTargetEnvironment"] is True
    assert manifest["realWindowEvidenceCapable"] is True
    assert manifest["sideEffects"]["realOsInput"] is False
    assert manifest["sideEffects"]["sharedSystemInput"] is False
    assert manifest["metadata"]["apiKey"] == "[REDACTED]"
    validation = validate_input_adapter_manifest_for_real_desktop(manifest)
    assert validation["schemaVersion"] == INPUT_ADAPTER_MANIFEST_VALIDATION_SCHEMA
    assert validation["ok"] is True

    manifest_ref = tmp_path / "target-bound-adapter.json"
    manifest_ref.write_text(json.dumps(manifest), encoding="utf8")
    assert load_input_adapter_manifest(manifest_ref)["executorProvider"] == "native-independent-executor"
    assert validate_input_adapter_manifest_for_real_desktop(manifest_ref)["ok"] is True


def test_target_bound_input_adapter_manifest_validator_blocks_diagnostic_manifest():
    state_only = get_virtual_input_adapter_manifest()
    validation = validate_input_adapter_manifest_for_real_desktop(state_only)

    assert validation["ok"] is False
    assert "adapter manifest inputChannel must be target-bound isolated input" in validation["errors"]
    assert "adapter manifest executorProvider must be target-bound and non-diagnostic" in validation["errors"]
    assert "adapter manifest executeChangesTargetEnvironment must be true" in validation["errors"]
    assert "adapter manifest realWindowEvidenceCapable must be true" in validation["errors"]


def test_target_bound_input_adapter_manifest_validator_requires_explicit_no_side_effects():
    missing_side_effects = build_target_bound_input_adapter_manifest(
        executor_provider="native-independent-executor",
        input_channel="isolated-window",
    )
    del missing_side_effects["sideEffects"]

    validation = validate_input_adapter_manifest_for_real_desktop(missing_side_effects)

    assert validation["ok"] is False
    assert "adapter manifest sideEffects must be declared" in validation["errors"]
    assert "adapter manifest sideEffects.realOsInput must be false" in validation["errors"]
    assert "adapter manifest sideEffects.sharedSystemInput must be false" in validation["errors"]

    missing_real_os_flag = build_target_bound_input_adapter_manifest(
        executor_provider="native-independent-executor",
        input_channel="isolated-window",
    )
    del missing_real_os_flag["sideEffects"]["realOsInput"]
    assert "adapter manifest sideEffects.realOsInput must be false" in (
        validate_input_adapter_manifest_for_real_desktop(missing_real_os_flag)["errors"]
    )

    missing_binding_requirement = build_target_bound_input_adapter_manifest(
        executor_provider="native-independent-executor",
        input_channel="isolated-window",
    )
    del missing_binding_requirement["targetBindingRequiredForRealDesktopEvidence"]
    assert "adapter manifest targetBindingRequiredForRealDesktopEvidence must be true" in (
        validate_input_adapter_manifest_for_real_desktop(missing_binding_requirement)["errors"]
    )


def test_target_bound_input_adapter_manifest_validator_rejects_shortcut_executors():
    for provider in (
        "shell-direct-file-write-executor",
        "macos-ax-executor",
        "applescript-executor",
        "dom-playwright-executor",
        "private-api-executor",
        "clipboard-paste-executor",
    ):
        manifest = build_target_bound_input_adapter_manifest(
            executor_provider=provider,
            input_channel="isolated-window",
        )

        validation = validate_input_adapter_manifest_for_real_desktop(manifest)

        assert validation["ok"] is False
        assert "adapter manifest executorProvider must be target-bound and non-diagnostic" in validation["errors"]


def test_target_binding_manifest_validator_requires_bound_real_environment(tmp_path):
    unbound = build_input_adapter_target_binding_manifest()
    validation = validate_input_adapter_target_binding_manifest(unbound)

    assert unbound["schemaVersion"] == INPUT_ADAPTER_TARGET_BINDING_SCHEMA
    assert unbound["bindingStatus"] == INPUT_ADAPTER_BINDING_STATUS_UNBOUND
    assert validation["schemaVersion"] == INPUT_ADAPTER_TARGET_BINDING_VALIDATION_SCHEMA
    assert validation["ok"] is False
    assert "bindingStatus must be bound" in validation["errors"]
    assert "targetEnvironmentKind is required" in validation["errors"]
    assert "adapterManifestRef is required" in validation["errors"]
    assert "targetWindowRef is required" in validation["errors"]
    assert "evidenceRefs must include at least one ref" in validation["errors"]

    virtual_state_only = build_input_adapter_target_binding_manifest(
        binding_status=INPUT_ADAPTER_BINDING_STATUS_VIRTUAL_STATE_ONLY,
        target_environment_kind="package-local-virtual-desktop",
        target_window_resolved=True,
        execute_changes_target_environment=False,
        real_window_evidence_capable=False,
    )
    virtual_validation = validate_input_adapter_target_binding_manifest(virtual_state_only)
    assert virtual_validation["ok"] is False
    assert "bindingStatus must be bound" in virtual_validation["errors"]
    assert "targetEnvironmentKind must describe a real target-bound environment, not virtual/diagnostic/state-only" in virtual_validation["errors"]
    assert "executeChangesTargetEnvironment must be true" in virtual_validation["errors"]

    self_reported_virtual_environment = build_input_adapter_target_binding_manifest(
        binding_status=INPUT_ADAPTER_BINDING_STATUS_BOUND,
        target_environment_kind="diagnostic-package-local-virtual-desktop",
        target_window_resolved=True,
        execute_changes_target_environment=True,
        real_window_evidence_capable=True,
        adapter_manifest_ref="adapter.json",
        target_window_ref="target-window.json",
        evidence_refs=["binding-proof.json"],
    )
    virtual_environment_validation = validate_input_adapter_target_binding_manifest(self_reported_virtual_environment)
    assert virtual_environment_validation["ok"] is False
    assert "targetEnvironmentKind must describe a real target-bound environment, not virtual/diagnostic/state-only" in virtual_environment_validation["errors"]

    self_reported_without_refs = build_input_adapter_target_binding_manifest(
        binding_status=INPUT_ADAPTER_BINDING_STATUS_BOUND,
        target_environment_kind="native-window-isolated-session",
        target_window_resolved=True,
        execute_changes_target_environment=True,
        real_window_evidence_capable=True,
    )
    self_reported_validation = validate_input_adapter_target_binding_manifest(self_reported_without_refs)
    assert self_reported_validation["ok"] is False
    assert "adapterManifestRef is required" in self_reported_validation["errors"]
    assert "targetWindowRef is required" in self_reported_validation["errors"]
    assert "evidenceRefs must include at least one ref" in self_reported_validation["errors"]

    whitespace_only_ref = build_input_adapter_target_binding_manifest(
        binding_status=INPUT_ADAPTER_BINDING_STATUS_BOUND,
        target_environment_kind="native-window-isolated-session",
        target_window_resolved=True,
        execute_changes_target_environment=True,
        real_window_evidence_capable=True,
        adapter_manifest_ref="adapter.json",
        target_window_ref="target-window.json",
        evidence_refs=["   "],
    )
    whitespace_validation = validate_input_adapter_target_binding_manifest(whitespace_only_ref)
    assert whitespace_validation["ok"] is False
    assert "evidenceRefs must include at least one ref" in whitespace_validation["errors"]

    bound = build_input_adapter_target_binding_manifest(
        binding_status=INPUT_ADAPTER_BINDING_STATUS_BOUND,
        target_environment_kind="native-window-isolated-session",
        target_window_resolved=True,
        execute_changes_target_environment=True,
        real_window_evidence_capable=True,
        adapter_manifest_ref="adapter.json",
        target_window_ref="target-window.json",
        evidence_refs=["binding-proof.json"],
        metadata={"apiKey": "must-redact"},
    )
    bound_validation = validate_input_adapter_target_binding_manifest(bound)
    assert bound_validation["ok"] is True
    assert bound_validation["adapterManifestRef"] == "adapter.json"
    assert bound_validation["targetWindowRef"] == "target-window.json"
    assert bound_validation["evidenceRefs"] == ["binding-proof.json"]
    assert bound["osInputExecuted"] is False
    assert bound["sharedSystemInputUsed"] is False
    assert bound["systemPointerMoved"] is False
    assert bound["systemKeyboardEventsSent"] is False
    assert bound["metadata"]["apiKey"] == "[REDACTED]"

    binding_ref = tmp_path / "binding.json"
    binding_ref.write_text(json.dumps(bound), encoding="utf8")
    assert load_input_adapter_target_binding_manifest(binding_ref)["schemaVersion"] == INPUT_ADAPTER_TARGET_BINDING_SCHEMA
    assert validate_input_adapter_target_binding_manifest(binding_ref)["ok"] is True

    adapter_manifest_ref = tmp_path / "state-only-adapter.json"
    target_window_ref = tmp_path / "target-window.json"
    proof_ref = tmp_path / "binding-proof.json"
    adapter_manifest_ref.write_text(json.dumps(get_virtual_input_adapter_manifest()), encoding="utf8")
    target_window_ref.write_text(json.dumps({"schemaVersion": "fixture.window"}), encoding="utf8")
    proof_ref.write_text(json.dumps({"schemaVersion": "fixture.proof"}), encoding="utf8")
    state_only_bound = build_input_adapter_target_binding_manifest(
        binding_status=INPUT_ADAPTER_BINDING_STATUS_BOUND,
        target_environment_kind="native-window-isolated-session",
        target_window_resolved=True,
        execute_changes_target_environment=True,
        real_window_evidence_capable=True,
        adapter_manifest_ref=str(adapter_manifest_ref),
        target_window_ref=str(target_window_ref),
        evidence_refs=[str(proof_ref)],
    )
    state_only_validation = validate_input_adapter_target_binding_manifest(state_only_bound, require_existing_refs=True)
    assert state_only_validation["ok"] is False
    assert "adapter manifest inputChannel must be target-bound isolated input" in state_only_validation["errors"]
    assert "adapter manifest executorProvider must be target-bound and non-diagnostic" in state_only_validation["errors"]
    assert "adapter manifest executeChangesTargetEnvironment must be true" in state_only_validation["errors"]
    assert "adapter manifest realWindowEvidenceCapable must be true" in state_only_validation["errors"]


def test_virtual_adapter_records_common_actions_as_writable_state_refs(tmp_path):
    adapter = VirtualInputAdapter(tmp_path / "virtual-input", session_id="fixture-session")
    request = ComputerUseRequest(task="simulate local editor input")

    outcomes = [
        adapter.execute(
            ActionPlan(kind="click", target=ActionTarget(description="Title field")),
            Grounding(ok=True, x=11, y=22, coordinate_space="window", confidence=0.95),
            request,
        ),
        adapter.execute({"kind": "type_text", "text": "local note"}, None, request),
        adapter.execute(
            {"kind": "save", "metadata": {"finalArtifactRef": "artifact:virtual/local-note.md"}},
            None,
            request,
        ),
        adapter.execute({"kind": "focus", "targetDescription": "Preview pane"}, {"ok": True, "x": 44, "y": 55}, request),
        adapter.execute({"kind": "scroll", "direction": "down", "amount": 3}, None, request),
    ]

    for outcome in outcomes:
        assert outcome.ok is True
        assert outcome.blocked is False
        assert outcome.metadata["inputChannel"] == VIRTUAL_INPUT_CHANNEL
        assert outcome.metadata["simulatedStateUpdated"] is True
        assert outcome.metadata["osInputExecuted"] is False
        assert outcome.metadata["sharedSystemInputUsed"] is False
        assert outcome.metadata["systemPointerMoved"] is False
        assert outcome.metadata["systemKeyboardEventsSent"] is False
        for ref in outcome.metadata["stateRefs"].values():
            assert Path(ref).is_file()

    final_state = load_virtual_input_state(outcomes[-1].metadata["virtualInputStateRef"])
    pointer_state = load_virtual_input_state(outcomes[-1].metadata["virtualPointerStateRef"])
    keyboard_state = load_virtual_input_state(outcomes[-1].metadata["virtualKeyboardStateRef"])

    assert [entry["kind"] for entry in final_state["actionLog"]] == [
        "click",
        "type_text",
        "save",
        "focus",
        "scroll",
    ]
    assert all(entry["simulated"] is True for entry in final_state["actionLog"])
    assert all(entry["osSideEffect"] is False for entry in final_state["actionLog"])
    assert final_state["pointer"]["x"] == 44.0
    assert final_state["pointer"]["y"] == 55.0
    assert final_state["pointer"]["scrollOffset"]["y"] == 3.0
    assert final_state["keyboard"]["textInput"]["totalCharacters"] == len("local note")
    assert final_state["keyboard"]["textInput"]["lastTextSha256"]
    assert final_state["keyboard"]["saveCount"] == 1
    assert final_state["keyboard"]["lastSaveRef"] == "artifact:virtual/local-note.md"
    assert pointer_state["stateRef"] == outcomes[-1].metadata["virtualPointerStateRef"]
    assert keyboard_state["stateRef"] == outcomes[-1].metadata["virtualKeyboardStateRef"]


def test_virtual_adapter_fails_closed_for_real_input_modes_and_unsupported_actions(tmp_path):
    adapter = VirtualInputAdapter(tmp_path / "virtual-input", session_id="blocked")
    request = ComputerUseRequest(task="block real input")

    shared = adapter.execute(
        {"kind": "click", "targetDescription": "Button", "metadata": {"inputChannel": "shared-system"}},
        Grounding(ok=True, x=1, y=2),
        request,
    )
    real = adapter.execute(
        {"kind": "type_text", "text": "hello", "metadata": {"inputMode": "real-os"}},
        None,
        request,
    )
    unsupported = adapter.execute({"kind": "delete", "targetDescription": "File"}, None, request)

    for outcome in (shared, real, unsupported):
        assert outcome.ok is False
        assert outcome.blocked is True
        assert outcome.metadata["blocked"] is True
        assert outcome.metadata["osInputExecuted"] is False
        assert outcome.metadata["sharedSystemInputUsed"] is False
        assert outcome.metadata["stateRefWritten"] is True
        assert Path(outcome.metadata["virtualInputStateRef"]).is_file()
    assert shared.metadata["blockedCode"] == "real-input-mode"
    assert real.metadata["blockedCode"] == "real-input-mode"
    assert unsupported.metadata["blockedCode"] == "unsupported-action"


def test_virtual_adapter_fails_closed_for_high_risk_actions(tmp_path):
    adapter = VirtualInputAdapter(tmp_path / "virtual-input", session_id="risk")
    outcome = adapter.execute(
        {"kind": "click", "targetDescription": "Delete project", "riskLevel": "high"},
        Grounding(ok=True, x=10, y=20),
        ComputerUseRequest(
            task="delete project",
            risk_policy="allow-confirmed",
            approval_ref="approval:upstream",
        ),
    )

    assert outcome.ok is False
    assert outcome.blocked is True
    assert outcome.metadata["blockedCode"] == "high-risk-action"
    assert outcome.metadata["simulatedStateUpdated"] is False
    assert outcome.metadata["osInputExecuted"] is False
    assert "requires explicit upstream confirmation" in outcome.message


def test_apply_virtual_input_action_function_writes_state_refs(tmp_path):
    state = create_virtual_input_state(session_id="function")
    applied = apply_virtual_input_action(
        state,
        {"kind": "scroll", "direction": "right", "amount": 2},
        None,
        {"metadata": {"inputMode": "virtual-session"}},
        state_dir=tmp_path / "state",
    )

    assert applied.outcome.ok is True
    assert applied.outcome.metadata["actionKind"] == "scroll"
    assert applied.outcome.metadata["stateUpdate"]["kind"] == "scroll"
    assert set(applied.state_refs) == {
        "virtualInputStateRef",
        "virtualPointerStateRef",
        "virtualKeyboardStateRef",
    }
    assert load_virtual_input_state(applied.state_refs["virtualInputStateRef"])["pointer"]["scrollOffset"]["x"] == 2.0
