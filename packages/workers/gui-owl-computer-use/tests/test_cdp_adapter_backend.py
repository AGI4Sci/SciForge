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
        self.lose_first_open_response = False
        self.open_transport_failures = 0
        self.safe_open_rejection = False
        self.open_attempts = 0
        self.close_attempts = 0
        self.close_transport_failures = 0
        self.recovery_started: threading.Event | None = None
        self.allow_recovery: threading.Event | None = None
        self.invalid_action_generation = False

    def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        path = "/" + url.split("/v1/", 1)[1]
        if path == "/capabilities":
            return Response({"ok": True, "data": {
                "available": True, "adapterInstanceId": "adapter-1", "generation": "generation-1",
                "supportedTargetKinds": ["browser-page", "electron-webcontents"],
            }})
        if path == "/targets":
            return Response({"ok": True, "data": {"targets": [target_value()]}})
        if path == "/handles/open":
            self.open_attempts += 1
            if self.open_transport_failures > 0:
                self.open_transport_failures -= 1
                raise TimeoutError("open response lost after dispatch")
            if self.lose_first_open_response and self.open_attempts == 1:
                raise TimeoutError("open response lost after creation")
            if self.safe_open_rejection:
                return Response({"ok": False, "error": {
                    "code": "BACKEND_UNAVAILABLE",
                    "message": "debugger is already attached",
                    "safeToRetry": True,
                }}, status=409)
            if self.open_attempts >= 3 and self.recovery_started is not None:
                self.recovery_started.set()
                if self.allow_recovery is None or not self.allow_recovery.wait(timeout=5):
                    raise TimeoutError("test did not release open recovery")
            return Response({"ok": True, "data": {
                "handleId": "handle-1", "targetId": "page-1", "generation": "generation-1",
            }})
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
                "targetId": "page-1",
                "generation": "generation-1",
                "revision": "cdp:1", "imageBase64": png_base64(),
                "metadata": {"url": "https://example.test/"},
            }})
        if path == "/action":
            if self.fail_action:
                raise TimeoutError("response lost")
            return Response({"ok": True, "data": {
                "targetId": "page-1",
                "generation": "wrong-generation" if self.invalid_action_generation else "generation-1",
                "committed": True, "mayHaveTakenEffect": True,
                "verification": {"status": "verified", "revisionAfter": "cdp:2", "details": {"value": "abc"}},
            }})
        if path == "/handles/close":
            self.close_attempts += 1
            if self.close_transport_failures > 0:
                self.close_transport_failures -= 1
                raise TimeoutError("close response lost")
            return Response({"ok": True, "data": {"closed": True}})
        if path == "/handles/cancel":
            return Response({"ok": True, "data": {"cancelled": True}})
        raise AssertionError(path)


def target_value():
    return {
        "targetId": "page-1", "kind": "browser-page", "ownership": "attached",
        "generation": "generation-1",
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
    assert capability.may_activate_target is True
    assert {kind.value for kind in capability.target_kinds} == {
        "browser-page", "electron-webcontents",
    }
    assert capability.instance_id == "adapter-1"
    assert capability.generation == "generation-1"
    assert backend.discover_targets()[0].target_id == "page-1"
    assert session.calls[0][2]["headers"]["Authorization"] == "Bearer secret"


def test_observe_action_verify_and_idempotent_close():
    backend, handle, session = backend_and_handle()
    before = backend.observe(handle)
    assert before.target_id == "page-1"
    assert before.image.size == (8, 6)
    receipt = backend.perform(handle, {"action": "type", "text": "abc"}, before.revision)
    assert receipt.backend_evidence == {"adapter": "cdp-adapter"}
    evidence = backend.verify(handle, {"action": "type"}, receipt, before)
    assert evidence.status is Verification.VERIFIED
    assert evidence.details["value"] == "abc"
    backend.close(handle, "done")
    backend.close(handle, "done-again")
    close_calls = [call for call in session.calls if call[1].endswith("/handles/close")]
    assert len(close_calls) == 1


def test_action_uses_navigation_safe_response_timeout_without_changing_observe_timeout():
    session = AdapterSession()
    backend = CdpAdapterBackend(
        adapter_url="http://127.0.0.1:3909",
        token="secret",
        timeout_s=4,
        action_timeout_s=37,
        session=session,
    )
    context = BackendOpenContext("request-timeouts", True, 0, False, threading.Event())
    handle = backend.open(parse_target_descriptor(target_value()), context)
    before = backend.observe(handle)
    backend.perform(handle, {"action": "key", "keys": ["ENTER"]}, before.revision)

    observe_call = next(call for call in session.calls if call[1].endswith("/observe"))
    action_call = next(call for call in session.calls if call[1].endswith("/action"))
    assert observe_call[2]["timeout"] == 4
    assert action_call[2]["timeout"] == 37


def test_existing_handle_keeps_original_adapter_routing_after_reconfiguration():
    backend, handle, session = backend_and_handle()
    backend.configure("http://127.0.0.1:4999", "replacement-secret")
    backend.close(handle, "done")
    close_call = next(call for call in session.calls if call[1].endswith("/handles/close"))
    assert close_call[1].startswith("http://127.0.0.1:3909/")
    assert close_call[2]["headers"]["Authorization"] == "Bearer secret"


def test_open_replays_same_request_once_to_recover_lost_response():
    session = AdapterSession()
    session.lose_first_open_response = True
    backend = CdpAdapterBackend(
        adapter_url="http://127.0.0.1:3909", token="secret", session=session,
    )
    context = BackendOpenContext("request-open-recovery", True, 0, False, threading.Event())
    handle = backend.open(parse_target_descriptor(target_value()), context)
    assert handle.adapter_handle_id == "handle-1"
    assert session.open_attempts == 2


def test_safe_open_rejection_releases_service_request_and_lease():
    session = AdapterSession()
    session.safe_open_rejection = True
    backend = CdpAdapterBackend(
        adapter_url="http://127.0.0.1:3909", token="secret", session=session,
    )
    context = BackendOpenContext("request-safe-open", True, 0, False, threading.Event())
    with pytest.raises(BackendOperationError) as caught:
        backend.open(parse_target_descriptor(target_value()), context)
    assert caught.value.code == "BACKEND_UNAVAILABLE"
    assert caught.value.safe_to_retry is True

    service = ComputerUseService(router=BackendRouter([backend]))
    result = service.run({
        "instruction": "observe busy debugger",
        "target": target_value(),
        "requestId": "request-safe-open-service",
    }, lambda _request, _channel: {"ok": True})
    assert result["error"]["code"] == "BACKEND_UNAVAILABLE"
    counts = service.registry.snapshot_counts()
    assert counts["requests"] == counts["activeLeases"] == 0
    assert service.cleanup_pending() == []


def test_reaper_recovers_unknown_open_then_closes_handle_and_releases_lease():
    session = AdapterSession()
    session.open_transport_failures = 2
    backend = CdpAdapterBackend(
        adapter_url="http://127.0.0.1:3909", token="secret", session=session,
    )
    service = ComputerUseService(router=BackendRouter([backend]))
    result = service.run({
        "instruction": "observe after uncertain open",
        "target": target_value(),
        "requestId": "request-recover-open",
    }, lambda _request, _channel: {"ok": True})
    assert result["error"]["code"] == "CLEANUP_INCOMPLETE"
    assert service.registry.snapshot_counts()["activeLeases"] == 1

    reaped = service.reap_once()
    assert reaped["cleanedRequests"] == ["request-recover-open"]
    assert service.cleanup_pending() == []
    counts = service.registry.snapshot_counts()
    assert counts["requests"] == counts["activeLeases"] == counts["sessions"] == 0
    assert any(call[1].endswith("/handles/close") for call in session.calls)


def test_reaper_retries_recovered_handle_close_without_reopening():
    session = AdapterSession()
    session.open_transport_failures = 2
    session.close_transport_failures = 1
    backend = CdpAdapterBackend(
        adapter_url="http://127.0.0.1:3909", token="secret", session=session,
    )
    service = ComputerUseService(router=BackendRouter([backend]))
    result = service.run({
        "instruction": "recover and retry close",
        "target": target_value(),
        "requestId": "request-retry-recovered-close",
    }, lambda _request, _channel: {"ok": True})
    assert result["error"]["code"] == "CLEANUP_INCOMPLETE"

    first = service.reap_once()
    assert first["cleanupPending"] == ["request-retry-recovered-close"]
    assert session.open_attempts == 3
    assert session.close_attempts == 1
    assert service.registry.snapshot_counts()["activeLeases"] == 1

    second = service.reap_once()
    assert second["cleanedRequests"] == ["request-retry-recovered-close"]
    assert session.open_attempts == 3
    assert session.close_attempts == 2
    assert service.cleanup_pending() == []
    counts = service.registry.snapshot_counts()
    assert counts["requests"] == counts["activeLeases"] == counts["sessions"] == 0


@pytest.mark.parametrize("_iteration", range(10))
def test_reaper_and_shutdown_serialize_same_pending_open_cleanup(_iteration):
    session = AdapterSession()
    session.open_transport_failures = 2
    session.recovery_started = threading.Event()
    session.allow_recovery = threading.Event()
    backend = CdpAdapterBackend(
        adapter_url="http://127.0.0.1:3909", token="secret", session=session,
    )
    service = ComputerUseService(router=BackendRouter([backend]))
    result = service.run({
        "instruction": "race cleanup authorities",
        "target": target_value(),
        "requestId": "request-concurrent-open-cleanup",
    }, lambda _request, _channel: {"ok": True})
    assert result["error"]["code"] == "CLEANUP_INCOMPLETE"

    outputs: dict[str, object] = {}
    errors: list[BaseException] = []

    def reap() -> None:
        try:
            outputs["reap"] = service.reap_once()
        except BaseException as error:  # noqa: BLE001 - thread assertion transport
            errors.append(error)

    def shut_down() -> None:
        try:
            outputs["shutdown"] = service.shutdown()
        except BaseException as error:  # noqa: BLE001 - thread assertion transport
            errors.append(error)

    reaper_thread = threading.Thread(target=reap)
    reaper_thread.start()
    assert session.recovery_started.wait(timeout=5)
    shutdown_thread = threading.Thread(target=shut_down)
    shutdown_thread.start()
    session.allow_recovery.set()
    reaper_thread.join(timeout=5)
    shutdown_thread.join(timeout=5)

    assert not reaper_thread.is_alive()
    assert not shutdown_thread.is_alive()
    assert errors == []
    assert session.open_attempts == 3
    assert session.close_attempts == 1
    assert service.cleanup_pending() == []
    counts = service.registry.snapshot_counts()
    assert counts["requests"] == counts["activeLeases"] == counts["sessions"] == 0
    assert outputs["shutdown"]["cleanupComplete"] is True
    assert outputs["shutdown"]["lifecycleState"] == "stopped"


def test_action_transport_failure_is_unknown_and_never_safe_to_replay():
    backend, handle, session = backend_and_handle()
    before = backend.observe(handle)
    session.fail_action = True
    with pytest.raises(BackendOperationError) as caught:
        backend.perform(handle, {"action": "click", "coordinate": [1, 2]}, before.revision)
    assert caught.value.may_have_taken_effect is True


def test_invalid_action_identity_is_unknown_and_cannot_be_reported_as_success():
    backend, handle, session = backend_and_handle()
    before = backend.observe(handle)
    session.invalid_action_generation = True
    with pytest.raises(BackendOperationError) as caught:
        backend.perform(handle, {"action": "type", "text": "abc"}, before.revision)
    assert caught.value.code == "TARGET_LOST"
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
