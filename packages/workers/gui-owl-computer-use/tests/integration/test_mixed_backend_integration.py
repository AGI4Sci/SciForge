"""Opt-in real mixed CDP/UIA batch tests over one production router."""
from __future__ import annotations

import os
import sys
import threading
from datetime import datetime
from typing import Any

import pytest

if sys.platform != "win32":
    pytest.skip("Windows-only mixed backend integration", allow_module_level=True)

from cua.config import Config
from cua.runner import run_task
from cua.service import ComputerUseService
from driver.backends.windows_uia import WindowsUIABackend
from driver.channel import ChannelError
from driver.router import BackendRouter
from tests.integration.test_cdp_headless_integration import (
    _assert_no_host_focus_or_clipboard_change,
    _targets_by_name,
    cdp_stack as _cdp_stack_fixture,
)
from tests.integration.test_windows_uia_smoke import (
    _element_token,
    _host_state,
    uia_hosts as _uia_hosts_fixture,
)


pytestmark = pytest.mark.skipif(
    os.getenv("CUA_CDP_INTEGRATION") != "1" or os.getenv("CUA_UIA_SMOKE") != "1",
    reason="set CUA_CDP_INTEGRATION=1 and CUA_UIA_SMOKE=1",
)
_IMPORTED_FIXTURES = (_cdp_stack_fixture, _uia_hosts_fixture)


@pytest.fixture(name="cdp_stack")
def _mixed_cdp_stack(request):
    return request.getfixturevalue("_cdp_stack_fixture")


@pytest.fixture(name="uia_hosts")
def _mixed_uia_hosts(request):
    return request.getfixturevalue("_uia_hosts_fixture")


def _timestamp(value: str) -> float:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def _run_interval(result: dict) -> tuple[float, float]:
    data = result["data"]
    timeline = data["timeline"]
    return _timestamp(timeline["startedAt"]), _timestamp(timeline["finalObservedAt"])


def test_real_mixed_batch_overlaps_and_isolates_one_timeout(
    tmp_path, cdp_stack, uia_hosts,
) -> None:
    hosts, uia_desktop_before = uia_hosts
    cdp_desktop_before = cdp_stack.desktop_before
    cdp_targets = _targets_by_name(cdp_stack)
    service = ComputerUseService(router=BackendRouter([
        cdp_stack.backend(),
        WindowsUIABackend(),
    ]))
    sessions = {
        "cdp-A": cdp_targets["A"],
        "cdp-B": cdp_targets["B"],
        "uia-A": hosts["A"].target(),
        "uia-timeout": hosts["B"].target(),
    }
    for index, (label, target) in enumerate(sessions.items()):
        bound = service.bind_session({
            "sessionId": f"mixed-session-{label}",
            "owner": {"runtimeId": "mixed-integration", "threadId": f"mixed-{index}"},
            "target": target.to_dict(),
        })
        assert bound["ok"] is True, bound

    cfg = Config()
    cfg.artifact_dir = str(tmp_path)
    cfg.allow_execute = True
    cfg.show_overlay = False
    cfg.reflect = False
    successful_children_ready = threading.Barrier(3)

    def executor(request, channel):
        if "timeout" not in request["instruction"]:
            successful_children_ready.wait(timeout=15)
        return run_task(
            cfg,
            request["instruction"],
            channel,
            execute=True,
            approve=True,
            semantic_action=request["semanticAction"],
        )

    cdp_actions = {
        label: {
            "kind": "click",
            "role": "button",
            "name": f"Commit {label}",
            "expect": {
                "kind": "text-present",
                "text": '"clicks":1',
                "stableForMs": 250,
            },
        }
        for label in ("A", "B")
    }
    uia_value = "mixed-uia-alpha"
    uia_action = {
        "kind": "sequence",
        "steps": [
            {
                "kind": "write",
                "role": "textbox",
                "automationId": hosts["A"].handshake["editAutomationId"],
                "text": uia_value,
            },
            {"kind": "invoke", "role": "button", "name": "Commit A"},
            {"kind": "toggle", "role": "checkbox", "name": "Check A"},
        ],
        "expect": {
            "kind": "text-present",
            "text": f"text={uia_value};clicks=1;checked=1",
            "stableForMs": 250,
        },
    }
    timeout_action = {
        "kind": "sequence",
        "steps": [{
            "kind": "write",
            "role": "textbox",
            "automationId": hosts["B"].handshake["editAutomationId"],
            "text": "must-not-commit",
        }],
        "expect": {"kind": "text-present", "text": "must-not-commit"},
    }
    result = service.run_batch({
        "instruction": "real mixed backend verification",
        "requestId": "mixed-real-batch",
        "requestedIsolation": "host-app-scoped",
        "allowDegraded": False,
        "parallel": [
            {
                "instruction": "mixed CDP A",
                "sessionId": "mixed-session-cdp-A",
                "semanticAction": cdp_actions["A"],
                "requestedIsolation": "host-app-scoped",
                "allowDegraded": False,
            },
            {
                "instruction": "mixed UIA A",
                "sessionId": "mixed-session-uia-A",
                "semanticAction": uia_action,
                "requestedIsolation": "host-app-scoped",
                "allowDegraded": False,
            },
            {
                "instruction": "mixed CDP B",
                "sessionId": "mixed-session-cdp-B",
                "semanticAction": cdp_actions["B"],
                "requestedIsolation": "host-app-scoped",
                "allowDegraded": False,
            },
            {
                "instruction": "mixed UIA timeout",
                "sessionId": "mixed-session-uia-timeout",
                "semanticAction": timeout_action,
                "requestedIsolation": "host-app-scoped",
                "allowDegraded": False,
                "deadlineMs": 1,
            },
        ],
        "execute": True,
        "approve": True,
    }, executor, channel_options={"allow_execute": True})

    assert result["ok"] is True, result
    assert result["data"]["successCount"] == 3
    assert result["data"]["failureCount"] == 1
    children = {
        item["sessionId"]: item["result"]
        for item in result["data"]["results"]
    }
    assert children["mixed-session-uia-timeout"]["error"]["code"] == "TIMEOUT"
    for session_id in (
        "mixed-session-cdp-A", "mixed-session-cdp-B", "mixed-session-uia-A",
    ):
        assert children[session_id]["ok"] is True, children[session_id]
        data = children[session_id]["data"]
        assert data["requestedIsolation"] == data["effectiveIsolation"] == "host-app-scoped"
        assert data["degraded"] is False
        assert data["verification"]["matched"] is True

    intervals = [
        _run_interval(children[session_id])
        for session_id in (
            "mixed-session-cdp-A", "mixed-session-cdp-B", "mixed-session-uia-A",
        )
    ]
    overlap = min(end for _, end in intervals) - max(start for start, _ in intervals)
    assert overlap > 0.1, intervals

    state = cdp_stack.state.snapshot()
    assert state["A"]["clicks"] == state["B"]["clicks"] == 1
    assert state["C"]["clicks"] == 0
    final_uia = children["mixed-session-uia-A"]["data"]["finalObservation"]["semanticTree"]
    assert any(
        node.get("name") == f"text={uia_value};clicks=1;checked=1"
        for node in final_uia
    )

    timeout_readback = service.run({
        "instruction": "deterministic readback after timeout",
        "sessionId": "mixed-session-uia-timeout",
        "requestId": "mixed-timeout-readback",
        "semanticAction": {
            "kind": "observe",
            "expect": {
                "kind": "text-present", "text": "text=;clicks=0;checked=0",
                "stableForMs": 250,
            },
        },
        "requestedIsolation": "host-app-scoped",
        "allowDegraded": False,
        "execute": True,
        "approve": True,
    }, executor, channel_options={"allow_execute": True})
    assert timeout_readback["ok"] is True, timeout_readback
    assert timeout_readback["data"]["executed"] is False
    assert timeout_readback["data"]["stepCount"] == 0
    assert timeout_readback["data"]["backend"] == "windows-uia"
    assert timeout_readback["data"]["verification"]["matched"] is True
    assert not any(
        key.startswith("action") for key in timeout_readback["data"]
    )

    counts = service.registry.snapshot_counts()
    assert counts["requests"] == counts["activeLeases"] == 0
    assert service.status()["activeChannels"] == 0
    assert service.cleanup_pending() == []
    for label in sessions:
        released = service.release_session({"sessionId": f"mixed-session-{label}"})
        assert released["ok"] is True, released
    assert service.registry.snapshot_counts()["sessions"] == 0
    assert service.status()["activeChannels"] == 0
    assert service.cleanup_pending() == []
    _assert_no_host_focus_or_clipboard_change(cdp_desktop_before)
    assert _host_state() == uia_desktop_before


def test_mixed_uia_target_loss_does_not_break_cdp_or_uia_survivors(
    cdp_stack, uia_hosts,
) -> None:
    hosts, desktop_before = uia_hosts
    targets = _targets_by_name(cdp_stack)
    service = ComputerUseService(router=BackendRouter([
        cdp_stack.backend(),
        WindowsUIABackend(),
    ]))
    sessions = {
        "cdp-A": targets["A"],
        "uia-A": hosts["A"].target(),
        "lost-uia-B": hosts["B"].target(),
        "cdp-B": targets["B"],
    }
    for index, (label, target) in enumerate(sessions.items()):
        assert service.bind_session({
            "sessionId": f"mixed-loss-{label}",
            "owner": {"runtimeId": "mixed-loss", "threadId": str(index)},
            "target": target.to_dict(),
        })["ok"] is True

    all_observed = threading.Barrier(4)
    target_lost = threading.Event()
    action_intervals: dict[str, tuple[float, float]] = {}
    interval_lock = threading.Lock()

    def executor(request: dict[str, Any], channel):
        label = request["instruction"].rsplit(" ", 1)[-1]
        observed = channel.observe()
        all_observed.wait(timeout=15)
        if label == "lost-uia-B":
            hosts["B"].shutdown()
            target_lost.set()
            channel.observe()
            raise AssertionError("destroyed UIA target must not remain observable")
        assert target_lost.wait(timeout=15)
        started = datetime.now().timestamp()
        if label.startswith("cdp-"):
            outcome = channel.perform(
                {"action": "click", "coordinate": [260, 225]},
                expected_revision=observed.revision,
            )
        else:
            outcome = channel.perform({
                "action": "write",
                "elementToken": _element_token(observed, control_type=50004),
                "text": "mixed-loss-uia-survivor",
            }, expected_revision=observed.revision)
        completed = datetime.now().timestamp()
        with interval_lock:
            action_intervals[label] = (started, completed)
        return {
            "ok": True,
            "data": {
                "status": "verified",
                "targetId": outcome.target_id,
                "backend": channel.capabilities.backend.value,
                "verification": outcome.verification.value,
            },
        }

    before = cdp_stack.state.snapshot()
    result = service.run_batch({
        "instruction": "mixed target loss",
        "requestId": "mixed-target-loss",
        "parallel": [
            {
                "instruction": f"target-loss {label}",
                "sessionId": f"mixed-loss-{label}",
                "requestedIsolation": "host-app-scoped",
                "allowDegraded": False,
            }
            for label in sessions
        ],
    }, executor)

    assert result["ok"] is True, result
    assert result["data"]["successCount"] == 3
    assert result["data"]["failureCount"] == 1
    children = {
        item["sessionId"]: item["result"]
        for item in result["data"]["results"]
    }
    assert children["mixed-loss-lost-uia-B"]["error"]["code"] in {
        "TARGET_LOST", "BACKEND_UNAVAILABLE",
    }
    assert children["mixed-loss-cdp-A"]["ok"] is True
    assert children["mixed-loss-cdp-B"]["ok"] is True
    assert children["mixed-loss-uia-A"]["ok"] is True
    state = cdp_stack.state.snapshot()
    assert state["A"]["clicks"] == before["A"]["clicks"] + 1
    assert state["B"]["clicks"] == before["B"]["clicks"] + 1
    assert set(action_intervals) == {"cdp-A", "cdp-B", "uia-A"}
    assert service.registry.snapshot_counts()["requests"] == 0
    assert service.registry.snapshot_counts()["activeLeases"] == 0
    assert service.status()["activeChannels"] == 0
    for label in sessions:
        assert service.release_session({"sessionId": f"mixed-loss-{label}"})["ok"] is True
    assert service.registry.snapshot_counts()["sessions"] == 0
    assert service.cleanup_pending() == []
    _assert_no_host_focus_or_clipboard_change(cdp_stack.desktop_before)
    assert _host_state() == desktop_before


def test_mixed_parent_cancel_reaches_cdp_and_uia_without_replay(
    cdp_stack, uia_hosts,
) -> None:
    hosts, desktop_before = uia_hosts
    targets = _targets_by_name(cdp_stack)
    service = ComputerUseService(router=BackendRouter([
        cdp_stack.backend(),
        WindowsUIABackend(),
    ]))
    pairs = {
        "cdp-C": targets["C"],
        "uia-C": hosts["C"].target(),
    }
    for index, (label, target) in enumerate(pairs.items()):
        assert service.bind_session({
            "sessionId": f"mixed-cancel-{label}",
            "owner": {"runtimeId": "mixed-cancel", "threadId": str(index)},
            "target": target.to_dict(),
        })["ok"] is True

    ready = threading.Barrier(3)
    blocked_actions: list[str] = []
    blocked_lock = threading.Lock()
    batch_result: dict[str, Any] = {}

    def executor(request, channel):
        label = request["instruction"].rsplit(" ", 1)[-1]
        observed = channel.observe()
        ready.wait(timeout=15)
        try:
            channel.wait(30)
        except ChannelError as cancelled:
            assert cancelled.code == "CANCEL_PENDING"
            try:
                if label == "cdp-C":
                    channel.perform(
                        {"action": "click", "coordinate": [260, 225]},
                        expected_revision=observed.revision,
                    )
                else:
                    channel.perform({
                        "action": "write",
                        "elementToken": _element_token(observed, control_type=50004),
                        "text": "must-not-appear",
                    }, expected_revision=observed.revision)
            except ChannelError as blocked:
                assert blocked.code == "CANCEL_PENDING"
                with blocked_lock:
                    blocked_actions.append(label)
            raise

    before = cdp_stack.state.snapshot()
    worker = threading.Thread(target=lambda: batch_result.update(service.run_batch({
        "instruction": "cancel mixed backends",
        "requestId": "mixed-parent-cancel",
        "parallel": [
            {
                "instruction": f"wait {label}",
                "sessionId": f"mixed-cancel-{label}",
                "requestedIsolation": "host-app-scoped",
                "allowDegraded": False,
            }
            for label in pairs
        ],
    }, executor)))
    worker.start()
    ready.wait(timeout=15)
    cancelled = service.cancel({
        "requestId": "mixed-parent-cancel",
        "reason": "mixed-integration-cancel",
    })
    worker.join(timeout=20)

    assert not worker.is_alive()
    assert cancelled["ok"] is True
    assert len(cancelled["data"]["children"]) == 2
    assert batch_result["data"]["successCount"] == 0
    assert batch_result["data"]["failureCount"] == 2
    assert {
        item["result"]["error"]["code"]
        for item in batch_result["data"]["results"]
    } == {"CANCEL_PENDING"}
    assert set(blocked_actions) == set(pairs)
    assert cdp_stack.state.snapshot() == before
    assert service.registry.snapshot_counts()["requests"] == 0
    assert service.registry.snapshot_counts()["activeLeases"] == 0
    assert service.status()["activeChannels"] == 0
    for label in pairs:
        assert service.release_session({"sessionId": f"mixed-cancel-{label}"})["ok"] is True
    assert service.registry.snapshot_counts()["sessions"] == 0
    assert service.cleanup_pending() == []
    _assert_no_host_focus_or_clipboard_change(cdp_stack.desktop_before)
    assert _host_state() == desktop_before
