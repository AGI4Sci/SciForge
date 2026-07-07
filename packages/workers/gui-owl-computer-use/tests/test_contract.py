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


def test_grounding_chat_completions_call_optional():
    """The worker posts OpenAI-compatible chat/completions with configured headers."""
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
            return {
                "choices": [{
                    "message": {
                        "content": "Action: wait\n<tool_call>{\"arguments\":{\"action\":\"wait\",\"time\":1}}</tool_call>"
                    }
                }]
            }

    def fake_post(url, headers=None, json=None, timeout=None):  # noqa: A002
        calls.append({"url": url, "headers": headers, "json": json, "timeout": timeout})
        return FakeResponse()

    try:
        owl_agent.requests.post = fake_post
        text = owl_agent.call_owl(
            "http://grounding.example/v1/chat/completions",
            "gui-owl",
            "grounding-token",
            [
                {"role": "system", "content": "system prompt"},
                {"role": "user", "content": [
                    {"type": "text", "text": "inspect"},
                    {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}},
                ]},
            ],
            extra_headers={"x-original-model": "gui-owl"},
        )
    finally:
        owl_agent.requests.post = original_post

    assert "Action: wait" in text
    assert calls and calls[0]["url"] == "http://grounding.example/v1/chat/completions"
    assert calls[0]["headers"]["Authorization"] == "Bearer grounding-token"
    assert calls[0]["headers"]["x-original-model"] == "gui-owl"
    assert calls[0]["json"]["model"] == "gui-owl"
    assert calls[0]["json"]["messages"][0] == {"role": "system", "content": "system prompt"}
    serialized = str(calls[0]["json"])
    assert "image_url" in serialized and "data:image/png;base64,AAAA" in serialized


def test_grounding_endpoint_url_normalizes_base_optional():
    """Grounding base URLs may be exact endpoints or /v1 bases."""
    try:
        from cua import owl_agent
    except Exception:  # noqa: BLE001
        return

    assert owl_agent._grounding_endpoint_url("http://localhost:8881", "chat_completions") == "http://localhost:8881/v1/chat/completions"
    assert owl_agent._grounding_endpoint_url("http://127.0.0.1:8881/v1/", "chat_completions") == "http://127.0.0.1:8881/v1/chat/completions"
    assert owl_agent._grounding_endpoint_url("http://grounding.example/v1/chat/completions", "chat_completions") == "http://grounding.example/v1/chat/completions"
    assert owl_agent._grounding_endpoint_url("http://[::1]:3892/v1/responses", "responses") == "http://[::1]:3892/v1/responses"


def test_grounding_url_rejects_credentials_without_leaking_secrets_optional():
    """Grounding URL validation rejects embedded credentials without leaking them."""
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
                "https://token-secret@api.openai.example/v1",
                "gui-owl",
                "runtime-token-secret",
                [{"role": "user", "content": "inspect"}],
            )
        except RuntimeError as e:
            msg = str(e)
        else:  # pragma: no cover
            raise AssertionError("credentialed base URL should raise RuntimeError")
    finally:
        owl_agent.requests.post = original_post

    assert not calls
    assert "CUA_GROUNDING_BASE_URL" in msg
    assert "runtime-token-secret" not in msg
    assert "token-secret" not in msg
    assert "api.openai.example" not in msg


def test_config_normalizes_grounding_base_url_and_headers_optional():
    """Config stores generic grounding URL, endpoint, and JSON headers."""
    try:
        from cua.config import Config
    except Exception:  # noqa: BLE001
        return

    names = [
        "CUA_GROUNDING_BASE_URL",
        "CUA_GROUNDING_MODEL",
        "CUA_GROUNDING_API_KEY",
        "CUA_GROUNDING_ENDPOINT",
        "CUA_GROUNDING_EXTRA_HEADERS",
    ]
    old = {name: os.environ.get(name) for name in names}
    try:
        os.environ["CUA_GROUNDING_BASE_URL"] = "http://grounding.example/v1/chat/completions/"
        os.environ["CUA_GROUNDING_MODEL"] = "gui-owl"
        os.environ["CUA_GROUNDING_API_KEY"] = "grounding-key"
        os.environ["CUA_GROUNDING_ENDPOINT"] = "chat/completions"
        os.environ["CUA_GROUNDING_EXTRA_HEADERS"] = '{"x-original-model":"gui-owl"}'
        cfg = Config()
    finally:
        for name, value in old.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    assert cfg.grounding_base_url == "http://grounding.example/v1/chat/completions"
    assert cfg.grounding_model == "gui-owl"
    assert cfg.grounding_api_key == "grounding-key"
    assert cfg.grounding_endpoint == "chat_completions"
    assert cfg.grounding_extra_headers == {"x-original-model": "gui-owl"}


def test_config_uses_package_default_grounding_profile_optional():
    """GUI-Owl grounding URL/model/header defaults live in the worker package."""
    try:
        from cua.config import (
            Config,
            DEFAULT_GROUNDING_BASE_URL,
            DEFAULT_GROUNDING_MODEL,
            DEFAULT_GROUNDING_EXTRA_HEADERS,
            DEFAULT_MODEL_ROUTER_BASE_URL,
            DEFAULT_MODEL_ROUTER_MODEL,
        )
    except Exception:  # noqa: BLE001
        return

    names = [
        "CUA_GROUNDING_BASE_URL",
        "CUA_GROUNDING_MODEL",
        "CUA_GROUNDING_API_KEY",
        "CUA_GROUNDING_ENDPOINT",
        "CUA_GROUNDING_EXTRA_HEADERS",
        "CUA_VISION_BASE_URL",
        "CUA_VISION_MODEL",
        "CUA_VISION_API_KEY",
        "CUA_VISION_ENDPOINT",
        "CUA_VISION_EXTRA_HEADERS",
        "SCIFORGE_MODEL_ROUTER_BASE_URL",
        "SCIFORGE_MODEL_ROUTER_MODEL",
        "SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY",
    ]
    old = {name: os.environ.get(name) for name in names}
    try:
        for name in names:
            os.environ.pop(name, None)
        cfg = Config()
    finally:
        for name, value in old.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    assert cfg.grounding_base_url == DEFAULT_GROUNDING_BASE_URL
    assert cfg.grounding_model == DEFAULT_GROUNDING_MODEL
    assert cfg.grounding_extra_headers == DEFAULT_GROUNDING_EXTRA_HEADERS
    assert cfg.grounding_api_key == ""
    assert cfg.vision_base_url == DEFAULT_MODEL_ROUTER_BASE_URL
    assert cfg.vision_model == DEFAULT_MODEL_ROUTER_MODEL
    assert cfg.vision_api_key == ""


def test_reflector_uses_model_router_vision_config_optional():
    """Optional reflection is a general vision call, not a GUI-Owl grounding call."""
    try:
        from PIL import Image
        from cua import reflector
        from cua.config import Config
    except Exception:  # noqa: BLE001
        return

    names = [
        "CUA_VISION_BASE_URL",
        "CUA_VISION_MODEL",
        "CUA_VISION_API_KEY",
        "CUA_GROUNDING_BASE_URL",
        "CUA_GROUNDING_MODEL",
        "CUA_GROUNDING_API_KEY",
    ]
    old_env = {name: os.environ.get(name) for name in names}
    old_call = reflector.owl_agent.call_owl
    calls = []

    def fake_call_owl(base_url, model, api_key, messages, **kwargs):
        calls.append({
            "base_url": base_url,
            "model": model,
            "api_key": api_key,
            "kwargs": kwargs,
            "messages": messages,
        })
        return (
            "### Screenshot Difference ###\nchanged\n"
            "### Outcome ###\nA\n"
            "### Error Description ###\nNone\n"
            "### Progress Status ###\ndone\n"
        )

    try:
        os.environ["CUA_VISION_BASE_URL"] = "http://127.0.0.1:3892/v1"
        os.environ["CUA_VISION_MODEL"] = "sciforge-router"
        os.environ["CUA_VISION_API_KEY"] = "router-key"
        os.environ["CUA_GROUNDING_BASE_URL"] = "http://grounding.example/v1/chat/completions"
        os.environ["CUA_GROUNDING_MODEL"] = "gui-owl"
        os.environ["CUA_GROUNDING_API_KEY"] = "grounding-key"
        reflector.owl_agent.call_owl = fake_call_owl
        cfg = Config()
        img = Image.new("RGB", (8, 8), (1, 2, 3))
        res = reflector.reflect(cfg, "task", "", "task", {"action": "wait"}, "wait", img, img)
    finally:
        reflector.owl_agent.call_owl = old_call
        for name, value in old_env.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    assert res["outcome"] == "A"
    assert calls and calls[0]["base_url"] == "http://127.0.0.1:3892/v1"
    assert calls[0]["model"] == "sciforge-router"
    assert calls[0]["api_key"] == "router-key"
    assert calls[0]["kwargs"]["base_url_label"] == "CUA_VISION_BASE_URL or SCIFORGE_MODEL_ROUTER_BASE_URL"
    assert calls[0]["kwargs"]["api_key_label"] == "CUA_VISION_API_KEY or SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY"


def test_config_rejects_grounding_url_credentials_optional():
    """Config validation rejects credentialed grounding URLs without leaking secrets."""
    try:
        from cua.config import Config
    except Exception:  # noqa: BLE001
        return

    old = {name: os.environ.get(name) for name in ["CUA_GROUNDING_BASE_URL"]}
    try:
        os.environ["CUA_GROUNDING_BASE_URL"] = "https://token-secret@api.openai.example/v1"
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

    assert "CUA_GROUNDING_BASE_URL" in msg
    assert "token-secret" not in msg
    assert "api.openai.example" not in msg


def test_config_ignores_legacy_direct_provider_env_optional():
    """Legacy direct/model-router env must not configure grounding access."""
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
        "CUA_GROUNDING_BASE_URL",
        "CUA_GROUNDING_MODEL",
        "CUA_GROUNDING_API_KEY",
        "CUA_GROUNDING_EXTRA_HEADERS",
    ]}
    try:
        os.environ["CUA_MODEL_BASE_URL"] = "http://raw-provider.local/v1"
        os.environ["CUA_MODEL"] = "raw-model"
        os.environ["CUA_MODEL_API_KEY"] = "raw-key"
        for name in ["CUA_MODEL_ROUTER_BASE_URL", "CUA_MODEL_ROUTER_MODEL", "CUA_MODEL_ROUTER_API_KEY", "SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY", "CUA_GROUNDING_BASE_URL", "CUA_GROUNDING_MODEL", "CUA_GROUNDING_API_KEY", "CUA_GROUNDING_EXTRA_HEADERS"]:
            os.environ.pop(name, None)
        cfg = Config()
    finally:
        for name, value in old.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    assert cfg.grounding_base_url == "http://10.140.158.130:8881/v1/chat/completions"
    assert cfg.grounding_model == "gui-owl"
    assert cfg.grounding_extra_headers == {"x-original-model": "gui-owl"}
    assert cfg.grounding_api_key == ""


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
