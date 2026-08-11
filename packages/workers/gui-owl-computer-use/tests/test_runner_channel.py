import json
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Event

from cua.capabilities import BackendId, Verification

from cua.config import Config
from cua.runner import run_task
from cua.service import ComputerUseService
from cua.session_registry import RequestState
from driver.router import BackendRouter
from driver.backend import Observation
from cua.target import TargetKind
from tests.fakes.fake_backend import FakeBackend


def bind(service):
    service.bind_session({
        "sessionId": "session-1",
        "owner": {"runtimeId": "runtime", "threadId": "thread"},
        "target": {
            "targetId": "target-1",
            "kind": "windows-uia",
            "locator": {"processId": 42},
        },
    })


def config(tmp_path):
    cfg = Config()
    cfg.artifact_dir = str(tmp_path)
    cfg.max_steps = 3
    cfg.allow_execute = True
    cfg.show_overlay = False
    cfg.reflect = False
    return cfg


class SemanticCdpFakeBackend(FakeBackend):
    def __init__(self):
        super().__init__(
            backend_id=BackendId.BROWSER_CDP,
            target_kinds=(TargetKind.BROWSER_PAGE,),
            actions=("observe", "click"),
        )

    def observe(self, handle):
        observation = super().observe(handle)
        committed = bool(self.read(observation.target_id))
        return Observation(
            target_id=observation.target_id,
            revision=observation.revision,
            image=observation.image,
            backend=observation.backend,
            metadata={"semanticTree": [
                {
                    "tag": "button", "role": "", "name": "Commit Alpha",
                    "center": [500, 500], "disabled": False,
                },
                {
                    "tag": "output", "role": "status",
                    "name": "State Alpha: ALPHA_COMMITTED" if committed else "State Alpha: READY",
                    "center": [500, 700], "disabled": False,
                },
            ]},
        )


class SemanticUIAFakeBackend(FakeBackend):
    def __init__(self, *, observe_delay=0.0):
        super().__init__(
            backend_id=BackendId.WINDOWS_UIA,
            target_kinds=(TargetKind.WINDOWS_UIA,),
            actions=("observe", "write", "invoke", "toggle", "wait"),
        )
        self.observe_delay = observe_delay
        self.tokens = []

    def observe(self, handle):
        if self.observe_delay:
            time.sleep(self.observe_delay)
        observation = super().observe(handle)
        values = self.read(observation.target_id)
        revision = observation.revision.split(":", 1)[1]
        text = values[0] if values else ""
        clicks = sum(value == "invoke" for value in values)
        checked = sum(value == "toggle" for value in values) % 2
        return Observation(
            target_id=observation.target_id,
            revision=observation.revision,
            image=observation.image,
            backend=observation.backend,
            metadata={"imageAvailable": False, "semanticTree": [
                {
                    "controlType": 50004, "automationId": "1101", "name": text,
                    "enabled": True, "elementToken": f"token-{revision}-edit",
                },
                {
                    "controlType": 50000, "automationId": "1102", "name": "Commit Alpha",
                    "enabled": True, "elementToken": f"token-{revision}-button",
                },
                {
                    "controlType": 50002, "automationId": "1103", "name": "Check Alpha",
                    "enabled": True, "elementToken": f"token-{revision}-check",
                },
                {
                    "controlType": 50020, "automationId": "1104",
                    "name": f"text={text};clicks={clicks};checked={checked}",
                    "enabled": True, "elementToken": f"token-{revision}-status",
                },
            ]},
        )

    def perform(self, handle, action, expected_revision):
        self.tokens.append(str(action.get("elementToken")))
        return super().perform(handle, action, expected_revision)


def test_semantic_action_observes_clicks_verifies_and_records_timeline(tmp_path):
    backend = SemanticCdpFakeBackend()
    service = ComputerUseService(router=BackendRouter([backend]))
    bound = service.bind_session({
        "sessionId": "semantic-session",
        "owner": {"runtimeId": "runtime", "threadId": "thread"},
        "target": {
            "targetId": "semantic-target", "kind": "browser-page",
            "locator": {"cdpEndpoint": "http://127.0.0.1:9222", "cdpTargetId": "page"},
        },
    })
    assert bound["ok"] is True, bound
    cfg = config(tmp_path)
    action = {
        "kind": "click", "role": "button", "name": "Commit Alpha",
        "expect": {"kind": "text-present", "text": "ALPHA_COMMITTED", "stableForMs": 1},
    }
    result = service.run(
        {
            "instruction": "Commit Alpha.", "semanticAction": action,
            "sessionId": "semantic-session", "requestId": "semantic-request",
            "execute": True, "approve": True,
        },
        lambda request, channel: run_task(
            cfg, request["instruction"], channel,
            execute=request["execute"], approve=request["approve"],
            semantic_action=request["semanticAction"],
        ),
        channel_options={"allow_execute": True},
    )
    assert result["ok"] is True, result
    assert result["data"]["verification"]["matched"] is True
    assert result["data"]["verification"]["expectation"]["stableForMs"] == 1
    assert result["data"]["action"]["name"] == "Commit Alpha"
    assert result["data"]["initialObservation"]["semanticTree"][1]["name"] == "State Alpha: READY"
    assert result["data"]["finalObservation"]["semanticTree"][1]["name"] == "State Alpha: ALPHA_COMMITTED"
    assert set(result["data"]["timeline"]) == {
        "startedAt", "observedAt", "actionStartedAt", "actionCompletedAt", "finalObservedAt",
    }
    assert backend.open_handle_count == 0
    assert service.registry.snapshot_counts()["activeLeases"] == 0


def test_semantic_uia_sequence_uses_fresh_tokens_and_final_readback(tmp_path):
    backend = SemanticUIAFakeBackend()
    service = ComputerUseService(router=BackendRouter([backend]))
    bound = service.bind_session({
        "sessionId": "semantic-uia-session",
        "owner": {"runtimeId": "runtime", "threadId": "thread"},
        "target": {
            "targetId": "semantic-uia-target", "kind": "windows-uia",
            "locator": {"processId": 42, "nativeWindowHandle": "1001"},
            "generation": "semantic-uia-generation",
        },
    })
    assert bound["ok"] is True, bound
    semantic_action = {
        "kind": "sequence",
        "steps": [
            {"kind": "write", "role": "textbox", "automationId": "1101", "text": "alpha"},
            {"kind": "invoke", "role": "button", "name": "Commit Alpha"},
            {"kind": "toggle", "role": "checkbox", "automationId": "1103"},
        ],
        "expect": {"kind": "text-present", "text": "text=alpha;clicks=1;checked=1"},
    }
    cfg = config(tmp_path)
    result = service.run(
        {
            "instruction": "Commit Alpha.", "semanticAction": semantic_action,
            "sessionId": "semantic-uia-session", "requestId": "semantic-uia-request",
            "execute": True, "approve": True,
        },
        lambda request, channel: run_task(
            cfg, request["instruction"], channel,
            execute=True, approve=True, semantic_action=request["semanticAction"],
        ),
        channel_options={"allow_execute": True},
    )

    assert result["ok"] is True
    assert result["data"]["verification"]["matched"] is True
    assert result["data"]["stepCount"] == 3
    assert result["data"]["finalObservation"]["semanticTree"][3]["name"] == (
        "text=alpha;clicks=1;checked=1"
    )
    assert backend.tokens == ["token-0-edit", "token-1-button", "token-2-check"]
    assert backend.read("semantic-uia-target") == ("alpha", "invoke", "toggle")
    assert backend.open_handle_count == 0
    assert service.registry.snapshot_counts()["activeLeases"] == 0


def test_semantic_observe_verifies_readback_without_action_or_planner(tmp_path):
    backend = SemanticUIAFakeBackend()
    service = ComputerUseService(router=BackendRouter([backend]))
    bound = service.bind_session({
        "sessionId": "semantic-observe-session",
        "owner": {"runtimeId": "runtime", "threadId": "thread"},
        "target": {
            "targetId": "semantic-observe-target", "kind": "windows-uia",
            "locator": {"processId": 44, "nativeWindowHandle": "1003"},
            "generation": "semantic-observe-generation",
        },
    })
    assert bound["ok"] is True, bound
    semantic_action = {
        "kind": "observe",
        "expect": {
            "kind": "text-present", "text": "text=;clicks=0;checked=0",
            "stableForMs": 1,
        },
    }
    cfg = config(tmp_path)
    result = service.run(
        {
            "instruction": "Read state only.", "semanticAction": semantic_action,
            "sessionId": "semantic-observe-session", "requestId": "semantic-observe-request",
            "execute": True, "approve": True,
        },
        lambda request, channel: run_task(
            cfg, request["instruction"], channel,
            execute=True, approve=True, semantic_action=request["semanticAction"],
        ),
        channel_options={"allow_execute": True},
    )

    assert result["ok"] is True, result
    assert result["data"]["executed"] is False
    assert result["data"]["stepCount"] == 0
    assert result["data"]["verification"]["matched"] is True
    assert result["data"]["verification"]["backend"] == "observation"
    assert result["data"]["finalObservation"]["semanticTree"][3]["name"] == (
        "text=;clicks=0;checked=0"
    )
    assert set(result["data"]["timeline"]) == {
        "startedAt", "observedAt", "finalObservedAt",
    }
    assert backend.tokens == []
    assert backend.read("semantic-observe-target") == ()
    assert backend.open_handle_count == 0
    assert service.registry.snapshot_counts()["activeLeases"] == 0


def test_semantic_uia_sequence_deadline_before_first_action_has_no_side_effect(tmp_path):
    backend = SemanticUIAFakeBackend(observe_delay=0.02)
    service = ComputerUseService(router=BackendRouter([backend]))
    bound = service.bind_session({
        "sessionId": "semantic-uia-timeout-session",
        "owner": {"runtimeId": "runtime", "threadId": "thread"},
        "target": {
            "targetId": "semantic-uia-timeout-target", "kind": "windows-uia",
            "locator": {"processId": 43, "nativeWindowHandle": "1002"},
            "generation": "semantic-uia-timeout-generation",
        },
    })
    assert bound["ok"] is True, bound
    semantic_action = {
        "kind": "sequence",
        "steps": [{
            "kind": "write", "role": "textbox", "automationId": "1101", "text": "must-not-write",
        }],
        "expect": {"kind": "text-present", "text": "must-not-write"},
    }
    cfg = config(tmp_path)
    result = service.run(
        {
            "instruction": "Expire before write.", "semanticAction": semantic_action,
            "sessionId": "semantic-uia-timeout-session", "requestId": "semantic-uia-timeout-request",
            "deadlineMs": 1, "execute": True, "approve": True,
        },
        lambda request, channel: run_task(
            cfg, request["instruction"], channel,
            execute=True, approve=True, semantic_action=request["semanticAction"],
        ),
        channel_options={"allow_execute": True},
    )

    assert result["error"]["code"] == "TIMEOUT", result
    assert backend.read("semantic-uia-timeout-target") == ()
    assert backend.tokens == []
    assert backend.open_handle_count == 0
    assert service.registry.snapshot_counts()["activeLeases"] == 0


def test_runner_uses_channel_for_observe_action_verify_and_manifest(monkeypatch, tmp_path):
    backend = FakeBackend(actions=("observe", "type"))
    service = ComputerUseService(router=BackendRouter([backend]))
    bind(service)
    outputs = iter([
        '<tool_call>{"arguments":{"action":"type","text":"hello"}}</tool_call>',
        '<tool_call>{"arguments":{"action":"answer","text":"done"}}</tool_call>',
    ])
    monkeypatch.setattr("cua.runner.owl_agent.call_owl", lambda *_args, **_kwargs: next(outputs))
    cfg = config(tmp_path)
    result = service.run(
        {
            "instruction": "type hello",
            "sessionId": "session-1",
            "requestId": "request-1",
            "execute": True,
            "approve": True,
        },
        lambda request, channel: run_task(
            cfg,
            request["instruction"],
            channel,
            execute=request["execute"],
            approve=request["approve"],
        ),
        channel_options={"allow_execute": True},
    )
    assert result["ok"] is True
    assert result["data"]["backend"] == "windows-uia"
    assert result["data"]["finalObservation"] == {
        "revision": "fake:1", "semanticTree": [],
    }
    assert result["data"]["steps"][0]["outcome"]["verification"] == "verified"
    assert backend.read("target-1") == ("hello",)
    manifest = tmp_path / "request-1" / "manifest.json"
    payload = json.loads(manifest.read_text(encoding="utf-8"))
    assert payload["requestId"] == "request-1"
    assert payload["targetId"] == "target-1"
    assert payload["cleanup"]["leaseReleased"] is True
    assert service.registry.snapshot_counts()["activeLeases"] == 0
    assert backend.open_handle_count == 0


def test_model_failure_still_closes_channel_and_writes_terminal_manifest(monkeypatch, tmp_path):
    backend = FakeBackend()
    service = ComputerUseService(router=BackendRouter([backend]))
    bind(service)
    monkeypatch.setattr(
        "cua.runner.owl_agent.call_owl",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("model failed")),
    )
    cfg = config(tmp_path)
    result = service.run(
        {"instruction": "inspect", "sessionId": "session-1", "requestId": "request-model"},
        lambda request, channel: run_task(cfg, request["instruction"], channel),
    )
    assert result["error"]["code"] == "UNAVAILABLE"
    manifest = json.loads((tmp_path / "request-model" / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["terminal"] == "failed"
    assert manifest["cleanup"]["leaseReleased"] is True
    assert service.registry.get_request("request-model").state is RequestState.FAILED
    assert backend.open_handle_count == 0


def test_retryable_planning_failure_retries_once_before_any_backend_action(monkeypatch, tmp_path):
    from cua.owl_agent import ModelCallError

    backend = FakeBackend()
    service = ComputerUseService(router=BackendRouter([backend]))
    bind(service)
    calls = 0

    def flaky_planner(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise ModelCallError("temporary bridge failure", retryable=True)
        return '<tool_call>{"arguments":{"action":"answer","text":"done"}}</tool_call>'

    monkeypatch.setattr("cua.runner.owl_agent.call_owl", flaky_planner)
    cfg = config(tmp_path)
    result = service.run(
        {"instruction": "inspect", "sessionId": "session-1", "requestId": "request-retry"},
        lambda request, channel: run_task(cfg, request["instruction"], channel),
    )

    assert result["ok"] is True
    assert calls == 2
    assert backend.read("target-1") == ()
    assert service.registry.snapshot_counts()["activeLeases"] == 0
    assert backend.open_handle_count == 0


def test_model_response_after_deadline_cannot_be_reported_as_success(monkeypatch, tmp_path):
    backend = FakeBackend()
    service = ComputerUseService(router=BackendRouter([backend]))
    bind(service)

    def delayed_answer(*_args, **_kwargs):
        time.sleep(0.02)
        return '<tool_call>{"arguments":{"action":"answer","text":"too late"}}</tool_call>'

    monkeypatch.setattr("cua.runner.owl_agent.call_owl", delayed_answer)
    cfg = config(tmp_path)
    result = service.run(
        {
            "instruction": "expire during model",
            "sessionId": "session-1",
            "requestId": "request-model-deadline",
            "deadlineMs": 5,
        },
        lambda request, channel: run_task(cfg, request["instruction"], channel),
    )
    assert result["error"]["code"] == "TIMEOUT"
    assert service.registry.snapshot_counts()["activeLeases"] == 0
    assert backend.open_handle_count == 0


def test_action_unknown_returns_error_and_still_cleans_every_resource(monkeypatch, tmp_path):
    backend = FakeBackend(actions=("observe", "type"), fail_action_target="target-1")
    service = ComputerUseService(router=BackendRouter([backend]))
    bind(service)
    monkeypatch.setattr(
        "cua.runner.owl_agent.call_owl",
        lambda *_args, **_kwargs: '<tool_call>{"arguments":{"action":"type","text":"maybe"}}</tool_call>',
    )
    cfg = config(tmp_path)
    result = service.run(
        {
            "instruction": "type",
            "sessionId": "session-1",
            "requestId": "request-unknown",
            "execute": True,
            "approve": True,
        },
        lambda request, channel: run_task(cfg, request["instruction"], channel, execute=True, approve=True),
        channel_options={"allow_execute": True},
    )
    assert result["error"]["code"] == "ACTION_OUTCOME_UNKNOWN"
    assert result["error"]["retryable"] is False
    assert service.registry.snapshot_counts()["activeLeases"] == 0
    assert backend.open_handle_count == 0


def test_first_observe_failure_still_closes_handle_and_lease(tmp_path):
    backend = FakeBackend(fail_observe=True)
    service = ComputerUseService(router=BackendRouter([backend]))
    bind(service)
    cfg = config(tmp_path)
    result = service.run(
        {"instruction": "inspect", "sessionId": "session-1", "requestId": "request-observe"},
        lambda request, channel: run_task(cfg, request["instruction"], channel),
    )
    assert result["error"]["code"] == "INTERNAL_ERROR"
    assert backend.open_handle_count == 0
    assert service.registry.snapshot_counts()["activeLeases"] == 0


def test_verification_failure_is_structured_and_cleans_resources(monkeypatch, tmp_path):
    backend = FakeBackend(actions=("observe", "type"), verification=Verification.FAILED)
    service = ComputerUseService(router=BackendRouter([backend]))
    bind(service)
    monkeypatch.setattr(
        "cua.runner.owl_agent.call_owl",
        lambda *_args, **_kwargs: '<tool_call>{"arguments":{"action":"type","text":"x"}}</tool_call>',
    )
    cfg = config(tmp_path)
    result = service.run(
        {
            "instruction": "type",
            "sessionId": "session-1",
            "requestId": "request-verify",
            "execute": True,
            "approve": True,
        },
        lambda request, channel: run_task(cfg, request["instruction"], channel, execute=True, approve=True),
        channel_options={"allow_execute": True},
    )
    assert result["error"]["code"] == "ACTION_UNVERIFIED"
    assert backend.open_handle_count == 0
    assert service.registry.snapshot_counts()["activeLeases"] == 0


def test_three_runner_artifact_manifests_keep_session_and_target_identity(monkeypatch, tmp_path):
    backend = FakeBackend(actions=("observe", "type"))
    service = ComputerUseService(router=BackendRouter([backend]))
    for index in range(3):
        service.bind_session({
            "sessionId": f"session-{index}",
            "owner": {"runtimeId": "runtime", "threadId": f"thread-{index}"},
            "target": {
                "targetId": f"target-{index}",
                "kind": "windows-uia",
                "locator": {"processId": 100 + index},
            },
        })

    def fake_model(_base, _model, _key, messages, **_kwargs):
        serialized = json.dumps(messages, ensure_ascii=False)
        index = next(i for i in range(3) if f"task-{i}" in serialized)
        return f'<tool_call>{{"arguments":{{"action":"type","text":"value-{index}"}}}}</tool_call>'

    monkeypatch.setattr("cua.runner.owl_agent.call_owl", fake_model)
    cfg = config(tmp_path)
    cfg.max_steps = 1

    def run(index):
        return service.run(
            {
                "instruction": f"task-{index}",
                "sessionId": f"session-{index}",
                "requestId": f"request-{index}",
                "execute": True,
                "approve": True,
            },
            lambda request, channel: run_task(cfg, request["instruction"], channel, execute=True, approve=True),
            channel_options={"allow_execute": True},
        )

    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(run, range(3)))
    assert all(result["ok"] for result in results)
    for index in range(3):
        manifest = json.loads(
            (tmp_path / f"request-{index}" / "manifest.json").read_text(encoding="utf-8")
        )
        assert manifest["sessionId"] == f"session-{index}"
        assert manifest["targetId"] == f"target-{index}"
        assert backend.read(f"target-{index}") == (f"value-{index}",)
    assert backend.open_handle_count == 0


def test_cancel_during_model_call_keeps_lease_until_model_returns(monkeypatch, tmp_path):
    backend = FakeBackend()
    service = ComputerUseService(router=BackendRouter([backend]))
    bind(service)
    entered = Event()
    release = Event()

    def blocking_model(*_args, **_kwargs):
        entered.set()
        release.wait(2)
        return '<tool_call>{"arguments":{"action":"answer","text":"late"}}</tool_call>'

    monkeypatch.setattr("cua.runner.owl_agent.call_owl", blocking_model)
    cfg = config(tmp_path)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(
            service.run,
            {"instruction": "inspect", "sessionId": "session-1", "requestId": "request-model-cancel"},
            lambda request, channel: run_task(cfg, request["instruction"], channel),
        )
        assert entered.wait(1)
        cancelled = service.cancel({"requestId": "request-model-cancel"})
        assert cancelled["data"]["status"] == "stopping"
        assert service.registry.snapshot_counts()["activeLeases"] == 1
        release.set()
        result = future.result()
    assert result["error"]["code"] == "CANCEL_PENDING"
    assert backend.open_handle_count == 0
    assert service.registry.snapshot_counts()["activeLeases"] == 0
