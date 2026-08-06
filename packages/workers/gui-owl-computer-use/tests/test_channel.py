import pytest

from cua.isolation import RequestedIsolation
from cua.session_registry import RequestState, SessionOwner, SessionRegistry
from cua.target import parse_target_descriptor
from driver.backend import BackendOpenContext
from driver.channel import ChannelError, SessionInputChannel
from driver.router import BackendRouter
from tests.fakes.fake_backend import FakeBackend


def make_channel(*, backend=None, target_id="target-1"):
    registry = SessionRegistry()
    target = parse_target_descriptor({
        "targetId": target_id,
        "kind": "windows-uia",
        "locator": {"processId": 42},
    })
    registry.bind_session(SessionOwner("runtime", "thread"), target, session_id="session-1")
    registry.begin_request("session-1", "request-1")
    cancellation = registry.cancellation_event("request-1")
    backend = backend or FakeBackend()
    selection = BackendRouter([backend]).route(
        registry=registry,
        request_id="request-1",
        target=target,
        requested=RequestedIsolation.AUTO,
        allow_degraded=False,
        approval_context=False,
        required_actions=("observe", "write"),
        open_context=BackendOpenContext("request-1", True, 0, False, cancellation),
    )
    registry.transition_request("request-1", RequestState.RUNNING)
    channel = SessionInputChannel(
        registry=registry,
        session_id="session-1",
        request_id="request-1",
        target=target,
        lease=selection.lease,
        backend=selection.backend,
        handle=selection.handle,
        capabilities=selection.capabilities,
        isolation=selection.decision,
        cancellation=cancellation,
        deadline=None,
    )
    return registry, backend, channel


def test_channel_binds_observation_action_and_verification_to_one_target():
    registry, backend, channel = make_channel()
    observation = channel.observe()
    outcome = channel.perform({"action": "write", "value": "alpha"}, expected_revision=observation.revision)
    assert outcome.target_id == observation.target_id == "target-1"
    assert outcome.verification.value == "verified"
    assert backend.read("target-1") == ("alpha",)
    cleanup = channel.close("completed")
    assert cleanup.closed and cleanup.lease_released
    assert registry.snapshot_counts()["activeLeases"] == 0


def test_channel_rejects_stale_observation_before_backend_action():
    _, backend, channel = make_channel()
    channel.observe()
    with pytest.raises(ChannelError) as caught:
        channel.perform({"action": "write", "value": "bad"}, expected_revision="fake:stale")
    assert caught.value.code == "STALE_OBSERVATION"
    assert backend.read("target-1") == ()
    channel.close("test")


def test_channel_cancel_before_action_prevents_commit():
    registry, backend, channel = make_channel()
    observation = channel.observe()
    registry.request_cancel("request-1", "test")
    with pytest.raises(ChannelError) as caught:
        channel.perform({"action": "write", "value": "bad"}, expected_revision=observation.revision)
    assert caught.value.code == "CANCEL_PENDING"
    assert backend.read("target-1") == ()
    channel.close("cancelled")


def test_channel_close_quarantines_lease_until_backend_close_retry_succeeds():
    registry, backend, channel = make_channel(backend=FakeBackend(fail_close=True))
    first = channel.close("failed")
    assert first.closed is False
    assert first.lease_released is False
    assert first.errors == ["backend close: fake close failed"]
    assert backend.open_handle_count == 1
    assert registry.snapshot_counts()["activeLeases"] == 1

    backend.fail_close = False
    second = channel.close("retry")
    assert first is second
    assert second.closed is True
    assert second.lease_released is True
    assert first.errors == ["backend close: fake close failed"]
    assert backend.open_handle_count == 0
    assert registry.snapshot_counts()["activeLeases"] == 0

    assert channel.close("idempotent") is second


def test_channel_surfaces_unknown_action_outcome_as_non_retryable_classification():
    _, _, channel = make_channel(backend=FakeBackend(fail_action_target="target-1"))
    observation = channel.observe()
    with pytest.raises(ChannelError) as caught:
        channel.perform({"action": "write", "value": "maybe"}, expected_revision=observation.revision)
    assert caught.value.code == "ACTION_OUTCOME_UNKNOWN"
    channel.close("outcome_unknown")
