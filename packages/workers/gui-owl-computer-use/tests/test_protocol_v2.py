from __future__ import annotations

import json
from pathlib import Path

import pytest

from cua import contract
from cua.mcp_server import _run_tool


FIXTURES = json.loads(
    (Path(__file__).parent / "fixtures" / "computer_use_contract_v2.json").read_text(
        encoding="utf-8"
    )
)


@pytest.mark.parametrize("case", FIXTURES["valid"], ids=lambda case: case["name"])
def test_shared_valid_contract_fixtures(case):
    normalized = contract.normalize_run_input(case["input"])
    assert normalized["protocolVersion"] == case["protocolVersion"]


@pytest.mark.parametrize("case", FIXTURES["invalid"], ids=lambda case: case["name"])
def test_shared_invalid_contract_fixtures(case):
    with pytest.raises(ValueError):
        contract.normalize_run_input(case["input"])


def test_legacy_request_remains_on_existing_path(monkeypatch):
    sentinel = {"ok": True, "data": {"status": "legacy"}}
    monkeypatch.setattr("cua.mcp_server._screenshot_provider", lambda _args: object())
    monkeypatch.setattr("cua.mcp_server.run_task", lambda *_args, **_kwargs: sentinel)
    assert _run_tool({"instruction": "legacy task"}) is sentinel


def test_v2_request_is_explicitly_blocked_before_opening_screen(monkeypatch):
    def fail_if_called(_args):
        raise AssertionError("v2 P1 requests must not open a screenshot provider")

    monkeypatch.setattr("cua.mcp_server._screenshot_provider", fail_if_called)
    result = _run_tool({"instruction": "targeted task", "sessionId": "session-1"})
    assert result["ok"] is False
    assert result["error"]["code"] == "BACKEND_UNAVAILABLE"
    assert result["error"]["blockedReason"] == "computer-use-session-channel-not-implemented"
