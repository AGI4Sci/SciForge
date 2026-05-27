"""Native-capture stdio host-port probe for the Computer Use package.

This runner drives the real ``--host-port-stdio`` child loop and provides a
native screenshot for the capture port. Execution still fails closed because
the package has no independent simulated input adapter yet.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Mapping, Sequence

from .cli import FINAL_RESULT_SCHEMA, HOST_PORT_CALL_SCHEMA, HOST_PORT_RESULT_SCHEMA
from .desktop_preflight import REQUIRED_HOST_PORTS, build_preflight_manifest
from .host_ports_probe import LOOP_TRACE_SCHEMA, _write_json
from .native_capture_probe import (
    _capture_command,
    _native_capture_provider,
    _png_metadata,
    _run_command,
    _select_window,
    _window_id,
    _window_inventory,
    write_native_target_window_binding_proof,
)
from .virtual_input_adapter import (
    INPUT_ADAPTER_BINDING_STATUS_VIRTUAL_STATE_ONLY,
    VIRTUAL_INPUT_ADAPTER_STATUS,
    build_input_adapter_target_binding_manifest,
    get_virtual_input_adapter_manifest,
)


NATIVE_STDIO_MANIFEST_SCHEMA = "sciforge.computer-use.native-stdio-probe-manifest.v1"


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run a native-capture Computer Use stdio host-port probe.")
    parser.add_argument("--request-json", required=True, help="ComputerUseRequest JSON for the child package loop.")
    parser.add_argument("--output-dir", required=True, help="Directory for result, trace, screenshot, and manifest refs.")
    parser.add_argument("--target-window", help="Optional target window substring for window-scoped capture.")
    args = parser.parse_args(argv)

    try:
        runner = NativeStdioProbeRunner(
            request=_parse_json(args.request_json),
            output_dir=Path(args.output_dir).expanduser(),
            target_window=args.target_window,
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
            "failureDiagnostics": {"failedStage": "native-stdio-probe"},
        }
        json.dump(payload, sys.stdout, sort_keys=True)
        sys.stdout.write("\n")
        sys.stdout.flush()
        return 1


class NativeStdioProbeRunner:
    def __init__(
        self,
        *,
        request: Mapping[str, Any],
        output_dir: Path,
        target_window: str | None = None,
        command_runner: Any = _run_command,
        inventory_reader: Any = _window_inventory,
    ) -> None:
        self.request = dict(request)
        self.output_dir = output_dir.resolve()
        self.target_window = target_window
        self.command_runner = command_runner
        self.inventory_reader = inventory_reader
        self.calls: list[dict[str, Any]] = []
        self.capture_index = 0
        self.capture_provider = _native_capture_provider()
        self.window_inventory: list[dict[str, Any]] = []
        self.selected_window: dict[str, Any] | None = None
        self.capture_scope = "display"
        self.screenshot_refs: list[str] = []
        self.screenshot_metadata: dict[str, Any] = {}
        self.preflight: dict[str, Any] | None = None
        self.input_adapter_manifest_ref: str | None = None
        self.input_adapter_binding_manifest_ref: str | None = None
        self.input_adapter_binding_manifest: dict[str, Any] | None = None
        self.selected_window_ref: str | None = None
        self.target_window_binding_proof_ref: str | None = None

    def run(self) -> dict[str, Any]:
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self._prepare_native_capture_state()
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
        manifest_path = (self.output_dir / "native-stdio-probe-manifest.json").resolve()
        manifest = self._manifest(final_payload, child_returncode=process.returncode, result_path=result_path)
        final_payload = self._payload_with_probe_refs(final_payload, manifest=manifest, manifest_path=manifest_path)
        _write_json(result_path, final_payload)
        _write_json(manifest_path, manifest)
        return final_payload

    def _prepare_native_capture_state(self) -> None:
        self.window_inventory = self.inventory_reader(runner=self.command_runner)
        if self.window_inventory:
            _write_json(
                self.output_dir / "native-window-inventory.json",
                {
                    "schemaVersion": "sciforge.computer-use.native-window-inventory.v1",
                    "windows": self.window_inventory,
                },
            )
        self.selected_window = _select_window(self.window_inventory, self.target_window) if self.target_window else None
        self.capture_scope = "window" if self.selected_window else "display"
        self._write_input_adapter_candidate_manifests()
        self._refresh_preflight()

    def _write_input_adapter_candidate_manifests(self) -> None:
        adapter_manifest_path = (self.output_dir / "native-stdio-input-adapter-manifest.json").resolve()
        binding_manifest_path = (self.output_dir / "native-stdio-target-binding-candidate.json").resolve()
        inventory_ref = str((self.output_dir / "native-window-inventory.json").resolve()) if self.window_inventory else None
        window_ref = self.target_window_binding_proof_ref or self.selected_window_ref
        evidence_refs = [
            ref for ref in [
                inventory_ref,
                self.selected_window_ref,
                *self.screenshot_refs,
                self.target_window_binding_proof_ref,
            ]
            if ref
        ]
        adapter_manifest = get_virtual_input_adapter_manifest()
        binding_manifest = build_input_adapter_target_binding_manifest(
            binding_status=INPUT_ADAPTER_BINDING_STATUS_VIRTUAL_STATE_ONLY,
            target_environment_kind="native-window-capture-only" if self.selected_window else "native-display-capture-only",
            target_window_resolved=bool(self.selected_window),
            execute_changes_target_environment=False,
            real_window_evidence_capable=False,
            adapter_manifest_ref=str(adapter_manifest_path),
            target_window_ref=window_ref,
            evidence_refs=evidence_refs,
            metadata={
                "captureScope": self.capture_scope,
                "claimLimit": "Candidate binding is refs-first but state-only; it cannot satisfy real desktop execution evidence.",
            },
        )
        _write_json(adapter_manifest_path, adapter_manifest)
        _write_json(binding_manifest_path, binding_manifest)
        self.input_adapter_manifest_ref = str(adapter_manifest_path)
        self.input_adapter_binding_manifest_ref = str(binding_manifest_path)
        self.input_adapter_binding_manifest = binding_manifest

    def _refresh_preflight(self) -> None:
        self.preflight = build_preflight_manifest(
            output_dir=self.output_dir,
            target_window=self.target_window if self.selected_window else None,
            observed_capabilities={
                "hostPorts": REQUIRED_HOST_PORTS,
                "captureProvider": self.capture_provider,
                "captureScope": self.capture_scope,
                "executorProvider": "native-stdio-fail-closed-executor",
                "targetWindow": self.selected_window,
                "inputAdapterStatus": VIRTUAL_INPUT_ADAPTER_STATUS,
                "inputAdapterManifestRef": self.input_adapter_manifest_ref,
                "inputAdapterBindingManifestRef": self.input_adapter_binding_manifest_ref,
                "inputChannel": "isolated-window" if self.selected_window else "none",
            },
        )

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
        except Exception as exc:  # noqa: BLE001 - preserve protocol response.
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
            return {
                "kind": "click",
                "target": {
                    "description": "native stdio diagnostic target",
                    "confidence": 0.5,
                },
                "reason": "Native stdio probe plans one low-risk action to prove execution fails closed without an independent input adapter.",
            }
        if port == "locate":
            return self._locate()
        if port == "execute":
            action = args[0] if args else {}
            return {
                "ok": False,
                "blocked": True,
                "message": "Native stdio probe captured the current window but will not execute input without an independent simulated input adapter.",
                "metadata": {
                    "failedStage": "execution",
                    "inputAdapterStatus": VIRTUAL_INPUT_ADAPTER_STATUS,
                    "inputAdapterManifestRef": self.input_adapter_manifest_ref,
                    "inputAdapterBindingManifestRef": self.input_adapter_binding_manifest_ref,
                    "inputChannel": "isolated-window" if self.selected_window else "none",
                    "targetBindingStatus": (
                        self.input_adapter_binding_manifest.get("bindingStatus")
                        if isinstance(self.input_adapter_binding_manifest, Mapping)
                        else None
                    ),
                    "sharedSystemInputUsed": False,
                    "actionKind": action.get("kind") if isinstance(action, Mapping) else None,
                    "captureScope": self.capture_scope,
                    "screenshotRefs": list(self.screenshot_refs),
                },
            }
        if port == "verify":
            return {
                "ok": False,
                "done": False,
                "reason": "Execution was blocked before verifier could evaluate a state change.",
                "metadata": {"captureScope": self.capture_scope, "screenshotRefs": list(self.screenshot_refs)},
            }
        if port == "writeTrace":
            result_payload = args[0] if args and isinstance(args[0], Mapping) else {}
            trace_path = (self.output_dir / "vision-trace.json").resolve()
            _write_json(trace_path, self._trace_from_result_payload(result_payload, trace_path))
            return str(trace_path)
        raise RuntimeError(f"Unsupported host port {port!r}.")

    def _capture(self) -> dict[str, Any]:
        if not self.capture_provider:
            raise RuntimeError("No native capture provider is available.")
        suffix = "before" if self.capture_index == 0 else f"capture-{self.capture_index + 1}"
        screenshot_ref = (self.output_dir / f"native-stdio-{suffix}.png").resolve()
        command = _capture_command(self.capture_provider, screenshot_ref, window_id=_window_id(self.selected_window))
        completed = self.command_runner(command)
        if completed.returncode != 0 or not screenshot_ref.is_file() or screenshot_ref.stat().st_size <= 0:
            raise RuntimeError(completed.stderr.strip() or completed.stdout.strip() or "Native capture command did not produce a screenshot.")
        self.capture_index += 1
        metadata = _png_metadata(screenshot_ref)
        self.screenshot_refs.append(str(screenshot_ref))
        self.screenshot_metadata[str(screenshot_ref)] = metadata
        proof = write_native_target_window_binding_proof(
            output_dir=self.output_dir,
            selected_window=self.selected_window,
            window_inventory_ref=str((self.output_dir / "native-window-inventory.json").resolve()) if self.window_inventory else None,
            screenshot_ref=str(screenshot_ref),
            capture_provider=self.capture_provider,
            capture_scope=self.capture_scope,
            screenshot_metadata=metadata,
        )
        if proof:
            self.selected_window_ref = proof["selectedWindowRef"]
            self.target_window_binding_proof_ref = proof["proofRef"]
            self._write_input_adapter_candidate_manifests()
            self._refresh_preflight()
        return {
            "ref": str(screenshot_ref),
            "summary": f"Native {self.capture_scope} screenshot captured for stdio host-port probe.",
            "metadata": {
                "captureProvider": self.capture_provider,
                "captureScope": self.capture_scope,
                "selectedWindow": self.selected_window,
                "screenshotMetadata": metadata,
                "inputExecuted": False,
                "sharedSystemInputUsed": False,
            },
        }

    def _locate(self) -> dict[str, Any]:
        latest = self.screenshot_refs[-1] if self.screenshot_refs else ""
        metadata = self.screenshot_metadata.get(latest, {})
        width = metadata.get("width") if isinstance(metadata, Mapping) else None
        height = metadata.get("height") if isinstance(metadata, Mapping) else None
        if isinstance(width, (int, float)) and isinstance(height, (int, float)) and width > 0 and height > 0:
            return {
                "ok": True,
                "x": width / 2,
                "y": height / 2,
                "confidence": 0.2,
                "reason": "Diagnostic center point only; execution remains blocked.",
                "metadata": {
                    "diagnosticOnly": True,
                    "captureScope": self.capture_scope,
                    "screenshotRef": latest,
                },
            }
        return {"ok": False, "reason": "No native screenshot metadata was available for diagnostic grounding."}

    def _trace_from_result_payload(self, payload: Mapping[str, Any], trace_path: Path) -> dict[str, Any]:
        return {
            "schemaVersion": LOOP_TRACE_SCHEMA,
            "resultSchemaVersion": payload.get("schemaVersion"),
            "status": payload.get("status"),
            "reason": payload.get("reason") or payload.get("message"),
            "requestMetadata": dict(self.request.get("metadata") or {}),
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
            "schemaVersion": NATIVE_STDIO_MANIFEST_SCHEMA,
            "status": payload.get("status"),
            "reason": payload.get("reason") or payload.get("message"),
            "childReturnCode": child_returncode,
            "mode": "native-capture-stdio-host-ports",
            "protocolSchemas": {
                "hostPortCall": HOST_PORT_CALL_SCHEMA,
                "hostPortResult": HOST_PORT_RESULT_SCHEMA,
                "finalResult": FINAL_RESULT_SCHEMA,
            },
            "requiredHostPorts": REQUIRED_HOST_PORTS,
            "observedHostPorts": ["capture", "plan", "locate", "execute", "writeTrace", "emitEvent"],
            "unreachedHostPorts": ["verify"],
            "captureProvider": self.capture_provider,
            "captureScope": self.capture_scope,
            "requestedTargetWindow": self.target_window,
            "targetWindowResolved": bool(self.selected_window),
            "selectedWindow": self.selected_window,
            "windowInventoryRef": str((self.output_dir / "native-window-inventory.json").resolve()) if self.window_inventory else None,
            "selectedWindowRef": self.selected_window_ref,
            "targetWindowBindingProofRef": self.target_window_binding_proof_ref,
            "screenshotRefs": list(payload.get("screenshotRefs") or self.screenshot_refs),
            "screenshotMetadataByRef": dict(self.screenshot_metadata),
            "resultRef": str(result_path),
            "traceRefs": list(payload.get("traceRefs") or []),
            "hostPortCalls": self.calls,
            "preflightRef": self.preflight.get("manifestRef") if isinstance(self.preflight, Mapping) else None,
            "preflightStatus": self.preflight.get("status") if isinstance(self.preflight, Mapping) else None,
            "preflightBlockedReasons": list(self.preflight.get("blockedReasons") or []) if isinstance(self.preflight, Mapping) else [],
            "inputAdapterManifestRef": self.input_adapter_manifest_ref,
            "inputAdapterBindingManifestRef": self.input_adapter_binding_manifest_ref,
            "selectedWindowRef": self.selected_window_ref,
            "targetWindowBindingProofRef": self.target_window_binding_proof_ref,
            "targetBindingStatus": (
                self.input_adapter_binding_manifest.get("bindingStatus")
                if isinstance(self.input_adapter_binding_manifest, Mapping)
                else None
            ),
            "targetBindingValidation": (
                self.preflight.get("inputIsolation", {}).get("targetBindingValidation")
                if isinstance(self.preflight, Mapping)
                else None
            ),
            "inputExecuted": False,
            "executeFailClosed": True,
            "inputChannel": "isolated-window" if self.selected_window else "none",
            "sharedSystemInputUsed": False,
            "rawPayloadWritten": False,
            "inlineImageWritten": False,
            "secretsWritten": False,
            "note": "This probe drives the real stdio host-port loop with native capture. It declares a refs-first state-only input adapter candidate, then intentionally blocks execution until that adapter is bound to a target environment that can change real-window state.",
        }

    def _payload_with_probe_refs(
        self,
        payload: Mapping[str, Any],
        *,
        manifest: Mapping[str, Any],
        manifest_path: Path,
    ) -> dict[str, Any]:
        updated = dict(payload)
        diagnostics = dict(updated.get("failureDiagnostics") or {})
        diagnostics.update({
            "nativeStdioProbeManifestRef": str(manifest_path),
            "nativeStdioPreflightRef": manifest.get("preflightRef"),
            "nativeStdioPreflightStatus": manifest.get("preflightStatus"),
            "nativeStdioPreflightBlockedReasons": list(manifest.get("preflightBlockedReasons") or []),
            "nativeStdioTargetWindowResolved": manifest.get("targetWindowResolved"),
            "nativeStdioRequestedTargetWindow": manifest.get("requestedTargetWindow"),
            "nativeStdioCaptureScope": manifest.get("captureScope"),
            "inputAdapterManifestRef": manifest.get("inputAdapterManifestRef"),
            "inputAdapterBindingManifestRef": manifest.get("inputAdapterBindingManifestRef"),
            "selectedWindowRef": manifest.get("selectedWindowRef"),
            "targetWindowBindingProofRef": manifest.get("targetWindowBindingProofRef"),
            "targetBindingStatus": manifest.get("targetBindingStatus"),
            "targetBindingValidation": manifest.get("targetBindingValidation"),
            "inputExecuted": False,
            "executeFailClosed": True,
            "sharedSystemInputUsed": False,
            "inputChannel": manifest.get("inputChannel") or "none",
        })
        updated["failureDiagnostics"] = diagnostics
        return updated


def _parse_json(value: str) -> Mapping[str, Any]:
    parsed = json.loads(value)
    if not isinstance(parsed, Mapping):
        raise ValueError("Request JSON root must be an object.")
    return parsed


if __name__ == "__main__":
    raise SystemExit(main())
