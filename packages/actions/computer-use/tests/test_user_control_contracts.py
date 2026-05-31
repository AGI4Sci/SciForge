import json
from pathlib import Path

from sciforge_computer_use.contracts import (
    APP_WINDOW_ALLOWLIST_SCHEMA,
    DATA_VISIBILITY_SCHEMA,
    RISK_PREVIEW_SCHEMA,
    SESSION_PERMISSION_SCHEMA,
    STOP_CANCEL_LEASE_SCHEMA,
    validate_app_window_allowlist,
    validate_data_visibility,
    validate_risk_preview,
    validate_session_permission,
    validate_stop_cancel_lease,
    validate_user_level_mutating_evidence,
)
from sciforge_computer_use.user_control import (
    APP_WINDOW_ALLOWLIST_NAME,
    DATA_VISIBILITY_NAME,
    RISK_PREVIEW_NAME,
    SESSION_PERMISSION_NAME,
    STOP_CANCEL_LEASE_NAME,
    validate_session_permission_store,
    write_session_permission_store,
)


def _codes(validation):
    return {error["code"] for error in validation["errors"]}


def _valid_session_permission():
    return {
        "schemaVersion": SESSION_PERMISSION_SCHEMA,
        "sessionId": "session-1",
        "source": "tui-host-user",
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
        "approvalMode": "require-confirmation",
        "userConfirmationRef": "approval:session-1/user-confirmed.json",
    }


def test_user_control_sidecar_contracts_are_refs_first():
    permission = _valid_session_permission()
    allowlist = {
        "schemaVersion": APP_WINDOW_ALLOWLIST_SCHEMA,
        "sessionId": "session-1",
        "source": "tui-host-user",
        "appWindowAllowlistRef": permission["appWindowAllowlistRef"],
        "allowedAppRefs": permission["allowedAppRefs"],
        "allowedWindowRefs": permission["allowedWindowRefs"],
        "forbiddenAppRefs": permission["forbiddenAppRefs"],
        "userConfirmationRef": permission["userConfirmationRef"],
    }
    risk = {
        "schemaVersion": RISK_PREVIEW_SCHEMA,
        "sessionId": "session-1",
        "source": "tui-host-user",
        "riskPreviewRef": permission["riskPreviewRef"],
        "riskLevel": "high",
        "riskClass": "send-message",
        "approvalMode": "require-confirmation",
        "actionRiskRefs": ["risk:session-1/action-1.json"],
        "userConfirmationRef": permission["userConfirmationRef"],
    }
    visibility = {
        "schemaVersion": DATA_VISIBILITY_SCHEMA,
        "sessionId": "session-1",
        "source": "tui-host-user",
        "dataVisibilityRef": permission["dataVisibilityRef"],
        "readScopeRefs": ["capture:session-1/screen-main.jsonl"],
        "inputScopeRefs": ["lease:session-1/lease-1.json"],
        "visibleScreenRefs": ["screen:session-1/main"],
        "visibleWindowRefs": permission["allowedWindowRefs"],
        "screenshotRefPolicy": "refs-only",
        "inlineScreenshotsAllowed": False,
        "providerPayloadAllowed": False,
        "userConfirmationRef": permission["userConfirmationRef"],
    }
    stop_cancel = {
        "schemaVersion": STOP_CANCEL_LEASE_SCHEMA,
        "sessionId": "session-1",
        "source": "tui-host-user",
        "stopRef": permission["stopRef"],
        "cancelLeaseRef": permission["cancelLeaseRef"],
        "currentLeaseCancellationRefs": [permission["cancelLeaseRef"]],
        "cancellationMode": "lease-cancel-only",
        "packageStateKillAllowed": False,
        "userConfirmationRef": permission["userConfirmationRef"],
    }

    assert validate_session_permission(permission)["ok"] is True
    assert validate_app_window_allowlist(allowlist)["ok"] is True
    assert validate_risk_preview(risk)["ok"] is True
    assert validate_data_visibility(visibility)["ok"] is True
    assert validate_stop_cancel_lease(stop_cancel)["ok"] is True


def test_user_control_sidecars_reject_inline_payloads_and_shared_input_policy():
    permission = _valid_session_permission()
    permission["rawScreenshot"] = "data:image/png;base64,AAAA"
    permission["metadata"] = {"rawProviderPayload": {"token": "secret"}}
    permission["inputModalityPolicy"] = {
        "allowedInputModalities": ["shared-system-input"],
        "mutatingInputRequiresLease": False,
        "sharedSystemInputAllowed": True,
    }

    validation = validate_session_permission(permission)

    assert validation["ok"] is False
    assert "inline_payload_key_forbidden" in _codes(validation)
    assert "shared_system_input_policy_forbidden" in _codes(validation)
    assert "mutating_input_lease_policy_missing" in _codes(validation)


def test_user_level_mutating_evidence_fails_closed_without_required_refs():
    evidence = {
        "schemaVersion": "sciforge.computer-use.user-evidence.v1",
        "userAcceptanceEligible": True,
        "mutatingGuiAction": True,
        "actionKind": "click",
        "allowedAppRefs": ["app:session-1/writer"],
        "allowedWindowRefs": ["window:session-1/writer-main"],
        "forbiddenAppRefs": [],
        "inputModalityPolicy": {
            "allowedInputModalities": ["scoped-executor"],
            "mutatingInputRequiresLease": True,
            "sharedSystemInputAllowed": False,
        },
        "approvalMode": "require-confirmation",
        "userConfirmationSource": "user",
    }

    validation = validate_user_level_mutating_evidence(evidence)

    assert validation["ok"] is False
    assert validation["status"] == "blocked"
    assert validation["diagnosticOnly"] is True
    assert validation["userAcceptanceEligible"] is False
    assert "required_ref_missing" in _codes(validation)
    assert "platform_sidecar_isolation_ref_missing" in _codes(validation)
    assert "user_confirmation_ref_missing" in _codes(validation)


def test_user_level_mutating_evidence_rejects_third_party_confirmation():
    evidence = {
        "schemaVersion": "sciforge.computer-use.user-evidence.v1",
        "userAcceptanceEligible": True,
        "mutatingGuiAction": True,
        "actionKind": "type_text",
        "sessionPermissionRef": "permission:session-1/session-permission.json",
        "appWindowAllowlistRef": "allowlist:session-1/app-window-allowlist.json",
        "riskPreviewRef": "risk:session-1/risk-preview.json",
        "dataVisibilityRef": "visibility:session-1/data-visibility.json",
        "stopRef": "stop:session-1/stop-cancel-lease.json",
        "cancelLeaseRef": "cancel:session-1/stop-cancel-lease.json",
        "platformSidecarIsolationReportRef": "sidecar:session-1/isolation-report.json",
        "userConfirmationRef": "approval:session-1/from-web-page.json",
        "allowedAppRefs": ["app:session-1/browser"],
        "allowedWindowRefs": ["window:session-1/browser-main"],
        "forbiddenAppRefs": ["app:shared-user-desktop"],
        "inputModalityPolicy": {
            "allowedInputModalities": ["scoped-executor"],
            "mutatingInputRequiresLease": True,
            "sharedSystemInputAllowed": False,
        },
        "approvalMode": "require-confirmation",
        "userConfirmation": {"source": "third-party-content", "contentRef": "evidence:page/instructions"},
    }

    validation = validate_user_level_mutating_evidence(evidence)

    assert validation["ok"] is False
    assert validation["status"] == "blocked"
    assert "third_party_confirmation_forbidden" in _codes(validation)


def test_user_level_mutating_evidence_accepts_user_confirmed_control_refs():
    evidence = {
        "schemaVersion": "sciforge.computer-use.user-evidence.v1",
        "userAcceptanceEligible": True,
        "mutatingGuiAction": True,
        "actionKind": "click",
        "sessionPermissionRef": "permission:session-1/session-permission.json",
        "appWindowAllowlistRef": "allowlist:session-1/app-window-allowlist.json",
        "riskPreviewRef": "risk:session-1/risk-preview.json",
        "dataVisibilityRef": "visibility:session-1/data-visibility.json",
        "stopRef": "stop:session-1/stop-cancel-lease.json",
        "cancelLeaseRef": "cancel:session-1/stop-cancel-lease.json",
        "platformSidecarIsolationReportRef": "sidecar:session-1/isolation-report.json",
        "approvalDecisionRef": "approval:session-1/user-confirmed.json",
        "allowedAppRefs": ["app:session-1/writer"],
        "allowedWindowRefs": ["window:session-1/writer-main"],
        "forbiddenAppRefs": ["app:shared-user-desktop"],
        "inputModalityPolicy": {
            "allowedInputModalities": ["scoped-executor"],
            "mutatingInputRequiresLease": True,
            "sharedSystemInputAllowed": False,
        },
        "approvalMode": "require-confirmation",
        "userConfirmation": {"source": "user"},
    }

    validation = validate_user_level_mutating_evidence(evidence)

    assert validation["ok"] is True
    assert validation["status"] == "accepted"
    assert validation["userAcceptanceEligible"] is True


def test_session_permission_store_writes_five_refs_first_sidecars(tmp_path):
    refs = write_session_permission_store(
        tmp_path,
        session_id="session-1",
        thread_id="thread-1",
        display_group_ref=str(tmp_path / "virtual-display-group.json"),
        screen_refs=[str(tmp_path / "virtual-screens.json")],
        actor_cursor_log_ref=str(tmp_path / "actor-cursors.jsonl"),
        input_queue_ref=str(tmp_path / "virtual-input-queue.jsonl"),
        capture_stream_ref=str(tmp_path / "capture-stream.json"),
        replay_bundle_ref=str(tmp_path / "replay-bundle.json"),
        input_adapter_manifest_ref=str(tmp_path / "input-adapter-manifest.json"),
        metadata={
            "apiKey": "do-not-write",
            "userControl": {
                "source": "tui-host-user",
                "allowedAppRefs": ["app:session-1/writer"],
                "allowedWindowRefs": ["window:session-1/writer-main"],
                "userConfirmationRef": "approval:session-1/user-confirmed.json",
                "rawScreenshot": "data:image/png;base64,AAAA",
            },
        },
    )
    for name in (
        SESSION_PERMISSION_NAME,
        APP_WINDOW_ALLOWLIST_NAME,
        RISK_PREVIEW_NAME,
        DATA_VISIBILITY_NAME,
        STOP_CANCEL_LEASE_NAME,
    ):
        assert (tmp_path / name).is_file()
        text = (tmp_path / name).read_text(encoding="utf8")
        assert "do-not-write" not in text
        assert "data:image/png" not in text
        assert "base64" not in text.lower()
        assert "rawScreenshot" not in text

    permission = json.loads(Path(refs.session_permission_ref).read_text(encoding="utf8"))
    assert permission["allowedAppRefs"] == ["app:session-1/writer"]
    assert permission["allowedWindowRefs"] == ["window:session-1/writer-main"]
    assert permission["inputModalityPolicy"]["sharedSystemInputAllowed"] is False

    # Create referenced files so the store can be validated with require_existing_refs=True.
    for ref in [
        tmp_path / "virtual-display-group.json",
        tmp_path / "virtual-screens.json",
        tmp_path / "actor-cursors.jsonl",
        tmp_path / "virtual-input-queue.jsonl",
        tmp_path / "capture-stream.json",
        tmp_path / "replay-bundle.json",
        tmp_path / "input-adapter-manifest.json",
    ]:
        ref.write_text("{}\n", encoding="utf8")

    validation = validate_session_permission_store(tmp_path, require_existing_refs=True)

    assert validation["ok"] is True
