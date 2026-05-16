"""Policy-owned execution mode classifier.

The gateway consumes this module's structured output after Python conversation
policy has normalized the turn. This classifier intentionally avoids prompt
keyword matching: prompt text is first converted by policy modules into goal,
constraint, reference, and capability records, and this module only consumes
those records.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field, is_dataclass
from typing import Any, Literal, Mapping, Sequence


ExecutionMode = Literal[
    "direct-context-answer",
    "thin-reproducible-adapter",
    "single-stage-task",
    "multi-stage-project",
    "repair-or-continue-project",
]
ReproducibilityLevel = Literal["none", "light", "full", "staged"]
JsonMap = dict[str, Any]


@dataclass(frozen=True)
class ExecutionClassifierInput:
    prompt: str = ""
    refs: Sequence[Any] = field(default_factory=tuple)
    current_references: Sequence[Any] = field(default_factory=tuple)
    current_reference_digests: Sequence[Any] = field(default_factory=tuple)
    artifacts: Sequence[Mapping[str, Any]] = field(default_factory=tuple)
    context_policy: Mapping[str, Any] = field(default_factory=dict)
    context_projection: Mapping[str, Any] = field(default_factory=dict)
    goal_snapshot: Mapping[str, Any] = field(default_factory=dict)
    capability_brief: Mapping[str, Any] = field(default_factory=dict)
    turn_execution_constraints: Mapping[str, Any] = field(default_factory=dict)
    ts_decisions: Mapping[str, Any] = field(default_factory=dict)
    expected_artifact_types: Sequence[str] = field(default_factory=tuple)
    selected_capabilities: Sequence[Any] = field(default_factory=tuple)
    selected_tools: Sequence[Any] = field(default_factory=tuple)
    selected_senses: Sequence[Any] = field(default_factory=tuple)
    selected_verifiers: Sequence[Any] = field(default_factory=tuple)
    recent_failures: Sequence[Any] = field(default_factory=tuple)
    prior_attempts: Sequence[Any] = field(default_factory=tuple)
    user_guidance_queue: Sequence[Any] = field(default_factory=tuple)


@dataclass(frozen=True)
class ExecutionModeDecision:
    executionMode: ExecutionMode
    complexityScore: float
    uncertaintyScore: float
    reproducibilityLevel: ReproducibilityLevel
    stagePlanHint: list[str]
    reason: str
    riskFlags: list[str] = field(default_factory=list)
    signals: list[str] = field(default_factory=list)


def classify_execution_mode(request: ExecutionClassifierInput | Mapping[str, Any] | Any) -> JsonMap:
    """Classify a turn from structured policy inputs and capability records."""

    req = _coerce_request(request)
    signals = _signals(req)
    complexity = _complexity(req, signals)
    uncertainty = _uncertainty(req, signals)
    mode = _select_mode(req, signals, complexity, uncertainty)
    risk_flags = _risk_flags(req, signals, complexity, uncertainty)
    return {
        "executionMode": mode,
        "complexityScore": round(max(0.0, min(1.0, complexity)), 3),
        "uncertaintyScore": round(max(0.0, min(1.0, uncertainty)), 3),
        "reproducibilityLevel": _reproducibility_level(mode),
        "stagePlanHint": _stage_plan_hint(mode, signals),
        "reason": _reason(mode, signals, risk_flags),
        "riskFlags": risk_flags,
        "signals": signals,
        "policySource": "python-conversation-policy",
    }


def _coerce_request(value: ExecutionClassifierInput | Mapping[str, Any] | Any) -> JsonMap:
    if is_dataclass(value):
        return _coerce_request(asdict(value))
    if isinstance(value, Mapping):
        out = {str(key): _jsonable(item) for key, item in value.items()}
        aliases = {
            "current_references": "currentReferences",
            "current_reference_digests": "currentReferenceDigests",
            "context_policy": "contextPolicy",
            "context_projection": "contextProjection",
            "goal_snapshot": "goalSnapshot",
            "capability_brief": "capabilityBrief",
            "turn_execution_constraints": "turnExecutionConstraints",
            "ts_decisions": "tsDecisions",
            "expected_artifact_types": "expectedArtifactTypes",
            "selected_capabilities": "selectedCapabilities",
            "selected_tools": "selectedTools",
            "selected_senses": "selectedSenses",
            "selected_verifiers": "selectedVerifiers",
            "recent_failures": "recentFailures",
            "prior_attempts": "priorAttempts",
            "user_guidance_queue": "userGuidanceQueue",
        }
        for source, target in aliases.items():
            if source in out and target not in out:
                out[target] = out[source]
        if "currentReferences" in out and "refs" not in out:
            out["refs"] = out["currentReferences"]
        return out
    to_dict = getattr(value, "to_dict", None)
    if callable(to_dict):
        return _coerce_request(to_dict())
    return {
        key: _jsonable(getattr(value, key))
        for key in dir(value)
        if not key.startswith("_") and not callable(getattr(value, key))
    }


def _jsonable(value: Any) -> Any:
    if is_dataclass(value):
        return asdict(value)
    if isinstance(value, Mapping):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    return value


def _signals(req: JsonMap) -> list[str]:
    signals: list[str] = []
    constraints = _constraints(req)
    goal = _record(req, "goalSnapshot")
    context_policy = _record(req, "contextPolicy")
    expected = _expected_artifact_types(req)
    selected_actions = _selected_action_count(req)

    task_relation = _text(goal.get("taskRelation"))
    goal_type = _text(goal.get("goalType"))
    context_mode = _text(context_policy.get("mode"))

    _add(signals, "no-execution-directive", _constraints_forbid_execution(constraints))
    _add(signals, "context-summary", _constraints_context_only(constraints))
    _add(signals, "repair", task_relation == "repair" or context_mode == "repair" or bool(_list(req, "recentFailures")) or _has_failed_attempt(req))
    _add(signals, "continuation", task_relation == "continue" or context_mode == "continue" or _has_active_project_artifact(req))
    _add(signals, "mid-run-guidance", bool(_list(req, "userGuidanceQueue")))
    _add(signals, "has-refs", bool(_current_refs(req)))
    _add(signals, "has-digests", bool(_usable_current_digests(req)))
    _add(signals, "has-artifacts", bool(_list(req, "artifacts")))
    _add(signals, "expected-artifact-contract", bool(expected))
    _add(signals, "artifact-output", bool(expected))
    _add(signals, "multi-artifact", len(expected) > 1)
    _add(signals, "direct-question", goal_type == "analysis" and _has_current_context(req) and not expected)
    _add(signals, "light-lookup", _has_latest_goal(goal) or _selected_external_action_count(req) > 0)
    _add(signals, "research", _declares_domain(req, {"literature", "research"}) or _declares_artifact(expected, {"paper-list", "bibliography", "research-report", "citation-record"}))
    _add(signals, "systematic-research", "research" in signals and (len(expected) > 1 or bool(_list(req, "selectedVerifiers"))))
    _add(signals, "full-text", _declares_artifact(expected, {"pdf-bundle", "full-text", "extraction-table"}) or _declares_capability(req, {"pdf", "full-text"}))
    _add(signals, "code-change", _selected_side_effect(req, {"write", "edit", "patch", "execute", "shell", "code"}) or _declares_artifact(expected, {"notebook", "script", "patch"}))
    _add(signals, "file-work", _selected_side_effect(req, {"filesystem", "file-read", "read-file", "workspace-read", "inspect"}))
    _add(signals, "selected-action", selected_actions > 0)
    _add(signals, "external-action", _selected_external_action_count(req) > 0)
    _add(signals, "multi-provider", _selected_external_action_count(req) > 1)
    _add(signals, "verifier", bool(_list(req, "selectedVerifiers")))
    _add(signals, "sense", bool(_list(req, "selectedSenses")))
    _add(signals, "multi-step", len(expected) > 1 or selected_actions > 1 or bool(_list(req, "selectedVerifiers")))
    _add(signals, "long-or-uncertain", _goal_declares_large_or_uncertain(goal) or ("systematic-research" in signals and "verifier" in signals))
    return signals


def _select_mode(req: JsonMap, signals: list[str], complexity: float, uncertainty: float) -> ExecutionMode:
    if _is_direct_context_summary_answer(req, signals):
        return "direct-context-answer"
    if any(signal in signals for signal in ("repair", "continuation", "mid-run-guidance")):
        return "repair-or-continue-project"
    if _is_direct_context_answer(req, signals):
        return "direct-context-answer"
    if "light-lookup" in signals and complexity < 0.58 and "multi-artifact" not in signals and "full-text" not in signals:
        return "thin-reproducible-adapter"
    if _is_multi_stage(signals, complexity, uncertainty):
        return "multi-stage-project"
    return "single-stage-task"


def _is_direct_context_summary_answer(req: JsonMap, signals: list[str]) -> bool:
    constraints = _constraints(req)
    if not _constraints_context_only(constraints):
        return False
    if not _has_current_context(req):
        return False
    if _selected_external_action_count(req) > 0 or _selected_action_count(req) > 0:
        return False
    return "no-execution-directive" in signals or _text(constraints.get("executionModeHint")) == "direct-context-answer"


def _is_direct_context_answer(req: JsonMap, signals: list[str]) -> bool:
    if _requires_execution(signals):
        return False
    if _expected_artifact_types(req) or _selected_action_count(req) or _list(req, "recentFailures"):
        return False
    return "direct-question" in signals and _has_current_context(req)


def _requires_execution(signals: Sequence[str]) -> bool:
    blockers = {
        "light-lookup",
        "research",
        "systematic-research",
        "full-text",
        "code-change",
        "file-work",
        "artifact-output",
        "multi-step",
        "external-action",
        "selected-action",
        "multi-artifact",
    }
    return any(signal in blockers for signal in signals)


def _is_multi_stage(signals: Sequence[str], complexity: float, uncertainty: float) -> bool:
    if any(signal in signals for signal in ("systematic-research", "full-text", "multi-artifact", "long-or-uncertain")):
        return True
    return complexity >= 0.72 or uncertainty >= 0.62


def _complexity(req: JsonMap, signals: Sequence[str]) -> float:
    weights = {
        "repair": 0.34,
        "continuation": 0.28,
        "mid-run-guidance": 0.18,
        "light-lookup": 0.12,
        "research": 0.18,
        "systematic-research": 0.24,
        "full-text": 0.24,
        "code-change": 0.24,
        "file-work": 0.16,
        "artifact-output": 0.16,
        "expected-artifact-contract": 0.04,
        "multi-step": 0.22,
        "long-or-uncertain": 0.28,
        "has-refs": 0.04,
        "has-digests": 0.04,
        "has-artifacts": 0.06,
        "selected-action": 0.06,
        "external-action": 0.08,
        "multi-provider": 0.18,
        "verifier": 0.08,
        "sense": 0.06,
        "multi-artifact": 0.16,
    }
    score = 0.06 + sum(weights.get(signal, 0.0) for signal in signals)
    score += min(0.10, max(0, len(_current_refs(req)) - 3) * 0.025)
    score += min(0.10, max(0, _selected_action_count(req) - 2) * 0.035)
    score += min(0.10, max(0, len(_list(req, "priorAttempts")) - 1) * 0.035)
    if "direct-question" in signals and not _requires_execution(signals):
        score -= 0.08
    if _constraints_context_only(_constraints(req)):
        score -= 0.10
    return score


def _uncertainty(req: JsonMap, signals: Sequence[str]) -> float:
    weights = {
        "repair": 0.16,
        "continuation": 0.16,
        "mid-run-guidance": 0.16,
        "light-lookup": 0.14,
        "research": 0.18,
        "systematic-research": 0.18,
        "full-text": 0.14,
        "multi-step": 0.14,
        "long-or-uncertain": 0.28,
        "external-action": 0.12,
        "multi-provider": 0.12,
        "code-change": 0.06,
        "verifier": -0.04,
        "has-digests": -0.04,
    }
    score = 0.08 + sum(weights.get(signal, 0.0) for signal in signals)
    if _list(req, "recentFailures"):
        score += min(0.18, 0.08 + len(_list(req, "recentFailures")) * 0.04)
    if _has_failed_attempt(req):
        score += 0.10
    if "file-work" in signals and not _current_refs(req) and not _list(req, "artifacts"):
        score += 0.12
    if "direct-question" in signals and not _requires_execution(signals):
        score -= 0.06
    if _constraints_context_only(_constraints(req)):
        score -= 0.08
    return score


def _risk_flags(req: JsonMap, signals: Sequence[str], complexity: float, uncertainty: float) -> list[str]:
    flags: list[str] = []
    _add(flags, "external-information-required", "external-action" in signals or "light-lookup" in signals or "research" in signals)
    _add(flags, "multi-provider-coordination", "multi-provider" in signals)
    _add(flags, "full-text-or-large-fetch", "full-text" in signals)
    _add(flags, "code-or-workspace-side-effect", "code-change" in signals)
    _add(flags, "multi-artifact-output", "multi-artifact" in signals)
    _add(flags, "recent-failure", bool(_list(req, "recentFailures")) or _has_failed_attempt(req))
    _add(flags, "mid-run-guidance", "mid-run-guidance" in signals)
    _add(flags, "long-running-or-open-ended", "long-or-uncertain" in signals or complexity >= 0.72)
    _add(flags, "high-uncertainty", uncertainty >= 0.62)
    _add(flags, "needs-workspace-discovery", "file-work" in signals and not _current_refs(req))
    _add(flags, "execution-forbidden", "no-execution-directive" in signals)
    return flags


def _reproducibility_level(mode: ExecutionMode) -> ReproducibilityLevel:
    return {
        "direct-context-answer": "none",
        "thin-reproducible-adapter": "light",
        "single-stage-task": "full",
        "multi-stage-project": "staged",
        "repair-or-continue-project": "staged",
    }[mode]


def _stage_plan_hint(mode: ExecutionMode, signals: Sequence[str]) -> list[str]:
    if mode == "direct-context-answer":
        return []
    if mode == "thin-reproducible-adapter":
        if "research" in signals:
            return ["search", "emit"]
        return ["search", "fetch", "emit"] if "light-lookup" in signals else ["fetch", "emit"]
    if mode == "repair-or-continue-project":
        return ["diagnose", "resume", "validate", "emit"]
    if mode == "multi-stage-project":
        if "systematic-research" in signals or "research" in signals:
            return ["plan", "search", "analyze", "emit", "validate"]
        if "full-text" in signals:
            return ["plan", "fetch", "extract", "emit", "validate"]
        return ["plan", "execute", "validate", "emit"]
    if "code-change" in signals:
        return ["analyze", "modify", "validate", "emit"]
    if "file-work" in signals:
        return ["fetch", "analyze", "emit"]
    return ["execute", "emit"]


def _reason(mode: ExecutionMode, signals: Sequence[str], risk_flags: Sequence[str]) -> str:
    signal_text = ", ".join(signals[:6]) or "low-signal"
    risk_text = ", ".join(risk_flags[:4]) or "no major risks"
    return f"Python policy selected {mode}; signals={signal_text}; risks={risk_text}."


def _constraints(req: JsonMap) -> JsonMap:
    for value in (
        req.get("turnExecutionConstraints"),
        _record(req, "goalSnapshot").get("turnExecutionConstraints"),
        _record(req, "tsDecisions").get("turnExecutionConstraints"),
    ):
        if isinstance(value, Mapping):
            return {str(key): item for key, item in value.items()}
    return {}


def _constraints_forbid_execution(constraints: JsonMap) -> bool:
    return any(
        constraints.get(key) is True
        for key in (
            "contextOnly",
            "agentServerForbidden",
            "workspaceExecutionForbidden",
            "codeExecutionForbidden",
            "externalIoForbidden",
        )
    )


def _constraints_context_only(constraints: JsonMap) -> bool:
    return constraints.get("contextOnly") is True or _text(constraints.get("executionModeHint")) == "direct-context-answer"


def _current_refs(req: JsonMap) -> list[Any]:
    refs = _list(req, "currentReferences")
    if refs:
        return refs
    return _list(req, "refs")


def _usable_current_digests(req: JsonMap) -> list[Mapping[str, Any]]:
    out: list[Mapping[str, Any]] = []
    for digest in _list(req, "currentReferenceDigests"):
        if not isinstance(digest, Mapping):
            continue
        status = _text(digest.get("status")).lower()
        if status in {"failed", "unresolved", "missing", "stale"}:
            continue
        if _digest_has_text(digest):
            out.append(digest)
    return out


def _digest_has_text(digest: Mapping[str, Any]) -> bool:
    if any(_text(digest.get(key)) for key in ("digestText", "summary", "text", "preview", "content")):
        return True
    excerpts = digest.get("excerpts")
    return isinstance(excerpts, list) and any(_text(item) for item in excerpts)


def _has_current_context(req: JsonMap) -> bool:
    return bool(_current_refs(req) or _usable_current_digests(req) or _list(req, "artifacts"))


def _expected_artifact_types(req: JsonMap) -> list[str]:
    explicit = _string_list(req.get("expectedArtifactTypes"))
    if explicit:
        return explicit
    return _string_list(_record(req, "goalSnapshot").get("requiredArtifacts"))


def _selected_action_count(req: JsonMap) -> int:
    return len(_list(req, "selectedTools")) + len(_action_capabilities(req))


def _selected_external_action_count(req: JsonMap) -> int:
    return len([item for item in [*_list(req, "selectedTools"), *_action_capabilities(req)] if _manifest_is_external(item)])


def _action_capabilities(req: JsonMap) -> list[Mapping[str, Any]]:
    out: list[Mapping[str, Any]] = []
    for item in [*_list(req, "selectedCapabilities"), *_capability_brief_selected(req)]:
        if not isinstance(item, Mapping):
            continue
        adapter = _text(item.get("adapter"))
        if adapter and adapter == "agentserver:generation":
            continue
        if _text(item.get("kind")) in {"tool", "sense", "action", "skill", "verifier"}:
            out.append(item)
    return out


def _capability_brief_selected(req: JsonMap) -> list[Any]:
    return _list(_record(req, "capabilityBrief"), "selected")


def _manifest_is_external(value: Any) -> bool:
    if not isinstance(value, Mapping):
        return False
    if value.get("externalIo") is True or value.get("requiresExternalIo") is True:
        return True
    side_effects = _string_list(value.get("sideEffects"))
    tags = _manifest_tokens(value)
    return any(token in tags or token in side_effects for token in {"search", "fetch", "download", "browser", "web", "http", "api", "remote", "provider"})


def _selected_side_effect(req: JsonMap, tokens: set[str]) -> bool:
    for item in [*_list(req, "selectedTools"), *_action_capabilities(req)]:
        if not isinstance(item, Mapping):
            continue
        manifest_tokens = _manifest_tokens(item)
        side_effects = set(_string_list(item.get("sideEffects")))
        if manifest_tokens.intersection(tokens) or side_effects.intersection(tokens):
            return True
    return False


def _declares_domain(req: JsonMap, domains: set[str]) -> bool:
    for item in [*_list(req, "selectedCapabilities"), *_capability_brief_selected(req)]:
        if isinstance(item, Mapping) and _manifest_tokens(item).intersection(domains):
            return True
    return False


def _declares_capability(req: JsonMap, tokens: set[str]) -> bool:
    for item in [*_list(req, "selectedTools"), *_action_capabilities(req)]:
        if isinstance(item, Mapping) and _manifest_tokens(item).intersection(tokens):
            return True
    return False


def _declares_artifact(values: Sequence[str], tokens: set[str]) -> bool:
    normalized = {_normalize_token(value) for value in values}
    return bool(normalized.intersection(tokens))


def _manifest_tokens(manifest: Mapping[str, Any]) -> set[str]:
    values: list[str] = []
    for key in ("id", "kind", "adapter", "domain", "domains", "artifacts", "inputTypes", "outputTypes", "triggers", "routingTags", "sideEffects"):
        values.extend(_string_list(manifest.get(key)) if isinstance(manifest.get(key), list) else [_text(manifest.get(key))])
    return {_normalize_token(value) for value in values if value}


def _normalize_token(value: str) -> str:
    return value.strip().lower().replace("_", "-")


def _has_latest_goal(goal: JsonMap) -> bool:
    freshness = _record(goal, "freshness")
    return _text(freshness.get("kind")) == "latest"


def _goal_declares_large_or_uncertain(goal: JsonMap) -> bool:
    values = {
        _text(goal.get("taskScale")),
        _text(goal.get("uncertainty")),
        _text(goal.get("scope")),
        _text(goal.get("complexity")),
    }
    return bool({"large", "long", "open-ended", "uncertain", "high", "comprehensive"}.intersection(values))


def _has_active_project_artifact(req: JsonMap) -> bool:
    for artifact in _list(req, "artifacts"):
        if not isinstance(artifact, Mapping):
            continue
        if _text(artifact.get("status")) in {"running", "partial", "in-progress"}:
            return True
        if _text(artifact.get("type")) == "task-project" or _text(artifact.get("artifactType")) == "task-project":
            return True
    return False


def _has_failed_attempt(req: JsonMap) -> bool:
    for item in _list(req, "priorAttempts"):
        if not isinstance(item, Mapping):
            continue
        status = _text(item.get("status"))
        if status in {"failed", "error", "repair-needed", "failed-with-reason"}:
            return True
    return False


def _record(value: JsonMap, key: str) -> JsonMap:
    item = value.get(key)
    return {str(inner_key): inner_value for inner_key, inner_value in item.items()} if isinstance(item, Mapping) else {}


def _list(value: JsonMap, key: str) -> list[Any]:
    item = value.get(key)
    return item if isinstance(item, list) else []


def _string_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value] if value.strip() else []
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value:
        if isinstance(item, str) and item.strip():
            out.append(item.strip())
        elif isinstance(item, Mapping):
            text = _text(item.get("id") or item.get("ref") or item.get("type") or item.get("kind"))
            if text:
                out.append(text)
    return out


def _text(value: Any) -> str:
    return str(value or "").strip()


def _add(items: list[str], item: str, condition: bool) -> None:
    if condition and item not in items:
        items.append(item)


__all__ = [
    "ExecutionClassifierInput",
    "ExecutionModeDecision",
    "ExecutionMode",
    "ReproducibilityLevel",
    "classify_execution_mode",
]
