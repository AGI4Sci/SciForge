from __future__ import annotations

import json
from pathlib import Path

from sciforge_computer_use import macos_native_sidecar as sidecar


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
    assert Path(capture["value"]["screenshotRef"]).is_file()


def request(tool: str, output_dir: Path, payload: dict):
    return {
        "schemaVersion": "sciforge.computer-use.native-sidecar-dispatch-call.v1",
        "tool": tool,
        "payload": payload,
        "outputDir": str(output_dir),
        "platform": "macos",
    }


def completed_process(command):
    import subprocess

    return subprocess.CompletedProcess(command, 0, stdout="", stderr="")
