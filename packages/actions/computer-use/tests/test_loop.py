import json
import os
import subprocess
import sys
from pathlib import Path

import sciforge_computer_use as computer_use_package
from sciforge_computer_use import (
    ActionPlan,
    ActionTarget,
    ComputerUseRequest,
    ExecutionOutcome,
    Grounding,
    Observation,
    Verification,
    buildRepairReplayEvidence,
    buildTargetBoundRealWindowProbeEvidence,
    buildTargetBoundInputAdapterManifest,
    buildViewportRecoveryEvidence,
    build_target_bound_real_window_probe_evidence,
    build_target_bound_input_adapter_manifest,
    build_repair_replay_evidence,
    build_viewport_recovery_evidence,
    compactResult,
    compact_result,
    compact_result_for_handoff,
    getManifest,
    get_manifest,
    result_to_trace,
    run_task,
    runTask,
    run_computer_use_task,
    validateRepairManifest,
    validateRepairReplayEvidence,
    validateTargetBoundRealWindowProbeEvidence,
    validateInputAdapterManifestForRealDesktop,
    validate_target_bound_real_window_probe_evidence,
    validate_input_adapter_manifest_for_real_desktop,
    validateViewportRecoveryEvidence,
    validate_repair_manifest,
    validate_repair_replay_evidence,
    validate_viewport_recovery_evidence,
    validateTrace,
    validate_trace,
)
from sciforge_computer_use import api as computer_use_api


PACKAGE_ROOT = Path(__file__).resolve().parents[1]


class FakeSense:
    def __init__(self, refs=None, grounding=None, artifacts=None, metadata=None):
        self.refs = list(refs or ["before.png", "after.png", "final.png"])
        self.grounding = grounding or Grounding(ok=True, x=10, y=20, confidence=0.9, reason="visible")
        self.artifacts = artifacts or {}
        self.metadata = metadata or {}
        self.locate_calls = []
        self.observe_count = 0

    def observe(self, request, history, query=None):
        ref = self.refs[min(self.observe_count, len(self.refs) - 1)]
        self.observe_count += 1
        return Observation(
            ref=ref,
            summary=f"screen {ref}",
            visible_texts=("Search",),
            window_target=request.window_target,
            artifacts=self.artifacts,
            metadata=self.metadata,
        )

    def query(self, observation, question, history):
        return {"answer": observation.summary}

    def locate(self, observation, target, history):
        self.locate_calls.append((observation.ref, target.description))
        return self.grounding


class FakePlanner:
    def __init__(self, plans):
        self.plans = list(plans)
        self.calls = []

    def plan(self, request, observation, history):
        self.calls.append((observation.ref, len(history)))
        return self.plans[min(len(history), len(self.plans) - 1)]


class FakeExecutor:
    def __init__(self):
        self.calls = []

    def execute(self, action, grounding, request):
        self.calls.append((action.kind, grounding.x if grounding else None, grounding.y if grounding else None))
        return ExecutionOutcome(ok=True, message="executed")


class FakeVerifier:
    def __init__(self, done_after=1):
        self.done_after = done_after

    def verify(self, request, before, after, action, execution, history):
        return Verification(ok=True, done=len(history) + 1 >= self.done_after, reason="verified", changed=True)


class FakeHostPorts:
    def __init__(self):
        self.sense = FakeSense()
        self.planner = FakePlanner([
            ActionPlan(kind="click", target=ActionTarget(description="search field")),
        ])
        self.executor = FakeExecutor()
        self.verifier = FakeVerifier(done_after=1)
        self.events = []
        self.traces = []

    def capture(self, request, history, query=None):
        return self.sense.observe(request, history, query)

    def locate(self, observation, target, history):
        return self.sense.locate(observation, target, history)

    def plan(self, request, observation, history):
        return self.planner.plan(request, observation, history)

    def execute(self, action, grounding, request):
        return self.executor.execute(action, grounding, request)

    def verify(self, request, before, after, action, execution, history):
        return self.verifier.verify(request, before, after, action, execution, history)

    def write_trace(self, result):
        self.traces.append(result_to_trace(result))
        return "trace:fake-host/vision-trace.json"

    def emit_event(self, event):
        self.events.append(event)


def test_sense_agnostic_loop_completes_with_fake_provider():
    sense = FakeSense()
    planner = FakePlanner([
        ActionPlan(kind="click", target=ActionTarget(description="search field")),
    ])
    executor = FakeExecutor()

    result = run_computer_use_task(
        ComputerUseRequest(task="click visible search field", max_steps=3, metadata={"runId": "loop-123"}),
        sense,
        planner,
        executor,
        FakeVerifier(done_after=1),
    )

    assert result.status == "completed"
    assert result.metrics["stepCount"] == 1
    assert sense.locate_calls == [("before.png", "search field")]
    assert executor.calls == [("click", 10, 20)]
    trace = result_to_trace(result)
    assert trace["schemaVersion"] == "sciforge.computer-use.loop-trace.v1"
    debit = trace["budgetDebits"][0]
    assert debit["contract"] == "sciforge.capability-budget-debit.v1"
    assert debit["capabilityId"] == "action.sciforge.computer-use"
    assert trace["budgetDebitRefs"] == [debit["debitId"]]
    assert trace["steps"][0]["budgetDebitRefs"] == [debit["debitId"]]
    assert debit["sinkRefs"]["auditRefs"] == ["audit:computer-use-loop:loop-123"]
    assert {line["dimension"] for line in debit["debitLines"]} >= {"actionSteps", "observeCalls", "costUnits"}
    assert next(line for line in debit["debitLines"] if line["dimension"] == "actionSteps")["amount"] == 1
    assert next(line for line in debit["debitLines"] if line["dimension"] == "observeCalls")["amount"] == 2
    assert next(line for line in debit["debitLines"] if line["dimension"] == "costUnits")[
        "amount"
    ] == result.metrics["costUnits"]


def test_run_task_public_host_ports_surface_writes_trace_and_events():
    host_ports = FakeHostPorts()

    result = run_task(
        {"task": "click visible search field", "maxSteps": 3},
        host_ports,
    )

    assert result.status == "completed"
    assert result.trace_refs == ("trace:fake-host/vision-trace.json",)
    assert host_ports.executor.calls == [("click", 10, 20)]
    assert [event["type"] for event in host_ports.events] == [
        "computer-use.run.started",
        "computer-use.run.finished",
    ]
    assert host_ports.traces[0]["status"] == "completed"


def test_run_task_camel_case_alias_matches_public_interface_name():
    result = runTask(
        {"task": "click visible search field", "maxSteps": 3},
        FakeHostPorts(),
    )

    assert result.status == "completed"


def test_run_task_missing_required_host_port_fails_closed():
    result = run_task(
        {"task": "click visible search field", "maxSteps": 3},
        {"capture": lambda request, history: Observation(ref="screen.png")},
    )

    assert result.status == "failed-with-reason"
    assert result.failure_diagnostics["failedStage"] == "host-port-validation"
    assert result.failure_diagnostics["missingPorts"] == ["plan", "execute", "locate", "verify"]


def test_invalid_request_risk_policy_fails_closed():
    result = run_computer_use_task(
        {"task": "click send", "riskPolicy": "allow-all"},
        FakeSense(),
        FakePlanner([ActionPlan(kind="click", target=ActionTarget(description="Send button"))]),
        FakeExecutor(),
        FakeVerifier(),
    )

    assert result.status == "failed-with-reason"
    assert result.failure_diagnostics["failedStage"] == "request-validation"
    assert "risk_policy" in result.reason


def test_invalid_request_schema_version_fails_closed():
    result = run_task(
        {"schemaVersion": "bad.schema", "task": "click"},
        FakeHostPorts(),
    )

    assert result.status == "failed-with-reason"
    assert result.failure_diagnostics["failedStage"] == "request-validation"


def test_high_risk_action_needs_confirmation_and_does_not_execute():
    sense = FakeSense()
    planner = FakePlanner([
        ActionPlan(kind="click", target=ActionTarget(description="Send button"), risk_level="high"),
    ])
    executor = FakeExecutor()

    result = run_computer_use_task("send external message", sense, planner, executor, FakeVerifier())

    assert result.status == "needs-confirmation"
    assert result.steps[0].status == "blocked"
    assert result.steps[0].budget_debit_refs == result.budget_debit_refs
    assert executor.calls == []
    assert result.failure_diagnostics["riskLevel"] == "high"
    assert result.approval_request is not None
    assert result.approval_request.action_kind == "click"
    assert result.approval_request.refs == ("before.png",)
    trace = result_to_trace(result)
    assert trace["approvalRequest"]["action_kind"] == "click"


def test_allow_confirmed_high_risk_still_requires_approval_ref():
    sense = FakeSense()
    planner = FakePlanner([
        ActionPlan(kind="click", target=ActionTarget(description="Submit button"), risk_level="high"),
    ])
    executor = FakeExecutor()

    result = run_computer_use_task(
        ComputerUseRequest(task="submit form", risk_policy="allow-confirmed"),
        sense,
        planner,
        executor,
        FakeVerifier(),
    )

    assert result.status == "needs-confirmation"
    assert "approval_ref" in result.reason
    assert executor.calls == []


def test_allow_confirmed_high_risk_executes_with_approval_ref():
    sense = FakeSense()
    planner = FakePlanner([
        ActionPlan(kind="click", target=ActionTarget(description="Submit button"), risk_level="high"),
    ])
    executor = FakeExecutor()

    result = run_computer_use_task(
        ComputerUseRequest(task="submit form", risk_policy="allow-confirmed", approval_ref="approval:ok"),
        sense,
        planner,
        executor,
        FakeVerifier(),
    )

    assert result.status == "completed"
    assert executor.calls == [("click", 10, 20)]


def test_planner_coordinates_are_rejected_before_grounder():
    sense = FakeSense()
    planner = FakePlanner([
        {"type": "click", "x": 12, "y": 24, "targetDescription": "Search"},
    ])
    executor = FakeExecutor()

    result = run_computer_use_task("click", sense, planner, executor, FakeVerifier())

    assert result.status == "failed-with-reason"
    assert result.failure_diagnostics["contractIssue"] == "coordinate-output"
    assert sense.locate_calls == []
    assert executor.calls == []


def test_app_private_hotkey_is_rejected():
    sense = FakeSense()
    planner = FakePlanner([
        {"type": "hotkey", "keys": ["command", "b"], "metadata": {"shortcutScope": "app-private"}},
    ])

    result = run_computer_use_task("bold text", sense, planner, FakeExecutor(), FakeVerifier())

    assert result.status == "failed-with-reason"
    assert result.failure_diagnostics["contractIssue"] == "app-private-shortcut"


def test_document_save_hotkey_is_allowed_as_generic_local_action():
    sense = FakeSense()
    planner = FakePlanner([
        {"type": "hotkey", "key": "Ctrl+S", "reason": "save local document"},
    ])
    executor = FakeExecutor()

    result = run_computer_use_task("save local document", sense, planner, executor, FakeVerifier())

    assert result.status == "completed"
    assert executor.calls == [("hotkey", None, None)]
    assert sense.locate_calls == []


def test_failed_step_without_action_kind_keeps_budget_debit_ref():
    sense = FakeSense()
    planner = FakePlanner([
        ActionPlan(reason="no safe action"),
    ])

    result = run_computer_use_task("missing plan", sense, planner, FakeExecutor(), FakeVerifier())
    trace = result_to_trace(result)
    handoff = compact_result_for_handoff(result)

    assert result.status == "failed-with-reason"
    assert result.steps[0].budget_debit_refs == result.budget_debit_refs
    assert trace["steps"][0]["budgetDebitRefs"] == list(result.budget_debit_refs)
    assert handoff["actions"][0]["budgetDebitRefs"] == list(result.budget_debit_refs)


def test_grounding_failure_is_structured():
    sense = FakeSense(grounding=Grounding(ok=False, reason="target missing"))
    planner = FakePlanner([
        ActionPlan(kind="click", target=ActionTarget(description="missing button")),
    ])

    result = run_computer_use_task("click missing", sense, planner, FakeExecutor(), FakeVerifier())

    assert result.status == "failed-with-reason"
    assert result.reason == "target missing"
    assert result.failure_diagnostics["failedStage"] == "grounding"


def test_compact_handoff_is_file_ref_only():
    sense = FakeSense(refs=["workspace/.sciforge/before.png", "workspace/.sciforge/after.png"])
    planner = FakePlanner([
        {"type": "press_key", "key": "Escape", "reason": "dismiss popover"},
    ])
    result = run_computer_use_task("dismiss low risk popover", sense, planner, FakeExecutor(), FakeVerifier())

    handoff = compact_result_for_handoff(result)
    assert handoff["refs"] == ["workspace/.sciforge/before.png", "workspace/.sciforge/after.png"]
    assert handoff["budgetDebitRefs"] == list(result.budget_debit_refs)
    assert handoff["actions"][0]["budgetDebitRefs"] == list(result.budget_debit_refs)
    assert handoff["budgetDebits"][0]["sinkRefs"]["auditRefs"][0].startswith("audit:computer-use-loop:")
    assert "base64" not in str(handoff)
    assert "data:image/" not in str(handoff)


def test_public_api_manifest_and_camel_case_aliases_are_stable():
    manifest = get_manifest()

    assert getManifest() == manifest
    assert manifest["schemaVersion"] == "sciforge.action-provider.manifest.v1"
    assert manifest["id"] == "sciforge.computer-use"
    assert manifest["entrypoint"]["interface"] == "runTask(request, hostPorts)"
    assert manifest["hostPortsContract"]["requiredPorts"] == ["capture", "plan", "locate", "execute", "verify"]
    assert manifest["hostPortsContract"]["realDesktopEvidenceRequiredPorts"] == [
        "capture",
        "plan",
        "locate",
        "execute",
        "verify",
        "writeTrace",
        "emitEvent",
    ]
    assert manifest["entrypoint"]["discoveryProbe"].startswith("python -m sciforge_computer_use.plugin_probe")
    assert manifest["entrypoint"]["virtualDesktopProbe"].startswith(
        "python -m sciforge_computer_use.virtual_desktop_probe"
    )
    assert manifest["hostPortsContract"]["providerIdPolicy"]["plan"] == "runtime-codex-tui-text-planner"
    assert manifest["hostPortsContract"]["providerIdPolicy"]["verify"] == "layered-vision-verifier"
    assert manifest["hostPortsContract"]["executorAdapterContract"]["requiredStatus"] == "independent-simulated-input-adapter"
    assert manifest["hostPortsContract"]["executorAdapterContract"]["targetBindingRequiredForRealDesktopEvidence"] is True
    assert manifest["hostPortsContract"]["executorAdapterContract"]["bindingHelper"].endswith(
        "build_input_adapter_target_binding_manifest"
    )
    assert manifest["hostPortsContract"]["executorAdapterContract"]["bindingValidator"].endswith(
        "validate_input_adapter_target_binding_manifest"
    )
    assert manifest["hostPortsContract"]["executorAdapterContract"]["targetBoundManifestBuilder"].endswith(
        "build_target_bound_input_adapter_manifest"
    )
    assert manifest["hostPortsContract"]["executorAdapterContract"]["adapterManifestValidator"].endswith(
        "validate_input_adapter_manifest_for_real_desktop"
    )
    assert manifest["hostPortsContract"]["executorAdapterContract"]["bindingRequiredRefs"] == [
        "adapterManifestRef",
        "targetWindowRef",
        "evidenceRefs",
    ]
    assert "isolated-window" in manifest["hostPortsContract"]["executorAdapterContract"]["readyInputChannels"]
    assert "native-stdio-fail-closed-executor" in (
        manifest["hostPortsContract"]["executorAdapterContract"]["diagnosticExecutorProvidersBlockedForReady"]
    )
    assert "playwright" in manifest["hostPortsContract"]["executorAdapterContract"]["shortcutExecutorProvidersBlockedForReady"]
    assert "virtual-session" in (
        manifest["hostPortsContract"]["executorAdapterContract"]["virtualOrDiagnosticInputChannelsBlockedForReady"]
    )
    assert manifest["repairManifestContract"]["validator"] == "sciforge_computer_use.repair_manifest.validate_repair_manifest"
    assert manifest["repairManifestContract"]["requiredRefs"] == [
        "resultRef",
        "traceRefs",
        "screenshotRefs or finalObservationRef",
    ]
    assert manifest["repairManifestContract"]["requiredFlags"]["rawPayloadWritten"] is False
    assert manifest["repairManifestContract"]["requiredFlags"]["inlineImageWritten"] is False
    assert manifest["repairReplayContract"]["builder"] == "sciforge_computer_use.trace.build_repair_replay_evidence"
    assert manifest["repairReplayContract"]["validator"] == "sciforge_computer_use.trace.validate_repair_replay_evidence"
    assert manifest["repairReplayContract"]["requiredRefs"] == [
        "sourceFailureManifestRef",
        "replayResultRef",
        "replayTraceRefs",
    ]
    assert "source failure" in manifest["repairReplayContract"]["validationOptions"]["requireExistingRefs"]
    assert manifest["viewportRecoveryContract"]["builder"] == "sciforge_computer_use.trace.build_viewport_recovery_evidence"
    assert manifest["viewportRecoveryContract"]["validator"] == (
        "sciforge_computer_use.trace.validate_viewport_recovery_evidence"
    )
    assert manifest["viewportRecoveryContract"]["requiredRefs"] == [
        "sourceFailureManifestRef",
        "replayResultRef",
        "replayTraceRefs",
        "scrollStateBeforeRef",
        "scrollStateAfterRef",
    ]
    assert "scroll state refs" in manifest["viewportRecoveryContract"]["validationOptions"]["requireExistingRefs"]
    assert manifest["targetBoundRealWindowProbeContract"]["builder"] == (
        "sciforge_computer_use.target_bound_evidence.build_target_bound_real_window_probe_evidence"
    )
    assert manifest["targetBoundRealWindowProbeContract"]["validator"] == (
        "sciforge_computer_use.target_bound_evidence.validate_target_bound_real_window_probe_evidence"
    )
    assert "preflightRef" in manifest["targetBoundRealWindowProbeContract"]["requiredRefs"]
    assert manifest["targetBoundRealWindowProbeContract"]["requiredFlags"]["realWindowEvidence"] is True
    assert "csv" in manifest["targetBoundRealWindowProbeContract"]["declaredArtifactOutput"]["supportedFormats"]
    assert manifest["targetBoundRealWindowProbeContract"]["workflowRequirements"]["requiresCurrentStepScreenshots"].startswith(
        "optional boolean"
    )
    assert "Task B" in manifest["targetBoundRealWindowProbeContract"]["workflowRequirements"]["minimumActionCount"]
    assert manifest["hostPortsContract"]["diagnosticProbes"]["virtualDesktopStateOnly"].startswith(
        "python -m sciforge_computer_use.virtual_desktop_probe"
    )
    assert manifest["hostPortsContract"]["diagnosticProbes"]["semanticVerifier"].startswith(
        "python -m sciforge_computer_use.semantic_verifier_probe"
    )
    assert manifest["semanticVerifierProbeContract"]["probe"] == "sciforge_computer_use.semantic_verifier_probe"
    assert manifest["semanticVerifierProbeContract"]["diagnosticsSchemaRef"] == (
        "sciforge.computer-use.provider-diagnostics.v1"
    )
    assert "textResponses" in manifest["semanticVerifierProbeContract"]["diagnosticRequests"]
    assert manifest["semanticVerifierProbeContract"]["endpointResolution"]["acceptedBaseUrlKinds"] == [
        "api-base",
        "chat-completions-endpoint",
        "responses-endpoint",
        "models-endpoint",
    ]
    assert manifest["semanticVerifierProbeContract"]["responseCompatibilityHelper"].endswith("extract_provider_text")
    assert manifest["semanticVerifierProbeContract"]["responseCompatibilityHelpers"] == {
        "textExtraction": "sciforge_computer_use.response_compat.extract_provider_text",
        "responsesToChatCompletions": "sciforge_computer_use.response_compat.responses_to_chat_completions",
        "chatCompletionsToResponses": "sciforge_computer_use.response_compat.chat_completions_to_responses",
    }
    assert "responses-text-only" in manifest["semanticVerifierProbeContract"]["textPreflightVariants"]
    assert "responses-text-only-no-temperature" in manifest["semanticVerifierProbeContract"]["textPreflightVariants"]
    assert "chat-image-url-object-no-temperature" in manifest["semanticVerifierProbeContract"]["multimodalVariants"]
    assert "configuredModelPresent" in manifest["semanticVerifierProbeContract"]["diagnosticRecordFields"]
    assert "expectedProjectModelIds" in manifest["semanticVerifierProbeContract"]["projectEvidenceEligibilityFields"]
    assert "qwen3.6-plus-2026-04-02" in manifest["semanticVerifierProbeContract"]["projectEvidenceModels"]
    assert "raw HTTP/1.1" in manifest["semanticVerifierProbeContract"]["transportFallback"]
    assert "verdict=pass" in manifest["semanticVerifierProbeContract"]["completionVerdictPolicy"]
    assert "raw model ids" in manifest["semanticVerifierProbeContract"]["modelsDiagnosticPolicy"]
    assert buildRepairReplayEvidence is build_repair_replay_evidence
    assert validateRepairReplayEvidence is validate_repair_replay_evidence
    assert buildViewportRecoveryEvidence is build_viewport_recovery_evidence
    assert validateViewportRecoveryEvidence is validate_viewport_recovery_evidence
    assert buildTargetBoundRealWindowProbeEvidence is build_target_bound_real_window_probe_evidence
    assert validateTargetBoundRealWindowProbeEvidence is validate_target_bound_real_window_probe_evidence
    assert buildTargetBoundInputAdapterManifest is build_target_bound_input_adapter_manifest
    assert validateInputAdapterManifestForRealDesktop is validate_input_adapter_manifest_for_real_desktop
    assert validateRepairManifest is validate_repair_manifest
    assert computer_use_api.buildRepairReplayEvidence is build_repair_replay_evidence
    assert computer_use_api.validateRepairReplayEvidence is validate_repair_replay_evidence
    assert computer_use_api.buildViewportRecoveryEvidence is build_viewport_recovery_evidence
    assert computer_use_api.validateViewportRecoveryEvidence is validate_viewport_recovery_evidence
    assert computer_use_api.buildTargetBoundRealWindowProbeEvidence is build_target_bound_real_window_probe_evidence
    assert computer_use_api.validateTargetBoundRealWindowProbeEvidence is validate_target_bound_real_window_probe_evidence
    assert computer_use_api.buildTargetBoundInputAdapterManifest is build_target_bound_input_adapter_manifest
    assert computer_use_api.validateInputAdapterManifestForRealDesktop is validate_input_adapter_manifest_for_real_desktop
    assert computer_use_api.validateRepairManifest is validate_repair_manifest
    assert "buildRepairReplayEvidence" in computer_use_api.__all__
    assert "validateRepairReplayEvidence" in computer_use_api.__all__
    assert "buildViewportRecoveryEvidence" in computer_use_api.__all__
    assert "validateViewportRecoveryEvidence" in computer_use_api.__all__
    assert "buildTargetBoundRealWindowProbeEvidence" in computer_use_api.__all__
    assert "validateTargetBoundRealWindowProbeEvidence" in computer_use_api.__all__
    assert "buildTargetBoundInputAdapterManifest" in computer_use_api.__all__
    assert "validateInputAdapterManifestForRealDesktop" in computer_use_api.__all__
    assert "validateRepairManifest" in computer_use_api.__all__
    for symbol in (
        "buildRepairReplayEvidence",
        "validateRepairReplayEvidence",
        "buildViewportRecoveryEvidence",
        "validateViewportRecoveryEvidence",
        "buildTargetBoundRealWindowProbeEvidence",
        "validateTargetBoundRealWindowProbeEvidence",
        "build_target_bound_real_window_probe_evidence",
        "validate_target_bound_real_window_probe_evidence",
        "buildTargetBoundInputAdapterManifest",
        "validateInputAdapterManifestForRealDesktop",
        "build_target_bound_input_adapter_manifest",
        "validate_input_adapter_manifest_for_real_desktop",
        "validateRepairManifest",
        "validate_repair_manifest",
    ):
        assert symbol in computer_use_package.__all__
        assert getattr(computer_use_package, symbol) is getattr(computer_use_api, symbol)
    output_properties = manifest["actionSchema"]["outputShape"]["properties"]
    for key in (
        "schemaVersion",
        "message",
        "traceRefs",
        "screenshotRefs",
        "artifactRefs",
        "finalArtifactRef",
        "finalArtifactRefs",
        "finalObservationRef",
        "approvalRequest",
        "budgetDebits",
        "budgetDebitRefs",
    ):
        assert key in output_properties


def test_trace_validation_and_compact_result_promote_file_refs(tmp_path):
    sense = FakeSense(
        refs=[".sciforge/vision-runs/ref-run/before.png", ".sciforge/vision-runs/ref-run/after.png"],
        artifacts={
            "finalArtifactRef": ".sciforge/vision-runs/ref-run/literature-brief.pptx",
            "visibleArtifactRefs": [
                ".sciforge/vision-runs/ref-run/literature-brief.pptx",
                "artifact:computer-use/report.json",
            ],
            "visibleArtifacts": [{
                "schemaVersion": "sciforge.computer-use.virtual-remote-artifact.v1",
                "kind": "virtual-slide-deck",
                "artifactRef": ".sciforge/vision-runs/ref-run/literature-brief.pptx",
                "path": ".sciforge/vision-runs/ref-run/literature-brief.pptx",
                "dataRef": ".sciforge/vision-runs/ref-run/literature-brief.pptx",
                "delivery": "virtual-remote-session-artifact",
                "status": "visible-and-saved",
            }],
        },
        metadata={
            "focusRefs": [".sciforge/vision-runs/ref-run/focus-crop.png"],
            "screenshotRefs": [{"path": ".sciforge/vision-runs/ref-run/target-crop.png"}],
        },
    )
    result = run_computer_use_task(
        ComputerUseRequest(task="create visible artifact", max_steps=2),
        sense,
        FakePlanner([ActionPlan(kind="click", target=ActionTarget(description="Create"))]),
        FakeExecutor(),
        FakeVerifier(done_after=1),
    )

    trace = result_to_trace(result)
    handoff = compact_result(result)
    trace_path = tmp_path / "computer-use-trace.json"
    trace_path.write_text(json.dumps(trace), encoding="utf8")
    validation = validate_trace(trace)
    path_validation = validateTrace(trace_path)

    assert compactResult(result) == handoff
    assert validation["ok"] is True
    assert validation["warnings"] == []
    assert path_validation["ok"] is True
    assert path_validation["traceRef"] == str(trace_path)
    assert validation["screenshotRefs"] == [
        ".sciforge/vision-runs/ref-run/before.png",
        ".sciforge/vision-runs/ref-run/focus-crop.png",
        ".sciforge/vision-runs/ref-run/target-crop.png",
        ".sciforge/vision-runs/ref-run/after.png",
    ]
    assert trace["artifactRefs"] == [
        ".sciforge/vision-runs/ref-run/literature-brief.pptx",
        "artifact:computer-use/report.json",
    ]
    assert result.final_artifact_refs == (".sciforge/vision-runs/ref-run/literature-brief.pptx",)
    assert trace["finalArtifactRef"] == ".sciforge/vision-runs/ref-run/literature-brief.pptx"
    assert trace["finalArtifactRefs"] == [".sciforge/vision-runs/ref-run/literature-brief.pptx"]
    assert validation["artifactRefs"] == trace["artifactRefs"]
    assert validation["finalArtifactRefs"] == trace["finalArtifactRefs"]
    assert all(not ref.startswith("workEvidence:") for ref in validation["artifactRefs"])
    assert handoff["screenshotRefs"] == validation["screenshotRefs"]
    assert handoff["artifactRefs"] == trace["artifactRefs"]
    assert handoff["finalArtifactRef"] == ".sciforge/vision-runs/ref-run/literature-brief.pptx"
    assert handoff["finalArtifactRefs"] == [".sciforge/vision-runs/ref-run/literature-brief.pptx"]
    assert handoff["actions"][0]["screenshotRefs"] == validation["screenshotRefs"]
    assert "data:image/" not in json.dumps(trace)


def test_validate_trace_rejects_inline_image_payloads():
    trace = {
        "schemaVersion": "sciforge.computer-use.loop-trace.v1",
        "status": "completed",
        "reason": "bad trace fixture",
        "steps": [{"beforeRef": "data:image/png;base64,AAAA"}],
    }

    validation = validate_trace(trace)

    assert validation["ok"] is False
    assert validation["errors"] == ["Trace must be file-ref-only and cannot contain inline image payloads."]


def test_validate_trace_rejects_forbidden_raw_screenshot_key_even_when_value_is_a_ref():
    trace = {
        "schemaVersion": "sciforge.computer-use.loop-trace.v1",
        "status": "completed",
        "reason": "bad trace fixture",
        "steps": [{"rawScreenshot": ".sciforge/vision-runs/raw.png"}],
    }

    validation = validate_trace(trace)

    assert validation["ok"] is False
    assert validation["errors"] == ["Trace contains forbidden inline payload key 'rawScreenshot' at $.steps[0]."]


def test_validate_trace_does_not_promote_non_image_screenshot_refs_or_work_evidence():
    trace = {
        "schemaVersion": "sciforge.computer-use.loop-trace.v1",
        "status": "completed",
        "reason": "refs should stay typed",
        "steps": [
            {
                "screenshotRefs": [".sciforge/vision-runs/not-a-screenshot.pdf"],
                "metadata": {"workEvidenceRefs": ["workEvidence:computer-use-loop:abc123"]},
            }
        ],
    }

    validation = validate_trace(trace)

    assert validation["ok"] is True
    assert validation["screenshotRefs"] == []
    assert validation["artifactRefs"] == []
    assert validation["warnings"] == ["Trace has no promoted screenshotRefs."]


def test_validate_trace_enforces_required_directory_evidence_metadata():
    trace = {
        "schemaVersion": "sciforge.computer-use.loop-trace.v1",
        "status": "completed",
        "reason": "missing file list evidence",
        "metadata": {
            "requiresFinalArtifact": True,
            "requiresDirectoryEvidence": True,
        },
        "finalObservationRef": ".sciforge/vision-runs/trace/final.png",
        "finalArtifactRef": ".sciforge/vision-runs/trace/report.md",
        "finalArtifactRefs": [".sciforge/vision-runs/trace/report.md"],
        "artifactRefs": [],
        "steps": [
            {
                "beforeRef": ".sciforge/vision-runs/trace/before.png",
                "action": {
                    "metadata": {
                        "fileListArtifactRef": ".sciforge/vision-runs/trace/file-list.json",
                        "fileListDataRef": ".sciforge/vision-runs/trace/file-list-data.json",
                    },
                },
            }
        ],
    }

    validation = validate_trace(trace)

    assert validation["ok"] is False
    assert validation["errors"] == [
        "Trace completed with directory evidence metadata but has no file-list artifact/data refs."
    ]


def test_validate_trace_accepts_required_directory_evidence_from_artifact_refs():
    trace = {
        "schemaVersion": "sciforge.computer-use.loop-trace.v1",
        "status": "completed",
        "reason": "has file list evidence",
        "requestMetadata": {
            "acceptance": {
                "requiresFinalArtifact": True,
                "requiresFileListEvidence": True,
            },
        },
        "finalObservationRef": ".sciforge/vision-runs/trace/final.png",
        "finalArtifactRef": ".sciforge/vision-runs/trace/report.md",
        "finalArtifactRefs": [".sciforge/vision-runs/trace/report.md"],
        "artifactRefs": [
            ".sciforge/vision-runs/trace/file-list.json",
            ".sciforge/vision-runs/trace/file-list-data.json",
        ],
        "steps": [{"beforeRef": ".sciforge/vision-runs/trace/before.png"}],
    }

    validation = validate_trace(trace)

    assert validation["ok"] is True
    assert validation["errors"] == []


def test_final_artifact_refs_ignore_control_evidence_files():
    result = run_computer_use_task(
        ComputerUseRequest(task="create final file", max_steps=1),
        FakeSense(
            refs=[".sciforge/vision-runs/control/before.png"],
            artifacts={
                "finalArtifactRefs": [
                    ".sciforge/vision-runs/control/vision-trace.json",
                    ".sciforge/vision-runs/control/index.md",
                ],
            },
        ),
        FakePlanner([ActionPlan(done=True, reason="Final file is visible.")]),
        FakeExecutor(),
        FakeVerifier(),
    )

    trace = result_to_trace(result)

    assert result.status == "completed"
    assert result.final_artifact_refs == (".sciforge/vision-runs/control/index.md",)
    assert trace["finalArtifactRef"] == ".sciforge/vision-runs/control/index.md"
    assert trace["finalArtifactRefs"] == [".sciforge/vision-runs/control/index.md"]


def test_validate_trace_resolves_durable_trace_refs_when_host_resolver_is_supplied():
    trace = {
        "schemaVersion": "sciforge.computer-use.loop-trace.v1",
        "status": "completed",
        "reason": "resolved durable ref",
        "steps": [{"beforeRef": ".sciforge/vision-runs/resolved/before.png"}],
        "screenshotRefs": [".sciforge/vision-runs/resolved/before.png"],
    }

    validation = validateTrace("trace:resolved/computer-use.json", resolver=lambda ref: trace)

    assert validation["ok"] is True
    assert validation["traceRef"] == "trace:resolved/computer-use.json"
    assert validation["screenshotRefs"] == [".sciforge/vision-runs/resolved/before.png"]


def test_validate_trace_requires_resolver_for_durable_trace_refs():
    validation = validate_trace("trace:unresolved/computer-use.json")

    assert validation["ok"] is False
    assert validation["traceRef"] == "trace:unresolved/computer-use.json"
    assert "durable refs require a host resolver" in validation["errors"][0]


def test_max_steps_when_verifier_never_done():
    planner = FakePlanner([
        ActionPlan(kind="wait", reason="observe again"),
    ])
    result = run_computer_use_task(
        ComputerUseRequest(task="never done", max_steps=2),
        FakeSense(refs=["a.png", "b.png", "c.png"]),
        planner,
        FakeExecutor(),
        FakeVerifier(done_after=99),
    )

    assert result.status == "max-steps"
    assert result.metrics["stepCount"] == 2


def test_max_steps_boundary_final_planner_completion_does_not_execute_extra_action():
    sense = FakeSense(refs=[
        "step-1-before.png",
        "step-1-after.png",
        "step-2-before.png",
        "step-2-after.png",
        "final-budget-observation.png",
    ])
    planner = FakePlanner([
        ActionPlan(kind="click", target=ActionTarget(description="create folder")),
        ActionPlan(kind="click", target=ActionTarget(description="save index")),
        ActionPlan(done=True, reason="Final observation shows requested artifact is complete."),
    ])
    executor = FakeExecutor()

    result = run_computer_use_task(
        ComputerUseRequest(task="finish at action budget boundary", max_steps=2),
        FakeSense(
            refs=[
                "step-1-before.png",
                "step-1-after.png",
                "step-2-before.png",
                "step-2-after.png",
                "final-budget-observation.png",
            ],
            artifacts={"finalArtifactRef": ".sciforge/vision-runs/final-budget/index.md"},
        ),
        planner,
        executor,
        FakeVerifier(done_after=99),
    )

    assert result.status == "completed"
    assert result.reason == "Final observation shows requested artifact is complete."
    assert result.final_observation is not None
    assert result.final_observation.ref == "final-budget-observation.png"
    assert result.final_artifact_refs == (".sciforge/vision-runs/final-budget/index.md",)
    trace = result_to_trace(result)
    assert trace["finalArtifactRef"] == ".sciforge/vision-runs/final-budget/index.md"
    assert planner.calls == [
        ("step-1-before.png", 0),
        ("step-2-before.png", 1),
        ("final-budget-observation.png", 2),
    ]
    assert executor.calls == [("click", 10, 20), ("click", 10, 20)]
    assert result.metrics["actionCount"] == 2
    assert result.metrics["stepCount"] == 3
    assert result.steps[-1].plan.done is True
    assert result.steps[-1].execution is None


def test_targeted_wait_uses_grounding_but_skips_executor_as_observation_only():
    sense = FakeSense()
    planner = FakePlanner([
        {"type": "wait", "targetDescription": "results panel", "reason": "inspect local panel"},
    ])
    executor = FakeExecutor()

    result = run_computer_use_task(
        ComputerUseRequest(task="inspect results panel", max_steps=2),
        sense,
        planner,
        executor,
        FakeVerifier(done_after=1),
    )

    assert result.status == "completed"
    assert sense.locate_calls == [("before.png", "results panel")]
    assert executor.calls == []
    assert result.steps[0].grounding is not None
    assert result.steps[0].grounding.metadata["observationOnly"] is True
    assert result.steps[0].execution is not None
    assert result.steps[0].execution.metadata["observationOnly"] is True
    assert result.steps[0].verification is not None


def run_cli(*args, stdin=None):
    env = {
        **os.environ,
        "PYTHONPATH": str(PACKAGE_ROOT),
    }
    return subprocess.run(
        [sys.executable, "-m", "sciforge_computer_use", *args],
        cwd=PACKAGE_ROOT,
        input=stdin,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        check=False,
    )


def test_cli_fixture_outputs_structured_result_json():
    fixture = {
        "capture": [
            {
                "ref": ".sciforge/vision-runs/cli/before.png",
                "summary": "before",
                "metadata": {"focusRefs": [".sciforge/vision-runs/cli/focus.png"]},
            },
            {
                "ref": ".sciforge/vision-runs/cli/after.png",
                "summary": "after",
                "artifacts": {
                    "finalArtifactRef": ".sciforge/vision-runs/cli/result-report.pdf",
                    "outputRefs": [".sciforge/vision-runs/cli/result-report.pdf"],
                },
            },
        ],
        "plans": [
            {"type": "click", "targetDescription": "safe local button"},
        ],
        "grounding": {"ok": True, "x": 11, "y": 22, "confidence": 0.9},
        "execution": {"ok": True, "message": "fixture click"},
        "verification": {"ok": True, "done": True, "reason": "visible result changed"},
        "writeTraceRef": "trace:cli-fixture/computer-use.json",
    }
    completed = run_cli(
        "--request-json",
        json.dumps({"task": "click safe local button", "maxSteps": 2}),
        "--fixture-json",
        json.dumps(fixture),
    )

    assert completed.returncode == 0
    assert completed.stderr == ""
    payload = json.loads(completed.stdout)
    assert payload["status"] == "completed"
    assert payload["traceRefs"] == ["trace:cli-fixture/computer-use.json"]
    assert payload["steps"][0]["beforeRef"] == ".sciforge/vision-runs/cli/before.png"
    assert payload["screenshotRefs"] == [
        ".sciforge/vision-runs/cli/before.png",
        ".sciforge/vision-runs/cli/focus.png",
        ".sciforge/vision-runs/cli/after.png",
    ]
    assert payload["artifactRefs"] == [".sciforge/vision-runs/cli/result-report.pdf"]
    assert payload["finalArtifactRef"] == ".sciforge/vision-runs/cli/result-report.pdf"
    assert payload["finalArtifactRefs"] == [".sciforge/vision-runs/cli/result-report.pdf"]
    assert "data:image/" not in completed.stdout


def test_cli_missing_host_ports_fails_closed_without_traceback_stdout():
    failed = run_cli(stdin=json.dumps({"task": "click safe local button", "maxSteps": 2}))

    assert failed.returncode == 1
    assert failed.stderr == ""
    payload = json.loads(failed.stdout)
    assert payload["status"] == "failed-with-reason"
    assert payload["failureDiagnostics"]["failedStage"] == "host-port-validation"
    assert "traceback" not in failed.stdout.lower()


def test_cli_fixture_high_risk_returns_approval_request_without_execution_success():
    fixture = {
        "capture": [{"ref": ".sciforge/vision-runs/cli/high-risk-before.png"}],
        "plans": [{"type": "click", "targetDescription": "Submit payment", "riskLevel": "high"}],
        "execution": {"ok": True, "message": "must not execute"},
    }
    blocked = run_cli(
        "--request-json",
        json.dumps({"task": "submit payment", "maxSteps": 2}),
        "--fixture-json",
        json.dumps(fixture),
    )

    assert blocked.returncode == 0
    payload = json.loads(blocked.stdout)
    assert payload["status"] == "needs-confirmation"
    assert payload["approvalRequest"]["action_kind"] == "click"
    assert payload["steps"][0]["execution"] is None
