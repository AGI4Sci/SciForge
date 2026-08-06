from __future__ import annotations

import base64
import threading
from io import BytesIO

import pytest
from PIL import Image

from cua.capabilities import BackendId, Verification
from cua.service import ComputerUseService
from cua.target import parse_target_descriptor
from driver.backend import BackendOpenContext, BackendOperationError
from driver.backends.cdp_adapter import CdpAdapterBackend
from driver.router import BackendRouter


def png_base64() -> str:
    buffer = BytesIO()
    Image.new("RGB", (8, 6), "navy").save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


class Response:
    def __init__(self, payload, status=200):
        self.payload = payload
        self.status_code = status

    def json(self):
        return self.payload


class AdapterSession:
    def __init__(self):
        self.calls = []
        self.fail_action = False
        self.lose_on_observe = False
        self.unavailable_on_observe = False

    def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        path = "/" + url.split("/v1/", 1)[1]
        if path == "/capabilities":
            return Response({"ok": True, "data": {"available": True}})
        if path == "/targets":
            return Response({"ok": True, "data": {"targets": [target_value()]}})
        if path == "/handles/open":
            return Response({"ok": True, "data": {"handleId": "handle-1"}})
        if path == "/observe":
            if self.unavailable_on_observe:
                return Response({"ok": False, "error": {
                    "code": "BACKEND_UNAVAILABLE",
                    "message": "CDP target capture timed out",
                }}, status=400)
            if self.lose_on_observe:
                return Response({"ok": False, "error": {
                    "code": "TARGET_LOST",
                    "message": "page.screenshot: target page has been closed",
                }}, status=400)
            return Response({"ok": True, "data": {
                "targetId": "page-1", "revision": "cdp:1", "imageBase64": png_base64(),
                "metadata": {"url": "https://example.test/"},
            }})
        if path == "/action":
            if self.fail_action:
                raise TimeoutError("response lost")
            return Response({"ok": True, "data": {
                "targetId": "page-1", "committed": True, "mayHaveTakenEffect": True,
                "verification": {"status": "verified", "revisionAfter": "cdp:2", "details": {"value": "abc"}},
            }})
        if path in {"/handles/cancel", "/handles/close"}:
            return Response({"ok": True, "data": {"closed": True}})
        raise AssertionError(path)


def target_value():
    return {
        "targetId": "page-1", "kind": "browser-page", "ownership": "attached",
        "locator": {"cdpEndpoint": "http://127.0.0.1:9222", "cdpTargetId": "target-1"},
    }


def backend_and_handle():
    session = AdapterSession()
    backend = CdpAdapterBackend(adapter_url="http://127.0.0.1:3909", token="secret", session=session)
    context = BackendOpenContext("request-1", True, 0, False, threading.Event())
    handle = backend.open(parse_target_descriptor(target_value()), context)
    return backend, handle, session


def test_probe_and_discovery_report_target_scoped_cdp_capability():
    session = AdapterSession()
    backend = CdpAdapterBackend(adapter_url="http://127.0.0.1:3909", token="secret", session=session)
    capability = backend.probe()
    assert capability.backend is BackendId.BROWSER_CDP
    assert capability.available is True
    assert capability.affects_user_input is False
    assert backend.discover_targets()[0].target_id == "page-1"
    assert session.calls[0][2]["headers"]["Authorization"] == "Bearer secret"


def test_observe_action_verify_and_idempotent_close():
    backend, handle, session = backend_and_handle()
    before = backend.observe(handle)
    assert before.target_id == "page-1"
    assert before.image.size == (8, 6)
    receipt = backend.perform(handle, {"action": "type", "text": "abc"}, before.revision)
    evidence = backend.verify(handle, {"action": "type"}, receipt, before)
    assert evidence.status is Verification.VERIFIED
    assert evidence.details["value"] == "abc"
    backend.close(handle, "done")
    backend.close(handle, "done-again")
    close_calls = [call for call in session.calls if call[1].endswith("/handles/close")]
    assert len(close_calls) == 1


def test_action_transport_failure_is_unknown_and_never_safe_to_replay():
    backend, handle, session = backend_and_handle()
    before = backend.observe(handle)
    session.fail_action = True
    with pytest.raises(BackendOperationError) as caught:
        backend.perform(handle, {"action": "click", "coordinate": [1, 2]}, before.revision)
    assert caught.value.may_have_taken_effect is True


def test_observe_preserves_structured_target_lost_from_adapter():
    backend, handle, session = backend_and_handle()
    session.lose_on_observe = True
    with pytest.raises(BackendOperationError) as caught:
        backend.observe(handle)
    assert caught.value.code == "TARGET_LOST"
    assert caught.value.may_have_taken_effect is False


def test_observe_preserves_structured_backend_unavailable_from_adapter():
    backend, handle, session = backend_and_handle()
    session.unavailable_on_observe = True
    with pytest.raises(BackendOperationError) as caught:
        backend.observe(handle)
    assert caught.value.code == "BACKEND_UNAVAILABLE"
    assert caught.value.may_have_taken_effect is False


def test_service_preserves_uncaught_channel_target_lost_code():
    session = AdapterSession()
    session.lose_on_observe = True
    backend = CdpAdapterBackend(
        adapter_url="http://127.0.0.1:3909", token="secret", session=session,
    )
    service = ComputerUseService(router=BackendRouter([backend]))
    result = service.run(
        {
            "instruction": "observe closed target",
            "target": target_value(),
            "requestId": "request-target-lost",
        },
        lambda _request, channel: channel.observe(),
    )
    assert result["error"]["code"] == "TARGET_LOST"
    counts = service.registry.snapshot_counts()
    assert counts["requests"] == counts["activeLeases"] == 0


def test_unconfigured_backend_is_explicitly_unavailable():
    capability = CdpAdapterBackend(adapter_url="", token="").probe()
    assert capability.available is False
    assert "not configured" in (capability.reason or "")
