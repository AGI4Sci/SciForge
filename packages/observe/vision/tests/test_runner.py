from sciforge_vision_sense.executor import ExecutionResult, Point
from sciforge_vision_sense.runner import (
    CompletionCheck,
    GroundingResult,
    Screenshot,
    VisionAction,
    VisionTaskRequest,
    compact_vision_result_for_handoff,
    pixel_diff,
    run_vision_task,
)


class FakeObserver:
    def __init__(self, frames):
        self.frames = list(frames)
        self.index = 0

    def capture(self):
        if self.index >= len(self.frames):
            return self.frames[-1]
        frame = self.frames[self.index]
        self.index += 1
        return frame


class FakeVlm:
    def __init__(self, actions, done_after=None, crosshair_checks=None):
        self.actions = list(actions)
        self.done_after = done_after
        self.crosshair_checks = list(crosshair_checks or [])
        self.crosshair_calls = []

    def check_completion(self, request, screenshot, history):
        if self.done_after is not None and len(history) >= self.done_after:
            return CompletionCheck(done=True, reason="complete")
        return CompletionCheck(done=False, reason="keep going")

    def plan_action(self, request, screenshot, history):
        return self.actions[len(history)]

    def summarize_screen(self, request, screenshot, history):
        return f"screen {screenshot.ref}"

    def extract_visible_texts(self, request, screenshot, history):
        return [{"text": "Search"}]

    def verify_crosshair(self, request, screenshot, target_description, grounding, history):
        if not self.crosshair_checks:
            return None
        self.crosshair_calls.append((screenshot.ref, target_description, grounding.point))
        return self.crosshair_checks.pop(0)


class FakeGrounder:
    def __init__(self, results):
        self.results = list(results)
        self.calls = []

    def ground(self, screenshot, target_description):
        self.calls.append((screenshot.ref, target_description))
        return self.results.pop(0)


class FakeExecutor:
    def __init__(self):
        self.calls = []

    def click(self, point):
        self.calls.append(("click", point))
        return ExecutionResult()

    def type_text(self, text):
        self.calls.append(("type_text", text))
        return ExecutionResult(message="clipboard paste")

    def press_key(self, key):
        self.calls.append(("press_key", key))
        return ExecutionResult()

    def scroll(self, direction, amount):
        self.calls.append(("scroll", direction, amount))
        return ExecutionResult()


def frame(ref, pixels):
    return Screenshot(ref=ref, width=10, height=10, pixels=pixels)


def stable_frames(*frames):
    doubled = []
    for item in frames:
        doubled.extend([item, item])
    return doubled


def test_pixel_diff_marks_small_changes_as_possibly_no_effect():
    diff = pixel_diff(frame("a", b"00000"), frame("b", b"00000"))
    changed = pixel_diff(frame("a", b"00000"), frame("b", b"11111"))

    assert diff.change_ratio == 0
    assert diff.possibly_no_effect is True
    assert changed.change_ratio == 1
    assert changed.possibly_no_effect is False


def test_run_vision_task_mock_integration_three_step_smoke():
    request = VisionTaskRequest(task="search paper", max_steps=30)
    actions = [
        VisionAction(kind="click", target_description="search box"),
        VisionAction(kind="type_text", text="KRAS G12D"),
        VisionAction(kind="press_key", key="Enter"),
    ]
    vlm = FakeVlm(actions, done_after=3)
    observer = FakeObserver(
        stable_frames(
            frame("s0", b"00000"),
            frame("s1", b"10000"),
            frame("s2", b"11000"),
            frame("s3", b"11100"),
            frame("s4", b"11100"),
            frame("s5", b"11110"),
        )
    )
    grounder = FakeGrounder([{"point": [0.5, 0.25], "normalized": True}])
    executor = FakeExecutor()

    result = run_vision_task(request, vlm, observer, grounder, executor)

    assert result.status == "done"
    assert result.metrics["stepCount"] == 4
    assert grounder.calls == [("s0", "search box")]
    assert executor.calls == [
        ("click", Point(5, 2.5)),
        ("type_text", "KRAS G12D"),
        ("press_key", "Enter"),
    ]
    assert result.steps[0].grounding.point == Point(5, 2.5)
    assert result.steps[1].execution.message == "clipboard paste"
    assert result.steps[2].pixel_diff.possibly_no_effect is False
    assert result.final_screenshot_ref == "s5"


def test_run_vision_task_exits_on_max_steps():
    request = {"task": "never complete", "maxSteps": 2}
    vlm = FakeVlm(
        [
            VisionAction(kind="press_key", key="Tab"),
            VisionAction(kind="press_key", key="Tab"),
        ]
    )
    observer = FakeObserver(
        stable_frames(frame("a", b"00"), frame("b", b"10"), frame("c", b"11"))
    )

    result = run_vision_task(request, vlm, observer, FakeGrounder([]), FakeExecutor())

    assert result.status == "max_steps"
    assert len(result.steps) == 2
    assert result.failure_diagnostics["status"] == "max_steps"


def test_run_vision_task_exits_after_three_grounding_failures():
    vlm = FakeVlm(
        [
            VisionAction(kind="click", target_description="missing button"),
            VisionAction(kind="click", target_description="missing button"),
            VisionAction(kind="click", target_description="missing button"),
        ]
    )
    observer = FakeObserver(
        stable_frames(frame("a", b"00"), frame("b", b"00"), frame("c", b"00"))
    )
    grounder = FakeGrounder(
        [
            GroundingResult(point=None, ok=False, message="no target"),
            GroundingResult(point=None, ok=False, message="no target"),
            GroundingResult(point=None, ok=False, message="no target"),
        ]
    )
    executor = FakeExecutor()

    result = run_vision_task("click missing", vlm, observer, grounder, executor)

    assert result.status == "grounding_failed"
    assert result.metrics["consecutiveGroundingFailures"] == 3
    assert len(result.failure_diagnostics["recentGroundingFailures"]) == 3
    assert result.failure_diagnostics["recentGroundingFailures"][-1]["message"] == "no target"
    assert executor.calls == []


def test_run_vision_task_exits_after_five_no_effect_steps():
    vlm = FakeVlm([VisionAction(kind="press_key", key="Tab")] * 5)
    observer = FakeObserver(stable_frames(*(frame(f"s{i}", b"00000") for i in range(6))))

    result = run_vision_task("tab around", vlm, observer, FakeGrounder([]), FakeExecutor())

    assert result.status == "no_effect"
    assert result.metrics["consecutiveNoEffectSteps"] == 5
    assert len(result.steps) == 5


def test_run_vision_task_retries_click_grounding_after_crosshair_rejection():
    vlm = FakeVlm(
        [VisionAction(kind="click", target_description="generic search control")],
        done_after=1,
        crosshair_checks=[
            {
                "hit": False,
                "reason": "crosshair is on the label",
                "confidence": 0.7,
                "revised_target_description": "the empty search input field",
            },
            {"hit": True, "reason": "crosshair is on input", "confidence": 0.9},
        ],
    )
    observer = FakeObserver(
        stable_frames(frame("s0", b"00000"), frame("s1", b"10000"), frame("s2", b"10000"))
    )
    grounder = FakeGrounder(
        [
            {"point": [1, 1]},
            {"point": [4, 2]},
        ]
    )
    executor = FakeExecutor()

    result = run_vision_task("click search", vlm, observer, grounder, executor)

    assert result.status == "done"
    assert grounder.calls == [
        ("s0", "generic search control"),
        ("s0", "the empty search input field"),
    ]
    assert vlm.crosshair_calls == [
        ("s0", "generic search control", Point(1, 1)),
        ("s0", "the empty search input field", Point(4, 2)),
    ]
    assert executor.calls == [("click", Point(4, 2))]
    assert result.steps[0].crosshair_checks[0].hit is False
    assert result.steps[0].crosshair_checks[1].hit is True


def test_compact_vision_result_for_handoff_keeps_only_lightweight_refs():
    vlm = FakeVlm([VisionAction(kind="press_key", key="Tab")], done_after=1)
    observer = FakeObserver(stable_frames(frame("s0", b"00000"), frame("s1", b"10000")))

    result = run_vision_task("tab once", vlm, observer, FakeGrounder([]), FakeExecutor())
    handoff = compact_vision_result_for_handoff(result)

    assert handoff["status"] == "done"
    assert handoff["steps"][0]["beforeScreenshotRef"] == "s0"
    assert handoff["steps"][0]["plannedAction"]["key"] == "Tab"
    assert "pixels" not in str(handoff)
    assert "base64" not in str(handoff).lower()
