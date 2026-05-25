"""JSON CLI for the SciForge Computer Use action provider."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import fields, is_dataclass
from itertools import count
from typing import Any, Mapping, Sequence

from .contracts import (
    ActionPlan,
    ComputerUseRequest,
    ComputerUseResult,
    ExecutionOutcome,
    Grounding,
    Observation,
    Verification,
)
from .loop import run_task
from .trace import compact_result_for_handoff, result_to_trace


HOST_PORT_CALL_SCHEMA = "sciforge.computer-use.host-port-call.v1"
HOST_PORT_RESULT_SCHEMA = "sciforge.computer-use.host-port-result.v1"
FINAL_RESULT_SCHEMA = "sciforge.computer-use.cli-final-result.v1"


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run sciforge_computer_use.run_task from JSON.")
    parser.add_argument("--request-json", help="ComputerUseRequest JSON. If omitted, stdin is read as JSON.")
    parser.add_argument("--fixture-json", help="Fixture hostPorts JSON for tests and dry-run diagnostics.")
    parser.add_argument(
        "--host-port-stdio",
        action="store_true",
        help="Use JSONL stdout/stdin host-port calls. Requires --request-json.",
    )
    args = parser.parse_args(argv)

    try:
        request = _load_json_arg_or_stdin(args.request_json)
        if args.host_port_stdio:
            if not args.request_json:
                _emit_protocol_final(_failure_result("host-port-stdio requires --request-json so stdin can carry host-port responses."))
                return 1
            result = run_task(request, JsonLineHostPorts())
            _emit_protocol_final(_result_payload(result))
            return 0 if result.status in {"completed", "max-steps", "needs-confirmation"} else 1

        fixture = _parse_json(args.fixture_json) if args.fixture_json else None
        host_ports: Any = FixtureHostPorts(fixture) if isinstance(fixture, Mapping) else {}
        result = run_task(request, host_ports)
        json.dump(_result_payload(result), sys.stdout, sort_keys=True)
        sys.stdout.write("\n")
        sys.stdout.flush()
        return 0 if result.status in {"completed", "max-steps", "needs-confirmation"} else 1
    except Exception as exc:  # noqa: BLE001 - CLI must keep stdout structured.
        payload = _failure_result(str(exc))
        if args.host_port_stdio:
            _emit_protocol_final(payload)
        else:
            json.dump(payload, sys.stdout, sort_keys=True)
            sys.stdout.write("\n")
            sys.stdout.flush()
        return 1


class JsonLineHostPorts:
    """Host port adapter that synchronously calls a parent process over JSONL."""

    def __init__(self) -> None:
        self._ids = count(1)

    def capture(self, request: ComputerUseRequest, history: Sequence[Any], query: str | None = None) -> Any:
        return self._call("capture", [_json_value(request), _json_value(history)], {"query": query})

    def plan(self, request: ComputerUseRequest, observation: Observation, history: Sequence[Any]) -> Any:
        return self._call("plan", [_json_value(request), _json_value(observation), _json_value(history)])

    def locate(self, observation: Observation, target: Any, history: Sequence[Any]) -> Any:
        return self._call("locate", [_json_value(observation), _json_value(target), _json_value(history)])

    def execute(self, action: ActionPlan, grounding: Grounding | None, request: ComputerUseRequest) -> Any:
        return self._call("execute", [_json_value(action), _json_value(grounding), _json_value(request)])

    def verify(
        self,
        request: ComputerUseRequest,
        before: Observation,
        after: Observation,
        action: ActionPlan,
        execution: ExecutionOutcome,
        history: Sequence[Any],
    ) -> Any:
        return self._call(
            "verify",
            [
                _json_value(request),
                _json_value(before),
                _json_value(after),
                _json_value(action),
                _json_value(execution),
                _json_value(history),
            ],
        )

    def write_trace(self, result: ComputerUseResult) -> str:
        value = self._call("writeTrace", [_result_payload(result)])
        return str(value) if value else ""

    def emit_event(self, event: Mapping[str, Any]) -> None:
        self._call("emitEvent", [_json_value(event)])

    def _call(self, port: str, args: Sequence[Any], kwargs: Mapping[str, Any] | None = None) -> Any:
        call_id = f"host-port-call-{next(self._ids)}"
        message = {
            "schemaVersion": HOST_PORT_CALL_SCHEMA,
            "type": "hostPortCall",
            "id": call_id,
            "port": port,
            "args": list(args),
            "kwargs": _json_value(dict(kwargs or {})),
        }
        sys.stdout.write(f"{json.dumps(message, sort_keys=True)}\n")
        sys.stdout.flush()
        while True:
            line = sys.stdin.readline()
            if not line:
                raise RuntimeError(f"Host port {port!r} closed before returning {call_id}.")
            response = json.loads(line)
            if response.get("type") != "hostPortResult" or response.get("id") != call_id:
                continue
            if response.get("ok") is False:
                raise RuntimeError(str(response.get("error") or f"Host port {port!r} failed."))
            return response.get("result")


class FixtureHostPorts:
    """Small deterministic hostPorts implementation for package-level tests."""

    def __init__(self, fixture: Mapping[str, Any]) -> None:
        self.fixture = fixture
        self.capture_index = 0
        self.plan_index = 0

    def capture(self, request: ComputerUseRequest, history: Sequence[Any], query: str | None = None) -> Any:
        captures = _list_value(self.fixture.get("capture") or self.fixture.get("observations"))
        if captures:
            value = captures[min(self.capture_index, len(captures) - 1)]
        else:
            suffix = "after" if query == "after-action" else f"before-{self.capture_index + 1}"
            value = {"ref": f".sciforge/vision-runs/fixture/{suffix}.png", "summary": f"fixture {suffix}"}
        self.capture_index += 1
        return value

    def plan(self, request: ComputerUseRequest, observation: Observation, history: Sequence[Any]) -> Any:
        plans = _list_value(self.fixture.get("plan") or self.fixture.get("plans"))
        if plans:
            value = plans[min(self.plan_index, len(plans) - 1)]
        else:
            value = {"done": True, "reason": "fixture default planner reported done"}
        self.plan_index += 1
        return value

    def locate(self, observation: Observation, target: Any, history: Sequence[Any]) -> Any:
        value = self.fixture.get("locate") or self.fixture.get("grounding")
        return value if isinstance(value, Mapping) else {"ok": True, "x": 10, "y": 20, "confidence": 0.9}

    def execute(self, action: ActionPlan, grounding: Grounding | None, request: ComputerUseRequest) -> Any:
        value = self.fixture.get("execute") or self.fixture.get("execution")
        return value if isinstance(value, Mapping) else {"ok": True, "message": "fixture executed"}

    def verify(
        self,
        request: ComputerUseRequest,
        before: Observation,
        after: Observation,
        action: ActionPlan,
        execution: ExecutionOutcome,
        history: Sequence[Any],
    ) -> Any:
        value = self.fixture.get("verify") or self.fixture.get("verification")
        return value if isinstance(value, Mapping) else {"ok": True, "done": True, "reason": "fixture verified"}

    def write_trace(self, result: ComputerUseResult) -> str:
        value = self.fixture.get("writeTraceRef") or self.fixture.get("traceRef")
        return str(value or "trace:fixture/computer-use.json")

    def emit_event(self, event: Mapping[str, Any]) -> None:
        return None


def _load_json_arg_or_stdin(value: str | None) -> Any:
    if value:
        return _parse_json(value)
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    return _parse_json(raw)


def _parse_json(value: str) -> Any:
    parsed = json.loads(value)
    return parsed


def _emit_protocol_final(result: Mapping[str, Any]) -> None:
    sys.stdout.write(
        f"{json.dumps({'schemaVersion': FINAL_RESULT_SCHEMA, 'type': 'finalResult', 'result': result}, sort_keys=True)}\n"
    )
    sys.stdout.flush()


def _result_payload(result: ComputerUseResult) -> dict[str, Any]:
    trace = result_to_trace(result)
    handoff = compact_result_for_handoff(result)
    return {
        **handoff,
        "schemaVersion": result.schema_version,
        "status": result.status,
        "reason": result.reason,
        "message": result.reason,
        "metrics": dict(result.metrics),
        "failureDiagnostics": dict(result.failure_diagnostics),
        "finalObservationRef": trace.get("finalObservationRef"),
        "traceRefs": list(result.trace_refs),
        "approvalRequest": trace.get("approvalRequest"),
        "steps": trace.get("steps", []),
        "budgetDebits": trace.get("budgetDebits", []),
        "budgetDebitRefs": trace.get("budgetDebitRefs", []),
    }


def _failure_result(reason: str) -> dict[str, Any]:
    return {
        "schemaVersion": "sciforge.computer-use.result.v1",
        "status": "failed-with-reason",
        "reason": reason,
        "message": reason,
        "traceRefs": [],
        "approvalRequest": None,
        "failureDiagnostics": {"failedStage": "cli"},
        "metrics": {},
        "steps": [],
        "budgetDebits": [],
        "budgetDebitRefs": [],
    }


def _json_value(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if is_dataclass(value):
        return {field.name: _json_value(getattr(value, field.name)) for field in fields(value)}
    if isinstance(value, Mapping):
        return {str(key): _json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_value(item) for item in value]
    return str(value)


def _list_value(value: Any) -> list[Any]:
    return list(value) if isinstance(value, list) else []


if __name__ == "__main__":
    raise SystemExit(main())
