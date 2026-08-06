"""Opt-in real CDP transport tests using one test-owned headless browser."""
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
from tests.integration._process_guard import OwnedProcesses, remove_owned_tree


pytestmark = pytest.mark.skipif(
    os.getenv("CUA_CDP_INTEGRATION") != "1",
    reason="set CUA_CDP_INTEGRATION=1 to start the test-owned headless browser",
)

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
    assert after[0] == before[0], "controlled CDP changed the foreground HWND"
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
    cleanup_errors: list[str] = []
    try:
        desktop_before = _desktop_state()
        state = PageState()
        page_server = ThreadingHTTPServer(("127.0.0.1", 0), _handler(state))
        page_thread = threading.Thread(target=page_server.serve_forever, daemon=True)
        page_thread.start()
        page_port = int(page_server.server_address[1])

        profile = root / "profile"
        cdp_port = _free_loopback_port()
        browser = processes.add(subprocess.Popen(
            [
                str(browser_exe), "--headless=new",
                f"--remote-debugging-port={cdp_port}",
                "--remote-debugging-address=127.0.0.1",
                f"--user-data-dir={profile}", "--no-first-run",
                "--disable-default-apps", "--disable-sync", "about:blank",
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW,
        ))
        cdp_url = f"http://127.0.0.1:{cdp_port}"
        _wait_until(
            lambda: requests.get(f"{cdp_url}/json/version", timeout=1).status_code == 200,
            timeout_s=15,
            message="headless browser did not expose its owned CDP endpoint",
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
                str(REPO_DIR / "src" / "main" / "computer-use-cdp-adapter-node-entry.ts"),
            ],
            cwd=REPO_DIR,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW,
        ))
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
        cleanup_errors.extend(processes.close())
        try:
            processes.assert_stopped()
        except AssertionError as error:
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
    assert service.status()["activeChannels"] == 0
    counts = service.registry.snapshot_counts()
    assert counts["requests"] == counts["activeLeases"] == 0
    _assert_no_host_focus_or_clipboard_change(stack.desktop_before)


def test_attached_close_does_not_close_pages_or_browser(cdp_stack: CdpStack) -> None:
    stack = cdp_stack
    assert stack.browser.poll() is None
    live = _json_request("GET", f"{stack.cdp_url}/json/list")
    live_ids = {item.get("id") for item in live if item.get("type") == "page"}
    assert {page["id"] for page in stack.pages.values()} <= live_ids
    _assert_no_host_focus_or_clipboard_change(stack.desktop_before)


@pytest.mark.skip(reason="post-dispatch/pre-response transport cut cannot yet be triggered deterministically")
def test_post_dispatch_transport_loss_is_unknown_and_not_replayed() -> None:
    """Reserved until the adapter exposes a test-only post-dispatch barrier."""


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


def test_target_loss_is_structured_and_does_not_break_other_page(cdp_stack: CdpStack) -> None:
    stack = cdp_stack
    backend = stack.backend()
    targets = _targets_by_name(stack)
    service = ComputerUseService(router=BackendRouter([backend]))
    observed = threading.Barrier(2)
    page_closed = threading.Event()

    for name in ("A", "B"):
        bound = service.bind_session({
            "sessionId": f"loss-session-{name}",
            "owner": {"runtimeId": "integration", "threadId": f"loss-thread-{name}"},
            "target": targets[name].to_dict(),
        })
        assert bound["ok"] is True

    def execute_a(_request, channel):
        before = channel.observe()
        observed.wait(timeout=10)
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
            {"action": "type", "text": "survivor-A"},
            expected_revision=selected.revision,
        )
        return R.ok({"targetId": outcome.target_id})

    def execute_b(_request, channel):
        channel.observe()
        observed.wait(timeout=10)
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

    def run(name: str):
        return service.run(
            {
                "instruction": f"target-loss {name}",
                "sessionId": f"loss-session-{name}",
                "requestId": f"loss-request-{name}",
            },
            execute_a if name == "A" else execute_b,
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        result_a, result_b = list(pool.map(run, ("A", "B")))

    assert result_b["error"]["code"] in {"TARGET_LOST", "BACKEND_UNAVAILABLE"}, result_b
    assert result_a["ok"] is True, result_a
    assert stack.state.snapshot()["A"]["text"] == "survivor-A"
    counts = service.registry.snapshot_counts()
    assert counts["requests"] == counts["activeLeases"] == 0
