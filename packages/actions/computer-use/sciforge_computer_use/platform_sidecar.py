"""Package-local Platform Sidecar MVP contract and diagnostic adapter.

The sidecar boundary is intentionally below ``packages/actions/computer-use``.
It describes typed L0 platform calls for capture, state, permission preflight,
and input execution without importing SciForge runtime or GUI implementation.
The local diagnostic adapter never performs real desktop input; when a real
backend is missing it writes refs-first blocked evidence.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform as host_platform
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, Mapping, Sequence


PLATFORM_SIDECAR_MANIFEST_SCHEMA = "sciforge.computer-use.platform-sidecar-manifest.v1"
PLATFORM_SIDECAR_RESULT_SCHEMA = "sciforge.computer-use.platform-sidecar-result.v1"
PLATFORM_SIDECAR_REF_RECORD_SCHEMA = "sciforge.computer-use.platform-sidecar-ref-record.v1"
PLATFORM_PERMISSION_PREFLIGHT_SCHEMA = "sciforge.computer-use.platform-permission-preflight.v1"
PLATFORM_ISOLATION_REPORT_SCHEMA = "sciforge.computer-use.platform-isolation-report.v1"
PLATFORM_CAPTURE_SNAPSHOT_SCHEMA = "sciforge.computer-use.platform-capture-snapshot.v1"
PLATFORM_STATE_SNAPSHOT_SCHEMA = "sciforge.computer-use.platform-state-snapshot.v1"
PLATFORM_EXECUTOR_EVENT_SCHEMA = "sciforge.computer-use.platform-sidecar-executor-event.v1"
PLATFORM_BLOCKED_DIAGNOSTIC_SCHEMA = "sciforge.computer-use.platform-sidecar-blocked-diagnostic.v1"

PlatformSidecarTool = Literal["preflight", "capture", "state", "execute"]
PLATFORM_SIDECAR_TOOLS: tuple[PlatformSidecarTool, ...] = ("preflight", "capture", "state", "execute")
SUPPORTED_INPUT_MODALITIES = ("pointer", "keyboard", "scroll", "hotkey")
MUTATING_INPUT_ACTIONS = {
    "click",
    "double_click",
    "drag",
    "type_text",
    "press_key",
    "hotkey",
    "scroll",
    "open_menu",
    "save",
}
UNSUPPORTED_ACTIONS = (
    "bare-global-coordinate-execute",
    "shared-system-input",
    "real-os-input-without-isolated-backend",
    "gui.present",
    "gui.ask_user",
    "workspace-write-policy",
    "provider-ranking",
    "planning",
    "user-level-completion",
    "completion-validator",
)
FORBIDDEN_INLINE_KEYS = {
    "base64",
    "inlineImage",
    "inline_image",
    "rawCapture",
    "raw_capture",
    "rawProviderPayload",
    "raw_provider_payload",
    "rawScreenshot",
    "raw_screenshot",
    "requestBody",
    "request_body",
}
SECRET_KEY_RE = re.compile(r"(authorization|api[-_]?key|token|secret|password|credential)", re.IGNORECASE)
DATA_IMAGE_RE = re.compile(r"^data:image/", re.IGNORECASE)
LONG_BASE64_RE = re.compile(r"^[A-Za-z0-9+/]{120,}={0,2}$")


@dataclass(frozen=True)
class PlatformSidecarContext:
    """Execution context for refs written by a sidecar adapter."""

    output_dir: str | Path | None = None
    platform: str = "diagnostic-local"
    adapter_id: str = "sciforge-platform-sidecar-diagnostic-local"

    @property
    def output_path(self) -> Path | None:
        if self.output_dir is None:
            return None
        return Path(self.output_dir).expanduser().resolve()


@dataclass(frozen=True)
class PermissionPreflightRequest:
    display_group_id: str | None = None
    screen_id: str | None = None
    session_permission_ref: str | None = None
    app_window_allowlist_ref: str | None = None
    risk_preview_ref: str | None = None
    data_visibility_ref: str | None = None
    stop_ref: str | None = None
    cancel_lease_ref: str | None = None
    input_modality_policy: Mapping[str, Any] = field(default_factory=dict)
    allowed_window_refs: Sequence[str] = field(default_factory=tuple)
    backend_kind: str = "diagnostic-local"
    metadata: Mapping[str, Any] = field(default_factory=dict)

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any]) -> "PermissionPreflightRequest":
        return cls(
            display_group_id=_string_or_none(payload.get("displayGroupId")),
            screen_id=_string_or_none(payload.get("screenId")),
            session_permission_ref=_string_or_none(payload.get("sessionPermissionRef")),
            app_window_allowlist_ref=_string_or_none(payload.get("appWindowAllowlistRef")),
            risk_preview_ref=_string_or_none(payload.get("riskPreviewRef")),
            data_visibility_ref=_string_or_none(payload.get("dataVisibilityRef")),
            stop_ref=_string_or_none(payload.get("stopRef")),
            cancel_lease_ref=_string_or_none(payload.get("cancelLeaseRef")),
            input_modality_policy=_mapping(payload.get("inputModalityPolicy")),
            allowed_window_refs=_string_list(payload.get("allowedWindowRefs")),
            backend_kind=_string_or_none(payload.get("backendKind")) or "diagnostic-local",
            metadata=_mapping(payload.get("metadata")),
        )


@dataclass(frozen=True)
class CaptureRequest:
    display_group_id: str
    screen_id: str
    window_id: str | None = None
    permission_preflight_ref: str | None = None
    capture_kind: str = "screen"
    metadata: Mapping[str, Any] = field(default_factory=dict)

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any]) -> "CaptureRequest":
        return cls(
            display_group_id=str(payload.get("displayGroupId") or ""),
            screen_id=str(payload.get("screenId") or ""),
            window_id=_string_or_none(payload.get("windowId")),
            permission_preflight_ref=_string_or_none(payload.get("permissionPreflightRef")),
            capture_kind=_string_or_none(payload.get("captureKind")) or "screen",
            metadata=_mapping(payload.get("metadata")),
        )


@dataclass(frozen=True)
class StateRequest:
    display_group_id: str
    screen_id: str
    window_id: str | None = None
    permission_preflight_ref: str | None = None
    state_kind: str = "app-state"
    metadata: Mapping[str, Any] = field(default_factory=dict)

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any]) -> "StateRequest":
        return cls(
            display_group_id=str(payload.get("displayGroupId") or ""),
            screen_id=str(payload.get("screenId") or ""),
            window_id=_string_or_none(payload.get("windowId")),
            permission_preflight_ref=_string_or_none(payload.get("permissionPreflightRef")),
            state_kind=_string_or_none(payload.get("stateKind")) or "app-state",
            metadata=_mapping(payload.get("metadata")),
        )


@dataclass(frozen=True)
class ExecuteRequest:
    action_kind: str
    target: Mapping[str, Any]
    display_group_id: str
    screen_id: str
    actor_id: str
    cursor_id: str
    lease_id: str
    scheduler_lease_ref: str
    lease_scope: Mapping[str, Any]
    window_id: str | None = None
    permission_preflight_ref: str | None = None
    before_evidence_refs: Sequence[str] = field(default_factory=tuple)
    grounding_refs: Sequence[str] = field(default_factory=tuple)
    metadata: Mapping[str, Any] = field(default_factory=dict)

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any]) -> "ExecuteRequest":
        action = _mapping(payload.get("action"))
        return cls(
            action_kind=_string_or_none(payload.get("actionKind")) or _string_or_none(action.get("kind")) or "unknown",
            target=_mapping(payload.get("target")),
            display_group_id=str(payload.get("displayGroupId") or ""),
            screen_id=str(payload.get("screenId") or ""),
            window_id=_string_or_none(payload.get("windowId")),
            actor_id=str(payload.get("actorId") or ""),
            cursor_id=str(payload.get("cursorId") or ""),
            lease_id=str(payload.get("leaseId") or ""),
            scheduler_lease_ref=str(payload.get("schedulerLeaseRef") or ""),
            lease_scope=_mapping(payload.get("leaseScope")),
            permission_preflight_ref=_string_or_none(payload.get("permissionPreflightRef")),
            before_evidence_refs=_string_list(payload.get("beforeEvidenceRefs")),
            grounding_refs=_string_list(payload.get("groundingRefs")),
            metadata=_mapping(payload.get("metadata")),
        )


class DiagnosticPlatformSidecarAdapter:
    """Diagnostic local sidecar that fails closed when no real backend exists."""

    def __init__(self, context: PlatformSidecarContext | None = None) -> None:
        self.context = context or PlatformSidecarContext()

    def preflight(self, request: PermissionPreflightRequest) -> dict[str, Any]:
        checks = _permission_preflight_checks(request)
        blocked_reasons = [check["reason"] for check in checks if not check["ok"]]
        blocked_reasons.append("No real platform backend is bound to the diagnostic local sidecar adapter.")
        isolation_report_ref = _write_ref(self.context, "isolation-report", _isolation_report_payload(
            platform=self.context.platform,
            status="blocked",
            reason="Diagnostic adapter has no isolated capture/state/input backend.",
        ))
        permission_ref = _write_ref(self.context, "permission-preflight", {
            "schemaVersion": PLATFORM_PERMISSION_PREFLIGHT_SCHEMA,
            "status": "blocked",
            "platform": self.context.platform,
            "adapterId": self.context.adapter_id,
            "displayGroupId": request.display_group_id,
            "screenId": request.screen_id,
            "sessionPermissionRef": request.session_permission_ref,
            "appWindowAllowlistRef": request.app_window_allowlist_ref,
            "allowedWindowRefs": list(request.allowed_window_refs),
            "riskPreviewRef": request.risk_preview_ref,
            "dataVisibilityRef": request.data_visibility_ref,
            "stopRef": request.stop_ref,
            "cancelLeaseRef": request.cancel_lease_ref,
            "inputModalityPolicy": dict(request.input_modality_policy),
            "backendKind": request.backend_kind,
            "preflightChecks": checks,
            "blockedReasons": blocked_reasons,
            "isolationReportRef": isolation_report_ref,
            "rawPayloadWritten": False,
            "inlineImageWritten": False,
            "secretsWritten": False,
        })
        return _result(
            "preflight",
            "blocked",
            "Platform sidecar diagnostic preflight is blocked until a real isolated backend is bound.",
            refs=[permission_ref, isolation_report_ref],
            value={
                "permissionPreflightRef": permission_ref,
                "isolationReportRef": isolation_report_ref,
                "preflightStatus": "blocked",
            },
            diagnostics={"blockedReasons": blocked_reasons},
        )

    def capture(self, request: CaptureRequest) -> dict[str, Any]:
        isolation_report_ref = _write_ref(self.context, "isolation-report", _isolation_report_payload(
            platform=self.context.platform,
            status="blocked",
            reason="Diagnostic adapter cannot capture a real screen or window.",
        ))
        snapshot_ref = _write_ref(self.context, "capture-snapshot", {
            "schemaVersion": PLATFORM_CAPTURE_SNAPSHOT_SCHEMA,
            "status": "blocked",
            "platform": self.context.platform,
            "adapterId": self.context.adapter_id,
            "displayGroupId": request.display_group_id,
            "screenId": request.screen_id,
            "windowId": request.window_id,
            "captureKind": request.capture_kind,
            "permissionPreflightRef": request.permission_preflight_ref,
            "screenshotRef": None,
            "stateRef": None,
            "blockedReason": "No real platform capture backend is bound.",
            "refsFirst": True,
            "rawScreenshotWritten": False,
            "rawPayloadWritten": False,
            "inlineImageWritten": False,
            "secretsWritten": False,
        })
        blocked_ref = _blocked_diagnostic("capture", snapshot_ref, isolation_report_ref, self.context)
        return _result(
            "capture",
            "blocked",
            "Capture requires a real platform sidecar backend; diagnostic adapter failed closed.",
            refs=[snapshot_ref, isolation_report_ref, blocked_ref],
            value={
                "captureSnapshotRef": snapshot_ref,
                "isolationReportRef": isolation_report_ref,
                "blockedDiagnosticRef": blocked_ref,
            },
        )

    def state(self, request: StateRequest) -> dict[str, Any]:
        isolation_report_ref = _write_ref(self.context, "isolation-report", _isolation_report_payload(
            platform=self.context.platform,
            status="blocked",
            reason="Diagnostic adapter cannot read focused-window or accessibility state.",
        ))
        state_ref = _write_ref(self.context, "state-snapshot", {
            "schemaVersion": PLATFORM_STATE_SNAPSHOT_SCHEMA,
            "status": "blocked",
            "platform": self.context.platform,
            "adapterId": self.context.adapter_id,
            "displayGroupId": request.display_group_id,
            "screenId": request.screen_id,
            "windowId": request.window_id,
            "stateKind": request.state_kind,
            "permissionPreflightRef": request.permission_preflight_ref,
            "focusedWindowRef": None,
            "accessibilityStateRef": None,
            "blockedReason": "No real platform state backend is bound.",
            "refsFirst": True,
            "rawPayloadWritten": False,
            "inlineImageWritten": False,
            "secretsWritten": False,
        })
        blocked_ref = _blocked_diagnostic("state", state_ref, isolation_report_ref, self.context)
        return _result(
            "state",
            "blocked",
            "State snapshot requires a real platform sidecar backend; diagnostic adapter failed closed.",
            refs=[state_ref, isolation_report_ref, blocked_ref],
            value={
                "stateSnapshotRef": state_ref,
                "isolationReportRef": isolation_report_ref,
                "blockedDiagnosticRef": blocked_ref,
            },
        )

    def execute(self, request: ExecuteRequest) -> dict[str, Any]:
        validation = _validate_execute_request(request)
        if not validation["ok"]:
            blocked_ref = _write_ref(self.context, "blocked-diagnostic", {
                "schemaVersion": PLATFORM_BLOCKED_DIAGNOSTIC_SCHEMA,
                "status": "blocked",
                "tool": "execute",
                "reason": validation["reason"],
                "validation": validation,
                "executorEventRef": None,
                "requiresSchedulerLease": True,
                "rawPayloadWritten": False,
                "inlineImageWritten": False,
                "secretsWritten": False,
            })
            return _result(
                "execute",
                "blocked",
                "Platform sidecar refused to write an executor event without scheduler lease binding.",
                refs=[blocked_ref],
                value={"blockedDiagnosticRef": blocked_ref, "executorEventRef": None},
                validation=validation,
            )

        isolation_report_ref = _write_ref(self.context, "isolation-report", _isolation_report_payload(
            platform=self.context.platform,
            status="blocked",
            reason="Diagnostic adapter did not execute real platform input.",
        ))
        executor_event_ref = _write_ref(self.context, "executor-event", {
            "schemaVersion": PLATFORM_EXECUTOR_EVENT_SCHEMA,
            "eventId": _digest({"leaseId": request.lease_id, "actionKind": request.action_kind, "target": request.target})[:16],
            "status": "blocked",
            "platform": self.context.platform,
            "adapterId": self.context.adapter_id,
            "actionKind": request.action_kind,
            "target": dict(request.target),
            "displayGroupId": request.display_group_id,
            "screenId": request.screen_id,
            "windowId": request.window_id,
            "actorId": request.actor_id,
            "cursorId": request.cursor_id,
            "leaseId": request.lease_id,
            "schedulerLeaseRef": request.scheduler_lease_ref,
            "leaseScope": dict(request.lease_scope),
            "schedulerLease": {
                "leaseId": request.lease_id,
                "leaseRef": request.scheduler_lease_ref,
                "leaseScope": dict(request.lease_scope),
                "displayGroupId": request.display_group_id,
                "screenId": request.screen_id,
                "windowId": request.window_id,
                "actorId": request.actor_id,
                "cursorId": request.cursor_id,
            },
            "permissionPreflightRef": request.permission_preflight_ref,
            "beforeEvidenceRefs": list(request.before_evidence_refs),
            "groundingRefs": list(request.grounding_refs),
            "afterEvidenceRefs": [],
            "verificationRefs": [],
            "isolationReportRef": isolation_report_ref,
            "mutatingActionRequested": request.action_kind in MUTATING_INPUT_ACTIONS,
            "mutatingActionExecuted": False,
            "diagnosticOnly": True,
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
            "rawPayloadWritten": False,
            "inlineImageWritten": False,
            "secretsWritten": False,
        })
        blocked_ref = _write_ref(self.context, "blocked-diagnostic", {
            "schemaVersion": PLATFORM_BLOCKED_DIAGNOSTIC_SCHEMA,
            "status": "blocked",
            "tool": "execute",
            "reason": "No real isolated platform executor backend is bound.",
            "executorEventRef": executor_event_ref,
            "isolationReportRef": isolation_report_ref,
            "requiresRealBackend": True,
            "rawPayloadWritten": False,
            "inlineImageWritten": False,
            "secretsWritten": False,
        })
        return _result(
            "execute",
            "blocked",
            "Execute requires a real platform sidecar backend; diagnostic adapter wrote a lease-bound blocked event.",
            refs=[executor_event_ref, isolation_report_ref, blocked_ref],
            value={
                "executorEventRef": executor_event_ref,
                "isolationReportRef": isolation_report_ref,
                "blockedDiagnosticRef": blocked_ref,
            },
        )


def get_platform_sidecar_manifest(platform: str | None = None) -> dict[str, Any]:
    """Return the Platform Sidecar MVP contract manifest."""

    normalized_platform = platform or _host_platform()
    return {
        "schemaVersion": PLATFORM_SIDECAR_MANIFEST_SCHEMA,
        "providerId": "sciforge.computer-use.platform-sidecar",
        "ownerPackage": "packages/actions/computer-use",
        "layer": "L0 platform backend",
        "platform": normalized_platform,
        "supportedPlatforms": ["diagnostic-local", "linux", "linux-novnc", "rdp", "darwin", "win32"],
        "diagnosticAdapterId": "sciforge-platform-sidecar-diagnostic-local",
        "diagnosticOnlyUntilRealBackendBound": True,
        "tools": [
            {
                "name": "preflight",
                "sideEffect": "none",
                "requiredFields": ["displayGroupId", "screenId", "sessionPermissionRef", "appWindowAllowlistRef"],
                "returnsRefs": ["permissionPreflightRef", "isolationReportRef"],
            },
            {
                "name": "capture",
                "sideEffect": "none",
                "requiredFields": ["displayGroupId", "screenId", "permissionPreflightRef"],
                "returnsRefs": ["captureSnapshotRef", "isolationReportRef", "blockedDiagnosticRef"],
            },
            {
                "name": "state",
                "sideEffect": "none",
                "requiredFields": ["displayGroupId", "screenId", "permissionPreflightRef"],
                "returnsRefs": ["stateSnapshotRef", "isolationReportRef", "blockedDiagnosticRef"],
            },
            {
                "name": "execute",
                "sideEffect": "platform-input-if-real-backend",
                "requiredFields": [
                    "displayGroupId",
                    "screenId",
                    "actorId",
                    "cursorId",
                    "leaseId",
                    "schedulerLeaseRef",
                    "leaseScope",
                    "permissionPreflightRef",
                    "beforeEvidenceRefs",
                    "groundingRefs",
                    "action",
                    "target",
                ],
                "returnsRefs": ["executorEventRef", "isolationReportRef", "blockedDiagnosticRef"],
            },
        ],
        "permissionRequirements": {
            "requiredRefs": [
                "sessionPermissionRef",
                "appWindowAllowlistRef",
                "riskPreviewRef",
                "dataVisibilityRef",
                "stopRef or cancelLeaseRef",
            ],
            "requiredPolicy": "inputModalityPolicy must declare allowed modalities and forbid shared system input.",
            "approvalOwner": "Codex app-server/native tool L2 host plus Computer Use scheduler",
            "guiRole": "presentation and terminal-equivalent confirmation only",
        },
        "isolationFlags": {
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
            "realOsInputExecuted": False,
            "rawPayloadWritten": False,
            "inlineImageWritten": False,
            "secretsWritten": False,
        },
        "supportedInputModalities": list(SUPPORTED_INPUT_MODALITIES),
        "executorEventSchema": {
            "schemaRef": PLATFORM_EXECUTOR_EVENT_SCHEMA,
            "requiredFields": [
                "eventId",
                "status",
                "actionKind",
                "displayGroupId",
                "screenId",
                "actorId",
                "cursorId",
                "leaseId",
                "schedulerLeaseRef",
                "leaseScope",
                "schedulerLease",
                "permissionPreflightRef",
                "beforeEvidenceRefs",
                "groundingRefs",
                "isolationReportRef",
            ],
            "schedulerLeaseBindingRequired": True,
            "blockedStatusAllowed": True,
        },
        "unsupportedActions": list(UNSUPPORTED_ACTIONS),
        "policies": {
            "refsFirst": True,
            "failClosedWithoutBackend": True,
            "noPlanning": True,
            "noCompletion": True,
            "noCapabilityRanking": True,
            "noWorkspaceWritePolicy": True,
            "noGuiDependency": True,
            "noRuntimePrivateDependency": True,
            "noSchedulerBypass": True,
        },
        "callableHelpers": {
            "manifestHelper": "sciforge_computer_use.platform_sidecar.get_platform_sidecar_manifest",
            "dispatcherHelper": "sciforge_computer_use.platform_sidecar.dispatch_platform_sidecar_tool",
            "validator": "sciforge_computer_use.platform_sidecar.validate_platform_sidecar_payload",
        },
        "claimLimit": (
            "The diagnostic local sidecar records contract, preflight, refs, isolation reports, and blocked "
            "executor events only. User-level completion requires a real platform sidecar backend plus scheduler "
            "lease, permission, evidence, and verifier refs from the same run."
        ),
    }


def validate_platform_sidecar_payload(tool: str, payload: Mapping[str, Any]) -> dict[str, Any]:
    """Validate payload shape without invoking platform side effects."""

    if tool not in PLATFORM_SIDECAR_TOOLS:
        return _validation(False, f"unsupported_tool:{tool}")
    if not isinstance(payload, Mapping):
        return _validation(False, "payload_must_be_object")
    forbidden = _find_forbidden_inline_payloads(payload)
    if forbidden:
        return _validation(False, "forbidden_inline_payload", forbiddenPaths=forbidden)
    if tool == "execute":
        return _validate_execute_request(ExecuteRequest.from_payload(payload))
    missing = [field for field in _required_fields(tool) if not _field_present(payload, field)]
    if missing:
        return _validation(False, "missing_required_fields", missingFields=missing)
    return _validation(True)


def dispatch_platform_sidecar_tool(
    tool: str,
    payload: Mapping[str, Any],
    *,
    output_dir: str | Path | None = None,
    platform: str | None = None,
) -> dict[str, Any]:
    """Dispatch a typed platform sidecar diagnostic call."""

    if tool not in PLATFORM_SIDECAR_TOOLS:
        return _result(tool, "failed", f"unsupported_tool:{tool}", refs=[], validation=_validation(False, f"unsupported_tool:{tool}"))
    if not isinstance(payload, Mapping):
        return _result(tool, "failed", "payload_must_be_object", refs=[], validation=_validation(False, "payload_must_be_object"))
    forbidden = _find_forbidden_inline_payloads(payload)
    if forbidden:
        return _result(
            tool,
            "failed",
            "forbidden_inline_payload",
            refs=[],
            validation=_validation(False, "forbidden_inline_payload", forbiddenPaths=forbidden),
        )

    adapter = DiagnosticPlatformSidecarAdapter(PlatformSidecarContext(output_dir=output_dir, platform=platform or "diagnostic-local"))
    if tool == "preflight":
        return adapter.preflight(PermissionPreflightRequest.from_payload(payload))
    if tool == "capture":
        validation = validate_platform_sidecar_payload(tool, payload)
        if not validation["ok"]:
            return _result(tool, "failed", validation["reason"], refs=[], validation=validation)
        return adapter.capture(CaptureRequest.from_payload(payload))
    if tool == "state":
        validation = validate_platform_sidecar_payload(tool, payload)
        if not validation["ok"]:
            return _result(tool, "failed", validation["reason"], refs=[], validation=validation)
        return adapter.state(StateRequest.from_payload(payload))
    return adapter.execute(ExecuteRequest.from_payload(payload))


dispatchPlatformSidecarTool = dispatch_platform_sidecar_tool
getPlatformSidecarManifest = get_platform_sidecar_manifest
validatePlatformSidecarPayload = validate_platform_sidecar_payload


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run a package-local Computer Use platform sidecar diagnostic tool.")
    parser.add_argument("--tool", required=True, choices=[*PLATFORM_SIDECAR_TOOLS, "manifest"])
    parser.add_argument("--payload-json", help="Tool payload JSON. If omitted, stdin is read as JSON.")
    parser.add_argument("--output-dir", help="Directory for refs-first sidecar records.")
    parser.add_argument("--platform", help="Override platform name for diagnostics.")
    args = parser.parse_args(argv)

    try:
        if args.tool == "manifest":
            result: Mapping[str, Any] = get_platform_sidecar_manifest(platform=args.platform)
        else:
            payload = _load_payload(args.payload_json)
            result = dispatch_platform_sidecar_tool(
                args.tool,
                payload,
                output_dir=args.output_dir,
                platform=args.platform,
            )
    except Exception as exc:  # noqa: BLE001 - CLI must keep stdout structured.
        result = _result(args.tool, "failed", f"platform_sidecar_error:{exc}", refs=[])
    print(json.dumps(result, sort_keys=True))
    return 0 if result.get("status") == "completed" else 1


def _permission_preflight_checks(request: PermissionPreflightRequest) -> list[dict[str, Any]]:
    modalities = _string_list(request.input_modality_policy.get("allowed") or request.input_modality_policy.get("allowedModalities"))
    return [
        _check(bool(request.display_group_id), "display-group", "displayGroupId is required."),
        _check(bool(request.screen_id), "screen", "screenId is required."),
        _check(bool(request.session_permission_ref), "session-permission", "sessionPermissionRef is required."),
        _check(bool(request.app_window_allowlist_ref or request.allowed_window_refs), "app-window-allowlist", "App/window allowlist ref is required."),
        _check(bool(request.risk_preview_ref), "risk-preview", "riskPreviewRef is required."),
        _check(bool(request.data_visibility_ref), "data-visibility", "dataVisibilityRef is required."),
        _check(bool(request.stop_ref or request.cancel_lease_ref), "stop-or-cancel", "stopRef or cancelLeaseRef is required."),
        _check(bool(modalities), "input-modality-policy", "inputModalityPolicy.allowed or allowedModalities is required."),
        _check(
            all(item in SUPPORTED_INPUT_MODALITIES for item in modalities),
            "supported-input-modalities",
            "inputModalityPolicy includes an unsupported modality.",
        ),
        _check(
            request.input_modality_policy.get("sharedSystemInputAllowed") is False,
            "shared-system-input-forbidden",
            "inputModalityPolicy.sharedSystemInputAllowed must be false.",
        ),
    ]


def _validate_execute_request(request: ExecuteRequest) -> dict[str, Any]:
    missing = [
        field
        for field, value in {
            "displayGroupId": request.display_group_id,
            "screenId": request.screen_id,
            "actorId": request.actor_id,
            "cursorId": request.cursor_id,
            "leaseId": request.lease_id,
            "schedulerLeaseRef": request.scheduler_lease_ref,
            "permissionPreflightRef": request.permission_preflight_ref,
        }.items()
        if not value
    ]
    if missing:
        return _validation(False, "missing_required_fields", missingFields=missing)
    if not request.lease_scope:
        return _validation(False, "invalid_lease_scope")
    scope_kind = str(request.lease_scope.get("kind") or request.lease_scope.get("scope") or "")
    if scope_kind not in {"screen", "screen-global", "window", "window-local"}:
        return _validation(False, "invalid_lease_scope")
    if scope_kind.startswith("window") and not (request.window_id or request.lease_scope.get("windowId")):
        return _validation(False, "missing_window_id_for_window_lease")
    if not request.before_evidence_refs:
        return _validation(False, "missing_before_evidence_refs")
    if not request.grounding_refs:
        return _validation(False, "missing_grounding_refs")
    if not request.target:
        return _validation(False, "invalid_target")
    if _is_bare_global_target(request.target):
        return _validation(False, "bare_global_coordinate_target")
    if request.action_kind in {"planning", "complete", "completion", "rank_capability", "provider_route"}:
        return _validation(False, "unsupported_action", actionKind=request.action_kind)
    return _validation(True)


def _isolation_report_payload(*, platform: str, status: str, reason: str) -> dict[str, Any]:
    return {
        "schemaVersion": PLATFORM_ISOLATION_REPORT_SCHEMA,
        "status": status,
        "platform": platform,
        "reason": reason,
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
        "realOsInputExecuted": False,
        "rawPayloadWritten": False,
        "inlineImageWritten": False,
        "secretsWritten": False,
        "diagnosticOnly": True,
        "userAcceptanceEligible": False,
    }


def _blocked_diagnostic(tool: str, primary_ref: str, isolation_report_ref: str, context: PlatformSidecarContext) -> str:
    return _write_ref(context, "blocked-diagnostic", {
        "schemaVersion": PLATFORM_BLOCKED_DIAGNOSTIC_SCHEMA,
        "status": "blocked",
        "tool": tool,
        "reason": "No real platform sidecar backend is bound.",
        "primaryRef": primary_ref,
        "isolationReportRef": isolation_report_ref,
        "requiresRealBackend": True,
        "rawPayloadWritten": False,
        "inlineImageWritten": False,
        "secretsWritten": False,
    })


def _result(
    tool: str,
    status: str,
    reason: str,
    *,
    refs: Sequence[str],
    value: Mapping[str, Any] | None = None,
    diagnostics: Mapping[str, Any] | None = None,
    validation: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "schemaVersion": PLATFORM_SIDECAR_RESULT_SCHEMA,
        "tool": tool,
        "status": status,
        "reason": reason,
        "refs": list(refs),
        "value": dict(value or {}),
        "diagnosticOnly": True,
        "userAcceptanceEligible": False,
        "planningPerformed": False,
        "completionJudged": False,
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
        "realOsInputExecuted": False,
        "rawPayloadWritten": False,
        "inlineImageWritten": False,
        "secretsWritten": False,
    }
    if diagnostics is not None:
        result["diagnostics"] = dict(diagnostics)
    if validation is not None:
        result["validation"] = dict(validation)
    return result


def _write_ref(context: PlatformSidecarContext, prefix: str, payload: Mapping[str, Any]) -> str:
    record = {
        "schemaVersion": PLATFORM_SIDECAR_REF_RECORD_SCHEMA,
        "createdAt": _now(),
        **dict(payload),
    }
    if context.output_path is None:
        digest = _digest({"prefix": prefix, "payload": record})
        return f"computer-use-platform-sidecar:{prefix}/{digest}.json"
    context.output_path.mkdir(parents=True, exist_ok=True)
    digest = _digest(record)
    path = context.output_path / f"platform-sidecar-{prefix}-{digest}.json"
    path.write_text(json.dumps(record, indent=2, sort_keys=True) + "\n", encoding="utf8")
    return str(path)


def _required_fields(tool: str) -> list[str]:
    for entry in get_platform_sidecar_manifest()["tools"]:
        if entry["name"] == tool:
            return list(entry.get("requiredFields") or [])
    return []


def _field_present(payload: Mapping[str, Any], field: str) -> bool:
    value = payload.get(field)
    return value not in (None, "", [], {})


def _check(ok: bool, category: str, reason: str) -> dict[str, Any]:
    return {"category": category, "ok": bool(ok), "reason": "" if ok else reason}


def _validation(ok: bool, reason: str = "ok", **extra: Any) -> dict[str, Any]:
    return {"ok": ok, "reason": reason, **extra}


def _find_forbidden_inline_payloads(value: Any, *, path: str = "$") -> list[str]:
    found: list[str] = []
    if isinstance(value, Mapping):
        for key, item in value.items():
            key_text = str(key)
            item_path = f"{path}.{key_text}"
            if key_text in FORBIDDEN_INLINE_KEYS or SECRET_KEY_RE.search(key_text):
                found.append(item_path)
            found.extend(_find_forbidden_inline_payloads(item, path=item_path))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            found.extend(_find_forbidden_inline_payloads(item, path=f"{path}[{index}]"))
    elif isinstance(value, str):
        stripped = value.strip()
        if DATA_IMAGE_RE.match(stripped) or LONG_BASE64_RE.match(stripped):
            found.append(path)
    return found


def _is_bare_global_target(target: Mapping[str, Any]) -> bool:
    coordinate_space = str(target.get("coordinateSpace") or target.get("coordinate_space") or "").lower()
    has_xy = isinstance(target.get("x"), (int, float)) and isinstance(target.get("y"), (int, float))
    has_scope_binding = any(target.get(key) for key in ("screenId", "windowId", "elementRef", "regionRef", "bounds"))
    return coordinate_space in {"global", "system", "desktop", "absolute"} or (has_xy and not has_scope_binding)


def _load_payload(payload_json: str | None) -> Mapping[str, Any]:
    raw = payload_json if payload_json is not None else sys.stdin.read()
    parsed = json.loads(raw or "{}")
    if not isinstance(parsed, Mapping):
        raise ValueError("payload must be a JSON object")
    return parsed


def _mapping(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, Mapping) else {}


def _string_or_none(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _string_list(value: Any) -> list[str]:
    if isinstance(value, str) and value:
        return [value]
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return [str(item) for item in value if isinstance(item, str) and item]
    return []


def _host_platform() -> str:
    system = host_platform.system().strip().lower()
    if system == "darwin":
        return "darwin"
    if system == "windows":
        return "win32"
    if system == "linux":
        return "linux"
    return system or "diagnostic-local"


def _digest(value: Mapping[str, Any]) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode("utf8")
    return hashlib.sha256(raw).hexdigest()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


__all__ = [
    "PLATFORM_SIDECAR_MANIFEST_SCHEMA",
    "PLATFORM_SIDECAR_RESULT_SCHEMA",
    "PLATFORM_PERMISSION_PREFLIGHT_SCHEMA",
    "PLATFORM_ISOLATION_REPORT_SCHEMA",
    "PLATFORM_CAPTURE_SNAPSHOT_SCHEMA",
    "PLATFORM_STATE_SNAPSHOT_SCHEMA",
    "PLATFORM_EXECUTOR_EVENT_SCHEMA",
    "PlatformSidecarContext",
    "PermissionPreflightRequest",
    "CaptureRequest",
    "StateRequest",
    "ExecuteRequest",
    "DiagnosticPlatformSidecarAdapter",
    "dispatchPlatformSidecarTool",
    "dispatch_platform_sidecar_tool",
    "getPlatformSidecarManifest",
    "get_platform_sidecar_manifest",
    "validatePlatformSidecarPayload",
    "validate_platform_sidecar_payload",
]


if __name__ == "__main__":
    raise SystemExit(main())
