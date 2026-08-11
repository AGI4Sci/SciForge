"""Opt-in real CDP transport tests using one test-owned Chromium browser."""
from __future__ import annotations

import ctypes
import hashlib
import json
import os
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest
import requests

from cua import result as R
from cua.service import ComputerUseService
from driver.backends.cdp_adapter import CdpAdapterBackend
from driver.channel import ChannelError
from driver.router import BackendRouter
from tests.integration._process_guard import (
    OwnedProcesses,
    assert_loopback_ports_released,
    remove_owned_tree,
)


pytestmark = pytest.mark.skipif(
    os.getenv("CUA_CDP_INTEGRATION") != "1",
    reason="set CUA_CDP_INTEGRATION=1 to start the test-owned browser",
)

VISIBLE_BROWSER = os.getenv("CUA_CDP_VISIBLE") == "1"

WORKER_DIR = Path(__file__).resolve().parents[2]
REPO_DIR = WORKER_DIR.parents[2]
PAGE_NAMES = ("A", "B", "C")
PAGE_VALUES = {"A": "alpha-A", "B": "beta-B", "C": "gamma-C"}
PAGE_COLORS = {"A": "#f9d5d3", "B": "#d5f0d3", "C": "#d3e1f9"}


def _browser_executable() -> Path | None:
    candidates = (
        Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
        Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
        Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
        Path(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
    )
    return next((path for path in candidates if path.is_file()), None)


def _free_loopback_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def _desktop_state() -> tuple[int, tuple[int, int], int]:
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    user32.GetForegroundWindow.argtypes = []
    user32.GetForegroundWindow.restype = ctypes.c_void_p
    user32.GetClipboardSequenceNumber.argtypes = []
    user32.GetClipboardSequenceNumber.restype = ctypes.c_ulong

    class POINT(ctypes.Structure):
        _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]

    user32.GetCursorPos.argtypes = [ctypes.POINTER(POINT)]
    user32.GetCursorPos.restype = ctypes.c_bool
    point = POINT()
    if not user32.GetCursorPos(ctypes.byref(point)):
        raise ctypes.WinError(ctypes.get_last_error())
    return (
        int(user32.GetForegroundWindow() or 0),
        (int(point.x), int(point.y)),
        int(user32.GetClipboardSequenceNumber()),
    )


def _assert_no_host_focus_or_clipboard_change(
    before: tuple[int, tuple[int, int], int],
) -> None:
    after = _desktop_state()
    if not VISIBLE_BROWSER:
        assert after[0] == before[0], "controlled headless CDP changed the foreground HWND"
    assert after[1] == before[1], "controlled CDP moved the host cursor"
    assert after[2] == before[2], "controlled CDP changed the clipboard sequence"


@dataclass
class PageState:
    values: dict[str, dict[str, Any]] = field(default_factory=lambda: {
        name: {"text": "", "clicks": 0, "scroll": 0} for name in PAGE_NAMES
    })
    lock: threading.Lock = field(default_factory=threading.Lock)

    def update(self, name: str, payload: dict[str, Any]) -> None:
        if name not in PAGE_NAMES:
            return
        with self.lock:
            current = self.values[name]
            current["text"] = str(payload.get("text", current["text"]))
            current["clicks"] = int(payload.get("clicks", current["clicks"]))
            current["scroll"] = int(payload.get("scroll", current["scroll"]))

    def snapshot(self) -> dict[str, dict[str, Any]]:
        with self.lock:
            return json.loads(json.dumps(self.values))


def _handler(state: PageState):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            path = urllib.parse.urlparse(self.path).path
            if path.startswith("/page/"):
                name = path.rsplit("/", 1)[-1]
                if name not in PAGE_NAMES:
                    self.send_error(404)
                    return
                body = _page_html(name).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if path == "/state":
                body = json.dumps(state.snapshot()).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            self.send_error(404)

        def do_POST(self) -> None:  # noqa: N802
            path = urllib.parse.urlparse(self.path).path
            if not path.startswith("/state/"):
                self.send_error(404)
                return
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
            state.update(path.rsplit("/", 1)[-1], payload)
            self.send_response(204)
            self.end_headers()

        def log_message(self, _format: str, *_args: object) -> None:
            return

    return Handler


def _page_html(name: str) -> str:
    color = PAGE_COLORS[name]
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>CUA Test {name}</title>
<style>
body {{ margin:0; min-height:1800px; background:{color}; font:24px sans-serif; }}
#panel {{ position:fixed; left:40px; top:20px; width:520px; height:280px; background:white; }}
h1 {{ position:absolute; left:20px; top:0; }}
input,button {{ position:absolute; left:40px; width:420px; height:52px; font-size:22px; }}
#editor {{ top:100px; }}
#commit {{ top:180px; }}
</style></head><body data-page="{name}"><section id="panel">
<h1>Controlled Page {name}</h1><input id="editor" aria-label="Editor {name}">
<button id="commit">Commit {name}</button><output id="status"></output></section>
<script>
const state={{text:'',clicks:0,scroll:0}};
const send=()=>fetch('/state/{name}',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify(state)}});
const render=()=>document.querySelector('#status').textContent=JSON.stringify(state);
document.querySelector('#editor').addEventListener('input',e=>{{state.text=e.target.value;render();send();}});
document.querySelector('#commit').addEventListener('click',()=>{{state.clicks++;render();send();}});
addEventListener('scroll',()=>{{state.scroll=Math.round(scrollY);render();send();}},{{passive:true}});
render();send();
</script></body></html>"""


def _wait_until(predicate, *, timeout_s: float, message: str) -> None:
    deadline = time.monotonic() + timeout_s
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            if predicate():
                return
        except Exception as error:  # startup polling intentionally tolerates races
            last_error = error
        time.sleep(0.1)
    suffix = f": {last_error}" if last_error else ""
    raise AssertionError(message + suffix)


def _json_request(method: str, url: str, **kwargs: Any) -> Any:
    response = requests.request(method, url, timeout=5, **kwargs)
    response.raise_for_status()
    return response.json() if response.content else None


def _create_page(cdp_url: str, url: str) -> dict[str, Any]:
    encoded = urllib.parse.quote(url, safe="")
    return _json_request("PUT", f"{cdp_url}/json/new?{encoded}")


@dataclass
class CdpStack:
    root: Path
    state: PageState
    page_server: ThreadingHTTPServer
    page_thread: threading.Thread
    browser: subprocess.Popen
    adapter: subprocess.Popen
    cdp_url: str
    adapter_url: str
    token: str
    pages: dict[str, dict[str, Any]]
    processes: OwnedProcesses
    desktop_before: tuple[int, tuple[int, int], int]

    def backend(self) -> CdpAdapterBackend:
        return CdpAdapterBackend(adapter_url=self.adapter_url, token=self.token, timeout_s=10)


@pytest.fixture(scope="module")
def cdp_stack() -> CdpStack:
    browser_exe = _browser_executable()
    if browser_exe is None:
        pytest.skip("BLOCKED_BROWSER_EXECUTABLE: no installed Edge/Chrome executable")
    node = shutil.which("node")
    tsx = REPO_DIR / "node_modules" / "tsx"
    if node is None or not tsx.is_dir():
        pytest.skip("BLOCKED_TSX: Node or repository-local tsx is unavailable")

    root = Path(tempfile.mkdtemp(prefix="sciforge-cua-cdp-"))
    processes = OwnedProcesses()
    page_server: ThreadingHTTPServer | None = None
    page_thread: threading.Thread | None = None
    adapter: subprocess.Popen | None = None
    adapter_url: str | None = None
    token: str | None = None
    cleanup_errors: list[str] = []
    owned_ports: list[int] = []
    try:
        desktop_before = _desktop_state()
        state = PageState()
        page_server = ThreadingHTTPServer(("127.0.0.1", 0), _handler(state))
        page_thread = threading.Thread(target=page_server.serve_forever, daemon=True)
        page_thread.start()
        page_port = int(page_server.server_address[1])
        owned_ports.append(page_port)

        profile = root / "profile"
        cdp_port = _free_loopback_port()
        owned_ports.append(cdp_port)
        browser_args = [
                str(browser_exe),
                f"--remote-debugging-port={cdp_port}",
                "--remote-debugging-address=127.0.0.1",
                f"--user-data-dir={profile}", "--no-first-run",
                "--disable-default-apps", "--disable-sync",
                "--window-size=900,700", "--window-position=80,80", "about:blank",
            ]
        if not VISIBLE_BROWSER:
            browser_args.insert(1, "--headless=new")
        browser = processes.add(subprocess.Popen(
            browser_args,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW,
        ), tree=True)
        cdp_url = f"http://127.0.0.1:{cdp_port}"
        _wait_until(
            lambda: requests.get(f"{cdp_url}/json/version", timeout=1).status_code == 200,
            timeout_s=15,
            message="test-owned browser did not expose its CDP endpoint",
        )
        initial = _json_request("GET", f"{cdp_url}/json/list")
        for item in initial:
            if item.get("type") == "page":
                requests.get(f"{cdp_url}/json/close/{item['id']}", timeout=2)
        pages = {
            name: _create_page(cdp_url, f"http://127.0.0.1:{page_port}/page/{name}")
            for name in PAGE_NAMES
        }
        _wait_until(
            lambda: all(name in state.snapshot() for name in PAGE_NAMES),
            timeout_s=5,
            message="controlled pages did not initialize",
        )

        adapter_port = _free_loopback_port()
        owned_ports.append(adapter_port)
        adapter_url = f"http://127.0.0.1:{adapter_port}"
        token = hashlib.sha256(os.urandom(32)).hexdigest()
        env = os.environ.copy()
        env.update({
            "SCIFORGE_CUA_CDP_ENDPOINTS": cdp_url,
            "SCIFORGE_CUA_CDP_ADAPTER_TOKEN": token,
            "SCIFORGE_CUA_CDP_ADAPTER_PORT": str(adapter_port),
        })
        adapter = processes.add(subprocess.Popen(
            [
                node, "--import", "tsx",
                    str(
                        REPO_DIR / "packages" / "domains" / "computer-use" /
                        "src" / "main" / "cdp-adapter-node-entry.ts"
                    ),
            ],
            cwd=REPO_DIR,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW,
        ), tree=True)
        headers = {"Authorization": f"Bearer {token}"}
        _wait_until(
            lambda: requests.get(f"{adapter_url}/v1/capabilities", headers=headers, timeout=1).status_code == 200,
            timeout_s=20,
            message="Node CDP adapter did not become ready",
        )
        yield CdpStack(
            root, state, page_server, page_thread, browser, adapter, cdp_url,
            adapter_url, token, pages, processes, desktop_before,
        )
    finally:
        if page_server is not None:
            page_server.shutdown()
            page_server.server_close()
        if page_thread is not None:
            page_thread.join(timeout=2)
        if adapter is not None and adapter.poll() is None and adapter_url and token:
            try:
                capability_payload = _json_request(
                    "GET",
                    f"{adapter_url}/v1/capabilities",
                    headers={"Authorization": f"Bearer {token}"},
                )
                active_handles = capability_payload["data"]["activeHandleCount"]
                if active_handles != 0:
                    cleanup_errors.append(
                        f"Node CDP adapter retained {active_handles} active handle(s)"
                    )
            except Exception as error:
                cleanup_errors.append(f"could not verify Node CDP handle cleanup: {error}")
        cleanup_errors.extend(processes.close())
        try:
            processes.assert_stopped()
        except AssertionError as error:
            cleanup_errors.append(str(error))
        try:
            assert_loopback_ports_released(owned_ports)
        except Exception as error:
            cleanup_errors.append(str(error))
        try:
            remove_owned_tree(root)
        except Exception as error:
            cleanup_errors.append(str(error))
        if cleanup_errors:
            pytest.fail("; ".join(cleanup_errors))


def _targets_by_name(stack: CdpStack):
    targets = stack.backend().discover_targets()
    mapped = {
        target.metadata.get("title", "").rsplit(" ", 1)[-1]: target
        for target in targets if target.metadata.get("title", "").startswith("CUA Test ")
    }
    assert set(mapped) == set(PAGE_NAMES)
    assert len({target.target_id for target in mapped.values()}) == 3
    return mapped


def _assert_browser_available(stack: CdpStack) -> None:
    """Assert the browser, not its potentially short-lived launcher, is alive."""

    version = requests.get(f"{stack.cdp_url}/json/version", timeout=2)
    assert version.status_code == 200
    live_target_ids = {
        item.get("id") for item in _json_request("GET", f"{stack.cdp_url}/json/list")
    }
    expected_target_ids = {page["id"] for page in stack.pages.values()}
    assert expected_target_ids.issubset(live_target_ids)


def test_single_target_real_transport_and_authentication(cdp_stack: CdpStack) -> None:
    stack = cdp_stack
    backend = stack.backend()
    capability = backend.probe()
    assert capability.available is True
    targets = _targets_by_name(stack)
    assert all(target.locator["cdpEndpoint"] == stack.cdp_url for target in targets.values())

    unauthenticated = requests.get(f"{stack.adapter_url}/v1/targets", timeout=2)
    wrong = requests.get(
        f"{stack.adapter_url}/v1/targets",
        headers={"Authorization": "Bearer wrong-token"},
        timeout=2,
    )
    assert unauthenticated.status_code == wrong.status_code == 401

    service = ComputerUseService(router=BackendRouter([backend]))
    target = targets["A"]

    def execute(_request, channel):
        before = channel.observe()
        assert before.metadata["url"].endswith("/page/A")
        assert before.metadata["title"] == "CUA Test A"
        assert before.image.width > 0 and before.image.height > 0
        channel.perform(
            {"action": "click", "coordinate": [260, 145]},
            expected_revision=before.revision,
        )
        focused = channel.observe()
        channel.perform(
            {"action": "hotkey", "keys": ["ctrl", "a"]},
            expected_revision=focused.revision,
        )
        selected = channel.observe()
        outcome = channel.perform(
            {"action": "type", "text": "single-A"},
            expected_revision=selected.revision,
        )
        assert outcome.verification.value == "verified"
        return R.ok({"targetId": outcome.target_id})

    result = service.run(
        {"instruction": "controlled CDP smoke", "target": target.to_dict(), "requestId": "cdp-single"},
        execute,
    )
    assert result["ok"] is True, result
    assert service.status()["activeChannels"] == 0
    assert service.registry.snapshot_counts()["activeLeases"] == 0


def test_adapter_restart_changes_generation_and_rejects_stale_targets(cdp_stack: CdpStack) -> None:
    stack = cdp_stack
    node = shutil.which("node")
    assert node is not None
    old_backend = stack.backend()
    old_capability = old_backend.probe()
    old_target = _targets_by_name(stack)["A"]
    port = _free_loopback_port()
    token = hashlib.sha256(os.urandom(32)).hexdigest()
    url = f"http://127.0.0.1:{port}"
    env = os.environ.copy()
    env.update({
        "SCIFORGE_CUA_CDP_ENDPOINTS": stack.cdp_url,
        "SCIFORGE_CUA_CDP_ADAPTER_TOKEN": token,
        "SCIFORGE_CUA_CDP_ADAPTER_PORT": str(port),
    })
    owned = OwnedProcesses()
    process = owned.add(subprocess.Popen(
        [
            node, "--import", "tsx",
            str(
                REPO_DIR / "packages" / "domains" / "computer-use" /
                "src" / "main" / "cdp-adapter-node-entry.ts"
            ),
        ],
        cwd=REPO_DIR,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NO_WINDOW,
    ))
    try:
        headers = {"Authorization": f"Bearer {token}"}
        _wait_until(
            lambda: requests.get(f"{url}/v1/capabilities", headers=headers, timeout=1).status_code == 200,
            timeout_s=20,
            message="replacement adapter did not become ready",
        )
        replacement = CdpAdapterBackend(adapter_url=url, token=token, timeout_s=10)
        replacement_capability = replacement.probe()
        assert replacement_capability.available is True
        assert replacement_capability.instance_id != old_capability.instance_id
        assert replacement_capability.generation != old_capability.generation
        replacement_target = {
            target.target_id: target for target in replacement.discover_targets()
        }[old_target.target_id]
        assert replacement_target.generation != old_target.generation

        service = ComputerUseService(router=BackendRouter([replacement]))
        result = service.run({
            "instruction": "reject stale adapter generation",
            "target": old_target.to_dict(),
            "requestId": "cdp-stale-generation",
        }, lambda _request, _channel: R.ok({"status": "incorrect"}))
        assert result["error"]["code"] == "TARGET_LOST"
        assert service.registry.snapshot_counts()["activeLeases"] == 0
        assert service.cleanup_pending() == []
    finally:
        errors = owned.close()
        owned.assert_stopped()
        assert errors == []
        assert_loopback_ports_released([port])
    assert process.poll() is not None
    assert CdpAdapterBackend(adapter_url=url, token=token, timeout_s=0.25).probe().available is False
    _assert_browser_available(stack)
    live_ids = {
        item.get("id") for item in _json_request("GET", f"{stack.cdp_url}/json/list")
        if item.get("type") == "page"
    }
    assert stack.pages["A"]["id"] in live_ids


def test_three_sessions_real_transport_do_not_cross_targets(cdp_stack: CdpStack) -> None:
    stack = cdp_stack
    backend = stack.backend()
    targets = _targets_by_name(stack)
    service = ComputerUseService(router=BackendRouter([backend]))
    barrier = threading.Barrier(3)
    stages: dict[str, str] = {}
    stages_lock = threading.Lock()

    for index, name in enumerate(PAGE_NAMES):
        bound = service.bind_session({
            "sessionId": f"cdp-session-{name}",
            "owner": {"runtimeId": "integration", "threadId": f"thread-{index}"},
            "target": targets[name].to_dict(),
        })
        assert bound["ok"] is True

    def execute(name: str, _request, channel):
        def stage(value: str) -> None:
            with stages_lock:
                stages[name] = value

        stage("observe:first")
        first = channel.observe()
        first_hash = hashlib.sha256(first.image.tobytes()).hexdigest()
        stage("barrier")
        barrier.wait(timeout=10)
        stage("click:input")
        channel.perform(
            {"action": "click", "coordinate": [260, 145]},
            expected_revision=first.revision,
        )
        stage("observe:focused")
        focused = channel.observe()
        stage("hotkey:select-all")
        channel.perform(
            {"action": "hotkey", "keys": ["ctrl", "a"]},
            expected_revision=focused.revision,
        )
        stage("observe:selected")
        selected = channel.observe()
        stage("type")
        typed = channel.perform(
            {"action": "type", "text": PAGE_VALUES[name]},
            expected_revision=selected.revision,
        )
        assert typed.verification.value == "verified"
        stage("observe:typed")
        after_type = channel.observe()
        stage("click:button")
        channel.perform(
            {"action": "click", "coordinate": [260, 225]},
            expected_revision=after_type.revision,
        )
        stage("observe:clicked")
        after_click = channel.observe()
        stage("scroll")
        channel.perform(
            {"action": "scroll", "pixels": 300 + 100 * PAGE_NAMES.index(name)},
            expected_revision=after_click.revision,
        )
        stage("observe:final")
        final = channel.observe()
        assert final.target_id == targets[name].target_id
        assert final.metadata["url"].endswith(f"/page/{name}")
        stage("done")
        return R.ok({
            "targetId": final.target_id,
            "firstHash": first_hash,
            "finalHash": hashlib.sha256(final.image.tobytes()).hexdigest(),
        })

    def run(name: str):
        return service.run(
            {
                "instruction": f"controlled page {name}",
                "sessionId": f"cdp-session-{name}",
                "requestId": f"cdp-request-{name}",
            },
            lambda request, channel: execute(name, request, channel),
        )

    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(run, PAGE_NAMES))

    for name, result in zip(PAGE_NAMES, results, strict=True):
        assert result["ok"] is True, (
            f"page {name} at {stages.get(name, 'route/open')}: "
            f"{json.dumps(result, ensure_ascii=False)}; all stages={stages}"
        )
    _wait_until(
        lambda: all(stack.state.snapshot()[name]["clicks"] == 1 for name in PAGE_NAMES),
        timeout_s=5,
        message="button readback did not arrive",
    )
    state = stack.state.snapshot()
    assert {name: state[name]["text"] for name in PAGE_NAMES} == PAGE_VALUES
    assert all(state[name]["clicks"] == 1 for name in PAGE_NAMES)
    assert all(state[name]["scroll"] > 0 for name in PAGE_NAMES)
    assert len({result["data"]["firstHash"] for result in results}) == 3
    status = service.status()
    assert status["activeChannels"] == 0
    assert status["cleanupPending"] == []
    counts = service.registry.snapshot_counts()
    assert counts["requests"] == counts["activeLeases"] == 0
    for name in PAGE_NAMES:
        assert service.release_session({"sessionId": f"cdp-session-{name}"})["ok"] is True
    assert service.registry.snapshot_counts()["sessions"] == 0
    _assert_no_host_focus_or_clipboard_change(stack.desktop_before)


def test_same_real_cdp_page_returns_target_busy_without_opening_second_handle(
    cdp_stack: CdpStack,
) -> None:
    stack = cdp_stack
    backend = stack.backend()
    target = _targets_by_name(stack)["C"]
    service = ComputerUseService(router=BackendRouter([backend]))
    entered = threading.Event()
    release = threading.Event()
    for name in ("owner", "contender"):
        assert service.bind_session({
            "sessionId": f"same-page-{name}",
            "owner": {"runtimeId": "integration", "threadId": name},
            "target": target.to_dict(),
        })["ok"] is True

    def hold(_request, channel):
        channel.observe()
        entered.set()
        assert release.wait(timeout=10)
        return R.ok({"status": "released"})

    with ThreadPoolExecutor(max_workers=1) as pool:
        owner = pool.submit(service.run, {
            "instruction": "hold target",
            "sessionId": "same-page-owner",
            "requestId": "same-page-owner-request",
        }, hold)
        assert entered.wait(timeout=10)
        contender = service.run({
            "instruction": "contend target",
            "sessionId": "same-page-contender",
            "requestId": "same-page-contender-request",
        }, lambda _request, _channel: R.ok({"status": "incorrect"}))
        assert contender["error"]["code"] == "TARGET_BUSY"
        release.set()
        assert owner.result(timeout=10)["ok"] is True

    assert service.registry.snapshot_counts()["activeLeases"] == 0
    assert service.cleanup_pending() == []
    for name in ("owner", "contender"):
        assert service.release_session({"sessionId": f"same-page-{name}"})["ok"] is True


def test_attached_close_does_not_close_pages_or_browser(cdp_stack: CdpStack) -> None:
    stack = cdp_stack
    _assert_browser_available(stack)
    live = _json_request("GET", f"{stack.cdp_url}/json/list")
    live_ids = {item.get("id") for item in live if item.get("type") == "page"}
    assert {page["id"] for page in stack.pages.values()} <= live_ids
    _assert_no_host_focus_or_clipboard_change(stack.desktop_before)


def test_attached_driver_shutdown_disconnects_without_closing_browser(cdp_stack: CdpStack) -> None:
    stack = cdp_stack
    node = shutil.which("node")
    assert node is not None
    module_url = (
        REPO_DIR / "packages" / "domains" / "computer-use" / "src" /
        "main" / "services" / "computer-use-cdp-adapter.ts"
    ).as_uri()
    script = (
        f"import {{ createPlaywrightCdpDriver }} from {json.dumps(module_url)};"
        f"const driver=createPlaywrightCdpDriver([{json.dumps(stack.cdp_url)}]);"
        "const status=await driver.available();"
        "if(!status.available) throw new Error('driver unavailable');"
        "await driver.shutdown();"
    )
    completed = subprocess.run(
        [node, "--import", "tsx", "--input-type=module", "--eval", script],
        cwd=REPO_DIR,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        timeout=30,
        creationflags=subprocess.CREATE_NO_WINDOW,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr
    _assert_browser_available(stack)
    live_ids = {
        item.get("id") for item in _json_request("GET", f"{stack.cdp_url}/json/list")
        if item.get("type") == "page"
    }
    assert {page["id"] for page in stack.pages.values()} <= live_ids


def test_post_dispatch_transport_loss_is_unknown_and_not_replayed(cdp_stack: CdpStack) -> None:
    """A test-owned proxy drops exactly one response after the real action commits."""
    stack = cdp_stack
    dropped = threading.Event()
    forwarded_actions = 0
    counter_lock = threading.Lock()

    class LossProxy(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            self._forward()

        def do_POST(self) -> None:  # noqa: N802
            self._forward()

        def _forward(self) -> None:
            nonlocal forwarded_actions
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length) if length else b""
            payload = json.loads(raw or b"{}") if raw else {}
            response = requests.request(
                self.command,
                f"{stack.adapter_url}{self.path}",
                headers={
                    "Authorization": self.headers.get("Authorization", ""),
                    "Content-Type": "application/json",
                },
                data=raw or None,
                timeout=15,
            )
            should_drop = (
                self.path == "/v1/action"
                and isinstance(payload.get("action"), dict)
                and payload["action"].get("text") == "committed-without-response"
            )
            if should_drop:
                with counter_lock:
                    forwarded_actions += 1
                assert response.status_code == 200, response.text
                dropped.set()
                self.close_connection = True
                self.connection.shutdown(socket.SHUT_RDWR)
                self.connection.close()
                return
            self.send_response(response.status_code)
            self.send_header("Content-Type", response.headers.get("Content-Type", "application/json"))
            self.send_header("Content-Length", str(len(response.content)))
            self.end_headers()
            self.wfile.write(response.content)

        def log_message(self, _format: str, *_args: object) -> None:
            return

    proxy = ThreadingHTTPServer(("127.0.0.1", 0), LossProxy)
    proxy_thread = threading.Thread(target=proxy.serve_forever, daemon=True)
    proxy_thread.start()
    try:
        proxy_url = f"http://127.0.0.1:{proxy.server_address[1]}"
        backend = CdpAdapterBackend(adapter_url=proxy_url, token=stack.token, timeout_s=15)
        target = _targets_by_name(stack)["A"]
        service = ComputerUseService(router=BackendRouter([backend]))

        def execute(_request, channel):
            first = channel.observe()
            channel.perform(
                {"action": "click", "coordinate": [260, 145]},
                expected_revision=first.revision,
            )
            focused = channel.observe()
            channel.perform(
                {"action": "hotkey", "keys": ["ctrl", "a"]},
                expected_revision=focused.revision,
            )
            selected = channel.observe()
            channel.perform(
                {"action": "type", "text": "committed-without-response"},
                expected_revision=selected.revision,
            )
            raise AssertionError("lost action response must not be reported as success")

        result = service.run({
            "instruction": "inject post-dispatch response loss",
            "target": target.to_dict(),
            "requestId": "cdp-post-dispatch-loss",
        }, execute)
        assert dropped.wait(timeout=5)
        assert result["error"]["code"] == "ACTION_OUTCOME_UNKNOWN"
        assert result["error"]["retryable"] is False
        _wait_until(
            lambda: stack.state.snapshot()["A"]["text"] == "committed-without-response",
            timeout_s=5,
            message="forwarded action did not commit before its response was dropped",
        )
        assert forwarded_actions == 1
        assert service.registry.snapshot_counts()["activeLeases"] == 0
        assert service.cleanup_pending() == []
    finally:
        proxy.shutdown()
        proxy.server_close()
        proxy_thread.join(timeout=2)


def test_cancelled_channel_does_not_commit_to_its_page(cdp_stack: CdpStack) -> None:
    stack = cdp_stack
    backend = stack.backend()
    target = _targets_by_name(stack)["C"]
    service = ComputerUseService(router=BackendRouter([backend]))

    def execute(_request, channel):
        observed = channel.observe()
        service.cancel({"requestId": "cdp-cancelled", "reason": "integration-test"})
        try:
            channel.perform(
                {"action": "type", "text": "must-not-appear"},
                expected_revision=observed.revision,
            )
        except ChannelError as error:
            return R.err(error.code, str(error))
        return R.ok({"status": "incorrect"})

    before = stack.state.snapshot()["C"]["text"]
    result = service.run(
        {"instruction": "cancel before action", "target": target.to_dict(), "requestId": "cdp-cancelled"},
        execute,
    )
    assert result["error"]["code"] == "CANCEL_PENDING"
    assert stack.state.snapshot()["C"]["text"] == before
    assert service.registry.snapshot_counts()["activeLeases"] == 0
    assert service.registry.snapshot_counts()["sessions"] == 0
    assert service.status()["activeChannels"] == 0
    assert service.cleanup_pending() == []


def test_parallel_batch_parent_cancel_reaches_all_real_cdp_channels(
    cdp_stack: CdpStack,
) -> None:
    stack = cdp_stack
    backend = stack.backend()
    targets = _targets_by_name(stack)
    service = ComputerUseService(router=BackendRouter([backend]))
    all_observed = threading.Barrier(4)
    batch_result: dict[str, Any] = {}

    for name in PAGE_NAMES:
        assert service.bind_session({
            "sessionId": f"batch-cancel-session-{name}",
            "owner": {"runtimeId": "integration", "threadId": "batch-cancel"},
            "target": targets[name].to_dict(),
        })["ok"] is True

    def execute(_request, channel):
        channel.observe()
        all_observed.wait(timeout=10)
        try:
            channel.wait(30)
        except ChannelError as error:
            return R.err(error.code, str(error))
        return R.ok({"status": "incorrect"})

    worker = threading.Thread(target=lambda: batch_result.update(service.run_batch({
        "instruction": "cancel all real target-scoped children",
        "requestId": "real-cdp-parent-cancel",
        "parallel": [
            {"instruction": f"wait on {name}", "sessionId": f"batch-cancel-session-{name}"}
            for name in PAGE_NAMES
        ],
    }, execute)))
    before = stack.state.snapshot()
    worker.start()
    all_observed.wait(timeout=10)
    cancelled = service.cancel({
        "requestId": "real-cdp-parent-cancel",
        "reason": "real-integration-cancel",
    })
    worker.join(timeout=15)

    assert not worker.is_alive()
    assert cancelled["ok"] is True
    assert len(cancelled["data"]["children"]) == 3
    assert batch_result["data"]["successCount"] == 0
    assert batch_result["data"]["failureCount"] == 3
    assert {
        item["result"]["error"]["code"] for item in batch_result["data"]["results"]
    } == {"CANCEL_PENDING"}
    assert stack.state.snapshot() == before
    counts = service.registry.snapshot_counts()
    assert counts["requests"] == counts["activeLeases"] == 0
    assert service.status()["activeChannels"] == 0
    assert service.cleanup_pending() == []
    for name in PAGE_NAMES:
        assert service.release_session({
            "sessionId": f"batch-cancel-session-{name}",
        })["ok"] is True
    assert service.registry.snapshot_counts()["sessions"] == 0


def test_parallel_batch_target_loss_does_not_break_other_real_pages(
    cdp_stack: CdpStack,
) -> None:
    stack = cdp_stack
    backend = stack.backend()
    targets = _targets_by_name(stack)
    service = ComputerUseService(router=BackendRouter([backend]))
    observed = threading.Barrier(3)
    page_closed = threading.Event()

    for name in PAGE_NAMES:
        bound = service.bind_session({
            "sessionId": f"loss-session-{name}",
            "owner": {"runtimeId": "integration", "threadId": "loss-thread"},
            "target": targets[name].to_dict(),
        })
        assert bound["ok"] is True

    def execute(request, channel):
        name = request["instruction"].rsplit(" ", 1)[-1]
        before = channel.observe()
        observed.wait(timeout=10)
        if name == "B":
            response = requests.get(
                f"{stack.cdp_url}/json/close/{stack.pages['B']['id']}",
                timeout=5,
            )
            response.raise_for_status()
            page_closed.set()
            try:
                channel.observe()
            except ChannelError as error:
                return R.err(error.code, str(error))
            return R.ok({"status": "incorrect"})
        assert page_closed.wait(timeout=10)
        channel.perform(
            {"action": "click", "coordinate": [260, 145]},
            expected_revision=before.revision,
        )
        focused = channel.observe()
        channel.perform(
            {"action": "hotkey", "keys": ["ctrl", "a"]},
            expected_revision=focused.revision,
        )
        selected = channel.observe()
        outcome = channel.perform(
            {"action": "type", "text": f"survivor-{name}"},
            expected_revision=selected.revision,
        )
        return R.ok({"targetId": outcome.target_id})

    result = service.run_batch({
        "instruction": "one real CDP target is lost while peers continue",
        "requestId": "real-cdp-target-loss-batch",
        "parallel": [
            {"instruction": f"target-loss {name}", "sessionId": f"loss-session-{name}"}
            for name in PAGE_NAMES
        ],
    }, execute)

    assert result["ok"] is True, result
    assert result["data"]["successCount"] == 2
    assert result["data"]["failureCount"] == 1
    children = {item["sessionId"]: item["result"] for item in result["data"]["results"]}
    assert children["loss-session-B"]["error"]["code"] in {
        "TARGET_LOST", "BACKEND_UNAVAILABLE",
    }
    assert children["loss-session-A"]["ok"] is True
    assert children["loss-session-C"]["ok"] is True
    assert stack.state.snapshot()["A"]["text"] == "survivor-A"
    assert stack.state.snapshot()["C"]["text"] == "survivor-C"
    counts = service.registry.snapshot_counts()
    assert counts["requests"] == counts["activeLeases"] == 0
    for name in PAGE_NAMES:
        assert service.release_session({"sessionId": f"loss-session-{name}"})["ok"] is True
    assert service.registry.snapshot_counts()["sessions"] == 0
    assert service.status()["activeChannels"] == 0
    assert service.cleanup_pending() == []
