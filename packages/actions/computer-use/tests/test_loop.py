import json
import os
import subprocess
import sys
from pathlib import Path

from sciforge_computer_use import (
    ActionPlan,
    ActionTarget,
    ComputerUseRequest,
    ExecutionOutcome,
    Grounding,
    Observation,
    Verification,
    compact_result_for_handoff,
    result_to_trace,
    run_task,
    run_computer_use_task,
)


PACKAGE_ROOT = Path(__file__).resolve().parents[1]


class FakeSense:
    def __init__(self, refs=None, grounding=None):
        self.refs = list(refs or ["before.png", "after.png", "final.png"])
        self.grounding = grounding or Grounding(ok=True, x=10, y=20, confidence=0.9, reason="visible")
        self.locate_calls = []
        self.observe_count = 0

    def observe(self, request, history, query=None):
        ref = self.refs[min(self.observe_count, len(self.refs) - 1)]
        self.observe_count += 1
        return Observation(ref=ref, summary=f"screen {ref}", visible_texts=("Search",), window_target=request.window_target)

    def query(self, observation, question, history):
        return {"answer": observation.summary}

    def locate(self, observation, target, history):
        self.locate_calls.append((observation.ref, target.description))
        return self.grounding


class FakePlanner:
    def __init__(self, plans):
        self.plans = list(plans)

    def plan(self, request, observation, history):
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
            {"ref": ".sciforge/vision-runs/cli/before.png", "summary": "before"},
            {"ref": ".sciforge/vision-runs/cli/after.png", "summary": "after"},
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
