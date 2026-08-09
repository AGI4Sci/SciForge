from __future__ import annotations

import base64
import io
import threading
import time
from dataclasses import replace

import pytest
from PIL import Image

from cua.capabilities import Verification
from cua import result as R
from cua.service import ComputerUseService
from driver.backends.isolated_desktop import IsolatedDesktopBackend
from driver.router import BackendRouter
from driver.backend import BackendOpenContext, BackendOperationError
from driver.backends.isolated_desktop import ISOLATED_DESKTOP_UNAVAILABLE
from driver.backends.remote_windows_worker import (
    REMOTE_WORKER_MANAGED_UNAVAILABLE,
    RemoteWindowsWorkerProvider,
    RemoteWorkerConfig,
    RemoteWorkerTransportError,
    RequestsRemoteWorkerTransport,
)


IDENTITY = {
    "environmentId": "env-test-1",
    "machineId": "machine-1",
    "bootId": "boot-1",
    "interactiveSessionId": "session-1",
    "generation": "worker-1",
}


def _png() -> str:
    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), "blue").save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode()


def _config(tmp_path, **changes) -> RemoteWorkerConfig:
    paths = []
    for name in ("ca.pem", "client.pem", "client-key.pem"):
        path = tmp_path / name
        path.write_text("test-only", encoding="utf-8")
        paths.append(str(path))
    return replace(RemoteWorkerConfig(
        endpoint="https://worker.example.test:9443",
        environment_id="env-test-1",
        ca_cert=paths[0],
        client_cert=paths[1],
        client_key=paths[2],
    ), **changes)


def _context() -> BackendOpenContext:
    return BackendOpenContext("request-1", True, 0, False, threading.Event())


class FakeTransport:
    def __init__(self) -> None:
        self.identity = dict(IDENTITY)
        self.requests = []
        self.fail_action = False

    def request(self, method, path, body=None):
        body = dict(body or {})
        self.requests.append((method, path, body))
        if path == "/v1/status":
            return {"ready": True, "identity": dict(self.identity), "maxConcurrency": 1}
        if path == "/v1/handles/connect":
            return {
                "identity": dict(self.identity),
                "handleId": "handle-1",
                "capabilityToken": "test-capability-token",
            }
        if path == "/v1/handles/recover":
            return {
                "status": "connected",
                "identity": dict(self.identity),
                "handleId": "handle-1",
                "capabilityToken": "test-capability-token",
            }
        if path == "/v1/observe":
            return {
                "identity": dict(self.identity),
                "revision": "remote:1",
                "imageBase64": _png(),
                "metadata": {"viewport": [8, 8]},
            }
        if path == "/v1/actions":
            if self.fail_action:
                raise RemoteWorkerTransportError("REMOTE_WORKER_UNAVAILABLE", "cut")
            return {
                "identity": dict(self.identity),
                "actionId": body["actionId"],
                "revisionBefore": body["expectedRevision"],
                "committed": True,
                "mayHaveTakenEffect": True,
            }
        if path == "/v1/verify":
            return {
                "identity": dict(self.identity),
                "status": "verified",
                "revisionAfter": "remote:2",
                "details": {"readback": "alpha"},
            }
        if path in {"/v1/handles/cancel", "/v1/handles/close"}:
            return {"identity": dict(self.identity)}
        raise AssertionError(path)


def test_empty_and_partial_configuration_stay_unavailable(tmp_path):
    empty_transport = FakeTransport()
    empty = RemoteWindowsWorkerProvider(RemoteWorkerConfig(), empty_transport)
    status = empty.probe()
    assert status.available is False
    assert ISOLATED_DESKTOP_UNAVAILABLE in status.reason
    assert empty_transport.requests == []

    partial = RemoteWindowsWorkerProvider(
        RemoteWorkerConfig(endpoint="https://worker.example.test"), FakeTransport(),
    ).probe()
    assert partial.available is False
    assert "incomplete" in partial.reason


@pytest.mark.parametrize("endpoint", [
    "http://worker.example.test",
    "https://user:pass@worker.example.test",
    "https://worker.example.test/path",
    "https://worker.example.test?target=other",
    "https://worker.example.test#fragment",
])
def test_endpoint_must_be_one_static_https_origin(tmp_path, endpoint):
    config = _config(tmp_path, endpoint=endpoint)
    with pytest.raises(ValueError):
        config.validated_endpoint()


def test_invalid_numeric_environment_values_fail_closed_without_import_crash():
    config = RemoteWorkerConfig.from_env({
        "SCIFORGE_CUA_REMOTE_WORKER_TIMEOUT_S": "invalid",
        "SCIFORGE_CUA_REMOTE_WORKER_MAX_RESPONSE_BYTES": "invalid",
    })
    assert config.timeout_s == -1
    assert config.max_response_bytes == -1


def test_attached_worker_lifecycle_is_identity_bound(tmp_path):
    transport = FakeTransport()
    provider = RemoteWindowsWorkerProvider(_config(tmp_path), transport)
    assert provider.probe().available is True
    assert provider.probe().available is True
    target = provider.discover_environments()[0]
    assert target.ownership.value == "attached"
    assert target.locator["isolatedEnvironmentId"] == "env-test-1"
    assert [path for _, path, _ in transport.requests].count("/v1/status") == 1

    handle = provider.connect(target, _context())
    assert "test-capability-token" not in repr(handle)
    before = provider.observe(handle)
    assert before.target_id == target.target_id
    assert before.revision == "remote:1"
    receipt = provider.perform(handle, {"action": "type", "text": "alpha"}, before.revision)
    assert receipt.committed is True
    evidence = provider.verify(handle, {"action": "type", "text": "alpha"}, receipt, before)
    assert evidence.status is Verification.VERIFIED
    assert evidence.revision_after == "remote:2"

    provider.cancel(handle, "test")
    assert handle.context.cancellation.is_set()
    provider.close(handle, "done")
    provider.close(handle, "done-again")
    assert [path for _, path, _ in transport.requests].count("/v1/handles/close") == 1


def test_connect_rejects_boot_or_session_generation_change(tmp_path):
    transport = FakeTransport()
    provider = RemoteWindowsWorkerProvider(_config(tmp_path), transport)
    target = provider.discover_environments()[0]
    transport.identity["bootId"] = "boot-2"
    with pytest.raises(BackendOperationError) as caught:
        provider.connect(target, _context())
    assert caught.value.code == "TARGET_LOST"


def test_action_transport_loss_is_never_safe_to_replay(tmp_path):
    transport = FakeTransport()
    provider = RemoteWindowsWorkerProvider(_config(tmp_path), transport)
    target = provider.discover_environments()[0]
    handle = provider.connect(target, _context())
    before = provider.observe(handle)
    transport.fail_action = True
    with pytest.raises(BackendOperationError) as caught:
        provider.perform(handle, {"action": "type", "text": "alpha"}, before.revision)
    assert caught.value.may_have_taken_effect is True
    assert caught.value.code == "ACTION_OUTCOME_UNKNOWN"


def test_cancel_crosses_transport_while_action_response_is_blocked(tmp_path):
    class BlockingTransport(FakeTransport):
        def __init__(self):
            super().__init__()
            self.action_entered = threading.Event()
            self.release_action = threading.Event()

        def request(self, method, path, body=None):
            if path == "/v1/actions":
                self.action_entered.set()
                assert self.release_action.wait(timeout=5)
            return super().request(method, path, body)

    transport = BlockingTransport()
    provider = RemoteWindowsWorkerProvider(_config(tmp_path), transport)
    target = provider.discover_environments()[0]
    handle = provider.connect(target, _context())
    before = provider.observe(handle)
    outcome = []
    worker = threading.Thread(target=lambda: outcome.append(provider.perform(
        handle, {"action": "type", "text": "alpha"}, before.revision,
    )))
    worker.start()
    assert transport.action_entered.wait(timeout=2)
    provider.cancel(handle, "test-cancel")
    assert any(path == "/v1/handles/cancel" for _, path, _ in transport.requests), (
        lifecycle.is_alive(), lifecycle_results, transport.requests
    )
    assert worker.is_alive()
    transport.release_action.set()
    worker.join(timeout=5)
    assert not worker.is_alive()
    assert len(outcome) == 1


def test_service_cancel_reaches_remote_worker_while_action_is_blocked(tmp_path):
    class BlockingTransport(FakeTransport):
        def __init__(self):
            super().__init__()
            self.action_entered = threading.Event()
            self.release_action = threading.Event()

        def request(self, method, path, body=None):
            if path == "/v1/actions":
                self.action_entered.set()
                assert self.release_action.wait(timeout=5)
            return super().request(method, path, body)

    transport = BlockingTransport()
    provider = RemoteWindowsWorkerProvider(_config(tmp_path), transport)
    target = provider.discover_environments()[0]
    service = ComputerUseService(
        router=BackendRouter([IsolatedDesktopBackend(provider)]),
    )
    results = []

    def execute(_request, channel):
        before = channel.observe()
        channel.perform(
            {"action": "type", "text": "alpha"},
            expected_revision=before.revision,
        )
        return R.ok({"status": "done"})

    worker = threading.Thread(target=lambda: results.append(service.run({
        "instruction": "remote action",
        "target": target.to_dict(),
        "requestId": "remote-service-cancel",
    }, execute)))
    worker.start()
    assert transport.action_entered.wait(timeout=2)

    cancelled = service.cancel({
        "requestId": "remote-service-cancel",
        "reason": "test-cancel",
    })

    assert cancelled["ok"] is True
    assert cancelled["data"]["status"] == "stopping"
    assert any(path == "/v1/handles/cancel" for _, path, _ in transport.requests)
    assert worker.is_alive()
    transport.release_action.set()
    worker.join(timeout=5)
    assert not worker.is_alive()
    assert results[0]["error"]["code"] == "CANCEL_PENDING"
    assert service.registry.snapshot_counts()["activeLeases"] == 0


@pytest.mark.parametrize("lifecycle_operation", ["force-release", "shutdown"])
def test_force_release_and_shutdown_cancel_before_waiting_for_remote_action(
    tmp_path, lifecycle_operation,
):
    class BlockingTransport(FakeTransport):
        def __init__(self):
            super().__init__()
            self.action_entered = threading.Event()
            self.release_action = threading.Event()

        def request(self, method, path, body=None):
            if path == "/v1/actions":
                self.action_entered.set()
                assert self.release_action.wait(timeout=5)
            return super().request(method, path, body)

    transport = BlockingTransport()
    provider = RemoteWindowsWorkerProvider(_config(tmp_path), transport)
    target = provider.discover_environments()[0]
    service = ComputerUseService(
        router=BackendRouter([IsolatedDesktopBackend(provider)]),
    )
    session_id = f"remote-{lifecycle_operation}-session"
    assert service.bind_session({
        "sessionId": session_id,
        "owner": {"runtimeId": "test", "threadId": lifecycle_operation},
        "target": target.to_dict(),
    })["ok"] is True
    run_results = []

    def execute(_request, channel):
        before = channel.observe()
        channel.perform(
            {"action": "type", "text": "alpha"},
            expected_revision=before.revision,
        )
        return R.ok({"status": "done"})

    runner = threading.Thread(target=lambda: run_results.append(service.run({
        "instruction": "remote lifecycle action",
        "sessionId": session_id,
        "requestId": f"remote-{lifecycle_operation}-request",
    }, execute)))
    runner.start()
    assert transport.action_entered.wait(timeout=2)
    lifecycle_results = []
    if lifecycle_operation == "force-release":
        operation = lambda: service.release_session({
            "sessionId": session_id,
            "reason": "test-force-release",
            "force": True,
        })
    else:
        operation = service.shutdown
    lifecycle = threading.Thread(target=lambda: lifecycle_results.append(operation()))
    lifecycle.start()

    deadline = time.monotonic() + 2
    while (
        not any(path == "/v1/handles/cancel" for _, path, _ in transport.requests)
        and time.monotonic() < deadline
    ):
        time.sleep(0.01)
    assert any(path == "/v1/handles/cancel" for _, path, _ in transport.requests)
    assert runner.is_alive()
    assert lifecycle.is_alive()

    transport.release_action.set()
    runner.join(timeout=5)
    lifecycle.join(timeout=5)
    assert not runner.is_alive()
    assert not lifecycle.is_alive()
    if lifecycle_operation == "force-release":
        assert lifecycle_results[0]["ok"] is True
    else:
        assert lifecycle_results[0]["cleanupComplete"] is True
    assert run_results[0]["error"]["code"] == "CANCEL_PENDING"
    assert service.registry.snapshot_counts()["activeLeases"] == 0
    assert service.cleanup_pending() == []


def test_uncertain_connect_recovers_same_request_handle_and_closes_it(tmp_path):
    class ReconcileTransport(FakeTransport):
        def __init__(self):
            super().__init__()
            self.created = None

        def request(self, method, path, body=None):
            body = dict(body or {})
            if path == "/v1/handles/connect":
                self.requests.append((method, path, body))
                self.created = body
                raise RemoteWorkerTransportError("REMOTE_WORKER_UNAVAILABLE", "response lost")
            if path == "/v1/handles/recover":
                self.requests.append((method, path, body))
                if body != self.created:
                    raise RemoteWorkerTransportError("CONNECT_IDENTITY_CONFLICT", "mismatch")
                return {
                    "status": "connected",
                    "identity": dict(self.identity),
                    "handleId": "handle-recovered",
                    "capabilityToken": "recovered-capability-token",
                }
            return super().request(method, path, body)

    transport = ReconcileTransport()
    provider = RemoteWindowsWorkerProvider(_config(tmp_path), transport)
    target = provider.discover_environments()[0]
    service = ComputerUseService(
        router=BackendRouter([IsolatedDesktopBackend(provider)]),
    )

    result = service.run({
        "instruction": "uncertain connect",
        "target": target.to_dict(),
        "requestId": "remote-connect-uncertain",
    }, lambda _request, _channel: R.ok({"status": "incorrect"}))

    assert result["error"]["code"] == "CLEANUP_INCOMPLETE"
    assert service.registry.snapshot_counts()["activeLeases"] == 1
    reaped = service.reap_once()
    assert reaped["cleanedRequests"] == ["remote-connect-uncertain"]
    assert service.registry.snapshot_counts()["activeLeases"] == 0
    assert any(path == "/v1/handles/close" for _, path, _ in transport.requests)
    connect = next(body for _, path, body in transport.requests if path == "/v1/handles/connect")
    recover = next(body for _, path, body in transport.requests if path == "/v1/handles/recover")
    assert recover == connect


def test_recover_connect_conflict_and_unknown_state_keep_quarantine(tmp_path):
    class ConflictTransport(FakeTransport):
        def request(self, method, path, body=None):
            if path == "/v1/handles/recover":
                raise RemoteWorkerTransportError("CONNECT_IDENTITY_CONFLICT", "mismatch")
            return super().request(method, path, body)

    provider = RemoteWindowsWorkerProvider(_config(tmp_path), ConflictTransport())
    target = provider.discover_environments()[0]
    with pytest.raises(BackendOperationError) as conflict:
        provider.recover_connect(target, _context())
    assert conflict.value.code == "CONNECT_IDENTITY_CONFLICT"
    assert conflict.value.safe_to_retry is False

    class UnknownTransport(FakeTransport):
        def request(self, method, path, body=None):
            if path == "/v1/handles/recover":
                return {"status": "unknown", "identity": dict(self.identity)}
            return super().request(method, path, body)

    provider = RemoteWindowsWorkerProvider(_config(tmp_path), UnknownTransport())
    target = provider.discover_environments()[0]
    with pytest.raises(BackendOperationError) as unknown:
        provider.recover_connect(target, _context())
    assert unknown.value.code == "OPEN_OUTCOME_UNKNOWN"
    assert unknown.value.safe_to_retry is False


def test_recover_connect_not_created_is_the_only_safe_retry_result(tmp_path):
    class NotCreatedTransport(FakeTransport):
        def request(self, method, path, body=None):
            if path == "/v1/handles/recover":
                return {"status": "not-created", "identity": dict(self.identity)}
            return super().request(method, path, body)

    provider = RemoteWindowsWorkerProvider(_config(tmp_path), NotCreatedTransport())
    target = provider.discover_environments()[0]
    with pytest.raises(BackendOperationError) as caught:
        provider.recover_connect(target, _context())
    assert caught.value.code == "OPEN_NOT_CREATED"
    assert caught.value.safe_to_retry is True


def test_managed_lifecycle_is_explicitly_unavailable(tmp_path):
    provider = RemoteWindowsWorkerProvider(_config(tmp_path), FakeTransport())
    with pytest.raises(BackendOperationError) as provision:
        provider.provision({})
    assert provision.value.code == REMOTE_WORKER_MANAGED_UNAVAILABLE
    target = provider.discover_environments()[0]
    with pytest.raises(BackendOperationError) as destroy:
        provider.destroy(target, "test")
    assert destroy.value.code == REMOTE_WORKER_MANAGED_UNAVAILABLE


class FakeResponse:
    def __init__(self, status_code, chunks):
        self.status_code = status_code
        self._chunks = chunks
        self.closed = False

    def iter_content(self, chunk_size):
        yield from self._chunks

    def close(self):
        self.closed = True


def test_http_transport_rejects_redirect_and_oversized_body(tmp_path):
    config = _config(tmp_path, max_response_bytes=1_024)
    redirect = FakeResponse(302, [b""])
    transport = RequestsRemoteWorkerTransport(config, sender=lambda *a, **k: redirect)
    with pytest.raises(RemoteWorkerTransportError) as redirected:
        transport.request("GET", "/v1/status")
    assert redirected.value.code == "REMOTE_WORKER_REDIRECT"
    assert redirect.closed is True

    oversized = FakeResponse(200, [b"x" * 1_025])
    transport = RequestsRemoteWorkerTransport(config, sender=lambda *a, **k: oversized)
    with pytest.raises(RemoteWorkerTransportError) as too_large:
        transport.request("GET", "/v1/status")
    assert too_large.value.code == "REMOTE_WORKER_RESPONSE_TOO_LARGE"
    assert oversized.closed is True


def test_http_transport_rejects_non_allowlisted_route(tmp_path):
    transport = RequestsRemoteWorkerTransport(
        _config(tmp_path), sender=lambda *a, **k: pytest.fail("network must not be called"),
    )
    with pytest.raises(RemoteWorkerTransportError) as caught:
        transport.request("GET", "/v1/arbitrary")
    assert caught.value.code == "REMOTE_WORKER_PROTOCOL_ERROR"
