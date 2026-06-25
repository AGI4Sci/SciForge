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


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
