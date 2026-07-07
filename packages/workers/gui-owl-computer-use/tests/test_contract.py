"""Pure unit tests for the worker contract + result envelope + action parsing.

No network and no display required. Runnable two ways:
    python -m pytest -q tests          # if pytest is installed
    python tests/test_contract.py      # plain stdlib fallback
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from cua import contract, result as R  # noqa: E402


def test_ok_envelope():
    res = R.ok({"status": "dry_run_planned", "stepCount": 1}, summary="done")
    assert res["ok"] is True
    assert res["data"]["status"] == "dry_run_planned"
    assert res["summary"] == "done"


def test_err_envelope_and_bad_code():
    res = R.err("NEEDS_APPROVAL", "needs approval", blocked_reason="x")
    assert res["ok"] is False
    assert res["error"]["code"] == "NEEDS_APPROVAL"
    assert res["error"]["blockedReason"] == "x"
    try:
        R.err("NOT_A_CODE", "bad")
    except AssertionError:
        pass
    else:  # pragma: no cover
        raise AssertionError("bad error code should assert")


def test_service_result_to_mcp_ok():
    res = R.ok({"status": "agent_reported_done", "executed": True,
                "stepCount": 3, "platform": "windows"})
    mapped = contract.service_result_to_mcp(res)
    assert "isError" not in mapped
    assert mapped["structuredContent"]["ok"] is True
    assert "agent_reported_done" in mapped["content"][0]["text"]


def test_service_result_to_mcp_err():
    res = R.err("NEEDS_APPROVAL", "approve first", blocked_reason="external-side-effect")
    mapped = contract.service_result_to_mcp(res)
    assert mapped["isError"] is True
    assert "NEEDS_APPROVAL" in mapped["content"][0]["text"]
    assert "external-side-effect" in mapped["content"][0]["text"]


def test_schemas_shape():
    assert contract.RUN_INPUT_SCHEMA["required"] == ["instruction"]
    assert contract.CANCEL_INPUT_SCHEMA["required"] == ["requestId"]
    assert contract.TOOL_RUN == "gui_computer_use_run"


def test_owl_parsing_optional():
    """owl_agent needs requests+PIL; skip cleanly if they aren't installed."""
    try:
        from cua import owl_agent
    except Exception:  # noqa: BLE001
        return
    args = owl_agent.extract_action(
        'Action: click Save\n<tool_call>\n'
        '{"name": "computer_use", "arguments": {"action": "left_click", "coordinate": [500, 250]}}\n'
        '</tool_call>')
    assert args is not None and args["action"] == "left_click"
    assert owl_agent.to_screen([500, 250], 1000, 800) == (500, 200)


def test_build_messages_official_multiturn_optional():
    """Official GUI-Owl multi-turn: alternating roles, sliding 2-image window,
    task text retained in turn 0, older screenshots dropped. Skips if PIL absent."""
    try:
        import io, tempfile, os as _os
        from PIL import Image
        from cua import owl_agent
    except Exception:  # noqa: BLE001
        return
    d = tempfile.mkdtemp()
    paths = []
    for i in range(3):  # 3 completed steps -> step0,1,2 ; current = step3
        p = _os.path.join(d, f"s{i}.png")
        Image.new("RGB", (64, 48), (i, i, i)).save(p)
        paths.append(p)
    history = [{"output": f"Action: act{i}\n<tool_call>{{}}</tool_call>", "image": paths[i]}
               for i in range(3)]
    cur = Image.new("RGB", (64, 48), (9, 9, 9))
    msgs = owl_agent.build_messages("open Notepad", history, cur, image_window=2)

    assert msgs[0]["role"] == "system"
    roles = [m["role"] for m in msgs[1:]]
    assert roles == ["user", "assistant", "user", "assistant", "user", "assistant", "user"], roles
    # exactly image_window (2) images across the whole conversation
    n_imgs = sum(1 for m in msgs for part in (m["content"] if isinstance(m["content"], list) else [])
                 if isinstance(part, dict) and part.get("type") == "image_url")
    assert n_imgs == 2, n_imgs
    # task text stays in the first user turn even though its image was windowed out
    first_user = msgs[1]
    assert any(p.get("type") == "text" and "open Notepad" in p["text"] for p in first_user["content"])
    assert all(p.get("type") != "image_url" for p in first_user["content"])  # step0 image dropped
    # current (last) user turn carries an image
    assert any(p.get("type") == "image_url" for p in msgs[-1]["content"])


def test_model_calls_use_model_router_responses_optional():
    """The worker must call Model Router /v1/responses, never a raw provider chat endpoint."""
    try:
        from cua import owl_agent
    except Exception:  # noqa: BLE001
        return

    calls = []
    original_post = owl_agent.requests.post

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"output_text": "Action: wait\n<tool_call>{\"arguments\":{\"action\":\"wait\",\"time\":1}}</tool_call>"}

    def fake_post(url, headers=None, json=None, timeout=None):  # noqa: A002
        calls.append({"url": url, "headers": headers, "json": json, "timeout": timeout})
        return FakeResponse()

    try:
        owl_agent.requests.post = fake_post
        text = owl_agent.call_owl(
            "http://127.0.0.1:3892/v1",
            "sciforge-router",
            "runtime-token",
            [
                {"role": "system", "content": "system prompt"},
                {"role": "user", "content": [
                    {"type": "text", "text": "inspect"},
                    {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}},
                ]},
            ],
        )
    finally:
        owl_agent.requests.post = original_post

    assert "Action: wait" in text
    assert calls and calls[0]["url"] == "http://127.0.0.1:3892/v1/responses"
    assert calls[0]["headers"]["Authorization"] == "Bearer runtime-token"
    assert calls[0]["json"]["model"] == "sciforge-router"
    assert calls[0]["json"]["instructions"] == "system prompt"
    serialized = str(calls[0]["json"])
    assert "/chat/completions" not in calls[0]["url"]
    assert "input_image" in serialized and "data:image/png;base64,AAAA" in serialized


def test_model_router_responses_url_normalizes_local_base_optional():
    """Local router base URLs may omit /v1; the worker posts to /v1/responses."""
    try:
        from cua import owl_agent
    except Exception:  # noqa: BLE001
        return

    assert owl_agent._model_router_responses_url("http://localhost:3892") == "http://localhost:3892/v1/responses"
    assert owl_agent._model_router_responses_url("http://127.0.0.1:3892/v1/") == "http://127.0.0.1:3892/v1/responses"
    assert owl_agent._model_router_responses_url("http://[::1]:3892/v1/responses") == "http://[::1]:3892/v1/responses"


def test_model_router_rejects_external_base_url_optional():
    """CUA_MODEL_ROUTER_BASE_URL cannot be repointed at a raw external provider."""
    try:
        from cua import owl_agent
    except Exception:  # noqa: BLE001
        return

    calls = []
    original_post = owl_agent.requests.post

    def fake_post(url, headers=None, json=None, timeout=None):  # noqa: A002
        calls.append({"url": url, "headers": headers, "json": json, "timeout": timeout})
        raise AssertionError("external base URL should be rejected before HTTP")

    try:
        owl_agent.requests.post = fake_post
        try:
            owl_agent.call_owl(
                "https://api.openai.example/v1",
                "sciforge-router",
                "runtime-token-secret",
                [{"role": "user", "content": "inspect"}],
            )
        except RuntimeError as e:
            msg = str(e)
        else:  # pragma: no cover
            raise AssertionError("external base URL should raise RuntimeError")
    finally:
        owl_agent.requests.post = original_post

    assert not calls
    assert "local SciForge Model Router" in msg
    assert "/v1/responses" in msg
    assert "runtime-token-secret" not in msg
    assert "api.openai.example" not in msg


def test_config_normalizes_local_model_router_base_url_optional():
    """Config stores a local Model Router base URL normalized to /v1."""
    try:
        from cua.config import Config
    except Exception:  # noqa: BLE001
        return

    old = {name: os.environ.get(name) for name in ["CUA_MODEL_ROUTER_BASE_URL"]}
    try:
        os.environ["CUA_MODEL_ROUTER_BASE_URL"] = "http://[::1]:3892/v1/responses"
        cfg = Config()
    finally:
        for name, value in old.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    assert cfg.model_base_url == "http://[::1]:3892/v1"


def test_config_rejects_external_model_router_base_url_optional():
    """Config validation rejects external provider URLs without leaking secrets."""
    try:
        from cua.config import Config
    except Exception:  # noqa: BLE001
        return

    old = {name: os.environ.get(name) for name in ["CUA_MODEL_ROUTER_BASE_URL"]}
    try:
        os.environ["CUA_MODEL_ROUTER_BASE_URL"] = "https://token-secret@api.openai.example/v1"
        try:
            Config()
        except ValueError as e:
            msg = str(e)
        else:  # pragma: no cover
            raise AssertionError("external base URL should raise ValueError")
    finally:
        for name, value in old.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    assert "local SciForge Model Router" in msg
    assert "token-secret" not in msg
    assert "api.openai.example" not in msg


def test_config_ignores_legacy_direct_provider_env_optional():
    """Legacy direct provider env must not silently re-enable raw model access."""
    try:
        from cua.config import Config
    except Exception:  # noqa: BLE001
        return
    old = {name: os.environ.get(name) for name in [
        "CUA_MODEL_BASE_URL",
        "CUA_MODEL",
        "CUA_MODEL_API_KEY",
        "CUA_MODEL_ROUTER_BASE_URL",
        "CUA_MODEL_ROUTER_MODEL",
        "CUA_MODEL_ROUTER_API_KEY",
        "SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY",
    ]}
    try:
        os.environ["CUA_MODEL_BASE_URL"] = "http://raw-provider.local/v1"
        os.environ["CUA_MODEL"] = "raw-model"
        os.environ["CUA_MODEL_API_KEY"] = "raw-key"
        for name in ["CUA_MODEL_ROUTER_BASE_URL", "CUA_MODEL_ROUTER_MODEL", "CUA_MODEL_ROUTER_API_KEY", "SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY"]:
            os.environ.pop(name, None)
        cfg = Config()
    finally:
        for name, value in old.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    assert cfg.model_base_url == ""
    assert cfg.model_name == "sciforge-router"
    assert cfg.model_api_key == ""


def test_http_sidecar_bearer_auth_optional():
    """HTTP auth helpers stay pure; skip cleanly if optional deps are absent."""
    try:
        from cua import server
    except Exception:  # noqa: BLE001
        return

    old_token = server.CONFIG.service_token
    old_allow_execute = server.CONFIG.allow_execute
    try:
        server.CONFIG.service_token = ""
        server.CONFIG.allow_execute = False
        assert server._check_auth(None) is None

        server.CONFIG.service_token = "secret"
        server.CONFIG.allow_execute = False
        assert server._check_auth("Bearer secret") is None
        bad = server._check_auth("Bearer wrong")
        assert bad is not None and bad["error"]["code"] == "UNAUTHENTICATED"

        server.CONFIG.service_token = ""
        server.CONFIG.allow_execute = True
        missing = server._check_auth(None)
        assert missing is not None and missing["error"]["code"] == "UNAUTHENTICATED"
    finally:
        server.CONFIG.service_token = old_token
        server.CONFIG.allow_execute = old_allow_execute


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
