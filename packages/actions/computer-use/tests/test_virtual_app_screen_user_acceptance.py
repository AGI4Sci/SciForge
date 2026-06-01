from sciforge_computer_use.contracts import (
    ACTION_ADAPTER_READINESS_SCHEMA,
    ANNOTATION_OVERLAY_SCHEMA,
    INPUT_INTENT_SCHEMA,
    VIRTUAL_APP_SCREEN_USER_ACCEPTANCE_MANIFEST_SCHEMA,
    ActionAdapterReadiness,
    AnnotationOverlay,
    InputIntent,
    VirtualAppScreenUserAcceptanceManifest,
    validate_action_adapter_readiness,
    validate_annotation_overlay,
    validate_input_intent,
    validate_virtual_app_screen_user_acceptance_manifest,
)


def _codes(validation):
    return {error["code"] for error in validation["errors"]}


def _safe_isolation_flags():
    return {
        "isolatedBackgroundControl": True,
        "backgroundRenderable": True,
        "affectsPhysicalDisplay": False,
        "requiresFocusSteal": False,
        "sharedSystemInputUsed": False,
        "physicalPopupShown": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
    }


def _valid_target():
    return {
        "scope": "window",
        "screenId": "screen-main",
        "windowId": "window-research",
        "coordinateSpace": "window-local",
        "bounds": {"x": 10, "y": 12, "width": 120, "height": 34, "coordinateSpace": "window-local"},
    }


def _valid_manifest():
    return VirtualAppScreenUserAcceptanceManifest(
        task_id="task-research-note",
        scenario_id="scenario-browser-note",
        user_intent="Read the visible source passage and create a research note.",
        target_app_refs=["app:session-1/browser"],
        target_window_refs=["window:session-1/browser-main"],
        session_refs=["session:session-1"],
        adapter_readiness_refs=["adapter-readiness:session-1/native-window.json"],
        screen_frame_refs=["frame:session-1/before.png", "frame:session-1/after.png"],
        input_intent_refs=["input-intent:session-1/type-note.json"],
        executor_event_refs=["executor-event:session-1/type-note.json"],
        before_after_frame_refs=["before-after:session-1/type-note.json"],
        annotation_proposal_refs=["annotation-proposal:session-1/highlight.json"],
        artifact_refs=["artifact:session-1/research-note.md"],
        verification_refs=["verification:session-1/research-note.json"],
        gui_present_refs=["gui-present:session-1/screen-pane.json"],
        replay_ref="replay:session-1/bundle.json",
        evidence_ledger_ref="evidence-ledger:session-1/ledger.json",
        isolation_flags=_safe_isolation_flags(),
        status="passed",
        user_acceptance_eligible=True,
    ).as_dict()


def _valid_adapter_readiness():
    return ActionAdapterReadiness(
        adapter_id="adapter-native-window",
        adapter_kind="native-window",
        target_scope="window",
        supported_actions=["click", "type_text", "drag", "scroll", "hotkey", "menu_command"],
        capture_supported=True,
        background_renderable=True,
        affects_physical_display=False,
        requires_focus_steal=False,
        shared_system_input_used=False,
        schema_refs=["schema:sciforge.computer-use.action-adapter-readiness.v1"],
        readiness_ref="adapter-readiness:session-1/native-window.json",
        capability_ref="adapter-capability:session-1/native-window.json",
    ).as_dict()


def _valid_input_intent():
    return InputIntent(
        intent_id="intent-type-note",
        input_kind="type_text",
        actor_id="actor-agent",
        cursor_id="cursor-agent",
        screen_id="screen-main",
        target=_valid_target(),
        input_lease_ref="lease:session-1/window-lease.json",
        action_adapter_ref="adapter:session-1/native-window.json",
        adapter_readiness_ref="adapter-readiness:session-1/native-window.json",
        executor_event_ref="executor-event:session-1/type-note.json",
        before_after_frame_refs=["before-after:session-1/type-note.json"],
        before_frame_refs=["frame:session-1/before.png"],
        after_frame_refs=["frame:session-1/after.png"],
        verification_refs=["verification:session-1/type-note.json"],
        proposal_ref="proposal:session-1/type-note.json",
    ).as_dict()


def _valid_annotation_overlay(kind="highlight", binding="window-region"):
    return AnnotationOverlay(
        overlay_id=f"overlay-{kind}",
        annotation_kind=kind,
        screen_id="screen-main",
        overlay_ref=f"overlay:session-1/{kind}.json",
        target_ref=f"{binding}:session-1/target.json",
        target_binding_kind=binding,
        proposal_ref=f"proposal:session-1/{kind}.json",
        action_ref=f"input-intent:session-1/{kind}.json",
        verification_ref=f"verification:session-1/{kind}.json",
        before_frame_ref="frame:session-1/before.png",
        after_frame_ref="frame:session-1/after.png",
        refs=[f"annotation:session-1/{kind}.json"],
    ).as_dict()


def test_virtual_app_screen_user_acceptance_manifest_requires_schema_fields():
    valid = _valid_manifest()
    validation = validate_virtual_app_screen_user_acceptance_manifest(valid)

    assert valid["schemaVersion"] == VIRTUAL_APP_SCREEN_USER_ACCEPTANCE_MANIFEST_SCHEMA
    assert validation["ok"] is True
    assert validation["status"] == "passed"
    assert validation["userAcceptanceEligible"] is True

    required_fields = [
        "schemaVersion",
        "taskId",
        "scenarioId",
        "userIntent",
        "targetAppRefs",
        "targetWindowRefs",
        "sessionRefs",
        "adapterReadinessRefs",
        "screenFrameRefs",
        "inputIntentRefs",
        "executorEventRefs",
        "beforeAfterFrameRefs",
        "annotationProposalRefs",
        "artifactRefs",
        "verificationRefs",
        "guiPresentRefs",
        "replayRef",
        "evidenceLedgerRef",
        "isolationFlags",
        "blockedReason",
    ]
    for field in required_fields:
        manifest = _valid_manifest()
        manifest.pop(field)

        validation = validate_virtual_app_screen_user_acceptance_manifest(manifest)

        assert validation["ok"] is False, field
        assert validation["userAcceptanceEligible"] is False


def test_user_acceptance_status_boundaries_are_explicit_and_fail_closed():
    blocked = _valid_manifest()
    blocked.update({
        "status": "blocked",
        "userAcceptanceEligible": False,
        "blockedReason": "artifact validator did not find a current-run artifact",
        "artifactRefs": [],
    })
    blocked_validation = validate_virtual_app_screen_user_acceptance_manifest(blocked)
    assert blocked_validation["ok"] is True
    assert blocked_validation["status"] == "blocked"
    assert blocked_validation["userAcceptanceEligible"] is False

    needs_confirmation = _valid_manifest()
    needs_confirmation.update({
        "status": "needs-confirmation",
        "userAcceptanceEligible": False,
        "blockedReason": "waiting for user confirmation",
        "requiresUserConfirmation": True,
    })
    needs_confirmation.pop("userConfirmationRef", None)
    confirmation_validation = validate_virtual_app_screen_user_acceptance_manifest(needs_confirmation)
    assert confirmation_validation["ok"] is True
    assert confirmation_validation["status"] == "needs-confirmation"

    requires_handoff = _valid_manifest()
    requires_handoff["status"] = "requires-handoff"
    requires_handoff["userAcceptanceEligible"] = False
    requires_handoff["blockedReason"] = "adapter requires focus steal"
    requires_handoff["isolationFlags"]["requiresFocusSteal"] = True
    handoff_validation = validate_virtual_app_screen_user_acceptance_manifest(requires_handoff)
    assert handoff_validation["ok"] is True
    assert handoff_validation["status"] == "requires-handoff"
    assert "focus-steal-required" in handoff_validation["isolationBlockers"]

    diagnostic = _valid_manifest()
    diagnostic.update({
        "status": "diagnostic",
        "diagnosticOnly": True,
        "sourceBoundary": "package-smoke",
        "userAcceptanceEligible": False,
        "blockedReason": "package smoke can only prove readiness",
    })
    diagnostic_validation = validate_virtual_app_screen_user_acceptance_manifest(diagnostic)
    assert diagnostic_validation["ok"] is True
    assert diagnostic_validation["status"] == "diagnostic"
    assert diagnostic_validation["diagnosticOnly"] is True


def test_pass_claim_requires_artifact_action_causality_and_verifier_refs():
    for field in ("artifactRefs", "inputIntentRefs", "executorEventRefs", "beforeAfterFrameRefs", "verificationRefs"):
        manifest = _valid_manifest()
        manifest[field] = []

        validation = validate_virtual_app_screen_user_acceptance_manifest(manifest)

        assert validation["ok"] is False, field
        assert validation["status"] == "blocked"
        assert validation["userAcceptanceEligible"] is False
        assert "pass_evidence_ref_missing" in _codes(validation)
        assert field in validation["passMissingRefKeys"]


def test_action_adapter_readiness_declares_capability_flags():
    readiness = _valid_adapter_readiness()

    validation = validate_action_adapter_readiness(readiness)

    assert readiness["schemaVersion"] == ACTION_ADAPTER_READINESS_SCHEMA
    assert validation["ok"] is True
    assert validation["isolatedBackgroundCapable"] is True
    assert readiness["captureSupported"] is True
    assert readiness["backgroundRenderable"] is True
    assert readiness["affectsPhysicalDisplay"] is False
    assert readiness["requiresFocusSteal"] is False
    assert readiness["sharedSystemInputUsed"] is False

    missing_flag = _valid_adapter_readiness()
    missing_flag.pop("backgroundRenderable")
    missing_schema_refs = _valid_adapter_readiness()
    missing_schema_refs.pop("schemaRefs")

    assert "required_bool_missing" in _codes(validate_action_adapter_readiness(missing_flag))
    assert "required_ref_list_missing" in _codes(validate_action_adapter_readiness(missing_schema_refs))


def test_action_adapter_readiness_marks_non_isolated_capabilities_as_handoff():
    blocked = _valid_adapter_readiness()
    blocked.update({
        "ready": False,
        "requiresFocusSteal": True,
        "blockedReason": "target app only accepts focused OS input",
    })

    validation = validate_action_adapter_readiness(blocked)

    assert validation["ok"] is True
    assert validation["status"] == "requires-handoff"
    assert validation["isolatedBackgroundCapable"] is False
    assert "focus-steal-required" in validation["isolationBlockers"]

    inconsistent = _valid_adapter_readiness()
    inconsistent["requiresFocusSteal"] = True
    inconsistent["blockedReason"] = "target app only accepts focused OS input"

    inconsistent_validation = validate_action_adapter_readiness(inconsistent)

    assert inconsistent_validation["ok"] is False
    assert "adapter_ready_flag_inconsistent" in _codes(inconsistent_validation)


def test_input_intent_requires_executor_event_before_after_and_verifier_refs():
    for input_kind in ("click", "type_text", "drag", "scroll", "hotkey", "menu_command"):
        intent = _valid_input_intent()
        intent["inputKind"] = input_kind

        validation = validate_input_intent(intent)

        assert validation["ok"] is True, input_kind

    intent = _valid_input_intent()

    validation = validate_input_intent(intent)

    assert intent["schemaVersion"] == INPUT_INTENT_SCHEMA
    assert validation["ok"] is True

    for field in ("executorEventRef", "beforeAfterFrameRefs", "verificationRefs"):
        invalid = _valid_input_intent()
        invalid.pop(field)

        invalid_validation = validate_input_intent(invalid)

        assert invalid_validation["ok"] is False, field
        assert invalid_validation["status"] == "blocked"


def test_annotation_overlay_binds_refs_through_proposal_action_and_verification():
    for kind in ("point", "rectangle", "arrow", "highlight", "comment", "agent_cursor_trace", "rejected_target"):
        validation = validate_annotation_overlay(_valid_annotation_overlay(kind))
        assert validation["ok"] is True, kind

    for binding in ("window-region", "ax-element", "dom-element", "ocr-text-span", "visual-object", "artifact-file"):
        validation = validate_annotation_overlay(_valid_annotation_overlay("comment", binding))
        assert validation["ok"] is True, binding

    overlay = _valid_annotation_overlay()
    assert overlay["schemaVersion"] == ANNOTATION_OVERLAY_SCHEMA
    for field in ("proposalRef", "actionRef", "verificationRef"):
        invalid = _valid_annotation_overlay()
        invalid.pop(field)

        invalid_validation = validate_annotation_overlay(invalid)

        assert invalid_validation["ok"] is False, field
        assert "required_ref_missing" in _codes(invalid_validation)

    invalid_binding = _valid_annotation_overlay(binding="global-coordinate")
    invalid_binding_validation = validate_annotation_overlay(invalid_binding)
    assert invalid_binding_validation["ok"] is False
    assert "annotation_target_binding_invalid" in _codes(invalid_binding_validation)


def test_isolated_gate_rejects_focus_steal_shared_input_and_physical_popup_for_pass():
    for flag in ("requiresFocusSteal", "sharedSystemInputUsed", "physicalPopupShown", "affectsPhysicalDisplay"):
        manifest = _valid_manifest()
        manifest["isolationFlags"][flag] = True

        validation = validate_virtual_app_screen_user_acceptance_manifest(manifest)

        assert validation["ok"] is False, flag
        assert validation["status"] == "requires-handoff"
        assert validation["userAcceptanceEligible"] is False
        assert "isolation_gate_rejected" in _codes(validation)


def test_package_smoke_legacy_m6_dom_fixture_and_shell_only_cannot_set_user_acceptance_eligible():
    for source in (
        "package-smoke",
        "legacy-m6",
        "m6-opt-in",
        "dom",
        "fixture",
        "target-bound-fixture",
        "shell-only",
        "shell-direct-artifact-write",
    ):
        manifest = _valid_manifest()
        manifest["sourceBoundary"] = source

        validation = validate_virtual_app_screen_user_acceptance_manifest(manifest)

        assert validation["ok"] is False, source
        assert validation["status"] == "diagnostic"
        assert validation["userAcceptanceEligible"] is False
        assert source in validation["diagnosticSourceMarkers"]
        assert "diagnostic_source_user_acceptance_forbidden" in _codes(validation)

    boolean_marker = _valid_manifest()
    boolean_marker["legacyM6"] = True

    boolean_validation = validate_virtual_app_screen_user_acceptance_manifest(boolean_marker)

    assert boolean_validation["ok"] is False
    assert "legacy-m6" in boolean_validation["diagnosticSourceMarkers"]
    assert "diagnostic_source_user_acceptance_forbidden" in _codes(boolean_validation)
