"""Pure Vision Sense MVP runner.

This module intentionally does not connect to a real desktop, browser, network
service, or model provider. It coordinates observer, VLM, grounder, and
executor protocols so the core GUI loop can be tested deterministically.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Literal, Mapping, Protocol, Sequence

from .executor import ExecutionResult, GuiExecutor, Point, ScrollDirection


ActionKind = Literal["click", "type_text", "press_key", "scroll"]
TaskStatus = Literal[
    "done",
    "max_steps",
    "grounding_failed",
    "no_effect",
    "planner_failed",
    "execution_failed",
]


@dataclass(frozen=True)
class Screenshot:
    """A captured screen frame."""

    ref: str
    width: int
    height: int
    pixels: bytes | str | Sequence[int] | None = None


@dataclass(frozen=True)
class CompletionCheck:
    done: bool
    reason: str = ""
    confidence: float | None = None


@dataclass(frozen=True)
class VisionAction:
    kind: ActionKind
    target_description: str | None = None
    text: str | None = None
    key: str | None = None
    direction: ScrollDirection | None = None
    amount: float = 1.0


@dataclass(frozen=True)
class GroundingResult:
    point: Point | None
    ok: bool = True
    message: str | None = None
    normalized: bool = False


@dataclass(frozen=True)
class CrosshairVerification:
    hit: bool
    reason: str = ""
    confidence: float | None = None
    revised_target_description: str | None = None


@dataclass(frozen=True)
class PixelDiffResult:
    change_ratio: float
    possibly_no_effect: bool


@dataclass(frozen=True)
class VisionStepRecord:
    index: int
    before_screenshot_ref: str
    screen_summary: str
    visible_texts: list[Any]
    completion_check: CompletionCheck
    planned_action: VisionAction | None = None
    grounding: GroundingResult | None = None
    crosshair_checks: list[CrosshairVerification] = field(default_factory=list)
    execution: ExecutionResult | None = None
    after_screenshot_ref: str | None = None
    pixel_diff: PixelDiffResult | None = None
    failure_reason: str | None = None


@dataclass(frozen=True)
class VisionTaskRequest:
    task: str
    max_steps: int = 30


@dataclass(frozen=True)
class VisionTaskResult:
    status: TaskStatus
    reason: str
    steps: list[VisionStepRecord] = field(default_factory=list)
    final_screenshot_ref: str | None = None
    metrics: dict[str, Any] = field(default_factory=dict)
    failure_diagnostics: dict[str, Any] = field(default_factory=dict)


class Observer(Protocol):
    def capture(self) -> Screenshot:
        """Return a screenshot frame."""


class VisionModel(Protocol):
    def check_completion(
        self,
        request: VisionTaskRequest,
        screenshot: Screenshot,
        history: Sequence[VisionStepRecord],
    ) -> CompletionCheck | Mapping[str, Any]:
        """Decide whether the task is complete from the current screenshot."""

    def plan_action(
        self,
        request: VisionTaskRequest,
        screenshot: Screenshot,
        history: Sequence[VisionStepRecord],
    ) -> VisionAction | Mapping[str, Any] | None:
        """Return exactly one next action, without coordinates."""


class Grounder(Protocol):
    def ground(
        self, screenshot: Screenshot, target_description: str
    ) -> GroundingResult | Point | Mapping[str, Any] | None:
        """Resolve a natural-language visual target to a screenshot-space point."""


def run_vision_task(
    request: VisionTaskRequest | Mapping[str, Any] | str,
    vlm: VisionModel,
    observer: Observer,
    grounder: Grounder,
    executor: GuiExecutor,
) -> VisionTaskResult:
    """Run the VisionTask MVP loop with fakeable dependencies."""

    task_request = _coerce_request(request)
    steps: list[VisionStepRecord] = []
    consecutive_grounding_failures = 0
    consecutive_no_effect = 0
    final_screenshot: Screenshot | None = None

    for index in range(task_request.max_steps):
        before = wait_until_stable(observer)
        final_screenshot = before
        completion = _coerce_completion(
            vlm.check_completion(task_request, before, steps)
        )
        screen_summary = _optional_vlm_call(
            vlm, "summarize_screen", task_request, before, steps, default=""
        )
        visible_texts = _optional_vlm_call(
            vlm, "extract_visible_texts", task_request, before, steps, default=[]
        )

        if completion.done:
            steps.append(
                VisionStepRecord(
                    index=index,
                    before_screenshot_ref=before.ref,
                    screen_summary=str(screen_summary),
                    visible_texts=list(visible_texts or []),
                    completion_check=completion,
                )
            )
            return _result(
                "done",
                completion.reason or "VLM reported task complete.",
                steps,
                final_screenshot,
                consecutive_grounding_failures,
                consecutive_no_effect,
            )

        action = _coerce_action(vlm.plan_action(task_request, before, steps))
        if action is None:
            steps.append(
                VisionStepRecord(
                    index=index,
                    before_screenshot_ref=before.ref,
                    screen_summary=str(screen_summary),
                    visible_texts=list(visible_texts or []),
                    completion_check=completion,
                    failure_reason="planner returned no action",
                )
            )
            return _result(
                "planner_failed",
                "Planner returned no action.",
                steps,
                final_screenshot,
                consecutive_grounding_failures,
                consecutive_no_effect,
            )

        grounding: GroundingResult | None = None
        crosshair_checks: list[CrosshairVerification] = []
        if action.kind == "click":
            if not action.target_description:
                grounding = GroundingResult(
                    point=None,
                    ok=False,
                    message="click action missing target_description",
                )
            else:
                grounding, crosshair_checks = _ground_click_action(
                    action=action,
                    screenshot=before,
                    grounder=grounder,
                    vlm=vlm,
                    request=task_request,
                    history=steps,
                )
            if not grounding.ok or grounding.point is None:
                consecutive_grounding_failures += 1
                steps.append(
                    VisionStepRecord(
                        index=index,
                        before_screenshot_ref=before.ref,
                        screen_summary=str(screen_summary),
                        visible_texts=list(visible_texts or []),
                        completion_check=completion,
                        planned_action=action,
                        grounding=grounding,
                        crosshair_checks=crosshair_checks,
                        failure_reason=grounding.message or "grounding failed",
                    )
                )
                if consecutive_grounding_failures >= 3:
                    return _result(
                        "grounding_failed",
                        "Grounding failed 3 consecutive times.",
                        steps,
                        final_screenshot,
                        consecutive_grounding_failures,
                        consecutive_no_effect,
                    )
                continue

        execution = _execute_action(executor, action, grounding)
        if not execution.ok:
            steps.append(
                VisionStepRecord(
                    index=index,
                    before_screenshot_ref=before.ref,
                    screen_summary=str(screen_summary),
                    visible_texts=list(visible_texts or []),
                    completion_check=completion,
                    planned_action=action,
                    grounding=grounding,
                    execution=execution,
                    failure_reason=execution.message or "execution failed",
                )
            )
            return _result(
                "execution_failed",
                execution.message or "Executor failed.",
                steps,
                final_screenshot,
                consecutive_grounding_failures,
                consecutive_no_effect,
            )

        after = wait_until_stable(observer)
        final_screenshot = after
        diff = pixel_diff(before, after)
        consecutive_no_effect = consecutive_no_effect + 1 if diff.possibly_no_effect else 0
        consecutive_grounding_failures = 0

        steps.append(
            VisionStepRecord(
                index=index,
                before_screenshot_ref=before.ref,
                screen_summary=str(screen_summary),
                visible_texts=list(visible_texts or []),
                completion_check=completion,
                planned_action=action,
                grounding=grounding,
                crosshair_checks=crosshair_checks,
                execution=execution,
                after_screenshot_ref=after.ref,
                pixel_diff=diff,
            )
        )
        if consecutive_no_effect >= 5:
            return _result(
                "no_effect",
                "No visible pixel effect for 5 consecutive executed steps.",
                steps,
                final_screenshot,
                consecutive_grounding_failures,
                consecutive_no_effect,
            )

    return _result(
        "max_steps",
        f"Reached max_steps={task_request.max_steps}.",
        steps,
        final_screenshot,
        consecutive_grounding_failures,
        consecutive_no_effect,
    )


def wait_until_stable(
    observer: Observer,
    *,
    interval_seconds: float = 0.0,
    max_wait_seconds: float = 8.0,
    stable_threshold: float = 0.01,
) -> Screenshot:
    """Capture until two consecutive frames differ by less than 1%."""

    first = observer.capture()
    previous = first
    deadline = time.monotonic() + max_wait_seconds
    while True:
        if interval_seconds > 0:
            if time.monotonic() >= deadline:
                return previous
            time.sleep(interval_seconds)
        current = observer.capture()
        if pixel_diff(previous, current).change_ratio <= stable_threshold:
            return current
        previous = current
        if interval_seconds <= 0:
            return current


def pixel_diff(
    before: Screenshot,
    after: Screenshot,
    *,
    no_effect_threshold: float = 0.005,
) -> PixelDiffResult:
    """Return a byte/value-level change ratio for two screenshots."""

    left = _pixel_values(before.pixels)
    right = _pixel_values(after.pixels)
    if not left and not right:
        ratio = 0.0 if before.ref == after.ref else 1.0
    elif len(left) != len(right):
        ratio = 1.0
    else:
        ratio = sum(1 for a, b in zip(left, right) if a != b) / max(len(left), 1)
    return PixelDiffResult(
        change_ratio=ratio,
        possibly_no_effect=ratio < no_effect_threshold,
    )


def compact_vision_result_for_handoff(result: VisionTaskResult) -> dict[str, Any]:
    """Return a lightweight summary safe to send back to an agent context."""

    return {
        "status": result.status,
        "reason": result.reason,
        "finalScreenshotRef": result.final_screenshot_ref,
        "metrics": dict(result.metrics),
        "failureDiagnostics": dict(result.failure_diagnostics),
        "steps": [
            {
                "index": step.index,
                "beforeScreenshotRef": step.before_screenshot_ref,
                "afterScreenshotRef": step.after_screenshot_ref,
                "screenSummary": step.screen_summary,
                "visibleTexts": step.visible_texts,
                "completionCheck": {
                    "done": step.completion_check.done,
                    "reason": step.completion_check.reason,
                    "confidence": step.completion_check.confidence,
                },
                "plannedAction": _compact_action(step.planned_action),
                "grounding": _compact_grounding(step.grounding),
                "crosshairChecks": [
                    {
                        "hit": check.hit,
                        "reason": check.reason,
                        "confidence": check.confidence,
                        "revisedTargetDescription": check.revised_target_description,
                    }
                    for check in step.crosshair_checks
                ],
                "execution": {
                    "ok": step.execution.ok,
                    "message": step.execution.message,
                }
                if step.execution
                else None,
                "pixelDiff": {
                    "changeRatio": step.pixel_diff.change_ratio,
                    "possiblyNoEffect": step.pixel_diff.possibly_no_effect,
                }
                if step.pixel_diff
                else None,
                "failureReason": step.failure_reason,
            }
            for step in result.steps
        ],
    }


def _execute_action(
    executor: GuiExecutor,
    action: VisionAction,
    grounding: GroundingResult | None,
) -> ExecutionResult:
    if action.kind == "click":
        if grounding is None or grounding.point is None:
            return ExecutionResult(False, "click action has no grounded point")
        return _coerce_execution_result(executor.click(grounding.point))
    if action.kind == "type_text":
        return _coerce_execution_result(executor.type_text(action.text or ""))
    if action.kind == "press_key":
        if not action.key:
            return ExecutionResult(False, "press_key action missing key")
        return _coerce_execution_result(executor.press_key(action.key))
    if action.kind == "scroll":
        if not action.direction:
            return ExecutionResult(False, "scroll action missing direction")
        return _coerce_execution_result(executor.scroll(action.direction, action.amount))
    return ExecutionResult(False, f"unsupported action kind: {action.kind}")


def _compact_action(action: VisionAction | None) -> dict[str, Any] | None:
    if action is None:
        return None
    return {
        "kind": action.kind,
        "targetDescription": action.target_description,
        "text": action.text,
        "key": action.key,
        "direction": action.direction,
        "amount": action.amount,
    }


def _compact_grounding(grounding: GroundingResult | None) -> dict[str, Any] | None:
    if grounding is None:
        return None
    return {
        "ok": grounding.ok,
        "message": grounding.message,
        "point": {"x": grounding.point.x, "y": grounding.point.y}
        if grounding.point
        else None,
    }


def _ground_click_action(
    *,
    action: VisionAction,
    screenshot: Screenshot,
    grounder: Grounder,
    vlm: VisionModel,
    request: VisionTaskRequest,
    history: Sequence[VisionStepRecord],
) -> tuple[GroundingResult, list[CrosshairVerification]]:
    """Ground a click target and optionally retry once after crosshair review."""

    target_description = action.target_description or ""
    crosshair_checks: list[CrosshairVerification] = []
    for attempt_index in range(2):
        grounding = _coerce_grounding(
            grounder.ground(screenshot, target_description), screenshot
        )
        if not grounding.ok or grounding.point is None:
            return grounding, crosshair_checks

        crosshair_check = _optional_crosshair_verification(
            vlm,
            request=request,
            screenshot=screenshot,
            target_description=target_description,
            grounding=grounding,
            history=history,
        )
        if crosshair_check is None:
            return grounding, crosshair_checks
        crosshair_checks.append(crosshair_check)
        if crosshair_check.hit:
            return grounding, crosshair_checks
        if attempt_index == 0 and crosshair_check.revised_target_description:
            target_description = crosshair_check.revised_target_description
            continue
        return (
            GroundingResult(
                point=None,
                ok=False,
                message=crosshair_check.reason or "crosshair verification rejected grounding",
            ),
            crosshair_checks,
        )

    return (
        GroundingResult(
            point=None,
            ok=False,
            message="crosshair verification retry exhausted",
        ),
        crosshair_checks,
    )


def _coerce_request(request: VisionTaskRequest | Mapping[str, Any] | str) -> VisionTaskRequest:
    if isinstance(request, VisionTaskRequest):
        return request if request.max_steps > 0 else VisionTaskRequest(request.task)
    if isinstance(request, str):
        return VisionTaskRequest(task=request)
    return VisionTaskRequest(
        task=str(request["task"]),
        max_steps=int(request.get("max_steps", request.get("maxSteps", 30))),
    )


def _coerce_completion(value: CompletionCheck | Mapping[str, Any]) -> CompletionCheck:
    if isinstance(value, CompletionCheck):
        return value
    return CompletionCheck(
        done=bool(value.get("done", False)),
        reason=str(value.get("reason", "")),
        confidence=value.get("confidence"),
    )


def _coerce_crosshair_verification(
    value: CrosshairVerification | Mapping[str, Any],
) -> CrosshairVerification:
    if isinstance(value, CrosshairVerification):
        return value
    return CrosshairVerification(
        hit=bool(value.get("hit", value.get("ok", False))),
        reason=str(value.get("reason", "")),
        confidence=value.get("confidence"),
        revised_target_description=value.get("revised_target_description")
        or value.get("revisedTargetDescription"),
    )


def _coerce_action(value: VisionAction | Mapping[str, Any] | None) -> VisionAction | None:
    if value is None:
        return None
    if isinstance(value, VisionAction):
        return value
    kind = value.get("kind", value.get("type"))
    if kind == "typeText":
        kind = "type_text"
    if kind == "pressKey":
        kind = "press_key"
    if kind not in {"click", "type_text", "press_key", "scroll"}:
        return None
    return VisionAction(
        kind=kind,
        target_description=value.get("target_description") or value.get("targetDescription"),
        text=value.get("text"),
        key=value.get("key"),
        direction=value.get("direction"),
        amount=float(value.get("amount", 1.0)),
    )


def _coerce_grounding(
    value: GroundingResult | Point | Mapping[str, Any] | None,
    screenshot: Screenshot,
) -> GroundingResult:
    if value is None:
        return GroundingResult(point=None, ok=False, message="grounder returned no result")
    if isinstance(value, GroundingResult):
        return _normalize_grounding(value, screenshot)
    if isinstance(value, Point):
        return GroundingResult(point=value)
    if "point" in value:
        point = value["point"]
    elif "coordinates" in value:
        point = value["coordinates"]
    else:
        point = None
    if point is None:
        return GroundingResult(
            point=None,
            ok=bool(value.get("ok", False)),
            message=value.get("message", "grounder returned no point"),
        )
    parsed_point = point if isinstance(point, Point) else Point(float(point[0]), float(point[1]))
    return _normalize_grounding(
        GroundingResult(
            point=parsed_point,
            ok=bool(value.get("ok", True)),
            message=value.get("message"),
            normalized=bool(value.get("normalized", False)),
        ),
        screenshot,
    )


def _normalize_grounding(grounding: GroundingResult, screenshot: Screenshot) -> GroundingResult:
    if not grounding.normalized or grounding.point is None:
        return grounding
    return GroundingResult(
        point=Point(grounding.point.x * screenshot.width, grounding.point.y * screenshot.height),
        ok=grounding.ok,
        message=grounding.message,
        normalized=False,
    )


def _coerce_execution_result(value: ExecutionResult | Mapping[str, Any] | None) -> ExecutionResult:
    if value is None:
        return ExecutionResult()
    if isinstance(value, ExecutionResult):
        return value
    return ExecutionResult(ok=bool(value.get("ok", True)), message=value.get("message"))


def _optional_vlm_call(
    vlm: VisionModel,
    method_name: str,
    request: VisionTaskRequest,
    screenshot: Screenshot,
    history: Sequence[VisionStepRecord],
    *,
    default: Any,
) -> Any:
    method = getattr(vlm, method_name, None)
    if method is None:
        return default
    return method(request, screenshot, history)


def _optional_crosshair_verification(
    vlm: VisionModel,
    *,
    request: VisionTaskRequest,
    screenshot: Screenshot,
    target_description: str,
    grounding: GroundingResult,
    history: Sequence[VisionStepRecord],
) -> CrosshairVerification | None:
    method = getattr(vlm, "verify_crosshair", None) or getattr(
        vlm, "verify_grounding_crosshair", None
    )
    if method is None:
        return None
    value = method(request, screenshot, target_description, grounding, history)
    if value is None:
        return None
    return _coerce_crosshair_verification(value)


def _pixel_values(pixels: bytes | str | Sequence[int] | None) -> list[int] | str:
    if pixels is None:
        return []
    if isinstance(pixels, bytes):
        return list(pixels)
    if isinstance(pixels, str):
        return pixels
    return list(pixels)


def _result(
    status: TaskStatus,
    reason: str,
    steps: list[VisionStepRecord],
    final_screenshot: Screenshot | None,
    grounding_failures: int,
    no_effect_steps: int,
) -> VisionTaskResult:
    failure_diagnostics = {}
    if status != "done":
        failure_diagnostics = {
            "status": status,
            "reason": reason,
            "recentGroundingFailures": _recent_grounding_failures(steps),
            "lastScreenshotRef": final_screenshot.ref if final_screenshot else None,
        }
    return VisionTaskResult(
        status=status,
        reason=reason,
        steps=steps,
        final_screenshot_ref=final_screenshot.ref if final_screenshot else None,
        metrics={
            "stepCount": len(steps),
            "consecutiveGroundingFailures": grounding_failures,
            "consecutiveNoEffectSteps": no_effect_steps,
        },
        failure_diagnostics=failure_diagnostics,
    )


def _recent_grounding_failures(steps: Sequence[VisionStepRecord]) -> list[dict[str, Any]]:
    failures: list[dict[str, Any]] = []
    for step in steps[-5:]:
        if step.grounding is None or step.grounding.ok:
            continue
        failures.append(
            {
                "stepIndex": step.index,
                "screenshotRef": step.before_screenshot_ref,
                "targetDescription": step.planned_action.target_description
                if step.planned_action
                else None,
                "message": step.grounding.message,
                "crosshairChecks": [
                    {
                        "hit": check.hit,
                        "reason": check.reason,
                        "confidence": check.confidence,
                        "revisedTargetDescription": check.revised_target_description,
                    }
                    for check in step.crosshair_checks
                ],
            }
        )
    return failures
