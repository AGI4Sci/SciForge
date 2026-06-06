import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable


PACKAGE_ROOT = Path(__file__).resolve().parents[1]

HOST_PORT_CALL_SCHEMA = "sciforge.computer-use.host-port-call.v1"
HOST_PORT_RESULT_SCHEMA = "sciforge.computer-use.host-port-result.v1"
FINAL_RESULT_SCHEMA = "sciforge.computer-use.cli-final-result.v1"
LEGACY_PYTHON_DIAGNOSTIC_ENV = "SCIFORGE_COMPUTER_USE_LEGACY_PYTHON_DIAGNOSTIC"


def run_host_port_stdio(
    request: dict[str, Any],
    handler: Callable[[dict[str, Any], list[dict[str, Any]]], dict[str, Any]],
    *,
    diagnostic: bool = True,
) -> tuple[int, list[dict[str, Any]], str]:
    env = {
        **os.environ,
        "PYTHONPATH": str(PACKAGE_ROOT),
    }
    if diagnostic:
        env[LEGACY_PYTHON_DIAGNOSTIC_ENV] = "1"
    else:
        env.pop(LEGACY_PYTHON_DIAGNOSTIC_ENV, None)
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "sciforge_computer_use",
            "--request-json",
            json.dumps(request),
            "--host-port-stdio",
        ],
        cwd=PACKAGE_ROOT,
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    assert process.stdin is not None
    assert process.stdout is not None
    assert process.stderr is not None

    messages: list[dict[str, Any]] = []
    try:
        while True:
            line = process.stdout.readline()
            if not line:
                break
            message = json.loads(line)
            messages.append(message)
            if message.get("type") == "finalResult":
                break

            assert message["schemaVersion"] == HOST_PORT_CALL_SCHEMA
            assert message["type"] == "hostPortCall"
            response = {
                "schemaVersion": HOST_PORT_RESULT_SCHEMA,
                "type": "hostPortResult",
                "id": message["id"],
                **handler(message, messages),
            }
            process.stdin.write(f"{json.dumps(response, sort_keys=True)}\n")
            process.stdin.flush()
    finally:
        process.stdin.close()
        if process.poll() is None:
            process.wait(timeout=10)

    stderr = process.stderr.read()
    return process.returncode, messages, stderr


def test_cli_host_port_stdio_fails_closed_without_diagnostic_env():
    returncode, messages, stderr = run_host_port_stdio(
        {"task": "click Run", "maxSteps": 1},
        lambda call, _messages: (_ for _ in ()).throw(AssertionError(f"unexpected host port call: {call}")),
        diagnostic=False,
    )

    assert returncode == 1
    assert stderr == ""
    assert len(messages) == 1
    assert messages[0]["schemaVersion"] == FINAL_RESULT_SCHEMA
    assert messages[0]["type"] == "finalResult"
    result = messages[0]["result"]
    assert result["status"] == "failed-with-reason"
    assert LEGACY_PYTHON_DIAGNOSTIC_ENV in result["message"]
    assert result["failureDiagnostics"]["failedStage"] == "legacy-python-diagnostic-gate"


def test_cli_host_port_stdio_round_trips_all_ports_and_final_result():
    capture_refs = iter(
        [
            ".sciforge/vision-runs/stdio/before.png",
            ".sciforge/vision-runs/stdio/after.png",
        ]
    )

    def handler(call: dict[str, Any], _messages: list[dict[str, Any]]) -> dict[str, Any]:
        port = call["port"]
        if port == "emitEvent":
            return {"ok": True, "result": None}
        if port == "capture":
            ref = next(capture_refs)
            return {
                "ok": True,
                "result": {
                    "ref": ref,
                    "summary": f"captured {ref.rsplit('/', 1)[-1]}",
                    "visibleTexts": ["Run", "Done"],
                    "artifacts": (
                        {"finalArtifactRef": "artifact:stdio/final-report.md"}
                        if ref.endswith("after.png")
                        else {}
                    ),
                },
            }
        if port == "plan":
            return {
                "ok": True,
                "result": {
                    "type": "click",
                    "targetDescription": "Run button",
                    "reason": "start the safe local workflow",
                },
            }
        if port == "locate":
            assert call["args"][1]["description"] == "Run button"
            return {"ok": True, "result": {"ok": True, "x": 42, "y": 24, "confidence": 0.98}}
        if port == "execute":
            assert call["args"][0]["kind"] == "click"
            assert call["args"][1]["ok"] is True
            return {"ok": True, "result": {"ok": True, "message": "clicked Run"}}
        if port == "verify":
            assert call["args"][3]["kind"] == "click"
            assert call["args"][4]["ok"] is True
            return {
                "ok": True,
                "result": {
                    "ok": True,
                    "done": True,
                    "reason": "final report is visible",
                    "metadata": {"finalArtifactRef": "artifact:stdio/final-report.md"},
                },
            }
        if port == "writeTrace":
            assert call["args"][0]["status"] == "completed"
            return {"ok": True, "result": "trace:stdio/computer-use.json"}
        raise AssertionError(f"unexpected host port call: {port}")

    returncode, messages, stderr = run_host_port_stdio(
        {"task": "click Run", "maxSteps": 1},
        handler,
    )

    assert returncode == 0
    assert stderr == ""
    assert [message.get("port") for message in messages if message.get("type") == "hostPortCall"] == [
        "emitEvent",
        "capture",
        "plan",
        "locate",
        "execute",
        "capture",
        "verify",
        "writeTrace",
        "emitEvent",
    ]
    assert messages[-1]["schemaVersion"] == FINAL_RESULT_SCHEMA
    assert messages[-1]["type"] == "finalResult"
    result = messages[-1]["result"]
    assert result["status"] == "completed"
    assert result["traceRefs"] == ["trace:stdio/computer-use.json"]
    assert result["finalArtifactRef"] == "artifact:stdio/final-report.md"
    assert result["steps"][0]["action"]["kind"] == "click"
    assert result["steps"][0]["beforeRef"] == ".sciforge/vision-runs/stdio/before.png"
    assert result["steps"][0]["afterRef"] == ".sciforge/vision-runs/stdio/after.png"


def test_cli_host_port_stdio_ok_false_returns_structured_final_failure():
    def handler(call: dict[str, Any], _messages: list[dict[str, Any]]) -> dict[str, Any]:
        if call["port"] == "emitEvent":
            return {"ok": True, "result": None}
        if call["port"] == "capture":
            return {
                "ok": False,
                "error": "display capture provider unavailable",
            }
        raise AssertionError(f"unexpected host port call after failed capture: {call['port']}")

    returncode, messages, stderr = run_host_port_stdio(
        {"task": "capture unavailable display", "maxSteps": 1},
        handler,
    )

    assert returncode == 1
    assert stderr == ""
    assert [message.get("port") for message in messages if message.get("type") == "hostPortCall"] == [
        "emitEvent",
        "capture",
    ]
    assert messages[-1]["schemaVersion"] == FINAL_RESULT_SCHEMA
    assert messages[-1]["type"] == "finalResult"
    result = messages[-1]["result"]
    assert result["status"] == "failed-with-reason"
    assert result["message"] == "display capture provider unavailable"
    assert result["failureDiagnostics"]["failedStage"] == "cli"
