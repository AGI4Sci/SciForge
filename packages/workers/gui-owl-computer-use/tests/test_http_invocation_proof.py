from __future__ import annotations

import base64
import hashlib
import hmac
import http.client
import json
import threading
import time
from driver.router import BackendRouter

from cua import server as server_module
from cua.config import Config
from cua.invocation_proof import InvocationProofVerifier, argument_digest, proof_message
from cua.service import ComputerUseService


SECRET = "http-proof-secret"


def _proof(tool, arguments, *, request_id="proof-request-1", proof_id="proof-1"):
    now = int(time.time() * 1000)
    proof = {
        "version": 1,
        "proofId": proof_id,
        "requestId": request_id,
        "runtimeId": "codex",
        "threadId": "thread-1",
        "turnId": "turn-1",
        "callId": "call-1",
        "invocationId": f"invocation-{proof_id}",
        "tool": tool,
        "argumentDigest": argument_digest(arguments),
        "issuedAtMs": now,
        "expiresAtMs": now + 30_000,
        "nonce": f"nonce-{proof_id}",
        "approval": "confirmation",
    }
    proof["signature"] = hmac.new(
        SECRET.encode(), proof_message(proof).encode(), hashlib.sha256,
    ).hexdigest()
    return base64.urlsafe_b64encode(
        json.dumps(proof, separators=(",", ":")).encode()
    ).decode().rstrip("=")


def _post(port, path, body, proof=None, token=None):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if proof:
        headers["X-Sciforge-CUA-Invocation"] = proof
    connection.request("POST", path, json.dumps(body), headers)
    response = connection.getresponse()
    payload = json.loads(response.read())
    connection.close()
    return response.status, payload


def _get(port, path, token=None):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    connection.request("GET", path, headers=headers)
    response = connection.getresponse()
    payload = json.loads(response.read())
    connection.close()
    return response.status, payload


def test_http_mutations_require_proof_derive_owner_and_reject_replay(monkeypatch):
    service = ComputerUseService(router=BackendRouter([]))
    service.configure_approval_proof("required")
    verifier = InvocationProofVerifier(SECRET, mode="required")
    config = Config(service_token="", allow_execute=False)
    httpd = server_module.create_http_server(
        service, config, verifier, executor=lambda *_args, **_kwargs: {"ok": True},
        address=("127.0.0.1", 0),
    )
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        run_body = {
            "instruction": "must not run",
            "execute": True,
            "approve": True,
            "requestId": "untrusted-request-1",
        }
        status, payload = _post(httpd.server_port, "/computer-use/run", run_body)
        assert status == 403
        assert payload["error"]["code"] == "APPROVAL_PROOF_REQUIRED"

        bind_body = {
            "sessionId": "session-1",
            "target": {
                "targetId": "target-1",
                "kind": "static-image",
                "locator": {"imageRef": "image-1"},
            },
        }
        encoded = _proof("computer_use_bind_target", bind_body)
        status, payload = _post(
            httpd.server_port, "/computer-use/sessions/bind", bind_body, encoded,
        )
        assert status == 200
        assert payload["data"]["sessionId"] == "session-1"
        owner = service.registry.get_session("session-1").owner
        assert (owner.runtime_id, owner.thread_id) == ("codex", "thread-1")

        status, payload = _post(
            httpd.server_port, "/computer-use/sessions/bind", bind_body, encoded,
        )
        assert status == 403
        assert payload["error"]["code"] == "APPROVAL_PROOF_REPLAYED"
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=5)


def test_dynamic_status_get_reuses_sidecar_bearer_auth(monkeypatch):
    service = ComputerUseService(router=BackendRouter([]), server_instance_id="instance-http-1")
    config = Config(service_token="status-token", allow_execute=False)
    verifier = InvocationProofVerifier(SECRET, mode="required")
    httpd = server_module.create_http_server(
        service, config, verifier, address=("127.0.0.1", 0),
    )
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        status, payload = _get(httpd.server_port, "/computer-use/status")
        assert status == 401
        assert payload["error"]["code"] == "UNAUTHENTICATED"

        status, payload = _get(
            httpd.server_port, "/computer-use/status", token="status-token",
        )
        assert status == 200
        assert payload["data"]["serverInstanceId"] == "instance-http-1"
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=5)


def test_cdp_adapter_registration_requires_bearer_and_clears_only_matching_owner():
    from driver.backends.cdp_adapter import CdpAdapterBackend

    backend = CdpAdapterBackend(adapter_url="", token="")
    service = ComputerUseService(router=BackendRouter([backend]))
    config = Config(service_token="sidecar-token", allow_execute=False)
    verifier = InvocationProofVerifier(SECRET, mode="required")
    httpd = server_module.create_http_server(
        service, config, verifier, address=("127.0.0.1", 0),
    )
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    adapter_url = "http://127.0.0.1:41234"
    adapter_token = "a" * 32
    try:
        status, payload = _post(
            httpd.server_port, "/computer-use/backends/cdp/configure",
            {"adapterUrl": adapter_url, "adapterToken": adapter_token},
        )
        assert status == 401
        assert payload["error"]["code"] == "UNAUTHENTICATED"

        status, payload = _post(
            httpd.server_port, "/computer-use/backends/cdp/configure",
            {"adapterUrl": adapter_url, "adapterToken": adapter_token},
            token="sidecar-token",
        )
        assert status == 200
        assert payload["data"]["configured"] is True
        assert backend._configuration() == (adapter_url, adapter_token)

        _post(
            httpd.server_port, "/computer-use/backends/cdp/configure",
            {"adapterUrl": "", "adapterToken": "", "expectedAdapterUrl": "http://127.0.0.1:49999"},
            token="sidecar-token",
        )
        assert backend._configuration() == (adapter_url, adapter_token)

        status, payload = _post(
            httpd.server_port, "/computer-use/backends/cdp/configure",
            {"adapterUrl": "", "adapterToken": "", "expectedAdapterUrl": adapter_url},
            token="sidecar-token",
        )
        assert status == 200
        assert payload["data"]["cleared"] is True
        assert backend._configuration() == ("", "")
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=5)


def test_model_access_bridge_registration_requires_bearer_and_clears_only_owner():
    service = ComputerUseService(router=BackendRouter([]))
    config = Config(service_token="sidecar-token", allow_execute=False)
    original = (
        config.model_router_base_url,
        config.model_router_api_key,
        config.model_router_model,
    )
    verifier = InvocationProofVerifier(SECRET, mode="required")
    httpd = server_module.create_http_server(
        service, config, verifier, address=("127.0.0.1", 0),
    )
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    bridge_url = "http://127.0.0.1:41235/v1"
    try:
        status, payload = _post(
            httpd.server_port, "/computer-use/model-access/configure",
            {"baseUrl": bridge_url, "apiKey": "a" * 32, "model": "planner"},
        )
        assert status == 401
        assert payload["error"]["code"] == "UNAUTHENTICATED"

        status, payload = _post(
            httpd.server_port, "/computer-use/model-access/configure",
            {"baseUrl": bridge_url, "apiKey": "a" * 32, "model": "planner"},
            token="sidecar-token",
        )
        assert status == 200
        assert payload["data"]["configured"] is True
        assert config.model_router_base_url == bridge_url
        assert config.model_router_api_key == "a" * 32
        assert config.model_router_model == "planner"

        _post(
            httpd.server_port, "/computer-use/model-access/configure",
            {"baseUrl": "", "apiKey": "", "model": "", "expectedBaseUrl": "http://127.0.0.1:49999/v1"},
            token="sidecar-token",
        )
        assert config.model_router_base_url == bridge_url

        status, payload = _post(
            httpd.server_port, "/computer-use/model-access/configure",
            {"baseUrl": "", "apiKey": "", "model": "", "expectedBaseUrl": bridge_url},
            token="sidecar-token",
        )
        assert status == 200
        assert payload["data"]["cleared"] is True
        assert config.model_router_base_url == ""
        assert config.model_router_api_key == ""
        assert config.model_router_model == ""
    finally:
        (
            config.model_router_base_url,
            config.model_router_api_key,
            config.model_router_model,
        ) = original
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=5)


def test_http_proof_capacity_fails_closed_with_stable_error_code():
    service = ComputerUseService(router=BackendRouter([]))
    service.configure_approval_proof("required")
    verifier = InvocationProofVerifier(SECRET, mode="required", max_entries=1)
    config = Config(service_token="", allow_execute=False)
    httpd = server_module.create_http_server(
        service, config, verifier, address=("127.0.0.1", 0),
    )
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        first_body = {
            "sessionId": "capacity-session-1",
            "target": {
                "targetId": "capacity-target-1",
                "kind": "static-image",
                "locator": {"imageRef": "capacity-image-1"},
            },
        }
        first_status, first_payload = _post(
            httpd.server_port,
            "/computer-use/sessions/bind",
            first_body,
            _proof("computer_use_bind_target", first_body, proof_id="capacity-1"),
        )
        assert first_status == 200
        assert first_payload["ok"] is True

        second_body = {
            "sessionId": "capacity-session-2",
            "target": {
                "targetId": "capacity-target-2",
                "kind": "static-image",
                "locator": {"imageRef": "capacity-image-2"},
            },
        }
        second_status, second_payload = _post(
            httpd.server_port,
            "/computer-use/sessions/bind",
            second_body,
            _proof("computer_use_bind_target", second_body, proof_id="capacity-2"),
        )
        assert second_status == 403
        assert second_payload["error"]["code"] == "APPROVAL_PROOF_CAPACITY"
        assert second_payload["error"]["retryable"] is False
        assert second_payload["error"]["failureClass"] == "permission"
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=5)
