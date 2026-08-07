"""Exact-PID process ownership and cleanup helpers for opt-in tests."""
from __future__ import annotations

import shutil
import socket
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class OwnedProcesses:
    """Track only processes created by the current test fixture."""

    processes: list[subprocess.Popen] = field(default_factory=list)

    def add(self, process: subprocess.Popen) -> subprocess.Popen:
        self.processes.append(process)
        return process

    def close(self, *, graceful_timeout_s: float = 10.0) -> list[str]:
        errors: list[str] = []
        for process in reversed(self.processes):
            if process.poll() is None:
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


def remove_owned_tree(path: Path) -> None:
    """Remove one resolved test-owned directory, never a broad/root target."""

    resolved = path.resolve()
    if resolved.parent == resolved or not resolved.name.startswith("sciforge-cua-"):
        raise ValueError(f"refusing to remove non-test directory: {resolved}")
    if resolved.exists():
        shutil.rmtree(resolved)
    if resolved.exists():
        raise AssertionError(f"test-owned directory remains: {resolved}")


def assert_loopback_ports_released(ports: list[int]) -> None:
    """Prove no test-owned listener or descendant remains on its known ports."""

    errors: list[str] = []
    for port in ports:
        with socket.socket() as client:
            client.settimeout(0.25)
            if client.connect_ex(("127.0.0.1", port)) == 0:
                errors.append(f"127.0.0.1:{port} still accepts connections")
    if errors:
        raise AssertionError("test-owned ports remain bound: " + "; ".join(errors))
