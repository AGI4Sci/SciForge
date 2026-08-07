import threading

import pytest

from cua.capabilities import BackendId
from cua.isolation import IsolationLevel, RequestedIsolation
from cua.session_registry import LeaseScope, SessionOwner, SessionRegistry
from cua.target import TargetKind, host_desktop_target, parse_target_descriptor
from driver.backend import BackendOpenContext, BackendOperationError
from driver.router import BackendRouter, RoutingError
from tests.fakes.fake_backend import FakeBackend


def uia_target(target_id="target-1"):
    return parse_target_descriptor({
        "targetId": target_id,
        "kind": "windows-uia",
        "locator": {"processId": 42, "automationId": "Editor"},
    })


def route(backend, *, requested=RequestedIsolation.AUTO, degraded=False, approved=False, target=None):
    registry = SessionRegistry()
    target = target or uia_target()
    session = registry.bind_session(SessionOwner("runtime", "thread"), target, session_id="session-1")
    registry.begin_request(session.session_id, "request-1")
    context = BackendOpenContext("request-1", True, 0, False, threading.Event())
    selection = BackendRouter([backend]).route(
        registry=registry,
        request_id="request-1",
        target=target,
        requested=requested,
        allow_degraded=degraded,
        approval_context=approved,
        required_actions=("observe", "write"),
        open_context=context,
    )
    return registry, selection


def test_router_selects_matching_backend_and_acquires_target_lease():
    registry, selection = route(FakeBackend())
    assert selection.capabilities.backend is BackendId.WINDOWS_UIA
    assert selection.lease.scope is LeaseScope.TARGET
    assert selection.lease.target_id == "target-1"
    selection.backend.close(selection.handle, "test")
    registry.release_lease(selection.lease.lease_id, "test")


def test_router_rejects_explicit_stronger_isolation_without_degradation():
    with pytest.raises(RoutingError) as caught:
        route(FakeBackend(), requested=RequestedIsolation.AGENT_ISOLATED)
    assert caught.value.code == "ISOLATION_UNAVAILABLE"


def test_router_reports_explicit_degradation_reason():
    registry, selection = route(
        FakeBackend(isolation=IsolationLevel.HOST_APP_SCOPED),
        requested=RequestedIsolation.AGENT_ISOLATED,
        degraded=True,
    )
    assert selection.decision.degraded is True
    assert selection.decision.degraded_reason == "REQUESTED_AGENT_ISOLATED_UNAVAILABLE"
    selection.backend.close(selection.handle, "test")
    registry.release_lease(selection.lease.lease_id, "test")


def test_router_requires_approval_for_legacy_backend():
    backend = FakeBackend(
        backend_id=BackendId.LEGACY_PYAUTOGUI,
        isolation=IsolationLevel.HOST_APPROVED,
        target_kinds=(TargetKind.HOST_DESKTOP,),
        actions=("observe", "write"),
        lease_scope=LeaseScope.PROCESS_GLOBAL,
    )
    with pytest.raises(RoutingError) as caught:
        route(backend, target=host_desktop_target())
    assert caught.value.code == "NEEDS_APPROVAL"


def test_router_retries_only_after_open_failed_before_handle_exists():
    first = FakeBackend(fail_open=True)
    second = FakeBackend()
    registry = SessionRegistry()
    target = uia_target()
    registry.bind_session(SessionOwner("runtime", "thread"), target, session_id="session-1")
    registry.begin_request("session-1", "request-1")
    selection = BackendRouter([first, second]).route(
        registry=registry,
        request_id="request-1",
        target=target,
        requested=RequestedIsolation.AUTO,
        allow_degraded=False,
        approval_context=False,
        required_actions=("observe", "write"),
        open_context=BackendOpenContext("request-1", False, 0, False, threading.Event()),
    )
    assert selection.backend is second
    assert registry.snapshot_counts()["activeLeases"] == 1


def test_router_quarantines_unclassified_open_failure_without_trying_fallback():
    first = FakeBackend()
    second = FakeBackend()

    def unknown_open(_target, _context):
        raise RuntimeError("transport disappeared after open dispatch")

    first.open = unknown_open
    registry = SessionRegistry()
    target = uia_target()
    registry.bind_session(SessionOwner("runtime", "thread"), target, session_id="session-1")
    registry.begin_request("session-1", "request-1")

    with pytest.raises(RoutingError) as caught:
        BackendRouter([first, second]).route(
            registry=registry,
            request_id="request-1",
            target=target,
            requested=RequestedIsolation.AUTO,
            allow_degraded=False,
            approval_context=False,
            required_actions=("observe", "write"),
            open_context=BackendOpenContext(
                "request-1", False, 0, False, threading.Event(),
            ),
        )

    assert caught.value.code == "CLEANUP_INCOMPLETE"
    assert caught.value.details["retainLease"] is True
    assert registry.snapshot_counts()["activeLeases"] == 1
    assert second.open_handle_count == 0


def test_router_preserves_structured_safe_open_failure_when_no_candidate_succeeds():
    backend = FakeBackend()

    def stale_generation(_target, _context):
        raise BackendOperationError(
            "adapter generation changed", code="TARGET_LOST", safe_to_retry=True,
        )

    backend.open = stale_generation
    with pytest.raises(RoutingError) as caught:
        route(backend)
    assert caught.value.code == "TARGET_LOST"
