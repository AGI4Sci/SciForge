"""Package-local virtual desktop host-port probe.

This probe drives the real ``--host-port-stdio`` child loop while the parent
process supplies a deterministic virtual desktop host. It binds the
``VirtualInputAdapter`` to the execute port, so actions update isolated pointer
and keyboard state refs instead of moving the OS pointer or sending global keys.

The probe is intentionally not real-window evidence. It is a package-local
host implementation used to prove the independent input-adapter contract and
trace/file-evidence plumbing before a native host binds the same contract to a
real target environment.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Mapping, Sequence

from .cli import FINAL_RESULT_SCHEMA, HOST_PORT_CALL_SCHEMA, HOST_PORT_RESULT_SCHEMA, _MINIMAL_PNG_BYTES
from .host_ports_probe import LOOP_TRACE_SCHEMA, _write_json
from .trace import build_repair_replay_evidence, build_viewport_recovery_evidence
from .virtual_input_adapter import (
    VIRTUAL_INPUT_ADAPTER_STATUS,
    VIRTUAL_INPUT_CHANNEL,
    VirtualInputAdapter,
    get_virtual_input_adapter_manifest,
)


VIRTUAL_DESKTOP_PROBE_MANIFEST_SCHEMA = "sciforge.computer-use.virtual-desktop-probe-manifest.v1"
VIRTUAL_DESKTOP_SCENARIO_SCHEMA = "sciforge.computer-use.virtual-desktop-scenario.v1"
REQUIRED_HOST_PORTS = ["capture", "plan", "locate", "execute", "verify", "writeTrace", "emitEvent"]
CONTROL_FILE_NAMES = {
    "vision-trace.json",
    "computer-use-result.json",
    "virtual-desktop-probe-manifest.json",
    "tool-payload.json",
    "gui-present.json",
    "gui-ask-user.json",
    "approval-request.json",
    "risk-audit.json",
    "confirmed-request.json",
    "blocked-manifest.json",
    "repair-hint.json",
    "continuation-request.json",
    "directory-listing.json",
    "tui-host-run-task-chain.json",
    "action-ledger.json",
    "failure-diagnostics.json",
}


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run a virtual desktop Computer Use stdio host-port probe.")
    parser.add_argument("--request-json", required=True, help="ComputerUseRequest JSON for the child package loop.")
    parser.add_argument("--scenario-file", required=True, help="Virtual desktop scenario JSON file.")
    parser.add_argument("--output-dir", required=True, help="Directory for result, trace, state refs, and manifest.")
    parser.add_argument("--source-repair-manifest", help="Optional previous blocked-repair-manifest.json ref for replay evidence.")
    args = parser.parse_args(argv)

    try:
        runner = VirtualDesktopProbeRunner(
            request=_parse_json(args.request_json),
            scenario=_load_json_file(args.scenario_file),
            output_dir=Path(args.output_dir).expanduser(),
            scenario_file=args.scenario_file,
            source_repair_manifest=Path(args.source_repair_manifest).expanduser() if args.source_repair_manifest else None,
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
            "failureDiagnostics": {"failedStage": "virtual-desktop-probe"},
        }
        json.dump(payload, sys.stdout, sort_keys=True)
        sys.stdout.write("\n")
        sys.stdout.flush()
        return 1


class VirtualDesktopProbeRunner:
    def __init__(
        self,
        *,
        request: Mapping[str, Any],
        scenario: Mapping[str, Any],
        output_dir: Path,
        scenario_file: str | None = None,
        source_repair_manifest: Path | None = None,
    ) -> None:
        self.scenario = _normalize_scenario(scenario)
        self.output_dir = output_dir.resolve()
        self.request = _request_with_evidence_output_dir(request, self.output_dir)
        self.scenario_file = scenario_file
        self.source_repair_manifest = source_repair_manifest.resolve() if source_repair_manifest else None
        self.calls: list[dict[str, Any]] = []
        self.capture_index = 0
        self.plan_index = 0
        self.verify_index = 0
        self.current_screen_index = 0
        self.written_refs: set[str] = set()
        self.files = self.scenario.get("files") if isinstance(self.scenario.get("files"), Mapping) else {}
        self.input_adapter = VirtualInputAdapter(self.output_dir / "virtual-input-state", session_id=_scenario_id(self.scenario))
        self.locate_failures: list[dict[str, Any]] = []
        self.viewport_failures: list[dict[str, Any]] = []

    def run(self) -> dict[str, Any]:
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self._write_scenario_snapshot()
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
        manifest_path = (self.output_dir / "virtual-desktop-probe-manifest.json").resolve()
        manifest = self._manifest(final_payload, child_returncode=process.returncode, result_path=result_path)
        final_payload = self._payload_with_probe_metadata(final_payload, manifest_path=manifest_path)
        repair_manifest_ref = self._maybe_write_repair_manifest(
            final_payload,
            result_path=result_path,
            probe_manifest_path=manifest_path,
        )
        if repair_manifest_ref:
            final_payload.setdefault("failureDiagnostics", {})["repairManifestRef"] = repair_manifest_ref
            manifest["repairManifestRef"] = repair_manifest_ref
        replay_evidence_ref = self._maybe_write_repair_replay_evidence(
            final_payload,
            result_path=result_path,
        )
        if replay_evidence_ref:
            final_payload.setdefault("failureDiagnostics", {})["repairReplayEvidenceRef"] = replay_evidence_ref
            manifest["repairReplayEvidenceRef"] = replay_evidence_ref
        viewport_evidence_ref = self._maybe_write_viewport_recovery_evidence(
            final_payload,
            result_path=result_path,
        )
        if viewport_evidence_ref:
            final_payload.setdefault("failureDiagnostics", {})["viewportRecoveryEvidenceRef"] = viewport_evidence_ref
            manifest["viewportRecoveryEvidenceRef"] = viewport_evidence_ref
        _write_json(result_path, final_payload)
        _write_json(manifest_path, manifest)
        return final_payload

    def _handle_call(self, message: Mapping[str, Any]) -> dict[str, Any]:
        if message.get("schemaVersion") != HOST_PORT_CALL_SCHEMA or message.get("type") != "hostPortCall":
            raise RuntimeError(f"Unexpected host-port message: {message!r}.")
        port = str(message.get("port") or "")
        self.calls.append({"id": message.get("id"), "port": port})
        try:
            result = self._port_result(port, list(message.get("args") or []))
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

    def _port_result(self, port: str, args: list[Any]) -> Any:
        if port == "emitEvent":
            return None
        if port == "capture":
            return self._capture()
        if port == "plan":
            return self._plan()
        if port == "locate":
            target = args[1] if len(args) > 1 else {}
            return self._locate(target)
        if port == "execute":
            action = args[0] if args else {}
            grounding = args[1] if len(args) > 1 else None
            return self._execute(action, grounding)
        if port == "verify":
            return self._verify()
        if port == "writeTrace":
            result_payload = args[0] if args and isinstance(args[0], Mapping) else {}
            trace_path = (self.output_dir / "vision-trace.json").resolve()
            _write_json(trace_path, self._trace_from_result_payload(result_payload, trace_path))
            return str(trace_path)
        raise RuntimeError(f"Unsupported host port {port!r}.")

    def _capture(self) -> dict[str, Any]:
        screen = self._screen_for_capture()
        capture_ref = _screen_ref(screen, default=f".sciforge/vision-runs/virtual-desktop/capture-{self.capture_index + 1}.png")
        screenshot_ref = self._materialize_ref(capture_ref)
        observation = {
            "ref": screenshot_ref,
            "summary": str(screen.get("summary") or f"Virtual desktop screen {self.current_screen_index}."),
            "visibleTexts": _visible_texts(screen),
            "artifacts": self._materialize_refs(screen.get("artifacts") or {}),
            "metadata": {
                **_safe_mapping(screen.get("metadata")),
                "schemaVersion": "sciforge.computer-use.virtual-desktop-observation.v1",
                "scenarioId": _scenario_id(self.scenario),
                "screenId": screen.get("id"),
                "screenIndex": self.current_screen_index,
                "virtualDesktop": True,
                "realWindowEvidence": False,
                "inputAdapterStatus": VIRTUAL_INPUT_ADAPTER_STATUS,
                "inputChannel": VIRTUAL_INPUT_CHANNEL,
                "inputExecuted": False,
                "sharedSystemInputUsed": False,
                "elements": _safe_elements(screen.get("elements")),
            },
        }
        self.capture_index += 1
        return observation

    def _plan(self) -> dict[str, Any]:
        plans = _list_of_mappings(self.scenario.get("plans"))
        if self.plan_index < len(plans):
            plan = dict(plans[self.plan_index])
        else:
            plan = {"done": True, "reason": "virtual desktop scenario exhausted its plan list"}
        self.plan_index += 1
        return self._materialize_refs(plan)

    def _locate(self, target: Any) -> dict[str, Any]:
        target_text = _target_text(target)
        screen = self._screen_for_capture()
        matches = _matching_elements(screen, target_text)
        if not target_text:
            return {"ok": False, "reason": "Virtual desktop target description was empty.", "metadata": {"failedStage": "grounding"}}
        if not matches:
            offscreen_matches = _offscreen_matching_elements(screen, target_text)
            if offscreen_matches:
                failure = {
                    "targetDescription": target_text,
                    "failureClass": "offscreen-target",
                    "visibleMatchCount": 0,
                    "offscreenCandidateElementIds": _element_ids(offscreen_matches),
                    "offscreenMatches": [_element_summary(element) for element in offscreen_matches],
                    "screenId": screen.get("id"),
                    "beforeObservationRef": self._materialize_ref(_screen_ref(screen, default=".sciforge/vision-runs/virtual-desktop/offscreen-before.png")),
                    "recommendedRecoveryAction": {"kind": "scroll", "direction": "down"},
                }
                self.viewport_failures.append(failure)
                return {
                    "ok": False,
                    "reason": f"Virtual desktop target {target_text!r} is offscreen in the current viewport.",
                    "metadata": {
                        "failedStage": "grounding",
                        "repairHint": "Scroll or change viewport until the offscreen target is visible, then rerun grounding.",
                        **failure,
                    },
                }
            return {
                "ok": False,
                "reason": f"Virtual desktop target {target_text!r} was not found.",
                "metadata": {"failedStage": "grounding", "targetDescription": target_text},
            }
        if len(matches) > 1:
            failure = {
                "targetDescription": target_text,
                "matchCount": len(matches),
                "matches": [_element_summary(element) for element in matches],
            }
            self.locate_failures.append(failure)
            return {
                "ok": False,
                "reason": f"Virtual desktop target {target_text!r} matched {len(matches)} elements.",
                "metadata": {
                    "failedStage": "grounding",
                    "repairHint": "Add distinguishing text, role, or region to the target description.",
                    **failure,
                },
            }
        element = matches[0]
        bounds = _safe_mapping(element.get("bounds"))
        x = _number(bounds.get("x"), _number(element.get("x"), 10.0))
        y = _number(bounds.get("y"), _number(element.get("y"), 10.0))
        width = _number(bounds.get("width"), 0.0)
        height = _number(bounds.get("height"), 0.0)
        return {
            "ok": True,
            "x": x + width / 2,
            "y": y + height / 2,
            "coordinateSpace": "virtual-desktop",
            "confidence": _number(element.get("confidence"), 0.9),
            "reason": f"Virtual desktop located {target_text!r}.",
            "metadata": {
                "scenarioId": _scenario_id(self.scenario),
                "screenId": screen.get("id"),
                "elementId": element.get("id"),
                "matchCount": 1,
                "diagnosticOnly": True,
                "realWindowEvidence": False,
            },
        }

    def _execute(self, action: Any, grounding: Any) -> dict[str, Any]:
        state_refs_before = dict(self.input_adapter.state_refs)
        outcome = self.input_adapter.execute(action, grounding, self.request)
        self.current_screen_index = self._next_screen_index(action, grounding)
        payload = {
            "ok": outcome.ok,
            "blocked": outcome.blocked,
            "message": outcome.message,
            "metadata": {
                **dict(outcome.metadata),
                "stateRefsBefore": state_refs_before,
                "stateRefsAfter": dict(self.input_adapter.state_refs),
                "scenarioId": _scenario_id(self.scenario),
                "virtualDesktop": True,
                "realWindowEvidence": False,
                "inputExecuted": False,
                "sharedSystemInputUsed": False,
            },
        }
        return payload

    def _verify(self) -> dict[str, Any]:
        verifications = _list_of_mappings(self.scenario.get("verification"))
        index = min(self.verify_index, len(verifications) - 1) if verifications else -1
        value = dict(verifications[index]) if index >= 0 else {"ok": True, "done": False, "reason": "virtual desktop step verified"}
        self.verify_index += 1
        metadata = _safe_mapping(value.get("metadata"))
        value["metadata"] = {
            **self._materialize_refs(metadata),
            "scenarioId": _scenario_id(self.scenario),
            "virtualDesktop": True,
            "realWindowEvidence": False,
            "inputAdapterStateRefs": dict(self.input_adapter.state_refs),
        }
        return self._materialize_refs(value)

    def _screen_for_capture(self, *, offset: int = 0) -> Mapping[str, Any]:
        screens = _screens(self.scenario)
        if not screens:
            return {}
        index = self.current_screen_index + offset
        index = min(max(index, 0), len(screens) - 1)
        return screens[index]

    def _materialize_refs(self, value: Any) -> Any:
        if isinstance(value, Mapping):
            return {str(key): self._materialize_refs(item) for key, item in value.items()}
        if isinstance(value, list):
            return [self._materialize_refs(item) for item in value]
        if isinstance(value, str) and _looks_like_local_ref(value):
            return self._materialize_ref(value)
        return value

    def _materialize_ref(self, ref: str) -> str:
        path = _local_ref_path(ref, self.output_dir)
        path_ref = str(path)
        if path_ref not in self.written_refs:
            content = self.files.get(ref, self.files.get(path_ref))
            if content is None:
                content = _MINIMAL_PNG_BYTES if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"} else f"virtual desktop ref: {ref}\n"
            _write_ref(path, content)
            self.written_refs.add(path_ref)
        return path_ref

    def _write_scenario_snapshot(self) -> None:
        _write_json(self.output_dir / "virtual-desktop-scenario.json", self.scenario)
        adapter_manifest_ref = self.output_dir / "virtual-input-adapter-manifest.json"
        _write_json(adapter_manifest_ref, get_virtual_input_adapter_manifest(state_refs=self.input_adapter.state_refs))

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
            "evidenceLogRef": payload.get("evidenceLogRef"),
            "evidenceSnapshotRef": payload.get("evidenceSnapshotRef"),
            "evidenceIndexRef": payload.get("evidenceIndexRef"),
            "plannerBriefRef": payload.get("plannerBriefRef"),
            "steps": list(payload.get("steps") or []),
            "budgetDebits": list(payload.get("budgetDebits") or []),
            "budgetDebitRefs": list(payload.get("budgetDebitRefs") or []),
        }

    def _manifest(self, payload: Mapping[str, Any], *, child_returncode: int | None, result_path: Path) -> dict[str, Any]:
        return {
            "schemaVersion": VIRTUAL_DESKTOP_PROBE_MANIFEST_SCHEMA,
            "status": payload.get("status"),
            "reason": payload.get("reason") or payload.get("message"),
            "childReturnCode": child_returncode,
            "mode": "package-local-virtual-desktop-host-ports",
            "scenarioFile": self.scenario_file,
            "scenarioId": _scenario_id(self.scenario),
            "protocolSchemas": {
                "hostPortCall": HOST_PORT_CALL_SCHEMA,
                "hostPortResult": HOST_PORT_RESULT_SCHEMA,
                "finalResult": FINAL_RESULT_SCHEMA,
            },
            "requiredHostPorts": REQUIRED_HOST_PORTS,
            "observedHostPorts": sorted({call["port"] for call in self.calls}),
            "unreachedHostPorts": [port for port in REQUIRED_HOST_PORTS if port not in {call["port"] for call in self.calls}],
            "hostPortCalls": self.calls,
            "resultRef": str(result_path),
            "traceRefs": list(payload.get("traceRefs") or []),
            "screenshotRefs": list(payload.get("screenshotRefs") or []),
            "artifactRefs": list(payload.get("artifactRefs") or []),
            "finalArtifactRef": payload.get("finalArtifactRef"),
            "finalArtifactRefs": list(payload.get("finalArtifactRefs") or []),
            "evidenceLogRef": payload.get("evidenceLogRef"),
            "evidenceSnapshotRef": payload.get("evidenceSnapshotRef"),
            "evidenceIndexRef": payload.get("evidenceIndexRef"),
            "plannerBriefRef": payload.get("plannerBriefRef"),
            "fileListArtifactRef": _file_list_ref(payload, "artifact"),
            "fileListDataRef": _file_list_ref(payload, "data"),
            "inputAdapterManifestRef": str((self.output_dir / "virtual-input-adapter-manifest.json").resolve()),
            "virtualInputStateRefs": dict(self.input_adapter.state_refs),
            "virtualInputStateRef": self.input_adapter.state_refs.get("virtualInputStateRef"),
            "virtualPointerStateRef": self.input_adapter.state_refs.get("virtualPointerStateRef"),
            "virtualKeyboardStateRef": self.input_adapter.state_refs.get("virtualKeyboardStateRef"),
            "locateFailures": self.locate_failures,
            "viewportFailures": self.viewport_failures,
            "executorProvider": "virtual-input-state-executor",
            "inputAdapterStatus": VIRTUAL_INPUT_ADAPTER_STATUS,
            "inputChannel": VIRTUAL_INPUT_CHANNEL,
            "bindingStatus": "virtual-state-only",
            "executeChangesTargetEnvironment": False,
            "realWindowEvidenceCapable": False,
            "stateOnlyActionsExecuted": bool([call for call in self.calls if call["port"] == "execute"]),
            "inputExecuted": False,
            "osInputExecuted": False,
            "realOsInputExecuted": False,
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
            "realWindowStateChanged": False,
            "realWindowEvidence": False,
            "diagnosticOnly": True,
            "rawPayloadWritten": False,
            "inlineImageWritten": False,
            "secretsWritten": False,
            "note": "This probe binds an independent virtual input adapter to package-local stdio host ports. It is not real-window desktop evidence.",
        }

    def _payload_with_probe_metadata(self, payload: Mapping[str, Any], *, manifest_path: Path) -> dict[str, Any]:
        updated = dict(payload)
        diagnostics = dict(updated.get("failureDiagnostics") or {})
        diagnostics.update({
            "virtualDesktopProbeManifestRef": str(manifest_path),
            "inputAdapterManifestRef": str((self.output_dir / "virtual-input-adapter-manifest.json").resolve()),
            "virtualInputStateRefs": dict(self.input_adapter.state_refs),
            "virtualInputStateRef": self.input_adapter.state_refs.get("virtualInputStateRef"),
            "virtualPointerStateRef": self.input_adapter.state_refs.get("virtualPointerStateRef"),
            "virtualKeyboardStateRef": self.input_adapter.state_refs.get("virtualKeyboardStateRef"),
            "fileListArtifactRef": _file_list_ref(updated, "artifact"),
            "fileListDataRef": _file_list_ref(updated, "data"),
            "inputAdapterStatus": VIRTUAL_INPUT_ADAPTER_STATUS,
            "inputChannel": VIRTUAL_INPUT_CHANNEL,
            "bindingStatus": "virtual-state-only",
            "executeChangesTargetEnvironment": False,
            "realWindowEvidenceCapable": False,
            "stateOnlyActionsExecuted": bool([call for call in self.calls if call["port"] == "execute"]),
            "inputExecuted": False,
            "osInputExecuted": False,
            "realOsInputExecuted": False,
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
            "realWindowStateChanged": False,
            "realWindowEvidence": False,
            "diagnosticOnly": True,
        })
        if self.locate_failures:
            diagnostics["virtualDesktopLocateFailures"] = list(self.locate_failures)
        if self.viewport_failures:
            diagnostics["virtualDesktopViewportFailures"] = list(self.viewport_failures)
        updated["failureDiagnostics"] = diagnostics
        return updated

    def _maybe_write_repair_manifest(
        self,
        payload: Mapping[str, Any],
        *,
        result_path: Path,
        probe_manifest_path: Path,
    ) -> str | None:
        status = str(payload.get("status") or "")
        if status == "completed":
            return None
        diagnostics = dict(payload.get("failureDiagnostics") or {})
        manifest_path = (self.output_dir / "blocked-repair-manifest.json").resolve()
        repair_manifest = {
            "schemaVersion": "sciforge.computer-use.repair-manifest.v1",
            "status": status or "failed-with-reason",
            "reason": str(payload.get("reason") or payload.get("message") or ""),
            "failedStage": diagnostics.get("failedStage"),
            "failureDiagnostics": diagnostics,
            "traceRefs": list(payload.get("traceRefs") or []),
            "screenshotRefs": list(payload.get("screenshotRefs") or []),
            "artifactRefs": list(payload.get("artifactRefs") or []),
            "finalObservationRef": payload.get("finalObservationRef"),
            "finalArtifactRef": payload.get("finalArtifactRef"),
            "finalArtifactRefs": list(payload.get("finalArtifactRefs") or []),
            "resultRef": str(result_path.resolve()),
            "probeManifestRef": str(probe_manifest_path.resolve()),
            "scenarioRef": str((self.output_dir / "virtual-desktop-scenario.json").resolve()),
            "scenarioFile": self.scenario_file,
            "scenarioId": _scenario_id(self.scenario),
            "locateFailures": list(self.locate_failures),
            "viewportFailures": list(self.viewport_failures),
            "scenarioAmbiguity": _safe_mapping(self.scenario.get("ambiguity")),
            "inputAdapterManifestRef": str((self.output_dir / "virtual-input-adapter-manifest.json").resolve()),
            "virtualInputStateRefs": dict(self.input_adapter.state_refs),
            "inputAdapterStatus": VIRTUAL_INPUT_ADAPTER_STATUS,
            "inputChannel": VIRTUAL_INPUT_CHANNEL,
            "stateOnlyActionsExecuted": bool([call for call in self.calls if call["port"] == "execute"]),
            "inputExecuted": False,
            "sharedSystemInputUsed": False,
            "realWindowEvidence": False,
            "diagnosticOnly": True,
            "rawPayloadWritten": False,
            "inlineImageWritten": False,
            "repairHint": (
                "Use failedStage, locateFailures, viewportFailures, current screenshot refs, and scenarioAmbiguity "
                "to extract the smallest disambiguating target or viewport recovery probe before rerunning."
            ),
        }
        _write_json(manifest_path, repair_manifest)
        return str(manifest_path)

    def _maybe_write_repair_replay_evidence(
        self,
        payload: Mapping[str, Any],
        *,
        result_path: Path,
    ) -> str | None:
        if str(payload.get("status") or "") != "completed" or self.source_repair_manifest is None:
            return None
        trace_path = self.output_dir / "vision-trace.json"
        evidence_path = (self.output_dir / "repair-replay-evidence.json").resolve()
        evidence = build_repair_replay_evidence(
            self.source_repair_manifest,
            payload,
            trace_path if trace_path.is_file() else None,
            replay_result_ref_override=str(result_path.resolve()),
        )
        _write_json(evidence_path, evidence)
        return str(evidence_path)

    def _maybe_write_viewport_recovery_evidence(
        self,
        payload: Mapping[str, Any],
        *,
        result_path: Path,
    ) -> str | None:
        if str(payload.get("status") or "") != "completed" or self.source_repair_manifest is None:
            return None
        try:
            source = _load_json_file(str(self.source_repair_manifest))
        except (OSError, json.JSONDecodeError, ValueError):
            return None
        if not _list_of_mappings(source.get("viewportFailures")):
            return None
        trace_path = self.output_dir / "vision-trace.json"
        evidence_path = (self.output_dir / "viewport-recovery-evidence.json").resolve()
        evidence = build_viewport_recovery_evidence(
            self.source_repair_manifest,
            payload,
            trace_path if trace_path.is_file() else None,
            replay_result_ref_override=str(result_path.resolve()),
        )
        _write_json(evidence_path, evidence)
        return str(evidence_path)

    def _next_screen_index(self, action: Any, grounding: Any) -> int:
        screens = _screens(self.scenario)
        if not screens:
            return self.current_screen_index
        transition_index = _transition_target_index(
            self.scenario.get("transitions"),
            screens,
            self.current_screen_index,
            action,
            grounding,
        )
        if transition_index is not None:
            return transition_index
        return min(self.current_screen_index + 1, len(screens) - 1)


def _load_json_file(path: str) -> Mapping[str, Any]:
    parsed = json.loads(Path(path).expanduser().read_text(encoding="utf8"))
    if not isinstance(parsed, Mapping):
        raise ValueError("Virtual desktop scenario root must be a JSON object.")
    return parsed


def _parse_json(value: str) -> Mapping[str, Any]:
    parsed = json.loads(value)
    if not isinstance(parsed, Mapping):
        raise ValueError("Request JSON root must be an object.")
    return parsed


def _request_with_evidence_output_dir(request: Mapping[str, Any], output_dir: Path) -> dict[str, Any]:
    payload = dict(request)
    metadata = dict(payload.get("metadata") or {})
    metadata.setdefault("evidenceOutputDir", str(output_dir.resolve()))
    payload["metadata"] = metadata
    return payload


def _normalize_scenario(scenario: Mapping[str, Any]) -> dict[str, Any]:
    normalized = dict(scenario)
    normalized.setdefault("schemaVersion", VIRTUAL_DESKTOP_SCENARIO_SCHEMA)
    normalized.setdefault("id", "virtual-desktop")
    normalized.setdefault("screens", [])
    normalized.setdefault("plans", [])
    normalized.setdefault("verification", [])
    normalized.setdefault("files", {})
    return normalized


def _scenario_id(scenario: Mapping[str, Any]) -> str:
    return str(scenario.get("id") or "virtual-desktop")


def _screens(scenario: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    value = scenario.get("screens") or scenario.get("observations")
    return _list_of_mappings(value)


def _screen_ref(screen: Mapping[str, Any], *, default: str) -> str:
    value = screen.get("ref") or screen.get("screenshotRef") or default
    return str(value)


def _visible_texts(screen: Mapping[str, Any]) -> list[str]:
    texts = list(str(item) for item in screen.get("visibleTexts") or screen.get("visible_texts") or [])
    for element in _safe_elements(screen.get("elements")):
        if _element_visibility(element) == "offscreen":
            continue
        label = element.get("text") or element.get("label") or element.get("description")
        if isinstance(label, str) and label and label not in texts:
            texts.append(label)
    return texts


def _matching_elements(screen: Mapping[str, Any], target_text: str) -> list[Mapping[str, Any]]:
    return [
        element
        for element in _matching_elements_by_visibility(screen, target_text)
        if _element_visibility(element) != "offscreen"
    ]


def _offscreen_matching_elements(screen: Mapping[str, Any], target_text: str) -> list[Mapping[str, Any]]:
    return [
        element
        for element in _matching_elements_by_visibility(screen, target_text)
        if _element_visibility(element) == "offscreen"
    ]


def _matching_elements_by_visibility(screen: Mapping[str, Any], target_text: str) -> list[Mapping[str, Any]]:
    target = _normalize_text(target_text)
    matches: list[Mapping[str, Any]] = []
    for element in _safe_elements(screen.get("elements")):
        haystacks = [
            element.get("id"),
            element.get("text"),
            element.get("label"),
            element.get("role"),
            element.get("description"),
            *list(element.get("aliases") or [] if isinstance(element.get("aliases"), list) else []),
        ]
        normalized = [_normalize_text(str(item)) for item in haystacks if item]
        if any(item and (item in target or target in item) for item in normalized):
            matches.append(element)
    return matches


def _element_visibility(element: Mapping[str, Any]) -> str:
    return str(element.get("visibility") or element.get("viewport") or "visible").strip().lower() or "visible"


def _element_ids(elements: Sequence[Mapping[str, Any]]) -> list[str]:
    ids: list[str] = []
    for element in elements:
        value = element.get("id") or element.get("elementId")
        if isinstance(value, str) and value.strip():
            ids.append(value.strip())
    return ids


def _transition_target_index(
    transitions: Any,
    screens: Sequence[Mapping[str, Any]],
    current_index: int,
    action: Any,
    grounding: Any,
) -> int | None:
    current_screen = screens[current_index] if 0 <= current_index < len(screens) else {}
    for transition in _list_of_mappings(transitions):
        if not _transition_matches(transition, current_screen, current_index, action, grounding):
            continue
        target = transition.get("toScreenId") or transition.get("to") or transition.get("screenId")
        if isinstance(target, str):
            for index, screen in enumerate(screens):
                if screen.get("id") == target:
                    return index
        if isinstance(target, int):
            return min(max(target, 0), len(screens) - 1)
    return None


def _transition_matches(
    transition: Mapping[str, Any],
    current_screen: Mapping[str, Any],
    current_index: int,
    action: Any,
    grounding: Any,
) -> bool:
    action_record = action if isinstance(action, Mapping) else {}
    from_screen = transition.get("fromScreenId") or transition.get("from")
    if isinstance(from_screen, str) and from_screen != current_screen.get("id"):
        return False
    if isinstance(from_screen, int) and from_screen != current_index:
        return False
    expected_kind = transition.get("actionKind") or transition.get("kind")
    if isinstance(expected_kind, str) and expected_kind != str(action_record.get("kind") or action_record.get("type") or ""):
        return False
    expected_direction = transition.get("direction")
    if isinstance(expected_direction, str) and expected_direction != str(action_record.get("direction") or ""):
        return False
    expected_element = transition.get("elementId")
    grounding_metadata = _safe_mapping(_safe_mapping(grounding).get("metadata"))
    if isinstance(expected_element, str) and expected_element != grounding_metadata.get("elementId"):
        return False
    target_contains = transition.get("targetContains")
    if isinstance(target_contains, str):
        target_text = _normalize_text(_target_text(action_record.get("target") or action_record.get("targetDescription")))
        if _normalize_text(target_contains) not in target_text:
            return False
    return True


def _target_text(target: Any) -> str:
    if isinstance(target, str):
        return target
    if isinstance(target, Mapping):
        return str(target.get("description") or target.get("targetDescription") or target.get("text") or "")
    return str(target or "")


def _element_summary(element: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "id": element.get("id"),
        "text": element.get("text") or element.get("label"),
        "role": element.get("role"),
        "description": element.get("description"),
    }


def _file_list_ref(payload: Mapping[str, Any], kind: str) -> str | None:
    key = "fileListArtifactRef" if kind == "artifact" else "fileListDataRef"
    for step in payload.get("steps") or []:
        if not isinstance(step, Mapping):
            continue
        verification = step.get("verification")
        if isinstance(verification, Mapping):
            metadata = verification.get("metadata")
            if isinstance(metadata, Mapping):
                value = metadata.get(key)
                if isinstance(value, str) and value:
                    return value
        after = step.get("after")
        if isinstance(after, Mapping):
            artifacts = after.get("artifacts")
            if isinstance(artifacts, Mapping):
                file_list = artifacts.get("fileList")
                if isinstance(file_list, Mapping):
                    candidate_key = "artifactRef" if kind == "artifact" else "dataRef"
                    value = file_list.get(candidate_key)
                    if isinstance(value, str) and value:
                        return value
    for ref in payload.get("artifactRefs") or []:
        if not isinstance(ref, str):
            continue
        if kind == "artifact" and "file-list" in ref and "data" not in ref:
            return ref
        if kind == "data" and "file-list" in ref and "data" in ref:
            return ref
    return None


def _safe_elements(value: Any) -> list[Mapping[str, Any]]:
    return _list_of_mappings(value)


def _list_of_mappings(value: Any) -> list[Mapping[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, Mapping)]


def _safe_mapping(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, Mapping) else {}


def _number(value: Any, default: float) -> float:
    return float(value) if isinstance(value, (int, float)) else default


def _normalize_text(value: str) -> str:
    return " ".join(value.lower().split())


def _looks_like_local_ref(value: str) -> bool:
    text = value.strip()
    if not text or "://" in text:
        return False
    if text.startswith(("artifact:", "audit:", "budgetDebit:", "trace:", "ref:", "approval:")):
        return False
    return text.startswith(("/", "./", "../", ".sciforge/")) or text.lower().endswith(
        (
            ".json",
            ".md",
            ".txt",
            ".csv",
            ".tsv",
            ".xlsx",
            ".ppt",
            ".pptx",
            ".pdf",
            ".doc",
            ".docx",
            ".odt",
            ".ods",
            ".png",
            ".jpg",
            ".jpeg",
            ".webp",
        )
    )


def _local_ref_path(ref: str, output_dir: Path) -> Path:
    path = Path(ref).expanduser()
    resolved_output_dir = output_dir.resolve()
    resolved_path = path.resolve() if path.is_absolute() else (resolved_output_dir / path).resolve()
    if resolved_path != resolved_output_dir and resolved_output_dir not in resolved_path.parents:
        raise ValueError("Virtual desktop refs must stay inside the probe output directory.")
    return resolved_path


def _write_ref(path: Path, content: Any) -> None:
    if path.name.lower() in CONTROL_FILE_NAMES:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(content, (Mapping, list)):
        path.write_text(f"{json.dumps(content, indent=2, sort_keys=True)}\n", encoding="utf8")
    elif isinstance(content, bytes):
        path.write_bytes(content)
    else:
        path.write_text(str(content), encoding="utf8")


if __name__ == "__main__":
    raise SystemExit(main())
