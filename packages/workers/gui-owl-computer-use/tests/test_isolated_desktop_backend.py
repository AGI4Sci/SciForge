from __future__ import annotations

import threading
import uuid

import pytest
from PIL import Image

from cua.capabilities import Verification
from cua.isolation import RequestedIsolation, decide_isolation
from cua.session_registry import LeaseScope, RequestState, SessionOwner, SessionRegistry
from cua.service import ComputerUseService
from cua.target import TargetDescriptor, parse_target_descriptor
from driver.backend import (
    ActionReceipt,
    BackendOpenContext,
    Observation,
    VerificationEvidence,
)
from driver.backends.isolated_desktop import (
    ISOLATED_DESKTOP_UNAVAILABLE,
    IsolatedDesktopBackend,
    IsolatedProviderStatus,
)
from driver.channel import SessionInputChannel
from driver.router import BackendRouter, RoutingError


def isolated_target(
    target_id: str, environment_id: str, *, ownership: str = "attached",
) -> TargetDescriptor:
    return parse_target_descriptor({
        "targetId": target_id,
        "kind": "isolated-desktop",
        "ownership": ownership,
        "locator": {"isolatedEnvironmentId": environment_id},
    })


class FakeIsolatedProvider:
    def __init__(self) -> None:
        self.targets = [isolated_target("isolated-a", "env-a")]
        self.values: dict[str, list[str]] = {}
        self.revisions: dict[str, int] = {}
        self.connected: list[str] = []
        self.closed: list[str] = []
        self.destroyed: list[str] = []
        self.cancelled: list[str] = []
        self.fail_destroy = False

    def probe(self):
        return IsolatedProviderStatus(available=True, max_concurrency=8)

    def discover_environments(self, filters=None):
        return list(self.targets)

    def provision(self, spec):
        target = isolated_target(str(spec["targetId"]), str(spec["environmentId"]), ownership="managed")
        self.targets.append(target)
        return target

    def connect(self, target, context):
        self.connected.append(target.target_id)
        self.revisions.setdefault(target.target_id, 0)
        return target

    def observe(self, handle):
        revision = self.revisions[handle.target_id]
        return Observation(
            target_id=handle.target_id,
            revision=f"isolated:{revision}",
            image=Image.new("RGB", (8, 8)),
            backend="isolated-desktop",
        )

    def perform(self, handle, action, expected_revision):
        self.values.setdefault(handle.target_id, []).append(str(action.get("text", "")))
        self.revisions[handle.target_id] += 1
        return ActionReceipt(
            action_id=f"action-{uuid.uuid4()}",
            target_id=handle.target_id,
            revision_before=expected_revision,
            committed=True,
            may_have_taken_effect=True,
        )

    def verify(self, handle, action, receipt, before):
        return VerificationEvidence(
            status=Verification.VERIFIED,
            target_id=handle.target_id,
            revision_after=f"isolated:{self.revisions[handle.target_id]}",
        )

    def cancel(self, handle, reason):
        self.cancelled.append(handle.target_id)

    def close(self, handle, reason):
        if handle.target_id not in self.closed:
            self.closed.append(handle.target_id)

    def destroy(self, target, reason):
        if self.fail_destroy:
            raise RuntimeError("destroy failed")
        if target.target_id not in self.destroyed:
            self.destroyed.append(target.target_id)


def open_context(request_id: str) -> BackendOpenContext:
    return BackendOpenContext(request_id, True, 0, False, threading.Event())


def test_default_provider_is_explicitly_unavailable():
    backend = IsolatedDesktopBackend()
    capability = backend.probe()
    assert capability.available is False
    assert ISOLATED_DESKTOP_UNAVAILABLE in capability.reason
    assert backend.discover_targets() == []


def test_router_preserves_structured_isolated_unavailable_error():
    backend = IsolatedDesktopBackend()
    router = BackendRouter([backend])
    registry = SessionRegistry()
    target = isolated_target("isolated-missing", "env-missing")
    registry.bind_session(SessionOwner("runtime-1", "thread-1"), target, session_id="session-1")
    registry.begin_request("session-1", "request-1")
    with pytest.raises(RoutingError) as caught:
        router.route(
            registry=registry,
            request_id="request-1",
            target=target,
            requested=RequestedIsolation.AGENT_ISOLATED,
            allow_degraded=False,
            approval_context=True,
            required_actions=("observe",),
            open_context=open_context("request-1"),
        )
    assert caught.value.code == ISOLATED_DESKTOP_UNAVAILABLE

    service = ComputerUseService(router=BackendRouter([backend]))
    result = service.run(
        {
            "instruction": "use isolated environment",
            "target": target.to_dict(include_sensitive=True),
            "requestedIsolation": "agent-isolated",
        },
        lambda _request, _channel: (_ for _ in ()).throw(AssertionError("must not execute")),
    )
    assert result["error"]["code"] == ISOLATED_DESKTOP_UNAVAILABLE


def test_provider_lifecycle_and_managed_destroy_are_explicit():
    provider = FakeIsolatedProvider()
    backend = IsolatedDesktopBackend(provider)
    target = backend.provision({"targetId": "isolated-managed", "environmentId": "env-managed"})
    handle = backend.open(target, open_context("request-1"))
    before = backend.observe(handle)
    receipt = backend.perform(handle, {"action": "type", "text": "hello"}, before.revision)
    evidence = backend.verify(handle, {"action": "type"}, receipt, before)
    backend.close(handle, "completed")
    backend.close(handle, "completed")
    assert evidence.status is Verification.VERIFIED
    assert provider.values[target.target_id] == ["hello"]
    assert provider.closed == [target.target_id]
    assert provider.destroyed == [target.target_id]

    attached = isolated_target("isolated-attached", "env-attached")
    attached_handle = backend.open(attached, open_context("request-2"))
    backend.close(attached_handle, "completed")
    assert "isolated-attached" in provider.closed
    assert "isolated-attached" not in provider.destroyed


def test_destroy_failure_keeps_lease_until_retry_succeeds():
    provider = FakeIsolatedProvider()
    provider.fail_destroy = True
    backend = IsolatedDesktopBackend(provider)
    target = isolated_target("isolated-managed", "env-managed", ownership="managed")
    registry = SessionRegistry()
    registry.bind_session(SessionOwner("runtime-1", "thread-1"), target, session_id="session-1")
    registry.begin_request("session-1", "request-1")
    lease = registry.acquire_lease(
        "request-1", backend="isolated-desktop", scope=LeaseScope.ENVIRONMENT,
        scope_key="env-managed",
    )
    handle = backend.open(target, open_context("request-1"))
    channel = SessionInputChannel(
        registry=registry,
        session_id="session-1",
        request_id="request-1",
        target=target,
        lease=lease,
        backend=backend,
        handle=handle,
        capabilities=backend.probe(),
        isolation=decide_isolation(
            RequestedIsolation.AGENT_ISOLATED,
            backend.probe().effective_isolation,
            allow_degraded=False,
            approval_context=True,
        ),
        cancellation=registry.cancellation_event("request-1"),
        deadline=None,
    )
    first = channel.close("failed")
    assert first.closed is False
    assert first.lease_released is False
    assert registry.snapshot_counts()["activeLeases"] == 1
    provider.fail_destroy = False
    second = channel.close("retry")
    assert second.closed is second.lease_released is True
    assert registry.snapshot_counts()["activeLeases"] == 0


def test_environment_scope_serializes_same_environment_not_different_ones():
    provider = FakeIsolatedProvider()
    backend = IsolatedDesktopBackend(provider)
    router = BackendRouter([backend])
    registry = SessionRegistry()
    targets = [
        isolated_target("target-a1", "env-a"),
        isolated_target("target-a2", "env-a"),
        isolated_target("target-b", "env-b"),
    ]
    for index, target in enumerate(targets):
        registry.bind_session(
            SessionOwner("runtime-1", f"thread-{index}"), target,
            session_id=f"session-{index}",
        )
        registry.begin_request(f"session-{index}", f"request-{index}")

    def route(index: int):
        return router.route(
            registry=registry,
            request_id=f"request-{index}",
            target=targets[index],
            requested=RequestedIsolation.AGENT_ISOLATED,
            allow_degraded=False,
            approval_context=True,
            required_actions=("observe",),
            open_context=open_context(f"request-{index}"),
        )

    first = route(0)
    with pytest.raises(RoutingError) as caught:
        route(1)
    assert caught.value.code == "TARGET_BUSY"
    different = route(2)
    assert first.lease.scope_key == "environment:env-a"
    assert different.lease.scope_key == "environment:env-b"
    for selection in (first, different):
        selection.backend.close(selection.handle, "done")
        registry.release_lease(selection.lease.lease_id, "done")
        registry.finish_request(selection.lease.request_id, RequestState.COMPLETED)
