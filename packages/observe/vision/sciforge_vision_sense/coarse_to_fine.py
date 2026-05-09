"""Coarse-to-fine visual focus helpers for generic Computer Use.

The runtime owns screenshot capture and OS-specific cropping. This module owns
the visual algorithm contract: selecting a focus region from grounding evidence
and compacting verifier feedback for later VLM/LLM planning.
"""

from __future__ import annotations

import json
import sys
from dataclasses import asdict, dataclass
from typing import Any, Mapping


JsonMap = dict[str, Any]


@dataclass(frozen=True)
class FocusRegion:
    sourceScreenshotRef: str
    coordinateFrame: str
    x: int
    y: int
    width: int
    height: int
    centerX: float
    centerY: float
    sourceWidth: int
    sourceHeight: int
    reason: str


def build_focus_region(
    *,
    source_screenshot_ref: str,
    center_x: float,
    center_y: float,
    source_width: int,
    source_height: int,
    reason: str = "grounded target",
    max_width: int = 360,
    max_height: int = 300,
    min_width: int = 96,
    min_height: int = 80,
    ratio: float = 0.35,
) -> FocusRegion:
    """Return a clipped crop region centered on a coarse grounding point."""

    if source_width <= 0 or source_height <= 0:
        raise ValueError("source_width and source_height must be positive")
    if min_width <= 0 or min_height <= 0 or max_width <= 0 or max_height <= 0:
        raise ValueError("focus region size bounds must be positive")
    if ratio <= 0:
        raise ValueError("ratio must be positive")

    width = min(source_width, max(1, min(max_width, max(min_width, round(source_width * ratio)))))
    height = min(source_height, max(1, min(max_height, max(min_height, round(source_height * ratio)))))
    x = _clamp(round(center_x - width / 2), 0, max(0, source_width - width))
    y = _clamp(round(center_y - height / 2), 0, max(0, source_height - height))
    return FocusRegion(
        sourceScreenshotRef=source_screenshot_ref,
        coordinateFrame="source-screenshot-pixels",
        x=x,
        y=y,
        width=width,
        height=height,
        centerX=center_x,
        centerY=center_y,
        sourceWidth=source_width,
        sourceHeight=source_height,
        reason=reason,
    )


def build_focus_region_from_trace(source_ref: Mapping[str, Any], grounding: Mapping[str, Any]) -> JsonMap | None:
    """Build a focus region from trace screenshot and grounding metadata."""

    center_x = _first_number(grounding.get("localX"), grounding.get("screenshotX"), grounding.get("x"))
    center_y = _first_number(grounding.get("localY"), grounding.get("screenshotY"), grounding.get("y"))
    width = _first_number(source_ref.get("width"))
    height = _first_number(source_ref.get("height"))
    path = str(source_ref.get("path") or "")
    if center_x is None or center_y is None or width is None or height is None or not path:
        return None
    region = build_focus_region(
        source_screenshot_ref=path,
        center_x=center_x,
        center_y=center_y,
        source_width=int(width),
        source_height=int(height),
        reason=str(grounding.get("targetDescription") or grounding.get("reason") or "grounded target"),
    )
    return asdict(region)


def build_verifier_planning_feedback(
    *,
    action: Mapping[str, Any] | None = None,
    status: str | None = None,
    grounding: Mapping[str, Any] | None = None,
    pixel_diff: Mapping[str, Any] | None = None,
    window_consistency: Mapping[str, Any] | None = None,
    failure_reason: str | None = None,
    visual_focus: Mapping[str, Any] | None = None,
) -> str:
    """Compact verifier evidence into a planner-readable memory sentence."""

    parts: list[str] = []
    pixel = _compact_pixel_diff(pixel_diff or {})
    if pixel:
        parts.append(pixel)
    window = _compact_window_consistency(window_consistency or {})
    if window:
        parts.append(window)
    ground = _compact_grounding(grounding or {})
    if ground:
        parts.append(ground)
    focus = _compact_visual_focus(visual_focus or {})
    if focus:
        parts.append(focus)
    if failure_reason:
        parts.append(f"failure={failure_reason[:180]}")
    if status == "blocked":
        parts.append("next=repair prerequisite before retrying this action")
    if status == "failed":
        parts.append("next=replan; do not repeat without changing target, modality, or prerequisite")
    if (pixel_diff or {}).get("possiblyNoEffect") is True:
        action_type = str((action or {}).get("type") or "action")
        parts.append(
            f"next={action_type} produced no visible window effect; "
            "avoid repeating same target unless screenshot changed"
        )
    return " | ".join(parts)


def build_region_semantic_verifier(
    *,
    action: Mapping[str, Any] | None = None,
    status: str | None = None,
    grounding: Mapping[str, Any] | None = None,
    pixel_diff: Mapping[str, Any] | None = None,
    focus_pixel_diff: Mapping[str, Any] | None = None,
    visual_focus: Mapping[str, Any] | None = None,
    failure_reason: str | None = None,
) -> JsonMap:
    """Return a region-level semantic verifier summary from local evidence.

    This is intentionally deterministic in the MVP. It does not claim OCR-level
    truth; it classifies what the focused region evidence can and cannot prove,
    so the next Planner step knows whether to retry, type, wait, or widen focus.
    """

    action_map = action or {}
    action_type = str(action_map.get("type") or "unknown")
    target = str(
        action_map.get("targetRegionDescription")
        or action_map.get("targetDescription")
        or (grounding or {}).get("targetDescription")
        or ""
    )
    focus_changed = _pixel_changed(focus_pixel_diff or {})
    window_changed = _pixel_changed(pixel_diff or {})
    focus_no_effect = _pixel_no_effect(focus_pixel_diff or {})
    window_no_effect = _pixel_no_effect(pixel_diff or {})
    region = _focus_region_dict(visual_focus or {})

    if status == "failed":
        verdict = "execution-failed"
        next_hint = "replan before retrying this focused target"
    elif action_type == "type_text":
        if focus_changed or window_changed:
            verdict = "text-entry-region-changed"
            next_hint = "verify visible text or continue with the next field"
        else:
            verdict = "text-entry-unverified"
            next_hint = "activate the intended focused text field or widen focus before typing again"
    elif action_type in {"click", "double_click"}:
        if focus_changed:
            verdict = "focused-target-reacted"
            next_hint = "continue from the changed focused region"
        elif window_changed and focus_no_effect:
            verdict = "off-target-or-unrelated-window-change"
            next_hint = "avoid the same point; refine target description or widen focus"
        elif focus_no_effect or window_no_effect:
            verdict = "focused-target-no-visible-effect"
            next_hint = "switch modality, choose a different visible control, or request a wider focus region"
        else:
            verdict = "focused-target-uncertain"
            next_hint = "use current screenshot and focus refs before repeating"
    elif action_type in {"scroll", "drag"}:
        verdict = "region-motion-detected" if focus_changed or window_changed else "region-motion-not-detected"
        next_hint = "continue only if the target content moved as intended"
    else:
        verdict = "region-evidence-recorded" if focus_changed or window_changed else "region-evidence-unchanged"
        next_hint = "use focused evidence in the next plan"

    confidence = 0.78 if focus_changed or focus_no_effect else 0.55
    if not region:
        confidence = min(confidence, 0.45)
    summary = [
        f"regionSemantic={verdict}",
        f"action={action_type}",
        f"target=\"{target[:80]}\"" if target else "",
        _compact_visual_focus(visual_focus or {}),
        f"next={next_hint}",
    ]
    if failure_reason:
        summary.append(f"failure={failure_reason[:120]}")
    return {
        "schemaVersion": "sciforge.vision-sense.region-semantic-verifier.v1",
        "verdict": verdict,
        "confidence": confidence,
        "targetDescription": target or None,
        "actionType": action_type,
        "focusRegion": region or None,
        "focusChanged": focus_changed,
        "windowChanged": window_changed,
        "possiblyNoEffect": focus_no_effect or window_no_effect,
        "nextPlannerHint": next_hint,
        "summary": " | ".join(part for part in summary if part),
    }


def _compact_pixel_diff(pixel_diff: Mapping[str, Any]) -> str:
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


def _compact_window_consistency(consistency: Mapping[str, Any]) -> str:
    pieces = []
    if consistency.get("status"):
        pieces.append(f"window={consistency['status']}")
    if isinstance(consistency.get("sameWindow"), bool):
        pieces.append(f"sameWindow={str(consistency['sameWindow']).lower()}")
    if isinstance(consistency.get("scopeOk"), bool):
        pieces.append(f"scopeOk={str(consistency['scopeOk']).lower()}")
    return " ".join(pieces)


def _compact_grounding(grounding: Mapping[str, Any]) -> str:
    pieces = []
    if grounding.get("status"):
        pieces.append(f"grounding={grounding['status']}")
    if grounding.get("targetDescription"):
        pieces.append(f"target=\"{str(grounding['targetDescription'])[:80]}\"")
    local = _coordinate_pair(grounding.get("localX"), grounding.get("localY")) or _coordinate_pair(
        grounding.get("screenshotX"),
        grounding.get("screenshotY"),
    )
    if local:
        pieces.append(f"local={local}")
    executor = _coordinate_pair(grounding.get("executorX"), grounding.get("executorY"))
    if executor:
        pieces.append(f"executor={executor}")
    return " ".join(pieces)


def _compact_visual_focus(visual_focus: Mapping[str, Any]) -> str:
    region = visual_focus.get("region") if isinstance(visual_focus.get("region"), Mapping) else visual_focus
    if not isinstance(region, Mapping):
        return ""
    bbox = ",".join(
        str(int(region[key]))
        for key in ("x", "y", "width", "height")
        if isinstance(region.get(key), (int, float))
    )
    return f"focus=bbox({bbox})" if bbox else ""


def _focus_region_dict(visual_focus: Mapping[str, Any]) -> JsonMap:
    region = visual_focus.get("region") if isinstance(visual_focus.get("region"), Mapping) else visual_focus
    if not isinstance(region, Mapping):
        return {}
    result: JsonMap = {}
    for key in ("x", "y", "width", "height", "centerX", "centerY", "sourceWidth", "sourceHeight"):
        value = region.get(key)
        if isinstance(value, (int, float)):
            result[key] = value
    return result


def _pixel_changed(pixel_diff: Mapping[str, Any]) -> bool:
    if pixel_diff.get("possiblyNoEffect") is False:
        return True
    pairs = [item for item in pixel_diff.get("pairs", []) if isinstance(item, Mapping)]
    return any(
        isinstance(pair.get("changedByteRatio"), (int, float))
        and float(pair.get("changedByteRatio")) >= 0.005
        for pair in pairs
    )


def _pixel_no_effect(pixel_diff: Mapping[str, Any]) -> bool:
    pairs = [item for item in pixel_diff.get("pairs", []) if isinstance(item, Mapping)]
    return pixel_diff.get("possiblyNoEffect") is True or (
        bool(pairs) and all(pair.get("possiblyNoEffect") is True for pair in pairs)
    )


def _coordinate_pair(x: Any, y: Any) -> str | None:
    if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
        return None
    return f"{round(x)},{round(y)}"


def _first_number(*values: Any) -> float | None:
    for value in values:
        if isinstance(value, (int, float)):
            return float(value)
    return None


def _clamp(value: int, lower: int, upper: int) -> int:
    return max(lower, min(upper, value))


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args:
        print("expected JSON request", file=sys.stderr)
        return 2
    request = json.loads(args[0])
    mode = request.get("mode")
    if mode == "focus-region":
        result = build_focus_region_from_trace(request.get("sourceRef") or {}, request.get("grounding") or {})
    elif mode == "verifier-feedback":
        result = build_verifier_planning_feedback(
            action=request.get("action") or {},
            status=request.get("status"),
            grounding=request.get("grounding") or {},
            pixel_diff=request.get("pixelDiff") or {},
            window_consistency=request.get("windowConsistency") or {},
            failure_reason=request.get("failureReason"),
            visual_focus=request.get("visualFocus") or {},
        )
    elif mode == "region-semantic-verifier":
        result = build_region_semantic_verifier(
            action=request.get("action") or {},
            status=request.get("status"),
            grounding=request.get("grounding") or {},
            pixel_diff=request.get("pixelDiff") or {},
            focus_pixel_diff=request.get("focusPixelDiff") or {},
            visual_focus=request.get("visualFocus") or {},
            failure_reason=request.get("failureReason"),
        )
    else:
        raise ValueError(f"unsupported coarse_to_fine mode: {mode}")
    print(json.dumps({"ok": True, "result": result}, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
