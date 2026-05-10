"""Sense-agnostic Computer Use action loop."""

from __future__ import annotations

from dataclasses import fields, is_dataclass, replace
from typing import Any, Mapping, Sequence, TypeVar

from .contracts import (
    ActionPlan,
    ActionPlanner,
    ActionTarget,
    ComputerUseRequest,
    ComputerUseResult,
    ComputerUseStatus,
    ExecutionOutcome,
    Grounding,
    GuiExecutor,
    LoopStep,
    Observation,
    SenseProvider,
    Verification,
    Verifier,
)
from .budget import create_loop_budget_debit
from .safety import assess_action_risk


T = TypeVar("T")


def run_computer_use_task(
    request: ComputerUseRequest | Mapping[str, Any] | str,
    sense: SenseProvider,
    planner: ActionPlanner,
    executor: GuiExecutor,
    verifier: Verifier,
) -> ComputerUseResult:
    """Run a bounded Computer Use task through abstract providers.

    The loop deliberately knows nothing about vision, OCR, browser internals, or
    desktop APIs. It asks `sense` for observations and target locations, asks
    `planner` for one action at a time, delegates execution, and verifies from
    the next observation.
    """

    req = _coerce_request(request)
    steps: list[LoopStep] = []
    final_observation: Observation | None = None

    for index in range(req.max_steps):
        before = _coerce_observation(sense.observe(req, steps))
        final_observation = before
        plan = _coerce_action_plan(planner.plan(req, before, steps))

        if plan.done:
            step = LoopStep(index=index, before=before, plan=plan, status="done")
            steps.append(step)
            return _result(
                "completed",
                plan.reason or "Planner reported task complete.",
                req,
                steps,
                before,
            )

        if plan.kind is None:
            step = LoopStep(
                index=index,
                before=before,
                plan=plan,
                status="failed",
                failure_reason="Planner returned no action kind.",
            )
            steps.append(step)
            return _result(
                "failed-with-reason",
                "Planner returned no executable generic action.",
                req,
                steps,
                before,
            )

        risk = assess_action_risk(plan, fail_closed=req.risk_policy == "fail-closed")
        if risk.blocked:
            step = LoopStep(
                index=index,
                before=before,
                plan=ActionPlan(
                    **{
                        **_asdict(plan),
                        "risk_level": risk.level,
                        "requires_confirmation": risk.needs_confirmation,
                    }
                ),
                status="blocked",
                failure_reason=risk.reason,
            )
            steps.append(step)
            return _result(
                "needs-confirmation",
                risk.reason,
                req,
                steps,
                before,
                {"blockedActionIndex": index, "riskLevel": risk.level},
            )

        grounding: Grounding | None = None
        if _requires_grounding(plan):
            grounding = _coerce_grounding(sense.locate(before, plan.target, steps))  # type: ignore[arg-type]
            if not grounding.ok:
                step = LoopStep(
                    index=index,
                    before=before,
                    plan=plan,
                    grounding=grounding,
                    status="failed",
                    failure_reason=grounding.reason or "Target grounding failed.",
                )
                steps.append(step)
                return _result(
                    "failed-with-reason",
                    grounding.reason or "Target grounding failed.",
                    req,
                    steps,
                    before,
                    {"failedStage": "grounding", "actionIndex": index},
                )

        execution = _coerce_execution(executor.execute(plan, grounding, req))
        if not execution.ok:
            step = LoopStep(
                index=index,
                before=before,
                plan=plan,
                grounding=grounding,
                execution=execution,
                status="failed",
                failure_reason=execution.message or "Executor failed.",
            )
            steps.append(step)
            return _result(
                "failed-with-reason",
                execution.message or "Executor failed.",
                req,
                steps,
                before,
                {"failedStage": "execution", "actionIndex": index},
            )

        after = _coerce_observation(sense.observe(req, steps, query="after-action"))
        final_observation = after
        verification = _coerce_verification(
            verifier.verify(req, before, after, plan, execution, steps)
        )
        step = LoopStep(
            index=index,
            before=before,
            plan=plan,
            grounding=grounding,
            execution=execution,
            after=after,
            verification=verification,
            status="done" if verification.ok else "failed",
            failure_reason=None if verification.ok else verification.reason,
        )
        steps.append(step)
        if not verification.ok:
            return _result(
                "failed-with-reason",
                verification.reason or "Verifier rejected the action result.",
                req,
                steps,
                after,
                {"failedStage": "verification", "actionIndex": index},
            )
        if verification.done:
            return _result(
                "completed",
                verification.reason or "Verifier reported task complete.",
                req,
                steps,
                after,
            )

    return _result(
        "max-steps",
        f"Computer Use loop reached max_steps={req.max_steps} without completion.",
        req,
        steps,
        final_observation,
        {"failedStage": "planner", "maxSteps": req.max_steps},
    )


def _requires_grounding(plan: ActionPlan) -> bool:
    return plan.kind in {"click", "double_click", "drag"} and plan.target is not None


def _result(
    status: ComputerUseStatus,
    reason: str,
    request: ComputerUseRequest,
    steps: Sequence[LoopStep],
    final_observation: Observation | None,
    diagnostics: Mapping[str, Any] | None = None,
) -> ComputerUseResult:
    metrics = _result_metrics(steps)
    budget_debit = create_loop_budget_debit(request, steps, status, metrics)
    budget_debit_refs = (budget_debit["debitId"],)
    steps_with_refs = tuple(
        replace(step, budget_debit_refs=budget_debit_refs)
        if _step_spends_budget(step)
        else step
        for step in steps
    )
    return ComputerUseResult(
        status=status,
        reason=reason,
        steps=steps_with_refs,
        final_observation=final_observation,
        failure_diagnostics=dict(diagnostics or {}),
        metrics=metrics,
        budget_debits=(budget_debit,),
        budget_debit_refs=budget_debit_refs,
    )


def _result_metrics(steps: Sequence[LoopStep]) -> dict[str, Any]:
    action_steps = sum(1 for step in steps if step.plan.kind is not None)
    observe_calls = sum(1 for step in steps if step.before) + sum(
        1 for step in steps if step.after
    )
    cost_units = action_steps + observe_calls
    return {
        "stepCount": len(steps),
        "actionCount": action_steps,
        "observationCount": observe_calls,
        "actionSteps": action_steps,
        "observeCalls": observe_calls,
        "costUnits": cost_units,
    }


def _step_spends_budget(step: LoopStep) -> bool:
    return step.plan.kind is not None or step.status in {"blocked", "failed"}


def _coerce_request(value: ComputerUseRequest | Mapping[str, Any] | str) -> ComputerUseRequest:
    if isinstance(value, ComputerUseRequest):
        return value
    if isinstance(value, str):
        return ComputerUseRequest(task=value)
    return ComputerUseRequest(
        task=str(value.get("task") or value.get("text") or ""),
        max_steps=int(value.get("max_steps") or value.get("maxSteps") or 12),
        risk_policy=value.get("risk_policy") or value.get("riskPolicy") or "fail-closed",
        window_target=value.get("window_target") or value.get("windowTarget"),
        metadata=value.get("metadata") or {},
    )


def _coerce_observation(value: Observation | Mapping[str, Any]) -> Observation:
    if isinstance(value, Observation):
        return value
    return Observation(
        ref=str(value.get("ref") or value.get("screenshotRef") or value.get("path") or ""),
        summary=str(value.get("summary") or ""),
        visible_texts=tuple(str(item) for item in value.get("visible_texts", value.get("visibleTexts", [])) or []),
        window_target=value.get("window_target") or value.get("windowTarget"),
        artifacts=value.get("artifacts") or {},
        metadata=value.get("metadata") or {},
    )


def _coerce_action_plan(value: ActionPlan | Mapping[str, Any] | None) -> ActionPlan:
    if isinstance(value, ActionPlan):
        return value
    if value is None:
        return ActionPlan(reason="Planner returned None.")
    target_value = value.get("target")
    if isinstance(target_value, str):
        target = ActionTarget(description=target_value)
    elif isinstance(target_value, Mapping):
        target = ActionTarget(
            description=str(target_value.get("description") or target_value.get("targetDescription") or ""),
            region_description=target_value.get("region_description") or target_value.get("targetRegionDescription"),
            ref=target_value.get("ref"),
        )
    elif value.get("targetDescription"):
        target = ActionTarget(
            description=str(value.get("targetDescription")),
            region_description=value.get("targetRegionDescription"),
        )
    else:
        target = None
    return ActionPlan(
        kind=value.get("kind") or value.get("type"),
        target=target,
        text=value.get("text"),
        key=value.get("key"),
        keys=tuple(value.get("keys") or []),
        direction=value.get("direction"),
        amount=float(value.get("amount") or 1.0),
        app_name=value.get("app_name") or value.get("appName"),
        done=bool(value.get("done") or False),
        reason=str(value.get("reason") or ""),
        risk_level=value.get("risk_level") or value.get("riskLevel") or "low",
        requires_confirmation=bool(value.get("requires_confirmation") or value.get("requiresConfirmation") or False),
        metadata=value.get("metadata") or {},
    )


def _coerce_grounding(value: Grounding | Mapping[str, Any] | None) -> Grounding:
    if isinstance(value, Grounding):
        return value
    if value is None:
        return Grounding(ok=False, reason="Sense provider returned no grounding.")
    coordinates = value.get("coordinates")
    x = value.get("x")
    y = value.get("y")
    if isinstance(coordinates, Sequence) and len(coordinates) >= 2:
        x, y = coordinates[0], coordinates[1]
    ok = bool(value.get("ok", x is not None and y is not None))
    return Grounding(
        ok=ok,
        x=float(x) if x is not None else None,
        y=float(y) if y is not None else None,
        coordinate_space=str(value.get("coordinate_space") or value.get("coordinateSpace") or "observation"),
        confidence=value.get("confidence"),
        reason=str(value.get("reason") or value.get("message") or ""),
        metadata=value.get("metadata") or {},
    )


def _coerce_execution(value: ExecutionOutcome | Mapping[str, Any]) -> ExecutionOutcome:
    if isinstance(value, ExecutionOutcome):
        return value
    return ExecutionOutcome(
        ok=bool(value.get("ok", not value.get("blocked", False))),
        message=str(value.get("message") or value.get("reason") or ""),
        blocked=bool(value.get("blocked", False)),
        metadata=value.get("metadata") or {},
    )


def _coerce_verification(value: Verification | Mapping[str, Any]) -> Verification:
    if isinstance(value, Verification):
        return value
    return Verification(
        ok=bool(value.get("ok", value.get("status") != "failed")),
        done=bool(value.get("done", False)),
        reason=str(value.get("reason") or ""),
        confidence=value.get("confidence"),
        changed=value.get("changed"),
        metadata=value.get("metadata") or {},
    )


def _asdict(value: Any) -> dict[str, Any]:
    if not is_dataclass(value):
        return dict(value)
    return {field.name: getattr(value, field.name) for field in fields(value)}
