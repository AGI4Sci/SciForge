"""Latency policy for first response, retry, and blocking behavior.

The policy is deliberately based on generic execution, risk, verification,
context-budget, and recovery signals. It must not branch on scenario IDs,
providers, or prompt-specific cases.
"""

from __future__ import annotations

from typing import Any, Mapping, Sequence


JsonMap = dict[str, Any]

FAST_FIRST_VISIBLE_MS = 1200
STANDARD_FIRST_VISIBLE_MS = 3000
WAIT_FIRST_VISIBLE_MS = 8000
FAST_WARNING_MS = 8000
STANDARD_WARNING_MS = 12000
WAIT_WARNING_MS = 18000
STANDARD_SILENT_RETRY_MS = 45000
BLOCKING_SILENT_RETRY_MS = 60000

HIGH_RISK_WORDS = {
    "critical",
    "dangerous",
    "delete",
    "destructive",
    "external-write",
    "high",
    "modify-credentials",
    "payment",
    "publish",
    "send-message",
    "write",
}


def build_latency_policy(request: Mapping[str, Any] | Any) -> JsonMap:
    """Return the canonical latency policy for a conversation turn."""

    data = _mapping(request)
    policy_input = _mapping(data.get("policyInput") or data.get("policy_input") or data)
    goal = _mapping(data.get("goalSnapshot") or data.get("goal_snapshot"))
    context = _mapping(data.get("contextPolicy") or data.get("context_policy"))
    execution = _mapping(data.get("executionModePlan") or data.get("execution_mode_plan"))
    capability = _mapping(data.get("capabilityBrief") or data.get("capability_brief"))
    recovery = _mapping(data.get("recoveryPlan") or data.get("recovery_plan"))

    selected_actions = _selected_actions(policy_input, capability)
    selected_verifiers = _selected_verifiers(policy_input, capability, execution)
    recent_failures = _recent_failures(policy_input, recovery)
    guidance = _user_guidance(policy_input)
    all_selected = [*selected_actions, *selected_verifiers, *_selected_capabilities(capability)]

    execution_mode = _text(execution.get("executionMode"))
    signals = _string_set(execution.get("signals"))
    risk_flags = _string_set(execution.get("riskFlags"))
    context_mode = _text(context.get("mode"))

    reasons: list[str] = []
    blocking_reasons: list[str] = []
    if _has_human_approval_required(policy_input, all_selected):
        blocking_reasons.append("human approval required")
    if _has_high_risk_action(selected_actions, all_selected, risk_flags):
        blocking_reasons.append("high-risk action")
    if selected_actions:
        blocking_reasons.append("selected action requires foreground execution")
    if _has_failed_verification(policy_input, recovery, recent_failures):
        blocking_reasons.append("failed verification")

    has_repair_signal = (
        "repair" in signals
        or context_mode == "repair"
        or goal.get("taskRelation") == "repair"
        or bool(recent_failures)
    )
    has_verification_work = bool(selected_verifiers) or "verifier" in signals
    context_near_limit = _context_near_limit(policy_input, context)

    direct_context = execution_mode == "direct-context-answer"
    low_risk_continuation = (
        execution_mode == "repair-or-continue-project"
        and "continuation" in signals
        and "repair" not in signals
        and not guidance
        and not recent_failures
        and not selected_actions
        and not selected_verifiers
        and not _has_high_risk_action([], all_selected, risk_flags)
    )
    light_lookup = execution_mode == "thin-reproducible-adapter"
    multi_stage = execution_mode == "multi-stage-project"

    block_on_context_compaction = context_near_limit
    block_on_verification = bool(blocking_reasons or has_repair_signal or has_verification_work or multi_stage)
    allow_background = _allow_background(
        direct_context=direct_context,
        low_risk_continuation=low_risk_continuation,
        light_lookup=light_lookup,
        multi_stage=multi_stage,
        blocking_reasons=blocking_reasons,
        context_near_limit=context_near_limit,
        has_repair_signal=has_repair_signal,
    )

    if blocking_reasons:
        reasons.extend(_dedupe(blocking_reasons))
    if context_near_limit:
        reasons.append("context near limit; compaction must finish before sending")
    if direct_context:
        reasons.append("direct context answer can be made from current conversation state")
    elif low_risk_continuation:
        reasons.append("low-risk continuation can respond first and complete evidence in background")
    elif light_lookup:
        reasons.append("light reproducible lookup can show quick progress while external information arrives")
    elif has_repair_signal:
        reasons.append("repair/failure path must wait for validation evidence")
    elif multi_stage:
        reasons.append("multi-stage work may stream progress but final success waits for verification")
    else:
        reasons.append("standard task policy")

    first_visible, first_warning, retry = _timings(
        direct_context=direct_context,
        low_risk_continuation=low_risk_continuation,
        light_lookup=light_lookup,
        blocking=bool(blocking_reasons or has_repair_signal or context_near_limit),
    )
    return {
        "schemaVersion": "sciforge.conversation.latency-policy.v1",
        "firstVisibleResponseMs": first_visible,
        "firstEventWarningMs": first_warning,
        "silentRetryMs": retry,
        "allowBackgroundCompletion": allow_background,
        "blockOnContextCompaction": block_on_context_compaction,
        "blockOnVerification": block_on_verification,
        "reason": "; ".join(_dedupe(reasons)),
    }


def _allow_background(
    *,
    direct_context: bool,
    low_risk_continuation: bool,
    light_lookup: bool,
    multi_stage: bool,
    blocking_reasons: Sequence[str],
    context_near_limit: bool,
    has_repair_signal: bool,
) -> bool:
    if blocking_reasons or context_near_limit or has_repair_signal:
        return False
    if direct_context:
        return False
    return low_risk_continuation or light_lookup or multi_stage


def _timings(
    *,
    direct_context: bool,
    low_risk_continuation: bool,
    light_lookup: bool,
    blocking: bool,
) -> tuple[int, int, int]:
    if direct_context or low_risk_continuation:
        return FAST_FIRST_VISIBLE_MS, FAST_WARNING_MS, STANDARD_SILENT_RETRY_MS
    if light_lookup:
        return STANDARD_FIRST_VISIBLE_MS, STANDARD_WARNING_MS, STANDARD_SILENT_RETRY_MS
    if blocking:
        return WAIT_FIRST_VISIBLE_MS, WAIT_WARNING_MS, BLOCKING_SILENT_RETRY_MS
    return STANDARD_FIRST_VISIBLE_MS, STANDARD_WARNING_MS, STANDARD_SILENT_RETRY_MS


def _selected_actions(policy_input: Mapping[str, Any], capability: Mapping[str, Any]) -> list[Any]:
    values: list[Any] = []
    for source in _policy_sources(policy_input):
        values.extend(_sequence(_first(source, "selectedActions", "actions", "selected_actions")))
    values.extend(_sequence(capability.get("selectedActions")))
    values.extend(
        item for item in _sequence(capability.get("selected"))
        if isinstance(item, Mapping) and _text(item.get("kind")).lower() == "action"
    )
    return values


def _selected_verifiers(
    policy_input: Mapping[str, Any],
    capability: Mapping[str, Any],
    execution: Mapping[str, Any],
) -> list[Any]:
    values: list[Any] = []
    for source in _policy_sources(policy_input):
        values.extend(_sequence(_first(source, "selectedVerifiers", "verifiers", "selected_verifiers")))
    values.extend(_sequence(capability.get("selectedVerifiers")))
    values.extend(_sequence(execution.get("selectedVerifiers")))
    values.extend(
        item for item in _sequence(capability.get("selected"))
        if isinstance(item, Mapping) and _text(item.get("kind")).lower() == "verifier"
    )
    return values


def _selected_capabilities(capability: Mapping[str, Any]) -> list[Any]:
    return [
        *_sequence(capability.get("selected")),
        *_sequence(capability.get("selectedSkills")),
        *_sequence(capability.get("selectedTools")),
        *_sequence(capability.get("selectedSenses")),
    ]


def _recent_failures(policy_input: Mapping[str, Any], recovery: Mapping[str, Any]) -> list[Any]:
    failures: list[Any] = []
    for source in _policy_sources(policy_input):
        failures.extend(_sequence(_first(source, "recentFailures", "failures")))
        failure = source.get("failure")
        if failure:
            failures.append(failure)
    session = _mapping(policy_input.get("session"))
    failures.extend(
        item for item in _sequence(session.get("runs"))
        if isinstance(item, Mapping) and _text(item.get("status")).lower() in {"failed", "failure", "error"}
    )
    if _text(recovery.get("status")).lower() in {"failed", "failure", "error"}:
        failures.append(recovery)
    return failures


def _user_guidance(policy_input: Mapping[str, Any]) -> list[Any]:
    for source in _policy_sources(policy_input):
        queue = _sequence(_first(source, "userGuidanceQueue", "guidanceQueue", "guidance"))
        if queue:
            return queue
    return []


def _has_human_approval_required(policy_input: Mapping[str, Any], actions: Sequence[Any]) -> bool:
    for source in _policy_sources(policy_input):
        if source.get("humanApprovalRequired") is True:
            return True
        approval = _mapping(source.get("approval") or source.get("humanApproval"))
        if approval.get("required") is True or _text(approval.get("status")).lower() in {"required", "pending"}:
            return True
    for action in actions:
        mapping = _mapping(action)
        if mapping.get("humanApprovalRequired") is True:
            return True
        approval = _mapping(mapping.get("approval") or mapping.get("humanApproval"))
        if approval.get("required") is True or _text(approval.get("requires")).lower() == "human":
            return True
    return False


def _has_high_risk_action(
    selected_actions: Sequence[Any],
    all_selected: Sequence[Any],
    risk_flags: set[str],
) -> bool:
    if "code-or-workspace-side-effect" in risk_flags:
        return True
    for action in [*selected_actions, *all_selected]:
        mapping = _mapping(action)
        risk_level = _text(mapping.get("riskLevel") or mapping.get("risk_level") or mapping.get("risk")).lower()
        if risk_level in {"high", "critical"}:
            return True
        text = " ".join([
            _text(mapping.get("id")),
            _text(mapping.get("kind")),
            _text(mapping.get("summary")),
            _text(mapping.get("description")),
            " ".join(_text(item) for item in _sequence(mapping.get("sideEffects"))),
            " ".join(_text(item) for item in _sequence(mapping.get("risk"))),
        ]).lower()
        if HIGH_RISK_WORDS.intersection(_tokens(text)):
            return True
    return False


def _has_failed_verification(
    policy_input: Mapping[str, Any],
    recovery: Mapping[str, Any],
    failures: Sequence[Any],
) -> bool:
    for item in [*failures, recovery, *_sequence(policy_input.get("verificationResults"))]:
        mapping = _mapping(item)
        text = " ".join([
            _text(mapping.get("type")),
            _text(mapping.get("stage")),
            _text(mapping.get("status")),
            _text(mapping.get("state")),
            _text(mapping.get("reason")),
            _text(mapping.get("failureReason")),
            _text(mapping.get("error")),
        ]).lower()
        if "verification" in text and any(word in text for word in ("fail", "failed", "failure", "error", "rejected")):
            return True
    return False


def _context_near_limit(policy_input: Mapping[str, Any], context: Mapping[str, Any]) -> bool:
    for source in (_mapping(policy_input.get("limits")), _mapping(policy_input.get("policyHints")), context):
        budget = _mapping(source.get("contextBudget") or source.get("budget"))
        if _budget_near_limit(budget):
            return True
        if source.get("contextNearLimit") is True or source.get("nearContextLimit") is True:
            return True
        remaining = _number(_first(source, "remainingContextTokens", "contextRemainingTokens", "remainingTokens"))
        maximum = _number(_first(source, "maxContextTokens", "contextWindowTokens", "maxTokens", "totalTokens"))
        used = _number(_first(source, "usedContextTokens", "contextTokens", "usedTokens"))
        if remaining is not None and remaining <= 2048:
            return True
        if maximum and used is not None and used / maximum >= 0.88:
            return True
    return False


def _budget_near_limit(budget: Mapping[str, Any]) -> bool:
    if not budget:
        return False
    if budget.get("nearLimit") is True:
        return True
    remaining = _number(_first(budget, "remainingTokens", "remaining", "availableTokens"))
    maximum = _number(_first(budget, "maxTokens", "totalTokens", "limitTokens"))
    used = _number(_first(budget, "usedTokens", "used", "currentTokens"))
    ratio = _number(_first(budget, "usedRatio", "usageRatio", "ratio"))
    if remaining is not None and remaining <= 2048:
        return True
    if ratio is not None and ratio >= 0.88:
        return True
    if maximum and used is not None and used / maximum >= 0.88:
        return True
    return False


def _policy_sources(policy_input: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    return [
        _mapping(policy_input.get("policyHints")),
        _mapping(policy_input.get("metadata")),
        _mapping(policy_input.get("tsDecisions")),
        policy_input,
    ]


def _first(data: Mapping[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in data:
            return data[key]
    return None


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _sequence(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, (str, bytes)):
        return [value.decode() if isinstance(value, bytes) else value]
    if isinstance(value, Sequence):
        return list(value)
    return []


def _string_set(value: Any) -> set[str]:
    return {_text(item) for item in _sequence(value) if _text(item)}


def _tokens(value: str) -> set[str]:
    return {token for token in value.replace("_", "-").replace("/", "-").split() if token}


def _number(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _text(value: Any) -> str:
    return str(value or "").strip()


def _dedupe(values: Sequence[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        normalized = _text(value)
        if normalized and normalized not in seen:
            seen.add(normalized)
            result.append(normalized)
    return result
