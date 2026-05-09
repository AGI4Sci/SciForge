"""Temporary multimodal memory blocks for vision-sense Computer Use.

This module stores no image bytes. It reads vision-trace JSON refs and emits a
compact, budgeted text block containing screenshot refs, focus refs, verifier
feedback, action counts, window metadata, and omission counts.
"""

from __future__ import annotations

import json
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Mapping


JsonMap = dict[str, Any]


@dataclass(frozen=True)
class VisionMemoryTraceInput:
    path: str
    ref: str | None = None
    label: str | None = None


@dataclass(frozen=True)
class VisionMemoryBlock:
    schemaVersion: str
    mode: str
    policy: str
    text: str
    traceCount: int
    screenshotRefCount: int
    focusRefCount: int
    omitted: JsonMap = field(default_factory=dict)


def build_visual_memory_block(
    traces: list[VisionMemoryTraceInput],
    *,
    mode: str = "cross-round-followup",
    max_screenshot_refs_per_trace: int = 5,
    max_focus_refs_per_trace: int = 4,
    max_verifier_feedback_per_trace: int = 5,
    char_budget: int = 6000,
) -> VisionMemoryBlock:
    """Build a file-ref-only temporary multimodal memory block."""

    lines = [
        "Vision temporary memory policy: file-ref-only; never inline image bytes, dataUrl, base64, DOM, or accessibility payloads.",
        f"Memory mode: {mode}.",
    ]
    screenshot_ref_count = 0
    focus_ref_count = 0
    omitted: JsonMap = {"screenshotRefs": 0, "focusRefs": 0, "verifierFeedback": 0, "truncatedChars": 0}

    for index, trace_input in enumerate(traces, start=1):
        trace_path = Path(trace_input.path)
        trace = _read_json(trace_path)
        label = trace_input.label or f"trace {index}"
        ref = trace_input.ref or str(trace_path)
        if not isinstance(trace, Mapping):
            lines.append(f"- {label}: trace={ref}; status=missing-or-invalid")
            continue
        steps = [step for step in trace.get("steps", []) if isinstance(step, Mapping)]
        action_steps = [step for step in steps if step.get("kind") == "gui-execution"]
        image_refs = [
            ref_item
            for ref_item in (trace.get("imageMemory") or {}).get("refs", [])
            if isinstance(ref_item, Mapping)
        ]
        focus_refs = [ref_item for ref_item in image_refs if ref_item.get("captureScope") == "focus-region"]
        screenshot_refs = [ref_item for ref_item in image_refs if ref_item.get("captureScope") != "focus-region"]
        lines.append(
            f"- {label}: trace={ref}; status={_trace_status(trace, steps)}; "
            f"actions={len(action_steps)}; nonWait={_non_wait_count(action_steps)}; "
            f"blocked={_status_count(steps, 'blocked')}; failed={_status_count(steps, 'failed')}"
        )
        window = _window_target_summary(_trace_window_target(trace), image_refs)
        if window:
            lines.append(f"  windowTarget: {window}")
        scheduler = _scheduler_summary(trace.get("scheduler") if isinstance(trace.get("scheduler"), Mapping) else {})
        if scheduler:
            lines.append(f"  scheduler: {scheduler}")
        feedback_items = [_verifier_feedback(step) for step in action_steps[-max_verifier_feedback_per_trace:]]
        feedback_items = [item for item in feedback_items if item]
        omitted["verifierFeedback"] += max(0, len(action_steps) - len(feedback_items))
        for feedback in feedback_items:
            lines.append(f"  verifierFeedback: {feedback}")
        for ref_item in screenshot_refs[:max_screenshot_refs_per_trace]:
            screenshot_ref_count += 1
            lines.append(f"  screenshotMeta: {_screenshot_ref_summary(ref_item)}")
        omitted["screenshotRefs"] += max(0, len(screenshot_refs) - max_screenshot_refs_per_trace)
        for ref_item in focus_refs[:max_focus_refs_per_trace]:
            focus_ref_count += 1
            lines.append(f"  focusMeta: {_focus_ref_summary(ref_item)}")
        omitted["focusRefs"] += max(0, len(focus_refs) - max_focus_refs_per_trace)

    text = "\n".join(lines)
    if len(text) > char_budget:
        omitted["truncatedChars"] = len(text) - char_budget
        text = text[: max(0, char_budget - 80)].rstrip() + f"\n  memoryTruncatedChars: {omitted['truncatedChars']}"
    return VisionMemoryBlock(
        schemaVersion="sciforge.vision-sense.visual-memory.v1",
        mode=mode,
        policy="file-ref-only",
        text=text,
        traceCount=len(traces),
        screenshotRefCount=screenshot_ref_count,
        focusRefCount=focus_ref_count,
        omitted=omitted,
    )


def build_visual_memory_block_from_request(request: Mapping[str, Any]) -> VisionMemoryBlock:
    traces = [
        VisionMemoryTraceInput(
            path=str(item.get("path") or ""),
            ref=str(item.get("ref")) if item.get("ref") else None,
            label=str(item.get("label")) if item.get("label") else None,
        )
        for item in request.get("traces", [])
        if isinstance(item, Mapping) and item.get("path")
    ]
    return build_visual_memory_block(
        traces,
        mode=str(request.get("mode") or "cross-round-followup"),
        max_screenshot_refs_per_trace=int(request.get("maxScreenshotRefsPerTrace") or 5),
        max_focus_refs_per_trace=int(request.get("maxFocusRefsPerTrace") or 4),
        max_verifier_feedback_per_trace=int(request.get("maxVerifierFeedbackPerTrace") or 5),
        char_budget=int(request.get("charBudget") or 6000),
    )


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _trace_status(trace: Mapping[str, Any], steps: list[Mapping[str, Any]]) -> str:
    for key in ("status", "executionStatus"):
        value = trace.get(key)
        if isinstance(value, str) and value:
            return value
    if any(step.get("status") == "failed" for step in steps):
        return "failed"
    if any(step.get("status") == "blocked" for step in steps):
        return "blocked"
    return "done" if steps else "unknown"


def _non_wait_count(action_steps: list[Mapping[str, Any]]) -> int:
    return sum(1 for step in action_steps if (step.get("plannedAction") or {}).get("type") != "wait")


def _status_count(steps: list[Mapping[str, Any]], status: str) -> int:
    return sum(1 for step in steps if step.get("status") == status)


def _trace_window_target(trace: Mapping[str, Any]) -> Mapping[str, Any]:
    config = trace.get("config") if isinstance(trace.get("config"), Mapping) else {}
    for candidate in (trace.get("windowTarget"), trace.get("windowTargeting"), config.get("windowTarget")):
        if isinstance(candidate, Mapping):
            return candidate
    return {}


def _window_target_summary(target: Mapping[str, Any], refs: list[Mapping[str, Any]]) -> str:
    if not target:
        return ""
    identity = _first_text(target.get("windowId"), target.get("title"), target.get("appName"), target.get("bundleId")) or "unknown"
    observed_display_ids = _unique_text(ref.get("displayId") for ref in refs)
    pieces = [f"identity={identity}"]
    display_id = _first_text(target.get("displayId"))
    if display_id:
        pieces.append(f"displayId={display_id}")
    if observed_display_ids:
        pieces.append(f"observedDisplayIds={','.join(observed_display_ids)}")
    coordinate_space = _first_text(target.get("coordinateSpace"))
    if coordinate_space:
        pieces.append(f"coordinateSpace={coordinate_space}")
    bounds = target.get("bounds")
    if isinstance(bounds, Mapping):
        pieces.append(f"bounds={_bounds_summary(bounds)}")
    return "; ".join(pieces)


def _scheduler_summary(scheduler: Mapping[str, Any]) -> str:
    pieces = []
    for label, keys in (
        ("lockId", ("lockId", "schedulerLockId")),
        ("scope", ("lockScope", "scope")),
        ("focusPolicy", ("focusPolicy", "focus")),
        ("interferenceRisk", ("interferenceRisk", "risk")),
    ):
        value = _first_text(*(scheduler.get(key) for key in keys))
        if value:
            pieces.append(f"{label}={value}")
    return "; ".join(pieces)


def _verifier_feedback(step: Mapping[str, Any]) -> str:
    action = step.get("plannedAction") if isinstance(step.get("plannedAction"), Mapping) else {}
    verifier = step.get("verifier") if isinstance(step.get("verifier"), Mapping) else {}
    action_type = _first_text(action.get("type")) or "unknown"
    status = _first_text(step.get("status")) or "unknown"
    explicit = _first_text(verifier.get("planningFeedback"))
    if explicit:
        return f"{action_type}: status={status}; {explicit}"
    parts = [f"{action_type}: status={status}"]
    pixel = _pixel_summary(verifier.get("pixelDiff") if isinstance(verifier.get("pixelDiff"), Mapping) else {})
    if pixel:
        parts.append(pixel)
    window = _window_consistency_summary(
        verifier.get("windowConsistency") if isinstance(verifier.get("windowConsistency"), Mapping) else {}
    )
    if window:
        parts.append(window)
    reason = _first_text(verifier.get("reason"), step.get("failureReason"))
    if reason:
        parts.append(f"reason={reason[:140]}")
    return "; ".join(parts)


def _pixel_summary(pixel_diff: Mapping[str, Any]) -> str:
    pairs = [item for item in pixel_diff.get("pairs", []) if isinstance(item, Mapping)]
    no_effect = pixel_diff.get("possiblyNoEffect") is True or (
        bool(pairs) and all(pair.get("possiblyNoEffect") is True for pair in pairs)
    )
    ratios = ",".join(
        f"{float(pair['changedByteRatio']):.4f}"
        for pair in pairs[:3]
        if isinstance(pair.get("changedByteRatio"), (int, float))
    )
    if not pairs and pixel_diff.get("possiblyNoEffect") is not True:
        return ""
    return f"pixel={'no-visible-effect' if no_effect else 'changed'}{f' ratios={ratios}' if ratios else ''}"


def _window_consistency_summary(consistency: Mapping[str, Any]) -> str:
    pieces = []
    if consistency.get("status"):
        pieces.append(f"window={consistency['status']}")
    if isinstance(consistency.get("sameWindow"), bool):
        pieces.append(f"sameWindow={str(consistency['sameWindow']).lower()}")
    if isinstance(consistency.get("scopeOk"), bool):
        pieces.append(f"scopeOk={str(consistency['scopeOk']).lower()}")
    return " ".join(pieces)


def _screenshot_ref_summary(ref: Mapping[str, Any]) -> str:
    return (
        f"{ref.get('path') or 'missing'}; sha256={ref.get('sha256') or 'missing'}; "
        f"size={ref.get('width') or 'unknown'}x{ref.get('height') or 'unknown'}; "
        f"displayId={ref.get('displayId') or 'unknown'}"
    )


def _focus_ref_summary(ref: Mapping[str, Any]) -> str:
    region = ref.get("focusRegion") if isinstance(ref.get("focusRegion"), Mapping) else {}
    bbox = ",".join(
        str(int(region[key]))
        for key in ("x", "y", "width", "height")
        if isinstance(region.get(key), (int, float))
    )
    return f"{_screenshot_ref_summary(ref)}; bbox={bbox or 'unknown'}; source={region.get('sourceScreenshotRef') or 'unknown'}"


def _bounds_summary(bounds: Mapping[str, Any]) -> str:
    return f"{bounds.get('x', '?')},{bounds.get('y', '?')},{bounds.get('width', '?')}x{bounds.get('height', '?')}"


def _first_text(*values: Any) -> str | None:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, bool):
            return "true" if value else "false"
        if isinstance(value, (int, float)):
            return str(value)
    return None


def _unique_text(values: Any) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        text = _first_text(value)
        if text and text not in seen:
            seen.add(text)
            result.append(text)
    return result


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args:
        print("expected JSON request", file=sys.stderr)
        return 2
    block = build_visual_memory_block_from_request(json.loads(args[0]))
    print(json.dumps({"ok": True, "result": asdict(block)}, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
