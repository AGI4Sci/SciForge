from __future__ import annotations

import base64
import hashlib
import hmac
import http.client
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from cua import runner, server
from cua.config import Config
from cua.invocation_proof import InvocationProofVerifier, argument_digest, proof_message
from cua.service import ComputerUseService
from driver.router import BackendRouter
from tests.fakes.fake_backend import FakeBackend


SECRET = "p5c-test-only-secret"
TOKEN = "p5c-test-only-token"


def _proof(tool, arguments, *, request_id, identity, proof_id):
    now = int(time.time() * 1000)
    proof = {
        "version": 1,
        "proofId": proof_id,
        "requestId": request_id,
        "runtimeId": f"runtime-{identity}",
        "threadId": f"thread-{identity}",
        "turnId": f"turn-{identity}",
        "callId": f"call-{identity}",
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
        json.dumps(proof, separators=(",", ":")).encode(),
    ).decode().rstrip("=")


def _post(port, path, body, proof, *, token=TOKEN):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "X-Sciforge-CUA-Invocation": proof,
    }
    connection.request("POST", path, json.dumps(body), headers)
    response = connection.getresponse()
    payload = json.loads(response.read())
    connection.close()
    return response.status, payload


def _target(identity):
    return {
        "targetId": f"target-{identity}",
        "kind": "windows-uia",
        "locator": {"processId": 1000 + ord(identity), "automationId": f"Editor-{identity}"},
    }


def test_three_session_http_service_runner_chain_isolates_failure_cancel_and_success(
    monkeypatch, tmp_path,
):
    first_model_barrier = threading.Barrier(3)
    b_waiting = threading.Event()
    release_b = threading.Event()
    calls: dict[str, int] = {}
    calls_lock = threading.Lock()

    def deterministic_owl(_base, _model, _key, messages, **_kwargs):
        serialized = json.dumps(messages)
        identity = next(item for item in "ABC" if f"task-{item}" in serialized)
        with calls_lock:
            calls[identity] = calls.get(identity, 0) + 1
            number = calls[identity]
        if number == 1:
            first_model_barrier.wait(timeout=5)
            if identity == "B":
                b_waiting.set()
                assert release_b.wait(5)
            action_payload = {
                "name": "computer_use",
                "arguments": {"action": "type", "text": f"value-{identity}"},
            }
            return f"<tool_call>{json.dumps(action_payload)}</tool_call>"
        return '<tool_call>{"name":"computer_use","arguments":{"action":"answer","text":"done"}}</tool_call>'

    monkeypatch.setattr(runner.owl_agent, "call_owl", deterministic_owl)
    backend = FakeBackend(fail_action_target="target-A", actions=("observe", "type"))
    service = ComputerUseService(
        router=BackendRouter([backend]), server_instance_id="p5c-instance",
    )
    service.configure_approval_proof("required")
    config = Config(
        allow_execute=True,
        service_token=TOKEN,
        invocation_secret=SECRET,
        invocation_proof_mode="required",
        artifact_dir=str(tmp_path),
        max_steps=3,
        show_overlay=False,
        reflect=False,
        settle_s=0,
    )
    verifier = InvocationProofVerifier(SECRET, mode="required")
    httpd = server.create_http_server(
        service, config, verifier, runner.run_task, address=("127.0.0.1", 0),
    )
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    port = httpd.server_port
    try:
        for identity in "ABC":
            body = {"sessionId": f"session-{identity}", "target": _target(identity)}
            proof = _proof(
                "computer_use_bind_target", body,
                request_id=f"bind-{identity}", identity=identity, proof_id=f"bind-{identity}",
            )
            status, payload = _post(port, "/computer-use/sessions/bind", body, proof)
            assert status == 200 and payload["ok"] is True

        def run(identity):
            arguments = {
                "instruction": f"task-{identity}",
                "sessionId": f"session-{identity}",
                "requestedIsolation": "host-app-scoped",
                "execute": True,
            }
            request_id = f"request-{identity}"
            body = {**arguments, "requestId": request_id}
            proof = _proof(
                "computer_use", arguments,
                request_id=request_id, identity=identity, proof_id=f"run-{identity}",
            )
            return _post(port, "/computer-use/run", body, proof)

        with ThreadPoolExecutor(max_workers=3) as pool:
            futures = {identity: pool.submit(run, identity) for identity in "ABC"}
            assert b_waiting.wait(5)
            cancel_body = {"requestId": "request-B", "reason": "p5c-controlled-cancel"}
            cancel_proof = _proof(
                "computer_use_cancel", cancel_body,
                request_id="cancel-B", identity="B", proof_id="cancel-B",
            )
            cancel_status, cancel_payload = _post(
                port, "/computer-use/cancel", cancel_body, cancel_proof,
            )
            assert cancel_status == 200
            assert cancel_payload["data"]["status"] == "stopping"
            release_b.set()
            results = {identity: future.result(timeout=10) for identity, future in futures.items()}

        assert results["A"][1].get("error", {}).get("code") == "ACTION_OUTCOME_UNKNOWN", (
            results, backend.action_log, backend.read("target-A")
        )
        assert results["A"][1]["error"]["retryable"] is False
        assert results["B"][1]["error"]["code"] == "CANCEL_PENDING"
        assert results["C"][1]["ok"] is True
        assert results["C"][1]["data"]["status"] == "agent_reported_done"
        assert backend.read("target-A") == ()
        assert backend.read("target-B") == ()
        assert backend.read("target-C") == ("value-C",)

        serialized_evidence = json.dumps(results) + json.dumps(service.status())
        assert SECRET not in serialized_evidence
        assert TOKEN not in serialized_evidence
        for identity in "ABC":
            manifest_path = tmp_path / f"request-{identity}" / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            assert manifest["requestId"] == f"request-{identity}"
            assert manifest["sessionId"] == f"session-{identity}"
            assert manifest["targetId"] == f"target-{identity}"
            assert SECRET not in json.dumps(manifest)

        assert service.registry.snapshot_counts()["requests"] == 0
        assert service.registry.snapshot_counts()["activeLeases"] == 0
        assert service.status()["activeChannels"] == 0
        assert backend.open_handle_count == 0

        for identity in "ABC":
            body = {"sessionId": f"session-{identity}", "reason": "p5c-finished"}
            proof = _proof(
                "computer_use_release_session", body,
                request_id=f"release-{identity}", identity=identity,
                proof_id=f"release-{identity}",
            )
            status, payload = _post(port, "/computer-use/sessions/release", body, proof)
            assert status == 200 and payload["ok"] is True
        assert service.registry.snapshot_counts()["sessions"] == 0
    finally:
        release_b.set()
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=5)
        assert not thread.is_alive()


def test_http_rejects_bad_json_large_body_auth_and_unimplemented_queue(tmp_path):
    backend = FakeBackend()
    service = ComputerUseService(router=BackendRouter([backend]))
    config = Config(service_token=TOKEN, artifact_dir=str(tmp_path), allow_execute=False)
    verifier = InvocationProofVerifier(SECRET, mode="required")
    httpd = server.create_http_server(
        service, config, verifier, executor=lambda *_args, **_kwargs: {"ok": True},
        address=("127.0.0.1", 0),
    )
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        connection = http.client.HTTPConnection("127.0.0.1", httpd.server_port, timeout=5)
        connection.request("POST", "/computer-use/run", "{", {
            "Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json",
        })
        response = connection.getresponse()
        assert response.status == 400
        assert json.loads(response.read())["error"]["code"] == "INVALID_ARGUMENT"
        connection.close()

        connection = http.client.HTTPConnection("127.0.0.1", httpd.server_port, timeout=5)
        connection.request("POST", "/computer-use/run", "{}", {
            "Content-Length": str(1_048_577), "Authorization": f"Bearer {TOKEN}",
        })
        response = connection.getresponse()
        assert response.status == 413
        response.read()
        connection.close()

        status, payload = _post(
            httpd.server_port, "/computer-use/run", {}, "invalid-proof", token="wrong",
        )
        assert status == 401 and payload["error"]["code"] == "UNAUTHENTICATED"

        queued = service.run(
            {"instruction": "x", "queueIfBusy": True},
            lambda *_args: {"ok": True},
        )
        assert queued["error"]["code"] == "QUEUE_NOT_SUPPORTED"
        assert queued["error"]["retryable"] is False
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=5)
