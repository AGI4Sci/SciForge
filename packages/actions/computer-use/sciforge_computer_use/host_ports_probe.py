"""Package-local host-port probe runner for Computer Use.

This module drives ``python -m sciforge_computer_use --host-port-stdio`` as a
parent process. It is intentionally package-local: it proves the stdio host-port
contract and evidence plumbing without importing SciForge runtime, GUI, or
CU-NEXT code.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Mapping, Sequence

from .cli import (
    FINAL_RESULT_SCHEMA,
    HOST_PORT_CALL_SCHEMA,
    HOST_PORT_RESULT_SCHEMA,
    _MINIMAL_PNG_BYTES,
)


PROBE_MANIFEST_SCHEMA = "sciforge.computer-use.host-port-probe-manifest.v1"
LOOP_TRACE_SCHEMA = "sciforge.computer-use.loop-trace.v1"


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run a package-local Computer Use host-port stdio probe.")
    parser.add_argument("--request-json", required=True, help="ComputerUseRequest JSON for the child package loop.")
    parser.add_argument("--probe-file", required=True, help="Scripted host-port probe JSON file.")
    parser.add_argument("--output-dir", required=True, help="Directory for probe result, trace, manifest, and refs.")
    parser.add_argument(
        "--allow-shared-input",
        action="store_true",
        help="Allow scripted execution entries that declare inputChannel=shared-system.",
    )
    args = parser.parse_args(argv)

    try:
        runner = HostPortProbeRunner(
            request=_parse_json(args.request_json),
            probe=_load_json_file(args.probe_file),
            output_dir=Path(args.output_dir).expanduser(),
            allow_shared_input=args.allow_shared_input,
            probe_file=args.probe_file,
        )
        payload = runner.run()
        json.dump(payload, sys.stdout, sort_keys=True)
        sys.stdout.write("\n")
        sys.stdout.flush()
        return 0 if payload.get("status") in {"completed", "max-steps", "needs-confirmation"} else 1
    except Exception as exc:  # noqa: BLE001 - probe CLI must stay structured.
        payload = {
            "schemaVersion": "sciforge.computer-use.result.v1",
            "status": "failed-with-reason",
            "reason": str(exc),
            "message": str(exc),
            "failureDiagnostics": {"failedStage": "host-port-probe"},
        }
        json.dump(payload, sys.stdout, sort_keys=True)
        sys.stdout.write("\n")
        sys.stdout.flush()
        return 1


class HostPortProbeRunner:
    def __init__(
        self,
        *,
        request: Mapping[str, Any],
        probe: Mapping[str, Any],
        output_dir: Path,
        allow_shared_input: bool,
        probe_file: str,
    ) -> None:
        self.request = dict(request)
        self.probe = dict(probe)
        self.output_dir = output_dir.resolve()
        self.allow_shared_input = allow_shared_input
        self.probe_file = probe_file
        self.capture_index = 0
        self.plan_index = 0
        self.locate_index = 0
        self.execute_index = 0
        self.verify_index = 0
        self.calls: list[dict[str, Any]] = []
        self.written_refs: set[str] = set()
        self.files = self.probe.get("files") if isinstance(self.probe.get("files"), Mapping) else {}

    def run(self) -> dict[str, Any]:
        self.output_dir.mkdir(parents=True, exist_ok=True)
        env = {
            **os.environ,
            "PYTHONPATH": str(Path(__file__).resolve().parents[1]),
        }
        process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "sciforge_computer_use",
                "--request-json",
                json.dumps(self.request, sort_keys=True),
                "--host-port-stdio",
            ],
            cwd=Path(__file__).resolve().parents[1],
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

        final_payload: dict[str, Any] | None = None
        try:
            while True:
                line = process.stdout.readline()
                if not line:
                    break
                message = json.loads(line)
                if message.get("type") == "finalResult":
                    if message.get("schemaVersion") != FINAL_RESULT_SCHEMA:
                        raise RuntimeError(f"Unexpected finalResult schemaVersion={message.get('schemaVersion')!r}.")
                    final_payload = dict(message.get("result") or {})
                    break
                response = self._handle_call(message)
                process.stdin.write(f"{json.dumps(response, sort_keys=True)}\n")
                process.stdin.flush()
        finally:
            process.stdin.close()
            if process.poll() is None:
                process.wait(timeout=10)

        stderr = process.stderr.read()
        if stderr.strip():
            raise RuntimeError(f"Child Computer Use process wrote stderr: {stderr.strip()}")
        if final_payload is None:
            raise RuntimeError("Child Computer Use process exited before finalResult.")

        result_path = (self.output_dir / "computer-use-result.json").resolve()
        _write_json(result_path, final_payload)
        manifest = self._manifest(final_payload, child_returncode=process.returncode, result_path=result_path)
        _write_json(self.output_dir / "host-port-probe-manifest.json", manifest)
        return final_payload

    def _handle_call(self, message: Mapping[str, Any]) -> dict[str, Any]:
        if message.get("schemaVersion") != HOST_PORT_CALL_SCHEMA or message.get("type") != "hostPortCall":
            raise RuntimeError(f"Unexpected host-port message: {message!r}.")
        port = str(message.get("port") or "")
        self.calls.append({"id": message.get("id"), "port": port})
        try:
            result = self._port_result(port, list(message.get("args") or []), dict(message.get("kwargs") or {}))
            return {
                "schemaVersion": HOST_PORT_RESULT_SCHEMA,
                "type": "hostPortResult",
                "id": message.get("id"),
                "ok": True,
                "result": result,
            }
        except Exception as exc:  # noqa: BLE001 - return structured host-port failure.
            return {
                "schemaVersion": HOST_PORT_RESULT_SCHEMA,
                "type": "hostPortResult",
                "id": message.get("id"),
                "ok": False,
                "error": str(exc),
            }

    def _port_result(self, port: str, args: list[Any], kwargs: Mapping[str, Any]) -> Any:
        if port == "emitEvent":
            return None
        if port == "capture":
            return self._capture()
        if port == "plan":
            return self._next("plans", "plan", self.plan_index, increment="plan")
        if port == "locate":
            return self._next("grounding", "locate", self.locate_index, increment="locate", default={"ok": True, "x": 10, "y": 20, "confidence": 0.9})
        if port == "execute":
            action = args[0] if args else {}
            return self._execute(action)
        if port == "verify":
            return self._next("verification", "verify", self.verify_index, increment="verify", default={"ok": True, "done": True, "reason": "probe verified"})
        if port == "writeTrace":
            result_payload = args[0] if args and isinstance(args[0], Mapping) else {}
            trace_path = (self.output_dir / "vision-trace.json").resolve()
            _write_json(trace_path, self._trace_from_result_payload(result_payload, trace_path))
            return str(trace_path)
        raise RuntimeError(f"Unsupported host port {port!r}.")

    def _capture(self) -> Any:
        captures = _list_value(self.probe.get("capture") or self.probe.get("observations"))
        if captures:
            value = captures[min(self.capture_index, len(captures) - 1)]
        else:
            suffix = "after" if self.capture_index else "before"
            value = {"ref": f".sciforge/vision-runs/host-port-probe/{suffix}.png", "summary": f"probe {suffix}"}
        self.capture_index += 1
        return self._materialize_refs(value)

    def _execute(self, action: Any) -> dict[str, Any]:
        value = self._next("execution", "execute", self.execute_index, increment="execute", default={"ok": True, "message": "probe executed"})
        if not isinstance(value, Mapping):
            value = {"ok": True, "message": "probe executed"}
        metadata = value.get("metadata") if isinstance(value.get("metadata"), Mapping) else {}
        input_channel = str(metadata.get("inputChannel") or value.get("inputChannel") or "")
        if input_channel == "shared-system" and not self.allow_shared_input:
            return {
                "ok": False,
                "message": "Shared system input is disabled for host-port probe; pass --allow-shared-input only for an acknowledged diagnostic run.",
                "blocked": True,
                "metadata": {
                    "failedStage": "execution",
                    "inputChannel": "shared-system",
                    "sharedInputAcknowledged": False,
                    "actionKind": action.get("kind") if isinstance(action, Mapping) else None,
                },
            }
        return dict(value)

    def _next(
        self,
        primary_key: str,
        alias_key: str,
        index: int,
        *,
        increment: str,
        default: Any | None = None,
    ) -> Any:
        values = _list_value(self.probe.get(primary_key) or self.probe.get(alias_key))
        if values:
            value = values[min(index, len(values) - 1)]
        else:
            value = self.probe.get(primary_key) or self.probe.get(alias_key) or default
        if increment == "plan":
            self.plan_index += 1
        elif increment == "locate":
            self.locate_index += 1
        elif increment == "execute":
            self.execute_index += 1
        elif increment == "verify":
            self.verify_index += 1
        return self._materialize_refs(value)

    def _materialize_refs(self, value: Any) -> Any:
        return _materialize_local_refs(value, self.output_dir, self.files, self.written_refs)

    def _trace_from_result_payload(self, payload: Mapping[str, Any], trace_path: Path) -> dict[str, Any]:
        return {
            "schemaVersion": LOOP_TRACE_SCHEMA,
            "resultSchemaVersion": payload.get("schemaVersion"),
            "status": payload.get("status"),
            "reason": payload.get("reason") or payload.get("message"),
            "requestMetadata": dict(self.request.get("metadata") or {}),
            "approvalRequest": payload.get("approvalRequest"),
            "metrics": dict(payload.get("metrics") or {}),
            "failureDiagnostics": dict(payload.get("failureDiagnostics") or {}),
            "finalObservationRef": payload.get("finalObservationRef"),
            "traceRefs": [str(trace_path)],
            "screenshotRefs": list(payload.get("screenshotRefs") or []),
            "artifactRefs": list(payload.get("artifactRefs") or []),
            "finalArtifactRef": payload.get("finalArtifactRef"),
            "finalArtifactRefs": list(payload.get("finalArtifactRefs") or []),
            "steps": list(payload.get("steps") or []),
            "budgetDebits": list(payload.get("budgetDebits") or []),
            "budgetDebitRefs": list(payload.get("budgetDebitRefs") or []),
        }

    def _manifest(self, payload: Mapping[str, Any], *, child_returncode: int | None, result_path: Path) -> dict[str, Any]:
        return {
            "schemaVersion": PROBE_MANIFEST_SCHEMA,
            "status": payload.get("status"),
            "reason": payload.get("reason") or payload.get("message"),
            "childReturnCode": child_returncode,
            "probeFile": self.probe_file,
            "mode": "scripted-host-ports",
            "allowSharedInput": self.allow_shared_input,
            "hostPortCalls": self.calls,
            "resultRef": str(result_path),
            "traceRefs": list(payload.get("traceRefs") or []),
            "screenshotRefs": list(payload.get("screenshotRefs") or []),
            "artifactRefs": list(payload.get("artifactRefs") or []),
            "finalArtifactRef": payload.get("finalArtifactRef"),
            "finalArtifactRefs": list(payload.get("finalArtifactRefs") or []),
            "note": "This probe exercises the package stdio host-port contract. Scripted mode is not real desktop input evidence.",
        }


def _load_json_file(path: str) -> Mapping[str, Any]:
    parsed = json.loads(Path(path).expanduser().read_text(encoding="utf8"))
    if not isinstance(parsed, Mapping):
        raise ValueError("Probe JSON root must be an object.")
    return parsed


def _parse_json(value: str) -> Mapping[str, Any]:
    parsed = json.loads(value)
    if not isinstance(parsed, Mapping):
        raise ValueError("Request JSON root must be an object.")
    return parsed


def _write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{json.dumps(payload, indent=2, sort_keys=True)}\n", encoding="utf8")


def _materialize_local_refs(value: Any, output_dir: Path, files: Mapping[str, Any], written_refs: set[str], parent_key: str | None = None) -> Any:
    if isinstance(value, Mapping):
        return {
            str(key): _materialize_local_refs(item, output_dir, files, written_refs, parent_key=str(key))
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_materialize_local_refs(item, output_dir, files, written_refs, parent_key=parent_key) for item in value]
    if isinstance(value, str) and _looks_like_local_file_ref(value, parent_key=parent_key):
        path = _local_ref_path(value, output_dir)
        _write_ref(path, value, files, written_refs)
        return str(path)
    return value


def _local_ref_path(ref: str, output_dir: Path) -> Path:
    path = Path(ref).expanduser()
    if path.is_absolute():
        return path.resolve()
    return (output_dir / path).resolve()


def _write_ref(path: Path, original_ref: str, files: Mapping[str, Any], written_refs: set[str]) -> None:
    path_ref = str(path)
    if path_ref in written_refs or path.name in {"vision-trace.json", "computer-use-result.json", "host-port-probe-manifest.json"}:
        return
    content = files.get(original_ref, files.get(path_ref, None))
    if content is None:
        content = _MINIMAL_PNG_BYTES if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"} else f"probe ref: {original_ref}\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(content, (Mapping, list)):
        path.write_text(f"{json.dumps(content, indent=2, sort_keys=True)}\n", encoding="utf8")
    elif isinstance(content, bytes):
        path.write_bytes(content)
    else:
        path.write_text(str(content), encoding="utf8")
    written_refs.add(path_ref)


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
    return text.lower().endswith((".json", ".md", ".txt", ".csv", ".tsv", ".xlsx", ".ppt", ".pptx", ".pdf", ".png", ".jpg", ".jpeg", ".webp"))


def _looks_like_ref_key(key: str | None) -> bool:
    if key is None:
        return False
    normalized = key.replace("_", "").replace("-", "").lower()
    return any(token in normalized for token in ("ref", "refs", "path", "artifact", "output", "screenshot", "capture", "image"))


def _list_value(value: Any) -> list[Any]:
    return list(value) if isinstance(value, list) else []


if __name__ == "__main__":
    raise SystemExit(main())
