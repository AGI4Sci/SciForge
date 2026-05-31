from __future__ import annotations

import ast
import json
from pathlib import Path

from sciforge_computer_use import macos_native_sidecar as sidecar
from sciforge_computer_use.native_multi_screen_live_demo import (
    NATIVE_SIDECAR_CAPABILITIES_SCHEMA,
    NATIVE_SIDECAR_DISCOVERY_SCHEMA,
)
from sciforge_computer_use.platform_sidecar import PLATFORM_SIDECAR_RESULT_SCHEMA


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
SIDECAR_MODULE = PACKAGE_ROOT / "sciforge_computer_use" / "macos_native_sidecar.py"


_PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x02"
    b"\x00\x00\x00\x03\x08\x06\x00\x00\x00"
)


def test_macos_native_sidecar_virtualizes_multiple_screens_from_one_display(tmp_path, monkeypatch):
    monkeypatch.setattr(sidecar.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(sidecar.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(
        sidecar,
        "_display_inventory",
        lambda: [
            {
                "displayIndex": 1,
                "displayId": 10,
                "main": True,
                "online": True,
                "bounds": {"x": 0, "y": 0, "width": 1000, "height": 700},
            }
        ],
    )
    monkeypatch.setattr(
        sidecar,
        "_live_windows",
        lambda: [
            {
                "nativeWindowId": 42,
                "owner": "",
                "title": "",
                "bounds": {"x": 20, "y": 30, "width": 300, "height": 200},
            }
        ],
    )

    discovery_result = sidecar.dispatch_macos_native_sidecar_request(
        request("discover", tmp_path, {"runId": "m6-virtual", "displayGroupId": "dg"})
    )

    assert discovery_result["status"] == "completed"
    discovery = discovery_result["value"]["discovery"]
    assert len(discovery["screens"]) == 2
    assert {screen["virtualizationMode"] for screen in discovery["screens"]} == {"single-display-split-virtual-screen"}
    assert len(discovery["actorCursorPlan"]) == 3
    assert len({cursor["screenId"] for cursor in discovery["actorCursorPlan"]}) == 2
    assert len(discovery["windows"]) == 3
    assert any(window["windowKind"] == "virtual-screen-region" for window in discovery["windows"])
    assert all(Path(window["windowRef"]).is_file() for window in discovery["windows"])


def test_macos_native_sidecar_capture_state_and_execute_are_refs_first_virtual_input(tmp_path, monkeypatch):
    monkeypatch.setattr(sidecar.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(sidecar.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(
        sidecar,
        "_display_inventory",
        lambda: [
            {
                "displayIndex": 1,
                "displayId": 10,
                "main": True,
                "online": True,
                "bounds": {"x": 0, "y": 0, "width": 1000, "height": 700},
            }
        ],
    )
    monkeypatch.setattr(sidecar, "_live_windows", lambda: [])

    def fake_run(command, *, input_text=None):
        Path(command[-1]).write_bytes(_PNG_BYTES)
        return completed_process(command)

    monkeypatch.setattr(sidecar, "_run", fake_run)

    payload = {"runId": "m6-live", "displayGroupId": "dg"}
    discovery = sidecar.dispatch_macos_native_sidecar_request(request("discover", tmp_path, payload))["value"]["discovery"]
    screen_id = discovery["screens"][0]["screenId"]
    window_ref = discovery["windows"][0]["windowRef"]
    preflight = sidecar.dispatch_macos_native_sidecar_request(
        request("preflight", tmp_path, {**payload, "screenId": screen_id, "allowedWindowRefs": [window_ref], "inputModalityPolicy": {"sharedSystemInputAllowed": False}})
    )
    capture = sidecar.dispatch_macos_native_sidecar_request(
        request("capture", tmp_path, {**payload, "screenId": screen_id, "permissionPreflightRef": preflight["value"]["permissionPreflightRef"], "metadata": {"phase": "before"}})
    )
    state = sidecar.dispatch_macos_native_sidecar_request(
        request("state", tmp_path, {**payload, "screenId": screen_id, "permissionPreflightRef": preflight["value"]["permissionPreflightRef"]})
    )
    execute = sidecar.dispatch_macos_native_sidecar_request(
        request(
            "execute",
            tmp_path,
            {
                **payload,
                "screenId": screen_id,
                "windowId": discovery["windows"][0]["windowId"],
                "actorId": "actor-1",
                "cursorId": "cursor-1",
                "leaseId": "lease-1",
                "schedulerLeaseRef": "lease-1.json",
                "leaseScope": {"kind": "window-local", "screenId": screen_id, "windowId": discovery["windows"][0]["windowId"]},
                "permissionPreflightRef": preflight["value"]["permissionPreflightRef"],
                "beforeEvidenceRefs": [capture["value"]["captureRef"], state["value"]["stateRef"]],
                "afterEvidenceRefs": [capture["value"]["captureRef"]],
                "groundingRefs": [state["value"]["stateRef"], "target-ref.json"],
                "action": {"kind": "click"},
                "target": {"targetRef": "target-ref.json", "regionRef": "region-ref", "stateRef": state["value"]["stateRef"]},
            },
        )
    )

    assert preflight["status"] == "completed"
    assert capture["status"] == "completed"
    assert state["status"] == "completed"
    assert execute["status"] == "completed"
    assert execute["sharedSystemInputUsed"] is False
    assert execute["systemPointerMoved"] is False
    assert execute["systemKeyboardEventsSent"] is False
    event = json.loads(Path(execute["value"]["executorEventRef"]).read_text(encoding="utf8"))
    assert event["inputAdapterKind"] == "independent-virtual-screen-sidecar"
    assert event["nativeGuiMutationClaimed"] is False
    assert event["mutatingActionExecuted"] is True
    assert event["virtualInputExecuted"] is True
    assert event["realOsInputExecuted"] is False
    assert event["afterEvidenceRefs"] == [capture["value"]["captureRef"]]
    assert Path(capture["value"]["screenshotRef"]).is_file()


def test_macos_native_sidecar_execute_fail_closes_without_refs_first_lease_contract(tmp_path, monkeypatch):
    install_ready_host(monkeypatch)

    result = sidecar.dispatch_macos_native_sidecar_request(
        request(
            "execute",
            tmp_path,
            {
                "runId": "m6-missing-lease",
                "displayGroupId": "dg",
                "screenId": "screen-main",
                "action": {"kind": "click"},
                "target": {"targetRef": "target-ref.json"},
            },
        )
    )

    assert result["status"] == "blocked"
    assert result["diagnosticOnly"] is True
    assert result["virtualInputExecuted"] is False
    blocked = json.loads(Path(result["value"]["blockedDiagnosticRef"]).read_text(encoding="utf8"))
    assert "scheduler_lease_ref_missing" in blocked["blockedReasons"]
    assert "lease_scope_missing_or_invalid" in blocked["blockedReasons"]
    assert "permission_preflight_ref_missing" in blocked["blockedReasons"]
    assert "before_evidence_refs_missing" in blocked["blockedReasons"]
    assert "grounding_refs_missing" in blocked["blockedReasons"]
    assert "target_region_or_state_ref_missing" in blocked["blockedReasons"]


def test_macos_native_sidecar_execute_blocks_shared_input_and_raw_payload(tmp_path, monkeypatch):
    install_ready_host(monkeypatch)

    result = sidecar.dispatch_macos_native_sidecar_request(
        request(
            "execute",
            tmp_path,
            {
                "runId": "m6-raw-shared",
                "displayGroupId": "dg",
                "screenId": "screen-main",
                "windowId": "window-main",
                "actorId": "actor-1",
                "cursorId": "cursor-1",
                "leaseId": "lease-1",
                "schedulerLeaseRef": "leases/lease-1.json",
                "leaseScope": {"kind": "window-local", "screenId": "screen-main", "windowId": "window-main"},
                "permissionPreflightRef": "preflight/screen-main.json",
                "beforeEvidenceRefs": ["captures/before.json"],
                "groundingRefs": ["state/state.json"],
                "inputModalityPolicy": {"sharedSystemInputAllowed": True},
                "action": {"kind": "click"},
                "target": {
                    "targetRef": "targets/target-ref.json",
                    "regionRef": "regions/region-ref.json",
                    "screenshotBase64": "data:image/png;base64,AAAA",
                },
            },
        )
    )

    assert result["status"] == "blocked"
    blocked = json.loads(Path(result["value"]["blockedDiagnosticRef"]).read_text(encoding="utf8"))
    assert "shared_system_input_must_be_disabled" in blocked["blockedReasons"]
    assert any(reason.startswith("raw_or_secret_payload_forbidden:") for reason in blocked["blockedReasons"])


def test_macos_native_sidecar_six_tool_outputs_keep_schema_and_boundaries(tmp_path, monkeypatch):
    install_ready_host(monkeypatch)

    payload = {"runId": "m6-schema", "displayGroupId": "dg"}
    capabilities = sidecar.dispatch_macos_native_sidecar_request(request("capabilities", tmp_path, payload))
    discovery = sidecar.dispatch_macos_native_sidecar_request(request("discover", tmp_path, payload))
    discovery_record = discovery["value"]["discovery"]
    screen_id = discovery_record["screens"][0]["screenId"]
    window_ref = discovery_record["windows"][0]["windowRef"]
    preflight = sidecar.dispatch_macos_native_sidecar_request(
        request("preflight", tmp_path, {**payload, "screenId": screen_id, "allowedWindowRefs": [window_ref], "inputModalityPolicy": {"sharedSystemInputAllowed": False}})
    )
    capture = sidecar.dispatch_macos_native_sidecar_request(
        request("capture", tmp_path, {**payload, "screenId": screen_id, "permissionPreflightRef": preflight["value"]["permissionPreflightRef"]})
    )
    state = sidecar.dispatch_macos_native_sidecar_request(
        request("state", tmp_path, {**payload, "screenId": screen_id, "permissionPreflightRef": preflight["value"]["permissionPreflightRef"]})
    )
    execute = sidecar.dispatch_macos_native_sidecar_request(
        request(
            "execute",
            tmp_path,
            {
                **payload,
                "screenId": screen_id,
                "windowId": discovery_record["windows"][0]["windowId"],
                "actorId": "actor-1",
                "cursorId": "cursor-1",
                "leaseId": "lease-1",
                "schedulerLeaseRef": "lease-1.json",
                "leaseScope": {"kind": "window-local", "screenId": screen_id, "windowId": discovery_record["windows"][0]["windowId"]},
                "permissionPreflightRef": preflight["value"]["permissionPreflightRef"],
                "beforeEvidenceRefs": [capture["value"]["captureRef"], state["value"]["stateRef"]],
                "afterEvidenceRefs": [capture["value"]["captureRef"]],
                "groundingRefs": [state["value"]["stateRef"], "target-ref.json"],
                "action": {"kind": "click"},
                "target": {"targetRef": "target-ref.json", "regionRef": "region-ref", "stateRef": state["value"]["stateRef"]},
            },
        )
    )

    results = {
        "capabilities": capabilities,
        "discover": discovery,
        "preflight": preflight,
        "capture": capture,
        "state": state,
        "execute": execute,
    }
    assert list(results) == ["capabilities", "discover", "preflight", "capture", "state", "execute"]
    assert capabilities["value"]["capabilities"]["schemaVersion"] == NATIVE_SIDECAR_CAPABILITIES_SCHEMA
    assert discovery_record["schemaVersion"] == NATIVE_SIDECAR_DISCOVERY_SCHEMA
    for tool, result in results.items():
        assert result["schemaVersion"] == PLATFORM_SIDECAR_RESULT_SCHEMA
        assert result["tool"] == tool
        assert result["status"] == "completed"
        assert result["refs"]
        assert all(Path(ref).is_file() for ref in result["refs"] if ref.startswith("/"))
        assert result["planningPerformed"] is False
        assert result["completionJudged"] is False
        assert result["userLevelCompletionClaimed"] is False
        assert result["guiAccessed"] is False
        assert result["guiDependencyUsed"] is False
        assert result["workspaceWritePolicyDeclared"] is False
        assert result["workspaceWritePerformed"] is False
        assert result["sharedSystemInputUsed"] is False
        assert result["systemPointerMoved"] is False
        assert result["systemKeyboardEventsSent"] is False
        assert result["realOsInputExecuted"] is False
        assert result["virtualInputExecuted"] is (tool == "execute")
        assert result["rawPayloadWritten"] is False
        assert result["inlineImageWritten"] is False
        assert result["secretsWritten"] is False

    event = json.loads(Path(execute["value"]["executorEventRef"]).read_text(encoding="utf8"))
    input_log = json.loads(Path(execute["value"]["inputEventLogRef"]).read_text(encoding="utf8"))
    assert event["virtualInputExecuted"] is True
    assert event["realOsInputExecuted"] is False
    assert event["userLevelCompletionClaimed"] is False
    assert event["guiAccessed"] is False
    assert event["workspaceWritePerformed"] is False
    assert input_log["events"][0]["virtualInputExecuted"] is True
    assert input_log["events"][0]["realOsInputExecuted"] is False


def test_macos_native_sidecar_blocks_discover_without_swift_with_refs_first_diagnostics(tmp_path, monkeypatch):
    monkeypatch.setattr(sidecar.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(sidecar.shutil, "which", lambda name: None if name == "swift" else f"/usr/bin/{name}")

    result = sidecar.dispatch_macos_native_sidecar_request(request("discover", tmp_path, {"runId": "m6-noswift"}))

    assert result["status"] == "blocked"
    assert result["reason"] == "swift_unavailable"
    blocked = json.loads(Path(result["value"]["blockedDiagnosticRef"]).read_text(encoding="utf8"))
    diagnostic = json.loads(Path(result["value"]["hostDiagnosticRef"]).read_text(encoding="utf8"))
    assert blocked["blockedReason"] == "swift_unavailable"
    assert blocked["refsFirst"] is True
    assert diagnostic["blockedReason"] == "swift_unavailable"
    assert diagnostic["hostAvailability"]["swift"] is False


def test_macos_native_sidecar_blocks_preflight_without_screencapture(tmp_path, monkeypatch):
    monkeypatch.setattr(sidecar.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(sidecar.shutil, "which", lambda name: None if name == "screencapture" else f"/usr/bin/{name}")

    result = sidecar.dispatch_macos_native_sidecar_request(
        request(
            "preflight",
            tmp_path,
            {
                "runId": "m6-noscreencapture",
                "screenId": "screen-a",
                "allowedWindowRefs": ["window-ref.json"],
                "inputModalityPolicy": {"sharedSystemInputAllowed": False},
            },
        )
    )

    assert result["status"] == "blocked"
    preflight = json.loads(Path(result["value"]["permissionPreflightRef"]).read_text(encoding="utf8"))
    diagnostic = json.loads(Path(result["value"]["hostDiagnosticRef"]).read_text(encoding="utf8"))
    assert preflight["blockedReason"] == "screencapture_unavailable"
    assert diagnostic["hostAvailability"]["screencapture"] is False
    assert "screencapture_unavailable" in diagnostic["blockedReasons"]


def test_macos_native_sidecar_records_cgwindowlist_empty_diagnostic_without_raw_titles(tmp_path, monkeypatch):
    install_ready_host(monkeypatch, live_windows=[])

    result = sidecar.dispatch_macos_native_sidecar_request(request("discover", tmp_path, {"runId": "m6-empty-windows"}))

    assert result["status"] == "completed"
    discovery = result["value"]["discovery"]
    diagnostic = json.loads(Path(result["value"]["hostDiagnosticRef"]).read_text(encoding="utf8"))
    assert discovery["blockedReason"] == "cg_window_list_empty_or_no_visible_windows"
    assert diagnostic["windowInventory"]["cgWindowListEmpty"] is True
    assert "screen_recording_permission_missing" in diagnostic["windowInventory"]["possibleCauses"]
    assert any(window["windowKind"] == "virtual-screen-region" for window in discovery["windows"])
    assert all(window["rawTitleWritten"] is False for window in discovery["windows"])


def test_macos_native_sidecar_capture_failure_names_screen_recording_diagnostic(tmp_path, monkeypatch):
    install_ready_host(monkeypatch)

    def denied_run(command, *, input_text=None):
        return completed_process(command, returncode=1, stderr="Screen Recording permission denied")

    monkeypatch.setattr(sidecar, "_run", denied_run)
    payload = {"runId": "m6-screen-recording", "displayGroupId": "dg"}
    discovery = sidecar.dispatch_macos_native_sidecar_request(request("discover", tmp_path, payload))["value"]["discovery"]

    result = sidecar.dispatch_macos_native_sidecar_request(
        request("capture", tmp_path, {**payload, "screenId": discovery["screens"][0]["screenId"]})
    )

    assert result["status"] == "blocked"
    assert result["reason"] == "screen_recording_permission_missing_or_denied"
    diagnostic = json.loads(Path(result["value"]["hostDiagnosticRef"]).read_text(encoding="utf8"))
    assert diagnostic["captureProbe"]["blockedReason"] == "screen_recording_permission_missing_or_denied"
    assert diagnostic["captureProbe"]["errorDigest"]


def test_macos_native_sidecar_has_no_gui_workspace_or_planner_imports():
    tree = ast.parse(SIDECAR_MODULE.read_text(encoding="utf8"))
    imports = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.add("." * node.level + (node.module or ""))

    forbidden_fragments = (
        "src.runtime",
        "src.ui",
        "packages.presentation",
        "workspace",
        "planner",
        "completion",
        "validator",
    )
    assert not [module for module in imports if any(fragment in module for fragment in forbidden_fragments)]


def request(tool: str, output_dir: Path, payload: dict):
    return {
        "schemaVersion": "sciforge.computer-use.native-sidecar-dispatch-call.v1",
        "tool": tool,
        "payload": payload,
        "outputDir": str(output_dir),
        "platform": "macos",
    }


def install_ready_host(monkeypatch, *, live_windows=None):
    monkeypatch.setattr(sidecar.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(sidecar.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(
        sidecar,
        "_display_inventory",
        lambda: [
            {
                "displayIndex": 1,
                "displayId": 10,
                "main": True,
                "online": True,
                "bounds": {"x": 0, "y": 0, "width": 1000, "height": 700},
            }
        ],
    )
    monkeypatch.setattr(sidecar, "_live_windows", lambda: live_windows if live_windows is not None else [])

    def fake_run(command, *, input_text=None):
        Path(command[-1]).write_bytes(_PNG_BYTES)
        return completed_process(command)

    monkeypatch.setattr(sidecar, "_run", fake_run)


def completed_process(command, *, returncode=0, stdout="", stderr=""):
    import subprocess

    return subprocess.CompletedProcess(command, returncode, stdout=stdout, stderr=stderr)
