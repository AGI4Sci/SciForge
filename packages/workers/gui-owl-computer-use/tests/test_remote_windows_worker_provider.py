from __future__ import annotations

import base64
import io
import threading
from dataclasses import replace

import pytest
from PIL import Image

from cua.capabilities import Verification
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
    assert any(path == "/v1/handles/cancel" for _, path, _ in transport.requests)
    assert worker.is_alive()
    transport.release_action.set()
    worker.join(timeout=5)
    assert not worker.is_alive()
    assert len(outcome) == 1


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
