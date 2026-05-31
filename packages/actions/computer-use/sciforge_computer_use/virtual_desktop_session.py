"""Virtual desktop session contract skeleton for Computer Use.

The MVP in this module reserves per-thread refs and input leases, but it does
not start a real noVNC backend. Its main job is to fail closed unless the host
declares a target-bound isolated input adapter, then persist a refs-first
session manifest that future desktop backends can satisfy.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

from .user_control import write_session_permission_store
from .virtual_input_adapter import (
    VIRTUAL_INPUT_ADAPTER_STATUS,
    load_input_adapter_manifest,
    validate_input_adapter_manifest_for_real_desktop,
)


VIRTUAL_DESKTOP_SESSION_SCHEMA = "sciforge.computer-use.virtual-desktop-session.v1"
VIRTUAL_DESKTOP_BLOCKED_SCHEMA = "sciforge.computer-use.virtual-desktop-blocked-manifest.v1"
VIRTUAL_DESKTOP_DISPLAY_SCHEMA = "sciforge.computer-use.virtual-display-ref.v1"
VIRTUAL_DESKTOP_DISPLAY_GROUP_SCHEMA = "sciforge.computer-use.virtual-display-group.v1"
VIRTUAL_DESKTOP_SCREENS_SCHEMA = "sciforge.computer-use.virtual-screens.v1"
VIRTUAL_DESKTOP_CAPTURE_STREAM_SCHEMA = "sciforge.computer-use.capture-stream-ref.v1"
VIRTUAL_DESKTOP_REPLAY_BUNDLE_SCHEMA = "sciforge.computer-use.replay-bundle-ref.v1"
VIRTUAL_DESKTOP_INPUT_LEASE_SCHEMA = "sciforge.computer-use.input-lease.v1"
VIRTUAL_DESKTOP_DIAGNOSTICS_SCHEMA = "sciforge.computer-use.virtual-desktop-diagnostics.v1"
ACTOR_CURSOR_EVENT_SCHEMA = "sciforge.computer-use.actor-cursor-event.v1"
SESSION_MANIFEST_NAME = "virtual-desktop-session-manifest.json"
BLOCKED_MANIFEST_NAME = "virtual-desktop-session-blocked-manifest.json"

ISOLATION_FLAGS = {
    "sharedSystemInputUsed": False,
    "systemPointerMoved": False,
    "systemKeyboardEventsSent": False,
}
NO_OS_INPUT_FLAGS = {
    "inputExecuted": False,
    "osInputExecuted": False,
    "realOsInputExecuted": False,
    **ISOLATION_FLAGS,
}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class VirtualDesktopSessionBlocked(RuntimeError):
    """Raised when a session operation fails closed with a manifest."""

    def __init__(self, reason: str, manifest: Mapping[str, Any]) -> None:
        super().__init__(reason)
        self.reason = reason
        self.manifest = dict(manifest)


@dataclass(frozen=True)
class VirtualDesktopRefs:
    """Durable refs owned by a virtual desktop session."""

    session_root_ref: str
    virtual_display_group_ref: str
    virtual_display_ref: str
    virtual_screens_ref: str
    actor_cursor_log_ref: str
    virtual_input_queue_ref: str
    filesystem_root_ref: str
    capture_stream_ref: str
    replay_bundle_ref: str
    input_adapter_manifest_ref: str
    session_permission_ref: str
    app_window_allowlist_ref: str
    risk_preview_ref: str
    data_visibility_ref: str
    stop_cancel_lease_ref: str
    stop_ref: str
    cancel_lease_ref: str
    diagnostics_ref: str
    blocked_manifest_ref: str
    manifest_ref: str

    def as_dict(self) -> dict[str, str]:
        return {
            "sessionRootRef": self.session_root_ref,
            "virtualDisplayGroupRef": self.virtual_display_group_ref,
            "virtualDisplayRef": self.virtual_display_ref,
            "virtualScreensRef": self.virtual_screens_ref,
            "actorCursorLogRef": self.actor_cursor_log_ref,
            "virtualInputQueueRef": self.virtual_input_queue_ref,
            "filesystemRootRef": self.filesystem_root_ref,
            "captureStreamRef": self.capture_stream_ref,
            "replayBundleRef": self.replay_bundle_ref,
            "inputAdapterManifestRef": self.input_adapter_manifest_ref,
            "sessionPermissionRef": self.session_permission_ref,
            "appWindowAllowlistRef": self.app_window_allowlist_ref,
            "riskPreviewRef": self.risk_preview_ref,
            "dataVisibilityRef": self.data_visibility_ref,
            "stopCancelLeaseRef": self.stop_cancel_lease_ref,
            "stopRef": self.stop_ref,
            "cancelLeaseRef": self.cancel_lease_ref,
            "diagnosticsRef": self.diagnostics_ref,
            "blockedManifestRef": self.blocked_manifest_ref,
            "manifestRef": self.manifest_ref,
        }


@dataclass
class InputLease:
    """Exclusive writer lease for one session's virtual input queue."""

    lease_id: str
    session_id: str
    holder: str
    lease_ref: str
    scope_type: str = "screen"
    screen_id: str = "screen-1"
    window_id: str | None = None
    actor_id: str | None = None
    cursor_id: str | None = None
    status: str = "active"
    acquired_at: str = field(default_factory=_utc_now)
    released_at: str | None = None
    reason: str | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def manifest(self) -> dict[str, Any]:
        owner = {
            "holder": self.holder,
            "actorId": self.actor_id,
            "cursorId": self.cursor_id,
        }
        lease_scope = {
            "scopeType": self.scope_type,
            "screenId": self.screen_id,
            "windowId": self.window_id,
        }
        return {
            "schemaVersion": VIRTUAL_DESKTOP_INPUT_LEASE_SCHEMA,
            "status": self.status,
            "leaseId": self.lease_id,
            "sessionId": self.session_id,
            "holder": self.holder,
            "owner": _safe_mapping({key: value for key, value in owner.items() if value}),
            "leaseOwner": _safe_mapping({key: value for key, value in owner.items() if value}),
            "leaseScope": _safe_mapping({key: value for key, value in lease_scope.items() if value}),
            "screenId": self.screen_id,
            "windowId": self.window_id,
            "actorId": self.actor_id,
            "cursorId": self.cursor_id,
            "acquiredAt": self.acquired_at,
            "releasedAt": self.released_at,
            "reason": self.reason,
            "leaseRef": self.lease_ref,
            "exclusive": True,
            "inputQueueWriter": self.holder,
            "metadata": _safe_mapping(self.metadata),
            **NO_OS_INPUT_FLAGS,
        }

    def write(self) -> dict[str, Any]:
        payload = self.manifest()
        _write_json(Path(self.lease_ref), payload)
        return payload


@dataclass
class VirtualDesktopSession:
    """Per-thread virtual desktop session descriptor.

    The descriptor owns refs and an input lease. It intentionally does not own a
    backend process in this MVP.
    """

    session_id: str
    thread_id: str
    session_root: Path
    refs: VirtualDesktopRefs
    input_adapter_validation: Mapping[str, Any]
    backend_kind: str = "mvp-no-vnc-placeholder"
    status: str = "open"
    created_at: str = field(default_factory=_utc_now)
    updated_at: str = field(default_factory=_utc_now)
    metadata: Mapping[str, Any] = field(default_factory=dict)
    active_lease: InputLease | None = None

    def manifest(self) -> dict[str, Any]:
        refs = self.refs.as_dict()
        lease_ref = self.active_lease.lease_ref if self.active_lease and self.active_lease.status == "active" else None
        executor_lease_refs = [lease_ref] if lease_ref else []
        display_group_id = _display_group_id(self.session_id)
        default_screen_id = _default_screen_id()
        manifest = {
            "schemaVersion": VIRTUAL_DESKTOP_SESSION_SCHEMA,
            "status": self.status,
            "category": "virtual-desktop-session",
            "reason": "Virtual desktop session refs are reserved." if self.status == "open" else "Virtual desktop session is closed.",
            "sessionId": self.session_id,
            "threadId": self.thread_id,
            "displayGroupId": display_group_id,
            "screenIds": [default_screen_id],
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
            "backend": {
                "kind": self.backend_kind,
                "status": "not-started",
                "noVncBackendStarted": False,
                "claimLimit": "MVP skeleton only; no real noVNC backend is started by this module.",
            },
            "refs": {**refs, "inputLeaseRef": lease_ref, "executorLeaseRefs": executor_lease_refs},
            **refs,
            "displayGroupRef": self.refs.virtual_display_group_ref,
            "screenRefs": [self.refs.virtual_screens_ref],
            "visibleScreenRefs": [self.refs.virtual_screens_ref],
            "visibleCursorRefs": [self.refs.actor_cursor_log_ref],
            "sessionPermissionRef": self.refs.session_permission_ref,
            "appWindowAllowlistRef": self.refs.app_window_allowlist_ref,
            "allowedAppRefs": [],
            "allowedWindowRefs": [],
            "forbiddenAppRefs": ["app:shared-user-desktop"],
            "inputModalityPolicy": {
                "allowedInputModalities": ["observe", "actor-cursor", "scoped-executor"],
                "mutatingInputRequiresLease": True,
                "sharedSystemInputAllowed": False,
                "targetBoundExecutorRequired": True,
                "policyRef": self.refs.app_window_allowlist_ref,
            },
            "riskPreviewRef": self.refs.risk_preview_ref,
            "dataVisibilityRef": self.refs.data_visibility_ref,
            "stopCancelLeaseRef": self.refs.stop_cancel_lease_ref,
            "stopRef": self.refs.stop_ref,
            "cancelLeaseRef": self.refs.cancel_lease_ref,
            "approvalMode": "fail-closed",
            "actorCursorLogRef": self.refs.actor_cursor_log_ref,
            "inputQueueRef": self.refs.virtual_input_queue_ref,
            "executorLeaseRefs": executor_lease_refs,
            "inputLeaseRef": lease_ref,
            "inputLeaseActive": lease_ref is not None,
            "inputAdapterStatus": VIRTUAL_INPUT_ADAPTER_STATUS,
            "inputAdapterValidation": dict(self.input_adapter_validation),
            "inputIsolation": {
                "required": "target-bound isolated input adapter",
                "adapterManifestDeclared": True,
                "adapterManifestReady": bool(self.input_adapter_validation.get("ok")),
                "sharedSystemInputAllowed": False,
                "inputLeaseRequired": True,
                "inputLeaseExclusive": True,
                **ISOLATION_FLAGS,
            },
            "userControl": {
                "sessionPermissionRef": self.refs.session_permission_ref,
                "appWindowAllowlistRef": self.refs.app_window_allowlist_ref,
                "riskPreviewRef": self.refs.risk_preview_ref,
                "dataVisibilityRef": self.refs.data_visibility_ref,
                "stopCancelLeaseRef": self.refs.stop_cancel_lease_ref,
                "stopRef": self.refs.stop_ref,
                "cancelLeaseRef": self.refs.cancel_lease_ref,
                "approvalMode": "fail-closed",
                "guiExecutesActions": False,
            },
            "diagnosticOnly": True,
            "realWindowEvidence": False,
            "rawPayloadWritten": False,
            "inlineImageWritten": False,
            "secretsWritten": False,
            "completionEvidenceEligible": False,
            "metadata": _safe_mapping(self.metadata),
            **NO_OS_INPUT_FLAGS,
        }
        return manifest

    def write_manifest(self) -> dict[str, Any]:
        self.updated_at = _utc_now()
        self._write_user_control_store()
        payload = self.manifest()
        _write_json(Path(self.refs.manifest_ref), payload)
        return payload

    def lease(self, *, holder: str, metadata: Mapping[str, Any] | None = None) -> InputLease:
        if self.status != "open":
            self._raise_blocked(
                category="virtual-desktop-session-closed",
                reason="Virtual desktop session is closed; refusing to grant an input lease.",
            )
        if self.active_lease and self.active_lease.status == "active":
            self._raise_blocked(
                category="virtual-desktop-input-lease-blocked",
                reason=(
                    "Virtual desktop input lease is already active; refusing concurrent writers "
                    "to the virtual input queue."
                ),
            )
        holder_value = holder.strip() if isinstance(holder, str) else ""
        if not holder_value:
            self._raise_blocked(
                category="virtual-desktop-input-lease-blocked",
                reason="Input lease holder is required.",
            )
        safe_metadata = _safe_mapping(metadata or {})
        lease_scope = _lease_scope_from_metadata(safe_metadata)
        owner = _lease_owner_from_metadata(holder_value, safe_metadata)
        lease_id = f"lease-{uuid.uuid4().hex[:12]}"
        lease_ref = str((self.session_root / "leases" / f"{lease_id}.json").resolve())
        lease = InputLease(
            lease_id=lease_id,
            session_id=self.session_id,
            holder=holder_value,
            lease_ref=lease_ref,
            scope_type=lease_scope["scopeType"],
            screen_id=lease_scope["screenId"],
            window_id=lease_scope.get("windowId"),
            actor_id=owner.get("actorId"),
            cursor_id=owner.get("cursorId"),
            metadata=safe_metadata,
        )
        self.active_lease = lease
        lease.write()
        self._append_input_queue_event("lease-acquired", {
            "leaseId": lease_id,
            "holder": holder_value,
            "leaseRef": lease_ref,
            "leaseOwner": lease.manifest()["leaseOwner"],
            "leaseScope": lease.manifest()["leaseScope"],
        })
        self._append_actor_cursor_event(
            event_type="lease-acquired",
            actor_id=owner.get("actorId") or holder_value,
            cursor_id=owner.get("cursorId") or f"cursor-{_safe_ref_segment(holder_value)}",
            screen_id=lease_scope["screenId"],
            window_id=lease_scope.get("windowId"),
            state="lease-owner",
            refs=[lease_ref],
            payload={"leaseId": lease_id, "holder": holder_value},
        )
        self.write_manifest()
        return lease

    def release(self, lease_id: str, *, reason: str | None = None) -> dict[str, Any]:
        if not self.active_lease or self.active_lease.status != "active":
            self._raise_blocked(
                category="virtual-desktop-input-lease-release-blocked",
                reason="No active virtual desktop input lease exists for this session.",
            )
        if lease_id != self.active_lease.lease_id:
            self._raise_blocked(
                category="virtual-desktop-input-lease-release-blocked",
                reason="Input lease id does not match the active virtual desktop session lease.",
            )
        lease = self.active_lease
        lease.status = "released"
        lease.released_at = _utc_now()
        lease.reason = reason or "released"
        payload = lease.write()
        self.active_lease = None
        self._append_input_queue_event("lease-released", {
            "leaseId": lease_id,
            "reason": lease.reason,
            "leaseRef": lease.lease_ref,
            "leaseScope": lease.manifest()["leaseScope"],
        })
        self._append_actor_cursor_event(
            event_type="lease-released",
            actor_id=lease.actor_id or lease.holder,
            cursor_id=lease.cursor_id or f"cursor-{_safe_ref_segment(lease.holder)}",
            screen_id=lease.screen_id,
            window_id=lease.window_id,
            state="released",
            refs=[lease.lease_ref],
            payload={"leaseId": lease_id, "reason": lease.reason},
        )
        self.write_manifest()
        return payload

    def close(self, *, reason: str | None = None) -> dict[str, Any]:
        if self.active_lease and self.active_lease.status == "active":
            self.release(self.active_lease.lease_id, reason="session-close")
        self.status = "closed"
        self._append_input_queue_event("session-closed", {"reason": reason or "closed"})
        return self.write_manifest()

    def _raise_blocked(self, *, category: str, reason: str) -> None:
        manifest_ref = self.session_root / "blocked" / f"{category}-{uuid.uuid4().hex[:12]}.json"
        manifest = build_blocked_virtual_desktop_manifest(
            output_ref=manifest_ref,
            category=category,
            reason=reason,
            thread_id=self.thread_id,
            session_id=self.session_id,
            refs=self.refs.as_dict(),
            input_adapter_validation=self.input_adapter_validation,
            active_lease_ref=self.active_lease.lease_ref if self.active_lease else None,
        )
        _write_json(manifest_ref, manifest)
        raise VirtualDesktopSessionBlocked(reason, manifest)

    def _write_user_control_store(self) -> None:
        write_session_permission_store(
            self.session_root,
            session_id=self.session_id,
            thread_id=self.thread_id,
            display_group_ref=self.refs.virtual_display_group_ref,
            screen_refs=[self.refs.virtual_screens_ref],
            actor_cursor_log_ref=self.refs.actor_cursor_log_ref,
            input_queue_ref=self.refs.virtual_input_queue_ref,
            capture_stream_ref=self.refs.capture_stream_ref,
            replay_bundle_ref=self.refs.replay_bundle_ref,
            input_adapter_manifest_ref=self.refs.input_adapter_manifest_ref,
            active_lease_ref=self.active_lease.lease_ref if self.active_lease and self.active_lease.status == "active" else None,
            metadata=self.metadata,
        )

    def _append_input_queue_event(self, event_type: str, payload: Mapping[str, Any]) -> None:
        event = {
            "schemaVersion": "sciforge.computer-use.virtual-input-queue-event.v1",
            "eventType": event_type,
            "sessionId": self.session_id,
            "threadId": self.thread_id,
            "displayGroupId": _display_group_id(self.session_id),
            "createdAt": _utc_now(),
            "payload": _safe_mapping(payload),
            **NO_OS_INPUT_FLAGS,
        }
        _append_jsonl(Path(self.refs.virtual_input_queue_ref), event)

    def _append_actor_cursor_event(
        self,
        *,
        event_type: str,
        actor_id: str,
        cursor_id: str,
        screen_id: str,
        window_id: str | None,
        state: str,
        refs: list[str],
        payload: Mapping[str, Any] | None = None,
    ) -> None:
        _append_actor_cursor_event(
            Path(self.refs.actor_cursor_log_ref),
            session_id=self.session_id,
            thread_id=self.thread_id,
            event_type=event_type,
            actor_id=actor_id,
            cursor_id=cursor_id,
            screen_id=screen_id,
            window_id=window_id,
            state=state,
            refs=refs,
            payload=payload or {},
        )


class SessionManager:
    """In-memory manager for MVP virtual desktop session descriptors."""

    def __init__(
        self,
        root_dir: str | Path,
        *,
        input_adapter_manifest: Mapping[str, Any] | str | Path | None = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> None:
        self.root_dir = Path(root_dir).expanduser().resolve()
        self.input_adapter_manifest = input_adapter_manifest
        self.metadata = dict(metadata or {})
        self._sessions: dict[str, VirtualDesktopSession] = {}
        self._thread_sessions: dict[str, list[str]] = {}

    def create(
        self,
        thread_id: str,
        *,
        input_adapter_manifest: Mapping[str, Any] | str | Path | None = None,
        metadata: Mapping[str, Any] | None = None,
        backend_kind: str = "mvp-no-vnc-placeholder",
    ) -> VirtualDesktopSession:
        thread_value = _required_string(thread_id, "thread_id")
        session_id = f"{_safe_ref_segment(thread_value)}-{uuid.uuid4().hex[:12]}"
        session_root = (self.root_dir / _safe_ref_segment(thread_value) / session_id).resolve()
        manifest_source = input_adapter_manifest if input_adapter_manifest is not None else self.input_adapter_manifest
        validation = validate_input_adapter_manifest_for_real_desktop(manifest_source)
        if not validation.get("ok"):
            reason = (
                "No isolated input adapter capability was declared; virtual desktop session creation failed closed."
                if manifest_source is None
                else "Input adapter capability is not target-bound isolated; virtual desktop session creation failed closed."
            )
            manifest_ref = session_root / BLOCKED_MANIFEST_NAME
            blocked_manifest = build_blocked_virtual_desktop_manifest(
                output_ref=manifest_ref,
                category="virtual-desktop-session-blocked",
                reason=reason,
                thread_id=thread_value,
                session_id=session_id,
                refs={"sessionRootRef": str(session_root)},
                input_adapter_validation=validation,
                active_lease_ref=None,
            )
            _write_json(manifest_ref, blocked_manifest)
            raise VirtualDesktopSessionBlocked(reason, blocked_manifest)

        refs = _materialize_session_refs(
            session_root=session_root,
            session_id=session_id,
            thread_id=thread_value,
            input_adapter_manifest=manifest_source,
            backend_kind=backend_kind,
            metadata={**self.metadata, **dict(metadata or {})},
        )
        session_validation = {**validation, "adapterManifestRef": refs.input_adapter_manifest_ref}
        session = VirtualDesktopSession(
            session_id=session_id,
            thread_id=thread_value,
            session_root=session_root,
            refs=refs,
            input_adapter_validation=session_validation,
            backend_kind=backend_kind,
            metadata={**self.metadata, **dict(metadata or {})},
        )
        session.write_manifest()
        self._sessions[session_id] = session
        self._thread_sessions.setdefault(thread_value, []).append(session_id)
        return session

    def get(self, session_id: str) -> VirtualDesktopSession | None:
        return self._sessions.get(session_id)

    def sessions_for_thread(self, thread_id: str) -> list[VirtualDesktopSession]:
        return [
            self._sessions[session_id]
            for session_id in self._thread_sessions.get(thread_id, [])
            if session_id in self._sessions
        ]

    def lease(
        self,
        session_id: str,
        *,
        holder: str,
        metadata: Mapping[str, Any] | None = None,
    ) -> InputLease:
        return self._require_session(session_id).lease(holder=holder, metadata=metadata)

    def release(self, session_id: str, lease_id: str, *, reason: str | None = None) -> dict[str, Any]:
        return self._require_session(session_id).release(lease_id, reason=reason)

    def close(self, session_id: str, *, reason: str | None = None) -> dict[str, Any]:
        return self._require_session(session_id).close(reason=reason)

    def _require_session(self, session_id: str) -> VirtualDesktopSession:
        session = self.get(session_id)
        if session is not None:
            return session
        safe_session_id = _safe_ref_segment(session_id or "missing-session")
        manifest_ref = self.root_dir / "blocked" / f"missing-session-{safe_session_id}.json"
        reason = f"Virtual desktop session {session_id!r} was not found."
        manifest = build_blocked_virtual_desktop_manifest(
            output_ref=manifest_ref,
            category="virtual-desktop-session-missing",
            reason=reason,
            thread_id=None,
            session_id=session_id,
            refs={},
            input_adapter_validation={},
            active_lease_ref=None,
        )
        _write_json(manifest_ref, manifest)
        raise VirtualDesktopSessionBlocked(reason, manifest)


def build_blocked_virtual_desktop_manifest(
    *,
    output_ref: str | Path,
    category: str,
    reason: str,
    thread_id: str | None,
    session_id: str | None,
    refs: Mapping[str, str] | None,
    input_adapter_validation: Mapping[str, Any] | None,
    active_lease_ref: str | None,
) -> dict[str, Any]:
    """Build a refs-first blocked manifest for virtual desktop session failures."""

    validation = dict(input_adapter_validation or {})
    blocked_reasons = list(validation.get("errors") or [])
    if reason and reason not in blocked_reasons:
        blocked_reasons.insert(0, reason)
    manifest_ref = str(Path(output_ref).expanduser().resolve())
    safe_refs = {str(key): str(value) for key, value in dict(refs or {}).items() if value}
    if active_lease_ref:
        safe_refs["inputLeaseRef"] = active_lease_ref
    return {
        "schemaVersion": VIRTUAL_DESKTOP_BLOCKED_SCHEMA,
        "status": "blocked",
        "category": category,
        "reason": reason,
        "blockedReasons": blocked_reasons,
        "threadId": thread_id,
        "sessionId": session_id,
        "refs": safe_refs,
        **safe_refs,
        "manifestRef": manifest_ref,
        "inputLeaseRef": active_lease_ref,
        "requiredSessionResources": [
            "virtualDisplayGroupRef",
            "virtualDisplayRef",
            "virtualScreensRef",
            "actorCursorLogRef",
            "virtualInputQueueRef",
            "filesystemRootRef",
            "captureStreamRef",
            "replayBundleRef",
            "inputLeaseRef",
        ],
        "inputIsolation": {
            "required": "target-bound isolated input adapter",
            "inputAdapterStatus": VIRTUAL_INPUT_ADAPTER_STATUS,
            "adapterManifestDeclared": bool(validation.get("schemaRef") or validation.get("adapterManifestRef")),
            "adapterManifestReady": bool(validation.get("ok")),
            "adapterManifestValidation": validation,
            "sharedSystemInputAllowed": False,
            "failClosed": True,
            **ISOLATION_FLAGS,
        },
        "inputAdapterValidation": validation,
        "diagnosticOnly": True,
        "realWindowEvidence": False,
        "rawPayloadWritten": False,
        "inlineImageWritten": False,
        "secretsWritten": False,
        "suggestedNextAction": (
            "Provide a target-bound isolated input adapter manifest before creating a virtual desktop session."
        ),
        **NO_OS_INPUT_FLAGS,
    }


def _materialize_session_refs(
    *,
    session_root: Path,
    session_id: str,
    thread_id: str,
    input_adapter_manifest: Mapping[str, Any] | str | Path,
    backend_kind: str,
    metadata: Mapping[str, Any] | None = None,
) -> VirtualDesktopRefs:
    session_root.mkdir(parents=True, exist_ok=True)
    filesystem_root = (session_root / "filesystem-root").resolve()
    filesystem_root.mkdir(parents=True, exist_ok=True)
    (session_root / "leases").mkdir(parents=True, exist_ok=True)
    (session_root / "blocked").mkdir(parents=True, exist_ok=True)
    (session_root / "diagnostics").mkdir(parents=True, exist_ok=True)
    display_group_id = _display_group_id(session_id)
    default_screen_id = _default_screen_id()
    display_group_ref = (session_root / "virtual-display-group.json").resolve()
    display_ref = (session_root / "virtual-display.json").resolve()
    screens_ref = (session_root / "virtual-screens.json").resolve()
    actor_cursor_log_ref = (session_root / "actor-cursors.jsonl").resolve()
    input_queue_ref = (session_root / "virtual-input-queue.jsonl").resolve()
    capture_stream_ref = (session_root / "capture-stream.json").resolve()
    replay_bundle_ref = (session_root / "replay-bundle.json").resolve()
    adapter_manifest_ref = (session_root / "input-adapter-manifest.json").resolve()
    diagnostics_ref = (session_root / "diagnostics" / "no-secret-diagnostics.json").resolve()
    blocked_manifest_ref = (session_root / "blocked" / "blocked-manifest.json").resolve()
    manifest_ref = (session_root / SESSION_MANIFEST_NAME).resolve()

    adapter_payload = load_input_adapter_manifest(input_adapter_manifest)
    _write_json(adapter_manifest_ref, _safe_mapping(adapter_payload))
    user_control_refs = write_session_permission_store(
        session_root,
        session_id=session_id,
        thread_id=thread_id,
        display_group_ref=str(display_group_ref),
        screen_refs=[str(screens_ref)],
        actor_cursor_log_ref=str(actor_cursor_log_ref),
        input_queue_ref=str(input_queue_ref),
        capture_stream_ref=str(capture_stream_ref),
        replay_bundle_ref=str(replay_bundle_ref),
        input_adapter_manifest_ref=str(adapter_manifest_ref),
        active_lease_ref=None,
        metadata=metadata or {},
    )
    screen_record = {
        "screenId": default_screen_id,
        "index": 0,
        "status": "reserved",
        "displayGroupId": display_group_id,
        "geometry": {
            "x": 0,
            "y": 0,
            "width": 1280,
            "height": 720,
            "scale": 1.0,
            "coordinateSpace": "screen-local",
        },
        "backendBinding": {
            "kind": backend_kind,
            "status": "not-started",
            "targetBound": True,
            "realWindowEvidence": False,
        },
        "captureSource": {
            "kind": "reserved-capture-stream",
            "captureStreamRef": str(capture_stream_ref),
        },
        "windowNamespace": {
            "kind": "screen-local-window-namespace",
            "windowRefs": [],
        },
        "resourceRefs": {
            "captureStreamRef": str(capture_stream_ref),
            "replayBundleRef": str(replay_bundle_ref),
            "inputQueueRef": str(input_queue_ref),
        },
        **NO_OS_INPUT_FLAGS,
    }
    _write_json(
        display_group_ref,
        {
            "schemaVersion": VIRTUAL_DESKTOP_DISPLAY_GROUP_SCHEMA,
            "sessionId": session_id,
            "threadId": thread_id,
            "displayGroupId": display_group_id,
            "status": "reserved",
            "screenIds": [default_screen_id],
            "screenRefs": [str(screens_ref)],
        "actorCursorLogRef": str(actor_cursor_log_ref),
        "virtualInputQueueRef": str(input_queue_ref),
        "executorLeaseRefs": [],
        "userControlRefs": user_control_refs.as_dict(),
        **user_control_refs.as_dict(),
        "coordinateSpaces": ["screen-local", "window-local"],
            "backendKind": backend_kind,
            "diagnosticOnly": True,
            "realWindowEvidence": False,
            **NO_OS_INPUT_FLAGS,
        },
    )
    _write_json(
        screens_ref,
        {
            "schemaVersion": VIRTUAL_DESKTOP_SCREENS_SCHEMA,
            "sessionId": session_id,
            "threadId": thread_id,
            "displayGroupId": display_group_id,
            "status": "reserved",
            "screens": [screen_record],
            "screenRefs": [str(screens_ref)],
            "coordinateSpacePolicy": "screen-local; no shared ambiguous global coordinates",
            "diagnosticOnly": True,
            "realWindowEvidence": False,
            **NO_OS_INPUT_FLAGS,
        },
    )
    _write_json(
        display_ref,
        {
            "schemaVersion": VIRTUAL_DESKTOP_DISPLAY_SCHEMA,
            "sessionId": session_id,
            "threadId": thread_id,
            "displayGroupId": display_group_id,
            "screenId": default_screen_id,
            "status": "reserved",
            "backendKind": backend_kind,
            "displayGroupRef": str(display_group_ref),
            "screenRefs": [str(screens_ref)],
            "frameRefs": [],
            "currentFrameRef": None,
            "compatibilityProjection": "legacy single-display ref for callers not yet reading virtual-display-group.json",
            **NO_OS_INPUT_FLAGS,
        },
    )
    actor_cursor_log_ref.touch(exist_ok=True)
    _append_actor_cursor_event(
        actor_cursor_log_ref,
        session_id=session_id,
        thread_id=thread_id,
        event_type="cursor-presence",
        actor_id="system",
        cursor_id=f"cursor-{_safe_ref_segment(session_id)}-system",
        screen_id=default_screen_id,
        window_id=None,
        state="reserved",
        refs=[str(display_group_ref), str(screens_ref)],
        payload={"source": "session-manager", "diagnosticOnly": True},
    )
    input_queue_ref.parent.mkdir(parents=True, exist_ok=True)
    input_queue_ref.touch(exist_ok=True)
    _write_json(
        capture_stream_ref,
        {
            "schemaVersion": VIRTUAL_DESKTOP_CAPTURE_STREAM_SCHEMA,
            "sessionId": session_id,
            "threadId": thread_id,
            "displayGroupId": display_group_id,
            "screenRefs": [str(screens_ref)],
            "status": "reserved",
            "frameRefs": [],
            "streamRef": str(capture_stream_ref),
            **NO_OS_INPUT_FLAGS,
        },
    )
    _write_json(
        replay_bundle_ref,
        {
            "schemaVersion": VIRTUAL_DESKTOP_REPLAY_BUNDLE_SCHEMA,
            "sessionId": session_id,
            "threadId": thread_id,
            "displayGroupId": display_group_id,
            "displayGroupRef": str(display_group_ref),
            "screenRefs": [str(screens_ref)],
            "status": "reserved",
            "frames": [],
            "multiScreenFrames": True,
            "cursorOverlayRefs": [str(actor_cursor_log_ref)],
            "timelineRefs": [],
            "inputEventLogRef": str(input_queue_ref),
            "actorCursorLogRef": str(actor_cursor_log_ref),
            "captureStreamRef": str(capture_stream_ref),
            "executorLeaseRefs": [],
            "userControlRefs": user_control_refs.as_dict(),
            **user_control_refs.as_dict(),
            "completionEvidenceEligible": False,
            **NO_OS_INPUT_FLAGS,
        },
    )
    _write_json(
        diagnostics_ref,
        {
            "schemaVersion": VIRTUAL_DESKTOP_DIAGNOSTICS_SCHEMA,
            "sessionId": session_id,
            "threadId": thread_id,
            "displayGroupId": display_group_id,
            "status": "diagnostic-only",
            "diagnosticOnly": True,
            "realWindowEvidence": False,
            "inputAdapterValidation": _safe_mapping(validate_input_adapter_manifest_for_real_desktop(input_adapter_manifest)),
            "refs": {
                "virtualDisplayGroupRef": str(display_group_ref),
                "virtualScreensRef": str(screens_ref),
                "actorCursorLogRef": str(actor_cursor_log_ref),
                "virtualInputQueueRef": str(input_queue_ref),
                "captureStreamRef": str(capture_stream_ref),
                "replayBundleRef": str(replay_bundle_ref),
                **user_control_refs.as_dict(),
            },
            "rawPayloadWritten": False,
            "inlineImageWritten": False,
            "secretsWritten": False,
            **NO_OS_INPUT_FLAGS,
        },
    )
    _write_json(
        blocked_manifest_ref,
        {
            "schemaVersion": VIRTUAL_DESKTOP_BLOCKED_SCHEMA,
            "status": "clear",
            "category": "virtual-desktop-session-blocked-index",
            "reason": "No blocked session operation has been recorded for this session root.",
            "blockedReasons": [],
            "threadId": thread_id,
            "sessionId": session_id,
            "refs": {},
            "manifestRef": str(blocked_manifest_ref),
            "diagnosticOnly": True,
            "realWindowEvidence": False,
            "rawPayloadWritten": False,
            "inlineImageWritten": False,
            "secretsWritten": False,
            **NO_OS_INPUT_FLAGS,
        },
    )
    return VirtualDesktopRefs(
        session_root_ref=str(session_root),
        virtual_display_group_ref=str(display_group_ref),
        virtual_display_ref=str(display_ref),
        virtual_screens_ref=str(screens_ref),
        actor_cursor_log_ref=str(actor_cursor_log_ref),
        virtual_input_queue_ref=str(input_queue_ref),
        filesystem_root_ref=str(filesystem_root),
        capture_stream_ref=str(capture_stream_ref),
        replay_bundle_ref=str(replay_bundle_ref),
        input_adapter_manifest_ref=str(adapter_manifest_ref),
        session_permission_ref=user_control_refs.session_permission_ref,
        app_window_allowlist_ref=user_control_refs.app_window_allowlist_ref,
        risk_preview_ref=user_control_refs.risk_preview_ref,
        data_visibility_ref=user_control_refs.data_visibility_ref,
        stop_cancel_lease_ref=user_control_refs.stop_cancel_lease_ref,
        stop_ref=user_control_refs.stop_ref,
        cancel_lease_ref=user_control_refs.cancel_lease_ref,
        diagnostics_ref=str(diagnostics_ref),
        blocked_manifest_ref=str(blocked_manifest_ref),
        manifest_ref=str(manifest_ref),
    )


def _required_string(value: str, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a non-empty string.")
    return value.strip()


def _safe_ref_segment(value: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "-" for ch in str(value).strip().lower())
    cleaned = "-".join(part for part in cleaned.split("-") if part)
    return cleaned[:80] or "virtual-desktop"


def _default_screen_id() -> str:
    return "screen-1"


def _display_group_id(session_id: str) -> str:
    return f"display-group-{_safe_ref_segment(session_id)}"


def _lease_scope_from_metadata(metadata: Mapping[str, Any]) -> dict[str, str]:
    explicit = _safe_mapping(metadata.get("leaseScope") if isinstance(metadata.get("leaseScope"), Mapping) else {})
    target_scope = _safe_mapping(metadata.get("targetScope") if isinstance(metadata.get("targetScope"), Mapping) else {})
    source = {**target_scope, **explicit, **metadata}
    screen_id = _first_non_empty_string(
        source.get("screenId"),
        source.get("screen_id"),
        _nested_string(metadata, "target", "screenId"),
        _nested_string(metadata, "target", "screen_id"),
    ) or _default_screen_id()
    window_id = _first_non_empty_string(
        source.get("windowId"),
        source.get("window_id"),
        _nested_string(metadata, "target", "windowId"),
        _nested_string(metadata, "target", "window_id"),
    )
    scope_type = _first_non_empty_string(
        source.get("scopeType"),
        source.get("scope"),
        source.get("type"),
    ) or ("window" if window_id else "screen")
    normalized_scope = scope_type.strip().lower().replace("_", "-")
    if normalized_scope not in {"screen", "screen-global", "window", "window-local"}:
        normalized_scope = "window" if window_id else "screen"
    if normalized_scope == "screen-global":
        normalized_scope = "screen"
    if normalized_scope == "window-local":
        normalized_scope = "window"
    result = {"scopeType": normalized_scope, "screenId": screen_id}
    if window_id:
        result["windowId"] = window_id
    return result


def _lease_owner_from_metadata(holder: str, metadata: Mapping[str, Any]) -> dict[str, str]:
    explicit = _safe_mapping(metadata.get("leaseOwner") if isinstance(metadata.get("leaseOwner"), Mapping) else {})
    source = {**explicit, **metadata}
    actor_id = _first_non_empty_string(
        source.get("actorId"),
        source.get("actor_id"),
        source.get("ownerActorId"),
    ) or holder
    cursor_id = _first_non_empty_string(
        source.get("cursorId"),
        source.get("cursor_id"),
        source.get("ownerCursorId"),
    ) or f"cursor-{_safe_ref_segment(holder)}"
    return {"actorId": actor_id, "cursorId": cursor_id}


def _first_non_empty_string(*values: Any) -> str | None:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _nested_string(value: Mapping[str, Any], *keys: str) -> str | None:
    item: Any = value
    for key in keys:
        if not isinstance(item, Mapping):
            return None
        item = item.get(key)
    return item.strip() if isinstance(item, str) and item.strip() else None


def _append_actor_cursor_event(
    path: Path,
    *,
    session_id: str,
    thread_id: str,
    event_type: str,
    actor_id: str,
    cursor_id: str,
    screen_id: str,
    window_id: str | None,
    state: str,
    refs: list[str],
    payload: Mapping[str, Any],
) -> None:
    event = {
        "schemaVersion": ACTOR_CURSOR_EVENT_SCHEMA,
        "eventType": event_type,
        "sessionId": session_id,
        "threadId": thread_id,
        "displayGroupId": _display_group_id(session_id),
        "actorId": actor_id,
        "cursorId": cursor_id,
        "screenId": screen_id,
        "windowId": window_id,
        "position": {"x": 0, "y": 0, "coordinateSpace": "screen-local"},
        "state": state,
        "source": "session-manager",
        "refs": [ref for ref in refs if isinstance(ref, str) and ref],
        "createdAt": _utc_now(),
        "payload": _safe_mapping(payload),
        "mutatingGuiAction": False,
        **NO_OS_INPUT_FLAGS,
    }
    _append_jsonl(path, event)


def _safe_mapping(value: Mapping[str, Any]) -> dict[str, Any]:
    safe: dict[str, Any] = {}
    for key, item in value.items():
        normalized = str(key).replace("_", "").replace("-", "").lower()
        if (
            normalized == "key"
            or normalized.endswith("key")
            or any(token in normalized for token in ("token", "secret", "password", "credential", "authorization"))
        ):
            safe[str(key)] = "[REDACTED]"
        elif isinstance(item, Mapping):
            safe[str(key)] = _safe_mapping(item)
        elif isinstance(item, list):
            safe[str(key)] = [_safe_list_item(entry) for entry in item]
        elif isinstance(item, tuple):
            safe[str(key)] = [_safe_list_item(entry) for entry in item]
        elif isinstance(item, (str, int, float, bool)) or item is None:
            safe[str(key)] = item
        else:
            safe[str(key)] = str(item)
    return safe


def _safe_list_item(value: Any) -> Any:
    if isinstance(value, Mapping):
        return _safe_mapping(value)
    if isinstance(value, list):
        return [_safe_list_item(entry) for entry in value]
    if isinstance(value, tuple):
        return [_safe_list_item(entry) for entry in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _append_jsonl(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf8") as handle:
        handle.write(f"{json.dumps(payload, sort_keys=True)}\n")


def _write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{json.dumps(payload, indent=2, sort_keys=True)}\n", encoding="utf8")


__all__ = [
    "ACTOR_CURSOR_EVENT_SCHEMA",
    "BLOCKED_MANIFEST_NAME",
    "ISOLATION_FLAGS",
    "InputLease",
    "NO_OS_INPUT_FLAGS",
    "SESSION_MANIFEST_NAME",
    "SessionManager",
    "VIRTUAL_DESKTOP_BLOCKED_SCHEMA",
    "VIRTUAL_DESKTOP_CAPTURE_STREAM_SCHEMA",
    "VIRTUAL_DESKTOP_DIAGNOSTICS_SCHEMA",
    "VIRTUAL_DESKTOP_DISPLAY_SCHEMA",
    "VIRTUAL_DESKTOP_DISPLAY_GROUP_SCHEMA",
    "VIRTUAL_DESKTOP_INPUT_LEASE_SCHEMA",
    "VIRTUAL_DESKTOP_REPLAY_BUNDLE_SCHEMA",
    "VIRTUAL_DESKTOP_SCREENS_SCHEMA",
    "VIRTUAL_DESKTOP_SESSION_SCHEMA",
    "VirtualDesktopRefs",
    "VirtualDesktopSession",
    "VirtualDesktopSessionBlocked",
    "build_blocked_virtual_desktop_manifest",
]
