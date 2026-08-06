from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event

from cua import result as R
from cua.capabilities import BackendId
from cua.isolation import IsolationLevel
from cua.service import ComputerUseService
from cua.session_registry import LeaseScope
from cua.target import TargetKind
from driver.channel import ChannelError
from driver.router import BackendRouter
from tests.fakes.fake_backend import FakeBackend


def target(index: int, *, kind="windows-uia"):
    locator = {"processId": 100 + index} if kind == "windows-uia" else {"monitorId": str(index)}
    return {"targetId": f"target-{index}", "kind": kind, "locator": locator}


def test_three_sessions_interleave_without_target_failure_or_cancel_cross_line():
    backend = FakeBackend(fail_action_target="target-0")
    service = ComputerUseService(router=BackendRouter([backend]))
    for index in range(3):
        service.bind_session({
            "sessionId": f"session-{index}",
            "owner": {"runtimeId": "runtime", "threadId": f"thread-{index}"},
            "target": target(index),
        })
    observed = Barrier(4)
    proceed = Event()

    def execute(index, request, channel):
        observation = channel.observe()
        observed.wait()
        proceed.wait(2)
        try:
            outcome = channel.perform(
                {"action": "write", "value": f"value-{index}"},
                expected_revision=observation.revision,
            )
            return R.ok({"status": "done", "targetId": outcome.target_id})
        except ChannelError as error:
            return R.err(error.code, str(error))

    def run(index):
        return service.run(
            {
                "instruction": "write",
                "sessionId": f"session-{index}",
                "requestId": f"request-{index}",
            },
            lambda request, channel: execute(index, request, channel),
        )

    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = [pool.submit(run, index) for index in range(3)]
        observed.wait()
        cancelled = service.cancel({"requestId": "request-1", "reason": "test"})
        assert cancelled["ok"] is True
        proceed.set()
        results = [future.result() for future in futures]

    assert results[0]["error"]["code"] == "ACTION_OUTCOME_UNKNOWN"
    assert results[1]["error"]["code"] == "CANCEL_PENDING"
    assert results[2]["ok"] is True
    assert backend.read("target-0") == ()
    assert backend.read("target-1") == ()
    assert backend.read("target-2") == ("value-2",)
    assert backend.open_handle_count == 0
    counts = service.registry.snapshot_counts()
    assert counts["requests"] == counts["activeLeases"] == 0


def test_process_global_backend_rejects_second_full_run_while_first_is_active():
    backend = FakeBackend(
        backend_id=BackendId.LEGACY_PYAUTOGUI,
        isolation=IsolationLevel.HOST_APPROVED,
        target_kinds=(TargetKind.HOST_DESKTOP,),
        actions=("observe",),
        lease_scope=LeaseScope.PROCESS_GLOBAL,
    )
    service = ComputerUseService(router=BackendRouter([backend]))
    entered = Event()
    release = Event()

    def first_executor(_request, _channel):
        entered.set()
        release.wait(2)
        return R.ok({"status": "done"})

    first_request = {
        "instruction": "first",
        "target": target(1, kind="host-desktop"),
        "requestedIsolation": "host-approved",
        "requestId": "request-first",
    }
    second_request = {
        "instruction": "second",
        "target": target(2, kind="host-desktop"),
        "requestedIsolation": "host-approved",
        "requestId": "request-second",
    }
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(service.run, first_request, first_executor)
        assert entered.wait(1)
        second = service.run(second_request, lambda _request, _channel: R.ok({"status": "bad"}))
        release.set()
        first_result = first.result()
    assert first_result["ok"] is True
    assert second["error"]["code"] == "HOST_INPUT_BUSY"
    assert backend.open_handle_count == 0
    counts = service.registry.snapshot_counts()
    assert counts["sessions"] == counts["requests"] == counts["activeLeases"] == 0


def test_cancel_during_action_reports_stopping_and_keeps_lease_until_safe_point():
    entered = Event()
    release = Event()

    class BlockingBackend(FakeBackend):
        def perform(self, handle, action, expected_revision):
            entered.set()
            release.wait(2)
            return super().perform(handle, action, expected_revision)

    backend = BlockingBackend()
    service = ComputerUseService(router=BackendRouter([backend]))
    service.bind_session({
        "sessionId": "session-1",
        "owner": {"runtimeId": "runtime", "threadId": "thread"},
        "target": target(1),
    })

    def execute(_request, channel):
        observation = channel.observe()
        try:
            channel.perform(
                {"action": "write", "value": "committed-before-cancel"},
                expected_revision=observation.revision,
            )
            return R.ok({"status": "done"})
        except ChannelError as error:
            return R.err(error.code, str(error), details=error.details)

    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(
            service.run,
            {"instruction": "write", "sessionId": "session-1", "requestId": "request-1"},
            execute,
        )
        assert entered.wait(1)
        cancelled = service.cancel({"requestId": "request-1", "reason": "test"})
        assert cancelled["data"]["status"] == "stopping"
        snapshot = service.registry.snapshot()
        assert snapshot["counts"]["activeLeases"] == 1
        assert snapshot["leases"][0]["inFlightActionCount"] == 1
        release.set()
        result = future.result()
    assert result["error"]["code"] == "CANCEL_PENDING"
    assert result["error"]["details"]["committed"] is True
    assert backend.read("target-1") == ("committed-before-cancel",)
    assert backend.open_handle_count == 0
    assert service.registry.snapshot_counts()["activeLeases"] == 0


def test_force_release_waits_for_in_flight_action_before_closing_session():
    entered = Event()
    action_release = Event()

    class BlockingBackend(FakeBackend):
        def perform(self, handle, action, expected_revision):
            entered.set()
            action_release.wait(2)
            return super().perform(handle, action, expected_revision)

    backend = BlockingBackend()
    service = ComputerUseService(router=BackendRouter([backend]))
    service.bind_session({
        "sessionId": "session-1",
        "owner": {"runtimeId": "runtime", "threadId": "thread"},
        "target": target(1),
    })

    def execute(_request, channel):
        observation = channel.observe()
        try:
            channel.perform(
                {"action": "write", "value": "value"},
                expected_revision=observation.revision,
            )
            return R.ok({"status": "done"})
        except ChannelError as error:
            return R.err(error.code, str(error), details=error.details)

    with ThreadPoolExecutor(max_workers=2) as pool:
        running = pool.submit(
            service.run,
            {"instruction": "write", "sessionId": "session-1", "requestId": "request-1"},
            execute,
        )
        assert entered.wait(1)
        releasing = pool.submit(
            service.release_session,
            {"sessionId": "session-1", "force": True, "reason": "test_release"},
        )
        assert not releasing.done()
        assert service.status()["registry"]["counts"]["activeLeases"] == 1
        action_release.set()
        release_result = releasing.result()
        run_result = running.result()
    assert release_result["ok"] is True
    assert run_result["error"]["code"] == "CANCEL_PENDING"
    assert backend.open_handle_count == 0
    status = service.status()
    assert status["activeChannels"] == 0
    assert status["registry"]["counts"]["sessions"] == 0
    assert status["registry"]["counts"]["activeLeases"] == 0
