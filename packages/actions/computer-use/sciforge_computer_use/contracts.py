"""Stable contracts for the SciForge Computer Use package."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, Mapping, Protocol, Sequence


REQUEST_SCHEMA_VERSION = "sciforge.computer-use.request.v1"
RESULT_SCHEMA_VERSION = "sciforge.computer-use.result.v1"
MULTI_SCREEN_CONTRACT_VALIDATION_SCHEMA_VERSION = "sciforge.computer-use.multi-screen-contract-validation.v1"
VIRTUAL_DESKTOP_SESSION_MANIFEST_SCHEMA = "sciforge.computer-use.virtual-desktop-session-manifest.v2"
VIRTUAL_DISPLAY_GROUP_SCHEMA = "sciforge.computer-use.virtual-display-group.v1"
VIRTUAL_SCREEN_SCHEMA = "sciforge.computer-use.virtual-screen.v1"
ACTOR_CURSOR_EVENT_SCHEMA = "sciforge.computer-use.actor-cursor-event.v1"
ACTOR_CURSOR_LOG_SCHEMA = "sciforge.computer-use.actor-cursor-log.v1"
ACTION_PROPOSAL_SCHEMA = "sciforge.computer-use.action-proposal.v1"
SCOPED_EXECUTOR_LEASE_SCHEMA = "sciforge.computer-use.scoped-executor-lease.v1"
EXECUTOR_EVENT_SCHEMA = "sciforge.computer-use.executor-event.v1"
REPLAY_MANIFEST_SCHEMA = "sciforge.computer-use.replay-manifest.v1"
USER_CONTROL_CONTRACT_VALIDATION_SCHEMA_VERSION = "sciforge.computer-use.user-control-contract-validation.v1"
SESSION_PERMISSION_SCHEMA = "sciforge.computer-use.session-permission.v1"
APP_WINDOW_ALLOWLIST_SCHEMA = "sciforge.computer-use.app-window-allowlist.v1"
RISK_PREVIEW_SCHEMA = "sciforge.computer-use.risk-preview.v1"
DATA_VISIBILITY_SCHEMA = "sciforge.computer-use.data-visibility.v1"
STOP_CANCEL_LEASE_SCHEMA = "sciforge.computer-use.stop-cancel-lease.v1"
USER_LEVEL_MUTATING_EVIDENCE_SCHEMA = "sciforge.computer-use.user-level-mutating-evidence.v1"
VIRTUAL_APP_SCREEN_USER_ACCEPTANCE_MANIFEST_SCHEMA = (
    "sciforge.computer-use.virtual-app-screen-user-acceptance-manifest.v1"
)
VIRTUAL_APP_SCREEN_USER_ACCEPTANCE_VALIDATION_SCHEMA_VERSION = (
    "sciforge.computer-use.virtual-app-screen-user-acceptance-validation.v1"
)
ACTION_ADAPTER_READINESS_SCHEMA = "sciforge.computer-use.action-adapter-readiness.v1"
INPUT_INTENT_SCHEMA = "sciforge.computer-use.input-intent.v1"
ANNOTATION_OVERLAY_SCHEMA = "sciforge.computer-use.annotation-overlay.v1"


ActionKind = Literal[
    "open_app",
    "click",
    "double_click",
    "drag",
    "type_text",
    "press_key",
    "hotkey",
    "scroll",
    "wait",
    "focus",
    "save",
]
ComputerUseStatus = Literal[
    "completed",
    "failed-with-reason",
    "needs-confirmation",
    "max-steps",
]
RiskLevel = Literal["low", "medium", "high"]
PlannerContractIssue = Literal[
    "coordinate-output",
    "app-private-shortcut",
    "unsupported-action",
    "empty-action",
]
CursorEventKind = Literal["presence", "move", "point", "annotate", "proposal", "takeover", "release"]
TargetScope = Literal["screen", "window", "element", "region", "artifact"]
LeaseScope = Literal["screen", "window"]
ApprovalState = Literal["not-required", "pending", "needs-confirmation", "approved", "rejected"]
ExecutorEventStatus = Literal["queued", "running", "completed", "failed", "blocked", "cancelled"]
ApprovalMode = Literal[
    "fail-closed",
    "require-confirmation",
    "preapproved-session",
    "allow-confirmed",
    "handoff-required",
]
VirtualAppScreenUserAcceptanceStatus = Literal[
    "passed",
    "blocked",
    "needs-confirmation",
    "requires-handoff",
    "diagnostic",
]
VirtualAppScreenInputKind = Literal["click", "type_text", "drag", "scroll", "hotkey", "menu_command"]
AnnotationOverlayKind = Literal[
    "point",
    "rectangle",
    "arrow",
    "highlight",
    "comment",
    "agent_cursor_trace",
    "rejected_target",
]


@dataclass(frozen=True)
class ComputerUseRequest:
    task: str
    schema_version: str = REQUEST_SCHEMA_VERSION
    max_steps: int = 12
    risk_policy: Literal["fail-closed", "allow-confirmed"] = "fail-closed"
    approval_ref: str | None = None
    providers: Mapping[str, str] = field(default_factory=dict)
    window_target: Mapping[str, Any] | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Observation:
    ref: str
    summary: str = ""
    visible_texts: Sequence[str] = field(default_factory=tuple)
    window_target: Mapping[str, Any] | None = None
    artifacts: Mapping[str, Any] = field(default_factory=dict)
    metadata: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ActionTarget:
    description: str
    region_description: str | None = None
    ref: str | None = None


@dataclass(frozen=True)
class ActionPlan:
    kind: ActionKind | None = None
    target: ActionTarget | None = None
    text: str | None = None
    key: str | None = None
    keys: Sequence[str] = field(default_factory=tuple)
    direction: str | None = None
    amount: float = 1.0
    app_name: str | None = None
    done: bool = False
    reason: str = ""
    risk_level: RiskLevel = "low"
    requires_confirmation: bool = False
    metadata: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class VirtualDesktopSessionManifest:
    """Refs-first multi-screen session manifest.

    Legacy single-display fields may be mirrored in ``compatibility_projection``,
    but validators never treat them as a substitute for ``display_group_ref`` or
    ``screen_refs``.
    """

    session_id: str
    display_group_ref: str
    screen_refs: Sequence[str]
    actor_cursor_log_ref: str
    input_queue_ref: str
    executor_lease_refs: Sequence[str]
    capture_stream_ref: str
    replay_bundle_ref: str
    session_permission_ref: str
    app_window_allowlist_ref: str
    risk_preview_ref: str
    data_visibility_ref: str
    stop_ref: str
    cancel_lease_ref: str
    approval_mode: ApprovalMode = "fail-closed"
    allowed_app_refs: Sequence[str] = field(default_factory=tuple)
    allowed_window_refs: Sequence[str] = field(default_factory=tuple)
    forbidden_app_refs: Sequence[str] = field(default_factory=tuple)
    input_modality_policy: Mapping[str, Any] = field(default_factory=dict)
    manifest_ref: str | None = None
    thread_id: str | None = None
    shared_system_input_used: bool = False
    system_pointer_moved: bool = False
    system_keyboard_events_sent: bool = False
    compatibility_projection: Mapping[str, Any] = field(default_factory=dict)
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        payload = {
            "schemaVersion": VIRTUAL_DESKTOP_SESSION_MANIFEST_SCHEMA,
            "sessionId": self.session_id,
            "threadId": self.thread_id,
            "displayGroupRef": self.display_group_ref,
            "screenRefs": list(self.screen_refs),
            "actorCursorLogRef": self.actor_cursor_log_ref,
            "inputQueueRef": self.input_queue_ref,
            "executorLeaseRefs": list(self.executor_lease_refs),
            "captureStreamRef": self.capture_stream_ref,
            "replayBundleRef": self.replay_bundle_ref,
            "sessionPermissionRef": self.session_permission_ref,
            "appWindowAllowlistRef": self.app_window_allowlist_ref,
            "allowedAppRefs": list(self.allowed_app_refs),
            "allowedWindowRefs": list(self.allowed_window_refs),
            "forbiddenAppRefs": list(self.forbidden_app_refs),
            "inputModalityPolicy": dict(self.input_modality_policy),
            "riskPreviewRef": self.risk_preview_ref,
            "dataVisibilityRef": self.data_visibility_ref,
            "stopRef": self.stop_ref,
            "cancelLeaseRef": self.cancel_lease_ref,
            "approvalMode": self.approval_mode,
            "manifestRef": self.manifest_ref,
            "compatibilityProjection": dict(self.compatibility_projection),
            "metadata": dict(self.metadata),
            "sharedSystemInputUsed": self.shared_system_input_used,
            "systemPointerMoved": self.system_pointer_moved,
            "systemKeyboardEventsSent": self.system_keyboard_events_sent,
        }
        return _drop_none_values(payload)


@dataclass(frozen=True)
class VirtualDisplayGroup:
    display_group_id: str
    session_id: str
    screen_refs: Sequence[str]
    actor_cursor_log_ref: str
    input_queue_ref: str
    executor_lease_refs: Sequence[str]
    capture_stream_ref: str
    replay_bundle_ref: str
    manifest_ref: str | None = None
    resource_refs: Mapping[str, str] = field(default_factory=dict)
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return _drop_none_values({
            "schemaVersion": VIRTUAL_DISPLAY_GROUP_SCHEMA,
            "displayGroupId": self.display_group_id,
            "sessionId": self.session_id,
            "screenRefs": list(self.screen_refs),
            "actorCursorLogRef": self.actor_cursor_log_ref,
            "inputQueueRef": self.input_queue_ref,
            "executorLeaseRefs": list(self.executor_lease_refs),
            "captureStreamRef": self.capture_stream_ref,
            "replayBundleRef": self.replay_bundle_ref,
            "manifestRef": self.manifest_ref,
            "resourceRefs": dict(self.resource_refs),
            "metadata": dict(self.metadata),
        })


@dataclass(frozen=True)
class VirtualScreen:
    screen_id: str
    display_group_id: str
    geometry: Mapping[str, Any]
    scale: float
    backend_binding_ref: str
    capture_source_ref: str
    window_namespace_ref: str
    resource_allocation_ref: str
    manifest_ref: str | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return _drop_none_values({
            "schemaVersion": VIRTUAL_SCREEN_SCHEMA,
            "screenId": self.screen_id,
            "displayGroupId": self.display_group_id,
            "geometry": dict(self.geometry),
            "scale": self.scale,
            "backendBindingRef": self.backend_binding_ref,
            "captureSourceRef": self.capture_source_ref,
            "windowNamespaceRef": self.window_namespace_ref,
            "resourceAllocationRef": self.resource_allocation_ref,
            "manifestRef": self.manifest_ref,
            "metadata": dict(self.metadata),
        })


@dataclass(frozen=True)
class ActorCursorEvent:
    event_id: str
    event_type: CursorEventKind
    actor_id: str
    cursor_id: str
    screen_id: str
    position: Mapping[str, Any]
    timestamp: str
    source: str
    window_id: str | None = None
    color: str | None = None
    label: str | None = None
    state: str | None = None
    refs: Sequence[str] = field(default_factory=tuple)
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return _drop_none_values({
            "schemaVersion": ACTOR_CURSOR_EVENT_SCHEMA,
            "eventId": self.event_id,
            "eventType": self.event_type,
            "actorId": self.actor_id,
            "cursorId": self.cursor_id,
            "screenId": self.screen_id,
            "windowId": self.window_id,
            "color": self.color,
            "label": self.label,
            "position": dict(self.position),
            "state": self.state,
            "timestamp": self.timestamp,
            "source": self.source,
            "refs": list(self.refs),
            "metadata": dict(self.metadata),
        })


@dataclass(frozen=True)
class ActorCursorLog:
    log_ref: str
    display_group_id: str
    screen_refs: Sequence[str]
    event_refs: Sequence[str] = field(default_factory=tuple)
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "schemaVersion": ACTOR_CURSOR_LOG_SCHEMA,
            "logRef": self.log_ref,
            "displayGroupId": self.display_group_id,
            "screenRefs": list(self.screen_refs),
            "eventRefs": list(self.event_refs),
            "metadata": dict(self.metadata),
        }


@dataclass(frozen=True)
class ActionProposal:
    proposal_id: str
    action_kind: str
    actor_id: str
    cursor_id: str
    target: Mapping[str, Any]
    risk_level: RiskLevel
    approval_state: ApprovalState
    lease_id: str | None = None
    executor_event_ref: str | None = None
    before_evidence_refs: Sequence[str] = field(default_factory=tuple)
    after_evidence_refs: Sequence[str] = field(default_factory=tuple)
    grounding_refs: Sequence[str] = field(default_factory=tuple)
    verification_refs: Sequence[str] = field(default_factory=tuple)
    approval_request_ref: str | None = None
    draft_ref: str | None = None
    audit_ref: str | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return _drop_none_values({
            "schemaVersion": ACTION_PROPOSAL_SCHEMA,
            "proposalId": self.proposal_id,
            "actionKind": self.action_kind,
            "actorId": self.actor_id,
            "cursorId": self.cursor_id,
            "target": dict(self.target),
            "riskLevel": self.risk_level,
            "approvalState": self.approval_state,
            "leaseId": self.lease_id,
            "executorEventRef": self.executor_event_ref,
            "beforeEvidenceRefs": list(self.before_evidence_refs),
            "afterEvidenceRefs": list(self.after_evidence_refs),
            "groundingRefs": list(self.grounding_refs),
            "verificationRefs": list(self.verification_refs),
            "approvalRequestRef": self.approval_request_ref,
            "draftRef": self.draft_ref,
            "auditRef": self.audit_ref,
            "metadata": dict(self.metadata),
        })


@dataclass(frozen=True)
class ScopedExecutorLease:
    lease_id: str
    scope: LeaseScope
    display_group_id: str
    screen_id: str
    owner_actor_id: str
    owner_cursor_id: str
    status: str
    lease_ref: str
    event_log_ref: str
    window_id: str | None = None
    acquired_at: str | None = None
    expires_at: str | None = None
    released_at: str | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return _drop_none_values({
            "schemaVersion": SCOPED_EXECUTOR_LEASE_SCHEMA,
            "leaseId": self.lease_id,
            "scope": self.scope,
            "displayGroupId": self.display_group_id,
            "screenId": self.screen_id,
            "windowId": self.window_id,
            "ownerActorId": self.owner_actor_id,
            "ownerCursorId": self.owner_cursor_id,
            "status": self.status,
            "leaseRef": self.lease_ref,
            "eventLogRef": self.event_log_ref,
            "acquiredAt": self.acquired_at,
            "expiresAt": self.expires_at,
            "releasedAt": self.released_at,
            "metadata": dict(self.metadata),
        })


@dataclass(frozen=True)
class ExecutorEvent:
    event_id: str
    action_kind: str
    lease_id: str
    actor_id: str
    cursor_id: str
    screen_id: str
    target: Mapping[str, Any]
    status: ExecutorEventStatus
    executor_command_ref: str
    before_evidence_refs: Sequence[str]
    after_evidence_refs: Sequence[str]
    grounding_refs: Sequence[str]
    verification_refs: Sequence[str]
    outcome_ref: str | None = None
    timestamp: str | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return _drop_none_values({
            "schemaVersion": EXECUTOR_EVENT_SCHEMA,
            "eventId": self.event_id,
            "actionKind": self.action_kind,
            "leaseId": self.lease_id,
            "actorId": self.actor_id,
            "cursorId": self.cursor_id,
            "screenId": self.screen_id,
            "target": dict(self.target),
            "status": self.status,
            "executorCommandRef": self.executor_command_ref,
            "outcomeRef": self.outcome_ref,
            "beforeEvidenceRefs": list(self.before_evidence_refs),
            "afterEvidenceRefs": list(self.after_evidence_refs),
            "groundingRefs": list(self.grounding_refs),
            "verificationRefs": list(self.verification_refs),
            "timestamp": self.timestamp,
            "metadata": dict(self.metadata),
        })


@dataclass(frozen=True)
class ReplayManifest:
    replay_id: str
    session_id: str
    display_group_ref: str
    frame_refs: Sequence[str]
    timeline_event_refs: Sequence[str]
    source_evidence_refs: Sequence[str]
    frames: Sequence[Mapping[str, Any]] = field(default_factory=tuple)
    manifest_ref: str | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return _drop_none_values({
            "schemaVersion": REPLAY_MANIFEST_SCHEMA,
            "replayId": self.replay_id,
            "sessionId": self.session_id,
            "displayGroupRef": self.display_group_ref,
            "frameRefs": list(self.frame_refs),
            "timelineEventRefs": list(self.timeline_event_refs),
            "sourceEvidenceRefs": list(self.source_evidence_refs),
            "frames": [dict(frame) for frame in self.frames],
            "manifestRef": self.manifest_ref,
            "metadata": dict(self.metadata),
        })


@dataclass(frozen=True)
class SessionPermission:
    session_id: str
    source: str
    session_permission_ref: str
    app_window_allowlist_ref: str
    allowed_app_refs: Sequence[str]
    allowed_window_refs: Sequence[str]
    forbidden_app_refs: Sequence[str]
    input_modality_policy: Mapping[str, Any]
    risk_preview_ref: str
    data_visibility_ref: str
    stop_ref: str
    cancel_lease_ref: str
    approval_mode: ApprovalMode
    user_confirmation_ref: str | None = None
    expires_at: str | None = None
    created_at: str | None = None
    thread_id: str | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return _drop_none_values({
            "schemaVersion": SESSION_PERMISSION_SCHEMA,
            "sessionId": self.session_id,
            "threadId": self.thread_id,
            "source": self.source,
            "sessionPermissionRef": self.session_permission_ref,
            "appWindowAllowlistRef": self.app_window_allowlist_ref,
            "allowedAppRefs": list(self.allowed_app_refs),
            "allowedWindowRefs": list(self.allowed_window_refs),
            "forbiddenAppRefs": list(self.forbidden_app_refs),
            "inputModalityPolicy": dict(self.input_modality_policy),
            "riskPreviewRef": self.risk_preview_ref,
            "dataVisibilityRef": self.data_visibility_ref,
            "stopRef": self.stop_ref,
            "cancelLeaseRef": self.cancel_lease_ref,
            "approvalMode": self.approval_mode,
            "userConfirmationRef": self.user_confirmation_ref,
            "expiresAt": self.expires_at,
            "createdAt": self.created_at,
            "metadata": dict(self.metadata),
        })


@dataclass(frozen=True)
class AppWindowAllowlist:
    session_id: str
    source: str
    app_window_allowlist_ref: str
    allowed_app_refs: Sequence[str]
    allowed_window_refs: Sequence[str]
    forbidden_app_refs: Sequence[str]
    user_confirmation_ref: str | None = None
    expires_at: str | None = None
    thread_id: str | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return _drop_none_values({
            "schemaVersion": APP_WINDOW_ALLOWLIST_SCHEMA,
            "sessionId": self.session_id,
            "threadId": self.thread_id,
            "source": self.source,
            "appWindowAllowlistRef": self.app_window_allowlist_ref,
            "allowedAppRefs": list(self.allowed_app_refs),
            "allowedWindowRefs": list(self.allowed_window_refs),
            "forbiddenAppRefs": list(self.forbidden_app_refs),
            "userConfirmationRef": self.user_confirmation_ref,
            "expiresAt": self.expires_at,
            "metadata": dict(self.metadata),
        })


@dataclass(frozen=True)
class RiskPreview:
    session_id: str
    source: str
    risk_preview_ref: str
    risk_level: RiskLevel
    risk_class: str
    approval_mode: ApprovalMode
    action_risk_refs: Sequence[str] = field(default_factory=tuple)
    user_confirmation_ref: str | None = None
    thread_id: str | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return _drop_none_values({
            "schemaVersion": RISK_PREVIEW_SCHEMA,
            "sessionId": self.session_id,
            "threadId": self.thread_id,
            "source": self.source,
            "riskPreviewRef": self.risk_preview_ref,
            "riskLevel": self.risk_level,
            "riskClass": self.risk_class,
            "approvalMode": self.approval_mode,
            "actionRiskRefs": list(self.action_risk_refs),
            "userConfirmationRef": self.user_confirmation_ref,
            "metadata": dict(self.metadata),
        })


@dataclass(frozen=True)
class DataVisibility:
    session_id: str
    source: str
    data_visibility_ref: str
    read_scope_refs: Sequence[str]
    input_scope_refs: Sequence[str]
    screenshot_ref_policy: str = "refs-only"
    inline_screenshots_allowed: bool = False
    provider_payload_allowed: bool = False
    visible_screen_refs: Sequence[str] = field(default_factory=tuple)
    visible_window_refs: Sequence[str] = field(default_factory=tuple)
    user_confirmation_ref: str | None = None
    thread_id: str | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return _drop_none_values({
            "schemaVersion": DATA_VISIBILITY_SCHEMA,
            "sessionId": self.session_id,
            "threadId": self.thread_id,
            "source": self.source,
            "dataVisibilityRef": self.data_visibility_ref,
            "readScopeRefs": list(self.read_scope_refs),
            "inputScopeRefs": list(self.input_scope_refs),
            "visibleScreenRefs": list(self.visible_screen_refs),
            "visibleWindowRefs": list(self.visible_window_refs),
            "screenshotRefPolicy": self.screenshot_ref_policy,
            "inlineScreenshotsAllowed": self.inline_screenshots_allowed,
            "providerPayloadAllowed": self.provider_payload_allowed,
            "userConfirmationRef": self.user_confirmation_ref,
            "metadata": dict(self.metadata),
        })


@dataclass(frozen=True)
class StopCancelLease:
    session_id: str
    source: str
    stop_ref: str
    cancel_lease_ref: str
    current_lease_cancellation_refs: Sequence[str]
    cancellation_mode: str = "lease-cancel-only"
    package_state_kill_allowed: bool = False
    active_lease_ref: str | None = None
    user_confirmation_ref: str | None = None
    thread_id: str | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return _drop_none_values({
            "schemaVersion": STOP_CANCEL_LEASE_SCHEMA,
            "sessionId": self.session_id,
            "threadId": self.thread_id,
            "source": self.source,
            "stopRef": self.stop_ref,
            "cancelLeaseRef": self.cancel_lease_ref,
            "currentLeaseCancellationRefs": list(self.current_lease_cancellation_refs),
            "cancellationMode": self.cancellation_mode,
            "packageStateKillAllowed": self.package_state_kill_allowed,
            "activeLeaseRef": self.active_lease_ref,
            "userConfirmationRef": self.user_confirmation_ref,
            "metadata": dict(self.metadata),
        })


@dataclass(frozen=True)
class ActionAdapterReadiness:
    adapter_id: str
    adapter_kind: str
    target_scope: str
    supported_actions: Sequence[str]
    capture_supported: bool
    background_renderable: bool
    affects_physical_display: bool
    requires_focus_steal: bool
    shared_system_input_used: bool
    schema_refs: Sequence[str]
    ready: bool = True
    blocked_reason: str | None = None
    readiness_ref: str | None = None
    capability_ref: str | None = None
    physical_popup_shown: bool = False
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        payload = _drop_none_values({
            "schemaVersion": ACTION_ADAPTER_READINESS_SCHEMA,
            "adapterId": self.adapter_id,
            "adapterKind": self.adapter_kind,
            "targetScope": self.target_scope,
            "supportedActions": list(self.supported_actions),
            "captureSupported": self.capture_supported,
            "backgroundRenderable": self.background_renderable,
            "affectsPhysicalDisplay": self.affects_physical_display,
            "requiresFocusSteal": self.requires_focus_steal,
            "sharedSystemInputUsed": self.shared_system_input_used,
            "physicalPopupShown": self.physical_popup_shown,
            "ready": self.ready,
            "readinessRef": self.readiness_ref,
            "capabilityRef": self.capability_ref,
            "schemaRefs": list(self.schema_refs),
            "metadata": dict(self.metadata),
        })
        payload["blockedReason"] = self.blocked_reason
        return payload


@dataclass(frozen=True)
class InputIntent:
    intent_id: str
    input_kind: VirtualAppScreenInputKind
    actor_id: str
    cursor_id: str
    screen_id: str
    target: Mapping[str, Any]
    input_lease_ref: str
    action_adapter_ref: str
    adapter_readiness_ref: str
    executor_event_ref: str
    before_after_frame_refs: Sequence[str]
    verification_refs: Sequence[str]
    before_frame_refs: Sequence[str] = field(default_factory=tuple)
    after_frame_refs: Sequence[str] = field(default_factory=tuple)
    proposal_ref: str | None = None
    timestamp: str | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return _drop_none_values({
            "schemaVersion": INPUT_INTENT_SCHEMA,
            "intentId": self.intent_id,
            "inputKind": self.input_kind,
            "actorId": self.actor_id,
            "cursorId": self.cursor_id,
            "screenId": self.screen_id,
            "target": dict(self.target),
            "inputLeaseRef": self.input_lease_ref,
            "actionAdapterRef": self.action_adapter_ref,
            "adapterReadinessRef": self.adapter_readiness_ref,
            "executorEventRef": self.executor_event_ref,
            "beforeAfterFrameRefs": list(self.before_after_frame_refs),
            "beforeFrameRefs": list(self.before_frame_refs),
            "afterFrameRefs": list(self.after_frame_refs),
            "verificationRefs": list(self.verification_refs),
            "proposalRef": self.proposal_ref,
            "timestamp": self.timestamp,
            "metadata": dict(self.metadata),
        })


@dataclass(frozen=True)
class AnnotationOverlay:
    overlay_id: str
    annotation_kind: AnnotationOverlayKind
    screen_id: str
    overlay_ref: str
    target_ref: str
    target_binding_kind: str
    proposal_ref: str
    action_ref: str
    verification_ref: str
    before_frame_ref: str
    after_frame_ref: str
    author_actor_id: str | None = None
    refs: Sequence[str] = field(default_factory=tuple)
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return _drop_none_values({
            "schemaVersion": ANNOTATION_OVERLAY_SCHEMA,
            "overlayId": self.overlay_id,
            "annotationKind": self.annotation_kind,
            "screenId": self.screen_id,
            "authorActorId": self.author_actor_id,
            "overlayRef": self.overlay_ref,
            "targetRef": self.target_ref,
            "targetBindingKind": self.target_binding_kind,
            "proposalRef": self.proposal_ref,
            "actionRef": self.action_ref,
            "verificationRef": self.verification_ref,
            "beforeFrameRef": self.before_frame_ref,
            "afterFrameRef": self.after_frame_ref,
            "refs": list(self.refs),
            "metadata": dict(self.metadata),
        })


@dataclass(frozen=True)
class VirtualAppScreenUserAcceptanceManifest:
    task_id: str
    scenario_id: str
    user_intent: str
    target_app_refs: Sequence[str]
    target_window_refs: Sequence[str]
    session_refs: Sequence[str]
    adapter_readiness_refs: Sequence[str]
    screen_frame_refs: Sequence[str]
    input_intent_refs: Sequence[str]
    executor_event_refs: Sequence[str]
    before_after_frame_refs: Sequence[str]
    annotation_proposal_refs: Sequence[str]
    artifact_refs: Sequence[str]
    verification_refs: Sequence[str]
    gui_present_refs: Sequence[str]
    replay_ref: str
    evidence_ledger_ref: str
    isolation_flags: Mapping[str, Any]
    status: VirtualAppScreenUserAcceptanceStatus = "passed"
    blocked_reason: str | None = None
    diagnostic_only: bool = False
    user_acceptance_eligible: bool | None = None
    approval_mode: ApprovalMode = "fail-closed"
    user_confirmation_ref: str | None = None
    source_boundary: str | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        payload = _drop_none_values({
            "schemaVersion": VIRTUAL_APP_SCREEN_USER_ACCEPTANCE_MANIFEST_SCHEMA,
            "taskId": self.task_id,
            "scenarioId": self.scenario_id,
            "userIntent": self.user_intent,
            "targetAppRefs": list(self.target_app_refs),
            "targetWindowRefs": list(self.target_window_refs),
            "sessionRefs": list(self.session_refs),
            "adapterReadinessRefs": list(self.adapter_readiness_refs),
            "screenFrameRefs": list(self.screen_frame_refs),
            "inputIntentRefs": list(self.input_intent_refs),
            "executorEventRefs": list(self.executor_event_refs),
            "beforeAfterFrameRefs": list(self.before_after_frame_refs),
            "annotationProposalRefs": list(self.annotation_proposal_refs),
            "artifactRefs": list(self.artifact_refs),
            "verificationRefs": list(self.verification_refs),
            "guiPresentRefs": list(self.gui_present_refs),
            "replayRef": self.replay_ref,
            "evidenceLedgerRef": self.evidence_ledger_ref,
            "isolationFlags": dict(self.isolation_flags),
            "status": self.status,
            "diagnosticOnly": self.diagnostic_only,
            "userAcceptanceEligible": self.user_acceptance_eligible,
            "approvalMode": self.approval_mode,
            "userConfirmationRef": self.user_confirmation_ref,
            "sourceBoundary": self.source_boundary,
            "metadata": dict(self.metadata),
        })
        payload["blockedReason"] = self.blocked_reason
        return payload


@dataclass(frozen=True)
class ApprovalRequest:
    id: str
    reason: str
    action_kind: str
    risk_level: RiskLevel
    blocked_action_index: int
    confirmation_text: str
    refs: Sequence[str] = field(default_factory=tuple)
    metadata: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Grounding:
    ok: bool
    x: float | None = None
    y: float | None = None
    coordinate_space: str = "observation"
    confidence: float | None = None
    reason: str = ""
    metadata: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ExecutionOutcome:
    ok: bool
    message: str = ""
    blocked: bool = False
    metadata: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Verification:
    ok: bool
    done: bool = False
    reason: str = ""
    confidence: float | None = None
    changed: bool | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class LoopStep:
    index: int
    before: Observation
    plan: ActionPlan
    grounding: Grounding | None = None
    execution: ExecutionOutcome | None = None
    after: Observation | None = None
    verification: Verification | None = None
    status: str = "planned"
    failure_reason: str | None = None
    budget_debit_refs: Sequence[str] = field(default_factory=tuple)


@dataclass(frozen=True)
class ComputerUseResult:
    status: ComputerUseStatus
    reason: str
    schema_version: str = RESULT_SCHEMA_VERSION
    steps: Sequence[LoopStep] = field(default_factory=tuple)
    final_observation: Observation | None = None
    final_artifact_refs: Sequence[str] = field(default_factory=tuple)
    approval_request: ApprovalRequest | None = None
    failure_diagnostics: Mapping[str, Any] = field(default_factory=dict)
    metrics: Mapping[str, Any] = field(default_factory=dict)
    trace_refs: Sequence[str] = field(default_factory=tuple)
    budget_debits: Sequence[Mapping[str, Any]] = field(default_factory=tuple)
    budget_debit_refs: Sequence[str] = field(default_factory=tuple)


class ComputerUseHostPorts(Protocol):
    def plan(
        self,
        request: ComputerUseRequest,
        observation: Observation,
        history: Sequence[LoopStep],
    ) -> ActionPlan | Mapping[str, Any]:
        """Return exactly one generic action or done=True."""

    def capture(
        self,
        request: ComputerUseRequest,
        history: Sequence[LoopStep],
        query: str | None = None,
    ) -> Observation | Mapping[str, Any]:
        """Capture the current target environment and return a file-ref observation."""

    def crop(
        self,
        observation: Observation,
        region: Mapping[str, Any],
    ) -> Observation | Mapping[str, Any]:
        """Create a focus-region observation from an existing screenshot ref."""

    def execute(
        self,
        action: ActionPlan,
        grounding: Grounding | None,
        request: ComputerUseRequest,
    ) -> ExecutionOutcome | Mapping[str, Any]:
        """Execute one generic action through the host-owned input adapter."""

    def locate(
        self,
        observation: Observation,
        target: ActionTarget,
        history: Sequence[LoopStep],
    ) -> Grounding | Mapping[str, Any]:
        """Locate a target description using host-injected sense or grounder providers."""

    def verify(
        self,
        request: ComputerUseRequest,
        before: Observation,
        after: Observation,
        action: ActionPlan,
        execution: ExecutionOutcome,
        history: Sequence[LoopStep],
    ) -> Verification | Mapping[str, Any]:
        """Verify action effect and task completion through host-injected verifier providers."""

    def write_trace(
        self,
        result: ComputerUseResult,
    ) -> str:
        """Persist a refs-first trace and return its durable ref."""

    def emit_event(
        self,
        event: Mapping[str, Any],
    ) -> None:
        """Emit a compact runtime event for the TUI Host."""


class SenseProvider(Protocol):
    def observe(
        self,
        request: ComputerUseRequest,
        history: Sequence[LoopStep],
        query: str | None = None,
    ) -> Observation | Mapping[str, Any]:
        """Return the current target observation using any available sense."""

    def query(
        self,
        observation: Observation,
        question: str,
        history: Sequence[LoopStep],
    ) -> Mapping[str, Any] | str:
        """Optional extra query against an existing observation."""

    def locate(
        self,
        observation: Observation,
        target: ActionTarget,
        history: Sequence[LoopStep],
    ) -> Grounding | Mapping[str, Any]:
        """Locate a target in the observation coordinate space."""


class ActionPlanner(Protocol):
    def plan(
        self,
        request: ComputerUseRequest,
        observation: Observation,
        history: Sequence[LoopStep],
    ) -> ActionPlan | Mapping[str, Any]:
        """Return one next generic GUI action or done=True."""


class GuiExecutor(Protocol):
    def execute(
        self,
        action: ActionPlan,
        grounding: Grounding | None,
        request: ComputerUseRequest,
    ) -> ExecutionOutcome | Mapping[str, Any]:
        """Execute one generic GUI action through a host adapter."""


class Verifier(Protocol):
    def verify(
        self,
        request: ComputerUseRequest,
        before: Observation,
        after: Observation,
        action: ActionPlan,
        execution: ExecutionOutcome,
        history: Sequence[LoopStep],
    ) -> Verification | Mapping[str, Any]:
        """Verify whether the action worked and whether the task is complete."""


MUTATING_GUI_ACTION_KINDS = {
    "app_switch",
    "click",
    "double_click",
    "drag",
    "focus",
    "global_hotkey",
    "hotkey",
    "open_app",
    "open_dropdown",
    "open_menu",
    "page_down",
    "page_up",
    "permission_confirm",
    "press_key",
    "save",
    "scroll",
    "switch_panel",
    "switch_tab",
    "switch_window",
    "type_text",
    "window_switch",
    "zoom",
}
READ_ONLY_CURSOR_ACTION_KINDS = {
    "annotate",
    "cursor_annotate",
    "cursor_move",
    "cursor_point",
    "move",
    "point",
    "presence",
}
READ_ONLY_EVIDENCE_ACTION_KINDS = {
    "crop",
    "ocr",
    "observe",
    "recapture",
    "region_detection",
    "vlm_compare",
    "vlm_describe",
    "wait",
    "wait_until_stable",
}
VIRTUAL_APP_SCREEN_ACCEPTANCE_STATUSES = {
    "passed",
    "blocked",
    "needs-confirmation",
    "requires-handoff",
    "diagnostic",
}
VIRTUAL_APP_SCREEN_INPUT_KINDS = {"click", "type_text", "drag", "scroll", "hotkey", "menu_command"}
ANNOTATION_OVERLAY_KINDS = {
    "point",
    "rectangle",
    "arrow",
    "highlight",
    "comment",
    "agent_cursor_trace",
    "rejected_target",
}
ANNOTATION_TARGET_BINDING_KINDS = {
    "window-region",
    "ax-element",
    "dom-element",
    "ocr-text-span",
    "visual-object",
    "artifact-file",
    "file-ref",
}
VIRTUAL_APP_SCREEN_USER_ACCEPTANCE_REF_LIST_FIELDS = (
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
)
DIAGNOSTIC_ONLY_ACCEPTANCE_SOURCES = {
    "browser-runtime-dom",
    "click-smoke",
    "diagnostic",
    "dom",
    "dom-shortcut",
    "docker-novnc",
    "fixture",
    "historical-docker-novnc",
    "legacy-m6",
    "m6",
    "m6-opt-in",
    "package-local-contract",
    "package-smoke",
    "shell-direct",
    "shell-direct-artifact-write",
    "shell-only",
    "single-click-smoke",
    "target-bound-fixture",
}
GLOBAL_COORDINATE_SPACES = {"absolute", "desktop", "display", "global", "host", "os"}
SESSION_COMPATIBILITY_FIELD_NAMES = {
    "display",
    "displayid",
    "displayref",
    "singledisplayref",
    "virtualdisplayref",
}
SAFE_NEGATIVE_DIAGNOSTIC_KEYS = {
    "inlineimagewritten",
    "rawpayloadwritten",
    "secretswritten",
}
FORBIDDEN_INLINE_PAYLOAD_KEYS = {
    "base64",
    "dataurl",
    "imagebase64",
    "inlineimage",
    "providerrawpayload",
    "rawcapture",
    "rawimage",
    "rawpayload",
    "rawproviderpayload",
    "rawscreenshot",
    "screenshotbase64",
    "screenshotdata",
}
SENSITIVE_VALUE_KEY_NAMES = {
    "apikey",
    "authorization",
    "credential",
    "credentials",
    "password",
    "secret",
    "token",
}
AUTHORIZATION_VALUE_RE = re.compile(r"\bauthorization\s*[:=]\s*(?:bearer|basic)?\s*[^\s,;}\]]+", re.IGNORECASE)
BEARER_VALUE_RE = re.compile(r"\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]+", re.IGNORECASE)
SECRET_ASSIGNMENT_VALUE_RE = re.compile(
    r"\b(?:api[_-]?key|access[_-]?key|refresh[_-]?token|token|secret|password|credential)s?\s*[:=]\s*[^\s,;}\]]+",
    re.IGNORECASE,
)
DATA_URL_VALUE_RE = re.compile(r"data:[^\s\"'<>]+", re.IGNORECASE)
BASE64_BLOB_VALUE_RE = re.compile(r"^[A-Za-z0-9+/]{80,}={0,2}$")


def validate_virtual_desktop_session_manifest(
    manifest_or_ref: Mapping[str, Any] | str | Path,
    *,
    require_existing_refs: bool = False,
) -> dict[str, Any]:
    return validate_multi_screen_contract(
        manifest_or_ref,
        expected_schema=VIRTUAL_DESKTOP_SESSION_MANIFEST_SCHEMA,
        require_existing_refs=require_existing_refs,
    )


def validate_virtual_display_group(
    manifest_or_ref: Mapping[str, Any] | str | Path,
    *,
    require_existing_refs: bool = False,
) -> dict[str, Any]:
    return validate_multi_screen_contract(
        manifest_or_ref,
        expected_schema=VIRTUAL_DISPLAY_GROUP_SCHEMA,
        require_existing_refs=require_existing_refs,
    )


def validate_virtual_screen(
    manifest_or_ref: Mapping[str, Any] | str | Path,
    *,
    require_existing_refs: bool = False,
) -> dict[str, Any]:
    return validate_multi_screen_contract(
        manifest_or_ref,
        expected_schema=VIRTUAL_SCREEN_SCHEMA,
        require_existing_refs=require_existing_refs,
    )


def validate_actor_cursor_event(
    event_or_ref: Mapping[str, Any] | str | Path,
    *,
    require_existing_refs: bool = False,
) -> dict[str, Any]:
    return validate_multi_screen_contract(
        event_or_ref,
        expected_schema=ACTOR_CURSOR_EVENT_SCHEMA,
        require_existing_refs=require_existing_refs,
    )


def validate_actor_cursor_log(
    log_or_ref: Mapping[str, Any] | str | Path,
    *,
    require_existing_refs: bool = False,
) -> dict[str, Any]:
    return validate_multi_screen_contract(
        log_or_ref,
        expected_schema=ACTOR_CURSOR_LOG_SCHEMA,
        require_existing_refs=require_existing_refs,
    )


def validate_action_proposal(
    proposal_or_ref: Mapping[str, Any] | str | Path,
    *,
    require_existing_refs: bool = False,
) -> dict[str, Any]:
    return validate_multi_screen_contract(
        proposal_or_ref,
        expected_schema=ACTION_PROPOSAL_SCHEMA,
        require_existing_refs=require_existing_refs,
    )


def validate_scoped_executor_lease(
    lease_or_ref: Mapping[str, Any] | str | Path,
    *,
    require_existing_refs: bool = False,
) -> dict[str, Any]:
    return validate_multi_screen_contract(
        lease_or_ref,
        expected_schema=SCOPED_EXECUTOR_LEASE_SCHEMA,
        require_existing_refs=require_existing_refs,
    )


def validate_executor_event(
    event_or_ref: Mapping[str, Any] | str | Path,
    *,
    require_existing_refs: bool = False,
) -> dict[str, Any]:
    return validate_multi_screen_contract(
        event_or_ref,
        expected_schema=EXECUTOR_EVENT_SCHEMA,
        require_existing_refs=require_existing_refs,
    )


def validate_replay_manifest(
    manifest_or_ref: Mapping[str, Any] | str | Path,
    *,
    require_existing_refs: bool = False,
) -> dict[str, Any]:
    return validate_multi_screen_contract(
        manifest_or_ref,
        expected_schema=REPLAY_MANIFEST_SCHEMA,
        require_existing_refs=require_existing_refs,
    )


def validate_session_permission(
    permission_or_ref: Mapping[str, Any] | str | Path,
    *,
    require_existing_refs: bool = False,
) -> dict[str, Any]:
    return validate_user_control_contract(
        permission_or_ref,
        expected_schema=SESSION_PERMISSION_SCHEMA,
        require_existing_refs=require_existing_refs,
    )


def validate_app_window_allowlist(
    allowlist_or_ref: Mapping[str, Any] | str | Path,
    *,
    require_existing_refs: bool = False,
) -> dict[str, Any]:
    return validate_user_control_contract(
        allowlist_or_ref,
        expected_schema=APP_WINDOW_ALLOWLIST_SCHEMA,
        require_existing_refs=require_existing_refs,
    )


def validate_risk_preview(
    preview_or_ref: Mapping[str, Any] | str | Path,
    *,
    require_existing_refs: bool = False,
) -> dict[str, Any]:
    return validate_user_control_contract(
        preview_or_ref,
        expected_schema=RISK_PREVIEW_SCHEMA,
        require_existing_refs=require_existing_refs,
    )


def validate_data_visibility(
    visibility_or_ref: Mapping[str, Any] | str | Path,
    *,
    require_existing_refs: bool = False,
) -> dict[str, Any]:
    return validate_user_control_contract(
        visibility_or_ref,
        expected_schema=DATA_VISIBILITY_SCHEMA,
        require_existing_refs=require_existing_refs,
    )


def validate_stop_cancel_lease(
    lease_or_ref: Mapping[str, Any] | str | Path,
    *,
    require_existing_refs: bool = False,
) -> dict[str, Any]:
    return validate_user_control_contract(
        lease_or_ref,
        expected_schema=STOP_CANCEL_LEASE_SCHEMA,
        require_existing_refs=require_existing_refs,
    )


def validate_user_control_contract(
    payload_or_ref: Mapping[str, Any] | str | Path,
    *,
    expected_schema: str | None = None,
    require_existing_refs: bool = False,
) -> dict[str, Any]:
    """Validate refs-first user-control sidecars for real Computer Use runs."""

    payload_ref: str | None = None
    try:
        payload = _load_contract_payload(payload_or_ref)
    except (OSError, json.JSONDecodeError, TypeError) as exc:
        return _user_control_validation_result(
            schema_version=None,
            payload_ref=str(payload_or_ref),
            errors=[_contract_error("payload_load_failed", f"User-control payload could not be loaded: {exc}.", "$")],
            warnings=[],
            refs=[],
            status="blocked",
        )
    if not isinstance(payload_or_ref, Mapping):
        payload_ref = str(payload_or_ref)

    schema_version = _string_or_none(payload.get("schemaVersion"))
    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    refs = _collect_ref_values(payload)

    if expected_schema and schema_version != expected_schema:
        errors.append(_contract_error(
            "unsupported_schema_version",
            "User-control schemaVersion does not match the expected schema.",
            "$.schemaVersion",
            expected=expected_schema,
            actual=schema_version,
        ))
    errors.extend(_security_issues(payload, require_existing_refs=require_existing_refs))

    if schema_version == SESSION_PERMISSION_SCHEMA:
        _validate_session_permission(payload, errors, require_existing_refs=require_existing_refs)
    elif schema_version == APP_WINDOW_ALLOWLIST_SCHEMA:
        _validate_app_window_allowlist(payload, errors, require_existing_refs=require_existing_refs)
    elif schema_version == RISK_PREVIEW_SCHEMA:
        _validate_risk_preview(payload, errors, require_existing_refs=require_existing_refs)
    elif schema_version == DATA_VISIBILITY_SCHEMA:
        _validate_data_visibility(payload, errors, require_existing_refs=require_existing_refs)
    elif schema_version == STOP_CANCEL_LEASE_SCHEMA:
        _validate_stop_cancel_lease(payload, errors, require_existing_refs=require_existing_refs)
    elif not expected_schema:
        errors.append(_contract_error(
            "unsupported_schema_version",
            "User-control schemaVersion is not a known Computer Use user-control schema.",
            "$.schemaVersion",
            actual=schema_version,
        ))

    return _user_control_validation_result(
        schema_version=schema_version,
        payload_ref=payload_ref,
        errors=errors,
        warnings=warnings,
        refs=refs,
        status="blocked" if errors else "accepted",
    )


def validate_user_level_mutating_evidence(
    evidence_or_ref: Mapping[str, Any] | str | Path,
    *,
    require_existing_refs: bool = False,
) -> dict[str, Any]:
    """Fail closed when user-level mutating evidence lacks user-control refs.

    This validator is intentionally independent from the diagnostic package
    harnesses. Callers use it only for evidence that wants to count as a real
    user-level mutating Computer Use run.
    """

    payload_ref: str | None = None
    try:
        evidence = _load_contract_payload(evidence_or_ref)
    except (OSError, json.JSONDecodeError, TypeError) as exc:
        return _user_control_validation_result(
            schema_version=None,
            payload_ref=str(evidence_or_ref),
            errors=[_contract_error("payload_load_failed", f"User-level evidence could not be loaded: {exc}.", "$")],
            warnings=[],
            refs=[],
            status="blocked",
            user_acceptance_eligible=False,
        )
    if not isinstance(evidence_or_ref, Mapping):
        payload_ref = str(evidence_or_ref)

    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    errors.extend(_security_issues(evidence, require_existing_refs=require_existing_refs))
    mutating = _evidence_has_mutating_gui_action(evidence)
    if mutating:
        _validate_user_level_required_refs(evidence, errors, require_existing_refs=require_existing_refs)
        _validate_user_level_control_fields(evidence, errors)
        _validate_user_confirmation_source(evidence, errors)
    else:
        warnings.append(_contract_warning(
            "no_mutating_gui_action_detected",
            "No mutating GUI action was detected; user-control acceptance refs were not required.",
            "$",
        ))

    return _user_control_validation_result(
        schema_version=USER_LEVEL_MUTATING_EVIDENCE_SCHEMA,
        payload_ref=payload_ref,
        errors=errors,
        warnings=warnings,
        refs=_collect_ref_values(evidence),
        status="blocked" if errors else "accepted",
        mutating_gui_action=mutating,
        user_acceptance_eligible=bool(mutating and not errors),
    )


def validate_action_adapter_readiness(
    readiness_or_ref: Mapping[str, Any] | str | Path,
    *,
    require_existing_refs: bool = False,
) -> dict[str, Any]:
    payload_ref: str | None = None
    try:
        readiness = _load_contract_payload(readiness_or_ref)
    except (OSError, json.JSONDecodeError, TypeError) as exc:
        return _virtual_app_screen_acceptance_validation_result(
            schema_version=None,
            payload_ref=str(readiness_or_ref),
            errors=[_contract_error("payload_load_failed", f"ActionAdapter readiness could not be loaded: {exc}.", "$")],
            warnings=[],
            refs=[],
            status="blocked",
            user_acceptance_eligible=False,
            diagnostic_only=True,
        )
    if not isinstance(readiness_or_ref, Mapping):
        payload_ref = str(readiness_or_ref)

    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    schema_version = _string_or_none(readiness.get("schemaVersion"))
    if schema_version != ACTION_ADAPTER_READINESS_SCHEMA:
        errors.append(_contract_error(
            "unsupported_schema_version",
            "ActionAdapter readiness schemaVersion is invalid.",
            "$.schemaVersion",
            expected=ACTION_ADAPTER_READINESS_SCHEMA,
            actual=schema_version,
        ))
    errors.extend(_security_issues(readiness, require_existing_refs=require_existing_refs))
    blockers = _ua_validate_action_adapter_readiness_payload(
        readiness,
        errors,
        require_existing_refs=require_existing_refs,
    )
    if blockers:
        warnings.append(_contract_warning(
            "adapter_not_user_acceptance_capable",
            "ActionAdapter readiness cannot satisfy isolated VirtualAppScreen user acceptance.",
            "$",
        ))

    status: VirtualAppScreenUserAcceptanceStatus = "passed" if not errors and not blockers else "requires-handoff"
    if errors and not blockers:
        status = "blocked"
    return _virtual_app_screen_acceptance_validation_result(
        schema_version=schema_version,
        payload_ref=payload_ref,
        errors=errors,
        warnings=warnings,
        refs=_collect_ref_values(readiness),
        status=status,
        user_acceptance_eligible=False,
        diagnostic_only=status != "passed",
        extra={"isolationBlockers": blockers, "isolatedBackgroundCapable": not errors and not blockers},
    )


def validate_input_intent(
    intent_or_ref: Mapping[str, Any] | str | Path,
    *,
    require_existing_refs: bool = False,
) -> dict[str, Any]:
    payload_ref: str | None = None
    try:
        intent = _load_contract_payload(intent_or_ref)
    except (OSError, json.JSONDecodeError, TypeError) as exc:
        return _virtual_app_screen_acceptance_validation_result(
            schema_version=None,
            payload_ref=str(intent_or_ref),
            errors=[_contract_error("payload_load_failed", f"InputIntent could not be loaded: {exc}.", "$")],
            warnings=[],
            refs=[],
            status="blocked",
            user_acceptance_eligible=False,
            diagnostic_only=True,
        )
    if not isinstance(intent_or_ref, Mapping):
        payload_ref = str(intent_or_ref)

    errors: list[dict[str, Any]] = []
    schema_version = _string_or_none(intent.get("schemaVersion"))
    if schema_version != INPUT_INTENT_SCHEMA:
        errors.append(_contract_error(
            "unsupported_schema_version",
            "InputIntent schemaVersion is invalid.",
            "$.schemaVersion",
            expected=INPUT_INTENT_SCHEMA,
            actual=schema_version,
        ))
    errors.extend(_security_issues(intent, require_existing_refs=require_existing_refs))
    _ua_validate_input_intent_payload(intent, errors, require_existing_refs=require_existing_refs)

    return _virtual_app_screen_acceptance_validation_result(
        schema_version=schema_version,
        payload_ref=payload_ref,
        errors=errors,
        warnings=[],
        refs=_collect_ref_values(intent),
        status="passed" if not errors else "blocked",
        user_acceptance_eligible=False,
        diagnostic_only=bool(errors),
    )


def validate_annotation_overlay(
    overlay_or_ref: Mapping[str, Any] | str | Path,
    *,
    require_existing_refs: bool = False,
) -> dict[str, Any]:
    payload_ref: str | None = None
    try:
        overlay = _load_contract_payload(overlay_or_ref)
    except (OSError, json.JSONDecodeError, TypeError) as exc:
        return _virtual_app_screen_acceptance_validation_result(
            schema_version=None,
            payload_ref=str(overlay_or_ref),
            errors=[_contract_error("payload_load_failed", f"Annotation overlay could not be loaded: {exc}.", "$")],
            warnings=[],
            refs=[],
            status="blocked",
            user_acceptance_eligible=False,
            diagnostic_only=True,
        )
    if not isinstance(overlay_or_ref, Mapping):
        payload_ref = str(overlay_or_ref)

    errors: list[dict[str, Any]] = []
    schema_version = _string_or_none(overlay.get("schemaVersion"))
    if schema_version != ANNOTATION_OVERLAY_SCHEMA:
        errors.append(_contract_error(
            "unsupported_schema_version",
            "Annotation overlay schemaVersion is invalid.",
            "$.schemaVersion",
            expected=ANNOTATION_OVERLAY_SCHEMA,
            actual=schema_version,
        ))
    errors.extend(_security_issues(overlay, require_existing_refs=require_existing_refs))
    _ua_validate_annotation_overlay_payload(overlay, errors, require_existing_refs=require_existing_refs)

    return _virtual_app_screen_acceptance_validation_result(
        schema_version=schema_version,
        payload_ref=payload_ref,
        errors=errors,
        warnings=[],
        refs=_collect_ref_values(overlay),
        status="passed" if not errors else "blocked",
        user_acceptance_eligible=False,
        diagnostic_only=bool(errors),
    )


def validate_virtual_app_screen_user_acceptance_manifest(
    manifest_or_ref: Mapping[str, Any] | str | Path,
    *,
    require_existing_refs: bool = False,
) -> dict[str, Any]:
    """Validate the refs-first VirtualAppScreen user-acceptance manifest.

    This gate is deliberately stricter than package smoke. Diagnostic fixtures,
    DOM shortcuts, shell-only artifacts, legacy M6 evidence, focus steal, shared
    system input, or physical display popups may be useful diagnostics, but they
    cannot claim userAcceptanceEligible=true.
    """

    payload_ref: str | None = None
    try:
        manifest = _load_contract_payload(manifest_or_ref)
    except (OSError, json.JSONDecodeError, TypeError) as exc:
        return _virtual_app_screen_acceptance_validation_result(
            schema_version=None,
            payload_ref=str(manifest_or_ref),
            errors=[_contract_error("payload_load_failed", f"User-acceptance manifest could not be loaded: {exc}.", "$")],
            warnings=[],
            refs=[],
            status="blocked",
            user_acceptance_eligible=False,
            diagnostic_only=True,
        )
    if not isinstance(manifest_or_ref, Mapping):
        payload_ref = str(manifest_or_ref)

    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    schema_version = _string_or_none(manifest.get("schemaVersion"))
    if schema_version != VIRTUAL_APP_SCREEN_USER_ACCEPTANCE_MANIFEST_SCHEMA:
        errors.append(_contract_error(
            "unsupported_schema_version",
            "VirtualAppScreen user-acceptance manifest schemaVersion is invalid.",
            "$.schemaVersion",
            expected=VIRTUAL_APP_SCREEN_USER_ACCEPTANCE_MANIFEST_SCHEMA,
            actual=schema_version,
        ))
    errors.extend(_security_issues(manifest, require_existing_refs=require_existing_refs))

    declared_status = _ua_validate_acceptance_status(manifest.get("status"), errors)
    if declared_status is None:
        declared_status = "blocked"
    _require_string(manifest, "taskId", "$.taskId", errors)
    _require_string(manifest, "scenarioId", "$.scenarioId", errors)
    _require_string(manifest, "userIntent", "$.userIntent", errors)
    _require_ref(manifest, "replayRef", "$.replayRef", errors, require_existing_refs=require_existing_refs)
    _require_ref(manifest, "evidenceLedgerRef", "$.evidenceLedgerRef", errors, require_existing_refs=require_existing_refs)
    if "blockedReason" not in manifest:
        errors.append(_contract_error("blocked_reason_field_missing", "blockedReason must be present; use null only when not blocked.", "$.blockedReason"))
    _require_declared_optional_string(manifest, "blockedReason", "$.blockedReason", errors)

    refs_by_key: dict[str, list[str]] = {}
    for key in VIRTUAL_APP_SCREEN_USER_ACCEPTANCE_REF_LIST_FIELDS:
        refs_by_key[key] = _require_ref_list(
            manifest,
            key,
            f"$.{key}",
            errors,
            require_existing_refs=require_existing_refs,
            min_count=0,
        )

    isolation_blockers = _ua_validate_virtual_app_screen_isolation_flags(manifest.get("isolationFlags"), errors)
    diagnostic_markers = _ua_diagnostic_acceptance_markers(manifest)
    pass_missing_ref_keys = _ua_pass_missing_ref_keys(refs_by_key)
    requires_confirmation = _ua_acceptance_requires_confirmation(manifest)
    diagnostic_only = _bool_or_none(manifest.get("diagnosticOnly")) is True or bool(diagnostic_markers)
    user_acceptance_claim = _bool_or_none(manifest.get("userAcceptanceEligible"))
    if "diagnosticOnly" in manifest and _bool_or_none(manifest.get("diagnosticOnly")) is None:
        errors.append(_contract_error("required_bool_invalid", "diagnosticOnly must be a boolean when present.", "$.diagnosticOnly"))
    if "userAcceptanceEligible" in manifest and user_acceptance_claim is None:
        errors.append(_contract_error(
            "required_bool_invalid",
            "userAcceptanceEligible must be a boolean when present.",
            "$.userAcceptanceEligible",
        ))

    effective_status = _ua_derive_user_acceptance_status(
        declared_status=declared_status,
        diagnostic_only=diagnostic_only,
        isolation_blockers=isolation_blockers,
        requires_confirmation=requires_confirmation,
        pass_missing_ref_keys=pass_missing_ref_keys,
    )
    _ua_validate_acceptance_boundary_consistency(
        manifest,
        errors,
        declared_status=declared_status,
        effective_status=effective_status,
        diagnostic_markers=diagnostic_markers,
        isolation_blockers=isolation_blockers,
        pass_missing_ref_keys=pass_missing_ref_keys,
        requires_confirmation=requires_confirmation,
        user_acceptance_claim=user_acceptance_claim,
    )

    return _virtual_app_screen_acceptance_validation_result(
        schema_version=schema_version,
        payload_ref=payload_ref,
        errors=errors,
        warnings=warnings,
        refs=_collect_ref_values(manifest),
        status=effective_status,
        user_acceptance_eligible=not errors and effective_status == "passed",
        diagnostic_only=diagnostic_only or effective_status == "diagnostic",
        extra={
            "declaredStatus": declared_status,
            "diagnosticSourceMarkers": diagnostic_markers,
            "isolationBlockers": isolation_blockers,
            "passMissingRefKeys": pass_missing_ref_keys,
            "requiresConfirmation": requires_confirmation,
        },
    )


def validate_multi_screen_contract(
    payload_or_ref: Mapping[str, Any] | str | Path,
    *,
    expected_schema: str | None = None,
    require_existing_refs: bool = False,
) -> dict[str, Any]:
    """Validate refs-first multi-screen actor-cursor Computer Use contracts.

    The validator is deliberately fail-closed: legacy single-display fields,
    raw screenshots, inline base64, secrets, bare global coordinates, and
    mutating executor actions without a scoped lease are validation errors.
    """

    payload_ref: str | None = None
    try:
        payload = _load_contract_payload(payload_or_ref)
    except (OSError, json.JSONDecodeError, TypeError) as exc:
        return _validation_result(
            schema_version=None,
            payload_ref=str(payload_or_ref),
            errors=[_contract_error("payload_load_failed", f"Contract payload could not be loaded: {exc}.", "$")],
            warnings=[],
            refs=[],
            mutating_gui_action=None,
        )
    if not isinstance(payload_or_ref, Mapping):
        payload_ref = str(payload_or_ref)

    schema_version = _string_or_none(payload.get("schemaVersion"))
    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    refs = _collect_ref_values(payload)

    if expected_schema and schema_version != expected_schema:
        errors.append(_contract_error(
            "unsupported_schema_version",
            "Contract schemaVersion does not match the expected schema.",
            "$.schemaVersion",
            expected=expected_schema,
            actual=schema_version,
        ))
    errors.extend(_security_issues(payload, require_existing_refs=require_existing_refs))

    mutating_gui_action: bool | None = None
    if schema_version == VIRTUAL_DESKTOP_SESSION_MANIFEST_SCHEMA:
        _validate_session_manifest(payload, errors, warnings, require_existing_refs=require_existing_refs)
    elif schema_version == VIRTUAL_DISPLAY_GROUP_SCHEMA:
        _validate_display_group(payload, errors, require_existing_refs=require_existing_refs)
    elif schema_version == VIRTUAL_SCREEN_SCHEMA:
        _validate_screen(payload, errors, require_existing_refs=require_existing_refs)
    elif schema_version == ACTOR_CURSOR_EVENT_SCHEMA:
        mutating_gui_action = _validate_actor_cursor_event(payload, errors, require_existing_refs=require_existing_refs)
    elif schema_version == ACTOR_CURSOR_LOG_SCHEMA:
        _validate_actor_cursor_log(payload, errors, require_existing_refs=require_existing_refs)
    elif schema_version == ACTION_PROPOSAL_SCHEMA:
        mutating_gui_action = _validate_action_proposal(payload, errors, require_existing_refs=require_existing_refs)
    elif schema_version == SCOPED_EXECUTOR_LEASE_SCHEMA:
        _validate_scoped_executor_lease(payload, errors, require_existing_refs=require_existing_refs)
    elif schema_version == EXECUTOR_EVENT_SCHEMA:
        mutating_gui_action = _validate_executor_event(payload, errors, require_existing_refs=require_existing_refs)
    elif schema_version == REPLAY_MANIFEST_SCHEMA:
        _validate_replay_manifest(payload, errors, require_existing_refs=require_existing_refs)
    elif schema_version in {
        SESSION_PERMISSION_SCHEMA,
        APP_WINDOW_ALLOWLIST_SCHEMA,
        RISK_PREVIEW_SCHEMA,
        DATA_VISIBILITY_SCHEMA,
        STOP_CANCEL_LEASE_SCHEMA,
    }:
        if schema_version == SESSION_PERMISSION_SCHEMA:
            _validate_session_permission(payload, errors, require_existing_refs=require_existing_refs)
        elif schema_version == APP_WINDOW_ALLOWLIST_SCHEMA:
            _validate_app_window_allowlist(payload, errors, require_existing_refs=require_existing_refs)
        elif schema_version == RISK_PREVIEW_SCHEMA:
            _validate_risk_preview(payload, errors, require_existing_refs=require_existing_refs)
        elif schema_version == DATA_VISIBILITY_SCHEMA:
            _validate_data_visibility(payload, errors, require_existing_refs=require_existing_refs)
        elif schema_version == STOP_CANCEL_LEASE_SCHEMA:
            _validate_stop_cancel_lease(payload, errors, require_existing_refs=require_existing_refs)
    elif not expected_schema:
        errors.append(_contract_error(
            "unsupported_schema_version",
            "Contract schemaVersion is not a known Computer Use multi-screen schema.",
            "$.schemaVersion",
            actual=schema_version,
        ))

    return _validation_result(
        schema_version=schema_version,
        payload_ref=payload_ref,
        errors=errors,
        warnings=warnings,
        refs=refs,
        mutating_gui_action=mutating_gui_action,
    )


def action_kind_mutates_gui(action_kind: str | None) -> bool:
    normalized = _normalize_action_kind(action_kind)
    if not normalized or normalized in READ_ONLY_CURSOR_ACTION_KINDS or normalized in READ_ONLY_EVIDENCE_ACTION_KINDS:
        return False
    return normalized in MUTATING_GUI_ACTION_KINDS


def cursor_event_mutates_gui(event_type: str | None) -> bool:
    normalized = _normalize_action_kind(event_type)
    return normalized in MUTATING_GUI_ACTION_KINDS


def _validate_session_manifest(
    payload: Mapping[str, Any],
    errors: list[dict[str, Any]],
    warnings: list[dict[str, Any]],
    *,
    require_existing_refs: bool,
) -> None:
    _require_string(payload, "sessionId", "$.sessionId", errors)
    _require_ref(payload, "displayGroupRef", "$.displayGroupRef", errors, require_existing_refs=require_existing_refs)
    _require_ref_list(payload, "screenRefs", "$.screenRefs", errors, require_existing_refs=require_existing_refs, min_count=1)
    _require_ref(payload, "actorCursorLogRef", "$.actorCursorLogRef", errors, require_existing_refs=require_existing_refs)
    _require_ref(payload, "inputQueueRef", "$.inputQueueRef", errors, require_existing_refs=require_existing_refs)
    _require_ref_list(payload, "executorLeaseRefs", "$.executorLeaseRefs", errors, require_existing_refs=require_existing_refs, min_count=0)
    _require_ref(payload, "captureStreamRef", "$.captureStreamRef", errors, require_existing_refs=require_existing_refs)
    _require_ref(payload, "replayBundleRef", "$.replayBundleRef", errors, require_existing_refs=require_existing_refs)
    _require_ref(payload, "sessionPermissionRef", "$.sessionPermissionRef", errors, require_existing_refs=require_existing_refs)
    _require_ref(payload, "appWindowAllowlistRef", "$.appWindowAllowlistRef", errors, require_existing_refs=require_existing_refs)
    _require_ref_list(payload, "allowedAppRefs", "$.allowedAppRefs", errors, require_existing_refs=require_existing_refs, min_count=0)
    _require_ref_list(payload, "allowedWindowRefs", "$.allowedWindowRefs", errors, require_existing_refs=require_existing_refs, min_count=0)
    _require_ref_list(payload, "forbiddenAppRefs", "$.forbiddenAppRefs", errors, require_existing_refs=require_existing_refs, min_count=0)
    _validate_input_modality_policy(payload.get("inputModalityPolicy"), errors, "$.inputModalityPolicy")
    _require_ref(payload, "riskPreviewRef", "$.riskPreviewRef", errors, require_existing_refs=require_existing_refs)
    _require_ref(payload, "dataVisibilityRef", "$.dataVisibilityRef", errors, require_existing_refs=require_existing_refs)
    _require_ref(payload, "stopRef", "$.stopRef", errors, require_existing_refs=require_existing_refs)
    _require_ref(payload, "cancelLeaseRef", "$.cancelLeaseRef", errors, require_existing_refs=require_existing_refs)
    _validate_approval_mode(payload.get("approvalMode"), errors, "$.approvalMode")
    _require_isolation_flags_false(payload, errors)
    legacy_fields = [
        key
        for key in payload
        if _normalized_key(key) in SESSION_COMPATIBILITY_FIELD_NAMES
    ]
    compatibility_projection = _mapping(payload.get("compatibilityProjection"))
    legacy_projection_fields = [
        key
        for key in compatibility_projection
        if _normalized_key(key) in SESSION_COMPATIBILITY_FIELD_NAMES
    ]
    for key in legacy_fields:
        warnings.append(_contract_warning(
            "legacy_single_display_projection",
            "Legacy single-display fields are compatibility projections only.",
            f"$.{key}",
        ))
    for key in legacy_projection_fields:
        warnings.append(_contract_warning(
            "legacy_single_display_projection",
            "Legacy single-display projection is tolerated but cannot satisfy multi-screen identity.",
            f"$.compatibilityProjection.{key}",
        ))


def _validate_display_group(
    payload: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    require_existing_refs: bool,
) -> None:
    _require_string(payload, "displayGroupId", "$.displayGroupId", errors)
    _require_string(payload, "sessionId", "$.sessionId", errors)
    _require_ref_list(payload, "screenRefs", "$.screenRefs", errors, require_existing_refs=require_existing_refs, min_count=1)
    _require_ref(payload, "actorCursorLogRef", "$.actorCursorLogRef", errors, require_existing_refs=require_existing_refs)
    _require_ref(payload, "inputQueueRef", "$.inputQueueRef", errors, require_existing_refs=require_existing_refs)
    _require_ref_list(payload, "executorLeaseRefs", "$.executorLeaseRefs", errors, require_existing_refs=require_existing_refs, min_count=0)
    _require_ref(payload, "captureStreamRef", "$.captureStreamRef", errors, require_existing_refs=require_existing_refs)
    _require_ref(payload, "replayBundleRef", "$.replayBundleRef", errors, require_existing_refs=require_existing_refs)
    coordinate_space = _string_or_none(payload.get("coordinateSpace"))
    if coordinate_space and coordinate_space.strip().lower() in GLOBAL_COORDINATE_SPACES:
        errors.append(_contract_error(
            "global_coordinate_space_forbidden",
            "VirtualDisplayGroup cannot declare one shared ambiguous global coordinate space.",
            "$.coordinateSpace",
            actual=coordinate_space,
        ))


def _validate_screen(
    payload: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    require_existing_refs: bool,
) -> None:
    _require_string(payload, "screenId", "$.screenId", errors)
    _require_string(payload, "displayGroupId", "$.displayGroupId", errors)
    geometry = _mapping(payload.get("geometry"))
    if not geometry:
        errors.append(_contract_error("geometry_missing", "VirtualScreen geometry is required.", "$.geometry"))
    else:
        width = _number_or_none(geometry.get("width"))
        height = _number_or_none(geometry.get("height"))
        if width is None or width <= 0:
            errors.append(_contract_error("screen_width_invalid", "VirtualScreen geometry.width must be positive.", "$.geometry.width"))
        if height is None or height <= 0:
            errors.append(_contract_error("screen_height_invalid", "VirtualScreen geometry.height must be positive.", "$.geometry.height"))
        coordinate_space = _string_or_none(geometry.get("coordinateSpace"))
        if coordinate_space and coordinate_space.strip().lower() in GLOBAL_COORDINATE_SPACES:
            errors.append(_contract_error(
                "global_coordinate_space_forbidden",
                "VirtualScreen geometry cannot be declared as global coordinates.",
                "$.geometry.coordinateSpace",
                actual=coordinate_space,
            ))
    scale = _number_or_none(payload.get("scale", geometry.get("scale") if geometry else None))
    if scale is None or scale <= 0:
        errors.append(_contract_error("screen_scale_invalid", "VirtualScreen scale must be positive.", "$.scale"))
    for key in ("backendBindingRef", "captureSourceRef", "windowNamespaceRef", "resourceAllocationRef"):
        _require_ref(payload, key, f"$.{key}", errors, require_existing_refs=require_existing_refs)


def _validate_actor_cursor_event(
    payload: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    require_existing_refs: bool,
) -> bool:
    _require_string(payload, "eventId", "$.eventId", errors)
    event_type = _require_string(payload, "eventType", "$.eventType", errors)
    _require_string(payload, "actorId", "$.actorId", errors)
    _require_string(payload, "cursorId", "$.cursorId", errors)
    screen_id = _require_string(payload, "screenId", "$.screenId", errors)
    _require_string(payload, "timestamp", "$.timestamp", errors)
    _require_string(payload, "source", "$.source", errors)
    _require_ref_list(payload, "refs", "$.refs", errors, require_existing_refs=require_existing_refs, min_count=0)
    if cursor_event_mutates_gui(event_type):
        errors.append(_contract_error(
            "cursor_event_cannot_mutate_gui",
            "ActorCursor events can move, point, annotate, or propose intent; GUI mutation must use ActionProposal and ExecutorEvent.",
            "$.eventType",
            actual=event_type,
        ))
    position = _mapping(payload.get("position"))
    if not position:
        errors.append(_contract_error("cursor_position_missing", "ActorCursor event position is required.", "$.position"))
    else:
        _validate_position(position, errors, "$.position", required_screen_id=screen_id)
    return False


def _validate_actor_cursor_log(
    payload: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    require_existing_refs: bool,
) -> None:
    _require_ref(payload, "logRef", "$.logRef", errors, require_existing_refs=require_existing_refs)
    _require_string(payload, "displayGroupId", "$.displayGroupId", errors)
    _require_ref_list(payload, "screenRefs", "$.screenRefs", errors, require_existing_refs=require_existing_refs, min_count=1)
    _require_ref_list(payload, "eventRefs", "$.eventRefs", errors, require_existing_refs=require_existing_refs, min_count=0)


def _validate_action_proposal(
    payload: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    require_existing_refs: bool,
) -> bool:
    _require_string(payload, "proposalId", "$.proposalId", errors)
    action_kind = _string_or_none(payload.get("actionKind")) or _string_or_none(payload.get("kind"))
    if not action_kind:
        errors.append(_contract_error("action_kind_missing", "ActionProposal actionKind is required.", "$.actionKind"))
    _require_string(payload, "actorId", "$.actorId", errors)
    _require_string(payload, "cursorId", "$.cursorId", errors)
    _require_string(payload, "riskLevel", "$.riskLevel", errors)
    approval_state = _require_string(payload, "approvalState", "$.approvalState", errors)
    target = _mapping(payload.get("target"))
    if not target:
        errors.append(_contract_error("target_missing", "ActionProposal target is required.", "$.target"))
    mutating = action_kind_mutates_gui(action_kind)
    _validate_action_target(target, errors, "$.target", require_screen=mutating or bool(action_kind), require_window=mutating)
    _validate_top_level_coordinate_leaks(payload, errors)
    if mutating:
        _require_string(payload, "leaseId", "$.leaseId", errors, code="executor_lease_missing")
        _require_ref(payload, "executorEventRef", "$.executorEventRef", errors, require_existing_refs=require_existing_refs)
        _require_ref_list(payload, "beforeEvidenceRefs", "$.beforeEvidenceRefs", errors, require_existing_refs=require_existing_refs, min_count=1)
        _require_ref_list(payload, "afterEvidenceRefs", "$.afterEvidenceRefs", errors, require_existing_refs=require_existing_refs, min_count=1)
        _require_ref_list(payload, "groundingRefs", "$.groundingRefs", errors, require_existing_refs=require_existing_refs, min_count=1)
        _require_ref_list(payload, "verificationRefs", "$.verificationRefs", errors, require_existing_refs=require_existing_refs, min_count=1)
        if action_kind and action_kind.strip().lower() in {"global_hotkey", "app_switch", "window_switch"}:
            scope = _string_or_none(target.get("scope"))
            if scope != "screen":
                errors.append(_contract_error(
                    "screen_global_action_requires_screen_scope",
                    "Screen-global actions must target a screen lease scope.",
                    "$.target.scope",
                    expected="screen",
                    actual=scope,
                ))
        if _normalize_action_kind(action_kind) in MUTATING_GUI_ACTION_KINDS and approval_state == "needs-confirmation":
            if not any(_safe_ref_or_none(payload.get(key)) for key in ("approvalRequestRef", "draftRef", "auditRef")):
                errors.append(_contract_error(
                    "approval_ref_missing",
                    "A needs-confirmation mutating proposal must carry an approval, draft, or audit ref.",
                    "$.approvalRequestRef",
                ))
    return mutating


def _validate_scoped_executor_lease(
    payload: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    require_existing_refs: bool,
) -> None:
    _require_string(payload, "leaseId", "$.leaseId", errors)
    scope = _require_string(payload, "scope", "$.scope", errors)
    if scope and scope not in {"screen", "window"}:
        errors.append(_contract_error("lease_scope_invalid", "ScopedExecutorLease scope must be screen or window.", "$.scope", actual=scope))
    _require_string(payload, "displayGroupId", "$.displayGroupId", errors)
    _require_string(payload, "screenId", "$.screenId", errors)
    if scope == "window":
        _require_string(payload, "windowId", "$.windowId", errors)
    _require_string(payload, "ownerActorId", "$.ownerActorId", errors)
    _require_string(payload, "ownerCursorId", "$.ownerCursorId", errors)
    _require_string(payload, "status", "$.status", errors)
    _require_ref(payload, "leaseRef", "$.leaseRef", errors, require_existing_refs=require_existing_refs)
    _require_ref(payload, "eventLogRef", "$.eventLogRef", errors, require_existing_refs=require_existing_refs)


def _validate_executor_event(
    payload: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    require_existing_refs: bool,
) -> bool:
    _require_string(payload, "eventId", "$.eventId", errors)
    action_kind = _require_string(payload, "actionKind", "$.actionKind", errors)
    _require_string(payload, "leaseId", "$.leaseId", errors, code="executor_lease_missing")
    _require_string(payload, "actorId", "$.actorId", errors)
    _require_string(payload, "cursorId", "$.cursorId", errors)
    screen_id = _require_string(payload, "screenId", "$.screenId", errors)
    _require_string(payload, "status", "$.status", errors)
    target = _mapping(payload.get("target"))
    if not target:
        errors.append(_contract_error("target_missing", "ExecutorEvent target is required.", "$.target"))
    mutating = action_kind_mutates_gui(action_kind)
    _validate_action_target(target, errors, "$.target", require_screen=True, require_window=mutating, expected_screen_id=screen_id)
    _validate_top_level_coordinate_leaks(payload, errors)
    if mutating:
        _require_ref(payload, "executorCommandRef", "$.executorCommandRef", errors, require_existing_refs=require_existing_refs)
        _require_ref_list(payload, "beforeEvidenceRefs", "$.beforeEvidenceRefs", errors, require_existing_refs=require_existing_refs, min_count=1)
        _require_ref_list(payload, "afterEvidenceRefs", "$.afterEvidenceRefs", errors, require_existing_refs=require_existing_refs, min_count=1)
        _require_ref_list(payload, "groundingRefs", "$.groundingRefs", errors, require_existing_refs=require_existing_refs, min_count=1)
        _require_ref_list(payload, "verificationRefs", "$.verificationRefs", errors, require_existing_refs=require_existing_refs, min_count=1)
    return mutating


def _validate_replay_manifest(
    payload: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    require_existing_refs: bool,
) -> None:
    _require_string(payload, "replayId", "$.replayId", errors)
    _require_string(payload, "sessionId", "$.sessionId", errors)
    _require_ref(payload, "displayGroupRef", "$.displayGroupRef", errors, require_existing_refs=require_existing_refs)
    _require_ref_list(payload, "frameRefs", "$.frameRefs", errors, require_existing_refs=require_existing_refs, min_count=0)
    _require_ref_list(payload, "timelineEventRefs", "$.timelineEventRefs", errors, require_existing_refs=require_existing_refs, min_count=0)
    _require_ref_list(payload, "sourceEvidenceRefs", "$.sourceEvidenceRefs", errors, require_existing_refs=require_existing_refs, min_count=1)
    frames = payload.get("frames")
    if frames is not None and not isinstance(frames, list):
        errors.append(_contract_error("replay_frames_invalid", "ReplayManifest frames must be a list when present.", "$.frames"))
    for index, frame in enumerate(frames or []):
        if not isinstance(frame, Mapping):
            errors.append(_contract_error("replay_frame_invalid", "ReplayManifest frame must be an object.", f"$.frames[{index}]"))
            continue
        frame_path = f"$.frames[{index}]"
        _require_string(frame, "screenId", f"{frame_path}.screenId", errors)
        screenshot_ref = _require_ref(frame, "screenshotRef", f"{frame_path}.screenshotRef", errors, require_existing_refs=require_existing_refs)
        if screenshot_ref and screenshot_ref.strip().lower().startswith("placeholder:"):
            errors.append(_contract_error(
                "placeholder_frame_ref_forbidden",
                "Replay frame screenshotRef cannot be placeholder-only evidence.",
                f"{frame_path}.screenshotRef",
            ))
        _require_ref_list(frame, "cursorOverlayRefs", f"{frame_path}.cursorOverlayRefs", errors, require_existing_refs=require_existing_refs, min_count=0)
        _require_ref_list(frame, "inputEventRefs", f"{frame_path}.inputEventRefs", errors, require_existing_refs=require_existing_refs, min_count=0)
        _require_ref_list(frame, "sourceEvidenceRefs", f"{frame_path}.sourceEvidenceRefs", errors, require_existing_refs=require_existing_refs, min_count=1)


def _validate_session_permission(
    payload: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    require_existing_refs: bool,
) -> None:
    _require_string(payload, "sessionId", "$.sessionId", errors)
    _require_string(payload, "source", "$.source", errors)
    _require_ref(payload, "sessionPermissionRef", "$.sessionPermissionRef", errors, require_existing_refs=require_existing_refs)
    _require_ref(payload, "appWindowAllowlistRef", "$.appWindowAllowlistRef", errors, require_existing_refs=require_existing_refs)
    _require_ref_list(payload, "allowedAppRefs", "$.allowedAppRefs", errors, require_existing_refs=require_existing_refs, min_count=0)
    _require_ref_list(payload, "allowedWindowRefs", "$.allowedWindowRefs", errors, require_existing_refs=require_existing_refs, min_count=0)
    _require_ref_list(payload, "forbiddenAppRefs", "$.forbiddenAppRefs", errors, require_existing_refs=require_existing_refs, min_count=0)
    _validate_input_modality_policy(payload.get("inputModalityPolicy"), errors, "$.inputModalityPolicy")
    _require_ref(payload, "riskPreviewRef", "$.riskPreviewRef", errors, require_existing_refs=require_existing_refs)
    _require_ref(payload, "dataVisibilityRef", "$.dataVisibilityRef", errors, require_existing_refs=require_existing_refs)
    _require_ref(payload, "stopRef", "$.stopRef", errors, require_existing_refs=require_existing_refs)
    _require_ref(payload, "cancelLeaseRef", "$.cancelLeaseRef", errors, require_existing_refs=require_existing_refs)
    _validate_approval_mode(payload.get("approvalMode"), errors, "$.approvalMode")
    _require_optional_user_confirmation_ref(payload, errors, require_existing_refs=require_existing_refs)


def _validate_app_window_allowlist(
    payload: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    require_existing_refs: bool,
) -> None:
    _require_string(payload, "sessionId", "$.sessionId", errors)
    _require_string(payload, "source", "$.source", errors)
    _require_ref(payload, "appWindowAllowlistRef", "$.appWindowAllowlistRef", errors, require_existing_refs=require_existing_refs)
    _require_ref_list(payload, "allowedAppRefs", "$.allowedAppRefs", errors, require_existing_refs=require_existing_refs, min_count=0)
    _require_ref_list(payload, "allowedWindowRefs", "$.allowedWindowRefs", errors, require_existing_refs=require_existing_refs, min_count=0)
    _require_ref_list(payload, "forbiddenAppRefs", "$.forbiddenAppRefs", errors, require_existing_refs=require_existing_refs, min_count=0)
    _require_optional_user_confirmation_ref(payload, errors, require_existing_refs=require_existing_refs)


def _validate_risk_preview(
    payload: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    require_existing_refs: bool,
) -> None:
    _require_string(payload, "sessionId", "$.sessionId", errors)
    _require_string(payload, "source", "$.source", errors)
    _require_ref(payload, "riskPreviewRef", "$.riskPreviewRef", errors, require_existing_refs=require_existing_refs)
    risk_level = _require_string(payload, "riskLevel", "$.riskLevel", errors)
    if risk_level and risk_level not in {"low", "medium", "high"}:
        errors.append(_contract_error("risk_level_invalid", "riskLevel must be low, medium, or high.", "$.riskLevel", actual=risk_level))
    _require_string(payload, "riskClass", "$.riskClass", errors)
    _validate_approval_mode(payload.get("approvalMode"), errors, "$.approvalMode")
    _require_ref_list(payload, "actionRiskRefs", "$.actionRiskRefs", errors, require_existing_refs=require_existing_refs, min_count=0)
    _require_optional_user_confirmation_ref(payload, errors, require_existing_refs=require_existing_refs)


def _validate_data_visibility(
    payload: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    require_existing_refs: bool,
) -> None:
    _require_string(payload, "sessionId", "$.sessionId", errors)
    _require_string(payload, "source", "$.source", errors)
    _require_ref(payload, "dataVisibilityRef", "$.dataVisibilityRef", errors, require_existing_refs=require_existing_refs)
    _require_ref_list(payload, "readScopeRefs", "$.readScopeRefs", errors, require_existing_refs=require_existing_refs, min_count=0)
    _require_ref_list(payload, "inputScopeRefs", "$.inputScopeRefs", errors, require_existing_refs=require_existing_refs, min_count=0)
    _require_ref_list(payload, "visibleScreenRefs", "$.visibleScreenRefs", errors, require_existing_refs=require_existing_refs, min_count=0)
    _require_ref_list(payload, "visibleWindowRefs", "$.visibleWindowRefs", errors, require_existing_refs=require_existing_refs, min_count=0)
    if payload.get("screenshotRefPolicy") != "refs-only":
        errors.append(_contract_error(
            "screenshot_policy_not_refs_only",
            "Data visibility must keep screenshots refs-only.",
            "$.screenshotRefPolicy",
            expected="refs-only",
            actual=payload.get("screenshotRefPolicy"),
        ))
    if payload.get("inlineScreenshotsAllowed") is not False:
        errors.append(_contract_error(
            "inline_screenshot_policy_forbidden",
            "Data visibility must explicitly forbid inline screenshots.",
            "$.inlineScreenshotsAllowed",
            expected=False,
            actual=payload.get("inlineScreenshotsAllowed"),
        ))
    if payload.get("providerPayloadAllowed") is not False:
        errors.append(_contract_error(
            "provider_payload_policy_forbidden",
            "Data visibility must explicitly forbid provider raw payload storage.",
            "$.providerPayloadAllowed",
            expected=False,
            actual=payload.get("providerPayloadAllowed"),
        ))
    _require_optional_user_confirmation_ref(payload, errors, require_existing_refs=require_existing_refs)


def _validate_stop_cancel_lease(
    payload: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    require_existing_refs: bool,
) -> None:
    _require_string(payload, "sessionId", "$.sessionId", errors)
    _require_string(payload, "source", "$.source", errors)
    _require_ref(payload, "stopRef", "$.stopRef", errors, require_existing_refs=require_existing_refs)
    _require_ref(payload, "cancelLeaseRef", "$.cancelLeaseRef", errors, require_existing_refs=require_existing_refs)
    _require_ref_list(
        payload,
        "currentLeaseCancellationRefs",
        "$.currentLeaseCancellationRefs",
        errors,
        require_existing_refs=require_existing_refs,
        min_count=0,
    )
    active_lease_ref = _string_or_none(payload.get("activeLeaseRef"))
    if active_lease_ref and _safe_ref_or_none(active_lease_ref, require_existing=require_existing_refs) is None:
        errors.append(_contract_error("unsafe_ref_value", "activeLeaseRef must be a safe durable ref.", "$.activeLeaseRef", actual=active_lease_ref))
    if payload.get("cancellationMode") != "lease-cancel-only":
        errors.append(_contract_error(
            "cancellation_mode_invalid",
            "Stop/cancel must cancel scheduler leases, not kill package state directly.",
            "$.cancellationMode",
            expected="lease-cancel-only",
            actual=payload.get("cancellationMode"),
        ))
    if payload.get("packageStateKillAllowed") is not False:
        errors.append(_contract_error(
            "package_state_kill_forbidden",
            "Stop/cancel controls cannot directly kill package state.",
            "$.packageStateKillAllowed",
            expected=False,
            actual=payload.get("packageStateKillAllowed"),
        ))
    _require_optional_user_confirmation_ref(payload, errors, require_existing_refs=require_existing_refs)


def _validate_input_modality_policy(value: Any, errors: list[dict[str, Any]], path: str) -> None:
    if not isinstance(value, Mapping):
        errors.append(_contract_error("input_modality_policy_missing", "inputModalityPolicy must be an object.", path))
        return
    modalities = value.get("allowedInputModalities")
    if modalities is None:
        errors.append(_contract_error(
            "input_modality_policy_missing",
            "inputModalityPolicy.allowedInputModalities is required.",
            f"{path}.allowedInputModalities",
        ))
    elif not isinstance(modalities, (list, tuple)) or not all(isinstance(item, str) and item.strip() for item in modalities):
        errors.append(_contract_error(
            "input_modality_policy_invalid",
            "inputModalityPolicy.allowedInputModalities must be a list of modality names.",
            f"{path}.allowedInputModalities",
        ))
    if value.get("sharedSystemInputAllowed") is not False:
        errors.append(_contract_error(
            "shared_system_input_policy_forbidden",
            "inputModalityPolicy must explicitly forbid shared system input.",
            f"{path}.sharedSystemInputAllowed",
            expected=False,
            actual=value.get("sharedSystemInputAllowed"),
        ))
    if value.get("mutatingInputRequiresLease") is not True:
        errors.append(_contract_error(
            "mutating_input_lease_policy_missing",
            "inputModalityPolicy must require a scheduler/executor lease for mutating input.",
            f"{path}.mutatingInputRequiresLease",
            expected=True,
            actual=value.get("mutatingInputRequiresLease"),
        ))


def _validate_approval_mode(value: Any, errors: list[dict[str, Any]], path: str) -> None:
    mode = _string_or_none(value)
    allowed_modes = {"fail-closed", "require-confirmation", "preapproved-session", "allow-confirmed", "handoff-required"}
    if not mode:
        errors.append(_contract_error("approval_mode_missing", "approvalMode is required.", path))
    elif mode not in allowed_modes:
        errors.append(_contract_error("approval_mode_invalid", "approvalMode is invalid.", path, actual=mode))


def _require_optional_user_confirmation_ref(
    payload: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    require_existing_refs: bool,
) -> None:
    ref = _string_or_none(payload.get("userConfirmationRef"))
    if ref and _safe_ref_or_none(ref, require_existing=require_existing_refs) is None:
        errors.append(_contract_error("unsafe_ref_value", "userConfirmationRef must be a safe durable ref.", "$.userConfirmationRef", actual=ref))


def _validate_user_level_required_refs(
    evidence: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    require_existing_refs: bool,
) -> None:
    for key in (
        "sessionPermissionRef",
        "appWindowAllowlistRef",
        "riskPreviewRef",
        "dataVisibilityRef",
        "stopRef",
        "cancelLeaseRef",
    ):
        _require_ref(evidence, key, f"$.{key}", errors, require_existing_refs=require_existing_refs)
    if not _first_safe_ref(
        evidence,
        ("platformSidecarIsolationReportRef", "platformIsolationReportRef", "sidecarIsolationReportRef"),
        require_existing_refs=require_existing_refs,
    ):
        errors.append(_contract_error(
            "platform_sidecar_isolation_ref_missing",
            "User-level mutating evidence must cite a platform-sidecar isolation report ref.",
            "$.platformSidecarIsolationReportRef",
        ))
    if not _first_safe_ref(
        evidence,
        ("userConfirmationRef", "approvalDecisionRef", "approvalRef", "approvalRequestRef"),
        require_existing_refs=require_existing_refs,
    ):
        errors.append(_contract_error(
            "user_confirmation_ref_missing",
            "User-level mutating evidence must cite a user confirmation or approval decision ref.",
            "$.userConfirmationRef",
        ))


def _validate_user_level_control_fields(evidence: Mapping[str, Any], errors: list[dict[str, Any]]) -> None:
    _require_ref_list(evidence, "allowedAppRefs", "$.allowedAppRefs", errors, require_existing_refs=False, min_count=1)
    _require_ref_list(evidence, "allowedWindowRefs", "$.allowedWindowRefs", errors, require_existing_refs=False, min_count=1)
    _require_ref_list(evidence, "forbiddenAppRefs", "$.forbiddenAppRefs", errors, require_existing_refs=False, min_count=0)
    _validate_input_modality_policy(evidence.get("inputModalityPolicy"), errors, "$.inputModalityPolicy")
    _validate_approval_mode(evidence.get("approvalMode"), errors, "$.approvalMode")


def _validate_user_confirmation_source(evidence: Mapping[str, Any], errors: list[dict[str, Any]]) -> None:
    candidates = _confirmation_source_candidates(evidence)
    if not candidates:
        errors.append(_contract_error(
            "user_confirmation_source_missing",
            "User-level mutating evidence must identify the user as the confirmation source.",
            "$.userConfirmationSource",
        ))
        return
    third_party_sources = sorted(value for value in candidates if _is_third_party_confirmation_source(value))
    if third_party_sources:
        errors.append(_contract_error(
            "third_party_confirmation_forbidden",
            "Third-party page, document, provider, model, or screenshot content cannot replace user confirmation.",
            "$.userConfirmationSource",
            actual=third_party_sources,
        ))
        return
    if not any(_is_user_confirmation_source(value) for value in candidates):
        errors.append(_contract_error(
            "third_party_confirmation_forbidden",
            "Third-party page, document, provider, model, or screenshot content cannot replace user confirmation.",
            "$.userConfirmationSource",
            actual=sorted(candidates),
        ))


def _confirmation_source_candidates(value: Any) -> set[str]:
    candidates: set[str] = set()
    _collect_confirmation_sources(value, candidates, key_name=None)
    return candidates


def _collect_confirmation_sources(value: Any, candidates: set[str], *, key_name: str | None) -> None:
    if isinstance(value, Mapping):
        for key, item in value.items():
            normalized_key = _normalized_key(key)
            if normalized_key in {"userconfirmation", "approvalconfirmation", "approvaldecision"} and isinstance(item, Mapping):
                source = _string_or_none(item.get("source") or item.get("confirmationSource") or item.get("approvalSource"))
                if source:
                    candidates.add(source.strip().lower())
            _collect_confirmation_sources(item, candidates, key_name=str(key))
        return
    if isinstance(value, (list, tuple)):
        for item in value:
            _collect_confirmation_sources(item, candidates, key_name=key_name)
        return
    if isinstance(value, str):
        normalized_key = _normalized_key(key_name or "")
        if normalized_key in {"userconfirmationsource", "confirmationsource", "approvalsource", "confirmedby", "authorizedby"}:
            candidates.add(value.strip().lower())


def _is_user_confirmation_source(value: str) -> bool:
    normalized = value.strip().lower().replace("_", "-")
    return normalized in {
        "user",
        "human",
        "human-user",
        "tui-user",
        "tui-host-user",
        "codex-user-confirmation",
        "gui-confirmation-result",
    }


def _is_third_party_confirmation_source(value: str) -> bool:
    normalized = value.strip().lower().replace("_", "-")
    return normalized in {
        "assistant",
        "document",
        "file",
        "model",
        "ocr",
        "page",
        "provider",
        "screen",
        "screenshot",
        "third-party",
        "third-party-content",
        "vlm",
        "web-page",
        "website",
    }


def _first_safe_ref(
    payload: Mapping[str, Any],
    keys: Sequence[str],
    *,
    require_existing_refs: bool,
) -> str | None:
    for key in keys:
        safe_ref = _safe_ref_or_none(payload.get(key), require_existing=require_existing_refs)
        if safe_ref:
            return safe_ref
    return None


def _evidence_has_mutating_gui_action(value: Any) -> bool:
    if isinstance(value, Mapping):
        explicit = value.get("mutatingGuiAction")
        if explicit is True:
            return True
        action_kind = _string_or_none(value.get("actionKind")) or _string_or_none(value.get("kind")) or _string_or_none(value.get("action"))
        if action_kind and action_kind_mutates_gui(action_kind):
            return True
        for item in value.values():
            if isinstance(item, (Mapping, list, tuple)) and _evidence_has_mutating_gui_action(item):
                return True
    elif isinstance(value, (list, tuple)):
        return any(_evidence_has_mutating_gui_action(item) for item in value)
    return False


def _validate_action_target(
    target: Mapping[str, Any],
    errors: list[dict[str, Any]],
    path: str,
    *,
    require_screen: bool,
    require_window: bool,
    expected_screen_id: str | None = None,
) -> None:
    if not target:
        return
    scope = _string_or_none(target.get("scope"))
    if scope and scope not in {"artifact", "element", "region", "screen", "window"}:
        errors.append(_contract_error("target_scope_invalid", "Action target scope is invalid.", f"{path}.scope", actual=scope))
    screen_id = _string_or_none(target.get("screenId"))
    if require_screen and not screen_id:
        errors.append(_contract_error("screen_identity_missing", "Action target must include explicit screenId.", f"{path}.screenId"))
    if expected_screen_id and screen_id and screen_id != expected_screen_id:
        errors.append(_contract_error(
            "screen_identity_mismatch",
            "Action target screenId must match executor event screenId.",
            f"{path}.screenId",
            expected=expected_screen_id,
            actual=screen_id,
        ))
    if require_window and scope == "window" and not _string_or_none(target.get("windowId")):
        errors.append(_contract_error("window_identity_missing", "Window-scoped action target must include windowId.", f"{path}.windowId"))
    coordinate_space = _string_or_none(target.get("coordinateSpace"))
    if coordinate_space and coordinate_space.strip().lower() in GLOBAL_COORDINATE_SPACES:
        errors.append(_contract_error(
            "bare_global_coordinates",
            "Action target coordinates must be screen-local or window-local, not global.",
            f"{path}.coordinateSpace",
            actual=coordinate_space,
        ))
    has_coordinate_values = any(key in target for key in ("x", "y", "point", "position", "bounds", "rect", "region"))
    if has_coordinate_values and not screen_id:
        errors.append(_contract_error(
            "bare_global_coordinates",
            "Coordinate-bearing targets must include screenId.",
            path,
        ))
    for key in ("point", "position"):
        nested = _mapping(target.get(key))
        if nested:
            _validate_position(nested, errors, f"{path}.{key}", required_screen_id=screen_id)
    for key in ("bounds", "rect", "region"):
        nested = _mapping(target.get(key))
        if nested:
            _validate_bounds(nested, errors, f"{path}.{key}", required_screen_id=screen_id)


def _validate_position(
    position: Mapping[str, Any],
    errors: list[dict[str, Any]],
    path: str,
    *,
    required_screen_id: str | None,
) -> None:
    if _number_or_none(position.get("x")) is None:
        errors.append(_contract_error("position_x_missing", "Position x must be numeric.", f"{path}.x"))
    if _number_or_none(position.get("y")) is None:
        errors.append(_contract_error("position_y_missing", "Position y must be numeric.", f"{path}.y"))
    coordinate_space = _string_or_none(position.get("coordinateSpace"))
    if not coordinate_space:
        errors.append(_contract_error("coordinate_space_missing", "Position coordinateSpace is required.", f"{path}.coordinateSpace"))
    elif coordinate_space.strip().lower() in GLOBAL_COORDINATE_SPACES:
        errors.append(_contract_error(
            "bare_global_coordinates",
            "Position must use screen-local or window-local coordinates.",
            f"{path}.coordinateSpace",
            actual=coordinate_space,
        ))
    position_screen_id = _string_or_none(position.get("screenId"))
    if position_screen_id and required_screen_id and position_screen_id != required_screen_id:
        errors.append(_contract_error(
            "screen_identity_mismatch",
            "Position screenId must match the event or target screenId.",
            f"{path}.screenId",
            expected=required_screen_id,
            actual=position_screen_id,
        ))


def _validate_bounds(
    bounds: Mapping[str, Any],
    errors: list[dict[str, Any]],
    path: str,
    *,
    required_screen_id: str | None,
) -> None:
    for key in ("x", "y", "width", "height"):
        if _number_or_none(bounds.get(key)) is None:
            errors.append(_contract_error("bounds_value_missing", f"Bounds {key} must be numeric.", f"{path}.{key}"))
    coordinate_space = _string_or_none(bounds.get("coordinateSpace"))
    if not coordinate_space:
        errors.append(_contract_error("coordinate_space_missing", "Bounds coordinateSpace is required.", f"{path}.coordinateSpace"))
    elif coordinate_space.strip().lower() in GLOBAL_COORDINATE_SPACES:
        errors.append(_contract_error(
            "bare_global_coordinates",
            "Bounds must use screen-local or window-local coordinates.",
            f"{path}.coordinateSpace",
            actual=coordinate_space,
        ))
    bounds_screen_id = _string_or_none(bounds.get("screenId"))
    if bounds_screen_id and required_screen_id and bounds_screen_id != required_screen_id:
        errors.append(_contract_error(
            "screen_identity_mismatch",
            "Bounds screenId must match the event or target screenId.",
            f"{path}.screenId",
            expected=required_screen_id,
            actual=bounds_screen_id,
        ))


def _validate_top_level_coordinate_leaks(payload: Mapping[str, Any], errors: list[dict[str, Any]]) -> None:
    if "x" in payload or "y" in payload or "coordinates" in payload:
        errors.append(_contract_error(
            "bare_global_coordinates",
            "Executor/action contracts cannot carry top-level coordinates; bind them to target.screenId.",
            "$",
        ))


def _require_isolation_flags_false(payload: Mapping[str, Any], errors: list[dict[str, Any]]) -> None:
    for key in ("sharedSystemInputUsed", "systemPointerMoved", "systemKeyboardEventsSent"):
        if payload.get(key) is not False:
            errors.append(_contract_error(
                "input_isolation_flag_not_false",
                f"{key} must be explicitly false.",
                f"$.{key}",
                expected=False,
                actual=payload.get(key),
            ))


def _security_issues(value: Any, *, require_existing_refs: bool) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    _collect_security_issues(value, issues, path="$", require_existing_refs=require_existing_refs)
    return issues


def _collect_security_issues(
    value: Any,
    issues: list[dict[str, Any]],
    *,
    path: str,
    require_existing_refs: bool,
    key_name: str | None = None,
) -> None:
    if isinstance(value, Mapping):
        for key, item in value.items():
            key_text = str(key)
            normalized = _normalized_key(key_text)
            child_path = f"{path}.{key_text}"
            if normalized in FORBIDDEN_INLINE_PAYLOAD_KEYS:
                issues.append(_contract_error(
                    "inline_payload_key_forbidden",
                    "Contract must be refs-first and cannot include inline raw screenshot/image/base64/provider payload keys.",
                    child_path,
                ))
            if normalized in SENSITIVE_VALUE_KEY_NAMES or normalized.endswith("token") or normalized.endswith("password"):
                if normalized not in SAFE_NEGATIVE_DIAGNOSTIC_KEYS and item not in (None, "", False, "[REDACTED]"):
                    issues.append(_contract_error(
                        "secret_key_forbidden",
                        "Contract must not include secrets, tokens, credentials, or Authorization values.",
                        child_path,
                    ))
            _collect_security_issues(
                item,
                issues,
                path=child_path,
                require_existing_refs=require_existing_refs,
                key_name=key_text,
            )
        return
    if isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            _collect_security_issues(
                item,
                issues,
                path=f"{path}[{index}]",
                require_existing_refs=require_existing_refs,
                key_name=key_name,
            )
        return
    if isinstance(value, str):
        if DATA_URL_VALUE_RE.search(value) or ";base64," in value.lower():
            issues.append(_contract_error(
                "inline_payload_string_forbidden",
                "Contract must be refs-first and cannot contain data URLs or inline base64 payloads.",
                path,
            ))
        if BASE64_BLOB_VALUE_RE.match(value.strip()):
            issues.append(_contract_error(
                "inline_base64_string_forbidden",
                "Contract must not contain inline base64 blobs.",
                path,
            ))
        if AUTHORIZATION_VALUE_RE.search(value) or BEARER_VALUE_RE.search(value) or SECRET_ASSIGNMENT_VALUE_RE.search(value):
            issues.append(_contract_error(
                "secret_value_forbidden",
                "Contract must not contain Authorization headers or secret assignments.",
                path,
            ))
        if _looks_like_ref_key(key_name):
            safe_ref = _safe_ref_or_none(value, require_existing=require_existing_refs)
            if safe_ref is None and value:
                issues.append(_contract_error(
                    "unsafe_ref_value",
                    "Ref fields must contain safe durable refs, not inline payloads or secret-bearing URLs.",
                    path,
                ))


def _require_string(
    payload: Mapping[str, Any],
    key: str,
    path: str,
    errors: list[dict[str, Any]],
    *,
    code: str = "required_string_missing",
) -> str | None:
    value = _string_or_none(payload.get(key))
    if not value:
        errors.append(_contract_error(code, f"{key} is required.", path))
    return value


def _require_declared_optional_string(
    payload: Mapping[str, Any],
    key: str,
    path: str,
    errors: list[dict[str, Any]],
) -> str | None:
    if key not in payload:
        errors.append(_contract_error("required_field_missing", f"{key} must be declared.", path))
        return None
    value = payload.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        errors.append(_contract_error("required_string_invalid", f"{key} must be a string or null.", path, actual=value))
        return None
    return value.strip() or None


def _require_bool(
    payload: Mapping[str, Any],
    key: str,
    path: str,
    errors: list[dict[str, Any]],
) -> bool | None:
    value = payload.get(key)
    if not isinstance(value, bool):
        code = "required_bool_missing" if key not in payload else "required_bool_invalid"
        errors.append(_contract_error(code, f"{key} must be a boolean.", path, actual=value))
        return None
    return value


def _require_string_list(
    payload: Mapping[str, Any],
    key: str,
    path: str,
    errors: list[dict[str, Any]],
    *,
    min_count: int,
) -> list[str]:
    value = payload.get(key)
    if value is None:
        errors.append(_contract_error("required_list_missing", f"{key} is required.", path))
        return []
    if not isinstance(value, (list, tuple)):
        errors.append(_contract_error("required_list_invalid", f"{key} must be a list of strings.", path, actual=value))
        return []
    strings: list[str] = []
    for index, item in enumerate(value):
        item_value = _string_or_none(item)
        if not item_value:
            errors.append(_contract_error("required_string_missing", f"{key}[{index}] must be a non-empty string.", f"{path}[{index}]"))
            continue
        strings.append(item_value)
    if len(strings) < min_count:
        errors.append(_contract_error(
            "required_list_empty",
            f"{key} must include at least {min_count} value(s).",
            path,
            expected=f">={min_count}",
            actual=len(strings),
        ))
    return strings


def _require_ref(
    payload: Mapping[str, Any],
    key: str,
    path: str,
    errors: list[dict[str, Any]],
    *,
    require_existing_refs: bool,
) -> str | None:
    value = _string_or_none(payload.get(key))
    if not value:
        errors.append(_contract_error("required_ref_missing", f"{key} is required.", path))
        return None
    safe_ref = _safe_ref_or_none(value, require_existing=require_existing_refs)
    if safe_ref is None:
        errors.append(_contract_error("unsafe_ref_value", f"{key} must be a safe durable ref.", path, actual=value))
        return None
    return safe_ref


def _require_ref_list(
    payload: Mapping[str, Any],
    key: str,
    path: str,
    errors: list[dict[str, Any]],
    *,
    require_existing_refs: bool,
    min_count: int,
) -> list[str]:
    value = payload.get(key)
    if value is None:
        errors.append(_contract_error("required_ref_list_missing", f"{key} is required.", path))
        return []
    if not isinstance(value, (list, tuple)):
        errors.append(_contract_error("required_ref_list_invalid", f"{key} must be a list of refs.", path))
        return []
    refs: list[str] = []
    for index, item in enumerate(value):
        item_value = _string_or_none(item)
        if not item_value:
            errors.append(_contract_error("required_ref_missing", f"{key}[{index}] must be a non-empty ref.", f"{path}[{index}]"))
            continue
        safe_ref = _safe_ref_or_none(item_value, require_existing=require_existing_refs)
        if safe_ref is None:
            errors.append(_contract_error("unsafe_ref_value", f"{key}[{index}] must be a safe durable ref.", f"{path}[{index}]", actual=item_value))
            continue
        refs.append(safe_ref)
    if len(refs) < min_count:
        errors.append(_contract_error(
            "required_ref_list_empty",
            f"{key} must include at least {min_count} ref(s).",
            path,
            expected=f">={min_count}",
            actual=len(refs),
        ))
    return refs


def _load_contract_payload(payload_or_ref: Mapping[str, Any] | str | Path) -> Mapping[str, Any]:
    if isinstance(payload_or_ref, Mapping):
        return payload_or_ref
    path = Path(payload_or_ref).expanduser()
    if not path.is_file():
        raise FileNotFoundError(path)
    parsed = json.loads(path.read_text(encoding="utf8"))
    if not isinstance(parsed, Mapping):
        raise TypeError("Contract payload must be a JSON object.")
    return parsed


def _safe_ref_or_none(value: Any, *, require_existing: bool = False) -> str | None:
    ref = _string_or_none(value)
    if not ref:
        return None
    lowered = ref.strip().lower()
    if lowered.startswith("data:") or ";base64," in lowered:
        return None
    if AUTHORIZATION_VALUE_RE.search(ref) or SECRET_ASSIGNMENT_VALUE_RE.search(ref):
        return None
    if lowered.startswith(("http://", "https://")) and "?" in ref:
        return None
    if BASE64_BLOB_VALUE_RE.match(ref.strip()):
        return None
    if require_existing and _looks_like_local_ref(ref) and not Path(ref).expanduser().exists():
        return None
    return ref


def _collect_ref_values(value: Any) -> list[str]:
    refs: list[str] = []
    _collect_refs(value, refs, key_name=None)
    return _unique_strings(refs)


def _collect_refs(value: Any, refs: list[str], *, key_name: str | None) -> None:
    if isinstance(value, Mapping):
        for key, item in value.items():
            _collect_refs(item, refs, key_name=str(key))
        return
    if isinstance(value, (list, tuple)):
        for item in value:
            _collect_refs(item, refs, key_name=key_name)
        return
    if isinstance(value, str) and _looks_like_ref_key(key_name):
        safe_ref = _safe_ref_or_none(value)
        if safe_ref:
            refs.append(safe_ref)


def _looks_like_ref_key(key_name: str | None) -> bool:
    if not key_name:
        return False
    normalized = _normalized_key(key_name)
    return normalized == "ref" or normalized.endswith("ref") or normalized.endswith("refs")


def _looks_like_local_ref(ref: str) -> bool:
    if "://" in ref or ref.startswith(("artifact:", "approval:", "capture:", "cursor:", "evidence:", "lease:", "replay:", "screen:", "trace:")):
        return False
    return ref.startswith(("/", "./", "../", "~")) or "." in Path(ref).name


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _string_or_none(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _number_or_none(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _bool_or_none(value: Any) -> bool | None:
    return value if isinstance(value, bool) else None


def _normalize_action_kind(value: str | None) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip().lower().replace("-", "_")


def _normalize_acceptance_marker(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(value).strip().lower()).strip("-")


def _normalized_key(value: Any) -> str:
    return str(value).replace("_", "").replace("-", "").lower()


def _drop_none_values(payload: Mapping[str, Any]) -> dict[str, Any]:
    return {str(key): value for key, value in payload.items() if value is not None}


def _unique_strings(values: Sequence[str] | list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if isinstance(value, str) and value and value not in seen:
            seen.add(value)
            result.append(value)
    return result


def _validation_result(
    *,
    schema_version: str | None,
    payload_ref: str | None,
    errors: Sequence[Mapping[str, Any]],
    warnings: Sequence[Mapping[str, Any]],
    refs: Sequence[str],
    mutating_gui_action: bool | None,
) -> dict[str, Any]:
    return {
        "schemaVersion": MULTI_SCREEN_CONTRACT_VALIDATION_SCHEMA_VERSION,
        "ok": not errors,
        "contractSchemaVersion": schema_version,
        "payloadRef": payload_ref,
        "errorCount": len(errors),
        "errors": [dict(error) for error in errors],
        "warnings": [dict(warning) for warning in warnings],
        "refs": list(refs),
        "mutatingGuiAction": mutating_gui_action,
    }


def _user_control_validation_result(
    *,
    schema_version: str | None,
    payload_ref: str | None,
    errors: Sequence[Mapping[str, Any]],
    warnings: Sequence[Mapping[str, Any]],
    refs: Sequence[str],
    status: str,
    mutating_gui_action: bool | None = None,
    user_acceptance_eligible: bool | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "schemaVersion": USER_CONTROL_CONTRACT_VALIDATION_SCHEMA_VERSION,
        "ok": not errors,
        "status": status,
        "contractSchemaVersion": schema_version,
        "payloadRef": payload_ref,
        "errorCount": len(errors),
        "errors": [dict(error) for error in errors],
        "warnings": [dict(warning) for warning in warnings],
        "refs": list(refs),
    }
    if mutating_gui_action is not None:
        result["mutatingGuiAction"] = mutating_gui_action
    if user_acceptance_eligible is not None:
        result["userAcceptanceEligible"] = user_acceptance_eligible
        result["diagnosticOnly"] = not user_acceptance_eligible
    return result


def _virtual_app_screen_acceptance_validation_result(
    *,
    schema_version: str | None,
    payload_ref: str | None,
    errors: Sequence[Mapping[str, Any]],
    warnings: Sequence[Mapping[str, Any]],
    refs: Sequence[str],
    status: VirtualAppScreenUserAcceptanceStatus,
    user_acceptance_eligible: bool,
    diagnostic_only: bool,
    extra: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "schemaVersion": VIRTUAL_APP_SCREEN_USER_ACCEPTANCE_VALIDATION_SCHEMA_VERSION,
        "ok": not errors,
        "status": status,
        "contractSchemaVersion": schema_version,
        "payloadRef": payload_ref,
        "errorCount": len(errors),
        "errors": [dict(error) for error in errors],
        "warnings": [dict(warning) for warning in warnings],
        "refs": list(refs),
        "userAcceptanceEligible": user_acceptance_eligible,
        "diagnosticOnly": diagnostic_only,
    }
    if extra:
        result.update(dict(extra))
    return result


def _ua_require_declared_optional_string(
    payload: Mapping[str, Any],
    key: str,
    path: str,
    errors: list[dict[str, Any]],
) -> str | None:
    if key not in payload:
        errors.append(_contract_error("required_field_missing", f"{key} must be declared.", path))
        return None
    value = payload.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        errors.append(_contract_error("required_string_invalid", f"{key} must be a string or null.", path, actual=value))
        return None
    return value.strip() or None


def _ua_validate_action_adapter_readiness_payload(
    payload: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    require_existing_refs: bool,
) -> list[str]:
    _require_string(payload, "adapterId", "$.adapterId", errors)
    _require_string(payload, "adapterKind", "$.adapterKind", errors)
    target_scope = _require_string(payload, "targetScope", "$.targetScope", errors)
    if target_scope and target_scope not in {"app", "app-window", "element", "region", "screen", "session", "virtual-app-screen", "window"}:
        errors.append(_contract_error("target_scope_invalid", "ActionAdapter targetScope is invalid.", "$.targetScope", actual=target_scope))
    _require_string_list(payload, "supportedActions", "$.supportedActions", errors, min_count=1)
    _require_bool(payload, "captureSupported", "$.captureSupported", errors)
    _require_bool(payload, "backgroundRenderable", "$.backgroundRenderable", errors)
    _require_bool(payload, "affectsPhysicalDisplay", "$.affectsPhysicalDisplay", errors)
    _require_bool(payload, "requiresFocusSteal", "$.requiresFocusSteal", errors)
    _require_bool(payload, "sharedSystemInputUsed", "$.sharedSystemInputUsed", errors)
    _require_bool(payload, "ready", "$.ready", errors)
    if "physicalPopupShown" in payload:
        _require_bool(payload, "physicalPopupShown", "$.physicalPopupShown", errors)
    _ua_require_declared_optional_string(payload, "blockedReason", "$.blockedReason", errors)
    _require_ref_list(payload, "schemaRefs", "$.schemaRefs", errors, require_existing_refs=require_existing_refs, min_count=1)
    for key in ("readinessRef", "capabilityRef"):
        ref = _string_or_none(payload.get(key))
        if ref and _safe_ref_or_none(ref, require_existing=require_existing_refs) is None:
            errors.append(_contract_error("unsafe_ref_value", f"{key} must be a safe durable ref.", f"$.{key}", actual=ref))

    blockers = _ua_adapter_isolation_blockers(payload)
    if blockers and payload.get("ready") is True:
        errors.append(_contract_error(
            "adapter_ready_flag_inconsistent",
            "ActionAdapter cannot be ready for isolated background user acceptance with unsafe capability flags.",
            "$.ready",
            actual=True,
        ))
    if (payload.get("ready") is False or blockers) and not _string_or_none(payload.get("blockedReason")):
        errors.append(_contract_error(
            "blocked_reason_required",
            "ActionAdapter readiness must explain blocked or unsafe capability flags.",
            "$.blockedReason",
        ))
    return blockers


def _ua_adapter_isolation_blockers(payload: Mapping[str, Any]) -> list[str]:
    blockers: list[str] = []
    if payload.get("captureSupported") is not True:
        blockers.append("capture-unsupported")
    if payload.get("backgroundRenderable") is not True:
        blockers.append("background-rendering-unavailable")
    if payload.get("affectsPhysicalDisplay") is not False:
        blockers.append("physical-display-affected")
    if payload.get("requiresFocusSteal") is not False:
        blockers.append("focus-steal-required")
    if payload.get("sharedSystemInputUsed") is not False:
        blockers.append("shared-system-input")
    if payload.get("physicalPopupShown") is True:
        blockers.append("physical-popup")
    return _unique_strings(blockers)


def _ua_validate_input_intent_payload(
    payload: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    require_existing_refs: bool,
) -> None:
    _require_string(payload, "intentId", "$.intentId", errors)
    input_kind = _require_string(payload, "inputKind", "$.inputKind", errors)
    if input_kind and input_kind not in VIRTUAL_APP_SCREEN_INPUT_KINDS:
        errors.append(_contract_error("input_kind_invalid", "InputIntent inputKind is invalid.", "$.inputKind", actual=input_kind))
    _require_string(payload, "actorId", "$.actorId", errors)
    _require_string(payload, "cursorId", "$.cursorId", errors)
    screen_id = _require_string(payload, "screenId", "$.screenId", errors)
    target = _mapping(payload.get("target"))
    if not target:
        errors.append(_contract_error("target_missing", "InputIntent target is required.", "$.target"))
    _validate_action_target(target, errors, "$.target", require_screen=True, require_window=True, expected_screen_id=screen_id)
    _validate_top_level_coordinate_leaks(payload, errors)
    for key in ("inputLeaseRef", "actionAdapterRef", "adapterReadinessRef", "executorEventRef"):
        _require_ref(payload, key, f"$.{key}", errors, require_existing_refs=require_existing_refs)
    _require_ref_list(payload, "beforeAfterFrameRefs", "$.beforeAfterFrameRefs", errors, require_existing_refs=require_existing_refs, min_count=1)
    _require_ref_list(payload, "verificationRefs", "$.verificationRefs", errors, require_existing_refs=require_existing_refs, min_count=1)
    if "beforeFrameRefs" in payload:
        _require_ref_list(payload, "beforeFrameRefs", "$.beforeFrameRefs", errors, require_existing_refs=require_existing_refs, min_count=0)
    if "afterFrameRefs" in payload:
        _require_ref_list(payload, "afterFrameRefs", "$.afterFrameRefs", errors, require_existing_refs=require_existing_refs, min_count=0)
    proposal_ref = _string_or_none(payload.get("proposalRef"))
    if proposal_ref and _safe_ref_or_none(proposal_ref, require_existing=require_existing_refs) is None:
        errors.append(_contract_error("unsafe_ref_value", "proposalRef must be a safe durable ref.", "$.proposalRef", actual=proposal_ref))


def _ua_validate_annotation_overlay_payload(
    payload: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    require_existing_refs: bool,
) -> None:
    _require_string(payload, "overlayId", "$.overlayId", errors)
    annotation_kind = _require_string(payload, "annotationKind", "$.annotationKind", errors)
    if annotation_kind and annotation_kind not in ANNOTATION_OVERLAY_KINDS:
        errors.append(_contract_error(
            "annotation_kind_invalid",
            "Annotation overlay kind is invalid.",
            "$.annotationKind",
            actual=annotation_kind,
        ))
    _require_string(payload, "screenId", "$.screenId", errors)
    target_binding_kind = _require_string(payload, "targetBindingKind", "$.targetBindingKind", errors)
    if target_binding_kind and target_binding_kind not in ANNOTATION_TARGET_BINDING_KINDS:
        errors.append(_contract_error(
            "annotation_target_binding_invalid",
            "Annotation targetBindingKind must bind to a window region, AX/DOM element, OCR span, visual object, or artifact/file ref.",
            "$.targetBindingKind",
            actual=target_binding_kind,
        ))
    for key in (
        "overlayRef",
        "targetRef",
        "proposalRef",
        "actionRef",
        "verificationRef",
        "beforeFrameRef",
        "afterFrameRef",
    ):
        _require_ref(payload, key, f"$.{key}", errors, require_existing_refs=require_existing_refs)
    if "refs" in payload:
        _require_ref_list(payload, "refs", "$.refs", errors, require_existing_refs=require_existing_refs, min_count=0)


def _ua_validate_virtual_app_screen_isolation_flags(value: Any, errors: list[dict[str, Any]]) -> list[str]:
    if not isinstance(value, Mapping):
        errors.append(_contract_error("isolation_flags_missing", "isolationFlags must be an object.", "$.isolationFlags"))
        return ["isolation-flags-missing"]

    blockers: list[str] = []
    for key in ("isolatedBackgroundControl", "backgroundRenderable"):
        flag = _require_bool(value, key, f"$.isolationFlags.{key}", errors)
        if flag is not True:
            blockers.append(f"{_normalize_acceptance_marker(key)}-missing")
    false_flags = {
        "affectsPhysicalDisplay": "physical-display-affected",
        "requiresFocusSteal": "focus-steal-required",
        "sharedSystemInputUsed": "shared-system-input",
        "physicalPopupShown": "physical-popup",
        "systemPointerMoved": "physical-pointer-moved",
        "systemKeyboardEventsSent": "physical-keyboard-events",
    }
    for key, blocker in false_flags.items():
        flag = _require_bool(value, key, f"$.isolationFlags.{key}", errors)
        if flag is not False:
            blockers.append(blocker)
    optional_false_flags = {
        "sharedSystemInputAllowed": "shared-system-input",
        "physicalPopupExpected": "physical-popup",
        "physicalDisplayPopup": "physical-popup",
        "physicalDisplayPopupShown": "physical-popup",
        "appWindowRaisedToPhysicalScreen": "physical-popup",
    }
    for key, blocker in optional_false_flags.items():
        if key in value:
            flag = _require_bool(value, key, f"$.isolationFlags.{key}", errors)
            if flag is not False:
                blockers.append(blocker)
    return _unique_strings(blockers)


def _ua_validate_acceptance_status(value: Any, errors: list[dict[str, Any]]) -> VirtualAppScreenUserAcceptanceStatus | None:
    status = _string_or_none(value)
    if not status:
        errors.append(_contract_error("required_string_missing", "status is required.", "$.status"))
        return None
    if status not in VIRTUAL_APP_SCREEN_ACCEPTANCE_STATUSES:
        errors.append(_contract_error("acceptance_status_invalid", "User-acceptance status is invalid.", "$.status", actual=status))
        return None
    return status  # type: ignore[return-value]


def _ua_pass_missing_ref_keys(refs_by_key: Mapping[str, Sequence[str]]) -> list[str]:
    return [key for key in VIRTUAL_APP_SCREEN_USER_ACCEPTANCE_REF_LIST_FIELDS if not refs_by_key.get(key)]


def _ua_acceptance_requires_confirmation(payload: Mapping[str, Any]) -> bool:
    has_confirmation_ref = _first_safe_ref(
        payload,
        ("userConfirmationRef", "approvalDecisionRef", "approvalRef"),
        require_existing_refs=False,
    )
    if payload.get("requiresUserConfirmation") is True and not has_confirmation_ref:
        return True
    approval_mode = _string_or_none(payload.get("approvalMode"))
    return bool(approval_mode == "require-confirmation" and not has_confirmation_ref)


def _ua_derive_user_acceptance_status(
    *,
    declared_status: VirtualAppScreenUserAcceptanceStatus,
    diagnostic_only: bool,
    isolation_blockers: Sequence[str],
    requires_confirmation: bool,
    pass_missing_ref_keys: Sequence[str],
) -> VirtualAppScreenUserAcceptanceStatus:
    if diagnostic_only or declared_status == "diagnostic":
        return "diagnostic"
    if isolation_blockers or declared_status == "requires-handoff":
        return "requires-handoff"
    if requires_confirmation or declared_status == "needs-confirmation":
        return "needs-confirmation"
    if declared_status == "blocked":
        return "blocked"
    if pass_missing_ref_keys:
        return "blocked"
    return "passed"


def _ua_validate_acceptance_boundary_consistency(
    payload: Mapping[str, Any],
    errors: list[dict[str, Any]],
    *,
    declared_status: VirtualAppScreenUserAcceptanceStatus,
    effective_status: VirtualAppScreenUserAcceptanceStatus,
    diagnostic_markers: Sequence[str],
    isolation_blockers: Sequence[str],
    pass_missing_ref_keys: Sequence[str],
    requires_confirmation: bool,
    user_acceptance_claim: bool | None,
) -> None:
    claiming_pass = declared_status == "passed" or user_acceptance_claim is True
    if claiming_pass and diagnostic_markers:
        errors.append(_contract_error(
            "diagnostic_source_user_acceptance_forbidden",
            "Package smoke, legacy M6, DOM, fixture, shell-only, and other diagnostic sources cannot set userAcceptanceEligible=true.",
            "$.userAcceptanceEligible",
            actual=list(diagnostic_markers),
        ))
    if claiming_pass and payload.get("diagnosticOnly") is True:
        errors.append(_contract_error(
            "diagnostic_manifest_cannot_pass",
            "diagnosticOnly manifests cannot pass user-level acceptance.",
            "$.diagnosticOnly",
            actual=True,
        ))
    if claiming_pass and isolation_blockers:
        errors.append(_contract_error(
            "isolation_gate_rejected",
            "Isolated VirtualAppScreen acceptance rejects focus steal, shared system input, physical display effects, or physical popups.",
            "$.isolationFlags",
            actual=list(isolation_blockers),
        ))
    if claiming_pass and requires_confirmation:
        errors.append(_contract_error(
            "user_confirmation_required",
            "User-level acceptance cannot pass while a user confirmation is still required.",
            "$.userConfirmationRef",
        ))
    if claiming_pass and pass_missing_ref_keys:
        errors.append(_contract_error(
            "pass_evidence_ref_missing",
            "passed requires app/window/session, adapter readiness, frame, input, executor, before/after, annotation/proposal, artifact, verifier, and gui.present refs.",
            "$",
            actual=list(pass_missing_ref_keys),
        ))
    if user_acceptance_claim is True and effective_status != "passed":
        errors.append(_contract_error(
            "user_acceptance_eligible_claim_forbidden",
            "userAcceptanceEligible=true is only valid when the effective status is passed.",
            "$.userAcceptanceEligible",
            expected="passed",
            actual=effective_status,
        ))
    if declared_status == "passed" and user_acceptance_claim is False:
        errors.append(_contract_error(
            "passed_requires_user_acceptance_eligible",
            "A passed manifest cannot explicitly set userAcceptanceEligible=false.",
            "$.userAcceptanceEligible",
            expected=True,
            actual=False,
        ))

    blocked_reason = _string_or_none(payload.get("blockedReason"))
    if effective_status == "passed":
        if blocked_reason:
            errors.append(_contract_error(
                "blocked_reason_for_pass_forbidden",
                "passed manifests must not carry blockedReason.",
                "$.blockedReason",
                actual=blocked_reason,
            ))
    elif not blocked_reason:
        errors.append(_contract_error(
            "blocked_reason_required",
            "Non-passed user-acceptance manifests must include a blockedReason.",
            "$.blockedReason",
        ))


def _ua_diagnostic_acceptance_markers(payload: Mapping[str, Any]) -> list[str]:
    markers: list[str] = []
    _ua_collect_diagnostic_acceptance_markers(payload, markers)
    return sorted(marker for marker in _unique_strings(markers) if marker in DIAGNOSTIC_ONLY_ACCEPTANCE_SOURCES)


def _ua_collect_diagnostic_acceptance_markers(value: Any, markers: list[str]) -> None:
    if isinstance(value, Mapping):
        for key, item in value.items():
            normalized_key = _normalized_key(key)
            if item is True:
                boolean_marker = {
                    "domshortcut": "dom-shortcut",
                    "dryrun": "diagnostic",
                    "fixture": "fixture",
                    "historicalevidence": "historical-docker-novnc",
                    "legacym6": "legacy-m6",
                    "m6optin": "m6-opt-in",
                    "packageharnessonly": "package-smoke",
                    "packagesmoke": "package-smoke",
                    "shelldirectartifactwrite": "shell-direct-artifact-write",
                    "shellonly": "shell-only",
                    "singleclicksmoke": "single-click-smoke",
                }.get(normalized_key)
                if boolean_marker:
                    markers.append(boolean_marker)
            if normalized_key in {
                "acceptancesource",
                "artifactorigin",
                "boundary",
                "evidenceorigin",
                "evidencesource",
                "evidencetype",
                "executorprovider",
                "runkind",
                "sourceboundary",
                "sourcekind",
                "sourcetype",
            }:
                _ua_collect_source_marker_values(item, markers)
            _ua_collect_diagnostic_acceptance_markers(item, markers)
        return
    if isinstance(value, (list, tuple)):
        for item in value:
            _ua_collect_diagnostic_acceptance_markers(item, markers)


def _ua_collect_source_marker_values(value: Any, markers: list[str]) -> None:
    if isinstance(value, str):
        normalized = _normalize_acceptance_marker(value)
        if normalized in DIAGNOSTIC_ONLY_ACCEPTANCE_SOURCES:
            markers.append(normalized)
        for marker in DIAGNOSTIC_ONLY_ACCEPTANCE_SOURCES:
            if marker in normalized:
                markers.append(marker)
        return
    if isinstance(value, Mapping):
        for item in value.values():
            _ua_collect_source_marker_values(item, markers)
        return
    if isinstance(value, (list, tuple)):
        for item in value:
            _ua_collect_source_marker_values(item, markers)


def _contract_error(
    code: str,
    message: str,
    path: str,
    *,
    expected: Any | None = None,
    actual: Any | None = None,
) -> dict[str, Any]:
    issue = {"code": code, "message": message, "path": path}
    if expected is not None:
        issue["expected"] = expected
    if actual is not None:
        issue["actual"] = actual
    return issue


def _contract_warning(code: str, message: str, path: str) -> dict[str, Any]:
    return {"code": code, "message": message, "path": path}
