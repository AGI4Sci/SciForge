from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import threading
import time

from cua import contract
from cua.invocation_proof import InvocationIdentity
from cua.runner import run_task
from cua.service import ComputerUseService
from cua.session_registry import RegistryError, SessionOwner, SessionRegistry
from cua.target import TargetDescriptor, TargetKind, TargetOwnership
from driver.router import BackendRouter
from tests.fakes.fake_backend import FakeCdpBackend


def target(generation="generation-1"):
    return TargetDescriptor(
        target_id="target-alpha", kind=TargetKind.BROWSER_PAGE,
        ownership=TargetOwnership.ATTACHED,
        locator={"cdpEndpoint": "http://127.0.0.1:9222", "cdpTargetId": "alpha"},
        generation=generation,
    )


def identity(request="request-1", thread="thread-1", turn="turn-1"):
    return InvocationIdentity("proof-1", request, "codex", thread, turn, "call-1", "invocation-1", "computer_use")


def bound(*, fail_close=False, unknown_action=False, unknown_open=False):
    backend = FakeCdpBackend(
        target(), fail_close=fail_close, unknown_action=unknown_action,
        unknown_open=unknown_open,
    )
    service = ComputerUseService(router=BackendRouter([backend]))
    bound_result = service.bind_session({"target": target().to_dict()}, identity("bind-1"))
    assert bound_result["ok"]
    return service, backend, bound_result["data"]["sessionId"]


def test_instruction_only_fails_closed():
    try: contract.normalize_run_input({"sessionId": "session-1", "instruction": "click"})
    except ValueError as error: assert "UNSUPPORTED_LEGACY_INSTRUCTION" in str(error)
    else: raise AssertionError("instruction-only input accepted")


def test_only_cdp_targets_are_valid():
    assert target().kind is TargetKind.BROWSER_PAGE
    assert [item.value for item in TargetKind] == ["browser-page", "electron-webcontents"]


def test_bind_observe_release_resource_zero():
    service, backend, session_id = bound()
    result = service.run({"sessionId": session_id, "semanticAction": {"kind": "observe"}}, run_task, invocation=identity())
    assert result["ok"] and result["data"]["executed"] is False
    assert backend.handles == 0
    assert service.release_session({"sessionId": session_id}, identity("release-1"))["ok"]
    assert service.capabilities()["runtime"]["counts"]["sessions"] == 0


def test_click_verification_and_readback():
    service, backend, session_id = bound()
    result = service.run({"sessionId": session_id, "semanticAction": {
        "kind": "click", "role": "button", "name": "Commit",
        "expect": {"kind": "text-present", "text": "Committed"},
    }}, run_task, invocation=identity())
    assert result["ok"] and result["data"]["verification"]["matched"] is True
    assert backend.actions == 1


def test_expectation_waits_for_bounded_async_readback():
    service, backend, session_id = bound()
    original_observe = backend.observe
    ready_at = None

    def delayed_observe(handle):
        if ready_at is not None and time.monotonic() >= ready_at:
            backend.text = "Committed later"
        return original_observe(handle)

    original_perform = backend.perform

    def delayed_perform(handle, action, expected_revision):
        nonlocal ready_at
        receipt = original_perform(handle, action, expected_revision)
        backend.text = "Pending"
        ready_at = time.monotonic() + 0.15
        return receipt

    backend.observe = delayed_observe
    backend.perform = delayed_perform
    result = service.run({
        "sessionId": session_id,
        "deadlineMs": 1000,
        "semanticAction": {
            "kind": "click", "role": "button", "name": "Commit",
            "expect": {"kind": "text-present", "text": "Committed later"},
        },
    }, run_task, invocation=identity())
    assert result["ok"]
    assert result["data"]["verification"]["matched"] is True
    assert result["data"]["finalObservation"]["semanticTree"][1]["name"] == "Committed later"


def test_typed_input_is_redacted_from_action_timeline():
    service, _backend, session_id = bound()
    result = service.run({
        "sessionId": session_id,
        "semanticAction": {"kind": "sequence", "steps": [
            {"kind": "type", "text": "sensitive-input"},
        ]},
    }, run_task, invocation=identity())
    assert result["ok"]
    assert result["data"]["steps"][0]["semanticAction"] == {
        "kind": "type", "textLength": 15,
    }


def test_stale_revision_rejected_before_dispatch():
    service, backend, session_id = bound()
    result = service.run({"sessionId": session_id, "expectedRevision": "cdp:999",
                          "semanticAction": {"kind": "click", "role": "button", "name": "Commit"}},
                         run_task, invocation=identity())
    assert result["error"]["code"] == "STALE_OBSERVATION"
    assert backend.actions == 0


def test_pre_dispatch_deadline_and_cancel_do_not_execute_actions():
    service, backend, session_id = bound()

    def after_deadline(request, channel):
        time.sleep(0.01)
        return run_task(request, channel)

    timed_out = service.run(
        {"sessionId": session_id, "deadlineMs": 1,
         "semanticAction": {"kind": "click", "role": "button", "name": "Commit"}},
        after_deadline, invocation=identity("request-timeout"),
    )
    assert timed_out["error"]["code"] == "TIMEOUT"

    def cancel_before_action(request, channel):
        accepted = service.cancel(
            {"requestId": channel.request_id, "reason": "test_cancel"},
            invocation=identity(channel.request_id),
        )
        assert accepted["ok"]
        return run_task(request, channel)

    cancelled = service.run(
        {"sessionId": session_id,
         "semanticAction": {"kind": "click", "role": "button", "name": "Commit"}},
        cancel_before_action, invocation=identity("request-cancel"),
    )
    assert cancelled["error"]["code"] == "CANCEL_PENDING"
    assert backend.actions == 0


def test_generation_change_rejected_at_bind():
    backend = FakeCdpBackend(target("generation-2"))
    service = ComputerUseService(router=BackendRouter([backend]))
    result = service.bind_session({"target": target("generation-1").to_dict()}, identity("bind-1"))
    assert result["error"]["code"] == "INVALID_ARGUMENT"


def test_same_target_cannot_have_two_sessions():
    service, _backend, _session_id = bound()
    result = service.bind_session({"target": target().to_dict()}, identity("bind-2", "thread-2"))
    assert result["error"]["code"] == "TARGET_BUSY"


def test_same_target_concurrent_bind_has_one_winner():
    backend = FakeCdpBackend(target())
    service = ComputerUseService(router=BackendRouter([backend]))
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(
            lambda index: service.bind_session(
                {"target": target().to_dict()}, identity(f"bind-{index}", f"thread-{index}")
            ),
            (1, 2),
        ))
    assert sum(bool(result["ok"]) for result in results) == 1
    assert sorted(result.get("error", {}).get("code") for result in results if not result["ok"]) == ["TARGET_BUSY"]


def test_one_turn_cannot_own_two_sessions():
    registry = SessionRegistry()
    owner = SessionOwner("codex", "thread-1", "turn-1")
    registry.bind_session(owner, target())
    second = TargetDescriptor(
        target_id="target-beta", kind=TargetKind.BROWSER_PAGE,
        ownership=TargetOwnership.ATTACHED,
        locator={"cdpEndpoint": "http://127.0.0.1:9222", "cdpTargetId": "beta"},
        generation="generation-1",
    )
    try:
        registry.bind_session(owner, second)
    except RegistryError as error:
        assert error.code == "SESSION_ALREADY_BOUND"
    else:
        raise AssertionError("one turn bound multiple sessions")


def test_owner_mismatch_is_rejected():
    service, backend, session_id = bound()
    result = service.run({"sessionId": session_id, "semanticAction": {"kind": "observe"}},
                         run_task, invocation=identity("request-2", "other-thread"))
    assert result["error"]["code"] == "SESSION_OWNER_MISMATCH"
    assert backend.actions == 0


def test_turn_mismatch_is_rejected_and_terminal_reclaim_is_exact():
    service, backend, session_id = bound()
    mismatch = service.run(
        {"sessionId": session_id, "semanticAction": {"kind": "observe"}},
        run_task,
        invocation=identity("request-2", turn="turn-2"),
    )
    assert mismatch["error"]["code"] == "SESSION_OWNER_MISMATCH"
    untouched = service.reclaim_owner("codex", "thread-1", "turn-2")
    assert untouched["data"]["released"] == []
    reclaimed = service.reclaim_owner("codex", "thread-1", "turn-1")
    assert reclaimed["data"]["released"] == [session_id]
    assert service.capabilities()["runtime"]["counts"]["sessions"] == 0
    assert backend.handles == 0


def test_terminal_reclaim_cancels_active_request_then_closes_session():
    service, backend, session_id = bound()
    entered = threading.Event()
    proceed = threading.Event()
    original_observe = backend.observe

    def blocked_observe(handle):
        entered.set()
        assert proceed.wait(3)
        return original_observe(handle)

    backend.observe = blocked_observe
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(
            service.run,
            {"sessionId": session_id, "semanticAction": {"kind": "observe"}},
            run_task,
            invocation=identity(),
        )
        assert entered.wait(3)
        reclaim = service.reclaim_owner("codex", "thread-1", "turn-1")
        assert reclaim["data"]["cleanupPending"] == [session_id]
        proceed.set()
        assert future.result(timeout=3)["error"]["code"] == "CANCEL_PENDING"
    assert service.capabilities()["runtime"]["counts"]["sessions"] == 0
    assert service.capabilities()["runtime"]["activeChannels"] == 0
    assert backend.handles == 0


def test_post_dispatch_unknown_is_not_replayed():
    service, backend, session_id = bound(unknown_action=True)
    result = service.run({"sessionId": session_id, "semanticAction": {
        "kind": "click", "role": "button", "name": "Commit"}}, run_task, invocation=identity())
    assert result["error"]["code"] == "ACTION_OUTCOME_UNKNOWN"
    assert backend.actions == 1


def test_cleanup_failure_is_quarantined_then_reclaimed():
    service, backend, session_id = bound(fail_close=True)
    result = service.run({"sessionId": session_id, "semanticAction": {"kind": "observe"}}, run_task, invocation=identity())
    assert result["error"]["code"] == "CLEANUP_INCOMPLETE"
    assert service.capabilities()["runtime"]["cleanupPending"] == 1
    backend.fail_close = False
    reclaimed = service.reclaim_cleanup()
    assert reclaimed["data"]["cleanupPending"] == []
    assert backend.handles == 0


def test_unknown_open_retains_lease_until_idempotent_recovery_closes_handle():
    service, backend, session_id = bound(unknown_open=True)
    result = service.run(
        {"sessionId": session_id, "semanticAction": {"kind": "observe"}},
        run_task, invocation=identity(),
    )
    assert result["error"]["code"] == "CLEANUP_INCOMPLETE"
    runtime = service.capabilities()["runtime"]
    assert runtime["counts"]["requests"] == 1
    assert runtime["counts"]["activeLeases"] == 1
    assert runtime["cleanupPending"] == 1 and backend.handles == 1
    reclaimed = service.reclaim_cleanup()
    assert reclaimed["data"]["cleanupPending"] == []
    runtime = service.capabilities()["runtime"]
    assert runtime["counts"]["requests"] == runtime["counts"]["activeLeases"] == 0
    assert backend.handles == 0


def test_app_shutdown_reclaims_idle_sessions_and_active_resources():
    service, backend, _session_id = bound()
    stopped = service.shutdown()
    assert stopped["ok"]
    runtime = service.capabilities()["runtime"]
    assert runtime["counts"]["sessions"] == 0
    assert runtime["counts"]["requests"] == 0
    assert runtime["counts"]["activeLeases"] == 0
    assert runtime["activeChannels"] == runtime["cleanupPending"] == 0
    assert backend.handles == 0


def test_twenty_rounds_do_not_grow_active_resources():
    service, backend, session_id = bound()
    for index in range(20):
        result = service.run({"sessionId": session_id, "semanticAction": {"kind": "observe"}},
                             run_task, invocation=identity(f"request-{index + 1}"))
        assert result["ok"]
    runtime = service.capabilities()["runtime"]
    assert runtime["counts"]["requests"] == 0
    assert runtime["counts"]["activeLeases"] == 0
    assert runtime["activeChannels"] == runtime["backendHandles"] == 0
    assert backend.handles == 0
