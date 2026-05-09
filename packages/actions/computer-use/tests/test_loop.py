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
    run_computer_use_task,
)


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


def test_sense_agnostic_loop_completes_with_fake_provider():
    sense = FakeSense()
    planner = FakePlanner([
        ActionPlan(kind="click", target=ActionTarget(description="search field")),
    ])
    executor = FakeExecutor()

    result = run_computer_use_task(
        ComputerUseRequest(task="click visible search field", max_steps=3),
        sense,
        planner,
        executor,
        FakeVerifier(done_after=1),
    )

    assert result.status == "completed"
    assert result.metrics["stepCount"] == 1
    assert sense.locate_calls == [("before.png", "search field")]
    assert executor.calls == [("click", 10, 20)]
    assert result_to_trace(result)["schemaVersion"] == "sciforge.computer-use.loop-trace.v1"


def test_high_risk_action_needs_confirmation_and_does_not_execute():
    sense = FakeSense()
    planner = FakePlanner([
        ActionPlan(kind="click", target=ActionTarget(description="Send button"), risk_level="high"),
    ])
    executor = FakeExecutor()

    result = run_computer_use_task("send external message", sense, planner, executor, FakeVerifier())

    assert result.status == "needs-confirmation"
    assert result.steps[0].status == "blocked"
    assert executor.calls == []
    assert result.failure_diagnostics["riskLevel"] == "high"


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
