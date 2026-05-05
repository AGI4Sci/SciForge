"""Generic vision-trace contract validation for Computer Use.

Scenario-specific acceptance stays outside vision-sense. This module validates
the reusable visual Computer Use trace contract: file-ref-only screenshots,
window-local coordinates, generic input, scheduler metadata, and verifier
feedback evidence.
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Mapping


ALLOWED_ACTION_TYPES = {
    "open_app",
    "click",
    "double_click",
    "drag",
    "type_text",
    "press_key",
    "hotkey",
    "scroll",
    "wait",
}
FORBIDDEN_KEY_PATTERN = re.compile(r"dom|selector|accessibility|aria|xpath|css|appApi|privateShortcut", re.IGNORECASE)
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


@dataclass(frozen=True)
class TraceContractMetrics:
    stepCount: int = 0
    actionCount: int = 0
    nonWaitActionCount: int = 0
    effectiveNonWaitActionCount: int = 0
    screenshotCount: int = 0
    blockedCount: int = 0
    failedCount: int = 0


@dataclass(frozen=True)
class TraceContractValidation:
    ok: bool
    checkedScreenshotRefs: list[str]
    issues: list[str]
    metrics: TraceContractMetrics = field(default_factory=TraceContractMetrics)


def validate_computer_use_trace_contract(
    trace: Any,
    *,
    raw_text: str = "",
    trace_path: str = "",
    workspace_path: str = "",
) -> TraceContractValidation:
    issues: list[str] = []
    checked_screenshot_refs: list[str] = []
    trace_dir = str(Path(trace_path).parent) if trace_path else "."
    if re.search(r"data:image|;base64,", raw_text, re.IGNORECASE):
        issues.append("trace must not include inline image dataUrl/base64 payloads")
    if not isinstance(trace, Mapping):
        return TraceContractValidation(False, [], ["trace must be a JSON object"])

    if trace.get("schemaVersion") != "sciforge.vision-trace.v1":
        issues.append("trace.schemaVersion must be sciforge.vision-trace.v1")
    config = _mapping(trace.get("config"))
    real_gui_trace = config.get("dryRun") is False
    trace_window_target = _trace_window_target(trace)
    if not trace_window_target:
        issues.append("trace.windowTarget must record selected target window metadata")
    else:
        target_id = _first_text(
            trace_window_target.get("windowId"),
            trace_window_target.get("id"),
            trace_window_target.get("handle"),
            trace_window_target.get("title"),
            trace_window_target.get("appName"),
            trace_window_target.get("bundleId"),
        )
        if not target_id:
            issues.append("trace.windowTarget missing stable window identity")
        if not _has_window_bounds(trace_window_target):
            issues.append("trace.windowTarget missing window bounds")
        coordinate_space = _first_text(trace_window_target.get("coordinateSpace"), trace_window_target.get("coordinates"))
        if not coordinate_space or not re.search(r"window(?:-local)?", coordinate_space, re.IGNORECASE):
            issues.append("trace.windowTarget.coordinateSpace must be window-local")

    trace_scheduler = _mapping(trace.get("scheduler"))
    if not trace_scheduler:
        issues.append("trace.scheduler must record serialized GUI action scheduling metadata")
    else:
        scheduler_mode = _first_text(trace_scheduler.get("mode"), trace_scheduler.get("policy"), trace_scheduler.get("queue"))
        if not scheduler_mode or not re.search(r"serial|ordered|single|window", scheduler_mode, re.IGNORECASE):
            issues.append("trace.scheduler must declare serialized/ordered window action scheduling")
        if not _first_text(trace_scheduler.get("lockId"), trace_scheduler.get("schedulerLockId")):
            issues.append("trace.scheduler missing scheduler lock id")
        lock_scope = _first_text(trace_scheduler.get("lockScope"), trace_scheduler.get("scope"))
        if not lock_scope or not re.search(r"window|display|shared-system-input", lock_scope, re.IGNORECASE):
            issues.append("trace.scheduler.lockScope must bind actions to a target window, display fallback, or shared system input lock")
        focus_policy = _first_text(trace_scheduler.get("focusPolicy"), trace_scheduler.get("focus"))
        if not focus_policy or not re.search(r"focus|fail-closed|best-effort", focus_policy, re.IGNORECASE):
            issues.append("trace.scheduler.focusPolicy must describe focus/isolation behavior")
        if not _first_text(trace_scheduler.get("interferenceRisk"), trace_scheduler.get("risk")):
            issues.append("trace.scheduler.interferenceRisk must record user/device interference risk")
        executor_lock = _mapping(trace_scheduler.get("executorLock"))
        if real_gui_trace:
            if executor_lock.get("provider") != "filesystem-lease":
                issues.append("trace.scheduler.executorLock must declare filesystem-lease for real GUI execution")
            if not _positive_number(executor_lock.get("timeoutMs")):
                issues.append("trace.scheduler.executorLock.timeoutMs must be positive for real GUI execution")
            if not _positive_number(executor_lock.get("staleLockMs")):
                issues.append("trace.scheduler.executorLock.staleLockMs must be positive for real GUI execution")

    generic = _mapping(trace.get("genericComputerUse"))
    shortcuts = generic.get("appSpecificShortcuts") if isinstance(generic.get("appSpecificShortcuts"), list) else None
    if shortcuts is None or len(shortcuts) != 0:
        issues.append("genericComputerUse.appSpecificShortcuts must be []")
    input_channel = _first_text(generic.get("inputChannel"), generic.get("inputChannelMode"), trace.get("inputChannel"))
    if not input_channel or not re.search(r"generic|mouse|keyboard|desktop", input_channel, re.IGNORECASE):
        issues.append("genericComputerUse.inputChannel must declare generic mouse/keyboard input")
    input_contract = _mapping(generic.get("inputChannelContract"))
    user_device_impact = _first_text(
        input_contract.get("userDeviceImpact"),
        input_contract.get("pointerMode"),
        input_contract.get("keyboardMode"),
    )
    if not user_device_impact or not re.search(r"none|fail-closed|focused-target|frontmost|system|virtual", user_device_impact, re.IGNORECASE):
        issues.append("genericComputerUse.inputChannelContract must declare user-device impact and isolation behavior")
    pointer_ownership = _first_text(input_contract.get("pointerKeyboardOwnership"), input_contract.get("pointerMode")) or ""
    if real_gui_trace and re.search(r"shared-system-pointer-keyboard|system-cursor-events", pointer_ownership, re.IGNORECASE):
        visual_pointer = _first_text(input_contract.get("visualPointer"), config.get("showVisualCursor"))
        if not visual_pointer or not re.search(r"sciforge|distinct|overlay|true", visual_pointer, re.IGNORECASE):
            issues.append("real shared-system Computer Use traces must declare a distinct SciForge visual pointer overlay")
    if input_contract.get("highRiskConfirmationRequired") is not True:
        issues.append("genericComputerUse.inputChannelContract.highRiskConfirmationRequired must be true")
    action_schema = {str(item) for item in generic.get("actionSchema", []) if isinstance(generic.get("actionSchema"), list)}
    for action_type in sorted(ALLOWED_ACTION_TYPES):
        if action_type not in action_schema:
            issues.append(f"genericComputerUse.actionSchema missing {action_type}")
    coordinate_contract = _mapping(generic.get("coordinateContract"))
    local_frame = _first_text(
        coordinate_contract.get("localCoordinateFrame"),
        coordinate_contract.get("grounderOutput"),
        coordinate_contract.get("executorInput"),
    )
    if not local_frame or not re.search(r"window|target-window", local_frame, re.IGNORECASE):
        issues.append("genericComputerUse.coordinateContract must declare window-local Grounder/executor coordinates")
    verifier_contract = _mapping(generic.get("verifierContract"))
    verifier_scope = _first_text(
        verifier_contract.get("screenshotScope"),
        verifier_contract.get("beforeAfterWindowConsistency"),
        verifier_contract.get("completionEvidence"),
    )
    if not verifier_scope or not re.search(r"window", verifier_scope, re.IGNORECASE):
        issues.append("genericComputerUse.verifierContract must require window-based before/after verification")

    lifecycle = _mapping(trace.get("windowLifecycle"))
    lifecycle_policy = _first_text(lifecycle.get("recoveryPolicy"), lifecycle.get("status"))
    if not lifecycle_policy or not re.search(r"window|recover|stable|migrated", lifecycle_policy, re.IGNORECASE):
        issues.append("trace.windowLifecycle must record window lifecycle/recovery evidence")

    image_memory = _mapping(trace.get("imageMemory"))
    if image_memory.get("policy") != "file-ref-only":
        issues.append("imageMemory.policy must be file-ref-only")
    screenshot_refs = [item for item in image_memory.get("refs", []) if isinstance(item, Mapping)] if isinstance(image_memory.get("refs"), list) else []
    if not screenshot_refs:
        issues.append("imageMemory.refs must include screenshot refs")
    for ref in screenshot_refs:
        ref_path = str(ref.get("path") or "")
        if not ref_path:
            issues.append("screenshot ref missing path")
            continue
        checked_screenshot_refs.append(ref_path)
        issues.extend(_validate_png_ref(_resolve_trace_ref_path(ref_path, workspace_path, trace_dir), ref_path))
        if not isinstance(ref.get("sha256"), str) or len(str(ref.get("sha256"))) != 64:
            issues.append(f"screenshot ref {ref_path} missing sha256")
        if not isinstance(ref.get("width"), (int, float)) or not isinstance(ref.get("height"), (int, float)):
            issues.append(f"screenshot ref {ref_path} missing width/height")
        if not _screenshot_ref_has_window_metadata(ref):
            issues.append(f"screenshot ref {ref_path} missing window screenshot metadata")

    steps = [item for item in trace.get("steps", []) if isinstance(item, Mapping)] if isinstance(trace.get("steps"), list) else []
    if not steps:
        issues.append("trace.steps must include step records")
    action_count = 0
    non_wait_action_count = 0
    effective_non_wait_action_count = 0
    blocked_count = 0
    failed_count = 0
    consecutive_no_effect = 0
    max_consecutive_no_effect = 0
    planner_only_done = False
    for index, step in enumerate(steps):
        status = str(step.get("status") or "")
        if status == "blocked":
            blocked_count += 1
        if status == "failed":
            failed_count += 1
        if step.get("kind") == "gui-execution":
            action_count += 1
            action = _mapping(step.get("plannedAction"))
            action_type = str(action.get("type") or "")
            if action_type not in ALLOWED_ACTION_TYPES:
                issues.append(f"steps[{index}].plannedAction.type is not a generic action")
            non_wait = bool(action_type and action_type != "wait")
            if non_wait:
                non_wait_action_count += 1
            if _has_forbidden_private_fields(action):
                issues.append(f"steps[{index}].plannedAction contains DOM/accessibility/private-app fields")
            if not _non_empty_list(step.get("beforeScreenshotRefs")):
                issues.append(f"steps[{index}] missing beforeScreenshotRefs")
            if not _non_empty_list(step.get("afterScreenshotRefs")):
                issues.append(f"steps[{index}] missing afterScreenshotRefs")
            for ref in [*_screenshot_step_refs(step.get("beforeScreenshotRefs")), *_screenshot_step_refs(step.get("afterScreenshotRefs"))]:
                if not _screenshot_ref_has_window_metadata(ref):
                    issues.append(f"steps[{index}] screenshot ref missing window metadata")
            if not isinstance(step.get("execution"), Mapping):
                issues.append(f"steps[{index}] missing execution record")
            elif not _has_input_channel_metadata(_mapping(step.get("execution")), action):
                issues.append(f"steps[{index}] execution missing input-channel metadata")
            verifier = _mapping(step.get("verifier"))
            if not verifier:
                issues.append(f"steps[{index}] missing verifier record")
            elif not _has_window_verifier_metadata(verifier):
                issues.append(f"steps[{index}] verifier missing window consistency metadata")
            if non_wait and status == "done":
                no_effect = real_gui_trace and _verifier_reports_no_visible_effect(verifier)
                if no_effect:
                    consecutive_no_effect += 1
                    max_consecutive_no_effect = max(max_consecutive_no_effect, consecutive_no_effect)
                else:
                    consecutive_no_effect = 0
                    effective_non_wait_action_count += 1
            if action_type in {"click", "double_click", "drag"} and status == "done" and not isinstance(step.get("grounding"), Mapping):
                issues.append(f"steps[{index}] {action_type} action missing grounding record")
            if action_type in {"click", "double_click", "drag"} and status == "done":
                if not _has_window_local_coordinates(action) and not _has_window_local_coordinates(step.get("localCoordinate")):
                    issues.append(f"steps[{index}].plannedAction missing window-local coordinates")
                grounding = _mapping(step.get("grounding"))
                if grounding and not _has_window_local_coordinates(grounding) and not _has_window_local_coordinates(step.get("localCoordinate")):
                    issues.append(f"steps[{index}].grounding missing window-local coordinates")
            if not _has_step_window_target(step, trace_window_target):
                issues.append(f"steps[{index}] missing windowTarget metadata")
            if not _has_scheduler_metadata(step, trace_scheduler):
                issues.append(f"steps[{index}] missing scheduler metadata")
            if real_gui_trace and status in {"done", "failed"}:
                lease = _mapping(_mapping(step.get("scheduler")).get("executorLease"))
                if lease.get("mode") != "real-gui-executor-lock":
                    issues.append(f"steps[{index}] real GUI execution missing executor scheduler lease")
                if not _first_text(lease.get("lockId")):
                    issues.append(f"steps[{index}] real GUI executor lease missing lock id")
                if lease.get("status") == "timeout":
                    if not isinstance(lease.get("waitMs"), (int, float)):
                        issues.append(f"steps[{index}] real GUI executor lease timeout missing wait evidence")
                elif not _first_text(lease.get("acquiredAt")) or not _first_text(lease.get("releasedAt")):
                    issues.append(f"steps[{index}] real GUI executor lease missing acquire/release evidence")
        if step.get("kind") == "planning" and not isinstance(step.get("execution"), Mapping):
            issues.append(f"steps[{index}] planning step missing planner execution record")
        if step.get("kind") == "planning" and step.get("status") == "done" and _planner_step_reported_done_without_actions(step):
            planner_only_done = True

    request = _mapping(trace.get("request"))
    request_text = str(request.get("text") or "")
    from .computer_use_policy import is_planner_only_evidence_task

    allows_planner_only = planner_only_done and is_planner_only_evidence_task(request_text)
    if action_count == 0 and not allows_planner_only:
        issues.append("trace must include at least one gui-execution step for CU-LONG validation")
    if non_wait_action_count == 0 and not allows_planner_only:
        issues.append("trace must include at least one non-wait generic GUI action")
    if real_gui_trace and non_wait_action_count > 0 and effective_non_wait_action_count == 0 and not allows_planner_only:
        issues.append("real GUI trace must include at least one visibly effective non-wait action")
    if real_gui_trace and max_consecutive_no_effect >= 3 and not allows_planner_only:
        issues.append(f"real GUI trace has {max_consecutive_no_effect} consecutive non-wait actions without visible effect")
    serialized_keys = [key.lower() for key in _collect_keys(trace)]
    for forbidden in ["domselector", "selector", "accessibilitylabel", "aria", "xpath", "cssselector", "appapi", "privateshortcut"]:
        if forbidden.lower() in serialized_keys:
            issues.append(f"trace contains forbidden private field key: {forbidden}")

    return TraceContractValidation(
        ok=not issues,
        checkedScreenshotRefs=checked_screenshot_refs,
        issues=issues,
        metrics=TraceContractMetrics(
            stepCount=len(steps),
            actionCount=action_count,
            nonWaitActionCount=non_wait_action_count,
            effectiveNonWaitActionCount=effective_non_wait_action_count,
            screenshotCount=len(screenshot_refs),
            blockedCount=blocked_count,
            failedCount=failed_count,
        ),
    )


def validate_computer_use_trace_contract_from_request(request: Mapping[str, Any]) -> TraceContractValidation:
    trace_path = str(request.get("tracePath") or "")
    raw_text = str(request.get("rawText") or "")
    if not raw_text and trace_path:
        raw_text = Path(trace_path).read_text(encoding="utf-8")
    trace = json.loads(raw_text) if raw_text else request.get("trace")
    return validate_computer_use_trace_contract(
        trace,
        raw_text=raw_text,
        trace_path=trace_path,
        workspace_path=str(request.get("workspacePath") or ""),
    )


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _first_text(*values: Any) -> str | None:
    for value in values:
        if value is None:
            continue
        text = str(value)
        if text:
            return text
    return None


def _positive_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and value > 0


def _trace_window_target(trace: Mapping[str, Any]) -> Mapping[str, Any]:
    config = _mapping(trace.get("config"))
    for candidate in (trace.get("windowTarget"), trace.get("windowTargeting"), config.get("windowTarget")):
        if isinstance(candidate, Mapping):
            return candidate
    return {}


def _has_window_bounds(value: Mapping[str, Any]) -> bool:
    bounds = _mapping(value.get("bounds")) or _mapping(value.get("windowBounds")) or value
    return all(isinstance(bounds.get(key), (int, float)) for key in ("x", "y", "width", "height")) or all(
        isinstance(bounds.get(key), (int, float)) for key in ("left", "top", "right", "bottom")
    )


def _validate_png_ref(path: Path, label: str) -> list[str]:
    issues: list[str] = []
    try:
        data = path.read_bytes()
        if not path.is_file():
            issues.append(f"screenshot ref {label} is not a file")
        if len(data) < 24 or not data.startswith(PNG_SIGNATURE):
            issues.append(f"screenshot ref {label} is not a readable PNG")
    except Exception as exc:
        issues.append(f"screenshot ref {label} missing: {exc}")
    return issues


def _resolve_trace_ref_path(ref_path: str, workspace_path: str, trace_dir: str) -> Path:
    path = Path(ref_path)
    if path.is_absolute():
        return path
    if workspace_path and ref_path.startswith(".sciforge/"):
        return Path(workspace_path) / ref_path
    return Path(trace_dir) / ref_path


def _screenshot_ref_has_window_metadata(value: Any) -> bool:
    if not isinstance(value, Mapping):
        return False
    nested = _mapping(value.get("windowTarget"))
    if nested:
        return bool(_first_text(nested.get("windowId"), nested.get("windowTitle"), nested.get("title"), nested.get("appName"), nested.get("bundleId"))) and _has_window_bounds(nested)
    scope = _first_text(value.get("scope"), value.get("captureScope"), value.get("screenshotScope"), value.get("kind"), value.get("type"))
    has_window_scope = bool(scope and re.search(r"window", scope, re.IGNORECASE))
    has_window_id = bool(_first_text(value.get("windowId"), value.get("windowTitle"), value.get("appName"), value.get("bundleId")))
    return has_window_scope and has_window_id and _has_window_bounds(value)


def _non_empty_list(value: Any) -> bool:
    return isinstance(value, list) and len(value) > 0


def _screenshot_step_refs(value: Any) -> list[Mapping[str, Any]]:
    return [item for item in value if isinstance(item, Mapping)] if isinstance(value, list) else []


def _has_window_local_coordinates(value: Any) -> bool:
    if not isinstance(value, Mapping):
        return False
    frame = _first_text(value.get("coordinateSpace"), value.get("coordinates"), value.get("frame"))
    direct = (isinstance(value.get("localX"), (int, float)) and isinstance(value.get("localY"), (int, float))) or (
        isinstance(value.get("windowX"), (int, float)) and isinstance(value.get("windowY"), (int, float))
    )
    point = _mapping(value.get("point")) or _mapping(value.get("start"))
    nested = bool(point) and (
        (isinstance(point.get("localX"), (int, float)) and isinstance(point.get("localY"), (int, float)))
        or (isinstance(point.get("x"), (int, float)) and isinstance(point.get("y"), (int, float)))
    )
    end = _mapping(value.get("end"))
    drag_end = not end or isinstance(end.get("x"), (int, float)) or isinstance(end.get("localX"), (int, float)) or isinstance(end.get("windowX"), (int, float))
    return bool(frame and re.search(r"window(?:-local)?", frame, re.IGNORECASE) and (direct or nested) and drag_end)


def _has_input_channel_metadata(execution: Mapping[str, Any], action: Mapping[str, Any]) -> bool:
    input_channel = _first_text(execution.get("inputChannel"), execution.get("channel"), action.get("inputChannel"), action.get("channel"))
    return bool(input_channel and re.search(r"generic|mouse|keyboard|desktop", input_channel, re.IGNORECASE))


def _has_step_window_target(step: Mapping[str, Any], trace_window_target: Mapping[str, Any]) -> bool:
    target = _mapping(step.get("windowTarget")) or trace_window_target
    return bool(target and _first_text(target.get("windowId"), target.get("id"), target.get("handle"), target.get("title"), target.get("appName"), target.get("bundleId")) and _has_window_bounds(target))


def _has_scheduler_metadata(step: Mapping[str, Any], trace_scheduler: Mapping[str, Any]) -> bool:
    scheduler = _mapping(step.get("scheduler")) or trace_scheduler
    mode = _first_text(scheduler.get("mode"), scheduler.get("policy"), scheduler.get("queue"))
    lock_id = _first_text(scheduler.get("lockId"), scheduler.get("schedulerLockId"))
    focus_policy = _first_text(scheduler.get("focusPolicy"), scheduler.get("focus"))
    risk = _first_text(scheduler.get("interferenceRisk"), scheduler.get("risk"))
    return bool(mode and re.search(r"serial|ordered|single|window", mode, re.IGNORECASE) and lock_id and focus_policy and risk)


def _has_window_verifier_metadata(verifier: Mapping[str, Any]) -> bool:
    consistency = _mapping(verifier.get("windowConsistency")) or verifier
    status = _first_text(consistency.get("status"), consistency.get("scope"), consistency.get("requiredScope"))
    return bool(status and re.search(r"window|target|display", status, re.IGNORECASE))


def _verifier_reports_no_visible_effect(verifier: Mapping[str, Any]) -> bool:
    pixel = _mapping(verifier.get("pixelDiff"))
    if pixel.get("possiblyNoEffect") is True:
        return True
    pairs = [item for item in pixel.get("pairs", []) if isinstance(item, Mapping)] if isinstance(pixel.get("pairs"), list) else []
    return bool(pairs) and all(pair.get("possiblyNoEffect") is True for pair in pairs)


def _has_forbidden_private_fields(value: Any) -> bool:
    return any(FORBIDDEN_KEY_PATTERN.search(key) for key in _collect_keys(value))


def _collect_keys(value: Any) -> list[str]:
    if isinstance(value, list):
        return [key for child in value for key in _collect_keys(child)]
    if not isinstance(value, Mapping):
        return []
    keys: list[str] = []
    for key, child in value.items():
        keys.append(str(key))
        keys.extend(_collect_keys(child))
    return keys


def _planner_step_reported_done_without_actions(step: Mapping[str, Any]) -> bool:
    execution = _mapping(step.get("execution"))
    raw = _mapping(execution.get("rawResponse"))
    choices = [item for item in raw.get("choices", []) if isinstance(item, Mapping)] if isinstance(raw.get("choices"), list) else []
    for choice in choices:
        message = _mapping(choice.get("message"))
        content = str(message.get("content") or "")
        parsed = _extract_json_object(content)
        if isinstance(parsed, Mapping) and parsed.get("done") is True and isinstance(parsed.get("actions"), list) and not parsed.get("actions"):
            return True
    return False


def _extract_json_object(text: str) -> Any:
    try:
        return json.loads(text)
    except Exception:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except Exception:
                return None
    return None


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args:
        print("expected JSON request", file=sys.stderr)
        return 2
    request = json.loads(args[0])
    result = validate_computer_use_trace_contract_from_request(request)
    print(json.dumps({"ok": True, "result": asdict(result)}, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
