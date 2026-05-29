import json
import os
import subprocess
import sys
from pathlib import Path

import sciforge_computer_use as computer_use_package
from sciforge_computer_use.evidence_ledger import EvidenceLedger
from sciforge_computer_use.isolated_desktop_contracts import (
    BACKEND_KIND,
    BACKEND_READINESS_PROOF_SCHEMA_VERSION,
    EXECUTOR_COMMAND_EVENT_LOG_SCHEMA as CONTRACT_EXECUTOR_COMMAND_EVENT_LOG_SCHEMA,
    ISOLATED_CAPTURE_SOURCE,
    ISOLATED_RUNTIME_RESOURCE_ALLOCATION_SCHEMA_VERSION,
    ISOLATED_TARGET_WINDOW_SCHEMA_VERSION,
    LEGACY_L1_RUNTIME_RESOURCE_ALLOCATION_SCHEMA_VERSION,
    LEGACY_L1_TARGET_WINDOW_SCHEMA_VERSION,
    REMOTE_DESKTOP_INPUT_CHANNEL,
)
from sciforge_computer_use.loop import ActionLoop, CompletionGuard, EvidenceLoop, TaskLoop
from sciforge_computer_use import (
    ActionPlan,
    ActionTarget,
    ComputerUseRequest,
    EXECUTOR_COMMAND_EVENT_LOG_SCHEMA,
    ExecutionOutcome,
    Grounding,
    Observation,
    Verification,
    buildIsolatedDesktopL1SmokeEvidence,
    buildIsolatedDesktopL3WorkflowEvidence,
    buildRepairReplayEvidence,
    buildTargetBoundRealWindowProbeEvidence,
    buildTargetBoundInputAdapterManifest,
    buildViewportRecoveryEvidence,
    build_isolated_desktop_l1_smoke_evidence,
    build_isolated_desktop_l3_workflow_evidence,
    build_target_bound_real_window_probe_evidence,
    build_target_bound_input_adapter_manifest,
    build_repair_replay_evidence,
    build_viewport_recovery_evidence,
    compactResult,
    compact_result,
    compact_result_for_handoff,
    executorCommandEventLogSchema,
    getManifest,
    get_manifest,
    result_to_trace,
    run_task,
    runTask,
    run_computer_use_task,
    validateRepairManifest,
    validateRepairReplayEvidence,
    validateIsolatedDesktopL1SmokeEvidence,
    validateIsolatedDesktopL3WorkflowEvidence,
    validateTargetBoundRealWindowProbeEvidence,
    validateInputAdapterManifestForRealDesktop,
    validate_isolated_desktop_l1_smoke_evidence,
    validate_isolated_desktop_l3_workflow_evidence,
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


def test_loop_phase_boundaries_and_completion_guard_reject_stale_evidence(tmp_path):
    assert EvidenceLoop.__name__ == "EvidenceLoop"
    assert ActionLoop.__name__ == "ActionLoop"
    assert TaskLoop.__name__ == "TaskLoop"

    ledger = EvidenceLedger(tmp_path)
    observation_id = ledger.append_observation(
        Observation(ref="before.png", summary="Old screen", visible_texts=("Old",)),
        action_index=0,
        query=None,
    )
    ledger.append_action(
        ActionPlan(kind="click", target=ActionTarget(description="Next"), reason="advance screen"),
        ExecutionOutcome(ok=True, message="clicked"),
        action_index=0,
        before_record_id=observation_id,
        grounding_record_id=None,
    )

    claim_id, reason = CompletionGuard(ledger).append_claim_if_current(
        action_index=0,
        summary="stale planner claim",
        status="completed",
        supports=[observation_id],
        metadata={"source": "unit-test"},
    )

    records = [
        json.loads(line)
        for line in (tmp_path / "evidence-log.jsonl").read_text(encoding="utf8").splitlines()
    ]
    assert claim_id is None
    assert reason == "Completion guard rejected stale or missing evidence support."
    assert "completion-claim" not in {record["type"] for record in records}
    assert any(record["type"] == "uncertainty" and "completion-guard" in record["tags"] for record in records)


def test_report_summary_intent_requires_final_artifact_evidence():
    result = run_computer_use_task(
        ComputerUseRequest(
            task="Write an evidence summary report with action mapping and field/control evidence refs.",
            max_steps=1,
            metadata={
                "plannerAcceptanceContract": {
                    "roundPrompt": "Summarize visual evidence and action mapping.",
                    "expectedTrace": ["field evidence refs", "action mapping"],
                },
            },
        ),
        FakeSense(),
        FakePlanner([ActionPlan(kind="click", target=ActionTarget(description="report body"))]),
        FakeExecutor(),
        FakeVerifier(done_after=1),
    )

    assert result.status == "failed-with-reason"
    assert result.reason.startswith("Final artifact evidence is required")
    assert result.failure_diagnostics["failedStage"] == "final-artifact-evidence"


def test_plain_save_and_inline_summary_do_not_require_final_artifact_evidence():
    for task in [
        "save current file",
        "save the local document",
        "write a short summary in the comment box",
    ]:
        result = run_computer_use_task(
            ComputerUseRequest(task=task, max_steps=1),
            FakeSense(),
            FakePlanner([ActionPlan(kind="click", target=ActionTarget(description="safe control"))]),
            FakeExecutor(),
            FakeVerifier(done_after=1),
        )
        assert result.status == "completed"


def test_metadata_artifact_refs_do_not_trigger_final_artifact_requirement():
    result = run_computer_use_task(
        ComputerUseRequest(
            task="click the visible toolbar button",
            max_steps=1,
            metadata={
                "artifactRefs": ["previous-report.md"],
                "visibleArtifacts": [{"artifactRef": "old-report.md", "status": "visible-and-saved"}],
            },
        ),
        FakeSense(),
        FakePlanner([ActionPlan(kind="click", target=ActionTarget(description="safe toolbar button"))]),
        FakeExecutor(),
        FakeVerifier(done_after=1),
    )

    assert result.status == "completed"


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


class FakeFailingExecutor(FakeExecutor):
    def execute(self, action, grounding, request):
        self.calls.append((action.kind, grounding.x if grounding else None, grounding.y if grounding else None))
        return ExecutionOutcome(ok=False, message="executor failed after possible input")


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
        self.crop_calls = []

    def capture(self, request, history, query=None):
        return self.sense.observe(request, history, query)

    def crop(self, observation, region):
        self.crop_calls.append((observation.ref, dict(region)))
        return Observation(
            ref=f"{observation.ref}-focus.png",
            summary=f"focus crop for {observation.ref}",
            metadata={"focusRefs": [f"{observation.ref}-focus.png"]},
        )

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


def test_run_task_optional_crop_port_promotes_focus_ref_and_ledger_record(tmp_path):
    host_ports = FakeHostPorts()
    evidence_dir = tmp_path / "evidence"

    result = run_task(
        {
            "task": "click visible search field",
            "maxSteps": 3,
            "metadata": {"evidenceOutputDir": str(evidence_dir), "runId": "crop-run"},
        },
        host_ports,
    )

    trace = result_to_trace(result)
    log_records = [
        json.loads(line)
        for line in (evidence_dir / "evidence-log.jsonl").read_text(encoding="utf8").splitlines()
    ]

    assert result.status == "completed"
    assert host_ports.crop_calls == [
        (
            "before.png",
            {
                "kind": "point-neighborhood",
                "x": 10.0,
                "y": 20.0,
                "coordinateSpace": "observation",
                "radius": 64,
                "source": "grounding.point",
            },
        )
    ]
    assert "before.png-focus.png" in trace["screenshotRefs"]
    assert "before.png-focus.png" in trace["steps"][0]["screenshotRefs"]
    assert trace["steps"][0]["grounding"]["metadata"]["diagnostics"]["focusCropRefs"] == ["before.png-focus.png"]
    assert any(
        record["type"] == "observation"
        and record["metadata"]["query"] == "focus-crop"
        and record["ref"] == "before.png-focus.png"
        for record in log_records
    )


def test_run_task_optional_crop_preserves_list_grounder_diagnostics(tmp_path):
    host_ports = FakeHostPorts()
    host_ports.sense.grounding = Grounding(
        ok=True,
        x=10,
        y=20,
        confidence=0.9,
        reason="visible",
        metadata={
            "diagnostics": [
                {"stage": "health", "status": "ok"},
                {"stage": "predict", "status": "ok"},
            ],
        },
    )

    result = run_task(
        {
            "task": "click visible search field",
            "maxSteps": 3,
            "metadata": {"evidenceOutputDir": str(tmp_path / "evidence"), "runId": "crop-diagnostics-list"},
        },
        host_ports,
    )

    trace = result_to_trace(result)

    assert result.status == "completed"
    diagnostics = trace["steps"][0]["grounding"]["metadata"]["diagnostics"]
    assert diagnostics["grounderDiagnostics"] == [
        {"stage": "health", "status": "ok"},
        {"stage": "predict", "status": "ok"},
    ]
    assert diagnostics["focusCropRefs"] == ["before.png-focus.png"]


def test_run_task_optional_crop_failure_records_uncertainty_without_blocking(tmp_path):
    class CropFailingHostPorts(FakeHostPorts):
        def crop(self, observation, region):
            self.crop_calls.append((observation.ref, dict(region)))
            raise RuntimeError("crop backend unavailable")

    host_ports = CropFailingHostPorts()
    evidence_dir = tmp_path / "evidence"

    result = run_task(
        {
            "task": "click visible search field",
            "maxSteps": 3,
            "metadata": {"evidenceOutputDir": str(evidence_dir), "runId": "crop-failure-run"},
        },
        host_ports,
    )

    log_records = [
        json.loads(line)
        for line in (evidence_dir / "evidence-log.jsonl").read_text(encoding="utf8").splitlines()
    ]

    assert result.status == "completed"
    assert host_ports.executor.calls == [("click", 10, 20)]
    assert any(
        record["type"] == "uncertainty"
        and "focus-crop" in record["tags"]
        and record["metadata"]["failedStage"] == "focus-crop"
        for record in log_records
    )


def test_failed_mutating_executor_action_captures_after_evidence_and_invalidates_before(tmp_path):
    sense = FakeSense(refs=["before.png", "after-failed.png"])
    executor = FakeFailingExecutor()
    evidence_dir = tmp_path / "evidence"

    result = run_computer_use_task(
        ComputerUseRequest(
            task="click visible search field",
            max_steps=3,
            metadata={"evidenceOutputDir": str(evidence_dir), "runId": "failed-mutation"},
        ),
        sense,
        FakePlanner([ActionPlan(kind="click", target=ActionTarget(description="search field"))]),
        executor,
        FakeVerifier(done_after=1),
    )

    log_records = [
        json.loads(line)
        for line in (evidence_dir / "evidence-log.jsonl").read_text(encoding="utf8").splitlines()
    ]
    action_record = next(record for record in log_records if record["type"] == "action")
    after_record = next(
        record
        for record in log_records
        if record["type"] == "observation" and record["metadata"]["query"] == "after-failed-action"
    )
    index = json.loads((evidence_dir / "evidence-index.json").read_text(encoding="utf8"))

    assert result.status == "failed-with-reason"
    assert result.final_observation and result.final_observation.ref == "after-failed.png"
    assert result.steps[0].after and result.steps[0].after.ref == "after-failed.png"
    assert executor.calls == [("click", 10, 20)]
    assert action_record["metadata"]["observationOnly"] is False
    assert action_record["metadata"]["mutatesScreen"] is True
    assert "state-changing" in action_record["tags"]
    assert action_record["invalidates"]
    assert after_record["id"] in index["current"]
    assert result.failure_diagnostics["afterEvidenceCaptured"] is True


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


def test_type_text_report_body_can_mention_high_risk_ui_labels_without_confirmation():
    sense = FakeSense()
    planner = FakePlanner([
        ActionPlan(
            kind="type_text",
            text="Visible UI fact: the toolbar contains a Share button, but this is only report text.",
        ),
    ])
    executor = FakeExecutor()

    result = run_computer_use_task(
        "type local notes into a text editor body",
        sense,
        planner,
        executor,
        FakeVerifier(done_after=1),
    )

    assert result.status == "completed"
    assert len(executor.calls) == 1


def test_type_text_into_high_risk_target_still_needs_confirmation():
    sense = FakeSense()
    planner = FakePlanner([
        ActionPlan(
            kind="type_text",
            target=ActionTarget(description="external post composer"),
            text="Local report body",
        ),
    ])
    executor = FakeExecutor()

    result = run_computer_use_task(
        "type local notes into a text editor body",
        sense,
        planner,
        executor,
        FakeVerifier(done_after=1),
    )

    assert result.status == "needs-confirmation"
    assert executor.calls == []


def test_click_target_excluding_high_risk_controls_is_low_risk():
    sense = FakeSense()
    planner = FakePlanner([
        ActionPlan(
            kind="click",
            target=ActionTarget(
                description="central results table",
                region_description="Central data area, excluding Export, Share, Save, and Submit toolbar controls",
            ),
        ),
    ])
    executor = FakeExecutor()

    result = run_computer_use_task(
        "inspect visible table data",
        sense,
        planner,
        executor,
        FakeVerifier(done_after=1),
    )

    assert result.status == "completed"
    assert len(executor.calls) == 1


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


def test_focus_is_a_supported_target_grounded_action():
    sense = FakeSense()
    planner = FakePlanner([
        {"type": "focus", "targetDescription": "document body", "reason": "focus editor"},
    ])
    executor = FakeExecutor()

    result = run_computer_use_task("focus editor", sense, planner, executor, FakeVerifier())

    assert result.status == "completed"
    assert sense.locate_calls == [("before.png", "document body")]
    assert executor.calls == [("focus", 10, 20)]


def test_save_is_a_supported_generic_keyboard_action_without_grounding():
    sense = FakeSense()
    planner = FakePlanner([
        {"type": "save", "reason": "save current local document"},
    ])
    executor = FakeExecutor()

    result = run_computer_use_task("save document", sense, planner, executor, FakeVerifier())

    assert result.status == "completed"
    assert sense.locate_calls == []
    assert executor.calls == [("save", None, None)]


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
    assert "textRuns" in manifest["targetBoundRealWindowProbeContract"]["declaredArtifactOutput"]["pptxTextEvidenceFields"]
    assert "normalizedTextSha256" in manifest["targetBoundRealWindowProbeContract"]["declaredArtifactOutput"]["docxTextEvidenceFields"]
    assert manifest["targetBoundRealWindowProbeContract"]["workflowRequirements"]["requiresCurrentStepScreenshots"].startswith(
        "optional boolean"
    )
    assert "Task B" in manifest["targetBoundRealWindowProbeContract"]["workflowRequirements"]["minimumActionCount"]
    assert manifest["isolatedDesktopL1SmokeContract"]["builder"] == (
        "sciforge_computer_use.isolated_desktop_l1_smoke_evidence.build_isolated_desktop_l1_smoke_evidence"
    )
    assert manifest["isolatedDesktopL1SmokeContract"]["validator"] == (
        "sciforge_computer_use.isolated_desktop_l1_smoke_evidence.validate_isolated_desktop_l1_smoke_evidence"
    )
    assert manifest["isolatedDesktopL1SmokeContract"]["requiredFlags"]["backendKind"] == BACKEND_KIND
    assert manifest["isolatedDesktopL1SmokeContract"]["requiredFlags"]["captureSource"] == ISOLATED_CAPTURE_SOURCE
    assert manifest["isolatedDesktopL1SmokeContract"]["requiredFlags"]["inputChannel"] == REMOTE_DESKTOP_INPUT_CHANNEL
    assert manifest["isolatedDesktopL1SmokeContract"]["acceptanceTier"] == "l1-isolated-smoke"
    assert "preflightRef" in manifest["isolatedDesktopL1SmokeContract"]["requiredRefs"]
    assert "backendReadinessProofRef" in manifest["isolatedDesktopL1SmokeContract"]["requiredRefs"]
    assert "executorCommandEventLogRef" in manifest["isolatedDesktopL1SmokeContract"]["requiredRefs"]
    assert "targetWindowRef" in manifest["isolatedDesktopL1SmokeContract"]["requiredRefs"]
    assert "windowBoundPointerProofRef" in manifest["isolatedDesktopL1SmokeContract"]["requiredRefs"]
    assert "processRef" in manifest["isolatedDesktopL1SmokeContract"]["requiredRefs"]
    assert "resourceAllocationRef" in manifest["isolatedDesktopL1SmokeContract"]["requiredRefs"]
    assert "requiresBackendReadinessProof" in manifest["isolatedDesktopL1SmokeContract"]["workflowRequirements"]
    assert "requiresPreflightPayloadValidation" in manifest["isolatedDesktopL1SmokeContract"]["workflowRequirements"]
    assert manifest["isolatedDesktopL1SmokeContract"]["workflowRequirements"]["backendReadinessProofSchemaRef"] == (
        BACKEND_READINESS_PROOF_SCHEMA_VERSION
    )
    assert "requiresXDisplayReadinessProof" in manifest["isolatedDesktopL1SmokeContract"]["workflowRequirements"]
    assert "requiresBrowserWindowPageReadinessProof" in manifest["isolatedDesktopL1SmokeContract"]["workflowRequirements"]
    assert "requiresNoVncHttpViewerProof" in manifest["isolatedDesktopL1SmokeContract"]["workflowRequirements"]
    assert "requiresWindowBoundPointerProof" in manifest["isolatedDesktopL1SmokeContract"]["workflowRequirements"]
    assert manifest["isolatedDesktopL1SmokeContract"]["workflowRequirements"]["targetWindowSchemaRef"] == ISOLATED_TARGET_WINDOW_SCHEMA_VERSION
    assert manifest["isolatedDesktopL1SmokeContract"]["workflowRequirements"]["legacyTargetWindowSchemaRef"] == LEGACY_L1_TARGET_WINDOW_SCHEMA_VERSION
    assert "requiresExecutorCommandProvenance" in manifest["isolatedDesktopL1SmokeContract"]["workflowRequirements"]
    assert "requiresStepwiseScreenshotContentChange" in manifest["isolatedDesktopL1SmokeContract"]["workflowRequirements"]
    assert "requiresProcessLogRefs" in manifest["isolatedDesktopL1SmokeContract"]["workflowRequirements"]
    assert "requiresContainerSafeBrowserLaunch" in manifest["isolatedDesktopL1SmokeContract"]["workflowRequirements"]
    assert manifest["isolatedDesktopL1SmokeContract"]["workflowRequirements"]["runnerCliOptions"] == [
        "--display",
        "--vnc-port",
        "--novnc-port",
        "--timeout-seconds",
        "--resource-lock-root",
    ]
    assert manifest["isolatedDesktopL1SmokeContract"]["workflowRequirements"]["executorCommandEventLogSchemaRef"] == EXECUTOR_COMMAND_EVENT_LOG_SCHEMA
    assert EXECUTOR_COMMAND_EVENT_LOG_SCHEMA == CONTRACT_EXECUTOR_COMMAND_EVENT_LOG_SCHEMA
    assert manifest["isolatedDesktopL1SmokeContract"]["workflowRequirements"]["inputEventCommandProvenanceFields"] == [
        "commandEventId",
        "commandEventRef",
        "commandEventLogRef",
    ]
    assert "stdout" in manifest["isolatedDesktopL1SmokeContract"]["workflowRequirements"]["executorCommandForbiddenRawFields"]
    assert "sharedSystemInputUsed" in manifest["isolatedDesktopL1SmokeContract"]["workflowRequirements"]["executorCommandSideEffectFlags"]
    assert "requiresRuntimeProcessProof" in manifest["isolatedDesktopL1SmokeContract"]["workflowRequirements"]
    assert "virtual-display" in manifest["isolatedDesktopL1SmokeContract"]["workflowRequirements"]["requiresRuntimeProcessProof"]
    assert "requiresRuntimeResourceAllocation" in manifest["isolatedDesktopL1SmokeContract"]["workflowRequirements"]
    assert manifest["isolatedDesktopL1SmokeContract"]["workflowRequirements"]["resourceAllocationSchemaRef"] == ISOLATED_RUNTIME_RESOURCE_ALLOCATION_SCHEMA_VERSION
    assert manifest["isolatedDesktopL1SmokeContract"]["workflowRequirements"]["legacyResourceAllocationSchemaRef"] == LEGACY_L1_RUNTIME_RESOURCE_ALLOCATION_SCHEMA_VERSION
    assert manifest["isolatedDesktopL3WorkflowContract"]["builder"] == (
        "sciforge_computer_use.isolated_desktop_l3_workflow_evidence.build_isolated_desktop_l3_workflow_evidence"
    )
    assert manifest["isolatedDesktopL3WorkflowContract"]["validator"] == (
        "sciforge_computer_use.isolated_desktop_l3_workflow_evidence.validate_isolated_desktop_l3_workflow_evidence"
    )
    assert manifest["isolatedDesktopL3WorkflowContract"]["requiredFlags"]["backendKind"] == BACKEND_KIND
    assert manifest["isolatedDesktopL3WorkflowContract"]["requiredFlags"]["captureSource"] == ISOLATED_CAPTURE_SOURCE
    assert manifest["isolatedDesktopL3WorkflowContract"]["requiredFlags"]["inputChannel"] == REMOTE_DESKTOP_INPUT_CHANNEL
    assert manifest["isolatedDesktopL3WorkflowContract"]["acceptanceTier"] == "l3-multi-app-workflow"
    assert manifest["isolatedDesktopL3WorkflowContract"]["workflowRequirements"]["minimumAppCount"] == 3
    assert "requiresSupportedFactContentInArtifact" in manifest["isolatedDesktopL3WorkflowContract"]["workflowRequirements"]
    assert manifest["isolatedDesktopL3WorkflowContract"]["workflowRequirements"]["sourceFactEvidenceSchemaRef"] == (
        "sciforge.computer-use.source-fact-evidence.v1"
    )
    assert manifest["isolatedDesktopL3WorkflowContract"]["workflowRequirements"]["sourceFactCompatSchemaRef"] == (
        "sciforge.computer-use.source-fact.v1"
    )
    assert manifest["isolatedDesktopL3WorkflowContract"]["workflowRequirements"]["sourceFactEvidenceBuilder"] == (
        "sciforge_computer_use.source_fact_evidence.build_source_fact_evidence_payload"
    )
    assert manifest["isolatedDesktopL3WorkflowContract"]["workflowRequirements"]["sourceFactEvidenceValidator"] == (
        "sciforge_computer_use.source_fact_evidence.validate_source_fact_evidence_payload"
    )
    assert manifest["isolatedDesktopL3WorkflowContract"]["workflowRequirements"]["artifactBundleEvidenceSchemaRef"] == (
        "sciforge.computer-use.l3-artifact-bundle-evidence.v1"
    )
    assert manifest["isolatedDesktopL3WorkflowContract"]["workflowRequirements"]["artifactBundleEvidenceBuilder"] == (
        "sciforge_computer_use.l3_artifact_bundle_evidence.build_l3_artifact_bundle_evidence"
    )
    assert manifest["isolatedDesktopL3WorkflowContract"]["workflowRequirements"]["artifactBundleEvidenceValidator"] == (
        "sciforge_computer_use.l3_artifact_bundle_evidence.validate_l3_artifact_bundle_evidence"
    )
    assert "requiresGuiSavedArtifactCausality" in manifest["isolatedDesktopL3WorkflowContract"]["workflowRequirements"]
    assert "requiresGuiDirectoryPreviewCausality" in manifest["isolatedDesktopL3WorkflowContract"]["workflowRequirements"]
    assert "requiresInputActionIndexCoverage" in manifest["isolatedDesktopL3WorkflowContract"]["workflowRequirements"]
    assert manifest["isolatedDesktopL3WorkflowContract"]["workflowRequirements"]["actionPlanSchemaRef"] == (
        "sciforge.computer-use.isolated-desktop-l3-workflow-action-plan.v1"
    )
    assert manifest["isolatedDesktopL3WorkflowContract"]["workflowRequirements"]["actionPlanBuilder"] == (
        "sciforge_computer_use.isolated_desktop_l3_workflow_plan.build_isolated_desktop_l3_workflow_action_plan"
    )
    assert manifest["isolatedDesktopL3WorkflowContract"]["workflowRequirements"]["actionPlanValidator"] == (
        "sciforge_computer_use.isolated_desktop_l3_workflow_plan.validate_isolated_desktop_l3_workflow_action_plan"
    )
    assert manifest["isolatedDesktopL3WorkflowContract"]["workflowRequirements"]["completionAssemblySchemaRef"] == (
        "sciforge.computer-use.isolated-desktop-l3-completion-assembly.v1"
    )
    assert manifest["isolatedDesktopL3WorkflowContract"]["workflowRequirements"]["completionAssembler"] == (
        "sciforge_computer_use.isolated_desktop_l3_workflow_result.assemble_isolated_desktop_l3_workflow_completion"
    )
    assert manifest["isolatedDesktopL3WorkflowContract"]["workflowRequirements"]["runnerExecutionBoundarySchemaRef"] == (
        "sciforge.computer-use.isolated-desktop-l3-runner-execution-boundary.v1"
    )
    assert manifest["isolatedDesktopL3WorkflowContract"]["workflowRequirements"]["runnerExecutionBoundaryPhases"] == [
        "launch-session",
        "capture-source",
        "write-artifact",
        "save-through-gui",
        "preview-directory",
        "validate-and-present",
    ]
    assert manifest["isolatedDesktopL3WorkflowContract"]["workflowRequirements"]["partialRunSchemaRef"] == (
        "sciforge.computer-use.isolated-desktop-l3-partial-run.v1"
    )
    assert manifest["isolatedDesktopL3WorkflowContract"]["workflowRequirements"]["forbidPartialRefsAsCompletedRefs"] is True
    assert "partialRuntimeRefsPolicy" in manifest["isolatedDesktopL3WorkflowContract"]["workflowRequirements"]
    assert "requiresPreflightPayloadValidation" in manifest["isolatedDesktopL3WorkflowContract"]["workflowRequirements"]
    assert "requiresSameSessionRuntimeRefs" in manifest["isolatedDesktopL3WorkflowContract"]["workflowRequirements"]
    assert "requiresSessionBoundRuntimeProofs" in manifest["isolatedDesktopL3WorkflowContract"]["workflowRequirements"]
    assert "backendReadinessProofRef" in manifest["isolatedDesktopL3WorkflowContract"]["requiredRefs"]
    assert "executorCommandEventLogRef" in manifest["isolatedDesktopL3WorkflowContract"]["requiredRefs"]
    assert "targetWindowRef" in manifest["isolatedDesktopL3WorkflowContract"]["requiredRefs"]
    assert "windowBoundPointerProofRef" in manifest["isolatedDesktopL3WorkflowContract"]["requiredRefs"]
    assert "processRef" in manifest["isolatedDesktopL3WorkflowContract"]["requiredRefs"]
    assert "resourceAllocationRef" in manifest["isolatedDesktopL3WorkflowContract"]["requiredRefs"]
    assert "requiresBackendReadinessProof" in manifest["isolatedDesktopL3WorkflowContract"]["workflowRequirements"]
    assert manifest["isolatedDesktopL3WorkflowContract"]["workflowRequirements"]["backendReadinessProofSchemaRef"] == (
        BACKEND_READINESS_PROOF_SCHEMA_VERSION
    )
    assert "requiresExecutorCommandProvenance" in manifest["isolatedDesktopL3WorkflowContract"]["workflowRequirements"]
    assert manifest["isolatedDesktopL3WorkflowContract"]["workflowRequirements"]["executorCommandEventLogSchemaRef"] == (
        CONTRACT_EXECUTOR_COMMAND_EVENT_LOG_SCHEMA
    )
    assert "requiresRuntimeResourceAllocation" in manifest["isolatedDesktopL3WorkflowContract"]["workflowRequirements"]
    assert manifest["isolatedDesktopL3WorkflowContract"]["workflowRequirements"]["resourceAllocationSchemaRef"] == ISOLATED_RUNTIME_RESOURCE_ALLOCATION_SCHEMA_VERSION
    assert manifest["isolatedDesktopL3WorkflowContract"]["workflowRequirements"]["legacyResourceAllocationSchemaRef"] == LEGACY_L1_RUNTIME_RESOURCE_ALLOCATION_SCHEMA_VERSION
    assert "requiresProcessLogRefs" in manifest["isolatedDesktopL3WorkflowContract"]["workflowRequirements"]
    assert "requiresWindowBoundPointerProof" in manifest["isolatedDesktopL3WorkflowContract"]["workflowRequirements"]
    assert manifest["isolatedDesktopL3WorkflowContract"]["workflowRequirements"]["targetWindowSchemaRef"] == ISOLATED_TARGET_WINDOW_SCHEMA_VERSION
    assert "target-bound diagnostics" in manifest["isolatedDesktopL3WorkflowContract"]["claimLimit"]
    assert manifest["isolatedDesktopL3WorkflowContract"]["readinessProbe"].startswith(
        "python -m sciforge_computer_use.isolated_desktop_l3_workflow_probe"
    )
    assert manifest["hostPortsContract"]["diagnosticProbes"]["virtualDesktopStateOnly"].startswith(
        "python -m sciforge_computer_use.virtual_desktop_probe"
    )
    assert manifest["hostPortsContract"]["diagnosticProbes"]["isolatedDesktopBackend"].endswith(
        "isolated_desktop_backend_probe --output-dir <dir>"
    )
    assert manifest["hostPortsContract"]["diagnosticProbes"]["isolatedDesktopBackendBundle"].endswith(
        "isolated_desktop_backend_bundle --output-dir <dir>"
    )
    assert manifest["isolatedDesktopBackendRuntime"]["bundleProbe"].endswith(
        "isolated_desktop_backend_bundle --output-dir <dir>"
    )
    assert manifest["isolatedDesktopBackendRuntime"]["container"]["buildContext"] == "packages/actions/computer-use"
    assert manifest["isolatedDesktopBackendRuntime"]["container"]["baseImage"] == "python:3.12-slim-bookworm"
    assert manifest["isolatedDesktopBackendRuntime"]["container"]["baseImageOverrideEnv"] == "SCIFORGE_DOCKER_BASE_IMAGE"
    assert manifest["isolatedDesktopBackendRuntime"]["container"]["aptMirrorOverrideEnv"] == (
        "SCIFORGE_DOCKER_DEBIAN_APT_MIRROR"
    )
    assert manifest["isolatedDesktopBackendRuntime"]["container"]["securityAptMirrorOverrideEnv"] == (
        "SCIFORGE_DOCKER_DEBIAN_SECURITY_APT_MIRROR"
    )
    assert manifest["isolatedDesktopBackendRuntime"]["container"]["aptAcquireRetriesEnv"] == (
        "SCIFORGE_DOCKER_APT_ACQUIRE_RETRIES"
    )
    assert manifest["isolatedDesktopBackendRuntime"]["container"]["hostEvidenceOutputDirEnv"] == (
        "SCIFORGE_CU_ISOLATED_L1_EVIDENCE_DIR"
    )
    assert manifest["isolatedDesktopBackendRuntime"]["container"]["l3HostEvidenceOutputDirEnv"] == (
        "SCIFORGE_CU_ISOLATED_L3_EVIDENCE_DIR"
    )
    assert manifest["isolatedDesktopBackendRuntime"]["container"]["dockerfile"].endswith(
        "sciforge_computer_use/isolated_desktop_backend.Dockerfile"
    )
    assert "PYTHON_BASE_IMAGE=${SCIFORGE_DOCKER_BASE_IMAGE:-python:3.12-slim-bookworm}" in manifest["isolatedDesktopBackendRuntime"]["dockerBuildCommand"]
    assert "DEBIAN_APT_MIRROR=${SCIFORGE_DOCKER_DEBIAN_APT_MIRROR:-}" in manifest["isolatedDesktopBackendRuntime"]["dockerBuildCommand"]
    assert "DEBIAN_SECURITY_APT_MIRROR=${SCIFORGE_DOCKER_DEBIAN_SECURITY_APT_MIRROR:-}" in manifest["isolatedDesktopBackendRuntime"]["dockerBuildCommand"]
    assert "APT_ACQUIRE_RETRIES=${SCIFORGE_DOCKER_APT_ACQUIRE_RETRIES:-3}" in manifest["isolatedDesktopBackendRuntime"]["dockerBuildCommand"]
    assert manifest["isolatedDesktopBackendRuntime"]["bundleSpecDiagnosticOnly"] is True
    assert manifest["isolatedDesktopBackendRuntime"]["diagnosticOnlyUntilCompletedL1Evidence"] is True
    assert manifest["isolatedDesktopBackendRuntime"]["diagnosticOnlyUntilCompletedL3Evidence"] is True
    assert manifest["isolatedDesktopBackendRuntime"]["completionEvidenceRef"] is None
    assert "isolated_desktop_l3_workflow_probe" in manifest["isolatedDesktopBackendRuntime"]["dockerRunL3WorkflowCommand"]
    assert manifest["hostPortsContract"]["diagnosticProbes"]["isolatedDesktopL1SmokeReadiness"].endswith(
        "isolated_desktop_l1_smoke_probe --output-dir <dir>"
    )
    assert manifest["hostPortsContract"]["diagnosticProbes"]["isolatedDesktopL1SmokeExecute"].endswith(
        "isolated_desktop_l1_smoke_probe --output-dir <dir> --execute"
    )
    assert manifest["hostPortsContract"]["diagnosticProbes"]["isolatedDesktopL3WorkflowReadiness"].endswith(
        "isolated_desktop_l3_workflow_probe --output-dir <dir>"
    )
    assert manifest["hostPortsContract"]["diagnosticProbes"]["isolatedDesktopL3WorkflowExecute"].startswith(
        "python -m sciforge_computer_use.isolated_desktop_l3_workflow_probe --output-dir <dir> --execute"
    )
    assert "--timeout-seconds" in manifest["hostPortsContract"]["diagnosticProbes"]["isolatedDesktopL3WorkflowExecute"]
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
    assert executorCommandEventLogSchema == EXECUTOR_COMMAND_EVENT_LOG_SCHEMA
    assert buildIsolatedDesktopL1SmokeEvidence is build_isolated_desktop_l1_smoke_evidence
    assert validateIsolatedDesktopL1SmokeEvidence is validate_isolated_desktop_l1_smoke_evidence
    assert buildIsolatedDesktopL3WorkflowEvidence is build_isolated_desktop_l3_workflow_evidence
    assert validateIsolatedDesktopL3WorkflowEvidence is validate_isolated_desktop_l3_workflow_evidence
    assert buildTargetBoundInputAdapterManifest is build_target_bound_input_adapter_manifest
    assert validateInputAdapterManifestForRealDesktop is validate_input_adapter_manifest_for_real_desktop
    assert validateRepairManifest is validate_repair_manifest
    assert computer_use_api.buildRepairReplayEvidence is build_repair_replay_evidence
    assert computer_use_api.validateRepairReplayEvidence is validate_repair_replay_evidence
    assert computer_use_api.buildViewportRecoveryEvidence is build_viewport_recovery_evidence
    assert computer_use_api.validateViewportRecoveryEvidence is validate_viewport_recovery_evidence
    assert computer_use_api.buildTargetBoundRealWindowProbeEvidence is build_target_bound_real_window_probe_evidence
    assert computer_use_api.validateTargetBoundRealWindowProbeEvidence is validate_target_bound_real_window_probe_evidence
    assert computer_use_api.executorCommandEventLogSchema == EXECUTOR_COMMAND_EVENT_LOG_SCHEMA
    assert computer_use_api.buildIsolatedDesktopL1SmokeEvidence is build_isolated_desktop_l1_smoke_evidence
    assert computer_use_api.validateIsolatedDesktopL1SmokeEvidence is validate_isolated_desktop_l1_smoke_evidence
    assert computer_use_api.buildIsolatedDesktopL3WorkflowEvidence is build_isolated_desktop_l3_workflow_evidence
    assert computer_use_api.validateIsolatedDesktopL3WorkflowEvidence is validate_isolated_desktop_l3_workflow_evidence
    assert computer_use_api.buildTargetBoundInputAdapterManifest is build_target_bound_input_adapter_manifest
    assert computer_use_api.validateInputAdapterManifestForRealDesktop is validate_input_adapter_manifest_for_real_desktop
    assert computer_use_api.validateRepairManifest is validate_repair_manifest
    assert "buildRepairReplayEvidence" in computer_use_api.__all__
    assert "validateRepairReplayEvidence" in computer_use_api.__all__
    assert "buildViewportRecoveryEvidence" in computer_use_api.__all__
    assert "validateViewportRecoveryEvidence" in computer_use_api.__all__
    assert "buildTargetBoundRealWindowProbeEvidence" in computer_use_api.__all__
    assert "validateTargetBoundRealWindowProbeEvidence" in computer_use_api.__all__
    assert "EXECUTOR_COMMAND_EVENT_LOG_SCHEMA" in computer_use_api.__all__
    assert "executorCommandEventLogSchema" in computer_use_api.__all__
    assert "buildIsolatedDesktopL1SmokeEvidence" in computer_use_api.__all__
    assert "validateIsolatedDesktopL1SmokeEvidence" in computer_use_api.__all__
    assert "buildIsolatedDesktopL3WorkflowEvidence" in computer_use_api.__all__
    assert "validateIsolatedDesktopL3WorkflowEvidence" in computer_use_api.__all__
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
        "EXECUTOR_COMMAND_EVENT_LOG_SCHEMA",
        "executorCommandEventLogSchema",
        "buildIsolatedDesktopL1SmokeEvidence",
        "validateIsolatedDesktopL1SmokeEvidence",
        "build_isolated_desktop_l1_smoke_evidence",
        "validate_isolated_desktop_l1_smoke_evidence",
        "buildIsolatedDesktopL3WorkflowEvidence",
        "validateIsolatedDesktopL3WorkflowEvidence",
        "build_isolated_desktop_l3_workflow_evidence",
        "validate_isolated_desktop_l3_workflow_evidence",
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
        "evidenceLogRef",
        "evidenceSnapshotRef",
        "evidenceIndexRef",
        "plannerBriefRef",
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


def test_loop_writes_evidence_ledger_refs_and_staleness(tmp_path):
    result = run_computer_use_task(
        ComputerUseRequest(
            task="click visible search field",
            max_steps=1,
            metadata={"evidenceOutputDir": str(tmp_path), "runId": "loop-ledger"},
        ),
        FakeSense(refs=["before.png", "after.png"]),
        FakePlanner([ActionPlan(kind="click", target=ActionTarget(description="search field"))]),
        FakeExecutor(),
        FakeVerifier(done_after=1),
    )

    assert result.status == "completed"
    assert result.failure_diagnostics["evidenceLogRef"] == str(tmp_path / "evidence-log.jsonl")
    assert result.failure_diagnostics["evidenceSnapshotRef"] == str(tmp_path / "evidence-snapshot.json")
    assert result.failure_diagnostics["evidenceIndexRef"] == str(tmp_path / "evidence-index.json")
    assert result.failure_diagnostics["plannerBriefRef"] == str(tmp_path / "planner-brief.json")
    assert result.metrics["evidenceRecordCount"] >= 6

    index = json.loads((tmp_path / "evidence-index.json").read_text(encoding="utf8"))
    action_records = index["byType"]["action"]
    observation_records = index["byType"]["observation"]

    assert len(action_records) == 1
    assert len(observation_records) == 2
    assert index["staleBy"][observation_records[0]] == action_records[0]
    assert observation_records[1] in index["current"]
    assert result.final_observation is not None
    assert result.final_observation.metadata["evidenceRecordId"] == observation_records[1]


def test_targeted_wait_evidence_record_is_observation_only(tmp_path):
    result = run_computer_use_task(
        ComputerUseRequest(
            task="inspect results panel",
            max_steps=1,
            metadata={"evidenceOutputDir": str(tmp_path), "runId": "loop-wait"},
        ),
        FakeSense(refs=["before.png", "after.png"]),
        FakePlanner([{"type": "wait", "targetDescription": "results panel", "reason": "inspect local panel"}]),
        FakeExecutor(),
        FakeVerifier(done_after=1),
    )

    index = json.loads((tmp_path / "evidence-index.json").read_text(encoding="utf8"))
    log_records = [
        json.loads(line)
        for line in (tmp_path / "evidence-log.jsonl").read_text(encoding="utf8").splitlines()
    ]
    action_record = next(record for record in log_records if record["type"] == "action")

    assert result.status == "completed"
    assert action_record["metadata"]["observationOnly"] is True
    assert action_record["metadata"]["mutatesScreen"] is False
    assert action_record["invalidates"] == []
    assert index["staleBy"] == {}


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
