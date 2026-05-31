import json
from pathlib import Path

from sciforge_computer_use.contracts import (
    USER_LEVEL_MUTATING_EVIDENCE_SCHEMA,
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


def test_user_control_store_writes_five_refs_first_sidecars(tmp_path):
    root = tmp_path / "session"
    refs = write_session_permission_store(
        root,
        session_id="session-a",
        thread_id="thread-a",
        display_group_ref=str(write_ref(root, "display-group.json")),
        screen_refs=[str(write_ref(root, "screens.json"))],
        actor_cursor_log_ref=str(write_ref(root, "actor-cursors.jsonl")),
        input_queue_ref=str(write_ref(root, "input-queue.jsonl")),
        capture_stream_ref=str(write_ref(root, "capture-stream.json")),
        replay_bundle_ref=str(write_ref(root, "replay-bundle.json")),
        input_adapter_manifest_ref=str(write_ref(root, "input-adapter.json")),
        metadata={
            "apiKey": "should-not-survive",
            "rawScreenshot": "data:image/png;base64,abc",
            "userControl": {
                "source": "tui-host-user",
                "userConfirmationRef": "approval:session-a",
                "allowedAppRefs": ["app:writer"],
                "allowedWindowRefs": ["window:writer/main"],
                "riskLevel": "medium",
                "approvalMode": "require-confirmation",
            },
        },
    )

    for name in [
        SESSION_PERMISSION_NAME,
        APP_WINDOW_ALLOWLIST_NAME,
        RISK_PREVIEW_NAME,
        DATA_VISIBILITY_NAME,
        STOP_CANCEL_LEASE_NAME,
    ]:
        assert (root / name).is_file()

    validation = validate_session_permission_store(root, require_existing_refs=True)
    assert validation["ok"] is True
    assert validation["status"] == "accepted"
    assert validation["refs"]["sessionPermissionRef"] == str(root / SESSION_PERMISSION_NAME)

    permission = json.loads(Path(refs.session_permission_ref).read_text(encoding="utf8"))
    assert permission["sessionPermissionRef"] == refs.session_permission_ref
    assert permission["appWindowAllowlistRef"] == refs.app_window_allowlist_ref
    assert permission["riskPreviewRef"] == refs.risk_preview_ref
    assert permission["dataVisibilityRef"] == refs.data_visibility_ref
    assert permission["stopRef"] == refs.stop_ref
    assert permission["cancelLeaseRef"] == refs.cancel_lease_ref
    assert permission["inputModalityPolicy"]["sharedSystemInputAllowed"] is False
    assert permission["inputModalityPolicy"]["mutatingInputRequiresLease"] is True

    serialized = "\n".join(path.read_text(encoding="utf8") for path in root.glob("*.json"))
    assert "should-not-survive" not in serialized
    assert "data:image" not in serialized


def test_user_level_mutating_validator_fails_closed_without_user_control_refs():
    validation = validate_user_level_mutating_evidence({
        "schemaVersion": USER_LEVEL_MUTATING_EVIDENCE_SCHEMA,
        "status": "completed",
        "mutatingGuiAction": True,
        "actionKind": "click",
        "userConfirmationSource": "third-party-page",
    })

    codes = {error["code"] for error in validation["errors"]}
    assert validation["ok"] is False
    assert validation["status"] == "blocked"
    assert "platform_sidecar_isolation_ref_missing" in codes
    assert "user_confirmation_ref_missing" in codes
    assert "third_party_confirmation_forbidden" in codes


def test_user_level_mutating_validator_accepts_user_confirmation_and_control_refs():
    validation = validate_user_level_mutating_evidence({
        "schemaVersion": USER_LEVEL_MUTATING_EVIDENCE_SCHEMA,
        "status": "completed",
        "mutatingGuiAction": True,
        "actionKind": "click",
        "sessionPermissionRef": "permission:session/main.json",
        "appWindowAllowlistRef": "permission:allowlist/main.json",
        "riskPreviewRef": "permission:risk/main.json",
        "dataVisibilityRef": "permission:data/main.json",
        "stopRef": "permission:stop/main.json",
        "cancelLeaseRef": "permission:cancel/main.json",
        "platformSidecarIsolationReportRef": "platform-sidecar:isolation/main.json",
        "userConfirmationRef": "approval:human/main",
        "userConfirmationSource": "gui-confirmation-result",
        "allowedAppRefs": ["app:writer"],
        "allowedWindowRefs": ["window:writer/main"],
        "forbiddenAppRefs": ["app:shared-user-desktop"],
        "inputModalityPolicy": {
            "allowedInputModalities": ["observe", "actor-cursor", "scoped-executor"],
            "mutatingInputRequiresLease": True,
            "sharedSystemInputAllowed": False,
        },
        "approvalMode": "require-confirmation",
    })

    assert validation["ok"] is True
    assert validation["status"] == "accepted"
    assert validation["userAcceptanceEligible"] is True
    assert validation["mutatingGuiAction"] is True


def write_ref(root: Path, name: str) -> Path:
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("{}\n", encoding="utf8")
    return path
