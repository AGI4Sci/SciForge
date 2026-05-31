from __future__ import annotations

import copy
import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Mapping

import pytest

from sciforge_computer_use.native_multi_screen_live_demo import (
    NATIVE_MULTI_SCREEN_LIVE_DEMO_RUN_SCHEMA,
    NATIVE_MULTI_SCREEN_SIDECAR_BINDING_SCHEMA,
    NATIVE_SIDECAR_CAPABILITIES_SCHEMA,
    NATIVE_SIDECAR_DISCOVERY_SCHEMA,
    run_native_multi_screen_live_demo,
    validate_native_multi_screen_live_demo_run,
)


PACKAGE_ROOT = Path(__file__).resolve().parents[1]


def test_native_multi_screen_live_demo_blocks_without_real_sidecar(tmp_path) -> None:
    manifest = run_native_multi_screen_live_demo(
        tmp_path / "m6-blocked",
        run_id="m6-blocked",
        observed_at="2026-05-31T12:00:00.000Z",
    )

    validation = validate_native_multi_screen_live_demo_run(manifest, require_existing_refs=True)

    assert manifest["schemaVersion"] == NATIVE_MULTI_SCREEN_LIVE_DEMO_RUN_SCHEMA
    assert manifest["status"] == "blocked"
    assert manifest["completionEligible"] is False
    assert manifest["realNativeSidecarExecuted"] is False
    assert manifest["diagnosticOnly"] is True
    assert manifest["dockerNovncRequired"] is False
    assert len(manifest["screens"]) == 2
    assert len({cursor["actorId"] for cursor in manifest["actorCursors"]}) == 3
    assert {call["tool"] for call in manifest["sidecarCalls"]} >= {"preflight", "capture", "state", "execute"}
    assert validation["ok"] is True


def test_native_multi_screen_live_demo_accepts_completed_real_sidecar_contract(tmp_path) -> None:
    manifest = run_native_multi_screen_live_demo(
        tmp_path / "m6-completed",
        run_id="m6-completed",
        observed_at="2026-05-31T12:00:00.000Z",
        sidecar_dispatcher=completed_sidecar_dispatcher,
    )

    validation = validate_native_multi_screen_live_demo_run(manifest, require_existing_refs=True)

    assert manifest["status"] == "completed"
    assert manifest["completionEligible"] is True
    assert manifest["realNativeSidecarExecuted"] is True
    assert manifest["diagnosticOnly"] is False
    assert manifest["fixture"] is False
    assert manifest["dryRun"] is False
    preflight_calls = [call for call in manifest["sidecarCalls"] if call["tool"] == "preflight"]
    assert {tuple(call["payload"]["allowedWindowRefs"]) for call in preflight_calls} == {
        ("native-window-ref-1", "native-window-ref-2"),
        ("native-window-ref-3",),
    }
    execute_calls = [call for call in manifest["sidecarCalls"] if call["tool"] == "execute"]
    assert all(call["payload"]["target"]["targetRef"] in manifest["targetRefs"] for call in execute_calls)
    assert all(call["payload"]["target"]["targetSource"] == "native-sidecar-discovery-state" for call in execute_calls)
    assert validation["ok"] is True, validation["errors"]


def test_native_multi_screen_live_demo_accepts_external_sidecar_command_contract(tmp_path) -> None:
    sidecar_script = write_completed_sidecar_command(tmp_path)
    manifest = run_native_multi_screen_live_demo(
        tmp_path / "m6-command",
        run_id="m6-command",
        observed_at="2026-05-31T12:00:00.000Z",
        platform="macos",
        sidecar_command=[sys.executable, str(sidecar_script)],
        sidecar_timeout_seconds=5,
    )

    validation = validate_native_multi_screen_live_demo_run(manifest, require_existing_refs=True)

    assert manifest["status"] == "completed"
    assert manifest["sidecarBinding"]["schemaVersion"] == NATIVE_MULTI_SCREEN_SIDECAR_BINDING_SCHEMA
    assert manifest["sidecarBinding"]["bindingKind"] == "external-command"
    assert manifest["sidecarBinding"]["commandDigest"]
    assert manifest["sidecarBindingRef"] in manifest["currentBundle"]["refs"]
    assert manifest["sidecarCapabilities"]["schemaVersion"] == NATIVE_SIDECAR_CAPABILITIES_SCHEMA
    assert manifest["sidecarDiscovery"]["schemaVersion"] == NATIVE_SIDECAR_DISCOVERY_SCHEMA
    assert manifest["screens"][0]["screenId"] == "m6-command-native-screen-1"
    assert manifest["actorCursors"][0]["windowId"] == "m6-command-native-window-1"
    assert len(manifest["cursorEvents"]) >= 3
    assert len(manifest["afterCaptureRefs"]) == 2
    assert len(manifest["afterStateRefs"]) == 2
    assert all(frame["screenshotRef"] for frame in manifest["replayBundle"]["frames"])
    assert all(frame["leaseOwnerRefs"] for frame in manifest["replayBundle"]["frames"])
    assert {call["result"]["value"]["bindingKind"] for call in manifest["sidecarCalls"]} == {"external-command"}
    assert validation["summary"]["realNativeSidecarExecuted"] is True
    assert validation["summary"]["screenCount"] == 2
    assert validation["summary"]["actorCursorCount"] == 3
    assert validation["summary"]["nonPlaceholderReplayScreenCount"] == 2
    assert validation["ok"] is True, validation["errors"]


def test_native_multi_screen_live_demo_blocks_completed_calls_without_discovery(tmp_path) -> None:
    manifest = run_native_multi_screen_live_demo(
        tmp_path / "m6-no-discovery",
        run_id="m6-no-discovery",
        sidecar_dispatcher=completed_sidecar_dispatcher_without_discovery,
    )

    validation = validate_native_multi_screen_live_demo_run(manifest, require_existing_refs=True)

    assert manifest["status"] == "blocked"
    assert manifest["blockedReason"] == "native-sidecar-capability-or-discovery-insufficient"
    assert manifest["realNativeSidecarExecuted"] is False
    assert validation["ok"] is True


def test_native_multi_screen_live_demo_blocks_completed_calls_without_discovery_windows(tmp_path) -> None:
    manifest = run_native_multi_screen_live_demo(
        tmp_path / "m6-no-discovery-windows",
        run_id="m6-no-discovery-windows",
        sidecar_dispatcher=completed_sidecar_dispatcher_without_discovery_windows,
    )

    validation = validate_native_multi_screen_live_demo_run(manifest, require_existing_refs=True)

    assert manifest["status"] == "blocked"
    assert manifest["blockedReason"] == "native-sidecar-capability-or-discovery-insufficient"
    assert manifest["realNativeSidecarExecuted"] is False
    assert validation["ok"] is True


def test_native_multi_screen_live_demo_rejects_completed_diagnostic_claim(tmp_path) -> None:
    manifest = run_native_multi_screen_live_demo(tmp_path / "m6-bad-completed", run_id="m6-bad-completed")
    invalid = copy.deepcopy(manifest)
    invalid["status"] = "completed"
    invalid["completionEligible"] = True
    invalid["realNativeSidecarExecuted"] = True
    invalid["diagnosticOnly"] = False

    validation = validate_native_multi_screen_live_demo_run(invalid)

    assert validation["ok"] is False
    codes = {error["code"] for error in validation["errors"]}
    assert "sidecar_call_not_completed" in codes
    assert "sidecar_call_not_live_eligible" in codes


def test_native_multi_screen_live_demo_rejects_legacy_backend_marker(tmp_path) -> None:
    manifest = run_native_multi_screen_live_demo(tmp_path / "m6-legacy", run_id="m6-legacy")
    invalid = copy.deepcopy(manifest)
    invalid["backendKind"] = "docker-novnc-native-multi-screen-sidecar"

    validation = validate_native_multi_screen_live_demo_run(invalid)

    assert validation["ok"] is False
    assert "legacy_docker_novnc_backend_forbidden" in {error["code"] for error in validation["errors"]}


def test_native_multi_screen_live_demo_rejects_completed_without_cursor_events(tmp_path) -> None:
    manifest = run_native_multi_screen_live_demo(
        tmp_path / "m6-no-cursor-events",
        run_id="m6-no-cursor-events",
        sidecar_dispatcher=completed_sidecar_dispatcher,
    )
    invalid = copy.deepcopy(manifest)
    invalid["cursorEvents"] = []
    invalid["replayBundle"]["cursorEventRefs"] = []

    validation = validate_native_multi_screen_live_demo_run(invalid)

    assert validation["ok"] is False
    codes = {error["code"] for error in validation["errors"]}
    assert "cursor_event_missing" in codes
    assert "replay_cursor_event_refs_missing" in codes


def test_native_multi_screen_live_demo_rejects_completed_replay_without_per_screen_screenshot_refs(tmp_path) -> None:
    manifest = run_native_multi_screen_live_demo(
        tmp_path / "m6-bad-replay",
        run_id="m6-bad-replay",
        sidecar_dispatcher=completed_sidecar_dispatcher,
    )
    invalid = copy.deepcopy(manifest)
    invalid["replayBundle"]["frames"][1]["screenshotRef"] = ""

    validation = validate_native_multi_screen_live_demo_run(invalid)

    assert validation["ok"] is False
    assert "replay_screenshot_missing_for_screen" in {error["code"] for error in validation["errors"]}


def test_native_multi_screen_live_demo_rejects_completed_sidecar_result_tool_mismatch(tmp_path) -> None:
    manifest = run_native_multi_screen_live_demo(
        tmp_path / "m6-tool-mismatch",
        run_id="m6-tool-mismatch",
        sidecar_dispatcher=completed_sidecar_dispatcher,
    )
    invalid = copy.deepcopy(manifest)
    invalid["sidecarCalls"][0]["result"]["tool"] = "execute"

    validation = validate_native_multi_screen_live_demo_run(invalid)

    assert validation["ok"] is False
    assert "sidecar_result_tool_mismatch" in {error["code"] for error in validation["errors"]}


def test_native_multi_screen_live_demo_rejects_completed_preflight_windows_outside_discovery(tmp_path) -> None:
    manifest = run_native_multi_screen_live_demo(
        tmp_path / "m6-bad-preflight-windows",
        run_id="m6-bad-preflight-windows",
        sidecar_dispatcher=completed_sidecar_dispatcher,
    )
    invalid = copy.deepcopy(manifest)
    for call in invalid["sidecarCalls"]:
        if call["tool"] == "preflight":
            call["payload"]["allowedWindowRefs"] = ["old-run-window-ref"]
            break

    validation = validate_native_multi_screen_live_demo_run(invalid)

    assert validation["ok"] is False
    assert "preflight_allowed_windows_not_discovery_allowlisted" in {error["code"] for error in validation["errors"]}


def test_native_multi_screen_live_demo_rejects_completed_execute_magic_target(tmp_path) -> None:
    manifest = run_native_multi_screen_live_demo(
        tmp_path / "m6-bad-target",
        run_id="m6-bad-target",
        sidecar_dispatcher=completed_sidecar_dispatcher,
    )
    invalid = copy.deepcopy(manifest)
    for call in invalid["sidecarCalls"]:
        if call["tool"] == "execute":
            call["payload"]["target"] = {
                "scope": "window",
                "screenId": invalid["screens"][0]["screenId"],
                "windowId": invalid["actorCursors"][0]["windowId"],
                "bounds": {"x": 32, "y": 32, "width": 96, "height": 32},
            }
            break

    validation = validate_native_multi_screen_live_demo_run(invalid)

    assert validation["ok"] is False
    codes = {error["code"] for error in validation["errors"]}
    assert "execute_target_ref_missing" in codes
    assert "execute_target_magic_bounds_forbidden" in codes


def test_native_multi_screen_live_demo_rejects_legacy_sidecar_command_marker(tmp_path) -> None:
    with pytest.raises(ValueError, match="legacy backend marker"):
        run_native_multi_screen_live_demo(
            tmp_path / "m6-legacy-command",
            run_id="m6-legacy-command",
            sidecar_command=["docker", "run", "native-sidecar"],
        )


def test_native_multi_screen_live_demo_cli_emits_blocked_manifest(tmp_path) -> None:
    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "sciforge_computer_use.native_multi_screen_live_demo",
            "--output-dir",
            str(tmp_path / "m6-cli"),
            "--run-id",
            "m6-cli",
        ],
        cwd=PACKAGE_ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )

    assert completed.returncode == 1
    assert completed.stderr == ""
    payload = json.loads(completed.stdout)
    assert payload["manifest"]["status"] == "blocked"
    assert payload["validation"]["ok"] is True


def write_completed_sidecar_command(tmp_path: Path) -> Path:
    script = tmp_path / "completed_native_sidecar.py"
    script.write_text(
        """
import hashlib
import json
import pathlib
import sys

request = json.loads(sys.stdin.read())
tool = request["tool"]
payload = request["payload"]
output_dir = pathlib.Path(request["outputDir"])
output_dir.mkdir(parents=True, exist_ok=True)
digest = hashlib.sha256(json.dumps({"tool": tool, "payload": payload}, sort_keys=True).encode("utf8")).hexdigest()[:12]
ref = output_dir / f"external-{tool}-{digest}.json"
value_key = {
    "capabilities": "capabilitiesRef",
    "discover": "discoveryRef",
    "preflight": "permissionPreflightRef",
    "capture": "captureRef",
    "state": "stateRef",
    "execute": "executorEventRef",
}[tool]
run_id = payload.get("runId") or payload.get("metadata", {}).get("runId") or "unknown-run"
display_group_id = payload.get("displayGroupId") or payload.get("metadata", {}).get("displayGroupId") or "unknown-display-group"
capabilities = {
    "schemaVersion": "sciforge.computer-use.native-sidecar-capabilities.v1",
    "runId": run_id,
    "displayGroupId": display_group_id,
    "sidecarId": "external-test-native-sidecar",
    "features": ["multi-screen", "multi-actor-cursor", "window-local-lease", "screen-global-lease", "refs-first-evidence"],
    "tools": ["capabilities", "discover", "preflight", "capture", "state", "execute"],
    "diagnosticOnly": False,
    "dockerNovncRequired": False,
    "planningPerformed": False,
    "completionJudged": False,
    "sharedSystemInputAllowed": False,
}
window_ref_1 = output_dir / f"{run_id}-native-window-1.json"
window_ref_2 = output_dir / f"{run_id}-native-window-2.json"
window_ref_3 = output_dir / f"{run_id}-native-window-3.json"
for index, window_ref in enumerate([window_ref_1, window_ref_2, window_ref_3], start=1):
    window_ref.write_text(json.dumps({"schemaVersion": "sciforge.computer-use.native-window-ref.v1", "windowIndex": index, "runId": run_id}) + "\\n", encoding="utf8")
discovery = {
    "schemaVersion": "sciforge.computer-use.native-sidecar-discovery.v1",
    "runId": run_id,
    "displayGroupId": display_group_id,
    "screens": [
        {"screenId": f"{run_id}-native-screen-1", "displayGroupId": display_group_id, "bounds": {"x": 0, "y": 0, "width": 1200, "height": 800}},
        {"screenId": f"{run_id}-native-screen-2", "displayGroupId": display_group_id, "bounds": {"x": 1200, "y": 0, "width": 1000, "height": 760}},
    ],
    "windows": [
        {"windowId": f"{run_id}-native-window-1", "screenId": f"{run_id}-native-screen-1", "windowRef": str(window_ref_1), "bounds": {"x": 40, "y": 40, "width": 520, "height": 360}},
        {"windowId": f"{run_id}-native-window-2", "screenId": f"{run_id}-native-screen-1", "windowRef": str(window_ref_2), "bounds": {"x": 600, "y": 40, "width": 520, "height": 360}},
        {"windowId": f"{run_id}-native-window-3", "screenId": f"{run_id}-native-screen-2", "windowRef": str(window_ref_3), "bounds": {"x": 1240, "y": 40, "width": 520, "height": 360}},
    ],
    "actorCursorPlan": [
        {"actorId": f"{run_id}-native-actor-1", "cursorId": f"{run_id}-native-cursor-1", "screenId": f"{run_id}-native-screen-1", "windowId": f"{run_id}-native-window-1"},
        {"actorId": f"{run_id}-native-actor-2", "cursorId": f"{run_id}-native-cursor-2", "screenId": f"{run_id}-native-screen-1", "windowId": f"{run_id}-native-window-2"},
        {"actorId": f"{run_id}-native-actor-3", "cursorId": f"{run_id}-native-cursor-3", "screenId": f"{run_id}-native-screen-2", "windowId": f"{run_id}-native-window-3"},
    ],
}
ref_payload = capabilities if tool == "capabilities" else discovery if tool == "discover" else {"tool": tool, "payload": payload, "platform": request.get("platform")}
ref.write_text(json.dumps(ref_payload, sort_keys=True) + "\\n", encoding="utf8")
value = {value_key: str(ref), "isolationReportRef": str(ref), "bindingKind": "external-command"}
if tool == "capabilities":
    value["capabilities"] = capabilities
if tool == "discover":
    value["discovery"] = discovery
print(json.dumps({
    "schemaVersion": "sciforge.computer-use.platform-sidecar-result.v1",
    "tool": tool,
    "status": "completed",
    "reason": "external-native-sidecar-completed",
    "refs": [str(ref)],
    "value": value,
    "diagnosticOnly": False,
    "userAcceptanceEligible": True,
    "planningPerformed": False,
    "completionJudged": False,
    "sharedSystemInputUsed": False,
    "systemPointerMoved": False,
    "systemKeyboardEventsSent": False,
    "realOsInputExecuted": tool == "execute",
    "rawPayloadWritten": False,
    "inlineImageWritten": False,
    "secretsWritten": False,
    "nativeSidecarCommandExecuted": True,
}, sort_keys=True))
""".lstrip(),
        encoding="utf8",
    )
    return script


def completed_sidecar_dispatcher(
    tool: str,
    payload: Mapping[str, Any],
    *,
    output_dir: str | Path | None = None,
    platform: str | None = None,
) -> dict[str, Any]:
    out = Path(output_dir or ".")
    out.mkdir(parents=True, exist_ok=True)
    digest = abs(hash(json.dumps({"tool": tool, "payload": dict(payload)}, sort_keys=True, default=str)))
    ref = out / f"live-{tool}-{digest}.json"
    ref.write_text(json.dumps({"tool": tool, "payload": dict(payload), "platform": platform}, sort_keys=True) + "\n", encoding="utf8")
    ref_text = str(ref)
    value_key = {
        "capabilities": "capabilitiesRef",
        "discover": "discoveryRef",
        "preflight": "permissionPreflightRef",
        "capture": "captureRef",
        "state": "stateRef",
        "execute": "executorEventRef",
    }[tool]
    value: dict[str, Any] = {
        value_key: ref_text,
        "isolationReportRef": ref_text,
    }
    if tool == "capabilities":
        value["capabilities"] = capability_payload(payload)
    if tool == "discover":
        value["discovery"] = discovery_payload(payload)
    return {
        "schemaVersion": "sciforge.computer-use.platform-sidecar-result.v1",
        "tool": tool,
        "status": "completed",
        "reason": "live-sidecar-completed",
        "refs": [ref_text],
        "value": value,
        "diagnosticOnly": False,
        "userAcceptanceEligible": True,
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


def completed_sidecar_dispatcher_without_discovery(
    tool: str,
    payload: Mapping[str, Any],
    *,
    output_dir: str | Path | None = None,
    platform: str | None = None,
) -> dict[str, Any]:
    out = Path(output_dir or ".")
    out.mkdir(parents=True, exist_ok=True)
    ref = out / f"live-{tool}-without-discovery.json"
    ref.write_text(json.dumps({"tool": tool, "payload": dict(payload), "platform": platform}, sort_keys=True) + "\n", encoding="utf8")
    value_key = {
        "capabilities": "capabilitiesRef",
        "discover": "discoveryRef",
        "preflight": "permissionPreflightRef",
        "capture": "captureRef",
        "state": "stateRef",
        "execute": "executorEventRef",
    }[tool]
    return {
        "schemaVersion": "sciforge.computer-use.platform-sidecar-result.v1",
        "tool": tool,
        "status": "completed",
        "reason": "live-sidecar-completed-without-discovery",
        "refs": [str(ref)],
        "value": {value_key: str(ref), "isolationReportRef": str(ref)},
        "diagnosticOnly": False,
        "userAcceptanceEligible": True,
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


def completed_sidecar_dispatcher_without_discovery_windows(
    tool: str,
    payload: Mapping[str, Any],
    *,
    output_dir: str | Path | None = None,
    platform: str | None = None,
) -> dict[str, Any]:
    result = completed_sidecar_dispatcher(tool, payload, output_dir=output_dir, platform=platform)
    if tool == "discover":
        discovery = copy.deepcopy(discovery_payload(payload))
        discovery.pop("windows", None)
        result["value"]["discovery"] = discovery
    return result


def capability_payload(payload: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "schemaVersion": NATIVE_SIDECAR_CAPABILITIES_SCHEMA,
        "runId": payload["runId"],
        "displayGroupId": payload["displayGroupId"],
        "sidecarId": "test-native-sidecar",
        "features": ["multi-screen", "multi-actor-cursor", "window-local-lease", "screen-global-lease", "refs-first-evidence"],
        "tools": ["capabilities", "discover", "preflight", "capture", "state", "execute"],
        "diagnosticOnly": False,
        "dockerNovncRequired": False,
        "planningPerformed": False,
        "completionJudged": False,
        "sharedSystemInputAllowed": False,
    }


def discovery_payload(payload: Mapping[str, Any]) -> dict[str, Any]:
    run_id = str(payload["runId"])
    display_group_id = str(payload["displayGroupId"])
    return {
        "schemaVersion": NATIVE_SIDECAR_DISCOVERY_SCHEMA,
        "runId": run_id,
        "displayGroupId": display_group_id,
        "screens": [
            {"screenId": f"{run_id}-native-screen-1", "displayGroupId": display_group_id, "bounds": {"x": 0, "y": 0, "width": 1200, "height": 800}},
            {"screenId": f"{run_id}-native-screen-2", "displayGroupId": display_group_id, "bounds": {"x": 1200, "y": 0, "width": 1000, "height": 760}},
        ],
        "windows": [
            {"windowId": f"{run_id}-native-window-1", "screenId": f"{run_id}-native-screen-1", "windowRef": "native-window-ref-1"},
            {"windowId": f"{run_id}-native-window-2", "screenId": f"{run_id}-native-screen-1", "windowRef": "native-window-ref-2"},
            {"windowId": f"{run_id}-native-window-3", "screenId": f"{run_id}-native-screen-2", "windowRef": "native-window-ref-3"},
        ],
        "actorCursorPlan": [
            {"actorId": f"{run_id}-native-actor-1", "cursorId": f"{run_id}-native-cursor-1", "screenId": f"{run_id}-native-screen-1", "windowId": f"{run_id}-native-window-1"},
            {"actorId": f"{run_id}-native-actor-2", "cursorId": f"{run_id}-native-cursor-2", "screenId": f"{run_id}-native-screen-1", "windowId": f"{run_id}-native-window-2"},
            {"actorId": f"{run_id}-native-actor-3", "cursorId": f"{run_id}-native-cursor-3", "screenId": f"{run_id}-native-screen-2", "windowId": f"{run_id}-native-window-3"},
        ],
    }
