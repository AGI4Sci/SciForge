from sciforge_computer_use.contracts import (
    ACTION_PROPOSAL_SCHEMA,
    ACTOR_CURSOR_EVENT_SCHEMA,
    ACTOR_CURSOR_LOG_SCHEMA,
    EXECUTOR_EVENT_SCHEMA,
    REPLAY_MANIFEST_SCHEMA,
    SCOPED_EXECUTOR_LEASE_SCHEMA,
    VIRTUAL_DESKTOP_SESSION_MANIFEST_SCHEMA,
    VIRTUAL_DISPLAY_GROUP_SCHEMA,
    VIRTUAL_SCREEN_SCHEMA,
    action_kind_mutates_gui,
    validate_action_proposal,
    validate_actor_cursor_event,
    validate_actor_cursor_log,
    validate_executor_event,
    validate_multi_screen_contract,
    validate_replay_manifest,
    validate_scoped_executor_lease,
    validate_virtual_desktop_session_manifest,
    validate_virtual_display_group,
    validate_virtual_screen,
)


def _codes(validation):
    return {error["code"] for error in validation["errors"]}


def _valid_session_manifest():
    return {
        "schemaVersion": VIRTUAL_DESKTOP_SESSION_MANIFEST_SCHEMA,
        "sessionId": "session-1",
        "displayGroupRef": "display-group:session-1/main",
        "screenRefs": ["screen:session-1/main"],
        "actorCursorLogRef": "cursor-log:session-1/main.jsonl",
        "inputQueueRef": "input-queue:session-1/main.jsonl",
        "executorLeaseRefs": ["lease:session-1/lease-1"],
        "captureStreamRef": "capture:session-1/stream.jsonl",
        "replayBundleRef": "replay:session-1/bundle.json",
        "sessionPermissionRef": "permission:session-1/session-permission.json",
        "appWindowAllowlistRef": "allowlist:session-1/app-window-allowlist.json",
        "allowedAppRefs": ["app:session-1/writer"],
        "allowedWindowRefs": ["window:session-1/writer-main"],
        "forbiddenAppRefs": ["app:shared-user-desktop"],
        "inputModalityPolicy": {
            "allowedInputModalities": ["observe", "actor-cursor", "scoped-executor"],
            "mutatingInputRequiresLease": True,
            "sharedSystemInputAllowed": False,
        },
        "riskPreviewRef": "risk:session-1/risk-preview.json",
        "dataVisibilityRef": "visibility:session-1/data-visibility.json",
        "stopRef": "stop:session-1/stop-cancel-lease.json",
        "cancelLeaseRef": "cancel:session-1/stop-cancel-lease.json",
        "approvalMode": "fail-closed",
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
        "compatibilityProjection": {"virtualDisplayRef": "legacy-display:session-1"},
    }


def _valid_display_group():
    return {
        "schemaVersion": VIRTUAL_DISPLAY_GROUP_SCHEMA,
        "displayGroupId": "display-group-main",
        "sessionId": "session-1",
        "screenRefs": ["screen:session-1/main"],
        "actorCursorLogRef": "cursor-log:session-1/main.jsonl",
        "inputQueueRef": "input-queue:session-1/main.jsonl",
        "executorLeaseRefs": ["lease:session-1/lease-1"],
        "captureStreamRef": "capture:session-1/stream.jsonl",
        "replayBundleRef": "replay:session-1/bundle.json",
    }


def _valid_screen():
    return {
        "schemaVersion": VIRTUAL_SCREEN_SCHEMA,
        "screenId": "screen-main",
        "displayGroupId": "display-group-main",
        "geometry": {"x": 0, "y": 0, "width": 1440, "height": 900, "coordinateSpace": "screen-local"},
        "scale": 2.0,
        "backendBindingRef": "backend:session-1/screen-main.json",
        "captureSourceRef": "capture-source:session-1/screen-main.json",
        "windowNamespaceRef": "window-namespace:session-1/screen-main.json",
        "resourceAllocationRef": "resources:session-1/screen-main.json",
    }


def _valid_cursor_event():
    return {
        "schemaVersion": ACTOR_CURSOR_EVENT_SCHEMA,
        "eventId": "cursor-event-1",
        "eventType": "move",
        "actorId": "actor-agent",
        "cursorId": "cursor-agent",
        "screenId": "screen-main",
        "windowId": "window-editor",
        "color": "#00aaff",
        "label": "agent",
        "position": {"x": 110, "y": 120, "coordinateSpace": "screen-local"},
        "state": "moving",
        "timestamp": "2026-05-31T00:00:00Z",
        "source": "computer-use-contract-test",
        "refs": ["cursor-log:session-1/main.jsonl"],
    }


def _valid_action_proposal():
    return {
        "schemaVersion": ACTION_PROPOSAL_SCHEMA,
        "proposalId": "proposal-1",
        "actionKind": "click",
        "actorId": "actor-agent",
        "cursorId": "cursor-agent",
        "target": {
            "scope": "window",
            "screenId": "screen-main",
            "windowId": "window-editor",
            "coordinateSpace": "window-local",
            "bounds": {"x": 20, "y": 30, "width": 80, "height": 24, "coordinateSpace": "window-local"},
        },
        "riskLevel": "low",
        "approvalState": "not-required",
        "leaseId": "lease-1",
        "executorEventRef": "executor-event:session-1/event-1.json",
        "beforeEvidenceRefs": ["evidence:session-1/before"],
        "afterEvidenceRefs": ["evidence:session-1/after"],
        "groundingRefs": ["grounding:session-1/target"],
        "verificationRefs": ["verification:session-1/event-1"],
    }


def _valid_lease():
    return {
        "schemaVersion": SCOPED_EXECUTOR_LEASE_SCHEMA,
        "leaseId": "lease-1",
        "scope": "window",
        "displayGroupId": "display-group-main",
        "screenId": "screen-main",
        "windowId": "window-editor",
        "ownerActorId": "actor-agent",
        "ownerCursorId": "cursor-agent",
        "status": "active",
        "leaseRef": "lease:session-1/lease-1.json",
        "eventLogRef": "executor-events:session-1/log.jsonl",
    }


def _valid_executor_event():
    proposal = _valid_action_proposal()
    return {
        "schemaVersion": EXECUTOR_EVENT_SCHEMA,
        "eventId": "executor-event-1",
        "actionKind": "click",
        "leaseId": "lease-1",
        "actorId": "actor-agent",
        "cursorId": "cursor-agent",
        "screenId": "screen-main",
        "target": proposal["target"],
        "status": "completed",
        "executorCommandRef": "executor-command:session-1/event-1.json",
        "outcomeRef": "executor-outcome:session-1/event-1.json",
        "beforeEvidenceRefs": ["evidence:session-1/before"],
        "afterEvidenceRefs": ["evidence:session-1/after"],
        "groundingRefs": ["grounding:session-1/target"],
        "verificationRefs": ["verification:session-1/event-1"],
    }


def _valid_replay_manifest():
    return {
        "schemaVersion": REPLAY_MANIFEST_SCHEMA,
        "replayId": "replay-1",
        "sessionId": "session-1",
        "displayGroupRef": "display-group:session-1/main",
        "frameRefs": ["replay-frame:session-1/frame-1.json"],
        "timelineEventRefs": ["timeline:session-1/event-1.json"],
        "sourceEvidenceRefs": ["evidence:session-1/after"],
        "frames": [
            {
                "frameId": "frame-1",
                "screenId": "screen-main",
                "screenshotRef": "capture:session-1/screen-main/frame-1.png",
                "cursorOverlayRefs": ["cursor-overlay:session-1/frame-1.json"],
                "inputEventRefs": ["executor-event:session-1/event-1.json"],
                "sourceEvidenceRefs": ["evidence:session-1/after"],
            }
        ],
    }


def test_valid_multi_screen_contracts_are_refs_first_and_warn_for_legacy_projection():
    session_validation = validate_virtual_desktop_session_manifest(_valid_session_manifest())
    assert session_validation["ok"] is True
    assert {warning["code"] for warning in session_validation["warnings"]} == {"legacy_single_display_projection"}

    assert validate_virtual_display_group(_valid_display_group())["ok"] is True
    assert validate_virtual_screen(_valid_screen())["ok"] is True
    assert validate_actor_cursor_log({
        "schemaVersion": ACTOR_CURSOR_LOG_SCHEMA,
        "logRef": "cursor-log:session-1/main.jsonl",
        "displayGroupId": "display-group-main",
        "screenRefs": ["screen:session-1/main"],
        "eventRefs": ["cursor-event:session-1/event-1.json"],
    })["ok"] is True
    assert validate_actor_cursor_event(_valid_cursor_event())["ok"] is True
    assert validate_action_proposal(_valid_action_proposal())["ok"] is True
    assert validate_scoped_executor_lease(_valid_lease())["ok"] is True
    assert validate_executor_event(_valid_executor_event())["ok"] is True
    assert validate_replay_manifest(_valid_replay_manifest())["ok"] is True


def test_legacy_single_display_fields_do_not_satisfy_multi_screen_identity():
    manifest = {
        "schemaVersion": VIRTUAL_DESKTOP_SESSION_MANIFEST_SCHEMA,
        "sessionId": "session-1",
        "virtualDisplayRef": "legacy-display:session-1",
        "actorCursorLogRef": "cursor-log:session-1/main.jsonl",
        "inputQueueRef": "input-queue:session-1/main.jsonl",
        "executorLeaseRefs": [],
        "captureStreamRef": "capture:session-1/stream.jsonl",
        "replayBundleRef": "replay:session-1/bundle.json",
        "sessionPermissionRef": "permission:session-1/session-permission.json",
        "appWindowAllowlistRef": "allowlist:session-1/app-window-allowlist.json",
        "allowedAppRefs": [],
        "allowedWindowRefs": [],
        "forbiddenAppRefs": [],
        "inputModalityPolicy": {
            "allowedInputModalities": ["observe", "actor-cursor", "scoped-executor"],
            "mutatingInputRequiresLease": True,
            "sharedSystemInputAllowed": False,
        },
        "riskPreviewRef": "risk:session-1/risk-preview.json",
        "dataVisibilityRef": "visibility:session-1/data-visibility.json",
        "stopRef": "stop:session-1/stop-cancel-lease.json",
        "cancelLeaseRef": "cancel:session-1/stop-cancel-lease.json",
        "approvalMode": "fail-closed",
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
    }

    validation = validate_virtual_desktop_session_manifest(manifest)

    assert validation["ok"] is False
    assert "required_ref_missing" in _codes(validation)
    assert "required_ref_list_missing" in _codes(validation)
    assert {warning["code"] for warning in validation["warnings"]} == {"legacy_single_display_projection"}


def test_missing_screen_identity_fails_closed_for_cursor_event_and_action_target():
    cursor_event = _valid_cursor_event()
    del cursor_event["screenId"]

    cursor_validation = validate_actor_cursor_event(cursor_event)

    assert cursor_validation["ok"] is False
    assert any(error["path"] == "$.screenId" for error in cursor_validation["errors"])

    proposal = _valid_action_proposal()
    del proposal["target"]["screenId"]

    proposal_validation = validate_action_proposal(proposal)

    assert proposal_validation["ok"] is False
    assert "screen_identity_missing" in _codes(proposal_validation)


def test_bare_global_coordinates_fail_closed():
    proposal = _valid_action_proposal()
    proposal["x"] = 400
    proposal["y"] = 300
    proposal["target"] = {
        "scope": "screen",
        "coordinateSpace": "global",
        "x": 400,
        "y": 300,
    }

    proposal_validation = validate_action_proposal(proposal)

    assert proposal_validation["ok"] is False
    assert "bare_global_coordinates" in _codes(proposal_validation)
    assert "screen_identity_missing" in _codes(proposal_validation)

    executor_event = _valid_executor_event()
    executor_event["target"] = {
        "scope": "screen",
        "screenId": "screen-main",
        "coordinateSpace": "global",
        "point": {"x": 400, "y": 300, "coordinateSpace": "global"},
    }

    executor_validation = validate_executor_event(executor_event)

    assert executor_validation["ok"] is False
    assert "bare_global_coordinates" in _codes(executor_validation)


def test_mutating_action_without_lease_fails_closed():
    proposal = _valid_action_proposal()
    del proposal["leaseId"]

    validation = validate_action_proposal(proposal)

    assert validation["ok"] is False
    assert "executor_lease_missing" in _codes(validation)
    assert validation["mutatingGuiAction"] is True


def test_inline_raw_screenshot_base64_and_secret_payloads_fail_closed():
    manifest = _valid_replay_manifest()
    manifest["frames"][0]["screenshotRef"] = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"
    manifest["frames"][0]["rawScreenshot"] = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB" * 8
    manifest["metadata"] = {
        "Authorization": "Bearer super-secret-token",
        "providerRawPayload": {"secretToken": "never-write-this"},
    }

    validation = validate_replay_manifest(manifest)

    assert validation["ok"] is False
    assert "inline_payload_string_forbidden" in _codes(validation)
    assert "inline_payload_key_forbidden" in _codes(validation)
    assert "secret_key_forbidden" in _codes(validation)
    assert "secret_value_forbidden" in _codes(validation)


def test_cursor_move_is_not_a_mutating_gui_action_and_needs_no_executor_lease():
    cursor_validation = validate_actor_cursor_event(_valid_cursor_event())

    assert cursor_validation["ok"] is True
    assert cursor_validation["mutatingGuiAction"] is False
    assert action_kind_mutates_gui("cursor_move") is False
    assert action_kind_mutates_gui("click") is True

    proposal = {
        "schemaVersion": ACTION_PROPOSAL_SCHEMA,
        "proposalId": "proposal-cursor-move",
        "actionKind": "cursor_move",
        "actorId": "actor-agent",
        "cursorId": "cursor-agent",
        "target": {
            "scope": "screen",
            "screenId": "screen-main",
            "coordinateSpace": "screen-local",
            "position": {"x": 40, "y": 50, "coordinateSpace": "screen-local"},
        },
        "riskLevel": "low",
        "approvalState": "not-required",
    }

    proposal_validation = validate_multi_screen_contract(proposal)

    assert proposal_validation["ok"] is True
    assert proposal_validation["mutatingGuiAction"] is False
    assert "executor_lease_missing" not in _codes(proposal_validation)
