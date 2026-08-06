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


def _post(port, path, body, proof=None):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    headers = {"Content-Type": "application/json"}
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
