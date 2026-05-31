"""macOS native sidecar command for the M6 virtual-screen live demo.

The command speaks the stdin/stdout JSON protocol used by
``native_multi_screen_live_demo``. It keeps the sidecar at L0: discovery,
preflight, capture, state, and scoped input-event recording only. It does not
plan, judge completion, call GUI/runtime internals, or send shared system input.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence

from .native_capture_probe import _png_metadata, _window_inventory
from .native_multi_screen_live_demo import (
    NATIVE_SIDECAR_CAPABILITIES_SCHEMA,
    NATIVE_SIDECAR_DISCOVERY_SCHEMA,
)
from .platform_sidecar import PLATFORM_SIDECAR_RESULT_SCHEMA


MACOS_NATIVE_SIDECAR_ID = "sciforge-macos-native-virtual-screen-sidecar"
MACOS_NATIVE_SIDECAR_STATE_SCHEMA = "sciforge.computer-use.macos-native-sidecar-state.v1"
MACOS_NATIVE_VIRTUAL_SCREEN_SCHEMA = "sciforge.computer-use.macos-native-virtual-screen.v1"
MACOS_NATIVE_WINDOW_REF_SCHEMA = "sciforge.computer-use.macos-native-window-ref.v1"
MACOS_NATIVE_CAPTURE_SCHEMA = "sciforge.computer-use.macos-native-capture.v1"
MACOS_NATIVE_PREFLIGHT_SCHEMA = "sciforge.computer-use.macos-native-preflight.v1"
MACOS_NATIVE_EXECUTOR_EVENT_SCHEMA = "sciforge.computer-use.macos-native-executor-event.v1"
MACOS_NATIVE_INPUT_EVENT_LOG_SCHEMA = "sciforge.computer-use.macos-native-virtual-input-event-log.v1"
MACOS_NATIVE_BLOCKED_DIAGNOSTIC_SCHEMA = "sciforge.computer-use.macos-native-sidecar-blocked.v1"
MACOS_NATIVE_HOST_DIAGNOSTIC_SCHEMA = "sciforge.computer-use.macos-native-sidecar-host-diagnostic.v1"
_FORBIDDEN_PAYLOAD_KEYS = {
    "authorization",
    "base64screenshot",
    "credential",
    "dataurl",
    "imagebase64",
    "inlinepng",
    "password",
    "providerrawpayload",
    "providerroute",
    "providerurl",
    "rawpayload",
    "rawproviderpayload",
    "rawscreenshot",
    "screenshotbase64",
    "secret",
    "token",
}


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run one macOS native sidecar stdin/stdout JSON dispatch call.")
    parser.parse_args(argv)
    try:
        request = json.loads(sys.stdin.read() or "{}")
        if not isinstance(request, Mapping):
            raise ValueError("request root must be an object")
        result = dispatch_macos_native_sidecar_request(request)
    except Exception as exc:  # pragma: no cover - defensive CLI guard
        result = _result(
            "unknown",
            "failed",
            f"macos_native_sidecar_error:{exc.__class__.__name__}",
            refs=[],
            value={},
            diagnostic_only=True,
        )
    json.dump(result, sys.stdout, sort_keys=True)
    sys.stdout.write("\n")
    sys.stdout.flush()
    return 0


def dispatch_macos_native_sidecar_request(request: Mapping[str, Any]) -> dict[str, Any]:
    tool = _string(request.get("tool")) or ""
    payload = _mapping(request.get("payload"))
    output_dir = Path(_string(request.get("outputDir")) or ".").expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    if tool == "capabilities":
        return _capabilities(payload, output_dir)
    if tool == "discover":
        return _discover(payload, output_dir)
    if tool == "preflight":
        return _preflight(payload, output_dir)
    if tool == "capture":
        return _capture(payload, output_dir)
    if tool == "state":
        return _state(payload, output_dir)
    if tool == "execute":
        return _execute(payload, output_dir)
    return _result(tool or "unknown", "failed", "unsupported_tool", refs=[], value={}, diagnostic_only=True)


def _capabilities(payload: Mapping[str, Any], output_dir: Path) -> dict[str, Any]:
    run_id = _run_id(payload)
    display_group_id = _display_group_id(payload, run_id)
    diagnostic = _host_diagnostics("capabilities")
    diagnostic_ref = _write_diagnostic(output_dir, run_id, "capabilities", diagnostic)
    available = diagnostic["hostAvailability"]
    capabilities = {
        "schemaVersion": NATIVE_SIDECAR_CAPABILITIES_SCHEMA,
        "runId": run_id,
        "displayGroupId": display_group_id,
        "sidecarId": MACOS_NATIVE_SIDECAR_ID,
        "platform": platform.system().lower(),
        "features": [
            "multi-screen",
            "multi-actor-cursor",
            "window-local-lease",
            "screen-global-lease",
            "refs-first-evidence",
            "native-capture",
            "native-window-discovery",
            "virtual-screen",
            "independent-virtual-input-adapter",
        ],
        "tools": ["capabilities", "discover", "preflight", "capture", "state", "execute"],
        "diagnosticOnly": False,
        "dockerNovncRequired": False,
        "planningPerformed": False,
        "completionJudged": False,
        "sharedSystemInputAllowed": False,
        "physicalMultiDisplayRequired": False,
        "virtualScreensSupported": True,
        "hostAvailability": available,
        "blockedReason": diagnostic["blockedReason"],
        "blockedReasons": diagnostic["blockedReasons"],
        "diagnosticRef": diagnostic_ref,
    }
    ref = _write_json(output_dir / "capabilities" / f"{run_id}-capabilities.json", capabilities)
    return _result(
        "capabilities",
        "completed",
        "macos-native-sidecar-capabilities-ready",
        refs=[ref, diagnostic_ref],
        value={"capabilitiesRef": ref, "capabilities": capabilities, "hostDiagnosticRef": diagnostic_ref, "bindingKind": "external-command"},
    )


def _discover(payload: Mapping[str, Any], output_dir: Path) -> dict[str, Any]:
    run_id = _run_id(payload)
    display_group_id = _display_group_id(payload, run_id)
    initial_diagnostic = _host_diagnostics("discover")
    if not initial_diagnostic["hostAvailability"]["darwin"]:
        return _blocked("discover", "macos_native_sidecar_requires_darwin", output_dir, run_id, diagnostics=initial_diagnostic)
    if not initial_diagnostic["hostAvailability"]["swift"]:
        return _blocked("discover", "swift_unavailable", output_dir, run_id, diagnostics=initial_diagnostic)
    displays = _display_inventory()
    display_diagnostic = _host_diagnostics("discover", displays=displays)
    if not displays:
        return _blocked("discover", "macos_display_discovery_unavailable", output_dir, run_id, diagnostics=display_diagnostic)
    screens = _virtual_screens(displays, run_id, display_group_id, output_dir)
    live_windows = _live_windows()
    diagnostic = _host_diagnostics("discover", displays=displays, live_windows=live_windows)
    diagnostic_ref = _write_diagnostic(output_dir, run_id, "discover", diagnostic)
    windows = _windows_for_virtual_screens(live_windows, screens, run_id, output_dir)
    actor_plan = _actor_cursor_plan(run_id, screens, windows)
    discovery = {
        "schemaVersion": NATIVE_SIDECAR_DISCOVERY_SCHEMA,
        "runId": run_id,
        "displayGroupId": display_group_id,
        "sidecarId": MACOS_NATIVE_SIDECAR_ID,
        "physicalMultiDisplayRequired": False,
        "virtualScreensBackedByNativeCapture": True,
        "screens": screens,
        "windows": windows,
        "actorCursorPlan": actor_plan,
        "blockedReason": diagnostic["blockedReason"],
        "blockedReasons": diagnostic["blockedReasons"],
        "diagnosticRef": diagnostic_ref,
        "observedAt": _now(),
    }
    ref = _write_json(_discovery_path(output_dir, run_id), discovery)
    return _result(
        "discover",
        "completed",
        "macos-native-virtual-screens-discovered",
        refs=[ref, diagnostic_ref, *[str(screen.get("screenRef")) for screen in screens if screen.get("screenRef")], *[str(window.get("windowRef")) for window in windows if window.get("windowRef")]],
        value={"discoveryRef": ref, "discovery": discovery, "hostDiagnosticRef": diagnostic_ref, "bindingKind": "external-command"},
    )


def _preflight(payload: Mapping[str, Any], output_dir: Path) -> dict[str, Any]:
    run_id = _run_id(payload)
    screen_id = _string(payload.get("screenId")) or "unknown-screen"
    allowed_window_refs = _string_list(payload.get("allowedWindowRefs"))
    blocked_reasons: list[str] = []
    host_diagnostic = _host_diagnostics("preflight")
    if platform.system() != "Darwin":
        blocked_reasons.append("macos_native_sidecar_requires_darwin")
    if not shutil.which("screencapture"):
        blocked_reasons.append("screencapture_unavailable")
    if _mapping(payload.get("inputModalityPolicy")).get("sharedSystemInputAllowed") is not False:
        blocked_reasons.append("shared_system_input_must_be_disabled")
    if not allowed_window_refs:
        blocked_reasons.append("allowed_window_refs_missing")
    status = "blocked" if blocked_reasons else "ready"
    merged_reasons = list(dict.fromkeys([*blocked_reasons, *host_diagnostic["blockedReasons"]]))
    diagnostic = {**host_diagnostic, "blockedReason": (merged_reasons[0] if merged_reasons else None), "blockedReasons": merged_reasons}
    diagnostic_ref = _write_diagnostic(output_dir, run_id, f"preflight-{screen_id}", diagnostic)
    record = {
        "schemaVersion": MACOS_NATIVE_PREFLIGHT_SCHEMA,
        "runId": run_id,
        "displayGroupId": payload.get("displayGroupId"),
        "screenId": screen_id,
        "status": status,
        "allowedWindowRefs": allowed_window_refs,
        "blockedReason": merged_reasons[0] if merged_reasons else None,
        "blockedReasons": merged_reasons,
        "diagnosticRef": diagnostic_ref,
        "sharedSystemInputAllowed": False,
        "systemPointerWillMove": False,
        "systemKeyboardEventsWillBeSent": False,
        "virtualInputAdapter": "independent-virtual-screen-sidecar",
        "planningPerformed": False,
        "completionJudged": False,
        "observedAt": _now(),
    }
    preflight_ref = _write_json(output_dir / "preflight" / f"{_safe(screen_id)}.json", record)
    isolation_ref = _write_json(output_dir / "isolation" / f"{_safe(screen_id)}.json", _isolation_report(run_id, screen_id, status))
    return _result(
        "preflight",
        "completed" if status == "ready" else "blocked",
        "macos-native-preflight-ready" if status == "ready" else "macos-native-preflight-blocked",
        refs=[preflight_ref, isolation_ref, diagnostic_ref],
        value={"permissionPreflightRef": preflight_ref, "isolationReportRef": isolation_ref, "hostDiagnosticRef": diagnostic_ref, "bindingKind": "external-command"},
        diagnostic_only=status != "ready",
    )


def _capture(payload: Mapping[str, Any], output_dir: Path) -> dict[str, Any]:
    run_id = _run_id(payload)
    screen_id = _string(payload.get("screenId")) or "unknown-screen"
    discovery = _load_discovery(output_dir, run_id)
    screen = _screen_by_id(discovery, screen_id)
    if not screen:
        return _blocked("capture", "screen_not_found_in_discovery", output_dir, run_id)
    if not shutil.which("screencapture"):
        return _blocked("capture", "screencapture_unavailable", output_dir, run_id, diagnostics=_host_diagnostics("capture"))
    bounds = _bounds(screen.get("bounds"))
    phase = _string(_mapping(payload.get("metadata")).get("phase")) or "capture"
    screenshot_path = output_dir / "captures" / f"{_safe(screen_id)}-{phase}.png"
    screenshot_path.parent.mkdir(parents=True, exist_ok=True)
    command = ["screencapture", "-x", f"-R{bounds['x']},{bounds['y']},{bounds['width']},{bounds['height']}", str(screenshot_path)]
    completed = _run(command)
    if completed.returncode != 0 or not screenshot_path.is_file() or screenshot_path.stat().st_size <= 0:
        detail = (completed.stderr or completed.stdout).strip()
        return _blocked(
            "capture",
            _capture_blocked_reason(detail),
            output_dir,
            run_id,
            detail=detail,
            diagnostics=_host_diagnostics("capture", capture_error=detail),
        )
    metadata = _png_metadata(screenshot_path)
    capture = {
        "schemaVersion": MACOS_NATIVE_CAPTURE_SCHEMA,
        "runId": run_id,
        "displayGroupId": payload.get("displayGroupId"),
        "screenId": screen_id,
        "captureKind": payload.get("captureKind") or "screen",
        "phase": phase,
        "bounds": bounds,
        "screenshotRef": str(screenshot_path),
        "screenshotMetadata": metadata,
        "permissionPreflightRef": payload.get("permissionPreflightRef"),
        "rawScreenshotWritten": False,
        "blockedReason": None,
        "blockedReasons": [],
        "observedAt": _now(),
    }
    capture_ref = _write_json(output_dir / "captures" / f"{_safe(screen_id)}-{phase}.json", capture)
    return _result(
        "capture",
        "completed",
        "macos-native-virtual-screen-captured",
        refs=[capture_ref, str(screenshot_path)],
        value={"captureRef": capture_ref, "screenshotRef": str(screenshot_path), "bindingKind": "external-command"},
    )


def _state(payload: Mapping[str, Any], output_dir: Path) -> dict[str, Any]:
    run_id = _run_id(payload)
    screen_id = _string(payload.get("screenId")) or "unknown-screen"
    discovery = _load_discovery(output_dir, run_id)
    windows = [
        window
        for window in _mapping_list(discovery.get("windows"))
        if _string(window.get("screenId")) == screen_id
    ]
    state = {
        "schemaVersion": MACOS_NATIVE_SIDECAR_STATE_SCHEMA,
        "runId": run_id,
        "displayGroupId": payload.get("displayGroupId"),
        "screenId": screen_id,
        "stateKind": payload.get("stateKind") or "app-state",
        "permissionPreflightRef": payload.get("permissionPreflightRef"),
        "windows": windows,
        "windowRefs": [_string(window.get("windowRef")) for window in windows if _string(window.get("windowRef"))],
        "accessibilityStateRef": None,
        "rawPayloadWritten": False,
        "observedAt": _now(),
    }
    state_ref = _write_json(output_dir / "state" / f"{_safe(screen_id)}-{_digest(payload)}.json", state)
    return _result(
        "state",
        "completed",
        "macos-native-virtual-screen-state-captured",
        refs=[state_ref, *state["windowRefs"]],
        value={"stateRef": state_ref, "bindingKind": "external-command"},
    )


def _execute(payload: Mapping[str, Any], output_dir: Path) -> dict[str, Any]:
    run_id = _run_id(payload)
    screen_id = _string(payload.get("screenId")) or "unknown-screen"
    action = _mapping(payload.get("action"))
    action_kind = _string(payload.get("actionKind")) or _string(action.get("kind")) or "unknown"
    target = _mapping(payload.get("target"))
    contract_blockers = _execute_contract_blockers(payload, target, screen_id)
    if contract_blockers:
        diagnostics = _host_diagnostics("execute")
        diagnostics["blockedReason"] = contract_blockers[0]
        diagnostics["blockedReasons"] = contract_blockers
        return _blocked(
            "execute",
            contract_blockers[0],
            output_dir,
            run_id,
            detail=", ".join(contract_blockers),
            diagnostics=diagnostics,
        )
    event_id = f"{run_id}-{_safe(_string(payload.get('leaseId')) or 'lease')}-{_digest(payload)}"
    input_event = {
        "eventId": event_id,
        "runId": run_id,
        "screenId": screen_id,
        "windowId": payload.get("windowId"),
        "actorId": payload.get("actorId"),
        "cursorId": payload.get("cursorId"),
        "actionKind": action_kind,
        "targetRef": target.get("targetRef"),
        "regionRef": target.get("regionRef"),
        "schedulerLeaseRef": payload.get("schedulerLeaseRef"),
        "leaseScope": payload.get("leaseScope"),
        "permissionPreflightRef": payload.get("permissionPreflightRef"),
        "beforeEvidenceRefs": _string_list(payload.get("beforeEvidenceRefs")),
        "afterEvidenceRefs": _string_list(payload.get("afterEvidenceRefs")),
        "groundingRefs": _string_list(payload.get("groundingRefs")),
        "virtualInputExecuted": True,
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
        "realOsInputExecuted": False,
        "planningPerformed": False,
        "completionJudged": False,
        "userLevelCompletionClaimed": False,
        "guiAccessed": False,
        "guiDependencyUsed": False,
        "workspaceWritePolicyDeclared": False,
        "workspaceWritePerformed": False,
        "observedAt": _now(),
    }
    input_log = {
        "schemaVersion": MACOS_NATIVE_INPUT_EVENT_LOG_SCHEMA,
        "runId": run_id,
        "events": [input_event],
    }
    input_log_ref = _write_json(output_dir / "input-events" / f"{event_id}.json", input_log)
    event = {
        "schemaVersion": MACOS_NATIVE_EXECUTOR_EVENT_SCHEMA,
        "eventId": event_id,
        "status": "completed",
        "runId": run_id,
        "displayGroupId": payload.get("displayGroupId"),
        "screenId": screen_id,
        "windowId": payload.get("windowId"),
        "actorId": payload.get("actorId"),
        "cursorId": payload.get("cursorId"),
        "leaseId": payload.get("leaseId"),
        "schedulerLeaseRef": payload.get("schedulerLeaseRef"),
        "leaseScope": payload.get("leaseScope"),
        "permissionPreflightRef": payload.get("permissionPreflightRef"),
        "beforeEvidenceRefs": _string_list(payload.get("beforeEvidenceRefs")),
        "afterEvidenceRefs": _string_list(payload.get("afterEvidenceRefs")),
        "groundingRefs": _string_list(payload.get("groundingRefs")),
        "actionKind": action_kind,
        "target": target,
        "inputEventLogRef": input_log_ref,
        "inputAdapterKind": "independent-virtual-screen-sidecar",
        "mutatingActionExecuted": True,
        "nativeGuiMutationClaimed": False,
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
        "realOsInputExecuted": False,
        "virtualInputExecuted": True,
        "planningPerformed": False,
        "completionJudged": False,
        "userLevelCompletionClaimed": False,
        "guiAccessed": False,
        "guiDependencyUsed": False,
        "workspaceWritePolicyDeclared": False,
        "workspaceWritePerformed": False,
        "observedAt": _now(),
    }
    event_ref = _write_json(output_dir / "executor-events" / f"{event_id}.json", event)
    return _result(
        "execute",
        "completed",
        "macos-native-virtual-input-executed",
        refs=[event_ref, input_log_ref],
        value={"executorEventRef": event_ref, "inputEventLogRef": input_log_ref, "bindingKind": "external-command"},
        virtual_input_executed=True,
    )


def _execute_contract_blockers(
    payload: Mapping[str, Any],
    target: Mapping[str, Any],
    screen_id: str,
) -> list[str]:
    blockers: list[str] = []
    modality_policy = _mapping(payload.get("inputModalityPolicy"))
    if modality_policy and modality_policy.get("sharedSystemInputAllowed") is not False:
        blockers.append("shared_system_input_must_be_disabled")
    forbidden_path = _forbidden_payload_path(payload)
    if forbidden_path:
        blockers.append(f"raw_or_secret_payload_forbidden:{forbidden_path}")
    if not _string(payload.get("schedulerLeaseRef")):
        blockers.append("scheduler_lease_ref_missing")
    lease_scope = _mapping(payload.get("leaseScope"))
    lease_kind = _string(lease_scope.get("kind")) or _string(lease_scope.get("scope"))
    lease_screen_id = _string(lease_scope.get("screenId"))
    if not lease_scope or not lease_kind or not lease_screen_id:
        blockers.append("lease_scope_missing_or_invalid")
    elif lease_screen_id != screen_id:
        blockers.append("lease_scope_screen_mismatch")
    if lease_kind and lease_kind.startswith("window") and not _string(lease_scope.get("windowId")):
        blockers.append("lease_scope_window_id_missing")
    if not _string(payload.get("permissionPreflightRef")):
        blockers.append("permission_preflight_ref_missing")
    if not _string(payload.get("actorId")):
        blockers.append("actor_id_missing")
    if not _string(payload.get("cursorId")):
        blockers.append("cursor_id_missing")
    if not _string_list(payload.get("beforeEvidenceRefs")):
        blockers.append("before_evidence_refs_missing")
    if not _string_list(payload.get("groundingRefs")):
        blockers.append("grounding_refs_missing")
    if not _string(target.get("targetRef")):
        blockers.append("target_ref_missing")
    if not (_string(target.get("regionRef")) or _string(target.get("stateRef"))):
        blockers.append("target_region_or_state_ref_missing")
    return list(dict.fromkeys(blockers))


def _display_inventory() -> list[dict[str, Any]]:
    if platform.system() != "Darwin" or not shutil.which("swift"):
        return []
    script = r"""
import Foundation
import CoreGraphics
var count: UInt32 = 0
CGGetActiveDisplayList(0, nil, &count)
var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
CGGetActiveDisplayList(count, &ids, &count)
var records: [[String: Any]] = []
for (index, id) in ids.enumerated() {
  let bounds = CGDisplayBounds(id)
  records.append([
    "displayIndex": index + 1,
    "displayId": id,
    "main": CGDisplayIsMain(id) != 0,
    "online": CGDisplayIsOnline(id) != 0,
    "bounds": [
      "x": bounds.origin.x,
      "y": bounds.origin.y,
      "width": bounds.size.width,
      "height": bounds.size.height
    ]
  ])
}
let data = try JSONSerialization.data(withJSONObject: records, options: [.sortedKeys])
FileHandle.standardOutput.write(data)
"""
    completed = _run(["swift", "-"], input_text=script)
    if completed.returncode != 0:
        return []
    try:
        parsed = json.loads(completed.stdout or "[]")
    except json.JSONDecodeError:
        return []
    return [_normalize_display(item) for item in parsed if isinstance(item, Mapping)]


def _virtual_screens(displays: Sequence[Mapping[str, Any]], run_id: str, display_group_id: str, output_dir: Path) -> list[dict[str, Any]]:
    ordered = sorted(displays, key=lambda item: (0 if item.get("main") else 1, int(item.get("displayIndex") or 0)))
    source = ordered[:2] if len(ordered) >= 2 else ordered
    screens: list[dict[str, Any]] = []
    if len(source) >= 2:
        for index, display in enumerate(source, start=1):
            bounds = _bounds(display.get("bounds"))
            screens.append(_screen_record(run_id, display_group_id, output_dir, index, bounds, display, "physical-display-as-virtual-screen"))
        return screens
    bounds = _bounds(source[0].get("bounds"))
    left_width = max(1, bounds["width"] // 2)
    right_width = max(1, bounds["width"] - left_width)
    split_bounds = [
        {"x": bounds["x"], "y": bounds["y"], "width": left_width, "height": bounds["height"]},
        {"x": bounds["x"] + left_width, "y": bounds["y"], "width": right_width, "height": bounds["height"]},
    ]
    for index, virtual_bounds in enumerate(split_bounds, start=1):
        screens.append(_screen_record(run_id, display_group_id, output_dir, index, virtual_bounds, source[0], "single-display-split-virtual-screen"))
    return screens


def _screen_record(
    run_id: str,
    display_group_id: str,
    output_dir: Path,
    index: int,
    bounds: Mapping[str, int],
    display: Mapping[str, Any],
    virtualization_mode: str,
) -> dict[str, Any]:
    screen_id = f"{run_id}-virtual-screen-{index}"
    record = {
        "schemaVersion": MACOS_NATIVE_VIRTUAL_SCREEN_SCHEMA,
        "runId": run_id,
        "displayGroupId": display_group_id,
        "screenId": screen_id,
        "bounds": dict(bounds),
        "backingDisplay": display,
        "virtualizationMode": virtualization_mode,
        "physicalMultiDisplayRequired": False,
        "observedAt": _now(),
    }
    ref = _write_json(output_dir / "screens" / f"{screen_id}.json", record)
    return {**record, "screenRef": ref}


def _live_windows() -> list[dict[str, Any]]:
    return [_normalize_window(item) for item in _window_inventory() if _bounds(item.get("bounds"))["width"] > 0 and _bounds(item.get("bounds"))["height"] > 0]


def _windows_for_virtual_screens(
    live_windows: Sequence[Mapping[str, Any]],
    screens: Sequence[Mapping[str, Any]],
    run_id: str,
    output_dir: Path,
) -> list[dict[str, Any]]:
    windows: list[dict[str, Any]] = []
    selected_ids: set[str] = set()
    per_screen_minimum = [2, 1]
    for screen_index, screen in enumerate(screens[:2]):
        screen_id = _string(screen.get("screenId")) or f"{run_id}-virtual-screen-{screen_index + 1}"
        candidates = [
            window
            for window in live_windows
            if _window_key(window) not in selected_ids and _intersects(_bounds(window.get("bounds")), _bounds(screen.get("bounds")))
        ]
        candidates.sort(key=lambda item: _area(_bounds(item.get("bounds"))), reverse=True)
        needed = per_screen_minimum[screen_index]
        for candidate in candidates[:needed]:
            selected_ids.add(_window_key(candidate))
            windows.append(_window_record(run_id, output_dir, screen_id, len(windows) + 1, candidate, "native-window"))
        while len([item for item in windows if item.get("screenId") == screen_id]) < needed:
            windows.append(_window_record(run_id, output_dir, screen_id, len(windows) + 1, _region_window(screen, len(windows) + 1), "virtual-screen-region"))
    return windows


def _window_record(
    run_id: str,
    output_dir: Path,
    screen_id: str,
    index: int,
    source: Mapping[str, Any],
    window_kind: str,
) -> dict[str, Any]:
    window_id = f"{run_id}-window-{index}"
    title = _string(source.get("title")) or ""
    owner = _string(source.get("owner")) or ""
    record = {
        "schemaVersion": MACOS_NATIVE_WINDOW_REF_SCHEMA,
        "runId": run_id,
        "windowId": window_id,
        "screenId": screen_id,
        "windowKind": window_kind,
        "nativeWindowId": source.get("nativeWindowId"),
        "bounds": _bounds(source.get("bounds")),
        "ownerNameSha256": _sha256(owner) if owner else None,
        "titleSha256": _sha256(title) if title else None,
        "titlePresent": bool(title),
        "refsFirst": True,
        "rawTitleWritten": False,
        "observedAt": _now(),
    }
    ref = _write_json(output_dir / "windows" / f"{window_id}.json", record)
    return {**record, "windowRef": ref}


def _actor_cursor_plan(run_id: str, screens: Sequence[Mapping[str, Any]], windows: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    first_screen = _string(screens[0].get("screenId")) if screens else None
    second_screen = _string(screens[1].get("screenId")) if len(screens) > 1 else None
    first_windows = [window for window in windows if _string(window.get("screenId")) == first_screen]
    second_windows = [window for window in windows if _string(window.get("screenId")) == second_screen]
    selected = [*first_windows[:2], *second_windows[:1]]
    return [
        {
            "actorId": f"{run_id}-actor-{index}",
            "cursorId": f"{run_id}-cursor-{index}",
            "screenId": window.get("screenId"),
            "windowId": window.get("windowId"),
            "windowRef": window.get("windowRef"),
            "actorCursorRef": window.get("windowRef"),
        }
        for index, window in enumerate(selected, start=1)
    ]


def _region_window(screen: Mapping[str, Any], index: int) -> dict[str, Any]:
    bounds = _bounds(screen.get("bounds"))
    width = max(1, bounds["width"] // 3)
    offset = ((index - 1) % 3) * width
    return {
        "nativeWindowId": None,
        "owner": "",
        "title": "",
        "bounds": {
            "x": bounds["x"] + min(offset, max(0, bounds["width"] - width)),
            "y": bounds["y"],
            "width": width,
            "height": max(1, bounds["height"] // 2),
        },
    }


def _load_discovery(output_dir: Path, run_id: str) -> dict[str, Any]:
    path = _discovery_path(output_dir, run_id)
    try:
        parsed = json.loads(path.read_text(encoding="utf8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return _mapping(parsed)


def _discovery_path(output_dir: Path, run_id: str) -> Path:
    return output_dir / "discovery" / f"{run_id}-discovery.json"


def _screen_by_id(discovery: Mapping[str, Any], screen_id: str) -> dict[str, Any]:
    for screen in _mapping_list(discovery.get("screens")):
        if _string(screen.get("screenId")) == screen_id:
            return dict(screen)
    return {}


def _host_available() -> dict[str, Any]:
    return {
        "darwin": platform.system() == "Darwin",
        "swift": bool(shutil.which("swift")),
        "screencapture": bool(shutil.which("screencapture")),
        "physicalMultiDisplayRequired": False,
    }


def _host_diagnostics(
    tool: str,
    *,
    displays: Sequence[Mapping[str, Any]] | None = None,
    live_windows: Sequence[Mapping[str, Any]] | None = None,
    capture_error: str | None = None,
) -> dict[str, Any]:
    availability = _host_available()
    blocked_reasons: list[str] = []
    if not availability["darwin"]:
        blocked_reasons.append("macos_native_sidecar_requires_darwin")
    if tool in {"capabilities", "discover"} and not availability["swift"]:
        blocked_reasons.append("swift_unavailable")
    if tool in {"capabilities", "preflight", "capture"} and not availability["screencapture"]:
        blocked_reasons.append("screencapture_unavailable")
    if displays is not None and not displays:
        blocked_reasons.append("cg_active_display_list_empty")
    window_inventory: dict[str, Any] = {
        "probed": live_windows is not None,
        "nativeWindowCount": len(live_windows or []),
        "cgWindowListEmpty": live_windows == [] if live_windows is not None else None,
        "blockedReason": None,
        "possibleCauses": [],
    }
    if live_windows == []:
        reason = "cg_window_list_empty_or_no_visible_windows"
        window_inventory["blockedReason"] = reason
        window_inventory["possibleCauses"] = [
            "screen_recording_permission_missing",
            "no_visible_windows",
            "cg_window_list_empty",
        ]
        blocked_reasons.append(reason)
    capture_probe = {
        "probed": capture_error is not None,
        "blockedReason": _capture_blocked_reason(capture_error or "") if capture_error is not None else None,
        "errorDigest": _sha256(capture_error) if capture_error else None,
    }
    if capture_probe["blockedReason"]:
        blocked_reasons.append(str(capture_probe["blockedReason"]))
    blocked_reasons = list(dict.fromkeys(blocked_reasons))
    return {
        "schemaVersion": MACOS_NATIVE_HOST_DIAGNOSTIC_SCHEMA,
        "tool": tool,
        "sidecarId": MACOS_NATIVE_SIDECAR_ID,
        "hostAvailability": availability,
        "displayInventory": {
            "probed": displays is not None,
            "displayCount": len(displays or []),
            "cgActiveDisplayListEmpty": displays == [] if displays is not None else None,
        },
        "windowInventory": window_inventory,
        "captureProbe": capture_probe,
        "blockedReason": blocked_reasons[0] if blocked_reasons else None,
        "blockedReasons": blocked_reasons,
        "refsFirst": True,
        "rawPayloadWritten": False,
        "inlineImageWritten": False,
        "secretsWritten": False,
        "observedAt": _now(),
    }


def _isolation_report(run_id: str, screen_id: str, status: str) -> dict[str, Any]:
    return {
        "schemaVersion": "sciforge.computer-use.platform-sidecar-isolation-report.v1",
        "runId": run_id,
        "screenId": screen_id,
        "status": status,
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
        "realOsInputExecuted": False,
        "inputAdapterKind": "independent-virtual-screen-sidecar",
        "rawPayloadWritten": False,
        "inlineImageWritten": False,
        "secretsWritten": False,
        "observedAt": _now(),
    }


def _write_diagnostic(output_dir: Path, run_id: str, tool: str, diagnostic: Mapping[str, Any]) -> str:
    return _write_json(output_dir / "diagnostics" / f"{run_id}-{_safe(tool)}-{_digest(diagnostic)}.json", diagnostic)


def _blocked(
    tool: str,
    reason: str,
    output_dir: Path,
    run_id: str,
    *,
    detail: str | None = None,
    diagnostics: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    diagnostic = dict(diagnostics or _host_diagnostics(tool))
    diagnostic["blockedReason"] = reason
    diagnostic["blockedReasons"] = list(dict.fromkeys([reason, *list(diagnostic.get("blockedReasons") or [])]))
    diagnostic_ref = _write_diagnostic(output_dir, run_id, tool, diagnostic)
    blocked_ref = _write_json(output_dir / "blocked" / f"{run_id}-{tool}-{_digest({'reason': reason, 'detail': detail})}.json", {
        "schemaVersion": MACOS_NATIVE_BLOCKED_DIAGNOSTIC_SCHEMA,
        "tool": tool,
        "runId": run_id,
        "reason": reason,
        "blockedReason": reason,
        "blockedReasons": diagnostic["blockedReasons"],
        "detail": detail,
        "hostDiagnosticRef": diagnostic_ref,
        "refsFirst": True,
        "rawPayloadWritten": False,
        "inlineImageWritten": False,
        "secretsWritten": False,
        "observedAt": _now(),
    })
    return _result(
        tool,
        "blocked",
        reason,
        refs=[blocked_ref, diagnostic_ref],
        value={"blockedDiagnosticRef": blocked_ref, "hostDiagnosticRef": diagnostic_ref},
        diagnostic_only=True,
    )


def _result(
    tool: str,
    status: str,
    reason: str,
    *,
    refs: Sequence[str],
    value: Mapping[str, Any],
    diagnostic_only: bool = False,
    virtual_input_executed: bool = False,
) -> dict[str, Any]:
    return {
        "schemaVersion": PLATFORM_SIDECAR_RESULT_SCHEMA,
        "tool": tool,
        "status": status,
        "reason": reason,
        "refs": [ref for ref in refs if ref],
        "value": dict(value),
        "diagnosticOnly": diagnostic_only,
        "userAcceptanceEligible": not diagnostic_only,
        "planningPerformed": False,
        "completionJudged": False,
        "userLevelCompletionClaimed": False,
        "guiAccessed": False,
        "guiDependencyUsed": False,
        "workspaceWritePolicyDeclared": False,
        "workspaceWritePerformed": False,
        "sharedSystemInputUsed": False,
        "systemPointerMoved": False,
        "systemKeyboardEventsSent": False,
        "realOsInputExecuted": False,
        "virtualInputExecuted": virtual_input_executed,
        "rawPayloadWritten": False,
        "inlineImageWritten": False,
        "secretsWritten": False,
        "nativeSidecarCommandExecuted": True,
    }


def _capture_blocked_reason(detail: str) -> str:
    lowered = detail.lower()
    if any(marker in lowered for marker in ("not authorized", "screen recording", "permission", "privacy")):
        return "screen_recording_permission_missing_or_denied"
    return "macos_screencapture_failed"


def _run(command: Sequence[str], *, input_text: str | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        list(command),
        input=input_text,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )


def _write_json(path: Path, payload: Mapping[str, Any]) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{json.dumps(payload, indent=2, sort_keys=True)}\n", encoding="utf8")
    return str(path.resolve())


def _normalize_display(value: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "displayIndex": int(value.get("displayIndex") or 0),
        "displayId": int(value.get("displayId") or 0),
        "main": bool(value.get("main")),
        "online": bool(value.get("online")),
        "bounds": _bounds(value.get("bounds")),
    }


def _normalize_window(value: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "nativeWindowId": value.get("windowId"),
        "owner": _string(value.get("owner")) or "",
        "title": _string(value.get("title")) or "",
        "bounds": _bounds(value.get("bounds")),
    }


def _bounds(value: Any) -> dict[str, int]:
    mapping = _mapping(value)
    return {
        "x": _int(mapping.get("x"), mapping.get("X"), default=0),
        "y": _int(mapping.get("y"), mapping.get("Y"), default=0),
        "width": max(1, _int(mapping.get("width"), mapping.get("Width"), default=1)),
        "height": max(1, _int(mapping.get("height"), mapping.get("Height"), default=1)),
    }


def _intersects(a: Mapping[str, int], b: Mapping[str, int]) -> bool:
    return not (
        a["x"] + a["width"] <= b["x"]
        or b["x"] + b["width"] <= a["x"]
        or a["y"] + a["height"] <= b["y"]
        or b["y"] + b["height"] <= a["y"]
    )


def _area(bounds: Mapping[str, int]) -> int:
    return max(0, bounds["width"]) * max(0, bounds["height"])


def _window_key(window: Mapping[str, Any]) -> str:
    return str(window.get("nativeWindowId") or _digest(window))


def _run_id(payload: Mapping[str, Any]) -> str:
    return _string(payload.get("runId")) or _string(_mapping(payload.get("metadata")).get("runId")) or "macos-native-sidecar-run"


def _display_group_id(payload: Mapping[str, Any], run_id: str) -> str:
    return _string(payload.get("displayGroupId")) or f"{run_id}-display-group"


def _mapping(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, Mapping) else {}


def _mapping_list(value: Any) -> list[Mapping[str, Any]]:
    return [item for item in value if isinstance(item, Mapping)] if isinstance(value, list) else []


def _string(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _string_list(value: Any) -> list[str]:
    return [item.strip() for item in value if isinstance(item, str) and item.strip()] if isinstance(value, list) else []


def _forbidden_payload_path(value: Any, path: str = "$", depth: int = 0) -> str | None:
    if depth > 8:
        return None
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered.startswith("data:image/") or "authorization: bearer" in lowered:
            return path
        return None
    if isinstance(value, list):
        for index, item in enumerate(value):
            found = _forbidden_payload_path(item, f"{path}[{index}]", depth + 1)
            if found:
                return found
        return None
    if not isinstance(value, Mapping):
        return None
    for key, item in value.items():
        key_text = str(key)
        normalized_key = "".join(ch for ch in key_text.lower() if ch.isalnum())
        item_path = f"{path}.{key_text}"
        if normalized_key in _FORBIDDEN_PAYLOAD_KEYS:
            return item_path
        found = _forbidden_payload_path(item, item_path, depth + 1)
        if found:
            return found
    return None


def _int(*values: Any, default: int) -> int:
    for value in values:
        if isinstance(value, (int, float)) and value == value:
            return int(value)
    return default


def _safe(value: str) -> str:
    return "".join(ch if ch.isalnum() or ch in {"-", "_"} else "-" for ch in value)[:120] or "ref"


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf8")).hexdigest()


def _digest(value: Mapping[str, Any]) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode("utf8")).hexdigest()[:12]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


__all__ = [
    "MACOS_NATIVE_SIDECAR_ID",
    "dispatch_macos_native_sidecar_request",
]


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
