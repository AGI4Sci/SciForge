"""Virtual display provider contract for VirtualAppScreen adapters.

The package-level contract is intentionally refs-first and fail-closed. It
describes mature provider backends, probes host readiness, and prepares the
evidence refs that a runtime provider adapter must materialize. It does not
install drivers, start privileged services, or send shared system input.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, Mapping, Sequence

from .contracts import ACTION_ADAPTER_READINESS_SCHEMA, ActionAdapterReadiness


VIRTUAL_DISPLAY_PROVIDER_DESCRIPTION_SCHEMA = "sciforge.virtual-display.provider-description.v1"
VIRTUAL_DISPLAY_READINESS_SCHEMA = "sciforge.virtual-display.readiness.v1"
VIRTUAL_DISPLAY_PROVIDER_PROBE_BUNDLE_SCHEMA = "sciforge.virtual-display.provider-probe-bundle.v1"
VIRTUAL_DISPLAY_PROVIDER_INVOKE_RESULT_SCHEMA = "sciforge.virtual-display.provider-invoke-result.v1"

VirtualDisplayProviderStatus = Literal["ready", "blocked"]
VirtualDisplayInstallState = Literal["installed", "installable", "unsupported"]
VirtualDisplayInvokeStatus = Literal["ready", "blocked", "requires-handoff"]
VirtualDisplayAttachState = Literal[
    "attached",
    "adapter-unavailable",
    "observe-only",
    "blocked",
    "requires-handoff",
]
VirtualDisplayInvokeIntent = Literal[
    "probe",
    "createSession",
    "launchApp",
    "attachSurface",
    "executeInputIntent",
    "pause",
    "resume",
    "closeSession",
    "handoff",
]


SAFE_VIRTUAL_DISPLAY_ACTIONS = ("click", "type_text", "drag", "scroll", "hotkey", "menu_command")


@dataclass(frozen=True)
class VirtualDisplayProviderCapabilities:
    create_display: bool = True
    launch_app: bool = True
    attach_window: bool = True
    capture_frame: bool = True
    stream_frames: bool = True
    execute_input_intent: bool = True
    background_renderable: bool = True
    affects_physical_display: bool = False
    requires_focus_steal: bool = False
    shared_system_input_used: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "createDisplay": self.create_display,
            "launchApp": self.launch_app,
            "attachWindow": self.attach_window,
            "captureFrame": self.capture_frame,
            "streamFrames": self.stream_frames,
            "executeInputIntent": self.execute_input_intent,
            "backgroundRenderable": self.background_renderable,
            "affectsPhysicalDisplay": self.affects_physical_display,
            "requiresFocusSteal": self.requires_focus_steal,
            "sharedSystemInputUsed": self.shared_system_input_used,
        }


@dataclass(frozen=True)
class VirtualDisplayProviderDefinition:
    provider_id: str
    platform: str
    backend_kind: str
    host_platforms: Sequence[str]
    priority: int
    supported_apps: Sequence[str]
    supported_transports: Sequence[str]
    supported_input_adapters: Sequence[str]
    capabilities: VirtualDisplayProviderCapabilities = field(default_factory=VirtualDisplayProviderCapabilities)
    required_commands: Sequence[str] = field(default_factory=tuple)
    any_command_groups: Sequence[Sequence[str]] = field(default_factory=tuple)
    required_node_packages: Sequence[str] = field(default_factory=tuple)
    manual_requirement_keys: Sequence[str] = field(default_factory=tuple)
    permission_refs: Sequence[str] = field(default_factory=tuple)
    install_hints: Sequence[str] = field(default_factory=tuple)
    install_hint_refs: Sequence[str] = field(default_factory=tuple)
    transport_preference: Sequence[str] = field(default_factory=tuple)
    blocked_reason: str | None = None

    def description(self) -> dict[str, Any]:
        payload = {
            "schemaVersion": VIRTUAL_DISPLAY_PROVIDER_DESCRIPTION_SCHEMA,
            "providerId": self.provider_id,
            "platform": self.platform,
            "backendKind": self.backend_kind,
            "supportedApps": list(self.supported_apps),
            "supportedTransports": list(self.supported_transports),
            "supportedInputAdapters": list(self.supported_input_adapters),
            "capabilities": self.capabilities.as_dict(),
            "permissionRefs": list(self.permission_refs),
            "blockedReason": self.blocked_reason,
        }
        return _drop_none(payload)


def describe_virtual_display_providers(platform: str | None = None) -> list[dict[str, Any]]:
    """Return refs-safe provider descriptions for the host platform."""

    return [definition.description() for definition in _provider_definitions(platform or sys.platform)]


def query_virtual_display_providers(
    *,
    platform: str | None = None,
    target_app_kind: str | None = None,
    backend_kind: str | None = None,
    supported_transport: str | None = None,
    supported_input_adapter: str | None = None,
) -> list[dict[str, Any]]:
    target = _normalize_target_app_kind(target_app_kind or "generic") if target_app_kind else None
    providers = describe_virtual_display_providers(platform)
    if target:
        providers = [provider for provider in providers if _supports_target_app(provider, target)]
    if backend_kind:
        providers = [provider for provider in providers if provider["backendKind"] == backend_kind]
    if supported_transport:
        providers = [
            provider for provider in providers if supported_transport in provider["supportedTransports"]
        ]
    if supported_input_adapter:
        providers = [
            provider for provider in providers if supported_input_adapter in provider["supportedInputAdapters"]
        ]
    return providers


def read_virtual_display_provider(
    provider_id: str,
    *,
    platform: str | None = None,
) -> dict[str, Any] | None:
    return next(
        (provider for provider in describe_virtual_display_providers(platform) if provider["providerId"] == provider_id),
        None,
    )


def probe_virtual_display_providers(
    *,
    platform: str | None = None,
    target_app_kind: str = "vscode",
    command_availability: Mapping[str, bool] | None = None,
    node_package_availability: Mapping[str, bool] | None = None,
    manual_requirement_availability: Mapping[str, bool] | None = None,
    permission_grants: Mapping[str, bool] | None = None,
) -> dict[str, Any]:
    host_platform = platform or sys.platform
    target = _normalize_target_app_kind(target_app_kind)
    probe_options = {
        "platform": host_platform,
        "target_app_kind": target,
        "command_availability": dict(command_availability or {}),
        "node_package_availability": dict(node_package_availability or {}),
        "manual_requirement_availability": dict(manual_requirement_availability or {}),
        "permission_grants": dict(permission_grants or {}),
    }
    probes = [
        _probe_provider(definition, probe_options)
        for definition in _provider_definitions(host_platform)
        if _supports_target_app(definition.description(), target)
    ]
    probes.sort(key=lambda probe: (probe["priority"], probe["description"]["providerId"]))
    selected = select_virtual_display_provider_probe(probes)
    selected_readiness = selected.get("readiness") if selected else None
    ready = is_virtual_display_readiness_controllable(selected_readiness)
    blocked_reason = None
    if selected_readiness and not ready:
        blocked_reason = selected_readiness.get("blockedReason")
    elif not probes:
        blocked_reason = f'No VirtualDisplayProvider profile supports target app kind "{target}" on {host_platform}.'
    return _drop_none({
        "schemaVersion": VIRTUAL_DISPLAY_PROVIDER_PROBE_BUNDLE_SCHEMA,
        "targetAppKind": target,
        "hostPlatform": str(host_platform),
        "selectedProviderId": selected["description"]["providerId"] if selected else None,
        "probes": probes,
        "selectedReadiness": selected_readiness,
        "status": "ready" if ready else "blocked",
        "blockedReason": blocked_reason,
    })


def select_virtual_display_provider_probe(probes: Sequence[Mapping[str, Any]]) -> Mapping[str, Any] | None:
    for probe in probes:
        if is_virtual_display_readiness_controllable(_mapping_or_none(probe.get("readiness"))):
            return probe
    for probe in probes:
        if probe.get("installState") == "installed":
            return probe
    for probe in probes:
        if probe.get("installState") == "installable":
            return probe
    return probes[0] if probes else None


def is_virtual_display_readiness_controllable(readiness: Mapping[str, Any] | None) -> bool:
    if not readiness:
        return False
    return (
        readiness.get("captureSupported") is True
        and readiness.get("liveSurfaceSupported") is True
        and readiness.get("inputSupported") is True
        and readiness.get("backgroundRenderable") is True
        and readiness.get("affectsPhysicalDisplay") is False
        and readiness.get("requiresFocusSteal") is False
        and readiness.get("sharedSystemInputUsed") is False
        and readiness.get("systemPointerMoved") is False
        and readiness.get("systemKeyboardEventsSent") is False
        and readiness.get("singleInteractiveTruth") is True
        and not readiness.get("blockedReason")
    )


def virtual_display_readiness_to_action_adapter_readiness(
    readiness: Mapping[str, Any],
    *,
    readiness_ref: str | None = None,
    capability_ref: str | None = None,
) -> dict[str, Any]:
    """Project provider readiness into the shared ActionAdapter readiness schema."""

    return ActionAdapterReadiness(
        adapter_id=str(readiness.get("providerId") or "virtual-display-provider"),
        adapter_kind=str(readiness.get("backendKind") or "virtual-display-provider"),
        target_scope="virtual-app-screen",
        supported_actions=SAFE_VIRTUAL_DISPLAY_ACTIONS if readiness.get("inputSupported") is True else (),
        capture_supported=readiness.get("captureSupported") is True,
        background_renderable=readiness.get("backgroundRenderable") is True,
        affects_physical_display=readiness.get("affectsPhysicalDisplay") is True,
        requires_focus_steal=readiness.get("requiresFocusSteal") is True,
        shared_system_input_used=readiness.get("sharedSystemInputUsed") is True,
        ready=is_virtual_display_readiness_controllable(readiness),
        blocked_reason=_string_or_none(readiness.get("blockedReason")),
        readiness_ref=readiness_ref,
        capability_ref=capability_ref,
        schema_refs=(ACTION_ADAPTER_READINESS_SCHEMA, VIRTUAL_DISPLAY_READINESS_SCHEMA),
        metadata={
            "providerId": readiness.get("providerId"),
            "selectedTransport": readiness.get("selectedTransport"),
            "singleInteractiveTruth": readiness.get("singleInteractiveTruth") is True,
        },
    ).as_dict()


def build_virtual_display_screen_payload(
    *,
    run_id: str,
    probe_bundle: Mapping[str, Any],
    target_app_kind: str | None = None,
    target_app_name: str | None = None,
) -> dict[str, Any]:
    safe_run_id = _sanitize_ref_segment(run_id)
    target = _normalize_target_app_kind(target_app_kind or str(probe_bundle.get("targetAppKind") or "vscode"))
    app_name = target_app_name or ("VSCode" if target == "vscode" else target)
    readiness = _mapping_or_none(probe_bundle.get("selectedReadiness"))
    ready = is_virtual_display_readiness_controllable(readiness)
    base_ref = f".sciforge/vision-runs/{safe_run_id}/virtual-display-provider"
    target_app_ref = f"app:{safe_run_id}/{_sanitize_ref_segment(target)}"
    blocked_reason = (
        _string_or_none(readiness.get("blockedReason")) if readiness else None
    ) or _string_or_none(probe_bundle.get("blockedReason")) or "VirtualDisplayProvider is not ready for isolated background control."

    return _drop_none({
        "title": f"{app_name} VirtualAppScreen",
        "status": "ready" if ready else "blocked",
        "attachState": "attached" if ready else _attach_state_for_readiness(readiness),
        "displayGroupRef": f"virtual-display-group:{safe_run_id}" if ready else None,
        "screenRef": f"virtual-app-screen:{safe_run_id}/screen",
        "liveSurfaceRef": f"{base_ref}/live-surface.json" if ready else None,
        "surfaceTransport": readiness.get("selectedTransport") if ready and readiness else None,
        "targetAppRef": target_app_ref,
        "targetWindowRef": f"window:{safe_run_id}/{_sanitize_ref_segment(target)}/main" if ready else None,
        "sessionRef": f"computer-use:session/{safe_run_id}/virtual-display-session.json" if ready else None,
        "frameStreamRef": f"{base_ref}/frame-stream.json" if ready else None,
        "currentFrameRef": f"{base_ref}/frames/after.json" if ready else None,
        "beforeFrameRef": f"{base_ref}/frames/before.json" if ready else None,
        "afterFrameRef": f"{base_ref}/frames/after.json" if ready else None,
        "beforeAfterFrameRefs": [f"{base_ref}/before-after/input.json"] if ready else [],
        "inputIntentRefs": [f"{base_ref}/input-intents/click-and-type.json"] if ready else [],
        "executorEventRefs": [f"{base_ref}/executor-events/click-and-type.json"] if ready else [],
        "inputLeaseRef": f"{base_ref}/input-lease.json" if ready else None,
        "actionAdapterRef": f"{base_ref}/action-adapter.json" if ready else None,
        "adapterReadinessRef": f"{base_ref}/adapter-readiness.json",
        "replayRef": f"{base_ref}/replay.json" if ready else None,
        "evidenceLedgerRef": f"{base_ref}/evidence-ledger.json" if ready else None,
        "artifactRefs": [f"artifact:{safe_run_id}/vscode-virtual-screen-note.md"] if ready else [],
        "verificationRefs": [f"{base_ref}/verification/vscode-input.json"] if ready else [],
        "guiPresentRefs": [f"gui:present/{safe_run_id}/screen-pane"] if ready else [],
        "blockedRef": None if ready else f"{base_ref}/blocked.json",
        "blockedReason": None if ready else blocked_reason,
        "screen": {"width": 1440, "height": 900, "label": f"{app_name} virtual app surface"},
        "isolationFlags": {
            "affectsPhysicalDisplay": readiness.get("affectsPhysicalDisplay") is True if readiness else False,
            "requiresFocusSteal": readiness.get("requiresFocusSteal") is True if readiness else False,
            "sharedSystemInputUsed": readiness.get("sharedSystemInputUsed") is True if readiness else False,
            "systemPointerMoved": readiness.get("systemPointerMoved") is True if readiness else False,
            "systemKeyboardEventsSent": readiness.get("systemKeyboardEventsSent") is True if readiness else False,
            "backgroundRenderable": ready,
            "diagnosticOnly": not ready,
        },
    })


def invoke_virtual_display_provider(
    *,
    intent: VirtualDisplayInvokeIntent,
    run_id: str,
    target_app_kind: str = "vscode",
    target_app_name: str | None = None,
    probe_bundle: Mapping[str, Any] | None = None,
    probe_options: Mapping[str, Any] | None = None,
    blocked_reason: str | None = None,
) -> dict[str, Any]:
    options = dict(probe_options or {})
    bundle = dict(probe_bundle or probe_virtual_display_providers(
        target_app_kind=target_app_kind,
        platform=_string_or_none(options.get("platform")),
        command_availability=_mapping_or_none(options.get("command_availability")),
        node_package_availability=_mapping_or_none(options.get("node_package_availability")),
        manual_requirement_availability=_mapping_or_none(options.get("manual_requirement_availability")),
        permission_grants=_mapping_or_none(options.get("permission_grants")),
    ))
    readiness = _mapping_or_none(bundle.get("selectedReadiness"))
    ready = is_virtual_display_readiness_controllable(readiness)
    payload = build_virtual_display_screen_payload(
        run_id=run_id,
        target_app_kind=target_app_kind,
        target_app_name=target_app_name,
        probe_bundle=bundle,
    )
    if intent == "probe":
        reason = None if ready else (_string_or_none(readiness.get("blockedReason")) if readiness else None) or _string_or_none(bundle.get("blockedReason"))
        return _drop_none({
            "schemaVersion": VIRTUAL_DISPLAY_PROVIDER_INVOKE_RESULT_SCHEMA,
            "intent": intent,
            "providerId": bundle.get("selectedProviderId"),
            "status": "ready" if ready else _status_for_blocked_reason(reason),
            "refs": {
                "adapterReadinessRef": payload["adapterReadinessRef"],
                "providerProbeRef": f".sciforge/vision-runs/{_sanitize_ref_segment(run_id)}/virtual-display-provider/probe-bundle.json",
                "blockedRef": None if ready else payload.get("blockedRef"),
            },
            "readiness": readiness,
            "blockedReason": reason,
            "mutatingActionExecuted": False,
            "rawPayloadWritten": False,
        })

    if not ready:
        reason = blocked_reason or (_string_or_none(readiness.get("blockedReason")) if readiness else None) or _string_or_none(bundle.get("blockedReason")) or "VirtualDisplayProvider is not ready."
        return _drop_none({
            "schemaVersion": VIRTUAL_DISPLAY_PROVIDER_INVOKE_RESULT_SCHEMA,
            "intent": intent,
            "providerId": bundle.get("selectedProviderId"),
            "status": _status_for_blocked_reason(reason),
            "refs": {
                "adapterReadinessRef": payload["adapterReadinessRef"],
                "blockedRef": payload.get("blockedRef"),
            },
            "readiness": readiness,
            "blockedReason": reason,
            "mutatingActionExecuted": False,
            "rawPayloadWritten": False,
        })

    return _ready_invoke_result(intent, payload, readiness)


def validate_virtual_display_readiness(readiness: Mapping[str, Any]) -> dict[str, Any]:
    """Validate readiness shape and return fail-closed isolation blockers."""

    errors: list[dict[str, Any]] = []
    if readiness.get("schemaVersion") != VIRTUAL_DISPLAY_READINESS_SCHEMA:
        errors.append({"code": "schema_version_invalid", "path": "$.schemaVersion"})
    for key in (
        "providerId",
        "platform",
        "backendKind",
        "installationStatus",
    ):
        if not isinstance(readiness.get(key), str) or not str(readiness.get(key)).strip():
            errors.append({"code": "required_string_missing", "path": f"$.{key}"})
    if readiness.get("installationStatus") not in {"installed", "installable", "unsupported"}:
        errors.append({"code": "installation_status_invalid", "path": "$.installationStatus"})
    for key in (
        "captureSupported",
        "liveSurfaceSupported",
        "inputSupported",
        "backgroundRenderable",
        "affectsPhysicalDisplay",
        "requiresFocusSteal",
        "sharedSystemInputUsed",
        "systemPointerMoved",
        "systemKeyboardEventsSent",
        "singleInteractiveTruth",
    ):
        if not isinstance(readiness.get(key), bool):
            errors.append({"code": "required_bool_missing", "path": f"$.{key}"})
    for key in ("permissionRefs", "diagnosticRefs", "installHintRefs"):
        value = readiness.get(key)
        if not isinstance(value, list) or any(not isinstance(item, str) or not item for item in value):
            errors.append({"code": "required_ref_list_missing", "path": f"$.{key}"})
    blockers = _readiness_isolation_blockers(readiness)
    if blockers and not _string_or_none(readiness.get("blockedReason")):
        errors.append({"code": "blocked_reason_required", "path": "$.blockedReason"})
    return {
        "schemaVersion": "sciforge.virtual-display.readiness-validation.v1",
        "ok": not errors,
        "providerId": readiness.get("providerId"),
        "controllable": is_virtual_display_readiness_controllable(readiness),
        "isolationBlockers": blockers,
        "errorCount": len(errors),
        "errors": errors,
    }


def build_virtual_display_provider_manifest() -> dict[str, Any]:
    providers = [definition.description() for definition in _canonical_provider_definitions()]
    provider_ids = [provider["providerId"] for provider in providers]
    return {
        "schemaVersion": "sciforge.virtual-display.provider-contract.v1",
        "descriptionSchemaRef": VIRTUAL_DISPLAY_PROVIDER_DESCRIPTION_SCHEMA,
        "readinessSchemaRef": VIRTUAL_DISPLAY_READINESS_SCHEMA,
        "probeBundleSchemaRef": VIRTUAL_DISPLAY_PROVIDER_PROBE_BUNDLE_SCHEMA,
        "invokeResultSchemaRef": VIRTUAL_DISPLAY_PROVIDER_INVOKE_RESULT_SCHEMA,
        "providerIds": provider_ids,
        "platformBackends": {
            provider["providerId"]: provider["backendKind"]
            for provider in providers
        },
        "supportedTransports": sorted({
            transport
            for provider in providers
            for transport in provider["supportedTransports"]
        }),
        "supportedInputAdapters": sorted({
            adapter
            for provider in providers
            for adapter in provider["supportedInputAdapters"]
        }),
        "invokeIntents": [
            "probe",
            "createSession",
            "launchApp",
            "attachSurface",
            "executeInputIntent",
            "pause",
            "resume",
            "closeSession",
            "handoff",
        ],
        "requiredReadinessFields": [
            "providerId",
            "platform",
            "backendKind",
            "installationStatus",
            "captureSupported",
            "liveSurfaceSupported",
            "inputSupported",
            "backgroundRenderable",
            "affectsPhysicalDisplay",
            "requiresFocusSteal",
            "sharedSystemInputUsed",
            "systemPointerMoved",
            "systemKeyboardEventsSent",
            "singleInteractiveTruth",
            "permissionRefs",
            "diagnosticRefs",
            "installHintRefs",
        ],
        "requiredFalseFlags": [
            "affectsPhysicalDisplay",
            "requiresFocusSteal",
            "sharedSystemInputUsed",
            "systemPointerMoved",
            "systemKeyboardEventsSent",
        ],
        "claimLimit": (
            "The provider contract proves catalog, probe, and refs-first invocation boundaries only. "
            "A VirtualAppScreen pass still requires current-session create/launch/live-frame/input/before-after evidence from a ready host adapter."
        ),
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Probe refs-first VirtualDisplayProvider readiness.")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--run-id", default="virtual-display-provider-probe")
    parser.add_argument("--target-app-kind", default="vscode")
    parser.add_argument("--platform")
    args = parser.parse_args(argv)

    output_dir = Path(args.output_dir).expanduser().resolve()
    provider_dir = output_dir / "virtual-display-provider"
    provider_dir.mkdir(parents=True, exist_ok=True)
    probe_bundle = probe_virtual_display_providers(
        platform=args.platform,
        target_app_kind=args.target_app_kind,
    )
    payload = build_virtual_display_screen_payload(
        run_id=args.run_id,
        target_app_kind=args.target_app_kind,
        probe_bundle=probe_bundle,
    )
    adapter_readiness = virtual_display_readiness_to_action_adapter_readiness(
        probe_bundle["selectedReadiness"],
        readiness_ref=payload["adapterReadinessRef"],
    ) if probe_bundle.get("selectedReadiness") else None
    invoke_probe = invoke_virtual_display_provider(
        intent="probe",
        run_id=args.run_id,
        target_app_kind=args.target_app_kind,
        probe_bundle=probe_bundle,
    )

    artifacts = {
        "probe-bundle.json": probe_bundle,
        "screen-payload.json": payload,
        "invoke-probe.json": invoke_probe,
    }
    if adapter_readiness:
        artifacts["adapter-readiness.json"] = adapter_readiness
    if payload.get("blockedRef"):
        artifacts["blocked.json"] = {
            "schemaVersion": "sciforge.virtual-display.blocked.v1",
            "blockedReason": payload.get("blockedReason"),
            "providerId": probe_bundle.get("selectedProviderId"),
        }
    for filename, artifact in artifacts.items():
        (provider_dir / filename).write_text(json.dumps(artifact, indent=2, sort_keys=True), encoding="utf8")

    manifest = {
        "schemaVersion": "sciforge.virtual-display.provider-probe-manifest.v1",
        "status": probe_bundle["status"],
        "userAcceptanceEligible": False,
        "diagnosticOnly": True,
        "providerProbeRef": str(provider_dir / "probe-bundle.json"),
        "screenPayloadRef": str(provider_dir / "screen-payload.json"),
        "invokeProbeRef": str(provider_dir / "invoke-probe.json"),
        "adapterReadinessRef": str(provider_dir / "adapter-readiness.json") if adapter_readiness else None,
        "blockedRef": str(provider_dir / "blocked.json") if payload.get("blockedRef") else None,
        "blockedReason": probe_bundle.get("blockedReason") or payload.get("blockedReason"),
        "rawPayloadWritten": False,
    }
    manifest = _drop_none(manifest)
    manifest_path = output_dir / "virtual-display-provider-probe-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf8")
    json.dump(manifest, sys.stdout)
    sys.stdout.write("\n")
    return 0 if probe_bundle["status"] == "ready" else 1


def _probe_provider(definition: VirtualDisplayProviderDefinition, options: Mapping[str, Any]) -> dict[str, Any]:
    missing_requirements = _missing_install_requirements(definition, options)
    host_platform = str(options.get("platform") or sys.platform)
    host_supported = "any" in definition.host_platforms or host_platform in definition.host_platforms
    install_state: VirtualDisplayInstallState
    if not host_supported:
        install_state = "unsupported"
    elif missing_requirements:
        install_state = "installable"
    else:
        install_state = "installed"
    permission_grants = _mapping_or_none(options.get("permission_grants")) or {}
    missing_permissions = [
        ref for ref in definition.permission_refs if install_state == "installed" and permission_grants.get(ref) is not True
    ]
    usable = install_state == "installed" and not missing_permissions
    blocked_reason = _blocked_reason_for_probe(definition, install_state, missing_requirements, missing_permissions)
    readiness = {
        "schemaVersion": VIRTUAL_DISPLAY_READINESS_SCHEMA,
        "providerId": definition.provider_id,
        "platform": definition.platform,
        "backendKind": definition.backend_kind,
        "installationStatus": install_state,
        "appIdentity": {
            "targetAppKind": options.get("target_app_kind") or "generic",
            "supportedByProvider": True,
        },
        "captureSupported": usable and definition.capabilities.capture_frame,
        "liveSurfaceSupported": usable and definition.capabilities.stream_frames,
        "inputSupported": usable and definition.capabilities.execute_input_intent,
        "backgroundRenderable": usable and definition.capabilities.background_renderable,
        "affectsPhysicalDisplay": definition.capabilities.affects_physical_display,
        "requiresFocusSteal": definition.capabilities.requires_focus_steal,
        "sharedSystemInputUsed": definition.capabilities.shared_system_input_used,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
        "singleInteractiveTruth": usable,
        "permissionRefs": list(definition.permission_refs),
        "diagnosticRefs": [f"virtual-display-provider:{definition.provider_id}/probe"],
        "installHintRefs": list(definition.install_hint_refs),
        "selectedTransport": definition.transport_preference[0] if usable and definition.transport_preference else None,
        "blockedReason": blocked_reason,
    }
    return {
        "description": definition.description(),
        "readiness": _drop_none(readiness),
        "installState": install_state,
        "missingRequirements": list(missing_requirements),
        "installHints": list(definition.install_hints),
        "priority": definition.priority,
    }


def _missing_install_requirements(definition: VirtualDisplayProviderDefinition, options: Mapping[str, Any]) -> list[str]:
    missing: list[str] = []
    for command in definition.required_commands:
        if not _has_command(command, options):
            missing.append(f"command:{command}")
    for group in definition.any_command_groups:
        if not any(_has_command(command, options) for command in group):
            missing.append(f"one-of-command:{'|'.join(group)}")
    for package_name in definition.required_node_packages:
        if not _has_node_package(package_name, options):
            missing.append(f"node-package:{package_name}")
    manual_requirements = _mapping_or_none(options.get("manual_requirement_availability")) or {}
    for key in definition.manual_requirement_keys:
        if manual_requirements.get(key) is not True:
            missing.append(f"manual:{key}")
    return missing


def _has_command(command: str, options: Mapping[str, Any]) -> bool:
    injected = (_mapping_or_none(options.get("command_availability")) or {}).get(command)
    if isinstance(injected, bool):
        return injected
    return shutil.which(command) is not None


def _has_node_package(package_name: str, options: Mapping[str, Any]) -> bool:
    injected = (_mapping_or_none(options.get("node_package_availability")) or {}).get(package_name)
    if isinstance(injected, bool):
        return injected
    if shutil.which("node") is None:
        return False
    result = subprocess.run(
        ["node", "-e", f"require.resolve({package_name!r})"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return result.returncode == 0


def _blocked_reason_for_probe(
    definition: VirtualDisplayProviderDefinition,
    install_state: str,
    missing_requirements: Sequence[str],
    missing_permissions: Sequence[str],
) -> str | None:
    if install_state == "unsupported":
        return f"{definition.provider_id} is not supported on this host platform."
    if install_state == "installable":
        return " ".join((
            f"{definition.provider_id} is installable but not installed.",
            f"Missing requirements: {', '.join(missing_requirements)}.",
            "SciForge will not install drivers, system extensions, or privileged services without explicit user handoff.",
        ))
    if missing_permissions:
        return " ".join((
            f"{definition.provider_id} is installed but permission or driver readiness is not proven.",
            f"Missing permission refs: {', '.join(missing_permissions)}.",
            "The run is blocked instead of using shared system input or the physical desktop.",
        ))
    return None


def _attach_state_for_readiness(readiness: Mapping[str, Any] | None) -> VirtualDisplayAttachState:
    if not readiness:
        return "adapter-unavailable"
    if readiness.get("installationStatus") != "installed":
        return "adapter-unavailable"
    if re.search(r"permission|driver", str(readiness.get("blockedReason") or ""), re.IGNORECASE):
        return "requires-handoff"
    if readiness.get("captureSupported") and readiness.get("liveSurfaceSupported") and not readiness.get("inputSupported"):
        return "observe-only"
    return "blocked"


def _status_for_blocked_reason(reason: str | None) -> VirtualDisplayInvokeStatus:
    return "requires-handoff" if re.search(r"permission|driver|install|handoff", reason or "", re.IGNORECASE) else "blocked"


def _ready_invoke_result(
    intent: VirtualDisplayInvokeIntent,
    payload: Mapping[str, Any],
    readiness: Mapping[str, Any] | None,
) -> dict[str, Any]:
    common_refs = {
        "adapterReadinessRef": payload.get("adapterReadinessRef"),
        "sessionRef": payload.get("sessionRef"),
        "displayGroupRef": payload.get("displayGroupRef"),
        "screenRef": payload.get("screenRef"),
        "targetAppRef": payload.get("targetAppRef"),
        "targetWindowRef": payload.get("targetWindowRef"),
    }
    session_ref = str(payload.get("sessionRef"))
    refs_by_intent = {
        "probe": common_refs,
        "createSession": {**common_refs, "lifecycleEventRef": f"{session_ref}#create-session"},
        "launchApp": {**common_refs, "lifecycleEventRef": f"{session_ref}#launch-app"},
        "attachSurface": {
            **common_refs,
            "liveSurfaceRef": payload.get("liveSurfaceRef"),
            "frameStreamRef": payload.get("frameStreamRef"),
            "currentFrameRef": payload.get("currentFrameRef"),
        },
        "executeInputIntent": {
            **common_refs,
            "inputIntentRefs": payload.get("inputIntentRefs") or [],
            "inputLeaseRef": payload.get("inputLeaseRef"),
            "actionAdapterRef": payload.get("actionAdapterRef"),
            "executorEventRefs": payload.get("executorEventRefs") or [],
            "beforeFrameRef": payload.get("beforeFrameRef"),
            "afterFrameRef": payload.get("afterFrameRef"),
            "beforeAfterFrameRefs": payload.get("beforeAfterFrameRefs") or [],
            "verificationRefs": payload.get("verificationRefs") or [],
        },
        "pause": {**common_refs, "lifecycleEventRef": f"{session_ref}#pause"},
        "resume": {**common_refs, "lifecycleEventRef": f"{session_ref}#resume"},
        "closeSession": {**common_refs, "lifecycleEventRef": f"{session_ref}#close-session"},
        "handoff": {**common_refs, "handoffRef": f"{session_ref}#handoff"},
    }
    return _drop_none({
        "schemaVersion": VIRTUAL_DISPLAY_PROVIDER_INVOKE_RESULT_SCHEMA,
        "intent": intent,
        "providerId": readiness.get("providerId") if readiness else None,
        "status": "ready",
        "refs": _drop_none(refs_by_intent[intent]),
        "readiness": readiness,
        "mutatingActionExecuted": intent == "executeInputIntent",
        "rawPayloadWritten": False,
    })


def _readiness_isolation_blockers(readiness: Mapping[str, Any]) -> list[str]:
    blockers: list[str] = []
    if readiness.get("captureSupported") is not True:
        blockers.append("capture-unsupported")
    if readiness.get("liveSurfaceSupported") is not True:
        blockers.append("live-surface-unsupported")
    if readiness.get("inputSupported") is not True:
        blockers.append("input-unsupported")
    if readiness.get("backgroundRenderable") is not True:
        blockers.append("background-rendering-unavailable")
    if readiness.get("affectsPhysicalDisplay") is not False:
        blockers.append("physical-display-affected")
    if readiness.get("requiresFocusSteal") is not False:
        blockers.append("focus-steal-required")
    if readiness.get("sharedSystemInputUsed") is not False:
        blockers.append("shared-system-input")
    if readiness.get("systemPointerMoved") is not False:
        blockers.append("system-pointer-moved")
    if readiness.get("systemKeyboardEventsSent") is not False:
        blockers.append("system-keyboard-events")
    if readiness.get("singleInteractiveTruth") is not True:
        blockers.append("multiple-or-missing-interactive-truth")
    return _unique_strings(blockers)


def _provider_definitions(platform: str) -> list[VirtualDisplayProviderDefinition]:
    if platform == "darwin":
        return [_macos_cg_virtual_display_provider()]
    if platform == "linux":
        return [_linux_xpra_provider()]
    if platform == "win32":
        return [_windows_idd_provider()]
    return []


def _canonical_provider_definitions() -> list[VirtualDisplayProviderDefinition]:
    return [
        _macos_cg_virtual_display_provider(),
        _linux_xpra_provider(),
        _windows_idd_provider(),
    ]


def _macos_cg_virtual_display_provider() -> VirtualDisplayProviderDefinition:
    return VirtualDisplayProviderDefinition(
        provider_id="virtual-display.macos.cgvirtualdisplay-screencapturekit",
        platform="darwin",
        backend_kind="cgvirtualdisplay-screencapturekit",
        host_platforms=("darwin",),
        priority=10,
        supported_apps=("vscode", "editor", "browser", "terminal", "generic"),
        supported_transports=("webrtc", "native-frame-stream"),
        supported_input_adapters=("app-command", "ax", "virtual-display-input"),
        required_node_packages=("node-mac-virtual-display",),
        permission_refs=("permission:macos/screen-recording", "permission:macos/accessibility"),
        install_hints=("npm install node-mac-virtual-display; grant macOS Screen Recording and Accessibility explicitly.",),
        install_hint_refs=("install-hint:macos/node-mac-virtual-display",),
        transport_preference=("webrtc", "native-frame-stream"),
    )


def _linux_xpra_provider() -> VirtualDisplayProviderDefinition:
    return VirtualDisplayProviderDefinition(
        provider_id="virtual-display.linux.xpra",
        platform="linux",
        backend_kind="xpra-app-session",
        host_platforms=("linux",),
        priority=20,
        supported_apps=("vscode", "editor", "browser", "terminal", "jupyter", "pdf-viewer", "csv-viewer", "generic"),
        supported_transports=("webrtc", "native-frame-stream"),
        supported_input_adapters=("at-spi", "virtual-display-input", "app-command"),
        required_commands=("xpra",),
        install_hints=("Install Xpra with the system package manager, then rerun provider probe.",),
        install_hint_refs=("install-hint:linux/xpra",),
        transport_preference=("webrtc", "native-frame-stream"),
    )


def _windows_idd_provider() -> VirtualDisplayProviderDefinition:
    return VirtualDisplayProviderDefinition(
        provider_id="virtual-display.windows.idd",
        platform="win32",
        backend_kind="windows-indirect-display-driver",
        host_platforms=("win32",),
        priority=30,
        supported_apps=("vscode", "editor", "browser", "terminal", "generic"),
        supported_transports=("webrtc", "native-frame-stream"),
        supported_input_adapters=("uia", "app-command", "virtual-display-input"),
        manual_requirement_keys=("windows-idd-virtual-display-driver",),
        permission_refs=("permission:windows/idd-driver-authorized",),
        install_hints=("Install and authorize a Windows IDD virtual display driver through explicit user handoff.",),
        install_hint_refs=("install-hint:windows/idd-virtual-display-driver",),
        transport_preference=("webrtc", "native-frame-stream"),
    )


def _supports_target_app(provider: Mapping[str, Any], target_app_kind: str) -> bool:
    supported_apps = provider.get("supportedApps")
    if not isinstance(supported_apps, Sequence) or isinstance(supported_apps, str) or not supported_apps:
        return True
    return "generic" in supported_apps or target_app_kind in supported_apps


def _normalize_target_app_kind(value: str) -> str:
    normalized = _sanitize_ref_segment(value).replace("vs-code", "vscode")
    return "vscode" if normalized in {"code", "visual-studio-code"} else normalized or "generic"


def _sanitize_ref_segment(value: str) -> str:
    sanitized = re.sub(r"[^a-z0-9._-]+", "-", str(value).strip().lower()).strip("-")
    return sanitized or "unknown"


def _drop_none(payload: Mapping[str, Any]) -> dict[str, Any]:
    return {str(key): value for key, value in payload.items() if value is not None}


def _unique_strings(values: Sequence[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value and value not in seen:
            seen.add(value)
            result.append(value)
    return result


def _mapping_or_none(value: Any) -> Mapping[str, Any] | None:
    return value if isinstance(value, Mapping) else None


def _string_or_none(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None


if __name__ == "__main__":
    raise SystemExit(main())
