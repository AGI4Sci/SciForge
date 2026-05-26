"""Sense-agnostic Computer Use action loop."""

from __future__ import annotations

import hashlib
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
    request_issue = _request_contract_issue(req)
    if request_issue:
        return ComputerUseResult(
            status="failed-with-reason",
            reason=request_issue,
            final_observation=None,
            failure_diagnostics={"failedStage": "request-validation"},
            metrics={},
        )
    steps: list[LoopStep] = []
    final_observation: Observation | None = None

    for index in range(req.max_steps):
        before = _coerce_observation(sense.observe(req, steps))
        final_observation = before
        raw_plan = planner.plan(req, before, steps)
        plan = _coerce_action_plan(raw_plan)

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

        planner_issue = _planner_contract_issue(plan)
        if planner_issue:
            contract_reason = _planner_contract_reason(planner_issue, plan)
            step = LoopStep(
                index=index,
                before=before,
                plan=plan,
                status="failed",
                failure_reason=contract_reason,
            )
            steps.append(step)
            return _result(
                "failed-with-reason",
                contract_reason,
                req,
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
                failure_reason=reason,
            )
            steps.append(step)
            return _result(
                "needs-confirmation",
                reason,
                req,
                steps,
                before,
                {"blockedActionIndex": index, "riskLevel": risk.level},
                _approval_request(req, plan, risk.level, reason, index, before),
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

        if _is_observation_only_wait(plan):
            grounding = _mark_observation_only_grounding(grounding)
            execution = ExecutionOutcome(
                ok=True,
                message="Observation-only wait; executor skipped.",
                metadata={"observationOnly": True},
            )
        else:
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

    final_before = _coerce_observation(
        sense.observe(req, steps, query="final-no-execute-completion-check")
    )
    final_observation = final_before
    final_plan = _coerce_action_plan(planner.plan(req, final_before, steps))
    final_index = len(steps)

    if final_plan.done:
        steps.append(
            LoopStep(
                index=final_index,
                before=final_before,
                plan=final_plan,
                status="done",
            )
        )
        return _result(
            "completed",
            final_plan.reason or "Planner reported task complete after final observation.",
            req,
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
    return _result(
        "max-steps",
        failure_reason,
        req,
        steps,
        final_observation,
        diagnostics,
    )


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
    return plan.kind in {"click", "double_click", "drag", "wait"} and plan.target is not None


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


def _result(
    status: ComputerUseStatus,
    reason: str,
    request: ComputerUseRequest,
    steps: Sequence[LoopStep],
    final_observation: Observation | None,
    diagnostics: Mapping[str, Any] | None = None,
    approval_request: ApprovalRequest | None = None,
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
        final_artifact_refs=tuple(_final_artifact_refs(steps_with_refs, final_observation)),
        approval_request=approval_request,
        failure_diagnostics=dict(diagnostics or {}),
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


def _looks_like_visible_artifact_record(value: Mapping[str, Any]) -> bool:
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


def _looks_like_control_evidence_ref(value: str) -> bool:
    name = value.strip().split("/")[-1].lower()
    return name in {
        "vision-trace.json",
        "host-ports.json",
        "tool-payload.json",
        "gui-present.json",
        "gui-ask-user.json",
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
    keys = tuple(key.strip().lower() for key in plan.keys if key.strip())
    if not keys:
        return True
    normalized = tuple("command" if key in {"cmd", "meta"} else key for key in keys)
    combo = "+".join(normalized)
    return combo not in {
        "command+n",
        "command+space",
        "command+tab",
        "ctrl+n",
        "alt+tab",
    }


def _planner_contract_reason(issue: PlannerContractIssue, plan: ActionPlan | None = None) -> str:
    if issue == "empty-action" and plan and plan.reason:
        return plan.reason
    if issue == "coordinate-output":
        return "Planner output coordinates, which violates the generic planner contract. Coordinates must come from Grounder."
    if issue == "app-private-shortcut":
        return "Planner emitted an app-private shortcut. Use generic visible GUI actions or platform launcher/navigation commands."
    if issue == "unsupported-action":
        return "Planner emitted an unsupported generic action. Use open_app, click, double_click, drag, type_text, press_key, hotkey, scroll, or wait."
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
