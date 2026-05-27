"""Package-owned target-bound window host-port probe.

This probe drives the real ``--host-port-stdio`` child loop while the parent
process owns a package-local target window model and an isolated executor. The
executor accepts generic Computer Use actions, mutates only that declared target
environment, and writes refs proving the target binding and before/after state.

It is deliberately not a GUI/runtime/browser bridge. It is the package-owned
host implementation allowed by PROJECT.md for proving target-bound execution
inside ``packages/actions/computer-use``.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Mapping, Sequence

from .artifact_renderers import render_target_artifact
from .desktop_preflight import build_preflight_manifest
from .host_ports_probe import _write_json
from .trace import (
    build_repair_replay_evidence,
    build_target_bound_real_window_probe_evidence,
    build_viewport_recovery_evidence,
    validate_repair_replay_evidence,
    validate_target_bound_real_window_probe_evidence,
    validate_viewport_recovery_evidence,
)
from .virtual_desktop_probe import (
    REQUIRED_HOST_PORTS,
    VirtualDesktopProbeRunner,
    _element_ids,
    _element_summary,
    _file_list_ref,
    _list_of_mappings,
    _load_json_file,
    _matching_elements,
    _number,
    _offscreen_matching_elements,
    _parse_json,
    _safe_elements,
    _safe_mapping,
    _scenario_id,
    _screen_ref,
    _screens,
    _target_text,
    _visible_texts,
)
from .virtual_input_adapter import (
    INPUT_ADAPTER_BINDING_STATUS_BOUND,
    VIRTUAL_INPUT_ADAPTER_STATUS,
    build_input_adapter_target_binding_manifest,
    build_target_bound_input_adapter_manifest,
    validate_input_adapter_target_binding_manifest,
)


TARGET_BOUND_WINDOW_HOST_PROBE_MANIFEST_SCHEMA = "sciforge.computer-use.target-bound-window-host-probe-manifest.v1"
TARGET_BOUND_WINDOW_SCENARIO_SCHEMA = "sciforge.computer-use.target-bound-window-scenario.v1"
EXECUTOR_PROVIDER = "package-target-bound-window-executor"
CAPTURE_PROVIDER = "package-owned-target-window-capture"
INPUT_CHANNEL = "isolated-window"
TARGET_ENVIRONMENT_KIND = "package-owned-target-bound-window"


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run a package-owned target-bound window Computer Use probe.")
    parser.add_argument("--request-json", required=True, help="ComputerUseRequest JSON for the child package loop.")
    parser.add_argument("--scenario-file", required=True, help="Target-bound window scenario JSON file.")
    parser.add_argument("--output-dir", required=True, help="Directory for result, trace, state refs, and manifest.")
    parser.add_argument("--source-repair-manifest", help="Optional previous blocked-repair-manifest.json ref for replay evidence.")
    args = parser.parse_args(argv)

    try:
        runner = TargetBoundWindowHostProbeRunner(
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
            "failureDiagnostics": {"failedStage": "target-bound-window-host-probe"},
        }
        json.dump(payload, sys.stdout, sort_keys=True)
        sys.stdout.write("\n")
        sys.stdout.flush()
        return 1


class TargetBoundWindowHostProbeRunner(VirtualDesktopProbeRunner):
    """Host-port parent for package-owned target-bound window scenarios."""

    def __init__(
        self,
        *,
        request: Mapping[str, Any],
        scenario: Mapping[str, Any],
        output_dir: Path,
        scenario_file: str | None = None,
        source_repair_manifest: Path | None = None,
    ) -> None:
        super().__init__(
            request=request,
            scenario=_normalize_target_scenario(scenario),
            output_dir=output_dir,
            scenario_file=scenario_file,
            source_repair_manifest=source_repair_manifest,
        )
        self.document_lines: list[str] = list(_string_list(self.scenario.get("initialDocumentLines")))
        self.focused_element_id: str | None = None
        self.scroll_offset = 0
        self.target_state_refs: dict[str, str] = {}
        self.action_log: list[dict[str, Any]] = []
        self.pointer_events: list[dict[str, Any]] = []
        self.keyboard_events: list[dict[str, Any]] = []
        self.input_events: list[dict[str, Any]] = []
        self.artifact_metadata: dict[str, Any] = {}
        self.last_save_action_index: int | None = None
        self.preflight_manifest_ref: str | None = None
        self.target_binding_validation: dict[str, Any] = {}

    def run(self) -> dict[str, Any]:
        payload = super().run()
        result_path = (self.output_dir / "computer-use-result.json").resolve()
        inherited_manifest_path = (self.output_dir / "virtual-desktop-probe-manifest.json").resolve()
        manifest_path = (self.output_dir / "target-bound-window-host-probe-manifest.json").resolve()
        if inherited_manifest_path.is_file():
            manifest = _load_mapping(inherited_manifest_path)
            _write_json(manifest_path, manifest)
        payload.setdefault("failureDiagnostics", {})["targetBoundWindowHostProbeManifestRef"] = str(manifest_path)
        if inherited_manifest_path.is_file():
            _write_json(result_path, payload)
        if payload.get("status") == "completed":
            evidence_ref = self._write_target_bound_real_window_evidence(payload, result_path=result_path)
            payload.setdefault("failureDiagnostics", {})["targetBoundRealWindowEvidenceRef"] = evidence_ref
            manifest = _load_mapping(manifest_path)
            manifest["targetBoundRealWindowEvidenceRef"] = evidence_ref
            manifest["targetBoundRealWindowEvidenceValidation"] = validate_target_bound_real_window_probe_evidence(
                evidence_ref,
                require_existing_refs=True,
            )
            _write_json(manifest_path, manifest)
            _write_json(result_path, payload)
        return payload

    def _write_scenario_snapshot(self) -> None:
        _write_json(self.output_dir / "target-bound-window-scenario.json", self.scenario)
        self._write_target_state("target-window-state-initial.json", action_kind="initial")
        adapter_manifest_ref = (self.output_dir / "target-bound-input-adapter-manifest.json").resolve()
        adapter_manifest = build_target_bound_input_adapter_manifest(
            executor_provider=EXECUTOR_PROVIDER,
            input_channel=INPUT_CHANNEL,
            state_refs=self.target_state_refs,
            metadata={
                "targetEnvironmentKind": TARGET_ENVIRONMENT_KIND,
                "packageOwnedTargetWindow": True,
            },
        )
        _write_json(adapter_manifest_ref, adapter_manifest)
        target_window_ref = (self.output_dir / "target-window.json").resolve()
        _write_json(target_window_ref, self._target_window_payload())
        binding_proof_ref = (self.output_dir / "target-binding-proof.json").resolve()
        _write_json(binding_proof_ref, self._binding_proof_payload(adapter_manifest_ref, target_window_ref))
        binding_manifest_ref = (self.output_dir / "input-adapter-target-binding.json").resolve()
        binding_manifest = build_input_adapter_target_binding_manifest(
            binding_status=INPUT_ADAPTER_BINDING_STATUS_BOUND,
            target_environment_kind=TARGET_ENVIRONMENT_KIND,
            target_window_resolved=True,
            execute_changes_target_environment=True,
            real_window_evidence_capable=True,
            adapter_manifest_ref=str(adapter_manifest_ref),
            target_window_ref=str(target_window_ref),
            evidence_refs=[str(binding_proof_ref), *self._current_real_window_evidence_refs()],
            metadata={
                "executorProvider": EXECUTOR_PROVIDER,
                "inputChannel": INPUT_CHANNEL,
                "packageOwnedTargetWindow": True,
            },
        )
        _write_json(binding_manifest_ref, binding_manifest)
        self.target_binding_validation = validate_input_adapter_target_binding_manifest(
            binding_manifest_ref,
            require_existing_refs=True,
        )
        capabilities = {
            "hostPorts": REQUIRED_HOST_PORTS,
            "captureProvider": CAPTURE_PROVIDER,
            "executorProvider": EXECUTOR_PROVIDER,
            "inputAdapterStatus": VIRTUAL_INPUT_ADAPTER_STATUS,
            "inputChannel": INPUT_CHANNEL,
            "inputAdapterManifestRef": str(adapter_manifest_ref),
            "inputAdapterBindingManifestRef": str(binding_manifest_ref),
            "targetWindow": self._target_window_payload(),
        }
        preflight = build_preflight_manifest(
            output_dir=self.output_dir,
            observed_capabilities=capabilities,
            target_window=str(self._target_window_payload().get("title")),
        )
        self.preflight_manifest_ref = str((self.output_dir / "desktop-host-port-preflight-manifest.json").resolve())
        if preflight.get("status") != "ready":
            raise RuntimeError(f"Target-bound window preflight is not ready: {preflight.get('reason')}")

    def _capture(self) -> dict[str, Any]:
        observation = super()._capture()
        metadata = dict(observation.get("metadata") or {})
        observation["metadata"] = {
            **metadata,
            "schemaVersion": "sciforge.computer-use.target-bound-window-observation.v1",
            "virtualDesktop": False,
            "packageOwnedTargetWindow": True,
            "targetEnvironmentKind": TARGET_ENVIRONMENT_KIND,
            "targetWindowRef": str((self.output_dir / "target-window.json").resolve()),
            "inputAdapterStatus": VIRTUAL_INPUT_ADAPTER_STATUS,
            "inputChannel": INPUT_CHANNEL,
            "inputExecuted": bool(self.action_log),
            "sharedSystemInputUsed": False,
            "osInputExecuted": False,
            "realOsInputExecuted": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
            "realWindowEvidence": True,
            "diagnosticOnly": False,
            "targetWindowStateRefs": dict(self.target_state_refs),
        }
        return observation

    def _locate(self, target: Any) -> dict[str, Any]:
        target_text = _target_text(target)
        screen = self._screen_for_capture()
        matches = _matching_elements(screen, target_text)
        if not target_text:
            return {"ok": False, "reason": "Target description was empty.", "metadata": self._grounding_failure_metadata("grounding")}
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
                    "beforeObservationRef": self._materialize_ref(_screen_ref(screen, default=".sciforge/vision-runs/target-bound-window/offscreen-before.png")),
                    "recommendedRecoveryAction": {"kind": "scroll", "direction": "down"},
                }
                self.viewport_failures.append(failure)
                return {
                    "ok": False,
                    "reason": f"Target {target_text!r} is offscreen in the current target window viewport.",
                    "metadata": {**self._grounding_failure_metadata("grounding"), **failure},
                }
            return {
                "ok": False,
                "reason": f"Target {target_text!r} was not found.",
                "metadata": {**self._grounding_failure_metadata("grounding"), "targetDescription": target_text},
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
                "reason": f"Target {target_text!r} matched {len(matches)} target-window elements.",
                "metadata": {
                    **self._grounding_failure_metadata("grounding"),
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
            "coordinateSpace": "package-owned-target-window",
            "confidence": _number(element.get("confidence"), 0.9),
            "reason": f"Target-bound window located {target_text!r}.",
            "metadata": {
                "scenarioId": _scenario_id(self.scenario),
                "screenId": screen.get("id"),
                "elementId": element.get("id"),
                "matchCount": 1,
                "packageOwnedTargetWindow": True,
                "targetEnvironmentKind": TARGET_ENVIRONMENT_KIND,
                "diagnosticOnly": False,
                "realWindowEvidence": True,
            },
        }

    def _execute(self, action: Any, grounding: Any) -> dict[str, Any]:
        action_mapping = _safe_mapping(action)
        kind = str(action_mapping.get("kind") or action_mapping.get("type") or "").strip()
        if not kind:
            return {"ok": False, "blocked": True, "message": "Target-bound executor requires an action kind.", "metadata": {"failedStage": "execution"}}
        if _blocked_action(action_mapping):
            return {
                "ok": False,
                "blocked": True,
                "message": f"Target-bound executor blocked high-risk action {kind!r}.",
                "metadata": self._execution_metadata(kind, blocked=True, reason="high-risk-action"),
            }
        before_refs = self._write_target_state(f"target-window-state-{len(self.action_log):04d}-before.json", action_kind=kind)
        self._apply_action_to_target_window(action_mapping, grounding)
        self.current_screen_index = self._next_screen_index(action, grounding)
        after_refs = self._write_target_state(f"target-window-state-{len(self.action_log):04d}-after.json", action_kind=kind)
        metadata = self._execution_metadata(
            kind,
            state_refs_before=before_refs,
            state_refs_after=after_refs,
            state_update=self._state_update_for_action(action_mapping),
        )
        self.action_log.append({
            "index": len(self.action_log),
            "kind": kind,
            "inputModalities": _input_modalities_for_action(action_mapping),
            "target": _target_text(action_mapping.get("target")),
            "grounding": _safe_mapping(grounding),
            "stateRefsBefore": before_refs,
            "stateRefsAfter": after_refs,
        })
        return {
            "ok": True,
            "blocked": False,
            "message": f"Target-bound window executor applied {kind}.",
            "metadata": metadata,
        }

    def _verify(self) -> dict[str, Any]:
        value = super()._verify()
        metadata = dict(value.get("metadata") or {})
        value["metadata"] = {
            **metadata,
            "scenarioId": _scenario_id(self.scenario),
            "virtualDesktop": False,
            "packageOwnedTargetWindow": True,
            "targetEnvironmentKind": TARGET_ENVIRONMENT_KIND,
            "realWindowEvidence": True,
            "diagnosticOnly": False,
            "inputExecuted": bool(self.action_log),
            "targetWindowStateRefs": dict(self.target_state_refs),
            "targetBindingValidation": dict(self.target_binding_validation),
        }
        return value

    def _manifest(self, payload: Mapping[str, Any], *, child_returncode: int | None, result_path: Path) -> dict[str, Any]:
        return {
            "schemaVersion": TARGET_BOUND_WINDOW_HOST_PROBE_MANIFEST_SCHEMA,
            "status": payload.get("status"),
            "reason": payload.get("reason") or payload.get("message"),
            "childReturnCode": child_returncode,
            "mode": "package-owned-target-bound-window-host-ports",
            "scenarioFile": self.scenario_file,
            "scenarioId": _scenario_id(self.scenario),
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
            "fileListArtifactRef": _file_list_ref(payload, "artifact"),
            "fileListDataRef": _file_list_ref(payload, "data"),
            "preflightRef": self.preflight_manifest_ref,
            "preflightStatus": "ready",
            "inputAdapterManifestRef": str((self.output_dir / "target-bound-input-adapter-manifest.json").resolve()),
            "inputAdapterBindingManifestRef": str((self.output_dir / "input-adapter-target-binding.json").resolve()),
            "targetWindowRef": str((self.output_dir / "target-window.json").resolve()),
            "targetBindingProofRef": str((self.output_dir / "target-binding-proof.json").resolve()),
            "targetBindingValidation": dict(self.target_binding_validation),
            "executorProvider": EXECUTOR_PROVIDER,
            "captureProvider": CAPTURE_PROVIDER,
            "inputAdapterStatus": VIRTUAL_INPUT_ADAPTER_STATUS,
            "inputChannel": INPUT_CHANNEL,
            "bindingStatus": "bound",
            "targetEnvironmentKind": TARGET_ENVIRONMENT_KIND,
            "executeChangesTargetEnvironment": True,
            "realWindowEvidenceCapable": True,
            "inputExecuted": bool(self.action_log),
            "osInputExecuted": False,
            "realOsInputExecuted": False,
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
            "realWindowStateChanged": bool(self.action_log),
            "pointerEventLogRef": self.target_state_refs.get("targetPointerStateRef"),
            "keyboardEventLogRef": self.target_state_refs.get("targetKeyboardStateRef"),
            "inputEventLogRef": self.target_state_refs.get("targetInputEventLogRef"),
            "inputModalities": sorted(_observed_modalities_from_action_log(self.action_log)),
            "artifactMetadata": dict(self.artifact_metadata),
            "realWindowEvidence": True,
            "diagnosticOnly": False,
            "rawPayloadWritten": False,
            "inlineImageWritten": False,
            "secretsWritten": False,
        }

    def _payload_with_probe_metadata(self, payload: Mapping[str, Any], *, manifest_path: Path) -> dict[str, Any]:
        updated = dict(payload)
        diagnostics = dict(updated.get("failureDiagnostics") or {})
        diagnostics.update({
            "targetBoundWindowHostProbeManifestRef": str(manifest_path),
            "preflightRef": self.preflight_manifest_ref,
            "preflightStatus": "ready",
            "inputAdapterManifestRef": str((self.output_dir / "target-bound-input-adapter-manifest.json").resolve()),
            "inputAdapterBindingManifestRef": str((self.output_dir / "input-adapter-target-binding.json").resolve()),
            "targetWindowRef": str((self.output_dir / "target-window.json").resolve()),
            "targetBindingProofRef": str((self.output_dir / "target-binding-proof.json").resolve()),
            "targetBindingValidation": dict(self.target_binding_validation),
            "fileListArtifactRef": _file_list_ref(updated, "artifact"),
            "fileListDataRef": _file_list_ref(updated, "data"),
            "inputAdapterStatus": VIRTUAL_INPUT_ADAPTER_STATUS,
            "inputChannel": INPUT_CHANNEL,
            "bindingStatus": "bound",
            "targetEnvironmentKind": TARGET_ENVIRONMENT_KIND,
            "executeChangesTargetEnvironment": True,
            "realWindowEvidenceCapable": True,
            "inputExecuted": bool(self.action_log),
            "osInputExecuted": False,
            "realOsInputExecuted": False,
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
            "realWindowStateChanged": bool(self.action_log),
            "pointerEventLogRef": self.target_state_refs.get("targetPointerStateRef"),
            "keyboardEventLogRef": self.target_state_refs.get("targetKeyboardStateRef"),
            "inputEventLogRef": self.target_state_refs.get("targetInputEventLogRef"),
            "inputModalities": sorted(_observed_modalities_from_action_log(self.action_log)),
            "artifactMetadata": dict(self.artifact_metadata),
            "realWindowEvidence": True,
            "diagnosticOnly": False,
        })
        if self.locate_failures:
            diagnostics["targetWindowLocateFailures"] = list(self.locate_failures)
        if self.viewport_failures:
            diagnostics["targetWindowViewportFailures"] = list(self.viewport_failures)
        updated["failureDiagnostics"] = diagnostics
        return updated

    def _maybe_write_repair_manifest(self, payload: Mapping[str, Any], *, result_path: Path, probe_manifest_path: Path) -> str | None:
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
            "scenarioRef": str((self.output_dir / "target-bound-window-scenario.json").resolve()),
            "scenarioFile": self.scenario_file,
            "scenarioId": _scenario_id(self.scenario),
            "locateFailures": list(self.locate_failures),
            "viewportFailures": list(self.viewport_failures),
            "inputAdapterManifestRef": str((self.output_dir / "target-bound-input-adapter-manifest.json").resolve()),
            "inputAdapterBindingManifestRef": str((self.output_dir / "input-adapter-target-binding.json").resolve()),
            "targetBindingValidation": dict(self.target_binding_validation),
            "targetWindowStateRefs": dict(self.target_state_refs),
            "inputAdapterStatus": VIRTUAL_INPUT_ADAPTER_STATUS,
            "inputChannel": INPUT_CHANNEL,
            "inputExecuted": bool(self.action_log),
            "sharedSystemInputUsed": False,
            "realWindowEvidence": True,
            "diagnosticOnly": False,
            "rawPayloadWritten": False,
            "inlineImageWritten": False,
            "repairHint": "Use failedStage, current screenshot refs, and target-window failures to extract a generic repair probe before rerunning.",
        }
        _write_json(manifest_path, repair_manifest)
        return str(manifest_path)

    def _maybe_write_repair_replay_evidence(self, payload: Mapping[str, Any], *, result_path: Path) -> str | None:
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
        evidence.update({
            "status": "completed",
            "realWindowEvidence": True,
            "diagnosticOnly": False,
            "realWindowEvidenceRefs": self._current_real_window_evidence_refs(),
            "targetBindingValidation": dict(self.target_binding_validation),
        })
        validation = validate_repair_replay_evidence(evidence)
        evidence["status"] = "completed" if validation["ok"] else "blocked"
        evidence["reason"] = "Real-window repair replay selected one prior failed candidate." if validation["ok"] else "; ".join(error["message"] for error in validation["errors"])
        evidence["errors"] = validation["errors"]
        _write_json(evidence_path, evidence)
        return str(evidence_path)

    def _maybe_write_viewport_recovery_evidence(self, payload: Mapping[str, Any], *, result_path: Path) -> str | None:
        ref = super()._maybe_write_viewport_recovery_evidence(payload, result_path=result_path)
        if not ref:
            return None
        evidence_path = Path(ref)
        evidence = _load_mapping(evidence_path)
        evidence.update({
            "status": "completed",
            "realWindowEvidence": True,
            "diagnosticOnly": False,
            "realWindowEvidenceRefs": self._current_real_window_evidence_refs(),
            "targetBindingValidation": dict(self.target_binding_validation),
        })
        validation = validate_viewport_recovery_evidence(evidence)
        evidence["status"] = "completed" if validation["ok"] else "blocked"
        evidence["reason"] = "Real-window viewport recovery scrolled to one prior offscreen candidate." if validation["ok"] else "; ".join(error["message"] for error in validation["errors"])
        evidence["errors"] = validation["errors"]
        _write_json(evidence_path, evidence)
        return ref

    def _write_target_bound_real_window_evidence(self, payload: Mapping[str, Any], *, result_path: Path) -> str:
        trace_path = (self.output_dir / "vision-trace.json").resolve()
        evidence_path = (self.output_dir / "target-bound-real-window-probe-evidence.json").resolve()
        workflow_requirements = _safe_mapping(self.scenario.get("workflowRequirements"))
        initial_screenshot_ref = _first_screenshot_ref(payload)
        final_screenshot_ref = str(payload.get("finalObservationRef") or _last_screenshot_ref(payload))
        evidence = build_target_bound_real_window_probe_evidence(
            self.preflight_manifest_ref or self.output_dir / "desktop-host-port-preflight-manifest.json",
            result_path,
            trace_path,
            target_binding_validation=self.target_binding_validation,
            real_window_evidence_refs=self._current_real_window_evidence_refs(),
            initial_screenshot_ref=initial_screenshot_ref,
            final_screenshot_ref=final_screenshot_ref,
            final_artifact_ref=str(payload.get("finalArtifactRef") or ""),
            file_list_artifact_ref=_file_list_ref(payload, "artifact"),
            file_list_data_ref=_file_list_ref(payload, "data"),
            input_channel=INPUT_CHANNEL,
            executor_provider=EXECUTOR_PROVIDER,
            minimum_action_count=_int_or_none(workflow_requirements.get("minimumActionCount")),
            requires_current_step_screenshots=workflow_requirements.get("requiresCurrentStepScreenshots") is True,
            forbid_prior_round_completion_evidence=workflow_requirements.get("forbidPriorRoundCompletionEvidence") is True,
            requires_directory_evidence=workflow_requirements.get("requiresDirectoryEvidence") is True,
            required_input_modalities=_string_list(workflow_requirements.get("requiredInputModalities")),
            metadata={
                "scenarioId": _scenario_id(self.scenario),
                "targetWindowHostProbeManifestRef": str((self.output_dir / "target-bound-window-host-probe-manifest.json").resolve()),
                "artifactMetadata": dict(self.artifact_metadata),
            },
        )
        validation = validate_target_bound_real_window_probe_evidence(evidence, require_existing_refs=True)
        evidence["status"] = "completed" if validation["ok"] else "blocked"
        evidence["reason"] = "Target-bound window host evidence satisfies refs-first contract." if validation["ok"] else "; ".join(error["message"] for error in validation["errors"])
        evidence["errors"] = validation["errors"]
        _write_json(evidence_path, evidence)
        return str(evidence_path)

    def _target_window_payload(self) -> dict[str, Any]:
        window = _safe_mapping(self.scenario.get("targetWindow"))
        screens = _screens(self.scenario)
        return {
            "schemaVersion": "sciforge.computer-use.target-window.v1",
            "title": str(window.get("title") or f"SciForge Target Window {_scenario_id(self.scenario)}"),
            "targetEnvironmentKind": TARGET_ENVIRONMENT_KIND,
            "packageOwnedTargetWindow": True,
            "screenCount": len(screens),
            "visibleTexts": _visible_texts(screens[0]) if screens else [],
            "osInputExecuted": False,
            "sharedSystemInputUsed": False,
        }

    def _binding_proof_payload(self, adapter_manifest_ref: Path, target_window_ref: Path) -> dict[str, Any]:
        return {
            "schemaVersion": "sciforge.computer-use.target-binding-proof.v1",
            "ok": True,
            "adapterManifestRef": str(adapter_manifest_ref),
            "targetWindowRef": str(target_window_ref),
            "targetEnvironmentKind": TARGET_ENVIRONMENT_KIND,
            "inputChannel": INPUT_CHANNEL,
            "executorProvider": EXECUTOR_PROVIDER,
            "executeChangesTargetEnvironment": True,
            "realWindowEvidenceCapable": True,
            "osInputExecuted": False,
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
        }

    def _apply_action_to_target_window(self, action: Mapping[str, Any], grounding: Any) -> None:
        kind = str(action.get("kind") or action.get("type") or "").strip()
        action_index = len(self.action_log)
        if kind in {"click", "double_click", "focus"}:
            self.focused_element_id = _safe_mapping(_safe_mapping(grounding).get("metadata")).get("elementId") or _target_text(action.get("target"))
            self._record_pointer_event(action_index, kind, action, grounding)
        elif kind == "type_text":
            text = str(action.get("text") or "")
            if text:
                self.document_lines.extend(text.splitlines() or [text])
            self._record_keyboard_event(action_index, kind, action, text=text)
        elif kind in {"press_key", "hotkey"}:
            key = str(action.get("key") or " ".join(str(item) for item in action.get("keys") or []))
            if key.lower() in {"return", "enter"} and self._focused_element_accepts_text(action):
                self.document_lines.append("")
            self._record_keyboard_event(action_index, kind, action, key=key)
            if key.lower().replace(" ", "") in {"ctrl+s", "cmd+s", "meta+s", "super+s"}:
                self.last_save_action_index = action_index
                self._write_declared_artifact()
        elif kind == "scroll":
            amount = _number(action.get("amount"), 1.0)
            direction = str(action.get("direction") or "down").lower()
            self.scroll_offset += int(amount) if direction in {"down", "right"} else -int(amount)
            self._record_pointer_event(action_index, kind, action, grounding)
        elif kind == "save":
            self.last_save_action_index = action_index
            self._record_keyboard_event(action_index, kind, action, key="save")
            self._write_declared_artifact()

    def _focused_element_accepts_text(self, action: Mapping[str, Any]) -> bool:
        target_text = _target_text(action.get("target")).lower()
        if any(token in target_text for token in ("field", "editor", "input", "body", "cell", "text")):
            return True
        focused_id = str(self.focused_element_id or "")
        if not focused_id:
            return False
        for screen in _screens(self.scenario):
            for element in _list_of_mappings(screen.get("elements")):
                if str(element.get("id") or "") != focused_id:
                    continue
                role = str(element.get("role") or "").lower()
                label = str(element.get("label") or element.get("description") or "").lower()
                return role in {"textbox", "textarea", "gridcell"} or any(
                    token in label for token in ("field", "editor", "input", "body", "cell", "text")
                )
        return any(token in focused_id.lower() for token in ("field", "editor", "input", "body", "cell", "text"))

    def _record_pointer_event(
        self,
        action_index: int,
        kind: str,
        action: Mapping[str, Any],
        grounding: Any,
    ) -> None:
        grounding_mapping = _safe_mapping(grounding)
        event = {
            "index": len(self.pointer_events),
            "actionIndex": action_index,
            "kind": kind,
            "target": _target_text(action.get("target")),
            "x": grounding_mapping.get("x"),
            "y": grounding_mapping.get("y"),
            "elementId": _safe_mapping(grounding_mapping.get("metadata")).get("elementId"),
            "osInputExecuted": False,
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
        }
        self.pointer_events.append(event)
        self.input_events.append({"modality": "pointer", **event})

    def _record_keyboard_event(
        self,
        action_index: int,
        kind: str,
        action: Mapping[str, Any],
        *,
        text: str | None = None,
        key: str | None = None,
    ) -> None:
        event = {
            "index": len(self.keyboard_events),
            "actionIndex": action_index,
            "kind": kind,
            "target": _target_text(action.get("target")),
            "textLength": len(text or ""),
            "key": key,
            "osInputExecuted": False,
            "sharedSystemInputUsed": False,
            "systemKeyboardEventsSent": False,
        }
        self.keyboard_events.append(event)
        self.input_events.append({"modality": "keyboard", **event})

    def _write_declared_artifact(self) -> None:
        ref = _string_or_none(self.scenario.get("finalArtifactRef"))
        if not ref:
            return
        path = self._materialize_ref(ref)
        metadata = render_target_artifact(
            Path(path),
            document_lines=self.document_lines,
            scenario=self.scenario,
        )
        self.artifact_metadata = {
            **metadata,
            "finalArtifactRef": str(Path(path).resolve()),
            "savedByActionIndex": self.last_save_action_index,
            "savedByInputModality": "keyboard",
        }
        self.written_refs.add(str(Path(path).resolve()))

    def _write_target_state(self, name: str, *, action_kind: str) -> dict[str, str]:
        path = (self.output_dir / name).resolve()
        stem = path.stem
        pointer_path = (self.output_dir / f"{stem}-pointer.json").resolve()
        keyboard_path = (self.output_dir / f"{stem}-keyboard.json").resolve()
        input_path = (self.output_dir / f"{stem}-input-events.json").resolve()
        state = {
            "schemaVersion": "sciforge.computer-use.target-window-state.v1",
            "scenarioId": _scenario_id(self.scenario),
            "targetEnvironmentKind": TARGET_ENVIRONMENT_KIND,
            "actionKind": action_kind,
            "focusedElementId": self.focused_element_id,
            "scrollOffset": self.scroll_offset,
            "documentLineCount": len(self.document_lines),
            "actionCount": len(self.action_log),
            "osInputExecuted": False,
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
        }
        pointer_state = {
            "schemaVersion": "sciforge.computer-use.target-pointer-state.v1",
            "scenarioId": _scenario_id(self.scenario),
            "targetEnvironmentKind": TARGET_ENVIRONMENT_KIND,
            "actionKind": action_kind,
            "eventCount": len(self.pointer_events),
            "events": list(self.pointer_events),
            "systemPointerMoved": False,
            "sharedSystemInputUsed": False,
        }
        keyboard_state = {
            "schemaVersion": "sciforge.computer-use.target-keyboard-state.v1",
            "scenarioId": _scenario_id(self.scenario),
            "targetEnvironmentKind": TARGET_ENVIRONMENT_KIND,
            "actionKind": action_kind,
            "eventCount": len(self.keyboard_events),
            "events": list(self.keyboard_events),
            "systemKeyboardEventsSent": False,
            "sharedSystemInputUsed": False,
        }
        input_state = {
            "schemaVersion": "sciforge.computer-use.target-input-event-log.v1",
            "scenarioId": _scenario_id(self.scenario),
            "targetEnvironmentKind": TARGET_ENVIRONMENT_KIND,
            "actionKind": action_kind,
            "eventCount": len(self.input_events),
            "events": list(self.input_events),
            "inputModalities": sorted(_observed_modalities_from_events(self.input_events)),
            "osInputExecuted": False,
            "sharedSystemInputUsed": False,
        }
        _write_json(path, state)
        _write_json(pointer_path, pointer_state)
        _write_json(keyboard_path, keyboard_state)
        _write_json(input_path, input_state)
        refs = {
            "targetWindowStateRef": str(path),
            "virtualInputStateRef": str(input_path),
            "targetInputEventLogRef": str(input_path),
            "targetPointerStateRef": str(pointer_path),
            "targetKeyboardStateRef": str(keyboard_path),
        }
        self.target_state_refs.update(refs)
        return refs

    def _execution_metadata(
        self,
        action_kind: str,
        *,
        state_refs_before: Mapping[str, str] | None = None,
        state_refs_after: Mapping[str, str] | None = None,
        state_update: Mapping[str, Any] | None = None,
        blocked: bool = False,
        reason: str | None = None,
    ) -> dict[str, Any]:
        return {
            "schemaVersion": "sciforge.computer-use.target-bound-window-execution.v1",
            "adapterId": "sciforge.computer-use.package-owned-target-bound-input-adapter",
            "inputAdapterStatus": VIRTUAL_INPUT_ADAPTER_STATUS,
            "inputChannel": INPUT_CHANNEL,
            "executorProvider": EXECUTOR_PROVIDER,
            "targetEnvironmentKind": TARGET_ENVIRONMENT_KIND,
            "actionKind": action_kind,
            "executeChangesTargetEnvironment": not blocked,
            "realWindowEvidenceCapable": True,
            "inputExecuted": not blocked,
            "osInputExecuted": False,
            "realOsInputExecuted": False,
            "sharedSystemInputUsed": False,
            "systemPointerMoved": False,
            "systemKeyboardEventsSent": False,
            "blocked": blocked,
            "reason": reason,
            "stateRefsBefore": dict(state_refs_before or {}),
            "stateRefsAfter": dict(state_refs_after or {}),
            "stateRefs": dict(state_refs_after or self.target_state_refs),
            "stateUpdate": dict(state_update or {}),
            "inputModalities": _input_modalities_for_kind(action_kind),
            "artifactCausality": _artifact_causality(self.artifact_metadata),
            "realWindowEvidence": True,
            "diagnosticOnly": False,
        }

    def _state_update_for_action(self, action: Mapping[str, Any]) -> dict[str, Any]:
        kind = str(action.get("kind") or action.get("type") or "")
        if kind == "scroll":
            amount = _number(action.get("amount"), 1.0)
            direction = str(action.get("direction") or "down").lower()
            delta = int(amount) if direction in {"down", "right"} else -int(amount)
            return {
                "details": {
                    "direction": direction,
                    "amount": amount,
                    "deltaX": delta if direction in {"left", "right"} else 0,
                    "deltaY": delta if direction in {"up", "down"} else 0,
                }
            }
        if kind == "type_text":
            return {"documentLineCount": len(self.document_lines)}
        if kind == "save":
            return {"savedArtifactRef": self.scenario.get("finalArtifactRef")}
        if kind in {"press_key", "hotkey"}:
            key = str(action.get("key") or " ".join(str(item) for item in action.get("keys") or []))
            if key.lower().replace(" ", "") in {"ctrl+s", "cmd+s", "meta+s", "super+s"}:
                return {"savedArtifactRef": self.scenario.get("finalArtifactRef")}
        return {"focusedElementId": self.focused_element_id}

    def _grounding_failure_metadata(self, failed_stage: str) -> dict[str, Any]:
        return {
            "failedStage": failed_stage,
            "packageOwnedTargetWindow": True,
            "targetEnvironmentKind": TARGET_ENVIRONMENT_KIND,
            "realWindowEvidence": True,
            "diagnosticOnly": False,
        }

    def _current_real_window_evidence_refs(self) -> list[str]:
        refs = [
            str((self.output_dir / "target-window.json").resolve()),
            str((self.output_dir / "target-binding-proof.json").resolve()),
            *[str(value) for value in self.target_state_refs.values()],
            *[
                str(value)
                for key, value in self.artifact_metadata.items()
                if key.endswith("Ref") and isinstance(value, str)
            ],
        ]
        screens = _screens(self.scenario)
        if screens:
            refs.append(self._materialize_ref(_screen_ref(screens[0], default=".sciforge/vision-runs/target-bound-window/initial.png")))
            refs.append(self._materialize_ref(_screen_ref(screens[-1], default=".sciforge/vision-runs/target-bound-window/final.png")))
        return _unique_strings(refs)


def _normalize_target_scenario(scenario: Mapping[str, Any]) -> dict[str, Any]:
    normalized = dict(scenario)
    normalized.setdefault("schemaVersion", TARGET_BOUND_WINDOW_SCENARIO_SCHEMA)
    normalized.setdefault("id", "target-bound-window")
    normalized.setdefault("screens", [])
    normalized.setdefault("plans", [])
    normalized.setdefault("verification", [])
    normalized.setdefault("files", {})
    return normalized


def _first_screenshot_ref(payload: Mapping[str, Any]) -> str:
    for step in _list_of_mappings(payload.get("steps")):
        before = step.get("beforeRef")
        if isinstance(before, str) and before:
            return before
    return _last_screenshot_ref(payload)


def _last_screenshot_ref(payload: Mapping[str, Any]) -> str:
    if isinstance(payload.get("finalObservationRef"), str) and payload.get("finalObservationRef"):
        return str(payload.get("finalObservationRef"))
    refs = [ref for ref in payload.get("screenshotRefs") or [] if isinstance(ref, str) and ref]
    return refs[-1] if refs else ""


def _blocked_action(action: Mapping[str, Any]) -> bool:
    if action.get("requiresConfirmation") is True:
        return True
    risk = str(action.get("riskLevel") or action.get("risk_level") or "").lower()
    return risk == "high"


def _input_modalities_for_action(action: Mapping[str, Any]) -> list[str]:
    return _input_modalities_for_kind(str(action.get("kind") or action.get("type") or ""))


def _input_modalities_for_kind(kind: str) -> list[str]:
    normalized = kind.strip().lower()
    modalities: list[str] = []
    if normalized in {"click", "double_click", "drag", "scroll", "focus"}:
        modalities.append("pointer")
    if normalized in {"type_text", "press_key", "hotkey", "save"}:
        modalities.append("keyboard")
    return modalities


def _observed_modalities_from_action_log(actions: Sequence[Mapping[str, Any]]) -> set[str]:
    observed: set[str] = set()
    for action in actions:
        for modality in action.get("inputModalities") or []:
            if isinstance(modality, str) and modality:
                observed.add(modality)
    return observed


def _observed_modalities_from_events(events: Sequence[Mapping[str, Any]]) -> set[str]:
    return {
        str(event.get("modality"))
        for event in events
        if event.get("modality") in {"pointer", "keyboard"}
    }


def _artifact_causality(metadata: Mapping[str, Any]) -> dict[str, Any]:
    if not metadata:
        return {}
    return {
        "finalArtifactRef": metadata.get("finalArtifactRef"),
        "savedByActionIndex": metadata.get("savedByActionIndex"),
        "savedByInputModality": metadata.get("savedByInputModality"),
        "artifactValidationRef": metadata.get("artifactValidationRef"),
        "pptxValidationRef": metadata.get("pptxValidationRef"),
    }


def _load_mapping(path: str | Path) -> dict[str, Any]:
    parsed = json.loads(Path(path).expanduser().read_text(encoding="utf8"))
    if not isinstance(parsed, Mapping):
        raise ValueError(f"Expected JSON object at {path}.")
    return dict(parsed)


def _string_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value if isinstance(item, (str, int, float))]
    return []


def _string_or_none(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _int_or_none(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return None
    return None


def _unique_strings(values: Sequence[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value and value not in seen:
            seen.add(value)
            result.append(value)
    return result


if __name__ == "__main__":
    raise SystemExit(main())
