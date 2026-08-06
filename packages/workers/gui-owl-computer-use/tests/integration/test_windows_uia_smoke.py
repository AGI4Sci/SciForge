"""Opt-in UIA tests against three test-owned standard Win32 windows."""
from __future__ import annotations

import ctypes
import json
import os
import queue
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest

from cua import result as R
from cua.service import ComputerUseService
from cua.target import TargetDescriptor, parse_target_descriptor
from driver.backend import BackendOpenContext, BackendOperationError
from driver.backends.windows_uia import WindowsUIABackend
from driver.channel import ChannelError
from driver.router import BackendRouter
from tests.integration._process_guard import OwnedProcesses


pytestmark = pytest.mark.skipif(
    sys.platform != "win32" or os.getenv("CUA_UIA_SMOKE") != "1",
    reason="set CUA_UIA_SMOKE=1 on Windows to start test-owned native windows",
)

HOST_SCRIPT = Path(__file__).with_name("_native_uia_window_host.py")
LABELS = ("A", "B", "C")
VALUES = {"A": "uia-alpha-A", "B": "uia-beta-B", "C": "uia-gamma-C"}

user32 = ctypes.WinDLL("user32", use_last_error=True)
user32.GetForegroundWindow.argtypes = []
user32.GetForegroundWindow.restype = ctypes.c_void_p
user32.GetClipboardSequenceNumber.argtypes = []
user32.GetClipboardSequenceNumber.restype = ctypes.c_ulong
user32.IsWindow.argtypes = [ctypes.c_void_p]
user32.IsWindow.restype = ctypes.c_bool
user32.SendMessageW.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_size_t, ctypes.c_void_p]
user32.SendMessageW.restype = ctypes.c_ssize_t
WM_SETTEXT = 0x000C


def _host_state() -> tuple[int, int]:
    return int(user32.GetForegroundWindow() or 0), int(user32.GetClipboardSequenceNumber())


@dataclass
class NativeHost:
    label: str
    process: subprocess.Popen[str]
    handshake: dict[str, Any]

    @property
    def pid(self) -> int:
        return int(self.handshake["pid"])

    @property
    def hwnd(self) -> int:
        return int(self.handshake["hwnd"])

    def target(self) -> TargetDescriptor:
        return parse_target_descriptor({
            "targetId": f"uia-smoke:{self.label}:{self.pid}:{self.hwnd}",
            "kind": "windows-uia",
            "ownership": "attached",
            "locator": {"processId": self.pid, "nativeWindowHandle": str(self.hwnd)},
            "generation": f"host-{self.pid}-{self.hwnd}",
            "metadata": {"title": f"SciForge Controlled UIA {self.label}", "processName": "python"},
        })

    def shutdown(self) -> None:
        if self.process.poll() is None and self.process.stdin is not None:
            self.process.stdin.write("shutdown\n")
            self.process.stdin.flush()
            self.process.wait(timeout=10)


def _readline(process: subprocess.Popen[str], timeout_s: float = 10.0) -> str:
    output: queue.Queue[str] = queue.Queue(maxsize=1)
    threading.Thread(target=lambda: output.put(process.stdout.readline()), daemon=True).start()
    try:
        return output.get(timeout=timeout_s)
    except queue.Empty as error:
        raise AssertionError(f"native UIA host PID {process.pid} did not provide a handshake") from error


def _start_host(label: str, processes: OwnedProcesses) -> NativeHost:
    host_python = getattr(sys, "_base_executable", sys.executable)
    process = processes.add(subprocess.Popen(
        [host_python, str(HOST_SCRIPT), label],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        creationflags=subprocess.CREATE_NO_WINDOW,
    ))
    line = _readline(process)
    if not line:
        stderr = process.stderr.read() if process.stderr is not None else ""
        raise AssertionError(f"native UIA host exited before handshake: {stderr}")
    handshake = json.loads(line)
    assert int(handshake["pid"]) == process.pid
    assert user32.IsWindow(int(handshake["hwnd"]))
    return NativeHost(label, process, handshake)


@pytest.fixture(scope="module")
def uia_hosts() -> tuple[dict[str, NativeHost], tuple[int, int]]:
    processes = OwnedProcesses()
    before = _host_state()
    hosts: dict[str, NativeHost] = {}
    cleanup_errors: list[str] = []
    try:
        for label in LABELS:
            hosts[label] = _start_host(label, processes)
        assert _host_state() == before
        yield hosts, before
    finally:
        for host in reversed(list(hosts.values())):
            try:
                host.shutdown()
            except Exception as error:
                cleanup_errors.append(f"host {host.label} shutdown: {error}")
        cleanup_errors.extend(processes.close())
        try:
            processes.assert_stopped()
        except AssertionError as error:
            cleanup_errors.append(str(error))
        for host in hosts.values():
            if user32.IsWindow(host.hwnd):
                cleanup_errors.append(f"host {host.label} HWND {host.hwnd} remains")
        if cleanup_errors:
            pytest.fail("; ".join(cleanup_errors))


def _element_id(observation, *, name: str | None = None, control_type: int | None = None) -> str:
    for node in observation.metadata["semanticTree"]:
        if name is not None and str(node.get("name") or "") != name:
            continue
        if control_type is not None and int(node.get("controlType") or 0) != control_type:
            continue
        value = str(node.get("elementId") or "")
        if value:
            return value
    raise AssertionError(f"UIA element was not found: name={name!r}, controlType={control_type!r}")


def _node_name(observation, element_id: str) -> str:
    for node in observation.metadata["semanticTree"]:
        if str(node.get("elementId") or "") == element_id:
            return str(node.get("name") or "")
    raise AssertionError(f"elementId {element_id} was not found")


def test_single_window_real_patterns_without_activation(uia_hosts) -> None:
    hosts, desktop_before = uia_hosts
    host = hosts["A"]
    backend = WindowsUIABackend()
    capability = backend.probe()
    assert capability.available is True, capability.reason
    context = BackendOpenContext("uia-single", True, 0, False, threading.Event())
    handle = backend.open(host.target(), context)
    observation = backend.observe(handle)
    assert observation.metadata["imageAvailable"] is False
    edit_id = _element_id(observation, control_type=50004)
    _element_id(observation, name="Commit A")
    _element_id(observation, name="Check A")
    _element_id(observation, control_type=50020)
    receipt = backend.perform(handle, {
        "action": "write",
        "elementId": edit_id,
        "text": "single-uia-A",
    }, observation.revision)
    evidence = backend.verify(handle, {"action": "write"}, receipt, observation)
    assert evidence.status.value == "verified"
    assert evidence.details["actual"] == "single-uia-A"
    backend.close(handle, "done")
    assert _host_state() == desktop_before


def test_three_sessions_write_invoke_toggle_without_cross_line(uia_hosts) -> None:
    hosts, desktop_before = uia_hosts
    backend = WindowsUIABackend()
    service = ComputerUseService(router=BackendRouter([backend]))
    barrier = threading.Barrier(3)
    for index, label in enumerate(LABELS):
        bound = service.bind_session({
            "sessionId": f"uia-smoke-session-{label}",
            "owner": {"runtimeId": "integration", "threadId": f"uia-thread-{index}"},
            "target": hosts[label].target().to_dict(),
        })
        assert bound["ok"] is True

    def execute(label: str, _request, channel):
        before = channel.observe()
        edit_id = _element_id(before, control_type=50004)
        button_id = _element_id(before, name=f"Commit {label}")
        check_id = _element_id(before, name=f"Check {label}")
        status_id = _element_id(before, control_type=50020)
        barrier.wait(timeout=10)
        written = channel.perform({
            "action": "write",
            "elementId": edit_id,
            "text": VALUES[label],
        }, expected_revision=before.revision)
        assert written.verification.value == "verified"
        after_write = channel.observe()
        invoked = channel.perform({
            "action": "invoke",
            "elementId": button_id,
        }, expected_revision=after_write.revision)
        after_invoke = channel.observe()
        toggled = channel.perform({
            "action": "toggle",
            "elementId": check_id,
        }, expected_revision=after_invoke.revision)
        final = channel.observe()
        status = _node_name(final, status_id)
        return R.ok({
            "targetId": final.target_id,
            "written": written.evidence,
            "invokeVerification": invoked.verification.value,
            "toggle": toggled.evidence,
            "status": status,
        })

    def run(label: str):
        return service.run(
            {
                "instruction": f"controlled UIA {label}",
                "sessionId": f"uia-smoke-session-{label}",
                "requestId": f"uia-smoke-request-{label}",
            },
            lambda request, channel: execute(label, request, channel),
        )

    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(run, LABELS))

    for label, result in zip(LABELS, results, strict=True):
        assert result["ok"] is True, result
        assert result["data"]["targetId"] == hosts[label].target().target_id
        assert result["data"]["written"]["actual"] == VALUES[label]
        assert result["data"]["toggle"]["before"] != result["data"]["toggle"]["after"]
        assert f"text={VALUES[label]}" in result["data"]["status"]
        assert "clicks=1" in result["data"]["status"]
        assert "checked=1" in result["data"]["status"]
    counts = service.registry.snapshot_counts()
    assert counts["requests"] == counts["activeLeases"] == 0
    for label in LABELS:
        assert service.release_session({"sessionId": f"uia-smoke-session-{label}"})["ok"] is True
    assert service.registry.snapshot_counts()["sessions"] == 0
    assert service.status()["activeChannels"] == 0
    assert service.cleanup_pending() == []
    assert _host_state() == desktop_before


def test_stale_coordinate_and_cancel_are_side_effect_free(uia_hosts) -> None:
    hosts, _desktop_before = uia_hosts
    host = hosts["C"]
    backend = WindowsUIABackend()
    context = BackendOpenContext("uia-stale", True, 0, False, threading.Event())
    handle = backend.open(host.target(), context)
    before = backend.observe(handle)
    edit_id = _element_id(before, control_type=50004)
    assert user32.SendMessageW(
        int(host.handshake["editHwnd"]), WM_SETTEXT, 0, ctypes.c_wchar_p("external-C"),
    )
    with pytest.raises(BackendOperationError) as stale:
        backend.perform(handle, {
            "action": "write",
            "elementId": edit_id,
            "text": "must-not-replace",
        }, before.revision)
    assert stale.value.code == "STALE_OBSERVATION"
    current = backend.observe(handle)
    with pytest.raises(BackendOperationError) as coordinate:
        backend.perform(handle, {"action": "click", "coordinate": [10, 10]}, current.revision)
    assert coordinate.value.code == "ACTION_UNSUPPORTED"
    backend.close(handle, "done")

    service = ComputerUseService(router=BackendRouter([WindowsUIABackend()]))
    target = host.target()

    def execute(_request, channel):
        observed = channel.observe()
        edit_id = _element_id(observed, control_type=50004)
        service.cancel({"requestId": "uia-cancelled", "reason": "integration-test"})
        try:
            channel.perform({
                "action": "write",
                "elementId": edit_id,
                "text": "must-not-appear",
            }, expected_revision=observed.revision)
        except ChannelError as error:
            return R.err(error.code, str(error))
        return R.ok({"status": "incorrect"})

    result = service.run(
        {"instruction": "cancel UIA", "target": target.to_dict(), "requestId": "uia-cancelled"},
        execute,
    )
    assert result["error"]["code"] == "CANCEL_PENDING"
    assert service.registry.snapshot_counts()["activeLeases"] == 0
    assert service.registry.snapshot_counts()["sessions"] == 0
    assert service.status()["activeChannels"] == 0
    assert service.cleanup_pending() == []


def test_destroyed_target_does_not_break_surviving_windows(uia_hosts) -> None:
    hosts, desktop_before = uia_hosts
    backend = WindowsUIABackend()
    handles = {}
    for label in LABELS:
        handles[label] = backend.open(
            hosts[label].target(),
            BackendOpenContext(f"uia-loss-{label}", True, 0, False, threading.Event()),
        )
    hosts["B"].shutdown()
    assert not user32.IsWindow(hosts["B"].hwnd)
    with pytest.raises(BackendOperationError) as lost:
        backend.observe(handles["B"])
    assert lost.value.code == "TARGET_LOST"
    for label in ("A", "C"):
        observation = backend.observe(handles[label])
        assert observation.target_id == hosts[label].target().target_id
    for label, handle in handles.items():
        backend.close(handle, f"done-{label}")
    assert _host_state() == desktop_before
