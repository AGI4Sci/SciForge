"""Exact-PID process ownership and cleanup helpers for opt-in tests."""
from __future__ import annotations

import ctypes
import shutil
import socket
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class OwnedProcesses:
    """Track only processes created by the current test fixture."""

    processes: list[subprocess.Popen] = field(default_factory=list)
    tree_process_ids: set[int] = field(default_factory=set)

    def add(self, process: subprocess.Popen, *, tree: bool = False) -> subprocess.Popen:
        self.processes.append(process)
        if tree:
            self.tree_process_ids.add(process.pid)
        return process

    def close(self, *, graceful_timeout_s: float = 10.0) -> list[str]:
        errors: list[str] = []
        tree_pids: set[int] = set()
        if sys.platform == "win32":
            tracked = {process.pid: process for process in self.processes}
            for root_pid in self.tree_process_ids:
                root = tracked[root_pid]
                if root.poll() is None:
                    tree_pids.add(root_pid)
                    tree_pids.update(_windows_descendant_pids(root_pid))
                elif not _windows_pid_alive(root_pid):
                    # Chromium launchers may exit while their browser children
                    # retain the original parent PID. Do not include the exited
                    # root itself: its numeric PID could already be reused.
                    tree_pids.update(_windows_descendant_pids(root_pid))
            # A Chromium launcher can exit before cleanup while its children
            # retain the original parent PID. Kill every snapshotted test-owned
            # descendant explicitly; never use a process-name-wide command.
            for pid in sorted(tree_pids):
                completed = subprocess.run(
                    ["taskkill", "/PID", str(pid), "/T", "/F"],
                    capture_output=True,
                    text=True,
                    check=False,
                    timeout=10,
                )
                if completed.returncode not in (0, 128) and _windows_pid_alive(pid):
                    errors.append(
                        f"taskkill tree PID {pid}: "
                        f"{completed.stderr.strip() or completed.stdout.strip()}"
                    )
        for process in reversed(self.processes):
            if process.poll() is None:
                if process.pid in tree_pids:
                    continue
                try:
                    process.terminate()
                except OSError as error:
                    errors.append(f"terminate PID {process.pid}: {error}")
        deadline = time.monotonic() + graceful_timeout_s
        for process in reversed(self.processes):
            remaining = max(0.0, deadline - time.monotonic())
            try:
                process.wait(timeout=remaining)
            except subprocess.TimeoutExpired:
                # The user approved force cleanup only for the exact PID spawned
                # by this fixture. /T is needed for Chromium's owned child tree.
                completed = subprocess.run(
                    ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                    capture_output=True,
                    text=True,
                    check=False,
                    timeout=10,
                )
                if completed.returncode not in (0, 128):
                    errors.append(
                        f"taskkill PID {process.pid}: "
                        f"{completed.stderr.strip() or completed.stdout.strip()}"
                    )
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    errors.append(f"PID {process.pid} remained alive after exact-PID taskkill")
        return errors

    def assert_stopped(self) -> None:
        alive = [process.pid for process in self.processes if process.poll() is None]
        if alive:
            raise AssertionError(f"owned processes remain alive: {alive}")


def _windows_descendant_pids(root_pid: int) -> set[int]:
    """Snapshot descendants by exact parent PID, including an exited root."""

    if sys.platform != "win32":
        return set()

    class ProcessEntry32W(ctypes.Structure):
        _fields_ = [
            ("dwSize", ctypes.c_ulong),
            ("cntUsage", ctypes.c_ulong),
            ("th32ProcessID", ctypes.c_ulong),
            ("th32DefaultHeapID", ctypes.c_size_t),
            ("th32ModuleID", ctypes.c_ulong),
            ("cntThreads", ctypes.c_ulong),
            ("th32ParentProcessID", ctypes.c_ulong),
            ("pcPriClassBase", ctypes.c_long),
            ("dwFlags", ctypes.c_ulong),
            ("szExeFile", ctypes.c_wchar * 260),
        ]

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateToolhelp32Snapshot.argtypes = [ctypes.c_ulong, ctypes.c_ulong]
    kernel32.CreateToolhelp32Snapshot.restype = ctypes.c_void_p
    kernel32.Process32FirstW.argtypes = [ctypes.c_void_p, ctypes.POINTER(ProcessEntry32W)]
    kernel32.Process32FirstW.restype = ctypes.c_bool
    kernel32.Process32NextW.argtypes = [ctypes.c_void_p, ctypes.POINTER(ProcessEntry32W)]
    kernel32.Process32NextW.restype = ctypes.c_bool
    kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
    kernel32.CloseHandle.restype = ctypes.c_bool

    snapshot = kernel32.CreateToolhelp32Snapshot(0x00000002, 0)
    invalid_handle = ctypes.c_void_p(-1).value
    if snapshot in (None, invalid_handle):
        raise ctypes.WinError(ctypes.get_last_error())
    parents: dict[int, int] = {}
    try:
        entry = ProcessEntry32W()
        entry.dwSize = ctypes.sizeof(ProcessEntry32W)
        if kernel32.Process32FirstW(snapshot, ctypes.byref(entry)):
            while True:
                parents[int(entry.th32ProcessID)] = int(entry.th32ParentProcessID)
                if not kernel32.Process32NextW(snapshot, ctypes.byref(entry)):
                    break
    finally:
        kernel32.CloseHandle(snapshot)

    descendants: set[int] = set()
    frontier = {root_pid}
    while frontier:
        children = {
            pid for pid, parent_pid in parents.items()
            if parent_pid in frontier and pid not in descendants and pid != root_pid
        }
        if not children:
            break
        descendants.update(children)
        frontier = children
    return descendants


def _windows_pid_alive(pid: int) -> bool:
    """Return whether an exact Windows PID still represents a running process."""

    if sys.platform != "win32":
        return False
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.argtypes = [ctypes.c_ulong, ctypes.c_bool, ctypes.c_ulong]
    kernel32.OpenProcess.restype = ctypes.c_void_p
    kernel32.GetExitCodeProcess.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong)]
    kernel32.GetExitCodeProcess.restype = ctypes.c_bool
    kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
    kernel32.CloseHandle.restype = ctypes.c_bool
    handle = kernel32.OpenProcess(0x1000, False, pid)
    if not handle:
        return False
    try:
        exit_code = ctypes.c_ulong()
        if not kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)):
            return False
        return exit_code.value == 259
    finally:
        kernel32.CloseHandle(handle)


def remove_owned_tree(path: Path, *, timeout_s: float = 5.0) -> None:
    """Remove one resolved test-owned directory, never a broad/root target."""

    resolved = path.resolve()
    if resolved.parent == resolved or not resolved.name.startswith("sciforge-cua-"):
        raise ValueError(f"refusing to remove non-test directory: {resolved}")
    deadline = time.monotonic() + timeout_s
    last_error: OSError | None = None
    while resolved.exists():
        try:
            shutil.rmtree(resolved)
            last_error = None
            break
        except OSError as error:
            last_error = error
            if time.monotonic() >= deadline:
                break
            time.sleep(0.1)
    if resolved.exists():
        raise AssertionError(
            f"test-owned directory remains: {resolved}: {last_error}"
        )


def assert_loopback_ports_released(ports: list[int], *, timeout_s: float = 5.0) -> None:
    """Prove no test-owned listener or descendant remains on its known ports."""

    pending = set(ports)
    deadline = time.monotonic() + timeout_s
    while pending:
        bound: set[int] = set()
        for port in pending:
            with socket.socket() as client:
                client.settimeout(0.25)
                if client.connect_ex(("127.0.0.1", port)) == 0:
                    bound.add(port)
        if not bound:
            return
        pending = bound
        if time.monotonic() >= deadline:
            break
        time.sleep(0.1)
    errors = [f"127.0.0.1:{port} still accepts connections" for port in sorted(pending)]
    if errors:
        raise AssertionError("test-owned ports remain bound: " + "; ".join(errors))
