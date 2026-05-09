"""Cache reuse policy for SciForge conversation planning.

The runtime owns cache storage, but this module owns the reusable/not-reusable
decision so TypeScript does not need a parallel strategy layer.
"""

from __future__ import annotations

from typing import Any, Mapping


JsonMap = dict[str, Any]

_RISK_RANK = {"none": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}


def build_cache_policy(request: Mapping[str, Any] | Any) -> JsonMap:
    data = _mapping(request)
    execution = _mapping(data.get("executionModePlan") or {})
    context = _mapping(data.get("contextPolicy") or {})
    mode = str(execution.get("executionMode") or "single-stage-task")
    context_mode = str(context.get("mode") or "")
    risk = _risk_level(data)
    risk_flags = set(_string_list(execution.get("riskFlags")))
    recent_failure = "recent-failure" in risk_flags or _has_recent_failure(data)
    explicit_refs = _has_explicit_refs(data)
    digest_state = _digest_state(data)
    artifact_state = _artifact_state(data)
    last_success = _last_successful_stage(data)

    scenario_reuse = context_mode != "isolate" and not recent_failure and risk != "high"
    skill_reuse = risk != "high" and not recent_failure
    ui_reuse = risk != "high" and mode != "repair-or-continue-project"
    reference_reuse = digest_state["hasDigests"] and not digest_state["hasUnresolved"] and (
        context_mode in {"continue", "repair"} or explicit_refs
    )
    artifact_reuse = artifact_state["hasEntries"] and context_mode in {"continue", "repair"}
    last_stage_reuse = bool(last_success) and mode in {"repair-or-continue-project", "multi-stage-project"} and not (
        risk == "high" or "code-or-workspace-side-effect" in risk_flags
    )
    backend_session_reuse = context_mode in {"continue", "repair"} and risk != "high" and not recent_failure

    return {
        "schemaVersion": "sciforge.conversation.cache-policy.v1",
        "reuseScenarioPlan": scenario_reuse,
        "reuseSkillPlan": skill_reuse,
        "reuseUiPlan": ui_reuse,
        "reuseUIPlan": ui_reuse,
        "reuseReferenceDigests": reference_reuse,
        "reuseArtifactIndex": artifact_reuse,
        "reuseLastSuccessfulStage": last_stage_reuse,
        "reuseBackendSession": backend_session_reuse,
        "scenarioPlan": _decision(scenario_reuse, "scenario context may be reused", "isolated, failed, or high-risk turn"),
        "skillPlan": _decision(skill_reuse, "selected capability plan is reusable", "failure or high risk requires fresh selection"),
        "uiPlan": _decision(ui_reuse, "UI component plan is reusable", "repair or high risk requires fresh UI plan"),
        "referenceDigests": _decision(reference_reuse, digest_state["reason"], "reference digests are absent, unresolved, or not in reusable context"),
        "artifactIndex": _decision(artifact_reuse, artifact_state["reason"], "artifact index is absent or current turn is isolated"),
        "lastSuccessfulStage": _decision(last_stage_reuse, _last_stage_reason(last_success), "no compatible successful stage may be reused"),
        "backendSession": _decision(backend_session_reuse, "same-task backend session can continue", "backend session should be fresh for isolation, failure, or high risk"),
        "reason": _reason(mode, context_mode, risk, recent_failure),
        "signals": {
            "executionMode": mode,
            "contextMode": context_mode,
            "riskLevel": risk,
            "riskFlags": sorted(risk_flags),
            "recentFailure": recent_failure,
            "explicitRefs": explicit_refs,
            "referenceDigestCount": digest_state["count"],
            "artifactEntryCount": artifact_state["count"],
        },
    }


def _decision(reuse: bool, reuse_reason: str, miss_reason: str) -> JsonMap:
    return {"reuse": reuse, "reason": reuse_reason if reuse else miss_reason}


def _digest_state(data: Mapping[str, Any]) -> JsonMap:
    digests = _list(data.get("currentReferenceDigests"))
    unresolved = [
        digest
        for digest in digests
        if isinstance(digest, Mapping) and str(digest.get("status") or "").lower() not in {"ok", "metadata-only", "unsupported"}
    ]
    if not digests:
        reason = "no reference digests are available"
    elif unresolved:
        reason = "one or more reference digests are unresolved"
    else:
        reason = "bounded current reference digests are reusable"
    return {"hasDigests": bool(digests), "hasUnresolved": bool(unresolved), "count": len(digests), "reason": reason}


def _artifact_state(data: Mapping[str, Any]) -> JsonMap:
    index = _mapping(data.get("artifactIndex") or {})
    entries = _list(index.get("entries"))
    return {
        "hasEntries": bool(entries),
        "count": len(entries),
        "reason": "artifact index entries can anchor the continuing turn" if entries else "artifact index has no entries",
    }


def _last_successful_stage(data: Mapping[str, Any]) -> Mapping[str, Any]:
    session = _mapping(data.get("session") or {})
    candidates: list[Any] = []
    for key in ("executionUnits", "runs", "attempts", "stages"):
        candidates.extend(_list(session.get(key)))
    for key in ("priorAttempts", "attempts"):
        candidates.extend(_list(data.get(key)))
    for item in reversed(candidates):
        if not isinstance(item, Mapping):
            continue
        status = str(item.get("status") or item.get("state") or "").lower()
        if status in {"ok", "success", "succeeded", "completed", "done", "passed"}:
            return item
    return {}


def _last_stage_reason(stage: Mapping[str, Any]) -> str:
    stage_id = stage.get("stageId") or stage.get("id") or stage.get("name")
    if stage_id:
        return f"last successful stage {stage_id} can seed continuation"
    return "last successful stage can seed continuation"


def _risk_level(data: Mapping[str, Any]) -> str:
    rank = 1
    brief = _mapping(data.get("capabilityBrief") or {})
    for item in _selected_capabilities(data, brief):
        if isinstance(item, Mapping):
            rank = max(rank, _RISK_RANK.get(str(item.get("riskLevel") or "low").lower(), 1))
            if str(item.get("kind") or "").lower() == "action":
                rank = max(rank, 2)
    risk_flags = set(_string_list(_mapping(data.get("executionModePlan") or {}).get("riskFlags")))
    if "code-or-workspace-side-effect" in risk_flags:
        rank = max(rank, 2)
    if any("high" in str(item).lower() for item in _selected_capabilities(data, brief)):
        rank = max(rank, 3)
    return {0: "low", 1: "low", 2: "medium", 3: "high", 4: "high"}.get(rank, "low")


def _selected_capabilities(data: Mapping[str, Any], brief: Mapping[str, Any]) -> list[Any]:
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


def _has_recent_failure(data: Mapping[str, Any]) -> bool:
    for key in ("recentFailures", "failures"):
        if _list(data.get(key)):
            return True
    session = _mapping(data.get("session") or {})
    for item in [*_list(session.get("runs")), *_list(session.get("executionUnits"))]:
        if isinstance(item, Mapping):
            status = str(item.get("status") or item.get("state") or "").lower()
            if status in {"failed", "error", "failure", "timed-out", "timeout"} or item.get("failureReason"):
                return True
    return False


def _has_explicit_refs(data: Mapping[str, Any]) -> bool:
    if _list(data.get("currentReferences")) or _list(data.get("references")) or _list(data.get("refs")):
        return True
    memory = _mapping(data.get("memoryPlan") or {})
    return bool(_list(memory.get("currentReferenceFocus")))


def _reason(mode: str, context_mode: str, risk: str, recent_failure: bool) -> str:
    parts = [f"executionMode={mode}", f"contextMode={context_mode or 'unknown'}", f"risk={risk}"]
    if recent_failure:
        parts.append("recent failure forces fresh work where needed")
    return "; ".join(parts)


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _string_list(value: Any) -> list[str]:
    return [str(item) for item in _list(value) if item is not None]
