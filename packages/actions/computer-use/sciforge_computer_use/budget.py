"""CapabilityBudgetDebit helpers for the package-level Computer Use loop."""

from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
from typing import Any, Mapping, Sequence

from .contracts import ComputerUseRequest, LoopStep


CAPABILITY_BUDGET_DEBIT_CONTRACT_ID = "sciforge.capability-budget-debit.v1"
CAPABILITY_BUDGET_DEBIT_SCHEMA_VERSION = 1
COMPUTER_USE_CAPABILITY_ID = "action.sciforge.computer-use"


def stable_loop_id(request: ComputerUseRequest) -> str:
    """Return a stable sink id for a loop invocation."""

    for key in ("stableId", "stable_id", "runId", "run_id", "invocationId", "invocation_id", "taskId", "task_id"):
        value = request.metadata.get(key)
        if isinstance(value, str) and value.strip():
            return _sanitize_id(value)
    digest = sha256(
        f"{request.task}|{request.max_steps}|{request.risk_policy}|{dict(request.window_target or {})}".encode("utf-8")
    ).hexdigest()
    return digest[:12]


def create_loop_budget_debit(request: ComputerUseRequest, steps: Sequence[LoopStep], status: str) -> dict[str, Any]:
    """Create one CapabilityBudgetDebit record for a Computer Use loop result."""

    loop_id = stable_loop_id(request)
    action_steps = sum(1 for step in steps if step.plan.kind is not None)
    observe_refs = _unique_strings(
        [step.before.ref for step in steps]
        + [step.after.ref for step in steps if step.after is not None]
    )
    observe_calls = len(observe_refs)
    cost_units = action_steps + observe_calls
    audit_ref = f"audit:computer-use-loop:{loop_id}"
    execution_unit_ref = f"executionUnit:computer-use-loop:{loop_id}"
    work_evidence_ref = f"workEvidence:computer-use-loop:{loop_id}"
    debit_lines = [
        {
            "dimension": "actionSteps",
            "amount": action_steps,
            "limit": request.max_steps,
            "remaining": request.max_steps - action_steps,
            "reason": "generic Computer Use action steps executed or blocked",
            "sourceRef": execution_unit_ref,
        },
        {
            "dimension": "observeCalls",
            "amount": observe_calls,
            "reason": "observations captured by the package-level Computer Use loop",
            "sourceRef": audit_ref,
        },
        {
            "dimension": "costUnits",
            "amount": cost_units,
            "reason": "package-level Computer Use loop action and observation cost units",
            "sourceRef": audit_ref,
        },
    ]
    return {
        "contract": CAPABILITY_BUDGET_DEBIT_CONTRACT_ID,
        "schemaVersion": CAPABILITY_BUDGET_DEBIT_SCHEMA_VERSION,
        "debitId": f"budgetDebit:computer-use-loop:{loop_id}",
        "invocationId": f"capabilityInvocation:computer-use-loop:{loop_id}",
        "capabilityId": COMPUTER_USE_CAPABILITY_ID,
        "candidateId": "package.python.sciforge_computer_use",
        "manifestRef": f"capability:{COMPUTER_USE_CAPABILITY_ID}",
        "subjectRefs": observe_refs,
        "debitLines": debit_lines,
        "exceeded": any(
            isinstance(line.get("remaining"), (int, float)) and line["remaining"] < 0
            for line in debit_lines
        ),
        "exhaustedDimensions": [
            line["dimension"]
            for line in debit_lines
            if isinstance(line.get("remaining"), (int, float)) and line["remaining"] <= 0
        ],
        "sinkRefs": {
            "executionUnitRef": execution_unit_ref,
            "workEvidenceRefs": [work_evidence_ref],
            "auditRefs": [audit_ref],
        },
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "metadata": {
            "status": status,
            "stepCount": len(steps),
            "blockedStepCount": sum(1 for step in steps if step.status == "blocked"),
            "failedStepCount": sum(1 for step in steps if step.status == "failed"),
        },
    }


def _sanitize_id(value: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in "-_." else "-" for ch in value.strip())
    cleaned = "-".join(part for part in cleaned.split("-") if part)
    return cleaned[:80] or "loop"


def _unique_strings(values: Sequence[Any]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if not isinstance(value, str):
            continue
        item = value.strip()
        if not item or item in seen:
            continue
        seen.add(item)
        result.append(item)
    return result
