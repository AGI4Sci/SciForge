"""Public shims for the Computer Use action provider API."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Mapping

from .loop import run_task
from .evidence_ledger import (
    EvidenceLedger,
    build_evidence_index,
    build_evidence_snapshot,
    build_planner_brief,
)
from .isolated_desktop_contracts import EXECUTOR_COMMAND_EVENT_LOG_SCHEMA
from .isolated_desktop_l1_smoke_evidence import (
    build_isolated_desktop_l1_smoke_evidence,
    validate_isolated_desktop_l1_smoke_evidence,
)
from .isolated_desktop_l3_workflow_evidence import (
    build_isolated_desktop_l3_workflow_evidence,
    validate_isolated_desktop_l3_workflow_evidence,
)
from .browser_runtime_dom_ax_observation import (
    build_browser_runtime_dom_ax_observation,
    build_observe_before_mutate_from_browser_runtime,
    validate_browser_runtime_dom_ax_observation,
)
from .native_multi_screen_demo import (
    build_native_multi_screen_demo_bundle,
    validate_native_multi_screen_demo_bundle,
)
from .repair_manifest import validate_repair_manifest
from .trace import (
    build_repair_replay_evidence,
    build_target_bound_real_window_probe_evidence,
    build_viewport_recovery_evidence,
    compact_result,
    validate_repair_replay_evidence,
    validate_target_bound_real_window_probe_evidence,
    validate_trace,
    validate_viewport_recovery_evidence,
)
from .virtual_input_adapter import (
    build_target_bound_input_adapter_manifest,
    validate_input_adapter_manifest_for_real_desktop,
)
from .visible_viewer import build_visible_run_viewer, validate_visible_run_viewer_manifest
from .confirmation_policy import (
    classify_action_plan_for_confirmation,
    classify_mapping_for_confirmation,
    validate_confirmation_boundary,
)
from .contracts import (
    validate_app_window_allowlist,
    validate_data_visibility,
    validate_risk_preview,
    validate_session_permission,
    validate_stop_cancel_lease,
    validate_user_level_mutating_evidence,
)
from .user_control import validate_session_permission_store, write_session_permission_store


def get_manifest() -> dict[str, Any]:
    """Return the bundled action-provider manifest."""

    manifest_path = Path(__file__).resolve().parents[1] / "action-provider.manifest.json"
    parsed = json.loads(manifest_path.read_text(encoding="utf8"))
    if not isinstance(parsed, Mapping):
        raise ValueError("Computer Use manifest root must be a JSON object.")
    return dict(parsed)


getManifest = get_manifest
runTask = run_task
validateTrace = validate_trace
compactResult = compact_result
buildRepairReplayEvidence = build_repair_replay_evidence
validateRepairReplayEvidence = validate_repair_replay_evidence
buildViewportRecoveryEvidence = build_viewport_recovery_evidence
validateViewportRecoveryEvidence = validate_viewport_recovery_evidence
buildTargetBoundRealWindowProbeEvidence = build_target_bound_real_window_probe_evidence
validateTargetBoundRealWindowProbeEvidence = validate_target_bound_real_window_probe_evidence
buildTargetBoundInputAdapterManifest = build_target_bound_input_adapter_manifest
validateInputAdapterManifestForRealDesktop = validate_input_adapter_manifest_for_real_desktop
validateRepairManifest = validate_repair_manifest
buildVisibleRunViewer = build_visible_run_viewer
validateVisibleRunViewerManifest = validate_visible_run_viewer_manifest
classifyActionPlanForConfirmation = classify_action_plan_for_confirmation
classifyMappingForConfirmation = classify_mapping_for_confirmation
validateConfirmationBoundary = validate_confirmation_boundary


def build_virtual_display_provider_manifest(*args: Any, **kwargs: Any) -> dict[str, Any]:
    from .virtual_display_provider import build_virtual_display_provider_manifest as _impl

    return _impl(*args, **kwargs)


def build_virtual_display_screen_payload(*args: Any, **kwargs: Any) -> dict[str, Any]:
    from .virtual_display_provider import build_virtual_display_screen_payload as _impl

    return _impl(*args, **kwargs)


def describe_virtual_display_providers(*args: Any, **kwargs: Any) -> list[dict[str, Any]]:
    from .virtual_display_provider import describe_virtual_display_providers as _impl

    return _impl(*args, **kwargs)


def query_virtual_display_providers(*args: Any, **kwargs: Any) -> list[dict[str, Any]]:
    from .virtual_display_provider import query_virtual_display_providers as _impl

    return _impl(*args, **kwargs)


def read_virtual_display_provider(*args: Any, **kwargs: Any) -> dict[str, Any] | None:
    from .virtual_display_provider import read_virtual_display_provider as _impl

    return _impl(*args, **kwargs)


def probe_virtual_display_providers(*args: Any, **kwargs: Any) -> dict[str, Any]:
    from .virtual_display_provider import probe_virtual_display_providers as _impl

    return _impl(*args, **kwargs)


def invoke_virtual_display_provider(*args: Any, **kwargs: Any) -> dict[str, Any]:
    from .virtual_display_provider import invoke_virtual_display_provider as _impl

    return _impl(*args, **kwargs)


def validate_virtual_display_readiness(*args: Any, **kwargs: Any) -> dict[str, Any]:
    from .virtual_display_provider import validate_virtual_display_readiness as _impl

    return _impl(*args, **kwargs)


def virtual_display_readiness_to_action_adapter_readiness(*args: Any, **kwargs: Any) -> dict[str, Any]:
    from .virtual_display_provider import virtual_display_readiness_to_action_adapter_readiness as _impl

    return _impl(*args, **kwargs)


buildVirtualDisplayProviderManifest = build_virtual_display_provider_manifest
buildVirtualDisplayScreenPayload = build_virtual_display_screen_payload
describeVirtualDisplayProviders = describe_virtual_display_providers
queryVirtualDisplayProviders = query_virtual_display_providers
readVirtualDisplayProvider = read_virtual_display_provider
probeVirtualDisplayProviders = probe_virtual_display_providers
invokeVirtualDisplayProvider = invoke_virtual_display_provider
validateVirtualDisplayReadiness = validate_virtual_display_readiness
virtualDisplayReadinessToActionAdapterReadiness = virtual_display_readiness_to_action_adapter_readiness


def get_native_tool_manifest() -> dict[str, Any]:
    from .native_tool import get_native_tool_manifest as _get_native_tool_manifest

    return _get_native_tool_manifest()


def get_mcp_tool_schemas() -> list[dict[str, Any]]:
    from .mcp_server import get_mcp_tool_schemas as _get_mcp_tool_schemas

    return _get_mcp_tool_schemas()


def run_mcp_server(*, output_dir: str | Path | None = None) -> int:
    from .mcp_server import run_mcp_server as _run_mcp_server

    return _run_mcp_server(output_dir=output_dir)


def dispatch_native_tool(
    tool: str,
    payload: Mapping[str, Any],
    *,
    output_dir: str | Path | None = None,
) -> dict[str, Any]:
    from .native_tool import dispatch_native_tool as _dispatch_native_tool

    return _dispatch_native_tool(tool, payload, output_dir=output_dir)


def validate_native_tool_payload(tool: str, payload: Mapping[str, Any]) -> dict[str, Any]:
    from .native_tool import validate_native_tool_payload as _validate_native_tool_payload

    return _validate_native_tool_payload(tool, payload)


getNativeToolManifest = get_native_tool_manifest
getMcpToolSchemas = get_mcp_tool_schemas
runMcpServer = run_mcp_server
dispatchNativeTool = dispatch_native_tool
validateNativeToolPayload = validate_native_tool_payload
validateSessionPermission = validate_session_permission
validateAppWindowAllowlist = validate_app_window_allowlist
validateRiskPreview = validate_risk_preview
validateDataVisibility = validate_data_visibility
validateStopCancelLease = validate_stop_cancel_lease
validateUserLevelMutatingEvidence = validate_user_level_mutating_evidence
validateSessionPermissionStore = validate_session_permission_store
writeSessionPermissionStore = write_session_permission_store
buildEvidenceIndex = build_evidence_index
buildEvidenceSnapshot = build_evidence_snapshot
buildPlannerBrief = build_planner_brief
executorCommandEventLogSchema = EXECUTOR_COMMAND_EVENT_LOG_SCHEMA
buildIsolatedDesktopL1SmokeEvidence = build_isolated_desktop_l1_smoke_evidence
validateIsolatedDesktopL1SmokeEvidence = validate_isolated_desktop_l1_smoke_evidence
buildIsolatedDesktopL3WorkflowEvidence = build_isolated_desktop_l3_workflow_evidence
validateIsolatedDesktopL3WorkflowEvidence = validate_isolated_desktop_l3_workflow_evidence
buildBrowserRuntimeDomAxObservation = build_browser_runtime_dom_ax_observation
buildObserveBeforeMutateFromBrowserRuntime = build_observe_before_mutate_from_browser_runtime
validateBrowserRuntimeDomAxObservation = validate_browser_runtime_dom_ax_observation
buildNativeMultiScreenDemoBundle = build_native_multi_screen_demo_bundle
validateNativeMultiScreenDemoBundle = validate_native_multi_screen_demo_bundle


def run_native_multi_screen_live_demo(*args: Any, **kwargs: Any) -> dict[str, Any]:
    from .native_multi_screen_live_demo import run_native_multi_screen_live_demo as _run_native_multi_screen_live_demo

    return _run_native_multi_screen_live_demo(*args, **kwargs)


def validate_native_multi_screen_live_demo_run(*args: Any, **kwargs: Any) -> dict[str, Any]:
    from .native_multi_screen_live_demo import validate_native_multi_screen_live_demo_run as _validate_native_multi_screen_live_demo_run

    return _validate_native_multi_screen_live_demo_run(*args, **kwargs)


def make_native_sidecar_command_dispatcher(*args: Any, **kwargs: Any) -> Any:
    from .native_multi_screen_live_demo import make_native_sidecar_command_dispatcher as _make_native_sidecar_command_dispatcher

    return _make_native_sidecar_command_dispatcher(*args, **kwargs)


runNativeMultiScreenLiveDemo = run_native_multi_screen_live_demo
validateNativeMultiScreenLiveDemoRun = validate_native_multi_screen_live_demo_run
makeNativeSidecarCommandDispatcher = make_native_sidecar_command_dispatcher


__all__ = [
    "build_visible_run_viewer",
    "buildVisibleRunViewer",
    "EvidenceLedger",
    "EXECUTOR_COMMAND_EVENT_LOG_SCHEMA",
    "build_evidence_index",
    "buildEvidenceIndex",
    "build_evidence_snapshot",
    "buildEvidenceSnapshot",
    "build_planner_brief",
    "buildPlannerBrief",
    "executorCommandEventLogSchema",
    "build_isolated_desktop_l1_smoke_evidence",
    "buildIsolatedDesktopL1SmokeEvidence",
    "build_isolated_desktop_l3_workflow_evidence",
    "buildIsolatedDesktopL3WorkflowEvidence",
    "build_browser_runtime_dom_ax_observation",
    "buildBrowserRuntimeDomAxObservation",
    "build_observe_before_mutate_from_browser_runtime",
    "buildObserveBeforeMutateFromBrowserRuntime",
    "build_native_multi_screen_demo_bundle",
    "buildNativeMultiScreenDemoBundle",
    "run_native_multi_screen_live_demo",
    "runNativeMultiScreenLiveDemo",
    "make_native_sidecar_command_dispatcher",
    "makeNativeSidecarCommandDispatcher",
    "build_repair_replay_evidence",
    "buildRepairReplayEvidence",
    "build_viewport_recovery_evidence",
    "buildViewportRecoveryEvidence",
    "build_target_bound_real_window_probe_evidence",
    "buildTargetBoundRealWindowProbeEvidence",
    "build_target_bound_input_adapter_manifest",
    "buildTargetBoundInputAdapterManifest",
    "build_virtual_display_provider_manifest",
    "buildVirtualDisplayProviderManifest",
    "build_virtual_display_screen_payload",
    "buildVirtualDisplayScreenPayload",
    "describe_virtual_display_providers",
    "describeVirtualDisplayProviders",
    "query_virtual_display_providers",
    "queryVirtualDisplayProviders",
    "read_virtual_display_provider",
    "readVirtualDisplayProvider",
    "probe_virtual_display_providers",
    "probeVirtualDisplayProviders",
    "invoke_virtual_display_provider",
    "invokeVirtualDisplayProvider",
    "validate_virtual_display_readiness",
    "validateVirtualDisplayReadiness",
    "virtual_display_readiness_to_action_adapter_readiness",
    "virtualDisplayReadinessToActionAdapterReadiness",
    "compact_result",
    "compactResult",
    "get_manifest",
    "getManifest",
    "runTask",
    "run_task",
    "validate_repair_replay_evidence",
    "validateRepairReplayEvidence",
    "validate_trace",
    "validateTrace",
    "validate_viewport_recovery_evidence",
    "validateViewportRecoveryEvidence",
    "validate_target_bound_real_window_probe_evidence",
    "validateTargetBoundRealWindowProbeEvidence",
    "validate_input_adapter_manifest_for_real_desktop",
    "validateInputAdapterManifestForRealDesktop",
    "validate_isolated_desktop_l1_smoke_evidence",
    "validateIsolatedDesktopL1SmokeEvidence",
    "validate_isolated_desktop_l3_workflow_evidence",
    "validateIsolatedDesktopL3WorkflowEvidence",
    "validate_browser_runtime_dom_ax_observation",
    "validateBrowserRuntimeDomAxObservation",
    "validate_native_multi_screen_demo_bundle",
    "validateNativeMultiScreenDemoBundle",
    "validate_native_multi_screen_live_demo_run",
    "validateNativeMultiScreenLiveDemoRun",
    "validate_repair_manifest",
    "validateRepairManifest",
    "validate_visible_run_viewer_manifest",
    "validateVisibleRunViewerManifest",
    "classify_action_plan_for_confirmation",
    "classifyActionPlanForConfirmation",
    "classify_mapping_for_confirmation",
    "classifyMappingForConfirmation",
    "validate_confirmation_boundary",
    "validateConfirmationBoundary",
    "get_native_tool_manifest",
    "getNativeToolManifest",
    "get_mcp_tool_schemas",
    "getMcpToolSchemas",
    "run_mcp_server",
    "runMcpServer",
    "dispatch_native_tool",
    "dispatchNativeTool",
    "validate_native_tool_payload",
    "validateNativeToolPayload",
    "validate_session_permission",
    "validateSessionPermission",
    "validate_app_window_allowlist",
    "validateAppWindowAllowlist",
    "validate_risk_preview",
    "validateRiskPreview",
    "validate_data_visibility",
    "validateDataVisibility",
    "validate_stop_cancel_lease",
    "validateStopCancelLease",
    "validate_user_level_mutating_evidence",
    "validateUserLevelMutatingEvidence",
    "validate_session_permission_store",
    "validateSessionPermissionStore",
    "write_session_permission_store",
    "writeSessionPermissionStore",
]
