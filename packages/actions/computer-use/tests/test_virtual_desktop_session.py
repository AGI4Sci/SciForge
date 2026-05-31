import json
from pathlib import Path

import pytest

from sciforge_computer_use.virtual_desktop_session import (
    ACTOR_CURSOR_EVENT_SCHEMA,
    VIRTUAL_DESKTOP_BLOCKED_SCHEMA,
    VIRTUAL_DESKTOP_DISPLAY_GROUP_SCHEMA,
    VIRTUAL_DESKTOP_INPUT_LEASE_SCHEMA,
    VIRTUAL_DESKTOP_SCREENS_SCHEMA,
    VIRTUAL_DESKTOP_SESSION_SCHEMA,
    SessionManager,
    VirtualDesktopSessionBlocked,
)
from sciforge_computer_use.user_control import validate_session_permission_store
from sciforge_computer_use.virtual_input_adapter import (
    build_target_bound_input_adapter_manifest,
    get_virtual_input_adapter_manifest,
)


def isolated_adapter_manifest():
    return build_target_bound_input_adapter_manifest(
        executor_provider="novnc-independent-executor",
        input_channel="remote-desktop-isolated-session",
    )


def test_session_manager_creates_independent_session_roots(tmp_path):
    manager = SessionManager(tmp_path / "sessions", input_adapter_manifest=isolated_adapter_manifest())

    first = manager.create("thread-a")
    second = manager.create("thread-b")

    assert first.session_id != second.session_id
    assert first.session_root != second.session_root
    assert first.session_root.parent.name == "thread-a"
    assert second.session_root.parent.name == "thread-b"
    assert first.session_root.is_dir()
    assert second.session_root.is_dir()
    assert manager.get(first.session_id) is first
    assert manager.get(second.session_id) is second
    assert manager.sessions_for_thread("thread-a") == [first]

    for session in (first, second):
        manifest = session.manifest()
        assert manifest["schemaVersion"] == VIRTUAL_DESKTOP_SESSION_SCHEMA
        assert manifest["status"] == "open"
        assert manifest["displayGroupId"].startswith("display-group-")
        assert manifest["screenIds"] == ["screen-1"]
        assert manifest["inputAdapterValidation"]["ok"] is True
        assert manifest["sharedSystemInputUsed"] is False
        assert manifest["systemPointerMoved"] is False
        assert manifest["systemKeyboardEventsSent"] is False
        assert Path(manifest["filesystemRootRef"]).is_dir()
        assert Path(manifest["virtualDisplayGroupRef"]).is_file()
        assert Path(manifest["virtualDisplayRef"]).is_file()
        assert Path(manifest["virtualScreensRef"]).is_file()
        assert Path(manifest["actorCursorLogRef"]).is_file()
        assert Path(manifest["virtualInputQueueRef"]).is_file()
        assert Path(manifest["captureStreamRef"]).is_file()
        assert Path(manifest["replayBundleRef"]).is_file()
        assert Path(manifest["inputAdapterManifestRef"]).is_file()
        assert Path(manifest["sessionPermissionRef"]).is_file()
        assert Path(manifest["appWindowAllowlistRef"]).is_file()
        assert Path(manifest["riskPreviewRef"]).is_file()
        assert Path(manifest["dataVisibilityRef"]).is_file()
        assert Path(manifest["stopCancelLeaseRef"]).is_file()
        assert Path(manifest["diagnosticsRef"]).is_file()
        assert Path(manifest["blockedManifestRef"]).is_file()
        assert Path(manifest["manifestRef"]).is_file()
        assert manifest["userControl"]["sessionPermissionRef"] == manifest["sessionPermissionRef"]
        assert manifest["userControl"]["appWindowAllowlistRef"] == manifest["appWindowAllowlistRef"]
        assert manifest["userControl"]["riskPreviewRef"] == manifest["riskPreviewRef"]
        assert manifest["userControl"]["dataVisibilityRef"] == manifest["dataVisibilityRef"]
        assert manifest["inputModalityPolicy"]["sharedSystemInputAllowed"] is False

        display_group = json.loads(Path(manifest["virtualDisplayGroupRef"]).read_text(encoding="utf8"))
        screens = json.loads(Path(manifest["virtualScreensRef"]).read_text(encoding="utf8"))
        cursor_events = [
            json.loads(line)
            for line in Path(manifest["actorCursorLogRef"]).read_text(encoding="utf8").splitlines()
        ]
        assert display_group["schemaVersion"] == VIRTUAL_DESKTOP_DISPLAY_GROUP_SCHEMA
        assert display_group["screenRefs"] == [manifest["virtualScreensRef"]]
        assert screens["schemaVersion"] == VIRTUAL_DESKTOP_SCREENS_SCHEMA
        assert screens["screens"][0]["screenId"] == "screen-1"
        assert cursor_events[0]["schemaVersion"] == ACTOR_CURSOR_EVENT_SCHEMA
        assert cursor_events[0]["screenId"] == "screen-1"
        assert cursor_events[0]["mutatingGuiAction"] is False


def test_input_lease_is_exclusive_until_released(tmp_path):
    manager = SessionManager(tmp_path / "sessions", input_adapter_manifest=isolated_adapter_manifest())
    session = manager.create("thread-a")

    first_lease = manager.lease(
        session.session_id,
        holder="agent-a",
        metadata={
            "leaseScope": {"scopeType": "window", "screenId": "screen-1", "windowId": "writer-window"},
            "leaseOwner": {"actorId": "agent-a", "cursorId": "cursor-agent-a"},
        },
    )

    assert first_lease.status == "active"
    assert Path(first_lease.lease_ref).is_file()
    assert session.manifest()["inputLeaseRef"] == first_lease.lease_ref
    lease_payload = json.loads(Path(first_lease.lease_ref).read_text(encoding="utf8"))
    assert lease_payload["leaseScope"] == {
        "scopeType": "window",
        "screenId": "screen-1",
        "windowId": "writer-window",
    }
    assert lease_payload["leaseOwner"] == {
        "holder": "agent-a",
        "actorId": "agent-a",
        "cursorId": "cursor-agent-a",
    }

    with pytest.raises(VirtualDesktopSessionBlocked) as blocked:
        manager.lease(session.session_id, holder="agent-b")

    blocked_manifest = blocked.value.manifest
    assert blocked_manifest["schemaVersion"] == VIRTUAL_DESKTOP_BLOCKED_SCHEMA
    assert blocked_manifest["status"] == "blocked"
    assert blocked_manifest["category"] == "virtual-desktop-input-lease-blocked"
    assert blocked_manifest["inputLeaseRef"] == first_lease.lease_ref
    assert blocked_manifest["sharedSystemInputUsed"] is False
    assert blocked_manifest["systemPointerMoved"] is False
    assert blocked_manifest["systemKeyboardEventsSent"] is False
    assert Path(blocked_manifest["manifestRef"]).is_file()

    released = manager.release(session.session_id, first_lease.lease_id, reason="done")

    assert released["schemaVersion"] == VIRTUAL_DESKTOP_INPUT_LEASE_SCHEMA
    assert released["status"] == "released"
    assert session.manifest()["inputLeaseRef"] is None

    second_lease = manager.lease(session.session_id, holder="agent-b")
    assert second_lease.lease_id != first_lease.lease_id
    assert session.manifest()["inputLeaseRef"] == second_lease.lease_ref


def test_session_creation_fails_closed_without_isolated_input_adapter(tmp_path):
    manager = SessionManager(tmp_path / "sessions")

    with pytest.raises(VirtualDesktopSessionBlocked) as blocked:
        manager.create("thread-a")

    manifest = blocked.value.manifest
    assert manifest["schemaVersion"] == VIRTUAL_DESKTOP_BLOCKED_SCHEMA
    assert manifest["status"] == "blocked"
    assert manifest["category"] == "virtual-desktop-session-blocked"
    assert manifest["inputIsolation"]["adapterManifestDeclared"] is False
    assert manifest["inputIsolation"]["adapterManifestReady"] is False
    assert "No isolated input adapter capability was declared" in manifest["reason"]
    assert "adapter manifest schemaVersion" in " ".join(manifest["blockedReasons"])
    assert manifest["sharedSystemInputUsed"] is False
    assert manifest["systemPointerMoved"] is False
    assert manifest["systemKeyboardEventsSent"] is False
    assert Path(manifest["manifestRef"]).is_file()


def test_session_creation_fails_closed_for_state_only_virtual_input_adapter(tmp_path):
    manager = SessionManager(tmp_path / "sessions", input_adapter_manifest=get_virtual_input_adapter_manifest())

    with pytest.raises(VirtualDesktopSessionBlocked) as blocked:
        manager.create("thread-a")

    manifest = blocked.value.manifest
    errors = manifest["inputAdapterValidation"]["errors"]

    assert manifest["status"] == "blocked"
    assert manifest["inputIsolation"]["adapterManifestDeclared"] is True
    assert manifest["inputIsolation"]["adapterManifestReady"] is False
    assert "adapter manifest inputChannel must be target-bound isolated input" in errors
    assert "adapter manifest executeChangesTargetEnvironment must be true" in errors
    assert "adapter manifest realWindowEvidenceCapable must be true" in errors
    assert manifest["sharedSystemInputUsed"] is False
    assert manifest["systemPointerMoved"] is False
    assert manifest["systemKeyboardEventsSent"] is False


def test_session_manifest_is_refs_first_and_updates_for_close(tmp_path):
    manager = SessionManager(
        tmp_path / "sessions",
        input_adapter_manifest=isolated_adapter_manifest(),
        metadata={"apiKey": "do-not-write"},
    )
    session = manager.create("thread-a", metadata={"secretToken": "also-do-not-write"})
    lease = manager.lease(session.session_id, holder="agent-a")
    manifest = session.manifest()

    assert manifest["refs"]["sessionRootRef"] == manifest["sessionRootRef"]
    assert manifest["refs"]["virtualDisplayGroupRef"] == manifest["virtualDisplayGroupRef"]
    assert manifest["refs"]["virtualDisplayRef"] == manifest["virtualDisplayRef"]
    assert manifest["refs"]["virtualScreensRef"] == manifest["virtualScreensRef"]
    assert manifest["refs"]["actorCursorLogRef"] == manifest["actorCursorLogRef"]
    assert manifest["refs"]["virtualInputQueueRef"] == manifest["virtualInputQueueRef"]
    assert manifest["refs"]["filesystemRootRef"] == manifest["filesystemRootRef"]
    assert manifest["refs"]["captureStreamRef"] == manifest["captureStreamRef"]
    assert manifest["refs"]["replayBundleRef"] == manifest["replayBundleRef"]
    assert manifest["refs"]["inputAdapterManifestRef"] == manifest["inputAdapterManifestRef"]
    assert manifest["refs"]["sessionPermissionRef"] == manifest["sessionPermissionRef"]
    assert manifest["refs"]["appWindowAllowlistRef"] == manifest["appWindowAllowlistRef"]
    assert manifest["refs"]["riskPreviewRef"] == manifest["riskPreviewRef"]
    assert manifest["refs"]["dataVisibilityRef"] == manifest["dataVisibilityRef"]
    assert manifest["refs"]["stopCancelLeaseRef"] == manifest["stopCancelLeaseRef"]
    assert manifest["refs"]["stopRef"] == manifest["stopRef"]
    assert manifest["refs"]["cancelLeaseRef"] == manifest["cancelLeaseRef"]
    stop_cancel = json.loads(Path(manifest["stopCancelLeaseRef"]).read_text(encoding="utf8"))
    assert stop_cancel["activeLeaseRef"] == lease.lease_ref
    assert lease.lease_ref in stop_cancel["currentLeaseCancellationRefs"]
    assert manifest["refs"]["diagnosticsRef"] == manifest["diagnosticsRef"]
    assert manifest["refs"]["blockedManifestRef"] == manifest["blockedManifestRef"]
    assert manifest["refs"]["inputLeaseRef"] == lease.lease_ref
    assert manifest["screenRefs"] == [manifest["virtualScreensRef"]]
    assert manifest["visibleCursorRefs"] == [manifest["actorCursorLogRef"]]
    assert manifest["executorLeaseRefs"] == [lease.lease_ref]
    assert all(Path(ref).exists() for ref in manifest["refs"].values() if isinstance(ref, str) and ref)
    assert manifest["backend"]["noVncBackendStarted"] is False
    assert manifest["sharedSystemInputUsed"] is False
    assert manifest["systemPointerMoved"] is False
    assert manifest["systemKeyboardEventsSent"] is False
    assert manifest["inputAdapterValidation"]["adapterManifestRef"] == manifest["inputAdapterManifestRef"]
    adapter_copy = json.loads(Path(manifest["inputAdapterManifestRef"]).read_text(encoding="utf8"))
    assert adapter_copy["stateSchemas"]["keyboard"] == "sciforge.computer-use.virtual-keyboard-state.v1"
    assert adapter_copy["sideEffects"]["systemKeyboardEvent"] is False

    serialized = Path(manifest["manifestRef"]).read_text(encoding="utf8")
    assert "do-not-write" not in serialized
    assert "also-do-not-write" not in serialized
    for ref_key in ["diagnosticsRef", "virtualDisplayGroupRef", "virtualScreensRef", "actorCursorLogRef", "replayBundleRef"]:
        content = Path(manifest[ref_key]).read_text(encoding="utf8")
        assert "do-not-write" not in content
        assert "also-do-not-write" not in content

    user_control_validation = validate_session_permission_store(session.session_root, require_existing_refs=True)
    assert user_control_validation["ok"] is True
    for ref_key in ["sessionPermissionRef", "appWindowAllowlistRef", "riskPreviewRef", "dataVisibilityRef", "stopCancelLeaseRef"]:
        content = Path(manifest[ref_key]).read_text(encoding="utf8")
        assert "do-not-write" not in content
        assert "also-do-not-write" not in content
        assert "data:image" not in content
        assert "base64" not in content.lower()

    closed = manager.close(session.session_id, reason="test complete")

    assert closed["status"] == "closed"
    assert closed["inputLeaseRef"] is None
    closed_stop_cancel = json.loads(Path(closed["stopCancelLeaseRef"]).read_text(encoding="utf8"))
    assert closed_stop_cancel.get("activeLeaseRef") is None
    assert lease.lease_ref not in closed_stop_cancel["currentLeaseCancellationRefs"]
    assert json.loads(Path(lease.lease_ref).read_text(encoding="utf8"))["status"] == "released"
    with pytest.raises(VirtualDesktopSessionBlocked) as blocked:
        manager.lease(session.session_id, holder="agent-a")
    assert blocked.value.manifest["category"] == "virtual-desktop-session-closed"
