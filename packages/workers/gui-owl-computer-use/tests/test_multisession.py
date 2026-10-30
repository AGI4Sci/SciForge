from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import threading
import time

import pytest

from cua.invocation_proof import InvocationIdentity
from cua.runner import run_task
from cua.service import ComputerUseService
from cua.target import TargetDescriptor, TargetKind, TargetOwnership
from driver.router import BackendRouter
from tests.fakes.fake_backend import FakeCdpBackend


def _target(index: int) -> TargetDescriptor:
    return TargetDescriptor(
        target_id=f"target-{index}",
        kind=TargetKind.BROWSER_PAGE,
        ownership=TargetOwnership.ATTACHED,
        locator={
            "cdpEndpoint": "http://127.0.0.1:9222",
            "cdpTargetId": f"page-{index}",
        },
        generation=f"generation-{index}",
    )


def _identity(index: int, operation: str) -> InvocationIdentity:
    return InvocationIdentity(
        f"proof-{index}-{operation}", f"request-{index}-{operation}", "codex",
        f"child-thread-{index}", f"child-turn-{index}", f"call-{index}-{operation}",
        f"invocation-{index}-{operation}", "computer_use",
    )


class OverlapBackend(FakeCdpBackend):
    def __init__(self, target: TargetDescriptor, barrier: threading.Barrier) -> None:
        super().__init__(target)
        self.barrier = barrier
        self.action_span: tuple[float, float] | None = None

    def perform(self, handle, action, expected_revision):
        self.barrier.wait(timeout=5)
        started = time.perf_counter()
        time.sleep(0.03)
        result = super().perform(handle, action, expected_revision)
        self.action_span = (started, time.perf_counter())
        return result


def _bound_service(count: int):
    barrier = threading.Barrier(count)
    backends = [OverlapBackend(_target(index), barrier) for index in range(count)]
    service = ComputerUseService(router=BackendRouter(backends))
    sessions: list[str] = []
    for index in range(count):
        result = service.bind_session(
            {"target": _target(index).to_dict()}, _identity(index, "bind")
        )
        assert result["ok"]
        sessions.append(result["data"]["sessionId"])
    return service, backends, sessions


@pytest.mark.parametrize("count", [2, 4, 8])
def test_child_owned_sessions_execute_distinct_targets_with_real_action_overlap(count: int):
    service, backends, sessions = _bound_service(count)

    def execute(index: int):
        return service.run(
            {
                "sessionId": sessions[index],
                "semanticAction": {"kind": "click", "role": "button", "name": "Commit"},
            },
            run_task,
            invocation=_identity(index, "action"),
        )

    with ThreadPoolExecutor(max_workers=count) as pool:
        results = list(pool.map(execute, range(count)))
    assert all(result["ok"] for result in results)
    spans = [backend.action_span for backend in backends]
    assert all(span is not None for span in spans)
    typed_spans = [span for span in spans if span is not None]
    assert min(end for _, end in typed_spans) > max(start for start, _ in typed_spans)
    assert all(backend.actions == 1 for backend in backends)

    for index, session_id in enumerate(sessions):
        assert service.release_session(
            {"sessionId": session_id}, _identity(index, "release")
        )["ok"]
    runtime = service.capabilities()["runtime"]
    assert runtime["counts"]["sessions"] == 0
    assert runtime["counts"]["requests"] == 0
    assert runtime["counts"]["activeLeases"] == 0
    assert runtime["activeChannels"] == 0
    assert runtime["cleanupPending"] == 0
    assert runtime["backendHandles"] == 0


def test_four_sessions_fixed_hundred_round_gate_returns_every_resource_to_baseline():
    service, backends, sessions = _bound_service(4)
    # Replace the one-shot barrier after proving overlap; the soak gate checks
    # deterministic ownership and resource return rather than concurrency.
    for backend in backends:
        backend.barrier = threading.Barrier(1)
    for round_index in range(100):
        for index, session_id in enumerate(sessions):
            result = service.run(
                {"sessionId": session_id, "semanticAction": {"kind": "observe"}},
                run_task,
                invocation=InvocationIdentity(
                    f"proof-{round_index}-{index}", f"soak-{round_index}-{index}",
                    "codex", f"child-thread-{index}", f"child-turn-{index}",
                    f"call-{round_index}-{index}", f"invocation-{round_index}-{index}",
                    "computer_use",
                ),
            )
            assert result["ok"]
    runtime = service.capabilities()["runtime"]
    assert runtime["counts"]["requests"] == 0
    assert runtime["counts"]["activeLeases"] == 0
    assert runtime["activeChannels"] == 0
    assert runtime["cleanupPending"] == 0
    assert runtime["backendHandles"] == 0
    for index, session_id in enumerate(sessions):
        assert service.release_session(
            {"sessionId": session_id}, _identity(index, "release")
        )["ok"]
    assert service.capabilities()["runtime"]["counts"]["sessions"] == 0


def test_one_post_dispatch_unknown_is_not_replayed_and_siblings_complete():
    service, backends, sessions = _bound_service(4)
    for backend in backends:
        backend.barrier = threading.Barrier(1)
    backends[1].unknown_action = True

    def execute(index: int):
        return service.run(
            {
                "sessionId": sessions[index],
                "semanticAction": {"kind": "click", "role": "button", "name": "Commit"},
            },
            run_task,
            invocation=_identity(index, "unknown-action"),
        )

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(execute, range(4)))
    assert results[1]["error"]["code"] == "ACTION_OUTCOME_UNKNOWN"
    assert all(results[index]["ok"] for index in (0, 2, 3))
    assert [backend.actions for backend in backends] == [1, 1, 1, 1]
    for index, session_id in enumerate(sessions):
        assert service.release_session(
            {"sessionId": session_id}, _identity(index, "release-unknown")
        )["ok"]
    runtime = service.capabilities()["runtime"]
    assert runtime["counts"]["sessions"] == 0
    assert runtime["counts"]["requests"] == 0
    assert runtime["activeChannels"] == 0
    assert runtime["backendHandles"] == 0
