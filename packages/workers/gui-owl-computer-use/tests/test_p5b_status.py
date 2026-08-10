import threading

from cua.invocation_proof import InvocationIdentity
from cua.service import ComputerUseService
from driver.router import BackendRouter
from tests.fakes.fake_backend import FakeBackend


def _target():
    return {
        "targetId": "target-status-1",
        "kind": "windows-uia",
        "locator": {"processId": 1234, "automationId": "Editor"},
    }


def _invocation():
    return InvocationIdentity(
        proof_id="proof-1",
        request_id="request-status-1",
        runtime_id="codex",
        thread_id="thread-1",
        turn_id="turn-1",
        call_id="call-1",
        invocation_id="invocation-1",
        tool="computer_use",
    )


def test_status_projects_live_identity_isolation_and_verification_without_secrets():
    backend = FakeBackend()
    service = ComputerUseService(
        router=BackendRouter([backend]),
        server_instance_id="instance-status-1",
    )
    invocation = _invocation()
    bound = service.bind_session(
        {"sessionId": "session-status-1", "target": _target()},
        invocation=invocation,
    )
    assert bound["ok"] is True
    performing = threading.Event()
    release = threading.Event()
    result = {}

    def execute(_request, channel):
        observed = channel.observe()
        outcome = channel.perform(
            {"action": "write", "value": "not-in-status"},
            expected_revision=observed.revision,
        )
        performing.set()
        assert release.wait(2)
        return {"ok": True, "data": {"verification": outcome.verification.value}}

    thread = threading.Thread(
        target=lambda: result.update(service.run(
            {
                "instruction": "write secret instruction",
                "sessionId": "session-status-1",
                "requestedIsolation": "host-app-scoped",
            },
            execute,
            invocation=invocation,
        )),
    )
    thread.start()
    assert performing.wait(2)

    status = service.status()
    active = status["active"][0]
    assert status["serverInstanceId"] == "instance-status-1"
    assert status["registry"]["generation"] > 0
    assert active == {
        "sessionId": "session-status-1",
        "requestId": "request-status-1",
        "targetId": "target-status-1",
        "leaseId": active["leaseId"],
        "runtimeId": "codex",
        "threadId": "thread-1",
        "turnId": "turn-1",
        "backend": "windows-uia",
        "leaseScope": "target",
        "requestedIsolation": "host-app-scoped",
        "effectiveIsolation": "host-app-scoped",
        "degraded": False,
        "degradedReason": None,
        "verification": "verified",
        "state": "running",
        "updatedAt": active["updatedAt"],
    }
    assert "secret instruction" not in str(status)
    assert "not-in-status" not in str(status)

    release.set()
    thread.join(2)
    assert not thread.is_alive()
    assert result["ok"] is True
    assert service.status()["active"] == []


def test_status_rejections_are_bounded_and_cleanup_context_does_not_leak():
    service = ComputerUseService(
        router=BackendRouter([]),
        server_instance_id="instance-status-2",
    )
    for index in range(25):
        result = service.run(
            {"instruction": "x", "requestId": f"request-{index}"},
            lambda _request, _channel: {"ok": True},
        )
        assert result["ok"] is False
    status = service.status()
    assert len(status["recentRejections"]) == 20
    assert status["active"] == []
    assert service._request_contexts == {}


def test_capabilities_exposes_sanitized_zero_resource_counts():
    service = ComputerUseService(
        router=BackendRouter([]),
        server_instance_id="instance-capabilities-runtime",
    )

    runtime = service.capabilities()["runtime"]

    assert runtime == {
        "counts": {
            "sessions": 0,
            "requests": 0,
            "activeLeases": 0,
            "tombstones": 0,
            "releasedLeaseTombstones": 0,
        },
        "activeChannels": 0,
        "activeRequests": 0,
        "cleanupPending": 0,
        "waiters": 0,
        "backendHandles": 0,
    }
