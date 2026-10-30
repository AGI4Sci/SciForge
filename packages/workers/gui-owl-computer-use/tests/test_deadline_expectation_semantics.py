from __future__ import annotations

import time

from cua.invocation_proof import InvocationIdentity
from cua.runner import run_task
from cua.service import ComputerUseService
from cua.target import TargetDescriptor, TargetKind, TargetOwnership
from driver.router import BackendRouter
from tests.fakes.fake_backend import FakeCdpBackend


def _target() -> TargetDescriptor:
    return TargetDescriptor(
        target_id="target-deadline",
        kind=TargetKind.BROWSER_PAGE,
        ownership=TargetOwnership.ATTACHED,
        locator={"cdpEndpoint": "http://127.0.0.1:9222", "cdpTargetId": "deadline"},
        generation="generation-deadline",
    )


def _identity(request_id: str) -> InvocationIdentity:
    return InvocationIdentity(
        f"proof-{request_id}", request_id, "codex", "thread-deadline",
        "turn-deadline", "call-deadline", f"invocation-{request_id}", "computer_use",
    )


def _bound() -> tuple[ComputerUseService, FakeCdpBackend, str]:
    backend = FakeCdpBackend(_target())
    service = ComputerUseService(router=BackendRouter([backend]))
    result = service.bind_session({"target": _target().to_dict()}, _identity("bind-deadline"))
    assert result["ok"]
    return service, backend, result["data"]["sessionId"]


def _click(expect: dict | None = None) -> dict:
    action = {"kind": "click", "role": "button", "name": "Commit"}
    if expect is not None:
        action["expect"] = expect
    return action


def test_deadline_after_action_dispatch_is_unknown_outcome() -> None:
    service, backend, session_id = _bound()
    original_perform = backend.perform

    def perform_then_cross_deadline(handle, action, expected_revision):
        receipt = original_perform(handle, action, expected_revision)
        time.sleep(0.03)
        return receipt

    backend.perform = perform_then_cross_deadline
    result = service.run(
        {"sessionId": session_id, "deadlineMs": 5, "semanticAction": _click()},
        run_task,
        invocation=_identity("run-deadline"),
    )

    assert backend.actions == 1
    assert result["error"]["code"] == "ACTION_OUTCOME_UNKNOWN"
    assert result["error"]["details"]["mayHaveTakenEffect"] is True


def test_cancel_after_action_dispatch_is_unknown_outcome() -> None:
    service, backend, session_id = _bound()
    original_perform = backend.perform

    def perform_then_cancel(handle, action, expected_revision):
        receipt = original_perform(handle, action, expected_revision)
        handle.context.cancellation.set()
        return receipt

    backend.perform = perform_then_cancel
    result = service.run(
        {"sessionId": session_id, "semanticAction": _click()},
        run_task,
        invocation=_identity("run-cancel"),
    )

    assert backend.actions == 1
    assert result["error"]["code"] == "ACTION_OUTCOME_UNKNOWN"
    assert result["error"]["details"]["mayHaveTakenEffect"] is True


def test_expectation_without_deadline_waits_for_delayed_readback() -> None:
    service, backend, session_id = _bound()
    original_observe = backend.observe
    original_perform = backend.perform
    ready_at: float | None = None

    def delayed_perform(handle, action, expected_revision):
        nonlocal ready_at
        receipt = original_perform(handle, action, expected_revision)
        backend.text = "Pending"
        ready_at = time.monotonic() + 0.1
        return receipt

    def delayed_observe(handle):
        if ready_at is not None and time.monotonic() >= ready_at:
            backend.text = "Committed later"
        return original_observe(handle)

    backend.perform = delayed_perform
    backend.observe = delayed_observe
    result = service.run(
        {
            "sessionId": session_id,
            "semanticAction": _click({
                "kind": "text-present", "text": "Committed later", "stableForMs": 0,
            }),
        },
        run_task,
        invocation=_identity("run-no-deadline"),
    )

    assert result["ok"]
    assert result["data"]["verification"]["matched"] is True


def test_stable_for_ms_can_exceed_discovery_window() -> None:
    service, _backend, session_id = _bound()
    started = time.monotonic()
    result = service.run(
        {
            "sessionId": session_id,
            "deadlineMs": 4500,
            "semanticAction": _click({
                "kind": "text-present", "text": "Committed", "stableForMs": 3100,
            }),
        },
        run_task,
        invocation=_identity("run-stable"),
    )

    assert result["ok"]
    assert result["data"]["verification"]["matched"] is True
    assert time.monotonic() - started >= 3.0
