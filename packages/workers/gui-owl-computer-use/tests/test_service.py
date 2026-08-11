import threading
import time
from datetime import datetime, timezone

from cua.capabilities import BackendId
from cua.service import ComputerUseService
from cua.target import TargetKind, parse_target_descriptor
from driver.router import BackendRouter
from tests.fakes.fake_backend import FakeBackend


def _iso(value):
    return datetime.fromtimestamp(value, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def uia_target(target_id="target-uia-1"):
    return {
        "targetId": target_id,
        "kind": "windows-uia",
        "locator": {"processId": 1234, "automationId": "Editor"},
        "metadata": {"title": "secret document", "processName": "app.exe"},
    }


def test_service_preserves_v1_and_fails_v2_closed():
    service = ComputerUseService()
    calls = []
    result = service.run(
        {"instruction": "legacy"},
        lambda request, _channel: calls.append(request) or {"ok": True},
    )
    assert result == {"ok": True}
    assert calls[0]["protocolVersion"] == 1
    missing = service.run(
        {"instruction": "targeted", "sessionId": "session-1"},
        lambda _request, _channel: (_ for _ in ()).throw(AssertionError("must not execute")),
    )
    assert missing["error"]["code"] == "SESSION_NOT_FOUND"


def test_bind_status_duplicate_and_release_lifecycle():
    service = ComputerUseService()
    value = {
        "sessionId": "session-1",
        "owner": {"runtimeId": "runtime-1", "threadId": "thread-1"},
        "target": uia_target(),
    }
    bound = service.bind_session(value)
    assert bound["ok"] is True
    assert bound["data"]["target"]["metadata"]["title"] == "<redacted>"
    duplicate = service.bind_session(value)
    assert duplicate["error"]["code"] == "SESSION_ID_CONFLICT"
    status = service.status()
    assert status["approvalProof"] == "legacy-trust-boundary"
    assert status["registry"]["counts"]["sessions"] == 1
    released = service.release_session({"sessionId": "session-1"})
    assert released["ok"] is True
    assert service.status()["registry"]["counts"]["sessions"] == 0


def test_bind_resolves_redacted_public_target_to_current_canonical_locator():
    backend = FakeBackend(
        backend_id=BackendId.BROWSER_CDP,
        target_kinds=(TargetKind.BROWSER_PAGE,),
    )
    canonical = parse_target_descriptor({
        "targetId": "cdp:managed:alpha",
        "kind": "browser-page",
        "ownership": "attached",
        "generation": "generation-1",
        "locator": {
            "cdpEndpoint": "http://127.0.0.1:9222",
            "cdpTargetId": "page-alpha",
        },
        "metadata": {
            "title": "private page title",
            "url": "http://127.0.0.1/private",
            "publicLabel": "Managed Alpha",
        },
    })
    backend.discover_targets = lambda _filters=None: [canonical]
    service = ComputerUseService(router=BackendRouter([backend]))
    public = service.list_targets()["targets"][0]

    assert public["locator"]["cdpEndpoint"] == "<redacted>"
    assert public["metadata"] == {
        "title": "<redacted>",
        "url": "<redacted>",
        "publicLabel": "Managed Alpha",
    }
    bound = service.bind_session({
        "sessionId": "session-public-alpha",
        "owner": {"runtimeId": "runtime-1", "threadId": "thread-1"},
        "target": public,
    })

    assert bound["ok"] is True
    stored = service.registry.get_session("session-public-alpha")
    assert stored.target.locator["cdpEndpoint"] == "http://127.0.0.1:9222"


def test_service_rejects_request_id_path_attack_before_legacy_executor():
    service = ComputerUseService()
    result = service.run(
        {"instruction": "x", "requestId": "../escape"},
        lambda _request, _channel: (_ for _ in ()).throw(AssertionError("must not execute")),
    )
    assert result["error"]["code"] == "INVALID_ARGUMENT"


def test_v2_bound_session_executes_through_channel_and_cleans_request_and_lease():
    backend = FakeBackend()
    service = ComputerUseService(router=BackendRouter([backend]))
    service.bind_session({
        "sessionId": "session-1",
        "owner": {"runtimeId": "runtime-1", "threadId": "thread-1"},
        "target": uia_target(),
    })

    def execute(request, channel):
        observed = channel.observe()
        outcome = channel.perform(
            {"action": "write", "value": "value"},
            expected_revision=observed.revision,
        )
        return {"ok": True, "data": {"status": "done", "verified": outcome.verification.value}}

    result = service.run(
        {"instruction": "write", "sessionId": "session-1", "requestId": "request-1"},
        execute,
    )
    assert result["ok"] is True
    assert result["data"]["verified"] == "verified"
    assert backend.read("target-uia-1") == ("value",)
    counts = service.registry.snapshot_counts()
    assert counts["requests"] == counts["activeLeases"] == 0
    assert counts["sessions"] == 1


def test_deadline_ms_expires_at_channel_boundary_and_releases_all_active_resources():
    backend = FakeBackend()
    service = ComputerUseService(router=BackendRouter([backend]))
    service.bind_session({
        "sessionId": "session-deadline",
        "owner": {"runtimeId": "runtime-1", "threadId": "thread-1"},
        "target": uia_target("target-deadline"),
    })

    def execute(_request, channel):
        time.sleep(0.01)
        channel.observe()
        raise AssertionError("expired channel must not observe")

    result = service.run({
        "instruction": "expire",
        "sessionId": "session-deadline",
        "requestId": "request-deadline",
        "deadlineMs": 1,
    }, execute)
    assert result["error"]["code"] == "TIMEOUT"
    assert result["error"]["retryable"] is True
    counts = service.registry.snapshot_counts()
    assert counts["requests"] == counts["activeLeases"] == 0
    assert backend.open_handle_count == 0


def test_parallel_batch_overlaps_distinct_targets_and_isolates_one_timeout():
    backend = FakeBackend()
    service = ComputerUseService(router=BackendRouter([backend]))
    for label in ("alpha", "beta", "delta"):
        service.bind_session({
            "sessionId": f"session-{label}",
            "owner": {"runtimeId": "runtime-1", "threadId": "thread-1"},
            "target": uia_target(f"target-{label}"),
        })
    successful_overlap = threading.Barrier(2)

    def execute(request, channel):
        if request["instruction"] == "timeout":
            time.sleep(0.02)
            channel.observe()
            raise AssertionError("expired child must not observe")
        observed = channel.observe()
        action_started = time.time()
        successful_overlap.wait(timeout=1)
        time.sleep(0.01)
        outcome = channel.perform(
            {"action": "write", "value": request["instruction"]},
            expected_revision=observed.revision,
        )
        action_completed = time.time()
        return {"ok": True, "data": {
            "status": "done",
            "steps": [{
                "step": 0,
                "timeline": {
                    "actionStartedAt": _iso(action_started),
                    "actionCompletedAt": _iso(action_completed),
                },
                "outcome": outcome.to_dict(),
            }],
            "finalObservation": {"revision": "fake:1"},
        }}

    result = service.run_batch({
        "instruction": "bounded parallel verification",
        "parallel": [
            {"instruction": "alpha", "sessionId": "session-alpha"},
            {"instruction": "beta", "sessionId": "session-beta"},
            {"instruction": "timeout", "sessionId": "session-delta", "deadlineMs": 1},
        ],
    }, execute)

    assert result["ok"] is True
    assert result["data"]["successCount"] == 2
    assert result["data"]["failureCount"] == 1
    concurrency = result["data"]["concurrencyEvidence"]
    assert concurrency["commonExecutionOverlapMs"] >= 0
    assert concurrency["maxCrossSessionActionOverlapMs"] > 0
    assert len(concurrency["maxCrossSessionActionOverlapPair"]) == 2
    assert [child["sessionId"] for child in concurrency["children"]] == [
        "session-alpha", "session-beta", "session-delta",
    ]
    alpha_action = concurrency["children"][0]["actionSpans"][0]
    assert alpha_action["committed"] is True
    assert alpha_action["verification"] == "verified"
    assert alpha_action["startedAt"] <= alpha_action["completedAt"]
    assert concurrency["children"][2]["errorCode"] == "TIMEOUT"
    children = result["data"]["results"]
    assert [item["targetId"] for item in children] == [
        "target-alpha", "target-beta", "target-delta",
    ]
    assert children[2]["result"]["error"]["code"] == "TIMEOUT"
    assert backend.read("target-alpha") == ("alpha",)
    assert backend.read("target-beta") == ("beta",)
    assert backend.read("target-delta") == ()
    counts = service.registry.snapshot_counts()
    assert counts["requests"] == counts["activeLeases"] == 0
    assert counts["sessions"] == 3
    assert backend.open_handle_count == 0


def test_parallel_batch_rejects_two_sessions_bound_to_one_target():
    backend = FakeBackend()
    service = ComputerUseService(router=BackendRouter([backend]))
    for session_id in ("session-one", "session-two"):
        service.bind_session({
            "sessionId": session_id,
            "owner": {"runtimeId": "runtime-1", "threadId": "thread-1"},
            "target": uia_target("target-shared"),
        })
    result = service.run_batch({
        "instruction": "unsafe batch",
        "parallel": [
            {"instruction": "one", "sessionId": "session-one"},
            {"instruction": "two", "sessionId": "session-two"},
        ],
    }, lambda _request, _channel: {"ok": True})
    assert result["error"]["code"] == "INVALID_ARGUMENT"
    assert "different targets" in result["error"]["message"]


def test_parallel_batch_parent_cancel_fans_out_and_cleans_children():
    backend = FakeBackend()
    service = ComputerUseService(router=BackendRouter([backend]))
    for label in ("alpha", "beta"):
        service.bind_session({
            "sessionId": f"session-{label}",
            "owner": {"runtimeId": "runtime-1", "threadId": "thread-1"},
            "target": uia_target(f"target-{label}"),
        })
    both_started = threading.Barrier(3)
    batch_result = {}

    def execute(_request, channel):
        channel.observe()
        both_started.wait(timeout=1)
        while not channel.cancellation.is_set():
            time.sleep(0.001)
        return {"ok": False, "error": {"code": "CANCELLED", "message": "cancelled"}}

    worker = threading.Thread(
        target=lambda: batch_result.update(service.run_batch({
            "instruction": "cancel the approved batch",
            "requestId": "batch-parent-cancel",
            "parallel": [
                {"instruction": "alpha", "sessionId": "session-alpha"},
                {"instruction": "beta", "sessionId": "session-beta"},
            ],
        }, execute)),
    )
    worker.start()
    both_started.wait(timeout=1)
    cancelled = service.cancel({
        "requestId": "batch-parent-cancel",
        "reason": "test_cancel",
    })
    worker.join(timeout=2)

    assert not worker.is_alive()
    assert cancelled["ok"] is True
    assert cancelled["data"]["status"] == "accepted"
    assert {item["status"] for item in cancelled["data"]["children"]} == {"accepted"}
    assert batch_result["data"]["successCount"] == 0
    assert batch_result["data"]["failureCount"] == 2
    counts = service.registry.snapshot_counts()
    assert counts["requests"] == counts["activeLeases"] == 0
    assert backend.open_handle_count == 0


def test_parallel_batch_cancel_is_latched_before_child_request_registration(monkeypatch):
    backend = FakeBackend()
    service = ComputerUseService(router=BackendRouter([backend]))
    for label in ("alpha", "beta"):
        service.bind_session({
            "sessionId": f"session-{label}",
            "owner": {"runtimeId": "runtime-1", "threadId": "thread-1"},
            "target": uia_target(f"target-{label}"),
        })
    original_begin_request = service.registry.begin_request
    before_registration = threading.Barrier(3)
    permit_registration = threading.Event()
    batch_result = {}

    def delayed_begin_request(*args, **kwargs):
        before_registration.wait(timeout=1)
        assert permit_registration.wait(timeout=1)
        return original_begin_request(*args, **kwargs)

    monkeypatch.setattr(service.registry, "begin_request", delayed_begin_request)
    worker = threading.Thread(
        target=lambda: batch_result.update(service.run_batch({
            "instruction": "cancel during child registration",
            "requestId": "batch-registration-race",
            "parallel": [
                {"instruction": "alpha", "sessionId": "session-alpha"},
                {"instruction": "beta", "sessionId": "session-beta"},
            ],
        }, lambda _request, _channel: {"ok": True})),
    )
    worker.start()
    before_registration.wait(timeout=1)
    cancelled = service.cancel({"requestId": "batch-registration-race"})
    permit_registration.set()
    worker.join(timeout=2)

    assert not worker.is_alive()
    assert cancelled["ok"] is True
    assert {item["status"] for item in cancelled["data"]["children"]} == {"pending-start"}
    assert batch_result["data"]["successCount"] == 0
    assert batch_result["data"]["failureCount"] == 2
    assert {
        item["result"]["error"]["code"] for item in batch_result["data"]["results"]
    } == {"CANCEL_PENDING"}
    counts = service.registry.snapshot_counts()
    assert counts["requests"] == counts["activeLeases"] == 0
    assert backend.open_handle_count == 0


def test_parallel_batch_cancel_is_latched_during_session_resolution(monkeypatch):
    backend = FakeBackend()
    service = ComputerUseService(router=BackendRouter([backend]))
    for label in ("alpha", "beta"):
        service.bind_session({
            "sessionId": f"session-{label}",
            "owner": {"runtimeId": "runtime-1", "threadId": "thread-1"},
            "target": uia_target(f"target-{label}"),
        })
    original_resolve_session = service._resolve_session
    resolving = threading.Event()
    permit_resolution = threading.Event()
    batch_result = {}
    first_resolution = True

    def delayed_resolve_session(*args, **kwargs):
        nonlocal first_resolution
        if first_resolution:
            first_resolution = False
            resolving.set()
            assert permit_resolution.wait(timeout=1)
        return original_resolve_session(*args, **kwargs)

    monkeypatch.setattr(service, "_resolve_session", delayed_resolve_session)
    worker = threading.Thread(
        target=lambda: batch_result.update(service.run_batch({
            "instruction": "cancel while sessions resolve",
            "requestId": "batch-session-resolution-race",
            "parallel": [
                {"instruction": "alpha", "sessionId": "session-alpha"},
                {"instruction": "beta", "sessionId": "session-beta"},
            ],
        }, lambda _request, _channel: {"ok": True})),
    )
    worker.start()
    assert resolving.wait(timeout=1)
    cancelled = service.cancel({"requestId": "batch-session-resolution-race"})
    permit_resolution.set()
    worker.join(timeout=2)

    assert not worker.is_alive()
    assert cancelled["ok"] is True
    assert cancelled["data"]["children"] == []
    assert batch_result["data"]["successCount"] == 0
    assert batch_result["data"]["failureCount"] == 2
    assert {
        item["result"]["error"]["code"] for item in batch_result["data"]["results"]
    } == {"CANCEL_PENDING"}
    counts = service.registry.snapshot_counts()
    assert counts["requests"] == counts["activeLeases"] == 0
    assert backend.open_handle_count == 0


def test_parallel_batch_rejects_duplicate_active_parent_request_id():
    backend = FakeBackend()
    service = ComputerUseService(router=BackendRouter([backend]))
    for label in ("alpha", "beta"):
        service.bind_session({
            "sessionId": f"session-{label}",
            "owner": {"runtimeId": "runtime-1", "threadId": "thread-1"},
            "target": uia_target(f"target-{label}"),
        })
    both_started = threading.Barrier(3)
    permit_finish = threading.Event()
    first_result = {}
    batch = {
        "instruction": "one active parent identity",
        "requestId": "batch-parent-conflict",
        "parallel": [
            {"instruction": "alpha", "sessionId": "session-alpha"},
            {"instruction": "beta", "sessionId": "session-beta"},
        ],
    }

    def execute(_request, _channel):
        both_started.wait(timeout=1)
        assert permit_finish.wait(timeout=1)
        return {"ok": True}

    worker = threading.Thread(
        target=lambda: first_result.update(service.run_batch(batch, execute)),
    )
    worker.start()
    both_started.wait(timeout=1)
    duplicate = service.run_batch(batch, lambda _request, _channel: {"ok": True})
    permit_finish.set()
    worker.join(timeout=2)

    assert duplicate["error"]["code"] == "REQUEST_ID_CONFLICT"
    assert first_result["data"]["successCount"] == 2
    counts = service.registry.snapshot_counts()
    assert counts["requests"] == counts["activeLeases"] == 0
    assert backend.open_handle_count == 0


def test_parallel_batch_cancel_continues_after_one_backend_delivery_failure(monkeypatch):
    backend = FakeBackend()
    service = ComputerUseService(router=BackendRouter([backend]))
    for label in ("alpha", "beta"):
        service.bind_session({
            "sessionId": f"session-{label}",
            "owner": {"runtimeId": "runtime-1", "threadId": "thread-1"},
            "target": uia_target(f"target-{label}"),
        })
    original_cancel = backend.cancel
    delivery_count = 0
    delivered_targets = []
    both_started = threading.Barrier(3)
    batch_result = {}

    def fail_first_cancel(handle, reason):
        nonlocal delivery_count
        delivery_count += 1
        delivered_targets.append(handle.target.target_id)
        if delivery_count == 1:
            raise RuntimeError("injected cancel delivery failure")
        original_cancel(handle, reason)

    monkeypatch.setattr(backend, "cancel", fail_first_cancel)

    def execute(_request, channel):
        channel.observe()
        both_started.wait(timeout=1)
        while not channel.cancellation.is_set():
            time.sleep(0.001)
        return {"ok": False, "error": {"code": "CANCELLED", "message": "cancelled"}}

    worker = threading.Thread(
        target=lambda: batch_result.update(service.run_batch({
            "instruction": "continue cancel fanout after one delivery failure",
            "requestId": "batch-cancel-delivery-failure",
            "parallel": [
                {"instruction": "alpha", "sessionId": "session-alpha"},
                {"instruction": "beta", "sessionId": "session-beta"},
            ],
        }, execute)),
    )
    worker.start()
    both_started.wait(timeout=1)
    cancelled = service.cancel({"requestId": "batch-cancel-delivery-failure"})
    worker.join(timeout=2)

    assert not worker.is_alive()
    assert cancelled["error"]["code"] == "CANCEL_DELIVERY_FAILED"
    statuses = {
        item["status"] for item in cancelled["error"]["details"]["children"]
    }
    assert statuses == {"accepted", "delivery-failed"}
    assert delivery_count >= 2
    assert set(delivered_targets) == {"target-alpha", "target-beta"}
    assert batch_result["data"]["failureCount"] == 2
    counts = service.registry.snapshot_counts()
    assert counts["requests"] == counts["activeLeases"] == 0
    assert backend.open_handle_count == 0


def test_unknown_backend_open_outcome_stays_visible_and_keeps_lease_quarantined():
    backend = FakeBackend()

    def unknown_open(_target, _context):
        raise TimeoutError("response lost after open dispatch")

    backend.open = unknown_open
    service = ComputerUseService(router=BackendRouter([backend]))
    result = service.run({
        "instruction": "observe",
        "target": uia_target("target-open-unknown"),
        "requestId": "request-open-unknown",
    }, lambda _request, _channel: {"ok": True})

    assert result["error"]["code"] == "CLEANUP_INCOMPLETE"
    status = service.status()
    assert status["registry"]["counts"]["requests"] == 1
    assert status["registry"]["counts"]["activeLeases"] == 1
    assert status["cleanupPending"] == [{
        "requestId": "request-open-unknown",
        "sessionId": status["cleanupPending"][0]["sessionId"],
        "targetId": "target-open-unknown",
        "leaseId": status["cleanupPending"][0]["leaseId"],
        "backend": "windows-uia",
        "closed": False,
        "leaseReleased": False,
        "errors": ["backend open outcome is unknown; lease is quarantined"],
    }]
    shutdown = service.shutdown()
    assert shutdown["lifecycleState"] == "stopping"
    assert shutdown["cleanupComplete"] is False
