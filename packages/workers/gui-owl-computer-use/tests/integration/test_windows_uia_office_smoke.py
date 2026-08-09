"""Opt-in UIA smoke against a test-owned blank Excel workbook."""
from __future__ import annotations

import os
import sys

import pytest

if sys.platform != "win32":
    pytest.skip("Windows-only Office UIA smoke", allow_module_level=True)

import ctypes
import json
import queue
import shutil
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path

from driver.backend import BackendOpenContext
from driver.backends.windows_uia import WindowsUIABackend
from tests.integration._process_guard import OwnedProcesses


pytestmark = pytest.mark.skipif(
    sys.platform != "win32" or os.getenv("CUA_UIA_OFFICE_SMOKE") != "1",
    reason="set CUA_UIA_OFFICE_SMOKE=1 on Windows to start a test-owned blank Excel workbook",
)

HOST_SCRIPT = Path(__file__).with_name("_office_uia_host.ps1")
PROBE_VALUE = "Z99"

user32 = ctypes.WinDLL("user32", use_last_error=True)
user32.GetForegroundWindow.argtypes = []
user32.GetForegroundWindow.restype = ctypes.c_void_p
user32.GetClipboardSequenceNumber.argtypes = []
user32.GetClipboardSequenceNumber.restype = ctypes.c_ulong
user32.IsWindow.argtypes = [ctypes.c_void_p]
user32.IsWindow.restype = ctypes.c_bool

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000


class _FileTime(ctypes.Structure):
    _fields_ = [("low", ctypes.c_ulong), ("high", ctypes.c_ulong)]


kernel32.OpenProcess.argtypes = [ctypes.c_ulong, ctypes.c_bool, ctypes.c_ulong]
kernel32.OpenProcess.restype = ctypes.c_void_p
kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
kernel32.CloseHandle.restype = ctypes.c_bool
kernel32.GetProcessTimes.argtypes = [
    ctypes.c_void_p,
    ctypes.POINTER(_FileTime),
    ctypes.POINTER(_FileTime),
    ctypes.POINTER(_FileTime),
    ctypes.POINTER(_FileTime),
]
kernel32.GetProcessTimes.restype = ctypes.c_bool
kernel32.QueryFullProcessImageNameW.argtypes = [
    ctypes.c_void_p, ctypes.c_ulong, ctypes.c_wchar_p, ctypes.POINTER(ctypes.c_ulong),
]
kernel32.QueryFullProcessImageNameW.restype = ctypes.c_bool


def _desktop_state() -> tuple[int, int]:
    return int(user32.GetForegroundWindow() or 0), int(user32.GetClipboardSequenceNumber())


def _readline(process: subprocess.Popen[str], timeout_s: float = 20.0) -> str:
    output: queue.Queue[str] = queue.Queue(maxsize=1)
    threading.Thread(target=lambda: output.put(process.stdout.readline()), daemon=True).start()
    try:
        return output.get(timeout=timeout_s)
    except queue.Empty as error:
        raise AssertionError(f"Office UIA host PID {process.pid} did not provide a handshake") from error


def _powershell() -> str:
    executable = shutil.which("powershell") or shutil.which("pwsh")
    if executable is None:
        pytest.skip("PowerShell is unavailable for the test-owned Office host")
    return executable


@dataclass
class OfficeHost:
    process: subprocess.Popen[str]
    pid: int
    hwnd: int
    executable_path: str
    creation_time_file_time: int

    def shutdown(self) -> None:
        if self.process.poll() is None and self.process.stdin is not None:
            self.process.stdin.write("shutdown\n")
            self.process.stdin.flush()
            self.process.wait(timeout=20)


def _start_excel(processes: OwnedProcesses) -> OfficeHost:
    process = processes.add(subprocess.Popen(
        [
            _powershell(), "-NoProfile", "-ExecutionPolicy", "Bypass",
            "-File", str(HOST_SCRIPT), "-App", "Excel",
        ],
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
        if "already has active processes" in stderr:
            pytest.skip(stderr.strip())
        raise AssertionError(f"Office UIA host exited before handshake: {stderr}")
    handshake = json.loads(line)
    assert handshake["app"] == "Excel"
    assert int(handshake["pid"]) > 0
    assert user32.IsWindow(int(handshake["hwnd"]))
    return OfficeHost(
        process,
        int(handshake["pid"]),
        int(handshake["hwnd"]),
        str(handshake["executablePath"]),
        int(handshake["creationTimeFileTime"]),
    )


def _file_time_value(value: _FileTime) -> int:
    return (int(value.high) << 32) | int(value.low)


def _owned_office_process_alive(host: OfficeHost) -> bool:
    process_handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, host.pid)
    if not process_handle:
        return False
    try:
        creation = _FileTime()
        exit_time = _FileTime()
        kernel_time = _FileTime()
        user_time = _FileTime()
        if not kernel32.GetProcessTimes(
            process_handle,
            ctypes.byref(creation),
            ctypes.byref(exit_time),
            ctypes.byref(kernel_time),
            ctypes.byref(user_time),
        ):
            return False
        capacity = ctypes.c_ulong(32_768)
        path_buffer = ctypes.create_unicode_buffer(capacity.value)
        if not kernel32.QueryFullProcessImageNameW(
            process_handle, 0, path_buffer, ctypes.byref(capacity),
        ):
            return False
        return (
            _file_time_value(creation) == host.creation_time_file_time
            and os.path.normcase(path_buffer.value) == os.path.normcase(host.executable_path)
        )
    finally:
        kernel32.CloseHandle(process_handle)


def _force_close_owned_office_process(host: OfficeHost) -> str | None:
    if not _owned_office_process_alive(host):
        return None
    completed = subprocess.run(
        ["taskkill", "/PID", str(host.pid), "/T", "/F"],
        capture_output=True,
        text=True,
        check=False,
        timeout=15,
    )
    if completed.returncode not in (0, 128):
        return (
            f"taskkill Excel PID {host.pid}: "
            f"{completed.stderr.strip() or completed.stdout.strip()}"
        )
    deadline = time.monotonic() + 5
    while _owned_office_process_alive(host) and time.monotonic() < deadline:
        time.sleep(0.05)
    if _owned_office_process_alive(host):
        return f"test-owned Excel PID {host.pid} remained after exact-identity taskkill"
    return None


def _unique_node(observation, *, automation_id: str) -> dict[str, object]:
    matches = {
        str(node.get("elementId") or ""): dict(node)
        for node in observation.metadata["semanticTree"]
        if str(node.get("automationId") or "") == automation_id
    }
    assert len(matches) == 1, matches
    return next(iter(matches.values()))


def _read_value(backend: WindowsUIABackend, handle, action: dict[str, object]) -> str:
    provider = backend.provider
    with provider._automation() as (automation, uia):
        root = provider._resolve_and_validate(automation, uia, handle.target, handle.identity)
        element = provider._action_element(automation, uia, root, handle.target, action)
        pattern = provider._pattern(
            element, uia.UIA_ValuePatternId, uia.IUIAutomationValuePattern,
        )
        return str(pattern.CurrentValue)


def test_excel_name_box_value_round_trip_with_declared_activation_risk() -> None:
    processes = OwnedProcesses()
    host: OfficeHost | None = None
    cleanup_errors: list[str] = []
    try:
        host = _start_excel(processes)
        assert _owned_office_process_alive(host)
        backend = WindowsUIABackend()
        assert backend.probe().may_activate_target is True
        targets = [
            target for target in backend.discover_targets()
            if int(target.locator.get("processId", 0)) == host.pid
        ]
        assert len(targets) == 1
        context = BackendOpenContext(
            "uia-office-excel", True, 0, False, threading.Event(),
        )
        handle = backend.open(targets[0], context)
        try:
            observation = backend.observe(handle)
            node = _unique_node(observation, automation_id="1001")
            action = {
                "action": "write",
                "elementId": node["elementId"],
                "text": PROBE_VALUE,
            }
            original = _read_value(backend, handle, action)
            fresh = backend.observe(handle)
            fresh_node = _unique_node(fresh, automation_id="1001")
            perform_action = {
                "action": "write",
                "elementToken": fresh_node["elementToken"],
                "text": PROBE_VALUE,
            }
            action_desktop_before = _desktop_state()
            receipt = backend.perform(handle, perform_action, fresh.revision)
            evidence = backend.verify(handle, perform_action, receipt, fresh)
            assert evidence.status.value == "verified"
            assert evidence.details == {
                "pattern": "Value", "expected": PROBE_VALUE, "actual": PROBE_VALUE,
            }
            action_desktop_after = _desktop_state()
            assert action_desktop_after[1] == action_desktop_before[1]

            after_probe = backend.observe(handle)
            restore_node = _unique_node(after_probe, automation_id="1001")
            restore = {
                "action": "write",
                "elementToken": restore_node["elementToken"],
                "text": original,
            }
            restore_desktop_before = _desktop_state()
            restore_receipt = backend.perform(handle, restore, after_probe.revision)
            restore_evidence = backend.verify(handle, restore, restore_receipt, after_probe)
            assert restore_evidence.status.value == "verified"
            assert restore_evidence.details["actual"] == original
            restore_desktop_after = _desktop_state()
            assert restore_desktop_after[1] == restore_desktop_before[1]
        finally:
            backend.close(handle, "office-smoke-complete")
    finally:
        if host is not None:
            try:
                host.shutdown()
            except Exception as error:
                cleanup_errors.append(f"Excel host shutdown: {error}")
        cleanup_errors.extend(processes.close())
        try:
            processes.assert_stopped()
        except AssertionError as error:
            cleanup_errors.append(str(error))
        if host is not None:
            deadline = time.monotonic() + 10
            while (
                (user32.IsWindow(host.hwnd) or _owned_office_process_alive(host))
                and time.monotonic() < deadline
            ):
                time.sleep(0.05)
            force_error = _force_close_owned_office_process(host)
            if force_error is not None:
                cleanup_errors.append(force_error)
            if user32.IsWindow(host.hwnd):
                cleanup_errors.append(f"Excel HWND {host.hwnd} remains")
            if _owned_office_process_alive(host):
                cleanup_errors.append(f"test-owned Excel PID {host.pid} remains")
        if cleanup_errors:
            pytest.fail("; ".join(cleanup_errors))


def test_excel_host_crash_cleanup_uses_exact_process_identity() -> None:
    processes = OwnedProcesses()
    host: OfficeHost | None = None
    cleanup_errors: list[str] = []
    try:
        host = _start_excel(processes)
        assert _owned_office_process_alive(host)
        host.process.terminate()
        host.process.wait(timeout=10)

        cleanup_error = _force_close_owned_office_process(host)
        assert cleanup_error is None
        deadline = time.monotonic() + 5
        while (
            (user32.IsWindow(host.hwnd) or _owned_office_process_alive(host))
            and time.monotonic() < deadline
        ):
            time.sleep(0.05)
        assert not user32.IsWindow(host.hwnd)
        assert not _owned_office_process_alive(host)
    finally:
        cleanup_errors.extend(processes.close())
        try:
            processes.assert_stopped()
        except AssertionError as error:
            cleanup_errors.append(str(error))
        if host is not None:
            force_error = _force_close_owned_office_process(host)
            if force_error is not None:
                cleanup_errors.append(force_error)
            if user32.IsWindow(host.hwnd):
                cleanup_errors.append(f"Excel HWND {host.hwnd} remains after crash cleanup")
            if _owned_office_process_alive(host):
                cleanup_errors.append(f"test-owned Excel PID {host.pid} remains after crash cleanup")
        if cleanup_errors:
            pytest.fail("; ".join(cleanup_errors))
