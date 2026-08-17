from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor

import pytest

from cua.invocation_ledger import InvocationLedger, InvocationLedgerError
from cua.invocation_proof import InvocationIdentity, argument_digest
from cua.service import ComputerUseService
from cua.target import TargetDescriptor, TargetKind, TargetOwnership
from driver.router import BackendRouter
from tests.fakes.fake_backend import FakeCdpBackend


def _identity(
    arguments: dict,
    *,
    request_id: str = "request-1",
    proof_id: str = "proof-1",
    invocation_id: str = "invocation-1",
    tool: str = "computer_use",
) -> InvocationIdentity:
    return InvocationIdentity(
        proof_id, request_id, "codex", "thread-1", "turn-1", "call-1",
        invocation_id, tool, argument_digest(arguments),
    )


def _target() -> TargetDescriptor:
    return TargetDescriptor(
        target_id="target-ledger",
        kind=TargetKind.BROWSER_PAGE,
        ownership=TargetOwnership.ATTACHED,
        locator={"cdpEndpoint": "http://127.0.0.1:9222", "cdpTargetId": "ledger"},
        generation="generation-1",
    )


def test_service_replays_bind_result_from_new_proof_without_rebinding() -> None:
    target = _target()
    arguments = {"target": target.to_dict()}
    service = ComputerUseService(router=BackendRouter([FakeCdpBackend(target)]))

    first = service.bind_session(arguments, _identity(
        arguments, request_id="request-bind-1", proof_id="proof-bind-1",
        tool="computer_use_bind_target",
    ))
    replay = service.bind_session(arguments, _identity(
        arguments, request_id="request-bind-2", proof_id="proof-bind-2",
        tool="computer_use_bind_target",
    ))

    assert first["ok"] and replay == first
    assert service.registry.snapshot_counts()["sessions"] == 1
    assert service.invocation_ledger.size == 1


def test_service_retains_terminal_failure_across_transport_request_ids() -> None:
    signed_arguments = {
        "sessionId": "missing-session",
        "semanticAction": {"kind": "observe"},
        "execute": True,
    }
    service = ComputerUseService(router=BackendRouter())
    first_body = {"requestId": "transport-1", **signed_arguments}
    replay_body = {"requestId": "transport-2", **signed_arguments}

    first = service.run(first_body, lambda *_args: pytest.fail("executor must not run"), invocation=_identity(
        signed_arguments, request_id="transport-1", proof_id="proof-run-1",
    ))
    replay = service.run(replay_body, lambda *_args: pytest.fail("executor must not run"), invocation=_identity(
        signed_arguments, request_id="transport-2", proof_id="proof-run-2",
    ))

    assert first["error"]["code"] == "SESSION_NOT_FOUND"
    assert replay == first
    assert service.invocation_ledger.size == 1


def test_same_tool_and_invocation_with_different_input_conflicts() -> None:
    ledger = InvocationLedger()
    first_arguments = {"sessionId": "session-1"}
    changed_arguments = {"sessionId": "session-2"}
    ledger.execute(
        _identity(first_arguments), operation="release_session",
        executor=lambda: {"ok": True},
    )

    with pytest.raises(InvocationLedgerError) as conflict:
        ledger.execute(
            _identity(changed_arguments, request_id="request-2", proof_id="proof-2"),
            operation="release_session",
            executor=lambda: pytest.fail("conflicting invocation must not execute"),
        )

    assert conflict.value.code == "IDEMPOTENCY_CONFLICT"


def test_run_and_cancel_can_share_invocation_id_because_tool_is_part_of_key() -> None:
    ledger = InvocationLedger()
    run_arguments = {"sessionId": "session-1", "semanticAction": {"kind": "observe"}}
    cancel_arguments = {"requestId": "request-1", "reason": "user_stop"}

    run_result = ledger.execute(
        _identity(run_arguments), operation="run",
        executor=lambda: {"ok": True, "data": "run"},
    )
    cancel_result = ledger.execute(
        _identity(cancel_arguments, tool="computer_use_cancel"),
        operation="cancel",
        executor=lambda: {"ok": True, "data": "cancel"},
    )

    assert run_result["data"] == "run"
    assert cancel_result["data"] == "cancel"
    assert ledger.size == 2


def test_concurrent_replay_waits_for_and_returns_single_unknown_outcome() -> None:
    ledger = InvocationLedger()
    arguments = {"sessionId": "session-1", "semanticAction": {"kind": "click"}}
    first_started = threading.Event()
    release_first = threading.Event()
    execution_count = 0
    count_lock = threading.Lock()

    def execute() -> dict:
        nonlocal execution_count
        with count_lock:
            execution_count += 1
        first_started.set()
        assert release_first.wait(timeout=2)
        return {
            "ok": False,
            "error": {
                "code": "ACTION_OUTCOME_UNKNOWN",
                "message": "response was lost after dispatch",
                "retryable": False,
                "details": {"mayHaveTakenEffect": True},
            },
        }

    first_identity = _identity(arguments, request_id="request-1", proof_id="proof-1")
    replay_identity = _identity(arguments, request_id="request-2", proof_id="proof-2")
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(
            ledger.execute, first_identity,
            operation="run", executor=execute,
        )
        assert first_started.wait(timeout=2)
        replay = pool.submit(
            ledger.execute, replay_identity,
            operation="run",
            executor=lambda: pytest.fail("concurrent replay must not execute"),
        )
        release_first.set()
        first_result = first.result(timeout=2)
        replay_result = replay.result(timeout=2)

    assert execution_count == 1
    assert replay_result == first_result
    assert replay_result["error"]["details"]["mayHaveTakenEffect"] is True


def test_capacity_fails_closed_without_evicting_terminal_result() -> None:
    ledger = InvocationLedger(max_entries=1)
    arguments = {"sessionId": "session-1"}
    first_identity = _identity(arguments)
    expected = {"ok": False, "error": {"code": "FAILED", "retryable": False}}
    assert ledger.execute(
        first_identity, operation="release_session",
        executor=lambda: expected,
    ) == expected

    with pytest.raises(InvocationLedgerError) as capacity:
        ledger.execute(
            _identity(arguments, invocation_id="invocation-2"),
            operation="release_session",
            executor=lambda: pytest.fail("capacity rejection must not execute"),
        )
    assert capacity.value.code == "INVOCATION_LEDGER_CAPACITY"
    assert ledger.execute(
        first_identity, operation="release_session",
        executor=lambda: pytest.fail("terminal result must not be evicted"),
    ) == expected
