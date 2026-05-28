"""Sense-agnostic Computer Use action loop."""

from __future__ import annotations

import hashlib
import re
from dataclasses import fields, is_dataclass, replace
from typing import Any, Mapping, Sequence, TypeVar

from .contracts import (
    ActionPlan,
    ActionPlanner,
    ActionTarget,
    ApprovalRequest,
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
    PlannerContractIssue,
    ComputerUseHostPorts,
)
from .budget import create_loop_budget_debit
from .evidence_ledger import EvidenceLedger, action_mutates_visible_state, build_evidence_index
from .safety import assess_action_risk
from .verifier import normalize_verifier_metadata


T = TypeVar("T")


class EvidenceLoop:
    """Observation-only phase: gather evidence and update the ledger."""

    def __init__(self, sense: SenseProvider, ledger: EvidenceLedger) -> None:
        self.sense = sense
        self.ledger = ledger

    def observe(
        self,
        request: ComputerUseRequest,
        steps: Sequence[LoopStep],
        *,
        action_index: int,
        query: str | None = None,
    ) -> tuple[Observation, str]:
        raw = self.sense.observe(request, steps, query=query) if query is not None else self.sense.observe(request, steps)
        observation = _coerce_observation(raw)
        evidence_id = self.ledger.append_observation(observation, action_index=action_index, query=query)
        return _observation_with_evidence_metadata(observation, self.ledger, evidence_id), evidence_id

    def record_grounding(
        self,
        grounding: Grounding,
        *,
        action_index: int,
        observation_record_id: str,
        target_description: str,
    ) -> str:
        return self.ledger.append_grounding(
            grounding,
            action_index=action_index,
            observation_record_id=observation_record_id,
            target_description=target_description,
        )

    def focus_crop(
        self,
        observation: Observation,
        grounding: Grounding | None,
        *,
        action_index: int,
        observation_record_id: str | None,
    ) -> tuple[Observation, Grounding | None, str | None]:
        if grounding is None:
            return observation, grounding, None
        crop = getattr(self.sense, "crop", None)
        if not callable(crop):
            return observation, grounding, None
        region = _crop_region_from_grounding(grounding)
        if region is None:
            return observation, grounding, None
        try:
            cropped = _coerce_observation(crop(observation, region))
        except Exception as exc:  # Optional evidence must not turn a valid action into a failure.
            self.record_uncertainty(
                action_index=action_index,
                summary=f"Focus crop evidence failed: {exc}",
                tags=["focus-crop", "optional-evidence"],
                derived_from=[observation_record_id] if observation_record_id else [],
                metadata={"failedStage": "focus-crop", "cropRegion": region},
            )
            return observation, _grounding_with_focus_crop_metadata(
                grounding,
                crop_refs=[],
                crop_record_id=None,
                crop_region=region,
                error=str(exc),
            ), None
        crop_record_id = self.ledger.append_observation(cropped, action_index=action_index, query="focus-crop")
        crop_refs = _focus_crop_refs_from_observation(cropped)
        return (
            _observation_with_focus_crop_metadata(observation, crop_refs, crop_record_id, region),
            _grounding_with_focus_crop_metadata(
                grounding,
                crop_refs=crop_refs,
                crop_record_id=crop_record_id,
                crop_region=region,
            ),
            crop_record_id,
        )

    def record_action(
        self,
        action: ActionPlan,
        execution: ExecutionOutcome | None,
        *,
        action_index: int,
        before_record_id: str | None,
        grounding_record_id: str | None,
        observation_only: bool = False,
    ) -> str:
        return self.ledger.append_action(
            action,
            execution,
            action_index=action_index,
            before_record_id=before_record_id,
            grounding_record_id=grounding_record_id,
            observation_only=observation_only,
        )

    def record_verification(
        self,
        verification: Verification,
        *,
        action_index: int,
        action_record_id: str | None,
        after_record_id: str | None,
    ) -> str:
        return self.ledger.append_verification(
            verification,
            action_index=action_index,
            action_record_id=action_record_id,
            after_record_id=after_record_id,
        )

    def record_uncertainty(
        self,
        *,
        action_index: int | None,
        summary: str,
        tags: Sequence[str] | None = None,
        derived_from: Sequence[str] | None = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> str:
        return self.ledger.append_uncertainty(
            action_index=action_index,
            summary=summary,
            tags=tags,
            derived_from=derived_from,
            metadata=metadata,
        )


class ActionLoop:
    """State-changing phase: plan, ground, execute, and verify one GUI action."""

    def __init__(self, planner: ActionPlanner, executor: GuiExecutor, verifier: Verifier) -> None:
        self.planner = planner
        self.executor = executor
        self.verifier = verifier

    def plan(
        self,
        request: ComputerUseRequest,
        observation: Observation,
        steps: Sequence[LoopStep],
    ) -> ActionPlan:
        return _coerce_action_plan(self.planner.plan(request, observation, steps))

    def ground(
        self,
        sense: SenseProvider,
        observation: Observation,
        plan: ActionPlan,
        steps: Sequence[LoopStep],
    ) -> Grounding | None:
        if not _requires_grounding(plan):
            return None
        return _coerce_grounding(sense.locate(observation, plan.target, steps))  # type: ignore[arg-type]

    def execute(
        self,
        request: ComputerUseRequest,
        plan: ActionPlan,
        grounding: Grounding | None,
    ) -> tuple[Grounding | None, ExecutionOutcome]:
        if _is_observation_only_wait(plan):
            return (
                _mark_observation_only_grounding(grounding),
                ExecutionOutcome(
                    ok=True,
                    message="Observation-only wait; executor skipped.",
                    metadata={"observationOnly": True},
                ),
            )
        return grounding, _coerce_execution(self.executor.execute(plan, grounding, request))

    def verify(
        self,
        request: ComputerUseRequest,
        before: Observation,
        after: Observation,
        plan: ActionPlan,
        execution: ExecutionOutcome,
        steps: Sequence[LoopStep],
    ) -> Verification:
        return _coerce_verification(self.verifier.verify(request, before, after, plan, execution, steps))


class CompletionGuard:
    """Ledger-backed completion guard for planner/verifier done claims."""

    def __init__(self, ledger: EvidenceLedger) -> None:
        self.ledger = ledger

    def append_claim_if_current(
        self,
        *,
        action_index: int | None,
        summary: str,
        status: str,
        supports: Sequence[str] | None = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> tuple[str | None, str | None]:
        support_ids = [support for support in (supports or []) if support]
        if status == "completed" and not self.supports_current_evidence(support_ids):
            reason = "Completion guard rejected stale or missing evidence support."
            self.ledger.append_uncertainty(
                action_index=action_index,
                summary=reason,
                tags=["completion-guard", "stale-evidence"],
                derived_from=support_ids,
                metadata={"status": status, **dict(metadata or {})},
            )
            return None, reason
        record_id = self.ledger.append_completion_claim(
            action_index=action_index,
            summary=summary,
            status=status,
            supports=support_ids,
            metadata=metadata,
        )
        return record_id, None

    def supports_current_evidence(self, supports: Sequence[str]) -> bool:
        if not supports:
            return False
        current_ids = set(build_evidence_index(self.ledger.records)["current"])
        return any(support in current_ids for support in supports)


class TaskLoop:
    """Task orchestration phase: alternate evidence and action loops to completion."""

    def __init__(
        self,
        request: ComputerUseRequest,
        sense: SenseProvider,
        planner: ActionPlanner,
        executor: GuiExecutor,
        verifier: Verifier,
        ledger: EvidenceLedger,
    ) -> None:
        self.request = request
        self.evidence = EvidenceLoop(sense, ledger)
        self.action = ActionLoop(planner, executor, verifier)
        self.completion_guard = CompletionGuard(ledger)
        self.ledger = ledger

    def finish(
        self,
        status: ComputerUseStatus,
        reason: str,
        steps: Sequence[LoopStep],
        final_observation: Observation | None,
        diagnostics: Mapping[str, Any] | None = None,
        approval_request: ApprovalRequest | None = None,
    ) -> ComputerUseResult:
        return _result(
            status,
            reason,
            self.request,
            steps,
            final_observation,
            diagnostics,
            approval_request,
            evidence_ledger=self.ledger,
        )

    def run(self) -> ComputerUseResult:
        req = self.request
        steps: list[LoopStep] = []
        final_observation: Observation | None = None

        for index in range(req.max_steps):
            before, before_evidence_id = self.evidence.observe(req, steps, action_index=index)
            final_observation = before
            plan = self.action.plan(req, before, steps)

            if plan.done:
                _, guard_reason = self.completion_guard.append_claim_if_current(
                    action_index=index,
                    summary=plan.reason or "Planner reported task complete.",
                    status="completed",
                    supports=[before_evidence_id],
                    metadata={"source": "planner"},
                )
                if guard_reason:
                    step = LoopStep(index=index, before=before, plan=plan, status="failed", failure_reason=guard_reason)
                    steps.append(step)
                    return self.finish("failed-with-reason", guard_reason, steps, before, {"failedStage": "completion-guard"})
                step = LoopStep(index=index, before=before, plan=plan, status="done")
                steps.append(step)
                return self.finish(
                    "completed",
                    plan.reason or "Planner reported task complete.",
                    steps,
                    before,
                )

            planner_issue = _planner_contract_issue(plan)
            if planner_issue:
                contract_reason = _planner_contract_reason(planner_issue, plan)
                self.evidence.record_uncertainty(
                    action_index=index,
                    summary=contract_reason,
                    tags=["planner-contract", planner_issue],
                    derived_from=[before_evidence_id],
                    metadata={"contractIssue": planner_issue},
                )
                step = LoopStep(
                    index=index,
                    before=before,
                    plan=plan,
                    status="failed",
                    failure_reason=contract_reason,
                )
                steps.append(step)
                return self.finish(
                    "failed-with-reason",
                    contract_reason,
                    steps,
                    before,
                    {"failedStage": "planner", "contractIssue": planner_issue},
                )

            risk = assess_action_risk(plan, fail_closed=req.risk_policy == "fail-closed")
            missing_approval_ref = risk.needs_confirmation and req.risk_policy == "allow-confirmed" and not req.approval_ref
            if risk.blocked or missing_approval_ref:
                reason = (
                    "High-risk Computer Use action was marked allow-confirmed but no approval_ref was provided."
                    if missing_approval_ref
                    else risk.reason
                )
                blocked_plan = ActionPlan(
                    **{
                        **_asdict(plan),
                        "risk_level": risk.level,
                        "requires_confirmation": risk.needs_confirmation,
                    }
                )
                action_evidence_id = self.evidence.record_action(
                    blocked_plan,
                    None,
                    action_index=index,
                    before_record_id=before_evidence_id,
                    grounding_record_id=None,
                    observation_only=True,
                )
                self.evidence.record_uncertainty(
                    action_index=index,
                    summary=reason,
                    tags=["needs-confirmation", risk.level],
                    derived_from=[before_evidence_id, action_evidence_id],
                    metadata={"riskLevel": risk.level},
                )
                step = LoopStep(
                    index=index,
                    before=before,
                    plan=blocked_plan,
                    status="blocked",
                    failure_reason=reason,
                )
                steps.append(step)
                return self.finish(
                    "needs-confirmation",
                    reason,
                    steps,
                    before,
                    {"blockedActionIndex": index, "riskLevel": risk.level},
                    _approval_request(req, plan, risk.level, reason, index, before),
                )

            grounding = self.action.ground(self.evidence.sense, before, plan, steps)
            grounding_evidence_id: str | None = None
            if grounding is not None:
                before, grounding, _ = self.evidence.focus_crop(
                    before,
                    grounding,
                    action_index=index,
                    observation_record_id=before_evidence_id,
                )
                grounding_evidence_id = self.evidence.record_grounding(
                    grounding,
                    action_index=index,
                    observation_record_id=before_evidence_id,
                    target_description=plan.target.description if plan.target else "",
                )
                if not grounding.ok:
                    self.evidence.record_uncertainty(
                        action_index=index,
                        summary=grounding.reason or "Target grounding failed.",
                        tags=["grounding"],
                        derived_from=[before_evidence_id, grounding_evidence_id],
                        metadata={"failedStage": "grounding"},
                    )
                    step = LoopStep(
                        index=index,
                        before=before,
                        plan=plan,
                        grounding=grounding,
                        status="failed",
                        failure_reason=grounding.reason or "Target grounding failed.",
                    )
                    steps.append(step)
                    return self.finish(
                        "failed-with-reason",
                        grounding.reason or "Target grounding failed.",
                        steps,
                        before,
                        {"failedStage": "grounding", "actionIndex": index},
                    )

            grounding, execution = self.action.execute(req, plan, grounding)
            if not execution.ok:
                action_mutates = action_mutates_visible_state(
                    plan.kind or "",
                    observation_only=_is_observation_only_wait(plan),
                )
                action_evidence_id = self.evidence.record_action(
                    plan,
                    execution,
                    action_index=index,
                    before_record_id=before_evidence_id,
                    grounding_record_id=grounding_evidence_id,
                    observation_only=not action_mutates,
                )
                after: Observation | None = None
                after_evidence_id: str | None = None
                if action_mutates:
                    try:
                        after, after_evidence_id = self.evidence.observe(
                            req,
                            steps,
                            action_index=index,
                            query="after-failed-action",
                        )
                        final_observation = after
                    except Exception as error:  # pragma: no cover - defensive evidence fallback
                        self.evidence.record_uncertainty(
                            action_index=index,
                            summary=f"Failed to capture after-evidence for failed executor action: {error}",
                            tags=["execution", "after-evidence"],
                            derived_from=[before_evidence_id, action_evidence_id],
                            metadata={"failedStage": "after-failed-action-capture"},
                        )
                self.evidence.record_uncertainty(
                    action_index=index,
                    summary=execution.message or "Executor failed.",
                    tags=["execution"],
                    derived_from=[ref for ref in (before_evidence_id, action_evidence_id, after_evidence_id) if ref],
                    metadata={
                        "failedStage": "execution",
                        "afterEvidenceCaptured": after_evidence_id is not None,
                    },
                )
                step = LoopStep(
                    index=index,
                    before=before,
                    plan=plan,
                    grounding=grounding,
                    execution=execution,
                    after=after,
                    status="failed",
                    failure_reason=execution.message or "Executor failed.",
                )
                steps.append(step)
                return self.finish(
                    "failed-with-reason",
                    execution.message or "Executor failed.",
                    steps,
                    after or before,
                    {
                        "failedStage": "execution",
                        "actionIndex": index,
                        "afterEvidenceCaptured": after_evidence_id is not None,
                    },
                )

            action_evidence_id = self.evidence.record_action(
                plan,
                execution,
                action_index=index,
                before_record_id=before_evidence_id,
                grounding_record_id=grounding_evidence_id,
                observation_only=_is_observation_only_wait(plan),
            )
            after, after_evidence_id = self.evidence.observe(req, steps, action_index=index, query="after-action")
            final_observation = after
            verification = self.action.verify(req, before, after, plan, execution, steps)
            verification_evidence_id = self.evidence.record_verification(
                verification,
                action_index=index,
                action_record_id=action_evidence_id,
                after_record_id=after_evidence_id,
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
                self.evidence.record_uncertainty(
                    action_index=index,
                    summary=verification.reason or "Verifier rejected the action result.",
                    tags=["verification"],
                    derived_from=[action_evidence_id, verification_evidence_id],
                    metadata={"failedStage": "verification"},
                )
                return self.finish(
                    "failed-with-reason",
                    verification.reason or "Verifier rejected the action result.",
                    steps,
                    after,
                    {"failedStage": "verification", "actionIndex": index},
                )
            if verification.done:
                _, guard_reason = self.completion_guard.append_claim_if_current(
                    action_index=index,
                    summary=verification.reason or "Verifier reported task complete.",
                    status="completed",
                    supports=[verification_evidence_id, after_evidence_id],
                    metadata={"source": "verifier"},
                )
                if guard_reason:
                    return self.finish("failed-with-reason", guard_reason, steps, after, {"failedStage": "completion-guard"})
                return self.finish(
                    "completed",
                    verification.reason or "Verifier reported task complete.",
                    steps,
                    after,
                )

        final_before, final_before_evidence_id = self.evidence.observe(
            req,
            steps,
            action_index=len(steps),
            query="final-no-execute-completion-check",
        )
        final_observation = final_before
        final_plan = self.action.plan(req, final_before, steps)
        final_index = len(steps)

        if final_plan.done:
            _, guard_reason = self.completion_guard.append_claim_if_current(
                action_index=final_index,
                summary=final_plan.reason or "Planner reported task complete after final observation.",
                status="completed",
                supports=[final_before_evidence_id],
                metadata={"source": "final-no-execute-planner"},
            )
            steps.append(
                LoopStep(
                    index=final_index,
                    before=final_before,
                    plan=final_plan,
                    status="failed" if guard_reason else "done",
                    failure_reason=guard_reason,
                )
            )
            if guard_reason:
                return self.finish("failed-with-reason", guard_reason, steps, final_before, {"failedStage": "completion-guard"})
            return self.finish(
                "completed",
                final_plan.reason or "Planner reported task complete after final observation.",
                steps,
                final_before,
            )

        diagnostics: dict[str, Any] = {
            "failedStage": "planner",
            "maxSteps": req.max_steps,
            "finalNoExecuteCheck": True,
        }
        planner_issue = _planner_contract_issue(final_plan)
        if planner_issue:
            diagnostics["finalPlannerContractIssue"] = planner_issue
        if final_plan.reason:
            diagnostics["finalPlannerReason"] = final_plan.reason
        if final_plan.kind:
            diagnostics["finalPlannerActionKind"] = final_plan.kind
        failure_reason = f"Computer Use loop reached max_steps={req.max_steps} without completion."
        self.evidence.record_uncertainty(
            action_index=final_index,
            summary=failure_reason,
            tags=["completion-gap", "max-steps"],
            derived_from=[final_before_evidence_id],
            metadata=diagnostics,
        )
        return self.finish(
            "max-steps",
            failure_reason,
            steps,
            final_observation,
            diagnostics,
        )


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
    request_issue = _request_contract_issue(req)
    if request_issue:
        return ComputerUseResult(
            status="failed-with-reason",
            reason=request_issue,
            final_observation=None,
            failure_diagnostics={"failedStage": "request-validation"},
            metrics={},
        )
    return TaskLoop(req, sense, planner, executor, verifier, EvidenceLedger.from_request(req)).run()


def run_task(
    request: ComputerUseRequest | Mapping[str, Any] | str,
    host_ports: ComputerUseHostPorts,
) -> ComputerUseResult:
    """Run Computer Use through the public host-ports interface.

    This is the package-level TUI action provider surface. The existing
    `run_computer_use_task` remains useful for unit tests and custom provider
    wiring; `run_task` adapts host-injected ports into sense/planner/executor/
    verifier protocols, writes a trace when the host exposes `write_trace`, and
    emits compact start/finish events.
    """

    req = _coerce_request(request)
    request_issue = _request_contract_issue(req)
    if request_issue:
        return ComputerUseResult(
            status="failed-with-reason",
            reason=request_issue,
            final_observation=None,
            failure_diagnostics={"failedStage": "request-validation"},
            metrics={},
        )
    missing_ports = _missing_required_host_ports(host_ports)
    if missing_ports:
        return ComputerUseResult(
            status="failed-with-reason",
            reason=f"Computer Use host ports missing required callable(s): {', '.join(missing_ports)}.",
            final_observation=None,
            failure_diagnostics={
                "failedStage": "host-port-validation",
                "missingPorts": missing_ports,
            },
            metrics={},
        )
    _call_optional_port(host_ports, "emit_event", {
        "type": "computer-use.run.started",
        "schemaVersion": req.schema_version,
        "task": req.task,
        "maxSteps": req.max_steps,
    })
    result = run_computer_use_task(
        req,
        _HostPortSense(host_ports),
        _HostPortPlanner(host_ports),
        _HostPortExecutor(host_ports),
        _HostPortVerifier(host_ports),
    )
    trace_ref = _call_optional_port(host_ports, "write_trace", result)
    if trace_ref:
        result = replace(result, trace_refs=(str(trace_ref),))
    _call_optional_port(host_ports, "emit_event", {
        "type": "computer-use.run.finished",
        "status": result.status,
        "reason": result.reason,
        "traceRefs": list(result.trace_refs),
        "finalArtifactRef": result.final_artifact_refs[0] if result.final_artifact_refs else None,
        "finalArtifactRefs": list(result.final_artifact_refs),
        "budgetDebitRefs": list(result.budget_debit_refs),
    })
    return result


def _requires_grounding(plan: ActionPlan) -> bool:
    return plan.kind in {"click", "double_click", "drag", "wait", "focus"} and plan.target is not None


def _is_observation_only_wait(plan: ActionPlan) -> bool:
    return plan.kind == "wait" and plan.target is not None


def _mark_observation_only_grounding(grounding: Grounding | None) -> Grounding | None:
    if grounding is None:
        return None
    return replace(
        grounding,
        metadata={
            **dict(grounding.metadata),
            "observationOnly": True,
        },
    )


def _crop_region_from_grounding(grounding: Grounding) -> Mapping[str, Any] | None:
    metadata = dict(grounding.metadata)
    for key in ("cropRegion", "focusRegion", "targetRegion", "region", "bounds", "boundingBox", "targetBounds"):
        region = metadata.get(key)
        if isinstance(region, Mapping):
            return {
                **dict(region),
                "source": f"grounding.metadata.{key}",
                "coordinateSpace": region.get("coordinateSpace") or region.get("coordinate_space") or grounding.coordinate_space,
            }
    if grounding.x is None or grounding.y is None:
        return None
    return {
        "kind": "point-neighborhood",
        "x": grounding.x,
        "y": grounding.y,
        "coordinateSpace": grounding.coordinate_space,
        "radius": 64,
        "source": "grounding.point",
    }


def _focus_crop_refs_from_observation(observation: Observation) -> list[str]:
    refs: list[str] = []
    if _looks_like_screenshot_ref(observation.ref):
        refs.append(observation.ref)
    refs.extend(_refs_from_focus_crop_fields(observation.metadata))
    refs.extend(_refs_from_focus_crop_fields(observation.artifacts))
    return _unique_strings(ref for ref in refs if _looks_like_screenshot_ref(ref))


def _refs_from_focus_crop_fields(value: Any) -> list[str]:
    refs: list[str] = []
    if isinstance(value, Mapping):
        for key, item in value.items():
            normalized = str(key).replace("_", "").replace("-", "").lower()
            if any(token in normalized for token in ("focusref", "focusrefs", "focuscrop", "screenshot", "capture", "image")):
                refs.extend(_refs_inside(item))
            elif isinstance(item, (Mapping, list, tuple)):
                refs.extend(_refs_from_focus_crop_fields(item))
    elif isinstance(value, (list, tuple)):
        for item in value:
            refs.extend(_refs_from_focus_crop_fields(item))
    return _unique_strings(refs)


def _observation_with_focus_crop_metadata(
    observation: Observation,
    crop_refs: Sequence[str],
    crop_record_id: str | None,
    crop_region: Mapping[str, Any],
) -> Observation:
    metadata = dict(observation.metadata)
    metadata["focusRefs"] = _unique_strings([*_refs_inside(metadata.get("focusRefs")), *crop_refs])
    metadata["focusCropEvidenceRecordIds"] = _unique_strings([
        *_refs_inside(metadata.get("focusCropEvidenceRecordIds")),
        *([crop_record_id] if crop_record_id else []),
    ])
    metadata["focusCropRegions"] = [
        *([item for item in metadata.get("focusCropRegions", []) if isinstance(item, Mapping)] if isinstance(metadata.get("focusCropRegions"), list) else []),
        dict(crop_region),
    ]
    return replace(observation, metadata=metadata)


def _grounding_with_focus_crop_metadata(
    grounding: Grounding,
    *,
    crop_refs: Sequence[str],
    crop_record_id: str | None,
    crop_region: Mapping[str, Any],
    error: str | None = None,
) -> Grounding:
    metadata = dict(grounding.metadata)
    source_diagnostics = metadata.get("diagnostics")
    diagnostics = dict(source_diagnostics) if isinstance(source_diagnostics, Mapping) else {}
    if source_diagnostics and not isinstance(source_diagnostics, Mapping):
        diagnostics["grounderDiagnostics"] = list(source_diagnostics) if isinstance(source_diagnostics, (list, tuple)) else source_diagnostics
    diagnostics["focusCropRefs"] = _unique_strings([
        *_refs_inside(diagnostics.get("focusCropRefs")),
        *crop_refs,
    ])
    if crop_record_id:
        diagnostics["focusCropEvidenceRecordId"] = crop_record_id
    diagnostics["focusCropRegion"] = dict(crop_region)
    if error:
        diagnostics["focusCropError"] = error
    metadata["diagnostics"] = diagnostics
    metadata["focusCropRefs"] = diagnostics["focusCropRefs"]
    if crop_record_id:
        metadata["focusCropEvidenceRecordId"] = crop_record_id
    return replace(grounding, metadata=metadata)


def _observation_with_evidence_metadata(
    observation: Observation,
    ledger: EvidenceLedger,
    evidence_record_id: str,
) -> Observation:
    metadata = {
        **dict(observation.metadata),
        "evidenceRecordId": evidence_record_id,
        "evidenceLedger": ledger.refs(),
    }
    return replace(observation, metadata=metadata)


def _result(
    status: ComputerUseStatus,
    reason: str,
    request: ComputerUseRequest,
    steps: Sequence[LoopStep],
    final_observation: Observation | None,
    diagnostics: Mapping[str, Any] | None = None,
    approval_request: ApprovalRequest | None = None,
    *,
    evidence_ledger: EvidenceLedger | None = None,
) -> ComputerUseResult:
    failure_diagnostics = dict(diagnostics or {})
    if evidence_ledger is not None:
        evidence_ledger.write()
        failure_diagnostics = {
            **failure_diagnostics,
            **evidence_ledger.result_diagnostics(),
        }
    final_artifact_refs = _final_artifact_refs(steps, final_observation)
    if status == "completed" and _requires_final_artifact_evidence(request):
        evidence_refs = _final_artifact_evidence_refs(steps, final_observation)
        if not evidence_refs:
            status = "failed-with-reason"
            reason = (
                "Final artifact evidence is required, but completion had no final artifact "
                "ref from the final observation or verifier metadata."
            )
            failure_diagnostics = {
                **failure_diagnostics,
                "failedStage": "final-artifact-evidence",
                "finalArtifactEvidenceRequired": True,
                "plannerFinalArtifactRefs": final_artifact_refs,
            }
            final_artifact_refs = []
        else:
            final_artifact_refs = evidence_refs
    if status == "completed" and _requires_directory_evidence(request):
        directory_evidence_refs = _directory_evidence_refs(steps, final_observation)
        final_screenshot_ref = _final_observation_screenshot_ref(final_observation)
        if not final_artifact_refs or not final_screenshot_ref or not directory_evidence_refs["artifactRefs"] or not directory_evidence_refs["dataRefs"]:
            status = "failed-with-reason"
            reason = (
                "Directory evidence is required, but completion did not include a final "
                "artifact ref, current final observation screenshot, and file-list artifact/data refs."
            )
            failure_diagnostics = {
                **failure_diagnostics,
                "failedStage": "directory-evidence",
                "directoryEvidenceRequired": True,
                "finalArtifactRefs": final_artifact_refs,
                "finalObservationScreenshotRef": final_screenshot_ref,
                "fileListArtifactRefs": directory_evidence_refs["artifactRefs"],
                "fileListDataRefs": directory_evidence_refs["dataRefs"],
                "plannerFinalArtifactRefs": _final_artifact_refs(steps, final_observation),
            }
            final_artifact_refs = []
    metrics = _result_metrics(steps)
    if evidence_ledger is not None:
        metrics = {
            **metrics,
            "evidenceRecordCount": len(evidence_ledger.records),
        }
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
        final_artifact_refs=tuple(final_artifact_refs),
        approval_request=approval_request,
        failure_diagnostics=failure_diagnostics,
        metrics=metrics,
        trace_refs=(),
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


def _final_artifact_refs(
    steps: Sequence[LoopStep],
    final_observation: Observation | None,
) -> list[str]:
    refs: list[str] = []
    if final_observation is not None:
        refs.extend(_refs_from_final_artifact_fields(final_observation.artifacts))
        refs.extend(_refs_from_final_artifact_fields(final_observation.metadata))
        refs.extend(_refs_from_visible_artifacts(final_observation.artifacts))
        refs.extend(_refs_from_visible_artifacts(final_observation.metadata))
    for step in reversed(steps):
        refs.extend(_refs_from_final_artifact_fields(step.plan.metadata))
        if step.verification is not None:
            refs.extend(_refs_from_final_artifact_fields(step.verification.metadata))
        if refs:
            break
    return _unique_strings(ref for ref in refs if _looks_like_final_artifact_ref(ref))


def _final_artifact_evidence_refs(
    steps: Sequence[LoopStep],
    final_observation: Observation | None,
) -> list[str]:
    refs: list[str] = []
    if final_observation is not None:
        refs.extend(_refs_from_final_artifact_fields(final_observation.artifacts))
        refs.extend(_refs_from_final_artifact_fields(final_observation.metadata))
        refs.extend(_refs_from_visible_artifacts(final_observation.artifacts))
        refs.extend(_refs_from_visible_artifacts(final_observation.metadata))
    for step in reversed(steps):
        if step.verification is not None:
            refs.extend(_refs_from_final_artifact_fields(step.verification.metadata))
        if refs:
            break
    return _unique_strings(ref for ref in refs if _looks_like_final_artifact_ref(ref))


def _requires_final_artifact_evidence(request: ComputerUseRequest) -> bool:
    return (
        _metadata_requires_final_artifact(request.metadata)
        or _text_requires_final_artifact_evidence(request.task)
        or _metadata_acceptance_text_requires_final_artifact(request.metadata)
    )


def _requires_directory_evidence(request: ComputerUseRequest) -> bool:
    return _metadata_requires_directory_evidence(request.metadata)


def _metadata_requires_final_artifact(value: Any) -> bool:
    if isinstance(value, Mapping):
        for key, item in value.items():
            normalized = str(key).replace("_", "").replace("-", "").lower()
            if normalized in {"requiresfinalartifact", "finalartifactrequired"} and _truthy_metadata_flag(item):
                return True
            if normalized in {"artifactpolicy", "acceptance"} and isinstance(item, Mapping):
                if _metadata_requires_final_artifact(item):
                    return True
        return False
    if isinstance(value, (list, tuple)):
        return any(_metadata_requires_final_artifact(item) for item in value)
    return False


def _metadata_acceptance_text_requires_final_artifact(value: Any) -> bool:
    if isinstance(value, Mapping):
        for key, item in value.items():
            normalized = str(key).replace("_", "").replace("-", "").lower()
            if normalized in {"planneracceptancecontract", "computeruselong", "acceptancecontract"} and isinstance(item, Mapping):
                if _metadata_acceptance_text_requires_final_artifact(item):
                    return True
            if normalized in {"task", "tasktext", "prompt", "roundprompt", "expectedtrace", "acceptance", "requirements"}:
                if _metadata_acceptance_text_requires_final_artifact(item):
                    return True
        return False
    if isinstance(value, (list, tuple)):
        return any(_metadata_acceptance_text_requires_final_artifact(item) for item in value)
    if isinstance(value, str):
        return _text_requires_final_artifact_evidence(value)
    return False


def _text_requires_final_artifact_evidence(text: str | None) -> bool:
    compact = str(text or "")
    if not compact.strip():
        return False
    if _looks_like_inline_text_entry_artifact_task(compact) and not _explicit_final_artifact_intent(compact):
        return False
    return bool(
        re.search(
            r"(?:create|make|produce|generate|write|draft|build|export|生成|制作|创建|写出|草拟|导出).{0,60}"
            r"(?:slide|ppt|presentation|deck|artifact|document|docx?|report|summary|index|file|brief|文稿|幻灯片|演示|产物|文档|报告|总结|汇总|索引|文件|简报)",
            compact,
            re.IGNORECASE,
        )
        or re.search(
            r"(?:save|保存).{0,60}(?:artifact|report|summary|index|brief|ppt|presentation|deck|产物|报告|总结|汇总|索引|简报|幻灯片|演示)",
            compact,
            re.IGNORECASE,
        )
        or _explicit_final_artifact_intent(compact)
        or re.search(
            r"(?:trace summary|evidence summary|action mapping|field evidence|control evidence|visual evidence (?:summary|refs?|report)|refs-first report|"
            r"字段证据|控件证据|视觉证据(?:总结|汇总|引用|报告)|动作映射|证据总结|证据汇总|引用报告)",
            compact,
            re.IGNORECASE,
        )
    )


def _explicit_final_artifact_intent(text: str) -> bool:
    return bool(
        re.search(
            r"(?:final[-\s]?artifact|l2-artifact-refs|l3-workflow-refs|visible[-\s]?artifact|"
            r"gui\.present.{0,40}artifact|report artifact|final report|artifact evidence|最终文件|最终产物|可见产物|报告产物)",
            text,
            re.IGNORECASE,
        )
    )


def _looks_like_inline_text_entry_artifact_task(text: str) -> bool:
    return bool(
        re.search(
            r"(?:write|draft|type|enter|输入|填写|写入|草拟).{0,80}(?:summary|report|brief|总结|报告|简报).{0,80}"
            r"(?:(?:in|into|inside|to)\s+(?:the\s+)?(?:comment box|comment field|comment|field|input|textbox|text box|form field|message box|chat box)|"
            r"(?:在|到|进).{0,8}(?:评论框|评论区|字段|输入框|文本框|表单|消息框|聊天框))",
            text,
            re.IGNORECASE,
        )
    )


def _metadata_requires_directory_evidence(value: Any) -> bool:
    if isinstance(value, Mapping):
        for key, item in value.items():
            normalized = str(key).replace("_", "").replace("-", "").lower()
            if normalized in {
                "requiresdirectoryevidence",
                "directoryevidencerequired",
                "filelistevidencerequired",
                "requiresfilelistevidence",
            } and _truthy_metadata_flag(item):
                return True
            if normalized in {"artifactpolicy", "acceptance"} and isinstance(item, Mapping):
                if _metadata_requires_directory_evidence(item):
                    return True
        return False
    if isinstance(value, (list, tuple)):
        return any(_metadata_requires_directory_evidence(item) for item in value)
    return False


def _truthy_metadata_flag(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "required", "require"}
    return False


def _refs_from_final_artifact_fields(value: Any) -> list[str]:
    refs: list[str] = []
    if isinstance(value, Mapping):
        for key, item in value.items():
            normalized = str(key).replace("_", "").replace("-", "").lower()
            if normalized in {"finalartifactref", "finalartifactrefs", "finalartifact", "finalartifacts"}:
                refs.extend(_refs_inside(item))
            elif isinstance(item, (Mapping, list, tuple)):
                refs.extend(_refs_from_final_artifact_fields(item))
    elif isinstance(value, (list, tuple)):
        for item in value:
            refs.extend(_refs_from_final_artifact_fields(item))
    return _unique_strings(refs)


def _refs_from_visible_artifacts(value: Any) -> list[str]:
    refs: list[str] = []
    if isinstance(value, Mapping):
        if _looks_like_visible_artifact_record(value):
            refs.extend(_refs_inside({
                "artifactRef": value.get("artifactRef") or value.get("artifact_ref"),
                "dataRef": value.get("dataRef") or value.get("data_ref"),
                "outputRef": value.get("outputRef") or value.get("output_ref"),
                "path": value.get("path"),
                "ref": value.get("ref"),
            }))
        for item in value.values():
            if isinstance(item, (Mapping, list, tuple)):
                refs.extend(_refs_from_visible_artifacts(item))
    elif isinstance(value, (list, tuple)):
        for item in value:
            refs.extend(_refs_from_visible_artifacts(item))
    return _unique_strings(refs)


def _final_observation_screenshot_ref(final_observation: Observation | None) -> str | None:
    if final_observation is None:
        return None
    ref = final_observation.ref.strip()
    if _looks_like_screenshot_ref(ref):
        return ref
    return None


def _directory_evidence_refs(
    steps: Sequence[LoopStep],
    final_observation: Observation | None,
) -> dict[str, list[str]]:
    artifact_refs: list[str] = []
    data_refs: list[str] = []
    if final_observation is not None:
        refs = _refs_from_directory_evidence_fields(final_observation.artifacts)
        artifact_refs.extend(refs["artifactRefs"])
        data_refs.extend(refs["dataRefs"])
        refs = _refs_from_directory_evidence_fields(final_observation.metadata)
        artifact_refs.extend(refs["artifactRefs"])
        data_refs.extend(refs["dataRefs"])
    for step in reversed(steps):
        if step.verification is None:
            continue
        refs = _refs_from_directory_evidence_fields(step.verification.metadata)
        artifact_refs.extend(refs["artifactRefs"])
        data_refs.extend(refs["dataRefs"])
        if artifact_refs or data_refs:
            break
    return {
        "artifactRefs": _unique_strings(ref for ref in artifact_refs if _looks_like_artifact_or_data_evidence_ref(ref)),
        "dataRefs": _unique_strings(ref for ref in data_refs if _looks_like_artifact_or_data_evidence_ref(ref)),
    }


def _refs_from_directory_evidence_fields(value: Any, *, in_directory_record: bool = False) -> dict[str, list[str]]:
    artifact_refs: list[str] = []
    data_refs: list[str] = []
    if isinstance(value, Mapping):
        record_context = in_directory_record or _looks_like_directory_evidence_record(value)
        for key, item in value.items():
            normalized = str(key).replace("_", "").replace("-", "").lower()
            key_context = record_context or any(token in normalized for token in ("filelist", "directorylisting", "directoryevidence"))
            if key_context:
                if normalized in {"dataref", "datarefs", "rawref", "rawrefs", "filelistdataref", "filelistdatarefs"}:
                    data_refs.extend(_refs_inside(item))
                elif normalized in {
                    "artifactref",
                    "artifactrefs",
                    "outputref",
                    "outputrefs",
                    "ref",
                    "refs",
                    "path",
                    "filelistartifactref",
                    "filelistartifactrefs",
                    "directorylistingref",
                    "directorylistingrefs",
                }:
                    artifact_refs.extend(_refs_inside(item))
            if isinstance(item, (Mapping, list, tuple)):
                nested = _refs_from_directory_evidence_fields(item, in_directory_record=key_context)
                artifact_refs.extend(nested["artifactRefs"])
                data_refs.extend(nested["dataRefs"])
    elif isinstance(value, (list, tuple)):
        for item in value:
            nested = _refs_from_directory_evidence_fields(item, in_directory_record=in_directory_record)
            artifact_refs.extend(nested["artifactRefs"])
            data_refs.extend(nested["dataRefs"])
    return {
        "artifactRefs": _unique_strings(artifact_refs),
        "dataRefs": _unique_strings(data_refs),
    }


def _looks_like_directory_evidence_record(value: Mapping[str, Any]) -> bool:
    schema = str(value.get("schemaVersion") or value.get("schema_version") or "").lower()
    kind = str(value.get("kind") or value.get("type") or "").lower()
    return "file-list" in schema or "filelist" in schema or "directory" in schema or "file-list" in kind or "filelist" in kind or "directory" in kind


def _looks_like_visible_artifact_record(value: Mapping[str, Any]) -> bool:
    if _looks_like_directory_evidence_record(value):
        return False
    schema = str(value.get("schemaVersion") or value.get("schema_version") or "")
    delivery = str(value.get("delivery") or "")
    status = str(value.get("status") or "")
    kind = str(value.get("kind") or value.get("type") or "")
    return (
        schema == "sciforge.computer-use.virtual-remote-artifact.v1"
        or delivery == "virtual-remote-session-artifact"
        or status in {"visible-and-saved", "saved", "final"}
        or any(token in kind.lower() for token in ("artifact", "document", "index", "report", "deck", "presentation"))
    )


def _refs_inside(value: Any) -> list[str]:
    refs: list[str] = []
    if isinstance(value, str):
        refs.append(value)
    elif isinstance(value, Mapping):
        for item in value.values():
            refs.extend(_refs_inside(item))
    elif isinstance(value, (list, tuple)):
        for item in value:
            refs.extend(_refs_inside(item))
    return _unique_strings(refs)


def _looks_like_final_artifact_ref(value: str) -> bool:
    text = value.strip()
    if not text or text.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
        return False
    if _looks_like_control_evidence_ref(text):
        return False
    if text.startswith(("artifact:", "file:", "ref:")):
        return True
    return (
        text.startswith((".sciforge/", "/"))
        or text.lower().endswith((".json", ".md", ".txt", ".csv", ".tsv", ".xlsx", ".ppt", ".pptx", ".pdf", ".doc", ".docx", ".odt", ".ods"))
    )


def _looks_like_artifact_or_data_evidence_ref(value: str) -> bool:
    return _looks_like_final_artifact_ref(value)


def _looks_like_screenshot_ref(value: str) -> bool:
    text = value.strip().lower()
    return text.endswith((".png", ".jpg", ".jpeg", ".webp")) or text.startswith(("screenshot:", "capture:"))


def _looks_like_control_evidence_ref(value: str) -> bool:
    name = value.strip().split("/")[-1].lower()
    return name in {
        "vision-trace.json",
        "host-ports.json",
        "tool-payload.json",
        "gui-present.json",
        "gui-ask-user.json",
        "approval-request.json",
        "risk-audit.json",
        "confirmed-request.json",
        "blocked-manifest.json",
        "repair-hint.json",
        "continuation-request.json",
        "directory-listing.json",
        "computer-use-request.json",
        "gateway-request.json",
        "request.json",
        "independent-input-adapter.json",
        "virtual-remote-session.json",
        "action-ledger.json",
        "failure-diagnostics.json",
        "cu-user-acceptance-manifest.json",
        "cu-user-acceptance-input.json",
        "cu-l3-independent-input-verifier.json",
    }


def _unique_strings(values: Sequence[Any] | Any) -> list[str]:
    seen: set[str] = set()
    unique: list[str] = []
    for value in values:
        if not isinstance(value, str):
            continue
        text = value.strip()
        if not text or text in seen:
            continue
        seen.add(text)
        unique.append(text)
    return unique


def _coerce_request(value: ComputerUseRequest | Mapping[str, Any] | str) -> ComputerUseRequest:
    if isinstance(value, ComputerUseRequest):
        return value
    if isinstance(value, str):
        return ComputerUseRequest(task=value)
    return ComputerUseRequest(
        task=str(value.get("task") or value.get("text") or ""),
        schema_version=str(value.get("schema_version") or value.get("schemaVersion") or "sciforge.computer-use.request.v1"),
        max_steps=int(value.get("max_steps") or value.get("maxSteps") or 12),
        risk_policy=value.get("risk_policy") or value.get("riskPolicy") or "fail-closed",  # type: ignore[arg-type]
        approval_ref=value.get("approval_ref") or value.get("approvalRef") or value.get("humanApprovalRef"),
        providers=value.get("providers") or {},
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
    metadata = dict(value.get("metadata") or {})
    coordinate_keys = [
        key for key in ("x", "y", "fromX", "fromY", "toX", "toY", "coordinates")
        if key in value
    ]
    if coordinate_keys:
        metadata["plannerContractIssue"] = "coordinate-output"
        metadata["plannerCoordinateKeys"] = coordinate_keys
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
        metadata=metadata,
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
        try:
            metadata = normalize_verifier_metadata(value.metadata)
        except ValueError as exc:
            return Verification(ok=False, done=False, reason=str(exc), metadata={})
        return replace(value, metadata=metadata)
    try:
        metadata = normalize_verifier_metadata(value.get("metadata") or {})
    except ValueError as exc:
        return Verification(ok=False, done=False, reason=str(exc), metadata={})
    return Verification(
        ok=bool(value.get("ok", value.get("status") != "failed")),
        done=bool(value.get("done", False)),
        reason=str(value.get("reason") or ""),
        confidence=value.get("confidence"),
        changed=value.get("changed"),
        metadata=metadata,
    )


def _asdict(value: Any) -> dict[str, Any]:
    if not is_dataclass(value):
        return dict(value)
    return {field.name: getattr(value, field.name) for field in fields(value)}


class _HostPortSense:
    def __init__(self, host_ports: ComputerUseHostPorts):
        self.host_ports = host_ports

    def observe(self, request: ComputerUseRequest, history: Sequence[LoopStep], query: str | None = None):
        return _call_required_port(self.host_ports, "capture", request, history, query=query)

    def query(self, observation: Observation, question: str, history: Sequence[LoopStep]):
        return _call_optional_port(self.host_ports, "query", observation, question, history) or {
            "answer": observation.summary,
            "source": "observation-summary",
        }

    def locate(self, observation: Observation, target: ActionTarget, history: Sequence[LoopStep]):
        return _call_required_port(self.host_ports, "locate", observation, target, history)

    def crop(self, observation: Observation, region: Mapping[str, Any]):
        return _call_optional_port(self.host_ports, "crop", observation, region)


class _HostPortPlanner:
    def __init__(self, host_ports: ComputerUseHostPorts):
        self.host_ports = host_ports

    def plan(self, request: ComputerUseRequest, observation: Observation, history: Sequence[LoopStep]):
        return _call_required_port(self.host_ports, "plan", request, observation, history)


class _HostPortExecutor:
    def __init__(self, host_ports: ComputerUseHostPorts):
        self.host_ports = host_ports

    def execute(self, action: ActionPlan, grounding: Grounding | None, request: ComputerUseRequest):
        return _call_required_port(self.host_ports, "execute", action, grounding, request)


class _HostPortVerifier:
    def __init__(self, host_ports: ComputerUseHostPorts):
        self.host_ports = host_ports

    def verify(
        self,
        request: ComputerUseRequest,
        before: Observation,
        after: Observation,
        action: ActionPlan,
        execution: ExecutionOutcome,
        history: Sequence[LoopStep],
    ):
        return _call_required_port(self.host_ports, "verify", request, before, after, action, execution, history)


def _call_required_port(host_ports: Any, name: str, *args: Any, **kwargs: Any) -> Any:
    port = _port_callable(host_ports, name)
    if port is None:
        raise ValueError(f"Computer Use host port {name!r} is required.")
    return _call_port(port, *args, **kwargs)


def _call_optional_port(host_ports: Any, name: str, *args: Any, **kwargs: Any) -> Any:
    port = _port_callable(host_ports, name)
    if port is None:
        return None
    return _call_port(port, *args, **kwargs)


def _port_callable(host_ports: Any, name: str) -> Any:
    if isinstance(host_ports, Mapping):
        return host_ports.get(name) or host_ports.get(_snake_to_camel(name))
    return getattr(host_ports, name, None) or getattr(host_ports, _snake_to_camel(name), None)


def _missing_required_host_ports(host_ports: Any) -> list[str]:
    required = ["capture", "plan", "execute", "locate", "verify"]
    return [name for name in required if not callable(_port_callable(host_ports, name))]


def _call_port(port: Any, *args: Any, **kwargs: Any) -> Any:
    try:
        return port(*args, **kwargs)
    except TypeError:
        if kwargs:
            return port(*args)
        raise


def _snake_to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part[:1].upper() + part[1:] for part in tail)


_SUPPORTED_ACTION_KINDS = {
    "open_app",
    "click",
    "double_click",
    "drag",
    "type_text",
    "press_key",
    "hotkey",
    "scroll",
    "wait",
    "focus",
    "save",
}


def _planner_contract_issue(plan: ActionPlan) -> PlannerContractIssue | None:
    explicit = plan.metadata.get("plannerContractIssue")
    if explicit in {"coordinate-output", "app-private-shortcut", "unsupported-action", "empty-action"}:
        return explicit  # type: ignore[return-value]
    if plan.kind is None:
        return "empty-action"
    if plan.kind not in _SUPPORTED_ACTION_KINDS:
        return "unsupported-action"
    if plan.kind == "hotkey" and _looks_like_app_private_shortcut(plan):
        return "app-private-shortcut"
    return None


def _request_contract_issue(request: ComputerUseRequest) -> str:
    if request.schema_version != "sciforge.computer-use.request.v1":
        return f"Unsupported Computer Use request schema_version={request.schema_version!r}."
    if not request.task.strip():
        return "Computer Use request task must be non-empty."
    if request.max_steps < 1:
        return "Computer Use request max_steps must be at least 1."
    if request.risk_policy not in {"fail-closed", "allow-confirmed"}:
        return f"Unsupported Computer Use risk_policy={request.risk_policy!r}; failing closed."
    return ""


def _looks_like_app_private_shortcut(plan: ActionPlan) -> bool:
    if plan.metadata.get("appPrivateShortcut") is True:
        return True
    if str(plan.metadata.get("shortcutScope") or "").lower() == "app-private":
        return True
    keys = _normalized_hotkey_tokens(plan)
    if not keys:
        return True
    combo = "+".join(keys)
    return combo not in {
        "command+n",
        "command+s",
        "command+space",
        "command+tab",
        "ctrl+n",
        "ctrl+s",
        "alt+tab",
    }


def _normalized_hotkey_tokens(plan: ActionPlan) -> tuple[str, ...]:
    raw_keys: Sequence[str]
    if plan.keys:
        raw_keys = plan.keys
    elif plan.key:
        raw_keys = tuple(part for part in str(plan.key).replace("-", "+").split("+"))
    else:
        raw_keys = ()
    aliases = {
        "cmd": "command",
        "meta": "command",
        "super": "command",
        "control": "ctrl",
        "option": "alt",
    }
    return tuple(
        aliases.get(key.strip().lower(), key.strip().lower())
        for key in raw_keys
        if key.strip()
    )


def _planner_contract_reason(issue: PlannerContractIssue, plan: ActionPlan | None = None) -> str:
    if issue == "empty-action" and plan and plan.reason:
        return plan.reason
    if issue == "coordinate-output":
        return "Planner output coordinates, which violates the generic planner contract. Coordinates must come from Grounder."
    if issue == "app-private-shortcut":
        return "Planner emitted an app-private shortcut. Use generic visible GUI actions or platform launcher/navigation commands."
    if issue == "unsupported-action":
        return "Planner emitted an unsupported generic action. Use open_app, click, double_click, drag, type_text, press_key, hotkey, scroll, wait, focus, or save."
    return "Planner returned no executable generic action."


def _approval_request(
    request: ComputerUseRequest,
    plan: ActionPlan,
    risk_level: str,
    reason: str,
    action_index: int,
    observation: Observation,
) -> ApprovalRequest:
    target = plan.target.description if plan.target else plan.app_name or plan.kind or "unknown-action"
    digest = hashlib.sha256(f"{request.task}\n{action_index}\n{target}".encode("utf8")).hexdigest()[:16]
    approval_id = f"approval:computer-use:{digest}"
    return ApprovalRequest(
        id=approval_id,
        reason=reason,
        action_kind=str(plan.kind or "unknown"),
        risk_level=risk_level,  # type: ignore[arg-type]
        blocked_action_index=action_index,
        confirmation_text=(
            str(plan.metadata.get("confirmationText"))
            if plan.metadata.get("confirmationText")
            else f"Approve Computer Use action {plan.kind or 'unknown'} for target {target!r}."
        ),
        refs=tuple(ref for ref in [observation.ref, request.approval_ref] if ref),
        metadata={
            "riskPolicy": request.risk_policy,
            "approvalRef": request.approval_ref,
            "target": target,
        },
    )
