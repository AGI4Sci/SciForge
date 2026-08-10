import json
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Event

from cua.capabilities import Verification

from cua.config import Config
from cua.runner import run_task
from cua.service import ComputerUseService
from cua.session_registry import RequestState
from driver.router import BackendRouter
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
