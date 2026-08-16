from __future__ import annotations

import base64
import hashlib
import hmac
import json
import threading
import time
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from types import SimpleNamespace

from cua.invocation_proof import InvocationProofVerifier, argument_digest, proof_message
from cua.server import Handler
from cua.service import ComputerUseService


def _proof(arguments: dict, *, secret: str = "proof-secret") -> str:
    now = int(time.time() * 1000)
    value = {
        "version": 1, "proofId": "proof-http-1", "requestId": "request-http-1",
        "runtimeId": "codex", "threadId": "thread-1", "turnId": "turn-1",
        "callId": "call-1", "invocationId": "invocation-1", "tool": "computer_use",
        "argumentDigest": argument_digest(arguments), "issuedAtMs": now - 10,
        "expiresAtMs": now + 60_000, "nonce": "nonce-http-1",
        "approval": "confirmation", "signature": "",
    }
    value["signature"] = hmac.new(
        secret.encode(), proof_message(value).encode(), hashlib.sha256
    ).hexdigest()
    return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")


def _post(port: int, body: dict, proof: str) -> tuple[int, dict]:
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/computer-use/run",
        data=json.dumps(body).encode(), method="POST",
        headers={
            "Authorization": "Bearer service-token",
            "Content-Type": "application/json",
            "X-Sciforge-CUA-Invocation": proof,
        },
    )
    try:
        response = urllib.request.urlopen(request, timeout=3)
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())
    with response:
        return response.status, json.loads(response.read())


def test_http_boundary_rejects_argument_forgery_and_replay():
    class TestHandler(Handler):
        service = ComputerUseService()
        config = SimpleNamespace(service_token="service-token")
        verifier = InvocationProofVerifier("proof-secret", not_before_ms=0)

    server = ThreadingHTTPServer(("127.0.0.1", 0), TestHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        body = {
            "requestId": "request-http-1", "sessionId": "missing-session",
            "semanticAction": {"kind": "observe"}, "execute": True,
        }
        signed_arguments = dict(body)
        signed_arguments.pop("requestId")
        proof = _proof(signed_arguments)
        status, first = _post(server.server_port, body, proof)
        assert status == 400 and first["error"]["code"] == "SESSION_NOT_FOUND"
        status, replay = _post(server.server_port, body, proof)
        assert status == 400 or status == 403
        assert replay["error"]["code"] == "APPROVAL_PROOF_REPLAYED"

        changed = dict(body)
        changed["sessionId"] = "different-session"
        status, forged = _post(server.server_port, changed, _proof(signed_arguments))
        assert status == 403
        assert forged["error"]["code"] == "INVOCATION_IDENTITY_MISMATCH"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)
