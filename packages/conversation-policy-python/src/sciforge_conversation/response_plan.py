"""Response and background completion policy for conversation turns.

This module keeps user-visible response timing decisions in Python so runtime
shells can execute a policy result instead of rebuilding strategy rules.
"""

from __future__ import annotations

from typing import Any, Mapping


JsonMap = dict[str, Any]

_RISK_RANK = {"none": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}


def build_response_plan(request: Mapping[str, Any] | Any) -> JsonMap:
    data = _mapping(request)
    mode = _execution_mode(data)
    risk = _risk_level(data)
    stage_hint = _string_list(_execution(data).get("stagePlanHint"))
    risk_flags = set(_string_list(_execution(data).get("riskFlags")))
    context_mode = str(_context(data).get("mode") or "")

    initial_mode = _initial_response_mode(mode, risk, risk_flags)
    progress = _progress_phases(mode, stage_hint, risk_flags)
    finalization_mode = _finalization_mode(mode, risk, initial_mode)

    return {
        "schemaVersion": "sciforge.conversation.response-plan.v1",
        "initialResponseMode": initial_mode,
        "finalizationMode": finalization_mode,
        "userVisibleProgress": progress,
        "progressPhases": progress,
        "fallbackMessagePolicy": _fallback_message_policy(mode, risk, risk_flags),
        "backgroundCompletionSummary": _background_summary(mode, risk, context_mode),
        "reason": _reason(mode, risk, initial_mode, risk_flags),
        "signals": {
            "executionMode": mode,
            "contextMode": context_mode,
            "riskLevel": risk,
            "riskFlags": sorted(risk_flags),
        },
    }


def build_background_plan(request: Mapping[str, Any] | Any) -> JsonMap:
    data = _mapping(request)
    mode = _execution_mode(data)
    risk = _risk_level(data)
    risk_flags = set(_string_list(_execution(data).get("riskFlags")))
    has_refs = bool(_list(data.get("currentReferenceDigests")) or _list(data.get("currentReferences")))
    has_artifacts = bool(_artifact_entries(data))
    has_verifier = _has_selected_kind(data, "verifier") or "verifier" in _execution(data).get("signals", [])

    tasks = _background_tasks(mode, risk, risk_flags, has_refs, has_artifacts, has_verifier)
    enabled = bool(tasks) and risk != "high" and mode != "direct-context-answer"

    return {
        "schemaVersion": "sciforge.conversation.background-plan.v1",
        "enabled": enabled,
        "tasks": tasks,
        "handoffRefsRequired": _handoff_refs_required(mode, risk, has_refs, has_artifacts, risk_flags),
        "cancelOnNewUserTurn": _cancel_on_new_user_turn(mode, risk, risk_flags),
        "reason": _background_reason(mode, risk, tasks, enabled),
        "signals": {
            "executionMode": mode,
            "riskLevel": risk,
            "hasCurrentRefs": has_refs,
            "hasArtifactIndex": has_artifacts,
            "riskFlags": sorted(risk_flags),
        },
    }


def _initial_response_mode(mode: str, risk: str, risk_flags: set[str]) -> str:
    if risk == "high":
        return "wait-for-result"
    if mode == "direct-context-answer":
        return "direct-context-answer"
    if mode == "thin-reproducible-adapter":
        return "quick-status"
    if mode == "repair-or-continue-project":
        return "quick-status"
    if mode == "multi-stage-project":
        return "quick-status"
    if "external-information-required" in risk_flags:
        return "streaming-draft"
    return "streaming-draft"


def _finalization_mode(mode: str, risk: str, initial_mode: str) -> str:
    if mode == "direct-context-answer":
        return "update-artifacts-only"
    if risk == "high" or initial_mode == "wait-for-result":
        return "append-final"
    if initial_mode == "streaming-draft":
        return "replace-draft"
    return "append-final"


def _progress_phases(mode: str, stage_hint: list[str], risk_flags: set[str]) -> list[str]:
    if mode == "direct-context-answer":
        return ["answer"]
    phases = stage_hint or ["plan", "analyze", "emit"]
    if phases and phases[0] != "plan" and mode in {"multi-stage-project", "repair-or-continue-project"}:
        phases = ["plan", *phases]
    if "recent-failure" in risk_flags and "repair" not in phases:
        phases = [*phases[:-1], "repair", phases[-1]] if phases else ["repair"]
    return _dedupe(phases)


def _fallback_message_policy(mode: str, risk: str, risk_flags: set[str]) -> str:
    if risk == "high":
        return "safety-first-status-with-required-confirmation"
    if "recent-failure" in risk_flags:
        return "truthful-repair-status-with-next-step"
    if mode == "direct-context-answer":
        return "truthful-direct-answer-with-current-refs"
    return "truthful-partial-with-next-step"


def _background_tasks(
    mode: str,
    risk: str,
    risk_flags: set[str],
    has_refs: bool,
    has_artifacts: bool,
    has_verifier: bool,
) -> list[str]:
    if mode == "direct-context-answer":
        return []
    tasks: list[str] = []
    if mode in {"thin-reproducible-adapter", "multi-stage-project"}:
        tasks.append("evidence-completion")
    if mode in {"single-stage-task", "multi-stage-project", "repair-or-continue-project"}:
        tasks.append("artifact-materialization")
    if has_verifier or risk in {"medium", "high"} or "code-or-workspace-side-effect" in risk_flags:
        tasks.append("verification")
    if has_refs:
        tasks.append("reference-digest-refresh")
    if has_artifacts:
        tasks.append("artifact-index-refresh")
    if mode == "repair-or-continue-project" or "recent-failure" in risk_flags:
        tasks.append("failure-recovery")
    if risk == "high":
        tasks.append("blocking-handoff-precheck")
    return _dedupe(tasks)


def _handoff_refs_required(
    mode: str,
    risk: str,
    has_refs: bool,
    has_artifacts: bool,
    risk_flags: set[str],
) -> bool:
    return (
        mode != "direct-context-answer"
        or risk in {"medium", "high"}
        or has_refs
        or has_artifacts
        or bool(risk_flags)
    )


def _cancel_on_new_user_turn(mode: str, risk: str, risk_flags: set[str]) -> bool:
    if risk == "high":
        return True
    if "code-or-workspace-side-effect" in risk_flags:
        return True
    return mode in {"thin-reproducible-adapter", "single-stage-task"}


def _background_summary(mode: str, risk: str, context_mode: str) -> str:
    if mode == "direct-context-answer":
        return "No background completion is required for a current-context answer."
    if risk == "high":
        return "Background completion is disabled until required safety checks complete."
    if context_mode == "repair":
        return "Repair evidence and final artifacts may complete after the initial status."
    return "Non-blocking evidence, artifact, or verification work may continue after the initial response."


def _reason(mode: str, risk: str, initial_mode: str, risk_flags: set[str]) -> str:
    parts = [f"{mode} uses {initial_mode}", f"risk={risk}"]
    if risk_flags:
        parts.append("flags=" + ",".join(sorted(risk_flags)[:4]))
    return "; ".join(parts)


def _background_reason(mode: str, risk: str, tasks: list[str], enabled: bool) -> str:
    if not tasks:
        return f"{mode} has no background tasks."
    if not enabled:
        return f"{mode} background tasks are blocked by {risk} risk."
    return f"{mode} can continue background tasks: {', '.join(tasks[:4])}."


def _risk_level(data: Mapping[str, Any]) -> str:
    rank = 1
    for item in _selected_capabilities(data):
        if isinstance(item, Mapping):
            rank = max(rank, _RISK_RANK.get(str(item.get("riskLevel") or "low").lower(), 1))
    risk_flags = set(_string_list(_execution(data).get("riskFlags")))
    if "code-or-workspace-side-effect" in risk_flags:
        rank = max(rank, 2)
    if _has_selected_kind(data, "action"):
        rank = max(rank, 2)
    if any(_capability_text(item).find("high") >= 0 for item in _selected_capabilities(data)):
        rank = max(rank, 3)
    return {0: "low", 1: "low", 2: "medium", 3: "high", 4: "high"}.get(rank, "low")


def _execution_mode(data: Mapping[str, Any]) -> str:
    return str(_execution(data).get("executionMode") or "single-stage-task")


def _execution(data: Mapping[str, Any]) -> Mapping[str, Any]:
    return _mapping(data.get("executionModePlan") or data.get("execution") or {})


def _context(data: Mapping[str, Any]) -> Mapping[str, Any]:
    return _mapping(data.get("contextPolicy") or {})


def _selected_capabilities(data: Mapping[str, Any]) -> list[Any]:
    brief = _mapping(data.get("capabilityBrief") or {})
    policy_input = _mapping(data.get("policyInput") or {})
    hints = _mapping(policy_input.get("policyHints") or {})
    metadata = _mapping(policy_input.get("metadata") or {})
    return [
        *_list(brief.get("selected")),
        *_list(hints.get("selectedCapabilities")),
        *_list(hints.get("selectedActions")),
        *_list(hints.get("selectedVerifiers")),
        *_list(metadata.get("selectedCapabilities")),
        *_list(metadata.get("selectedActions")),
        *_list(metadata.get("selectedVerifiers")),
    ]


def _has_selected_kind(data: Mapping[str, Any], kind: str) -> bool:
    return any(
        isinstance(item, Mapping) and str(item.get("kind") or "").lower() == kind
        for item in _selected_capabilities(data)
    )


def _artifact_entries(data: Mapping[str, Any]) -> list[Any]:
    index = _mapping(data.get("artifactIndex") or {})
    return _list(index.get("entries"))


def _capability_text(value: Any) -> str:
    if not isinstance(value, Mapping):
        return str(value or "").lower()
    return " ".join(
        str(value.get(key) or "")
        for key in ("id", "title", "kind", "reason", "riskLevel")
    ).lower()


def _mapping(value: Any) -> Mapping[str, Any]:
    if isinstance(value, Mapping):
        return value
    return {}


def _list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _string_list(value: Any) -> list[str]:
    return [str(item) for item in _list(value) if item is not None]


def _dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value and value not in seen:
            seen.add(value)
            result.append(value)
    return result
