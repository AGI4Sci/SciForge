"""Capability broker for compact, auditable SciForge capability briefs.

The broker is intentionally deterministic and dependency-free. It reads small
capability manifests, scores them against the current prompt/goal/refs/scenario,
then returns a bounded brief instead of exposing the full registry to the agent.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import json
from pathlib import Path
import re
from typing import Any, Iterable, Literal, Mapping, Sequence


CapabilityKind = Literal["skill", "tool", "sense", "action", "verifier", "ui-component"]
InternalAgentMode = Literal["none", "optional", "required"]

_VALID_KINDS: set[str] = {"skill", "tool", "sense", "action", "verifier", "ui-component"}
_RISK_RANK = {"none": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}
_COST_RANK = {"free": 0, "low": 1, "medium": 2, "variable": 2, "high": 3}
_LATENCY_RANK = {"instant": 0, "interactive": 1, "batch": 2, "slow": 3, "variable": 2}
_DEFAULT_KIND_LIMITS = {
    "skill": 3,
    "tool": 5,
    "sense": 2,
    "action": 3,
    "verifier": 2,
    "ui-component": 3,
}
_TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9_.:/+-]*", re.IGNORECASE)


@dataclass(frozen=True)
class CapabilityRequest:
    prompt: str = ""
    goal: str = ""
    refs: Sequence[str | Mapping[str, Any]] = field(default_factory=tuple)
    scenario: str = ""
    risk_tolerance: str = "medium"
    cost_budget: str = "medium"
    latency_budget: str = "batch"
    top_k: int = 8
    max_docs_to_load: int = 3
    max_context_tokens: int = 1200
    explicit_capability_ids: Sequence[str] = field(default_factory=tuple)
    expected_artifacts: Sequence[str] = field(default_factory=tuple)
    modalities: Sequence[str] = field(default_factory=tuple)
    task_type: str = ""
    approval_granted: bool = False
    available_config: Mapping[str, Any] = field(default_factory=dict)
    history: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ScoredCapability:
    manifest: Mapping[str, Any]
    score: float
    reasons: tuple[str, ...]
    penalties: tuple[str, ...]


def load_capability_manifests(paths: str | Path | Sequence[str | Path]) -> list[dict[str, Any]]:
    """Load JSON capability manifests from files or directories.

    Directories are searched recursively for ``*.manifest.json`` and
    ``manifest.json`` files. Invalid JSON files raise ``ValueError`` with the
    path, while non-object JSON payloads are ignored because they cannot be
    capability manifests.
    """

    if isinstance(paths, (str, Path)):
        path_list: Sequence[str | Path] = [paths]
    else:
        path_list = paths

    manifest_paths: list[Path] = []
    for raw_path in path_list:
        path = Path(raw_path)
        if path.is_dir():
            candidates = [*path.rglob("*.manifest.json"), *path.rglob("manifest.json")]
            manifest_paths.extend(sorted(set(candidates)))
        elif path.is_file():
            manifest_paths.append(path)

    manifests: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for path in manifest_paths:
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid capability manifest JSON at {path}: {exc}") from exc
        if not isinstance(raw, dict):
            continue
        manifest = dict(raw)
        manifest.setdefault("manifestPath", str(path))
        capability_id = _text(manifest.get("id"))
        if capability_id and capability_id in seen_ids:
            continue
        if capability_id:
            seen_ids.add(capability_id)
        manifests.append(manifest)
    return manifests


def build_capability_brief(
    request: CapabilityRequest | Mapping[str, Any],
    manifests: Sequence[Mapping[str, Any]],
    *,
    kind_limits: Mapping[str, int] | None = None,
) -> dict[str, Any]:
    """Return a compact capability brief with selected, excluded, and audit data."""

    req = _coerce_request(request)
    limits = {**_DEFAULT_KIND_LIMITS, **dict(kind_limits or {})}
    audit: list[dict[str, Any]] = []
    excluded_by_id: dict[str, str] = {}
    scored: list[ScoredCapability] = []

    for index, manifest in enumerate(manifests):
        normalized, validation_reason = _normalize_manifest(manifest, index)
        capability_id = _text(normalized.get("id")) or f"capability:{index}"
        if validation_reason:
            excluded_by_id[capability_id] = validation_reason
            audit.append(_audit_entry(capability_id, 0, [], [validation_reason], excluded=True))
            continue

        exclusion = _hard_exclusion_reason(req, normalized)
        scored_capability = _score_manifest(req, normalized)
        if exclusion:
            excluded_by_id[capability_id] = exclusion
            audit.append(
                _audit_entry(
                    capability_id,
                    scored_capability.score,
                    scored_capability.reasons,
                    [*scored_capability.penalties, exclusion],
                    excluded=True,
                )
            )
            continue

        scored.append(scored_capability)
        audit.append(
            _audit_entry(
                capability_id,
                scored_capability.score,
                scored_capability.reasons,
                scored_capability.penalties,
                excluded=False,
            )
        )

    scored.sort(key=lambda item: (-item.score, _text(item.manifest.get("kind")), _text(item.manifest.get("id"))))
    selected_scored: list[ScoredCapability] = []
    selected_ids: set[str] = set()
    selected_by_kind: dict[str, int] = {}

    for item in scored:
        capability_id = _text(item.manifest.get("id"))
        kind = _text(item.manifest.get("kind"))
        explicit = capability_id in set(req.explicit_capability_ids)
        if len(selected_scored) >= max(0, req.top_k) and not explicit:
            excluded_by_id.setdefault(capability_id, "outside top-k after scoring")
            continue
        if selected_by_kind.get(kind, 0) >= limits.get(kind, 0) and not explicit:
            excluded_by_id.setdefault(capability_id, f"{kind} kind limit reached")
            continue
        if item.score <= 0 and not explicit:
            excluded_by_id.setdefault(capability_id, "insufficient relevance to prompt, goal, refs, or scenario")
            continue
        selected_scored.append(item)
        selected_ids.add(capability_id)
        selected_by_kind[kind] = selected_by_kind.get(kind, 0) + 1

    for item in scored:
        capability_id = _text(item.manifest.get("id"))
        if capability_id not in selected_ids:
            excluded_by_id.setdefault(capability_id, "outside selected candidate set")

    selected = [_compact_summary(item.manifest, item.reasons, item.score) for item in selected_scored]
    excluded = [
        {"id": capability_id, "reason": reason}
        for capability_id, reason in sorted(excluded_by_id.items(), key=lambda item: item[0])
        if capability_id not in selected_ids
    ]

    intent = _infer_intent(req, selected)
    selected_by_output_kind = _group_selected(selected)
    verification_policy = _verification_policy(req, selected)
    brief = {
        "schemaVersion": 1,
        "intent": intent,
        "selected": selected,
        "excluded": excluded,
        "excludedCapabilities": excluded,
        "auditTrace": sorted(audit, key=lambda item: item["id"]),
        "needsMoreDiscovery": len(selected) == 0 and len(list(manifests)) == 0,
        "verificationPolicy": verification_policy,
        "invocationBudget": {
            "maxCandidates": req.top_k,
            "maxDocsToLoad": req.max_docs_to_load,
            "maxContextTokens": req.max_context_tokens,
        },
        **selected_by_output_kind,
    }
    return brief


def select_capabilities(
    request: CapabilityRequest | Mapping[str, Any],
    manifests: Sequence[Mapping[str, Any]],
    *,
    kind_limits: Mapping[str, int] | None = None,
) -> dict[str, Any]:
    """Compatibility alias for callers that name the service as a selector."""

    return build_capability_brief(request, manifests, kind_limits=kind_limits)


def broker_capabilities(
    request: CapabilityRequest | Mapping[str, Any],
    manifest_paths: str | Path | Sequence[str | Path] | None = None,
    manifests: Sequence[Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """Load manifests when paths are provided and build the broker brief."""

    loaded = list(manifests or [])
    if manifest_paths is not None:
        loaded.extend(load_capability_manifests(manifest_paths))
    return build_capability_brief(request, loaded)


def _coerce_request(request: CapabilityRequest | Mapping[str, Any]) -> CapabilityRequest:
    if isinstance(request, CapabilityRequest):
        return request
    aliases = {
        "riskTolerance": "risk_tolerance",
        "costBudget": "cost_budget",
        "latencyBudget": "latency_budget",
        "topK": "top_k",
        "maxDocsToLoad": "max_docs_to_load",
        "maxContextTokens": "max_context_tokens",
        "explicitCapabilityIds": "explicit_capability_ids",
        "expectedArtifacts": "expected_artifacts",
        "taskType": "task_type",
        "approvalGranted": "approval_granted",
        "availableConfig": "available_config",
    }
    data: dict[str, Any] = {}
    for key, value in request.items():
        data[aliases.get(key, key)] = value
    allowed = CapabilityRequest.__dataclass_fields__.keys()
    return CapabilityRequest(**{key: value for key, value in data.items() if key in allowed})


def _normalize_manifest(manifest: Mapping[str, Any], index: int) -> tuple[dict[str, Any], str | None]:
    normalized = dict(manifest)
    capability_id = _text(normalized.get("id"))
    kind = _normalize_kind(normalized.get("kind"))
    if not capability_id:
        return normalized, f"manifest at index {index} is missing id"
    if not kind:
        return normalized, f"{capability_id} has unsupported or missing kind"
    normalized["kind"] = kind
    normalized["summary"] = _text(
        normalized.get("summary")
        or normalized.get("description")
        or normalized.get("title")
        or capability_id
    )
    normalized["domain"] = _list(normalized.get("domain", normalized.get("domains")))
    normalized["triggers"] = _unique([
        *_list(normalized.get("triggers")),
        *_list(normalized.get("keywords")),
    ])
    normalized["antiTriggers"] = _list(normalized.get("antiTriggers", normalized.get("anti_triggers")))
    normalized["artifacts"] = _unique([
        *_list(normalized.get("artifacts", normalized.get("expectedArtifacts"))),
        *_list(normalized.get("outputTypes")),
    ])
    normalized["risk"] = _list(normalized.get("risk"))
    normalized["sideEffects"] = _list(normalized.get("sideEffects", normalized.get("side_effects")))
    normalized["modalities"] = _list(normalized.get("modalities"))
    normalized["requiredConfig"] = _list(normalized.get("requiredConfig", normalized.get("required_config")))
    normalized["allowedOperations"] = _list(normalized.get("allowedOperations", normalized.get("operations")))
    normalized["successRate"] = _float(normalized.get("successRate", normalized.get("historicalSuccessRate")), default=None)
    return normalized, None


def _score_manifest(req: CapabilityRequest, manifest: Mapping[str, Any]) -> ScoredCapability:
    text = " ".join(
        [
            req.prompt,
            req.goal,
            req.scenario,
            req.task_type,
            " ".join(_ref_text(ref) for ref in req.refs),
            " ".join(req.expected_artifacts),
            " ".join(req.modalities),
        ]
    )
    request_tokens = _tokens(text)
    capability_id = _text(manifest.get("id"))
    reasons: list[str] = []
    penalties: list[str] = []
    score = 0.0

    if capability_id in set(req.explicit_capability_ids):
        score += 100
        reasons.append("explicit capability id requested")

    trigger_matches = _matches(request_tokens, _list(manifest.get("triggers")))
    if trigger_matches:
        score += 9 * len(trigger_matches)
        reasons.append(f"trigger match: {', '.join(trigger_matches[:4])}")

    domain_matches = _matches(request_tokens, _list(manifest.get("domain")))
    if domain_matches:
        score += 5 * len(domain_matches)
        reasons.append(f"domain match: {', '.join(domain_matches[:4])}")

    artifact_matches = _matches(request_tokens, _list(manifest.get("artifacts")))
    if artifact_matches:
        score += 4 * len(artifact_matches)
        reasons.append(f"artifact match: {', '.join(artifact_matches[:4])}")

    modality_matches = _matches(request_tokens, _list(manifest.get("modalities")))
    if modality_matches:
        score += 4 * len(modality_matches)
        reasons.append(f"modality match: {', '.join(modality_matches[:4])}")

    summary_matches = _summary_matches(request_tokens, manifest)
    if summary_matches:
        score += min(8, 2 * len(summary_matches))
        reasons.append(f"summary match: {', '.join(summary_matches[:4])}")

    ref_matches = _ref_matches(req.refs, manifest)
    if ref_matches:
        score += 12 * len(ref_matches)
        reasons.append(f"ref match: {', '.join(ref_matches[:3])}")

    history_delta = _history_delta(req.history, capability_id)
    if history_delta > 0:
        score += history_delta
        reasons.append("positive history signal")
    elif history_delta < 0:
        score += history_delta
        penalties.append("negative history signal")

    success_rate = _float(manifest.get("successRate"), default=None)
    if success_rate is not None:
        if success_rate >= 0.85:
            score += 4
            reasons.append("strong validation history")
        elif success_rate < 0.5:
            score -= 4
            penalties.append("weak validation history")

    cost_penalty = max(0, _rank(_text(manifest.get("cost")), _COST_RANK) - _rank(req.cost_budget, _COST_RANK))
    latency_penalty = max(0, _rank(_text(manifest.get("latency")), _LATENCY_RANK) - _rank(req.latency_budget, _LATENCY_RANK))
    if cost_penalty:
        score -= cost_penalty * 3
        penalties.append("cost exceeds preferred budget")
    if latency_penalty:
        score -= latency_penalty * 2
        penalties.append("latency exceeds preferred budget")

    risk_level = _manifest_risk_level(manifest)
    if risk_level in {"high", "critical"}:
        score -= 2
        penalties.append(f"{risk_level} risk capability")

    anti_matches = _matches(request_tokens, _list(manifest.get("antiTriggers")))
    if anti_matches:
        score -= 25 * len(anti_matches)
        penalties.append(f"anti-trigger match: {', '.join(anti_matches[:4])}")

    if not reasons:
        reasons.append("no strong request match")
    return ScoredCapability(manifest=manifest, score=round(score, 3), reasons=tuple(reasons), penalties=tuple(penalties))


def _hard_exclusion_reason(req: CapabilityRequest, manifest: Mapping[str, Any]) -> str | None:
    capability_id = _text(manifest.get("id"))
    if capability_id in set(req.explicit_capability_ids):
        return None

    request_tokens = _tokens(
        " ".join([req.prompt, req.goal, req.scenario, req.task_type, " ".join(_ref_text(ref) for ref in req.refs)])
    )
    anti_matches = _matches(request_tokens, _list(manifest.get("antiTriggers")))
    if anti_matches:
        return f"anti-trigger matched: {', '.join(anti_matches[:4])}"

    missing_config = [key for key in _list(manifest.get("requiredConfig")) if not req.available_config.get(key)]
    if missing_config:
        return f"missing required config: {', '.join(missing_config)}"

    risk_level = _manifest_risk_level(manifest)
    if _rank(risk_level, _RISK_RANK) > _rank(req.risk_tolerance, _RISK_RANK):
        return f"risk {risk_level} exceeds tolerance {req.risk_tolerance}"

    high_risk_side_effects = {"delete", "payment", "publish", "send-message", "modify-credentials", "external-write"}
    if not req.approval_granted and high_risk_side_effects.intersection(_tokens(" ".join(_list(manifest.get("sideEffects"))))):
        return "high-risk side effect requires explicit approval"

    cost = _text(manifest.get("cost"))
    if _rank(cost, _COST_RANK) > _rank(req.cost_budget, _COST_RANK) + 1:
        return f"cost {cost or 'unknown'} exceeds budget {req.cost_budget}"

    return None


def _compact_summary(manifest: Mapping[str, Any], reasons: Sequence[str], score: float) -> dict[str, Any]:
    summary = {
        "id": _text(manifest.get("id")),
        "kind": _text(manifest.get("kind")),
        "summary": _truncate(_text(manifest.get("summary", manifest.get("description"))), 180),
        "why": _truncate("; ".join(reasons), 220),
        "score": score,
        "domains": _list(manifest.get("domain"))[:5],
        "allowedOperations": _list(manifest.get("allowedOperations"))[:6],
        "expectedArtifacts": _list(manifest.get("artifacts"))[:6],
        "cost": _text(manifest.get("cost")) or "unknown",
        "latency": _text(manifest.get("latency")) or "unknown",
        "risk": _list(manifest.get("risk"))[:6],
        "sideEffects": _list(manifest.get("sideEffects"))[:6],
        "adapter": _text(manifest.get("adapter")),
        "typedService": True,
    }
    internal_agent = _internal_agent_mode(manifest)
    if internal_agent != "none":
        summary["internalAgent"] = internal_agent
    return {key: value for key, value in summary.items() if value not in ("", [], None)}


def _group_selected(selected: Sequence[Mapping[str, Any]]) -> dict[str, list[Mapping[str, Any]]]:
    groups = {
        "selectedSkills": [],
        "selectedTools": [],
        "selectedSenses": [],
        "selectedActions": [],
        "selectedVerifiers": [],
        "selectedComponents": [],
    }
    key_by_kind = {
        "skill": "selectedSkills",
        "tool": "selectedTools",
        "sense": "selectedSenses",
        "action": "selectedActions",
        "verifier": "selectedVerifiers",
        "ui-component": "selectedComponents",
    }
    for item in selected:
        key = key_by_kind.get(_text(item.get("kind")))
        if key:
            groups[key].append(item)
    return groups


def _infer_intent(req: CapabilityRequest, selected: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    domains = _unique([domain for item in selected for domain in _list(item.get("domains"))])
    artifact_types = _unique([*req.expected_artifacts, *[artifact for item in selected for artifact in _list(item.get("expectedArtifacts"))]])
    return {
        "domain": domains[0] if domains else "general",
        "taskType": req.task_type or "general",
        "modalities": _unique(req.modalities),
        "riskLevel": req.risk_tolerance,
        "expectedArtifactTypes": artifact_types[:8],
        "scenario": req.scenario or None,
    }


def _verification_policy(req: CapabilityRequest, selected: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    has_verifier = any(item.get("kind") == "verifier" for item in selected)
    selected_risk = max((_manifest_summary_risk(item) for item in selected), default=0)
    if selected_risk >= _RISK_RANK["high"]:
        mode = "hybrid" if has_verifier else "human"
        return {"required": True, "mode": mode, "reason": "high-risk capability path requires verification"}
    if has_verifier:
        return {"required": True, "mode": "automatic", "reason": "selected verifier can validate expected artifacts"}
    if selected:
        return {"required": False, "mode": "lightweight", "reason": "low/medium risk selected capabilities"}
    return {"required": False, "mode": "none", "reason": "no capability selected"}


def _audit_entry(
    capability_id: str,
    score: float,
    reasons: Sequence[str],
    penalties: Sequence[str],
    *,
    excluded: bool,
) -> dict[str, Any]:
    return {
        "id": capability_id,
        "score": score,
        "matched": list(reasons),
        "penalties": list(penalties),
        "excluded": excluded,
    }


def _normalize_kind(value: Any) -> str:
    kind = _text(value).lower()
    aliases = {"ui": "ui-component", "component": "ui-component", "actions": "action", "skills": "skill"}
    kind = aliases.get(kind, kind)
    return kind if kind in _VALID_KINDS else ""


def _manifest_risk_level(manifest: Mapping[str, Any]) -> str:
    explicit = _text(manifest.get("riskLevel", manifest.get("risk_level"))).lower()
    if explicit in _RISK_RANK:
        return explicit
    risk_tokens = _tokens(" ".join(_list(manifest.get("risk")) + _list(manifest.get("sideEffects"))))
    if risk_tokens.intersection({"delete", "payment", "publish", "credential", "credentials", "external-write"}):
        return "high"
    if risk_tokens.intersection({"network", "writes-workspace", "write", "download-files", "gui"}):
        return "medium"
    if risk_tokens:
        return "low"
    return "low"


def _manifest_summary_risk(summary: Mapping[str, Any]) -> int:
    risk_level = _text(summary.get("riskLevel")).lower()
    if risk_level in _RISK_RANK:
        return _RISK_RANK[risk_level]
    risk_tokens = _tokens(" ".join(_list(summary.get("risk")) + _list(summary.get("sideEffects"))))
    if risk_tokens.intersection({"delete", "payment", "publish", "credential", "credentials", "external-write"}):
        return _RISK_RANK["high"]
    if risk_tokens.intersection({"network", "writes-workspace", "write", "download-files", "gui"}):
        return _RISK_RANK["medium"]
    if risk_tokens:
        return _RISK_RANK["low"]
    return _RISK_RANK["low"]


def _internal_agent_mode(manifest: Mapping[str, Any]) -> InternalAgentMode:
    raw = manifest.get("internalAgent", manifest.get("internal_agent"))
    if raw is True:
        return "optional"
    value = _text(raw).lower()
    return value if value in {"optional", "required"} else "none"


def _matches(request_tokens: set[str], candidates: Sequence[str]) -> list[str]:
    matches: list[str] = []
    for candidate in candidates:
        candidate_tokens = _tokens(candidate)
        if not candidate_tokens:
            continue
        if candidate_tokens.issubset(request_tokens) or candidate.lower() in request_tokens:
            matches.append(candidate)
        elif candidate_tokens.intersection(request_tokens) and any(len(token) >= 5 for token in candidate_tokens):
            matches.append(candidate)
    return _unique(matches)


def _summary_matches(request_tokens: set[str], manifest: Mapping[str, Any]) -> list[str]:
    summary_text = " ".join(
        [
            _text(manifest.get("id")),
            _text(manifest.get("summary")),
            _text(manifest.get("description")),
            _text(manifest.get("adapter")),
        ]
    )
    stop_words = {"the", "and", "for", "with", "into", "from", "that", "this", "task", "agent"}
    return sorted(token for token in _tokens(summary_text).intersection(request_tokens) if len(token) > 3 and token not in stop_words)


def _ref_matches(refs: Sequence[str | Mapping[str, Any]], manifest: Mapping[str, Any]) -> list[str]:
    haystack = _tokens(
        " ".join(
            [
                _text(manifest.get("id")),
                " ".join(_list(manifest.get("artifacts"))),
                " ".join(_list(manifest.get("domain"))),
                " ".join(_list(manifest.get("triggers"))),
            ]
        )
    )
    matches: list[str] = []
    for ref in refs:
        ref_text = _ref_text(ref)
        ref_tokens = _tokens(ref_text)
        if ref_tokens.intersection(haystack):
            matches.append(_truncate(ref_text, 60))
    return _unique(matches)


def _history_delta(history: Mapping[str, Any], capability_id: str) -> float:
    if not capability_id:
        return 0
    raw = history.get(capability_id)
    if isinstance(raw, Mapping):
        successes = _float(raw.get("successes"), default=0) or 0
        failures = _float(raw.get("failures"), default=0) or 0
        return min(6, successes * 1.5) - min(8, failures * 2)
    if isinstance(raw, (int, float)):
        return max(-8, min(6, float(raw)))
    return 0


def _rank(value: str, ranks: Mapping[str, int]) -> int:
    normalized = _text(value).lower()
    if not normalized:
        return 0
    return ranks.get(normalized, max(ranks.values()))


def _tokens(value: str) -> set[str]:
    normalized = value.lower().replace("_", "-")
    tokens = set(_TOKEN_RE.findall(normalized))
    expanded: set[str] = set(tokens)
    for token in tokens:
        expanded.update(part for part in re.split(r"[-_./:]+", token) if part)
    return expanded


def _ref_text(ref: str | Mapping[str, Any]) -> str:
    if isinstance(ref, Mapping):
        return " ".join(_text(ref.get(key)) for key in ("id", "ref", "type", "title", "summary", "path", "artifactType"))
    return _text(ref)


def _list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value] if value.strip() else []
    if isinstance(value, Iterable) and not isinstance(value, Mapping):
        return _unique(_text(item) for item in value if _text(item))
    return [_text(value)] if _text(value) else []


def _unique(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        item = value.strip()
        key = item.lower()
        if item and key not in seen:
            seen.add(key)
            result.append(item)
    return result


def _text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()


def _float(value: Any, *, default: float | None = 0) -> float | None:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _truncate(value: str, limit: int) -> str:
    text = value.strip()
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "…"


__all__ = [
    "CapabilityRequest",
    "ScoredCapability",
    "broker_capabilities",
    "build_capability_brief",
    "load_capability_manifests",
    "select_capabilities",
]
