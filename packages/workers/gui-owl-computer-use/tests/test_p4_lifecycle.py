from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor

from cua import result as R
from cua.service import ComputerUseService
from cua.session_registry import SessionRegistry
from driver.router import BackendRouter
from tests.fakes.fake_backend import FakeBackend


def uia_target(index: int):
    return {
        "targetId": f"target-{index}",
        "kind": "windows-uia",
        "locator": {"processId": 1000 + index, "automationId": f"Editor-{index}"},
    }


def bind(service: ComputerUseService, index: int) -> None:
    result = service.bind_session({
        "sessionId": f"session-{index}",
        "owner": {"runtimeId": "runtime-1", "threadId": f"thread-{index}"},
        "target": uia_target(index),
    })
    assert result["ok"] is True


def wait_for_channels(service: ComputerUseService, count: int) -> None:
    deadline = time.time() + 3
    while time.time() < deadline:
        if service.status()["activeChannels"] == count:
            return
        time.sleep(0.01)
    raise AssertionError(f"expected {count} active channels")


def test_reaper_closes_handle_before_finishing_timeout():
    now = [100.0]
    registry = SessionRegistry(clock=lambda: now[0])
    backend = FakeBackend()
    service = ComputerUseService(
        registry=registry,
        router=BackendRouter([backend]),
        lease_ttl_seconds=1,
    )
    bind(service, 1)
    continue_executor = threading.Event()

    def executor(_request, channel):
        continue_executor.wait(3)
        channel.observe()
        return {"ok": True}

    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(service.run, {
            "instruction": "wait",
            "sessionId": "session-1",
            "requestId": "request-1",
        }, executor)
        wait_for_channels(service, 1)
        now[0] = 102.0
        reaped = service.reap_once()
        assert reaped["cleanedRequests"] == ["request-1"]
        assert backend.open_handle_count == 0
        assert registry.snapshot_counts()["activeLeases"] == 0
        continue_executor.set()
        result = future.result(timeout=3)

    assert result["error"]["code"] == "TIMEOUT"
    assert registry.get_request("request-1").state.value == "timed-out"


def test_reaper_keeps_failed_close_quarantined_until_retry():
    now = [100.0]
    registry = SessionRegistry(clock=lambda: now[0])
    backend = FakeBackend(fail_close=True)
    service = ComputerUseService(
        registry=registry,
        router=BackendRouter([backend]),
        lease_ttl_seconds=1,
    )
    bind(service, 1)
    continue_executor = threading.Event()

    def executor(_request, channel):
        continue_executor.wait(3)
        channel.observe()
        return {"ok": True}

    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(service.run, {
            "instruction": "wait",
            "sessionId": "session-1",
            "requestId": "request-1",
        }, executor)
        wait_for_channels(service, 1)
        now[0] = 102.0
        first = service.reap_once()
        assert first["cleanupPending"] == ["request-1"]
        assert registry.snapshot_counts()["activeLeases"] == 1
        assert service.cleanup_pending()[0]["leaseReleased"] is False

        backend.fail_close = False
        second = service.reap_once()
        assert second["cleanedRequests"] == ["request-1"]
        assert registry.snapshot_counts()["activeLeases"] == 0
        continue_executor.set()
        result = future.result(timeout=3)

    assert result["error"]["code"] == "TIMEOUT"
    assert service.cleanup_pending() == []


def test_shutdown_cancels_three_channels_without_cross_failure():
    backend = FakeBackend()
    service = ComputerUseService(router=BackendRouter([backend]))
    for index in range(3):
        bind(service, index)

    def run(index: int):
        def executor(_request, channel):
            channel.cancellation.wait(3)
            return R.err("CANCEL_PENDING", "stopped")

        return service.run({
            "instruction": "wait",
            "sessionId": f"session-{index}",
            "requestId": f"request-{index}",
        }, executor)

    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = [pool.submit(run, index) for index in range(3)]
        wait_for_channels(service, 3)
        shutdown = service.shutdown()
        results = [future.result(timeout=3) for future in futures]

    assert shutdown["cleanupComplete"] is True
    assert shutdown["lifecycleState"] == "stopped"
    assert shutdown["sessions"] == shutdown["requests"] == shutdown["activeLeases"] == 0
    assert backend.open_handle_count == 0
    assert all(result["error"]["code"] == "CANCEL_PENDING" for result in results)
    rejected = service.run(
        {"instruction": "late"},
        lambda _request, _channel: {"ok": True},
    )
    assert rejected["error"]["code"] == "UNAVAILABLE"
    assert rejected["error"]["details"]["reason"] == "service-shutting-down"


def test_shutdown_reports_failed_cleanup_and_retries_idempotently():
    backend = FakeBackend(fail_close=True)
    service = ComputerUseService(router=BackendRouter([backend]))
    bind(service, 1)
    continue_executor = threading.Event()

    def executor(_request, channel):
        continue_executor.wait(3)
        return R.err("CANCEL_PENDING", "stopped")

    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(service.run, {
            "instruction": "wait",
            "sessionId": "session-1",
            "requestId": "request-1",
        }, executor)
        wait_for_channels(service, 1)
        first = service.shutdown()
        assert first["cleanupComplete"] is False
        assert first["lifecycleState"] == "stopping"
        assert first["activeLeases"] == 1
        assert len(first["cleanupPending"]) == 1
        stopping_status = service.status()
        assert stopping_status["lifecycleState"] == "stopping"
        assert stopping_status["cleanupPending"][0]["leaseReleased"] is False

        backend.fail_close = False
        second = service.shutdown()
        assert second["cleanupComplete"] is True
        assert second["activeLeases"] == 0
        continue_executor.set()
        future.result(timeout=3)


def test_target_lost_closes_only_the_affected_channel():
    backend = FakeBackend()
    service = ComputerUseService(router=BackendRouter([backend]))
    bind(service, 1)
    bind(service, 2)
    gates = {1: threading.Event(), 2: threading.Event()}

    def run(index: int):
        def executor(_request, channel):
            gates[index].wait(3)
            if index == 1:
                channel.observe()
            return {"ok": True}

        return service.run({
            "instruction": "wait",
            "sessionId": f"session-{index}",
            "requestId": f"request-{index}",
        }, executor)

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(run, 1)
        second = pool.submit(run, 2)
        wait_for_channels(service, 2)
        lost = service.mark_target_lost("target-1")
        assert lost["cleanedRequests"] == ["request-1"]
        assert backend.open_handle_count == 1
        assert service.registry.get_request("request-2").state.value == "running"
        gates[1].set()
        gates[2].set()
        first_result = first.result(timeout=3)
        second_result = second.result(timeout=3)

    assert first_result["error"]["code"] == "TARGET_LOST"
    assert second_result["ok"] is True
    assert backend.open_handle_count == 0


def test_reaper_thread_stops_without_leaking_on_shutdown():
    service = ComputerUseService(lease_ttl_seconds=1)
    service.start_reaper(0.01)
    assert service.status()["reaper"]["running"] is True
    result = service.shutdown()
    assert result["cleanupComplete"] is True
    assert service.status()["reaper"]["running"] is False


def test_reaper_can_be_disabled_without_changing_channel_routing():
    service = ComputerUseService()
    service.configure_lifecycle(
        lease_ttl_seconds=30,
        reaper_interval_seconds=1,
        reaper_enabled=False,
    )
    status = service.status()
    assert status["reaper"]["running"] is False
    assert status["reaper"]["leaseTtlSeconds"] is None
    assert service.shutdown()["cleanupComplete"] is True
