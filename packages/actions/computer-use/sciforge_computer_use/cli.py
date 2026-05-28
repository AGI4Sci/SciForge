"""JSON CLI for the SciForge Computer Use action provider."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import fields, is_dataclass
from itertools import count
from pathlib import Path
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
    parser.add_argument("--fixture-file", help="Path to fixture hostPorts JSON for tests and dry-run diagnostics.")
    parser.add_argument(
        "--fixture-output-dir",
        help="Directory where fixture runs persist vision-trace.json and computer-use-result.json.",
    )
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

        fixture = _load_fixture(args.fixture_json, args.fixture_file)
        output_dir = Path(args.fixture_output_dir).expanduser() if args.fixture_output_dir else None
        host_ports: Any = FixtureHostPorts(fixture, output_dir=output_dir) if isinstance(fixture, Mapping) else {}
        result = run_task(request, host_ports)
        payload = _result_payload(result)
        if output_dir is not None:
            result_path = output_dir / "computer-use-result.json"
            repair_manifest_ref = _maybe_write_repair_manifest(output_dir, payload, result_path=result_path)
            if repair_manifest_ref:
                payload.setdefault("failureDiagnostics", {})["repairManifestRef"] = repair_manifest_ref
            _write_json(result_path, payload)
        json.dump(payload, sys.stdout, sort_keys=True)
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

    def __init__(self, fixture: Mapping[str, Any], output_dir: Path | None = None) -> None:
        self.fixture = fixture
        self.output_dir = output_dir
        self.capture_index = 0
        self.plan_index = 0
        self.locate_index = 0
        self.execute_index = 0
        self.verify_index = 0
        self._files = fixture.get("files") if isinstance(fixture.get("files"), Mapping) else {}
        self._written_refs: set[str] = set()
        if self.output_dir is not None:
            self.output_dir.mkdir(parents=True, exist_ok=True)

    def capture(self, request: ComputerUseRequest, history: Sequence[Any], query: str | None = None) -> Any:
        captures = _list_value(self.fixture.get("capture") or self.fixture.get("observations"))
        if captures:
            value = captures[min(self.capture_index, len(captures) - 1)]
        else:
            suffix = "after" if query == "after-action" else f"before-{self.capture_index + 1}"
            value = {"ref": f".sciforge/vision-runs/fixture/{suffix}.png", "summary": f"fixture {suffix}"}
        self.capture_index += 1
        return self._materialize_local_refs(value)

    def plan(self, request: ComputerUseRequest, observation: Observation, history: Sequence[Any]) -> Any:
        plans = _list_value(self.fixture.get("plan") or self.fixture.get("plans"))
        if plans:
            value = plans[min(self.plan_index, len(plans) - 1)]
        else:
            value = {"done": True, "reason": "fixture default planner reported done"}
        self.plan_index += 1
        return self._materialize_local_refs(value)

    def locate(self, observation: Observation, target: Any, history: Sequence[Any]) -> Any:
        values = _list_value(self.fixture.get("locate") or self.fixture.get("grounding"))
        value = values[min(self.locate_index, len(values) - 1)] if values else self.fixture.get("locate") or self.fixture.get("grounding")
        self.locate_index += 1
        if isinstance(value, Mapping):
            return self._materialize_local_refs(value)
        return {"ok": True, "x": 10, "y": 20, "confidence": 0.9}

    def execute(self, action: ActionPlan, grounding: Grounding | None, request: ComputerUseRequest) -> Any:
        values = _list_value(self.fixture.get("execute") or self.fixture.get("execution"))
        value = values[min(self.execute_index, len(values) - 1)] if values else self.fixture.get("execute") or self.fixture.get("execution")
        self.execute_index += 1
        if isinstance(value, Mapping):
            return self._materialize_local_refs(value)
        return {"ok": True, "message": "fixture executed"}

    def verify(
        self,
        request: ComputerUseRequest,
        before: Observation,
        after: Observation,
        action: ActionPlan,
        execution: ExecutionOutcome,
        history: Sequence[Any],
    ) -> Any:
        values = _list_value(self.fixture.get("verify") or self.fixture.get("verification"))
        value = values[min(self.verify_index, len(values) - 1)] if values else self.fixture.get("verify") or self.fixture.get("verification")
        self.verify_index += 1
        if isinstance(value, Mapping):
            return self._materialize_local_refs(value)
        return {"ok": True, "done": True, "reason": "fixture verified"}

    def write_trace(self, result: ComputerUseResult) -> str:
        if self.output_dir is not None:
            path = (self.output_dir / "vision-trace.json").resolve()
            trace = result_to_trace(result)
            trace["traceRefs"] = [str(path)]
            _write_json(path, trace)
            return str(path)
        value = self.fixture.get("writeTraceRef") or self.fixture.get("traceRef")
        return str(value or "trace:fixture/computer-use.json")

    def emit_event(self, event: Mapping[str, Any]) -> None:
        return None

    def _materialize_local_refs(self, value: Any) -> Any:
        if self.output_dir is None:
            return value
        return _materialize_local_refs(value, self.output_dir, self._files, self._written_refs)


def _load_json_arg_or_stdin(value: str | None) -> Any:
    if value:
        return _parse_json(value)
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    return _parse_json(raw)


def _load_fixture(fixture_json: str | None, fixture_file: str | None) -> Any:
    if fixture_json and fixture_file:
        raise ValueError("--fixture-json and --fixture-file are mutually exclusive.")
    if fixture_file:
        return _parse_json(Path(fixture_file).expanduser().read_text(encoding="utf8"))
    if fixture_json:
        return _parse_json(fixture_json)
    return None


def _parse_json(value: str) -> Any:
    parsed = json.loads(value)
    return parsed


def _write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{json.dumps(payload, indent=2, sort_keys=True)}\n", encoding="utf8")


def _maybe_write_repair_manifest(
    output_dir: Path,
    payload: Mapping[str, Any],
    *,
    result_path: Path,
) -> str | None:
    status = str(payload.get("status") or "")
    if status == "completed":
        return None
    failure_diagnostics = payload.get("failureDiagnostics")
    manifest_path = (output_dir / "blocked-repair-manifest.json").resolve()
    manifest = {
        "schemaVersion": "sciforge.computer-use.repair-manifest.v1",
        "status": status or "failed-with-reason",
        "reason": str(payload.get("reason") or payload.get("message") or ""),
        "failedStage": (
            failure_diagnostics.get("failedStage")
            if isinstance(failure_diagnostics, Mapping)
            else None
        ),
        "failureDiagnostics": dict(failure_diagnostics) if isinstance(failure_diagnostics, Mapping) else {},
        "traceRefs": list(payload.get("traceRefs") or []),
        "screenshotRefs": list(payload.get("screenshotRefs") or []),
        "artifactRefs": list(payload.get("artifactRefs") or []),
        "finalObservationRef": payload.get("finalObservationRef"),
        "finalArtifactRef": payload.get("finalArtifactRef"),
        "finalArtifactRefs": list(payload.get("finalArtifactRefs") or []),
        "resultRef": str(result_path.resolve()),
        "inputExecuted": False,
        "sharedSystemInputUsed": False,
        "realWindowEvidence": False,
        "diagnosticOnly": True,
        "rawPayloadWritten": False,
        "inlineImageWritten": False,
        "repairHint": "Use the failedStage, screenshot refs, and trace refs to extract the smallest package-local repair probe before rerunning.",
    }
    _write_json(manifest_path, manifest)
    return str(manifest_path)


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
        "screenshotRefs": trace.get("screenshotRefs", []),
        "artifactRefs": trace.get("artifactRefs", []),
        "finalArtifactRef": trace.get("finalArtifactRef"),
        "finalArtifactRefs": trace.get("finalArtifactRefs", []),
        "approvalRequest": trace.get("approvalRequest"),
        "steps": trace.get("steps", []),
        "budgetDebits": trace.get("budgetDebits", []),
        "budgetDebitRefs": trace.get("budgetDebitRefs", []),
        "evidenceLogRef": result.failure_diagnostics.get("evidenceLogRef"),
        "evidenceSnapshotRef": result.failure_diagnostics.get("evidenceSnapshotRef"),
        "evidenceIndexRef": result.failure_diagnostics.get("evidenceIndexRef"),
        "plannerBriefRef": result.failure_diagnostics.get("plannerBriefRef"),
    }


def _failure_result(reason: str) -> dict[str, Any]:
    return {
        "schemaVersion": "sciforge.computer-use.result.v1",
        "status": "failed-with-reason",
        "reason": reason,
        "message": reason,
        "finalObservationRef": None,
        "traceRefs": [],
        "screenshotRefs": [],
        "artifactRefs": [],
        "finalArtifactRef": None,
        "finalArtifactRefs": [],
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


def _materialize_local_refs(
    value: Any,
    output_dir: Path,
    files: Mapping[str, Any],
    written_refs: set[str],
    parent_key: str | None = None,
) -> Any:
    if isinstance(value, Mapping):
        return {
            str(key): _materialize_local_refs(item, output_dir, files, written_refs, parent_key=str(key))
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_materialize_local_refs(item, output_dir, files, written_refs, parent_key=parent_key) for item in value]
    if isinstance(value, tuple):
        return tuple(_materialize_local_refs(item, output_dir, files, written_refs, parent_key=parent_key) for item in value)
    if isinstance(value, str) and _looks_like_local_file_ref(value, parent_key=parent_key):
        path = _local_ref_path(value, output_dir)
        _write_fixture_ref(path, value, files, written_refs)
        return str(path)
    return value


def _local_ref_path(ref: str, output_dir: Path) -> Path:
    path = Path(ref).expanduser()
    if path.is_absolute():
        return path.resolve()
    return (output_dir / path).resolve()


def _write_fixture_ref(path: Path, original_ref: str, files: Mapping[str, Any], written_refs: set[str]) -> None:
    ref = str(path)
    if ref in written_refs or path.name in {"vision-trace.json", "computer-use-result.json"}:
        return
    content = files.get(original_ref, files.get(ref, None))
    if content is None:
        content = _default_fixture_ref_content(path, original_ref)
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(content, (Mapping, list)):
        path.write_text(f"{json.dumps(content, indent=2, sort_keys=True)}\n", encoding="utf8")
    elif isinstance(content, bytes):
        path.write_bytes(content)
    else:
        path.write_text(str(content), encoding="utf8")
    written_refs.add(ref)


def _default_fixture_ref_content(path: Path, original_ref: str) -> str | bytes:
    if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}:
        return _MINIMAL_PNG_BYTES
    return f"fixture ref: {original_ref}\n"


_MINIMAL_PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
    b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4"
    b"\x89\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?\x00\x05"
    b"\xfe\x02\xfeA\xe2\x8d\xb0\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _looks_like_local_file_ref(value: str, parent_key: str | None = None) -> bool:
    text = value.strip()
    if not text:
        return False
    if text.startswith(("artifact:", "file:", "workEvidence:", "budgetDebit:", "audit:", "approval:", "ref:", "trace:", "screenshot:", "capture:")):
        return False
    if "://" in text:
        return False
    if text.startswith(("/", "./", "../", ".sciforge/")):
        return True
    if not _looks_like_ref_key(parent_key):
        return False
    return text.lower().endswith(
        (".json", ".md", ".txt", ".csv", ".tsv", ".xlsx", ".ppt", ".pptx", ".pdf", ".png", ".jpg", ".jpeg", ".webp")
    )


def _looks_like_ref_key(key: str | None) -> bool:
    if key is None:
        return False
    normalized = key.replace("_", "").replace("-", "").lower()
    return any(token in normalized for token in ("ref", "refs", "path", "artifact", "output", "screenshot", "capture", "image"))


if __name__ == "__main__":
    raise SystemExit(main())
