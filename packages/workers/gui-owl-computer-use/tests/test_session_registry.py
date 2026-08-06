from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest

from cua.session_registry import (
    LeaseScope,
    RegistryError,
    RequestState,
    SessionOwner,
    SessionRegistry,
)
from cua.target import parse_target_descriptor
from tests.fakes.fake_backend import FakeBackend


def make_target(index: int, *, target_id: str | None = None):
    return parse_target_descriptor({
        "targetId": target_id or f"target-{index}",
        "kind": "windows-uia",
        "locator": {"processId": 100 + index},
    })


def bind(registry: SessionRegistry, index: int, *, target_id: str | None = None):
    owner = SessionOwner(runtime_id="runtime-1", thread_id=f"thread-{index}")
    return registry.bind_session(
        owner,
        make_target(index, target_id=target_id),
        session_id=f"session-{index}",
    )


def test_three_sessions_use_three_target_leases_without_cross_line():
    registry = SessionRegistry()
    backend = FakeBackend()
    barrier = Barrier(3)
    for index in range(3):
        bind(registry, index)

    def run(index: int) -> str:
        request_id = f"request-{index}"
        registry.begin_request(f"session-{index}", request_id)
        barrier.wait()
        lease = registry.acquire_lease(request_id, backend="fake")
        registry.transition_request(request_id, RequestState.RUNNING)
        backend.write(lease.target_id, f"value-{index}")
        registry.finish_request(request_id, RequestState.COMPLETED)
        return lease.target_id

    with ThreadPoolExecutor(max_workers=3) as pool:
        target_ids = list(pool.map(run, range(3)))

    assert sorted(target_ids) == ["target-0", "target-1", "target-2"]
    for index in range(3):
        assert backend.read(f"target-{index}") == (f"value-{index}",)
        registry.close_session(f"session-{index}")
    counts = registry.snapshot_counts()
    assert counts["sessions"] == counts["requests"] == counts["activeLeases"] == 0


def test_same_target_can_have_only_one_active_lease():
    registry = SessionRegistry()
    bind(registry, 1, target_id="shared-target")
    bind(registry, 2, target_id="shared-target")
    registry.begin_request("session-1", "request-1")
    registry.begin_request("session-2", "request-2")
    barrier = Barrier(2)

    def acquire(request_id: str):
        barrier.wait()
        try:
            return registry.acquire_lease(request_id, backend="fake")
        except RegistryError as error:
            return error

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(acquire, ("request-1", "request-2")))

    errors = [outcome for outcome in outcomes if isinstance(outcome, RegistryError)]
    assert len(errors) == 1
    assert errors[0].code == "TARGET_BUSY"
    for request_id in ("request-1", "request-2"):
        registry.finish_request(request_id, RequestState.COMPLETED)


def test_legacy_process_global_scope_serializes_different_targets():
    registry = SessionRegistry()
    bind(registry, 1)
    bind(registry, 2)
    registry.begin_request("session-1", "request-1")
    registry.begin_request("session-2", "request-2")
    registry.acquire_lease(
        "request-1", backend="legacy-pyautogui", scope=LeaseScope.PROCESS_GLOBAL
    )
    with pytest.raises(RegistryError) as caught:
        registry.acquire_lease(
            "request-2", backend="legacy-pyautogui", scope=LeaseScope.PROCESS_GLOBAL
        )
    assert caught.value.code == "HOST_INPUT_BUSY"


def test_session_owner_and_single_active_request_are_enforced():
    registry = SessionRegistry()
    session = bind(registry, 1)
    with pytest.raises(RegistryError) as caught:
        registry.begin_request(
            session.session_id,
            "request-wrong-owner",
            owner=SessionOwner(runtime_id="runtime-2", thread_id="thread-1"),
        )
    assert caught.value.code == "SESSION_OWNER_MISMATCH"
    registry.begin_request(session.session_id, "request-1", owner=session.owner)
    with pytest.raises(RegistryError) as caught:
        registry.begin_request(session.session_id, "request-2", owner=session.owner)
    assert caught.value.code == "SESSION_BUSY"


def test_duplicate_request_id_is_rejected_globally():
    registry = SessionRegistry()
    bind(registry, 1)
    bind(registry, 2)
    registry.begin_request("session-1", "request-shared")
    with pytest.raises(RegistryError) as caught:
        registry.begin_request("session-2", "request-shared")
    assert caught.value.code == "REQUEST_ID_CONFLICT"


def test_release_lease_is_idempotent():
    registry = SessionRegistry()
    bind(registry, 1)
    registry.begin_request("session-1", "request-1")
    lease = registry.acquire_lease("request-1", backend="fake")
    first = registry.release_lease(lease.lease_id, "done")
    second = registry.release_lease(lease.lease_id, "ignored")
    assert first.state.value == second.state.value == "released"
    assert second.release_reason == "done"


def test_cancel_finish_and_shutdown_are_idempotent_and_recover_resources():
    registry = SessionRegistry(tombstone_limit=2)
    bind(registry, 1)
    registry.begin_request("session-1", "request-1")
    registry.acquire_lease("request-1", backend="fake")
    cancelled = registry.request_cancel("request-1", "test")
    assert cancelled.cancellation.is_set()
    terminal = registry.finish_request("request-1", RequestState.CANCELLED, reason="test")
    repeated = registry.finish_request("request-1", RequestState.CANCELLED)
    assert repeated.request_id == terminal.request_id
    assert repeated.state is terminal.state
    assert repeated.cancellation.is_set()
    counts = registry.shutdown()
    assert counts["sessions"] == counts["requests"] == counts["activeLeases"] == 0


def test_invalid_nonterminal_transition_is_rejected():
    registry = SessionRegistry()
    bind(registry, 1)
    registry.begin_request("session-1", "request-1")
    with pytest.raises(RegistryError) as caught:
        registry.transition_request("request-1", RequestState.VERIFYING)
    assert caught.value.code == "INVALID_STATE_TRANSITION"


def test_close_session_force_cancels_its_active_request():
    registry = SessionRegistry()
    bind(registry, 1)
    registry.begin_request("session-1", "request-1")
    registry.acquire_lease("request-1", backend="fake")
    closed = registry.close_session("session-1", force=True)
    assert closed.state.value == "closed"
    assert registry.get_request("request-1").state is RequestState.CANCELLED
    assert registry.snapshot_counts()["activeLeases"] == 0


def test_ttl_does_not_release_an_in_flight_action():
    now = [100.0]
    registry = SessionRegistry(clock=lambda: now[0])
    bind(registry, 1)
    registry.begin_request("session-1", "request-1")
    lease = registry.acquire_lease("request-1", backend="fake", ttl_seconds=1)
    registry.begin_action(lease.lease_id)
    now[0] = 102.0
    result = registry.reap_expired()
    assert result == {"suspectedStale": [lease.lease_id], "expiredRequests": []}
    assert registry.snapshot_counts()["activeLeases"] == 1
    registry.finish_action(lease.lease_id)
    result = registry.reap_expired()
    assert result["expiredRequests"] == ["request-1"]
    # Registry detects and cancels, but cannot release a real backend handle.
    # The Service/Channel owner must close it before writing TIMED_OUT.
    assert registry.get_request("request-1").state is RequestState.CANCELLING
    assert registry.snapshot_counts()["activeLeases"] == 1


def test_heartbeat_extends_lease_before_expiry():
    now = [100.0]
    registry = SessionRegistry(clock=lambda: now[0])
    bind(registry, 1)
    registry.begin_request("session-1", "request-1")
    lease = registry.acquire_lease("request-1", backend="fake", ttl_seconds=5)
    now[0] = 104.0
    renewed = registry.heartbeat_lease(lease.lease_id, ttl_seconds=5)
    now[0] = 106.0
    assert renewed.expires_at == 109.0
    assert registry.reap_expired() == {"suspectedStale": [], "expiredRequests": []}


def test_target_lost_only_terminates_requests_on_that_target():
    registry = SessionRegistry()
    bind(registry, 1)
    bind(registry, 2)
    registry.begin_request("session-1", "request-1")
    registry.begin_request("session-2", "request-2")
    registry.acquire_lease("request-1", backend="fake")
    registry.acquire_lease("request-2", backend="fake")
    assert registry.mark_target_lost("target-1") == ["request-1"]
    assert registry.get_request("request-1").state is RequestState.CANCELLING
    assert registry.snapshot_counts()["activeLeases"] == 2
    assert registry.get_request("request-2").state is RequestState.ROUTING


def test_shutdown_prevents_new_sessions_and_leases():
    registry = SessionRegistry()
    registry.shutdown()
    with pytest.raises(RegistryError) as caught:
        bind(registry, 1)
    assert caught.value.code == "REGISTRY_CLOSED"


def test_one_hundred_concurrent_lifecycles_leave_no_active_resources():
    registry = SessionRegistry(tombstone_limit=16)

    def lifecycle(index: int) -> None:
        bind(registry, index)
        request_id = f"request-{index}"
        registry.begin_request(f"session-{index}", request_id)
        registry.acquire_lease(request_id, backend="fake")
        registry.transition_request(request_id, RequestState.RUNNING)
        registry.finish_request(request_id, RequestState.COMPLETED)
        registry.close_session(f"session-{index}")

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lifecycle, range(100)))
    counts = registry.snapshot_counts()
    assert counts["sessions"] == counts["requests"] == counts["activeLeases"] == 0
    assert counts["tombstones"] == counts["releasedLeaseTombstones"] == 16
