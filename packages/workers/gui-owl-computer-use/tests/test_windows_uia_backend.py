from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest

from cua import result as R
from cua.capabilities import BackendId, Verification
from cua.service import ComputerUseService
from cua.target import parse_target_descriptor
from driver.backend import BackendOpenContext, BackendOperationError
from driver.backends.windows_uia import (
    UIAActionResult,
    UIAActionUnsupported,
    UIAProvider,
    UIASnapshot,
    UIATargetLost,
    WindowsUIABackend,
)
from driver.channel import ChannelError
from driver.router import BackendRouter


def target(index: int):
    return {
        "targetId": f"uia-target-{index}",
        "kind": "windows-uia",
        "locator": {"processId": 1000 + index, "automationId": f"Editor-{index}"},
    }


class FakeUIAProvider(UIAProvider):
    def __init__(self):
        self._lock = threading.Lock()
        self._values = {f"uia-target-{index}": "" for index in range(3)}
        self._revisions = {f"uia-target-{index}": 0 for index in range(3)}
        self.open_identities: set[str] = set()
        self.fail_target: str | None = None

    def available(self):
        return True, None

    def discover(self):
        return [parse_target_descriptor(target(index)) for index in range(3)]

    def open(self, value):
        identity = f"identity:{value.target_id}"
        with self._lock:
            self.open_identities.add(identity)
        return identity

    def snapshot(self, value, identity):
        self._validate(value.target_id, identity)
        with self._lock:
            revision = self._revisions[value.target_id]
            text = self._values[value.target_id]
        return UIASnapshot(
            revision=f"uia:{revision}",
            nodes=({"automationId": value.locator.get("automationId", ""), "name": text},),
        )

    def perform(self, value, identity, action):
        self._validate(value.target_id, identity)
        if self.fail_target == value.target_id:
            raise RuntimeError("provider failed after dispatch")
        name = str(action.get("action") or "")
        if name in {"key", "hotkey"}:
            raise UIAActionUnsupported("focus-dependent keyboard input is unsupported")
        text = str(action.get("text") or action.get("value") or "")
        with self._lock:
            self._values[value.target_id] = text
            self._revisions[value.target_id] += 1
            revision = self._revisions[value.target_id]
        return UIAActionResult(
            Verification.VERIFIED,
            f"uia:{revision}",
            {"expected": text, "actual": text, "pattern": "Value"},
        )

    def read(self, target_id):
        with self._lock:
            return self._values[target_id]

    def lose(self, target_id):
        with self._lock:
            self.open_identities.discard(f"identity:{target_id}")

    def _validate(self, target_id, identity):
        with self._lock:
            valid = identity == f"identity:{target_id}" and identity in self.open_identities
        if not valid:
            raise UIATargetLost("runtime identity changed")


def backend_handle(index=0):
    provider = FakeUIAProvider()
    backend = WindowsUIABackend(provider)
    descriptor = parse_target_descriptor(target(index))
    context = BackendOpenContext(f"request-{index}", True, 0, False, threading.Event())
    return provider, backend, backend.open(descriptor, context)


def test_capability_is_semantic_target_scoped_and_never_host_input():
    provider = FakeUIAProvider()
    capability = WindowsUIABackend(provider).probe()
    assert capability.backend is BackendId.WINDOWS_UIA
    assert capability.available is True
    assert capability.requires_host_focus is False
    assert capability.affects_user_input is False
    assert capability.uses_host_clipboard is False
    assert "key" not in capability.actions


def test_value_pattern_style_action_is_read_back_and_verified():
    provider, backend, handle = backend_handle()
    before = backend.observe(handle)
    receipt = backend.perform(
        handle,
        {"action": "write", "automationId": "Editor-0", "text": "alpha"},
        before.revision,
    )
    evidence = backend.verify(handle, {"action": "write"}, receipt, before)
    assert evidence.status is Verification.VERIFIED
    assert evidence.details == {"expected": "alpha", "actual": "alpha", "pattern": "Value"}
    assert provider.read("uia-target-0") == "alpha"
    backend.close(handle, "done")
    backend.close(handle, "again")


def test_semantic_revision_change_rejects_action_before_commit():
    provider, backend, handle = backend_handle()
    before = backend.observe(handle)
    provider.perform(handle.target, handle.identity, {"action": "write", "text": "external"})
    with pytest.raises(BackendOperationError) as caught:
        backend.perform(handle, {"action": "write", "text": "bad"}, before.revision)
    assert getattr(caught.value, "code", None) == "STALE_OBSERVATION"
    assert getattr(caught.value, "may_have_taken_effect", None) is False
    assert provider.read("uia-target-0") == "external"


def test_coordinate_only_action_is_rejected_before_provider_dispatch():
    provider, backend, handle = backend_handle()
    before = backend.observe(handle)
    with pytest.raises(BackendOperationError) as caught:
        backend.perform(handle, {"action": "click", "coordinate": [10, 20]}, before.revision)
    assert caught.value.code == "ACTION_UNSUPPORTED"
    assert caught.value.may_have_taken_effect is False
    assert provider.read("uia-target-0") == ""


def test_target_identity_loss_is_structured_and_has_no_side_effect():
    provider, backend, handle = backend_handle()
    provider.lose("uia-target-0")
    with pytest.raises(BackendOperationError) as caught:
        backend.observe(handle)
    assert getattr(caught.value, "code", None) == "TARGET_LOST"
    assert provider.read("uia-target-0") == ""


def test_open_failure_is_safe_to_release_because_uia_open_owns_no_external_handle():
    provider = FakeUIAProvider()

    def fail_open(_target):
        raise RuntimeError("COM initialization failed before identity resolution")

    provider.open = fail_open
    backend = WindowsUIABackend(provider)
    context = BackendOpenContext("request-open-failed", True, 0, False, threading.Event())
    with pytest.raises(BackendOperationError) as caught:
        backend.open(parse_target_descriptor(target(0)), context)
    assert caught.value.code == "BACKEND_UNAVAILABLE"
    assert caught.value.safe_to_retry is True


def test_three_uia_sessions_interleave_without_semantic_cross_line():
    provider = FakeUIAProvider()
    backend = WindowsUIABackend(provider)
    service = ComputerUseService(router=BackendRouter([backend]))
    for index in range(3):
        bound = service.bind_session({
            "sessionId": f"uia-session-{index}",
            "owner": {"runtimeId": "runtime", "threadId": f"thread-{index}"},
            "target": target(index),
        })
        assert bound["ok"] is True
    observed = Barrier(3)

    def execute(index, _request, channel):
        observation = channel.observe()
        observed.wait(timeout=2)
        outcome = channel.perform(
            {"action": "write", "automationId": f"Editor-{index}", "text": f"value-{index}"},
            expected_revision=observation.revision,
        )
        return R.ok({"status": "done", "targetId": outcome.target_id})

    def run(index):
        return service.run(
            {
                "instruction": "write through UIA",
                "sessionId": f"uia-session-{index}",
                "requestId": f"uia-request-{index}",
            },
            lambda request, channel: execute(index, request, channel),
        )

    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(run, range(3)))

    assert all(result["ok"] is True for result in results)
    assert [provider.read(f"uia-target-{index}") for index in range(3)] == [
        "value-0", "value-1", "value-2",
    ]
    counts = service.registry.snapshot_counts()
    assert counts["requests"] == counts["activeLeases"] == 0


def test_focus_dependent_key_is_rejected_at_channel_capability_boundary():
    provider = FakeUIAProvider()
    service = ComputerUseService(router=BackendRouter([WindowsUIABackend(provider)]))

    def execute(_request, channel):
        observation = channel.observe()
        try:
            channel.perform({"action": "key", "keys": ["enter"]}, expected_revision=observation.revision)
        except ChannelError as error:
            return R.err(error.code, str(error))
        return R.ok({"status": "incorrect"})

    result = service.run(
        {"instruction": "press enter", "target": target(0), "requestId": "uia-key-request"},
        execute,
    )
    assert result["error"]["code"] == "ACTION_UNSUPPORTED"
    assert provider.read("uia-target-0") == ""


def test_one_uia_provider_failure_does_not_cross_other_sessions():
    provider = FakeUIAProvider()
    provider.fail_target = "uia-target-1"
    service = ComputerUseService(router=BackendRouter([WindowsUIABackend(provider)]))
    barrier = Barrier(3)

    def execute(index, _request, channel):
        observation = channel.observe()
        barrier.wait(timeout=2)
        try:
            outcome = channel.perform(
                {"action": "write", "automationId": f"Editor-{index}", "text": f"safe-{index}"},
                expected_revision=observation.revision,
            )
            return R.ok({"status": "done", "targetId": outcome.target_id})
        except ChannelError as error:
            return R.err(error.code, str(error))

    def run(index):
        return service.run(
            {"instruction": "write", "target": target(index), "requestId": f"failure-request-{index}"},
            lambda request, channel: execute(index, request, channel),
        )

    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(run, range(3)))

    assert results[0]["ok"] is True
    assert results[1]["error"]["code"] == "ACTION_OUTCOME_UNKNOWN"
    assert results[2]["ok"] is True
    assert provider.read("uia-target-0") == "safe-0"
    assert provider.read("uia-target-1") == ""
    assert provider.read("uia-target-2") == "safe-2"
    assert service.registry.snapshot_counts()["activeLeases"] == 0


def test_target_lost_maps_through_channel_and_cleans_lease():
    provider = FakeUIAProvider()
    service = ComputerUseService(router=BackendRouter([WindowsUIABackend(provider)]))

    def execute(_request, channel):
        provider.lose(channel.target.target_id)
        try:
            channel.observe()
        except ChannelError as error:
            return R.err(error.code, str(error))
        return R.ok({"status": "incorrect"})

    result = service.run(
        {"instruction": "observe", "target": target(0), "requestId": "target-lost-request"},
        execute,
    )
    assert result["error"]["code"] == "TARGET_LOST"
    assert service.registry.snapshot_counts()["activeLeases"] == 0
