"""Shared isolated desktop runtime helpers for real isolated desktop probes."""

from __future__ import annotations

import hashlib
import json
import os
import random
import signal
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from .isolated_desktop_contracts import (
    ISOLATED_RUNTIME_RESOURCE_ALLOCATION_SCHEMA_VERSION,
)

DEFAULT_VIEWPORT = {"width": 1280, "height": 720}
L1_VIEWPORT = DEFAULT_VIEWPORT

DISPLAY_CANDIDATES = tuple(range(100, 600))

VNC_PORT_CANDIDATES = tuple(range(20000, 61000))

NOVNC_PORT_CANDIDATES = tuple(range(20000, 61000))

RESOURCE_ALLOCATION_NAME = "isolated-runtime-resource-allocation.json"

class IsolatedDesktopRunFailed(RuntimeError):
    """Raised when a real isolated desktop runner cannot produce completed evidence."""

    def __init__(self, reason: str, diagnostics: Mapping[str, Any] | None = None) -> None:
        super().__init__(reason)
        self.reason = reason
        self.diagnostics = dict(diagnostics or {})

class SubprocessCommandRunner:
    """Small wrapper around subprocess for test injection."""

    def popen(
        self,
        args: Sequence[str],
        *,
        env: Mapping[str, str] | None = None,
        cwd: str | Path | None = None,
        stdout: Any = subprocess.PIPE,
        stderr: Any = subprocess.PIPE,
    ) -> subprocess.Popen[str]:
        return subprocess.Popen(  # noqa: S603 - commands are resolved from readiness manifests.
            list(args),
            cwd=str(cwd) if cwd else None,
            env=dict(env or os.environ),
            stdout=stdout,
            stderr=stderr,
            text=True,
            start_new_session=True,
        )

    def run(
        self,
        args: Sequence[str],
        *,
        env: Mapping[str, str] | None = None,
        cwd: str | Path | None = None,
        timeout: float | None = None,
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(  # noqa: S603 - commands are resolved from readiness manifests.
            list(args),
            cwd=str(cwd) if cwd else None,
            env=dict(env or os.environ),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=False,
        )

IsolatedDesktopL1SmokeRunFailed = IsolatedDesktopRunFailed

@dataclass
class IsolatedDesktopResourceLease:
    display: str
    vnc_port: int
    novnc_port: int
    allocation_ref: Path
    lock_refs: list[Path]
    requested: dict[str, Any]
    session_id: str | None = None

    def summary(self, *, status: str = "allocated") -> dict[str, Any]:
        payload = {
            "schemaVersion": ISOLATED_RUNTIME_RESOURCE_ALLOCATION_SCHEMA_VERSION,
            "status": status,
            "display": self.display,
            "vncPort": self.vnc_port,
            "novncPort": self.novnc_port,
            "requested": dict(self.requested),
            "lockRefs": [str(ref) for ref in self.lock_refs],
            "localhostOnly": True,
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
        }
        if self.session_id:
            payload["sessionId"] = self.session_id
        return payload

    def release(self, *, status: str = "released-after-run") -> None:
        for ref in reversed(self.lock_refs):
            try:
                metadata_ref = ref / "lease.json"
                if metadata_ref.exists():
                    metadata_ref.unlink()
                ref.rmdir()
            except OSError:
                continue
        _write_json(self.allocation_ref, self.summary(status=status))

L1RuntimeResourceLease = IsolatedDesktopResourceLease

def allocate_isolated_runtime_resources(
    *,
    root: Path,
    requested_display: str | None,
    requested_vnc_port: int | None,
    requested_novnc_port: int | None,
    path_exists: Callable[[str], bool],
    port_available: Callable[[int], bool],
    resource_lock_root: Path | None,
    display_candidates: Sequence[str | int] | None,
    vnc_port_candidates: Sequence[int] | None,
    novnc_port_candidates: Sequence[int] | None,
) -> IsolatedDesktopResourceLease:
    allocation_ref = (root / RESOURCE_ALLOCATION_NAME).resolve()
    requested = {
        "display": requested_display,
        "vncPort": requested_vnc_port,
        "novncPort": requested_novnc_port,
    }
    lock_root = (
        resource_lock_root
        or Path(
            os.environ.get(
                "SCIFORGE_COMPUTER_USE_RESOURCE_LOCK_DIR",
                os.environ.get(
                    "SCIFORGE_COMPUTER_USE_L1_LOCK_DIR",
                    str(Path(tempfile.gettempdir()) / "sciforge-computer-use-resource-locks"),
                ),
            )
        )
    ).expanduser()
    display_values = (
        [requested_display]
        if requested_display
        else [f":{number}" for number in _candidate_sequence(display_candidates, DISPLAY_CANDIDATES)]
    )
    vnc_candidates = [requested_vnc_port] if requested_vnc_port else _candidate_sequence(vnc_port_candidates, VNC_PORT_CANDIDATES)
    novnc_candidates = [requested_novnc_port] if requested_novnc_port else _candidate_sequence(novnc_port_candidates, NOVNC_PORT_CANDIDATES)
    diagnostics: list[dict[str, Any]] = []

    for display_candidate in display_values:
        display_value = _normalize_display(display_candidate)
        if not display_value:
            diagnostics.append({"resource": "display", "candidate": display_candidate, "available": False, "reason": "invalid-display"})
            continue
        display_reason = _display_unavailable_reason(display_value, path_exists=path_exists)
        if display_reason:
            diagnostics.append({"resource": "display", "candidate": display_value, "available": False, "reason": display_reason})
            continue
        for vnc_candidate in vnc_candidates:
            vnc_value = _port_or_none(vnc_candidate)
            if vnc_value is None or not port_available(vnc_value):
                diagnostics.append({"resource": "vncPort", "candidate": vnc_candidate, "available": False, "reason": "port-unavailable"})
                continue
            for novnc_candidate in novnc_candidates:
                novnc_value = _port_or_none(novnc_candidate)
                if novnc_value is None or novnc_value == vnc_value or not port_available(novnc_value):
                    diagnostics.append({"resource": "novncPort", "candidate": novnc_candidate, "available": False, "reason": "port-unavailable"})
                    continue
                lock_refs = _try_acquire_resource_locks(
                    lock_root,
                    display=display_value,
                    vnc_port=vnc_value,
                    novnc_port=novnc_value,
                )
                if lock_refs is None:
                    diagnostics.append({
                        "resource": "lease",
                        "candidate": {"display": display_value, "vncPort": vnc_value, "novncPort": novnc_value},
                        "available": False,
                        "reason": "lock-already-held",
                    })
                    continue
                lease = IsolatedDesktopResourceLease(
                    display=display_value,
                    vnc_port=vnc_value,
                    novnc_port=novnc_value,
                    allocation_ref=allocation_ref,
                    lock_refs=lock_refs,
                    requested=requested,
                )
                _write_json(allocation_ref, lease.summary())
                return lease

    _write_json(
        allocation_ref,
        {
            "schemaVersion": ISOLATED_RUNTIME_RESOURCE_ALLOCATION_SCHEMA_VERSION,
            "status": "blocked",
            "requested": requested,
            "diagnostics": diagnostics,
            "lockRootRef": str(lock_root),
            "localhostOnly": True,
        },
    )
    raise IsolatedDesktopRunFailed(
        "Unable to allocate an isolated display and localhost VNC/noVNC ports for the run.",
        {"runAttempted": False, "resourceAllocationRef": str(allocation_ref), "resourceAllocationDiagnostics": diagnostics[-20:]},
    )

def _allocate_l1_runtime_resources(
    *,
    root: Path,
    requested_display: str | None,
    requested_vnc_port: int | None,
    requested_novnc_port: int | None,
    path_exists: Callable[[str], bool],
    port_available: Callable[[int], bool],
    resource_lock_root: Path | None,
    display_candidates: Sequence[str | int] | None,
    vnc_port_candidates: Sequence[int] | None,
    novnc_port_candidates: Sequence[int] | None,
) -> IsolatedDesktopResourceLease:
    return allocate_isolated_runtime_resources(
        root=root,
        requested_display=requested_display,
        requested_vnc_port=requested_vnc_port,
        requested_novnc_port=requested_novnc_port,
        path_exists=path_exists,
        port_available=port_available,
        resource_lock_root=resource_lock_root,
        display_candidates=display_candidates,
        vnc_port_candidates=vnc_port_candidates,
        novnc_port_candidates=novnc_port_candidates,
    )

def _candidate_sequence(
    injected: Sequence[str | int] | Sequence[int] | None,
    defaults: Sequence[int],
    *,
    limit: int = 80,
) -> list[Any]:
    if injected is not None:
        return list(injected)
    values = list(defaults)
    random.SystemRandom().shuffle(values)
    return values[:limit]

def _normalize_display(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if text.startswith(":") and text[1:].isdigit():
        return text
    if text.isdigit():
        return f":{text}"
    return None

def _display_number(display: str) -> int | None:
    normalized = _normalize_display(display)
    if normalized is None:
        return None
    try:
        return int(normalized[1:])
    except ValueError:
        return None

def _display_unavailable_reason(display: str, *, path_exists: Callable[[str], bool]) -> str | None:
    number = _display_number(display)
    if number is None:
        return "invalid-display"
    lock_paths = (f"/tmp/.X{number}-lock", f"/tmp/.X11-unix/X{number}")
    for lock_path in lock_paths:
        if path_exists(lock_path):
            return f"display-lock-present:{lock_path}"
    return None

def _port_or_none(value: Any) -> int | None:
    try:
        port = int(value)
    except (TypeError, ValueError):
        return None
    if 1 <= port <= 65535:
        return port
    return None

def _localhost_port_available(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True

def _try_acquire_resource_locks(
    lock_root: Path,
    *,
    display: str,
    vnc_port: int,
    novnc_port: int,
) -> list[Path] | None:
    acquired: list[Path] = []
    try:
        lock_root.mkdir(parents=True, exist_ok=True)
        for name, value in (
            ("display", display.replace(":", "")),
            ("vnc-port", vnc_port),
            ("novnc-port", novnc_port),
        ):
            lock_ref = lock_root / f"{name}-{value}"
            lock_ref.mkdir()
            _write_json(
                lock_ref / "lease.json",
                {
                    "schemaVersion": "sciforge.computer-use.resource-lease.v1",
                    "resource": name,
                    "value": str(value),
                    "pid": os.getpid(),
                    "createdAtUnix": time.time(),
                },
            )
            acquired.append(lock_ref)
        return acquired
    except OSError:
        for lock_ref in reversed(acquired):
            try:
                metadata_ref = lock_ref / "lease.json"
                if metadata_ref.exists():
                    metadata_ref.unlink()
                lock_ref.rmdir()
            except OSError:
                continue
        return None

def _wait_for_tcp_port(
    host: str,
    port: int,
    *,
    timeout_seconds: float,
    sleep: Callable[[float], None],
    port_probe: Callable[[str, int, float], bool],
    role: str,
) -> None:
    deadline = time.monotonic() + max(timeout_seconds, 0.1)
    last_error: str | None = None
    while time.monotonic() <= deadline:
        try:
            if port_probe(host, port, 0.25):
                return
        except OSError as exc:
            last_error = str(exc)
        sleep(0.1)
    raise IsolatedDesktopL1SmokeRunFailed(
        f"{role} did not expose localhost TCP port {port} before timeout.",
        {"role": role, "host": host, "port": port, "lastError": last_error},
    )

def _tcp_port_ready(host: str, port: int, timeout: float) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False

def _wait_for_x_display_geometry(
    command_runner: Any,
    input_tool_path: str,
    *,
    env: Mapping[str, str],
    timeout_seconds: float,
    sleep: Callable[[float], None],
) -> dict[str, Any]:
    deadline = time.monotonic() + max(timeout_seconds, 0.1)
    args = [input_tool_path, "getdisplaygeometry"]
    last_error: str | None = None
    while time.monotonic() <= deadline:
        completed = command_runner.run(args, env=env, timeout=0.5)
        if getattr(completed, "returncode", 1) == 0:
            geometry = _parse_display_geometry(getattr(completed, "stdout", ""))
            if geometry is not None:
                width, height = geometry
                return {
                    "display": env.get("DISPLAY"),
                    "ready": True,
                    "command": list(args),
                    "width": width,
                    "height": height,
                    "viewport": dict(L1_VIEWPORT),
                    "matchesRequestedViewport": width == L1_VIEWPORT["width"] and height == L1_VIEWPORT["height"],
                    "sharedSystemInputUsed": False,
                    "systemPointerMoved": False,
                    "systemKeyboardEventsSent": False,
                }
            last_error = f"invalid geometry output: {getattr(completed, 'stdout', '')!r}"
        else:
            last_error = _short_text(getattr(completed, "stderr", "")) or f"returncode={getattr(completed, 'returncode', None)}"
        sleep(0.1)
    raise IsolatedDesktopL1SmokeRunFailed(
        f"virtual-display did not expose a queryable isolated X display {env.get('DISPLAY')} before timeout.",
        {"role": "virtual-display", "display": env.get("DISPLAY"), "lastError": last_error},
    )

def _parse_display_geometry(stdout: Any) -> tuple[int, int] | None:
    parts = str(stdout or "").replace("x", " ").split()
    if len(parts) < 2:
        return None
    width = _positive_int_or_none(parts[0])
    height = _positive_int_or_none(parts[1])
    if width is None or height is None:
        return None
    return width, height

def _wait_for_browser_page_ready(
    command_runner: Any,
    input_tool_path: str,
    *,
    env: Mapping[str, str],
    ready_title: str,
    smoke_page_ref: Path,
    timeout_seconds: float,
    sleep: Callable[[float], None],
) -> dict[str, Any]:
    deadline = time.monotonic() + max(timeout_seconds, 0.1)
    search_args = [input_tool_path, "search", "--onlyvisible", "--name", ready_title]
    geometry_args_base = [input_tool_path, "getwindowgeometry", "--shell"]
    last_error: str | None = None
    while time.monotonic() <= deadline:
        search = command_runner.run(search_args, env=env, timeout=0.5)
        if getattr(search, "returncode", 1) == 0:
            window_id = _first_non_empty_line(getattr(search, "stdout", ""))
            if window_id:
                geometry_args = [*geometry_args_base, window_id]
                geometry_result = command_runner.run(geometry_args, env=env, timeout=0.5)
                if getattr(geometry_result, "returncode", 1) == 0:
                    geometry = _parse_window_geometry_shell(getattr(geometry_result, "stdout", ""))
                    if geometry:
                        return {
                            "desktopWindow": {
                                "display": env.get("DISPLAY"),
                                "ready": True,
                                "visible": True,
                                "windowId": window_id,
                                "title": ready_title,
                                "geometry": geometry,
                                "searchCommand": search_args,
                                "geometryCommand": geometry_args,
                                "coordinateSpace": "screen",
                                "sharedSystemInputUsed": False,
                                "systemPointerMoved": False,
                                "systemKeyboardEventsSent": False,
                            },
                            "page": {
                                "ready": True,
                                "readyTitle": ready_title,
                                "titleMatched": True,
                                "smokePageRef": str(smoke_page_ref),
                                "readinessStrategy": "window-title-marker",
                                "sharedSystemInputUsed": False,
                                "systemPointerMoved": False,
                                "systemKeyboardEventsSent": False,
                            },
                        }
                    last_error = f"invalid window geometry output: {getattr(geometry_result, 'stdout', '')!r}"
                else:
                    last_error = _short_text(getattr(geometry_result, "stderr", "")) or (
                        f"geometry returncode={getattr(geometry_result, 'returncode', None)}"
                    )
            else:
                last_error = "visible window search returned no window id"
        else:
            last_error = _short_text(getattr(search, "stderr", "")) or f"search returncode={getattr(search, 'returncode', None)}"
        sleep(0.1)
    raise IsolatedDesktopL1SmokeRunFailed(
        f"browser did not expose ready visible window title {ready_title!r} before timeout.",
        {"role": "browser", "display": env.get("DISPLAY"), "readyTitle": ready_title, "lastError": last_error},
    )

def _first_non_empty_line(stdout: Any) -> str | None:
    for line in str(stdout or "").splitlines():
        text = line.strip()
        if text:
            return text
    return None

def _parse_window_geometry_shell(stdout: Any) -> dict[str, int] | None:
    values: dict[str, int] = {}
    for line in str(stdout or "").splitlines():
        if "=" not in line:
            continue
        key, raw_value = line.split("=", 1)
        key = key.strip().lower()
        value = _positive_or_zero_int_or_none(raw_value.strip())
        if value is not None:
            values[key] = value
    width = _positive_int_or_none(values.get("width"))
    height = _positive_int_or_none(values.get("height"))
    if width is None or height is None:
        return None
    return {
        "x": values.get("x", 0),
        "y": values.get("y", 0),
        "width": width,
        "height": height,
    }

def _positive_or_zero_int_or_none(value: Any) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number >= 0 else None

def _wait_for_http_viewer(
    url: str,
    *,
    timeout_seconds: float,
    sleep: Callable[[float], None],
    http_probe: Callable[[str, float], Mapping[str, Any]],
) -> dict[str, Any]:
    deadline = time.monotonic() + max(timeout_seconds, 0.1)
    last_probe: Mapping[str, Any] | None = None
    while time.monotonic() <= deadline:
        try:
            probe = dict(http_probe(url, 0.25))
            last_probe = probe
            if _http_viewer_probe_ready(probe, expected_url=url):
                return probe
        except OSError as exc:
            last_probe = {"ok": False, "error": str(exc), "url": url}
        sleep(0.1)
    raise IsolatedDesktopL1SmokeRunFailed(
        f"novnc-proxy did not serve localhost noVNC viewer {url} before timeout.",
        {"role": "novnc-proxy", "url": url, "lastHttpProbe": dict(last_probe or {})},
    )

def _http_get_ready(url: str, timeout: float) -> dict[str, Any]:
    request = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status = int(getattr(response, "status", response.getcode()))
            body = response.read(262_144)
            content_type = response.headers.get("content-type")
            return {
                "ok": 200 <= status < 400 and bool(body),
                "ready": 200 <= status < 400 and bool(body),
                "method": "GET",
                "url": url,
                "localhostOnly": _localhost_http_url(url),
                "statusCode": status,
                "contentType": content_type,
                "bytesRead": len(body),
                "sha256": hashlib.sha256(body).hexdigest(),
                "htmlDetected": _html_detected(body, content_type),
                "noVncMarkerDetected": _novnc_marker_detected(body),
                "rawPayloadWritten": False,
            }
    except urllib.error.HTTPError as exc:
        return {
            "ok": False,
            "ready": False,
            "method": "GET",
            "url": url,
            "localhostOnly": _localhost_http_url(url),
            "statusCode": exc.code,
            "error": str(exc),
            "rawPayloadWritten": False,
        }
    except OSError as exc:
        return {
            "ok": False,
            "ready": False,
            "method": "GET",
            "url": url,
            "localhostOnly": _localhost_http_url(url),
            "statusCode": None,
            "error": str(exc),
            "rawPayloadWritten": False,
        }

def _http_viewer_probe_ready(probe: Mapping[str, Any], *, expected_url: str) -> bool:
    status = _port_or_none(probe.get("statusCode", probe.get("status")))
    bytes_read = _positive_int_or_none(probe.get("bytesRead"))
    return (
        probe.get("ok") is True
        and probe.get("ready", True) is True
        and str(probe.get("method", "GET")).upper() == "GET"
        and str(probe.get("url") or "") == expected_url
        and probe.get("localhostOnly", True) is True
        and status is not None
        and 200 <= status < 400
        and bytes_read is not None
        and isinstance(probe.get("sha256"), str)
        and len(str(probe.get("sha256"))) == 64
        and probe.get("htmlDetected") is True
        and probe.get("noVncMarkerDetected") is True
        and probe.get("rawPayloadWritten") is False
    )

def _positive_int_or_none(value: Any) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None

def _localhost_http_url(url: str) -> bool:
    parsed = urllib.parse.urlparse(url)
    return parsed.scheme in {"http", "https"} and parsed.hostname in {"127.0.0.1", "localhost", "::1"}

def _html_detected(body: bytes, content_type: str | None) -> bool:
    return "html" in str(content_type or "").lower() or b"<html" in body[:4096].lower()

def _novnc_marker_detected(body: bytes) -> bool:
    lowered = body[:262_144].lower()
    return b"novnc" in lowered or b"no vnc" in lowered or b"rfb" in lowered

def _browser_command(component: Mapping[str, Any], *, smoke_page_ref: Path, profile_dir: Path) -> list[str]:
    path = str(component.get("path"))
    command = str(component.get("command") or Path(path).name)
    page_url = smoke_page_ref.resolve().as_uri()
    if command in {"chromium", "chromium-browser", "google-chrome"}:
        args = [
            path,
            f"--user-data-dir={profile_dir}",
            "--test-type",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-background-networking",
            "--disable-sync",
            "--disable-translate",
            "--disable-features=TranslateUI",
            "--disable-popup-blocking",
            "--disable-session-crashed-bubble",
            "--disable-gpu",
            "--disable-dev-shm-usage",
            "--window-size=1280,720",
            f"--app={page_url}",
        ]
        if _running_as_root():
            args.insert(1, "--no-sandbox")
        return args
    if command == "firefox":
        return [path, "--profile", str(profile_dir), "--new-window", page_url]
    return [path, page_url]

def _running_as_root() -> bool:
    geteuid = getattr(os, "geteuid", None)
    return bool(callable(geteuid) and geteuid() == 0)

def _vnc_server_command(component: Mapping[str, Any], *, display: str, port: int) -> list[str]:
    path = str(component.get("path"))
    command = str(component.get("command") or Path(path).name)
    if command == "x11vnc":
        return [
            path,
            "-display",
            display,
            "-localhost",
            "-nopw",
            "-forever",
            "-shared",
            "-rfbport",
            str(port),
        ]
    if command == "x0vncserver":
        return [
            path,
            "-display",
            display,
            "-rfbport",
            str(port),
            "-localhost",
            "-SecurityTypes",
            "None",
        ]
    raise IsolatedDesktopL1SmokeRunFailed(f"Unsupported VNC server command: {command}.")

def _novnc_proxy_command(
    component: Mapping[str, Any],
    *,
    novnc_web_root: str,
    vnc_port: int,
    novnc_port: int,
) -> list[str]:
    path = str(component.get("path"))
    command = str(component.get("command") or Path(path).name)
    if command == "websockify":
        args = [path, "--web", novnc_web_root, f"127.0.0.1:{novnc_port}", f"127.0.0.1:{vnc_port}"]
        return args if novnc_web_root else [path, f"127.0.0.1:{novnc_port}", f"127.0.0.1:{vnc_port}"]
    if command == "novnc_proxy":
        return [path, "--listen", str(novnc_port), "--vnc", f"127.0.0.1:{vnc_port}"]
    raise IsolatedDesktopL1SmokeRunFailed(f"Unsupported noVNC proxy command: {command}.")

def _short_text(value: Any, *, limit: int = 500) -> str:
    text = str(value or "")
    return text if len(text) <= limit else text[: limit - 3] + "..."


def _write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf8")
