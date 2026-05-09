"""A lightweight text-agent runtime for independent vision-sense testing.

This module lets tests and local smokes replace SciForge/AgentServer with a
small text agent. It captures real screenshot files, asks the text agent for
visual observations/actions, records Computer Use text signals, and writes a
validated vision-trace artifact.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, is_dataclass
from pathlib import Path
from typing import Any, Mapping, Protocol

from .computer_use import command_to_text, computer_use_command_from_action
from .trace import (
    TraceScreenshotStore,
    capture_screenshot_to_store,
    validate_trace_artifact,
    write_trace_artifact,
)
from .types import VisionAction, VisionTaskRequest


@dataclass(frozen=True)
class TextAgentDecision:
    done: bool
    reason: str
    screenSummary: str
    visibleObjects: list[dict[str, Any]]
    plannedAction: VisionAction | Mapping[str, Any] | None = None
    grounding: Mapping[str, Any] | None = None
    confidence: float | None = None


class TextVisionAgent(Protocol):
    def decide(
        self,
        request: VisionTaskRequest,
        screenshot_ref: str,
        history: list[dict[str, Any]],
    ) -> TextAgentDecision | Mapping[str, Any]:
        """Return visual observations plus the next low-risk GUI action."""


def run_text_agent_vision_task(
    request: VisionTaskRequest,
    *,
    text_agent: TextVisionAgent,
    capture_provider: Any,
    output_dir: str | Path,
    ref_prefix: str | None = None,
    run_id: str = "vision-text-agent-run",
) -> dict[str, Any]:
    """Capture screenshots and write a validated vision-trace artifact."""

    store = TraceScreenshotStore(output_dir, ref_prefix=ref_prefix)
    steps: list[dict[str, Any]] = []
    status = "succeeded"
    reason = "completed"
    final_ref: str | None = None

    max_steps = max(1, int(request.maxSteps or 1))
    for step_index in range(max_steps):
        before = capture_screenshot_to_store(
            capture_provider,
            store,
            f"step-{step_index:03d}-before.png",
            metadata={"role": "before", "stepIndex": step_index},
        )
        decision = _coerce_decision(text_agent.decide(request, before.uri, steps))
        action = _coerce_action(decision.plannedAction)
        grounding = dict(decision.grounding or {})
        crosshair = capture_screenshot_to_store(
            capture_provider,
            store,
            f"step-{step_index:03d}-crosshair.png",
            metadata={"role": "crosshair", "stepIndex": step_index},
        )
        after = capture_screenshot_to_store(
            capture_provider,
            store,
            f"step-{step_index:03d}-after.png",
            metadata={"role": "after", "stepIndex": step_index},
        )
        final_ref = after.uri
        command_text = None
        if action is not None and action.action != "none":
            command_text = command_to_text(
                computer_use_command_from_action(
                    {
                        "action": action.action,
                        "targetDescription": action.targetDescription,
                        "text": action.text,
                        "key": action.key,
                        "direction": action.direction,
                        "amount": action.amount,
                        "reason": action.reason,
                        "riskLevel": action.riskLevel,
                    },
                    grounding=grounding,
                    source_modality_refs=[before.uri],
                )
            )
        steps.append(
            {
                "index": step_index,
                "beforeScreenshotRef": before.uri,
                "crosshairScreenshotRef": crosshair.uri,
                "afterScreenshotRef": after.uri,
                "screenSummary": decision.screenSummary,
                "visibleObjects": decision.visibleObjects,
                "completionCheck": {
                    "done": decision.done,
                    "reason": decision.reason,
                    "confidence": decision.confidence,
                },
                "plannedAction": _jsonable(action) if action else None,
                "grounding": grounding or None,
                "computerUseTextSignal": command_text,
                "pixelDiff": {
                    "strategy": "external-or-byte-level",
                    "beforeScreenshotRef": before.uri,
                    "afterScreenshotRef": after.uri,
                },
                "failureReason": None,
            }
        )
        if decision.done:
            reason = decision.reason or "text agent reported done"
            break
    else:
        status = "max_steps"
        reason = f"Reached maxSteps={max_steps}"

    if final_ref is not None:
        final = capture_screenshot_to_store(
            capture_provider,
            store,
            "final-state.png",
            metadata={"role": "final"},
        )
        final_ref = final.uri

    trace = {
        "version": "sciforge.vision-trace.v1",
        "runId": run_id,
        "status": status,
        "reason": reason,
        "finalScreenshotRef": final_ref,
        "steps": steps,
        "metrics": {
            "stepCount": len(steps),
            "screenshotCount": len(steps) * 3 + (1 if final_ref else 0),
        },
        "metadata": {
            "source": "sciforge_vision_sense.text_agent_runtime",
            "screenshotPolicy": "file-refs-only",
        },
    }
    trace_path = store.output_dir / "vision-trace.json"
    write_trace_artifact(trace, trace_path)
    validation = validate_trace_artifact(trace_path, store)
    if not validation.ok:
        trace["status"] = "failed"
        trace["reason"] = "trace validation failed"
        trace["failureDiagnostics"] = asdict(validation)
        write_trace_artifact(trace, trace_path)
    return {
        "trace": trace,
        "tracePath": trace_path.as_posix(),
        "validation": asdict(validation),
    }


def _coerce_decision(value: TextAgentDecision | Mapping[str, Any]) -> TextAgentDecision:
    if isinstance(value, TextAgentDecision):
        return value
    return TextAgentDecision(
        done=bool(value.get("done")),
        reason=str(value.get("reason") or ""),
        screenSummary=str(value.get("screenSummary") or value.get("screen_summary") or ""),
        visibleObjects=list(value.get("visibleObjects") or value.get("visible_objects") or []),
        plannedAction=value.get("plannedAction") or value.get("planned_action"),
        grounding=value.get("grounding") if isinstance(value.get("grounding"), Mapping) else None,
        confidence=float(value["confidence"]) if value.get("confidence") is not None else None,
    )


def _coerce_action(value: VisionAction | Mapping[str, Any] | None) -> VisionAction | None:
    if value is None:
        return None
    if isinstance(value, VisionAction):
        return value
    return VisionAction(
        action=value.get("action") or value.get("kind") or "none",
        targetDescription=value.get("targetDescription") or value.get("target_description"),
        text=value.get("text"),
        key=value.get("key"),
        direction=value.get("direction"),
        amount=value.get("amount"),
        reason=value.get("reason"),
        confidence=value.get("confidence"),
        riskLevel=value.get("riskLevel") or value.get("risk_level") or "low",
        metadata=dict(value.get("metadata") or {}),
    )


def _jsonable(value: Any) -> Any:
    if is_dataclass(value):
        return asdict(value)
    if isinstance(value, Mapping):
        return {str(key): _jsonable(child) for key, child in value.items()}
    if isinstance(value, list):
        return [_jsonable(child) for child in value]
    return value
