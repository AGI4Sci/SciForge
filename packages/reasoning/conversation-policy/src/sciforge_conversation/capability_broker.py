"""Compatibility helpers for compact SciForge capability briefs.

Runtime selection now lives in ``src/runtime/capability-broker.ts``. This
module remains for Python callers that still import the historical
``build_capability_brief`` API and need the legacy response envelope.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import json
from pathlib import Path
from typing import Any, Iterable, Literal, Mapping, Sequence


CapabilityKind = Literal["skill", "tool", "sense", "action", "verifier", "ui-component"]
InternalAgentMode = Literal["none", "optional", "required"]

_VALID_KINDS: set[str] = {"skill", "tool", "sense", "action", "verifier", "ui-component"}
_DEFAULT_KIND_LIMITS = {
    "skill": 3,
    "tool": 5,
    "sense": 2,
    "action": 3,
    "verifier": 2,
    "ui-component": 3,
}


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
    """Load JSON manifest files from paths while preserving their payloads."""

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
    """Return the legacy Python envelope for already-discovered capabilities."""

    req = _coerce_request(request)
    if isinstance(request, Mapping):
        bridged = _from_runtime_output(request, req)
        if bridged is not None:
            return bridged

    limits = {**_DEFAULT_KIND_LIMITS, **dict(kind_limits or {})}
    selected: list[dict[str, Any]] = []
    excluded: list[dict[str, str]] = []
    audit: list[dict[str, Any]] = []
    selected_by_kind: dict[str, int] = {}
    explicit_ids = set(req.explicit_capability_ids)
    normalized_items = [
        (index, *_normalize_manifest(manifest, index))
        for index, manifest in enumerate(manifests)
    ]

    def selection_key(item: tuple[int, dict[str, Any], str | None]) -> tuple[int, int]:
        index, manifest, _reason = item
        capability_id = _text(manifest.get("id"))
        return (0 if capability_id in explicit_ids else 1, index)

    for _index, manifest, validation_reason in sorted(normalized_items, key=selection_key):
        capability_id = _text(manifest.get("id")) or f"capability:{len(audit)}"
        if validation_reason:
            excluded.append({"id": capability_id, "reason": validation_reason})
            audit.append(_audit_entry(capability_id, [], [validation_reason], excluded=True))
            continue

        kind = _text(manifest.get("kind"))
        explicit = capability_id in explicit_ids
        if len(selected) >= max(0, req.top_k) and not explicit:
            excluded.append({"id": capability_id, "reason": "outside compatibility top-k"})
            audit.append(_audit_entry(capability_id, [], ["outside compatibility top-k"], excluded=True))
            continue
        if selected_by_kind.get(kind, 0) >= limits.get(kind, 0) and not explicit:
            excluded.append({"id": capability_id, "reason": f"{kind} kind limit reached"})
            audit.append(_audit_entry(capability_id, [], [f"{kind} kind limit reached"], excluded=True))
            continue

        why = "explicit capability id requested" if explicit else "provided by request capability list"
        summary = _compact_summary(manifest, why)
        selected.append(summary)
        selected_by_kind[kind] = selected_by_kind.get(kind, 0) + 1
        audit.append(_audit_entry(capability_id, [summary["why"]], [], excluded=False))

    selected_groups = _group_selected(selected)
    return {
        "schemaVersion": 1,
        "intent": _intent(req, selected),
        "selected": selected,
        "excluded": sorted(excluded, key=lambda item: item["id"]),
        "excludedCapabilities": sorted(excluded, key=lambda item: item["id"]),
        "auditTrace": sorted(audit, key=lambda item: item["id"]),
        "needsMoreDiscovery": len(selected) == 0 and len(list(manifests)) == 0,
        "verificationPolicy": _verification_policy(selected),
        "invocationBudget": {
            "maxCandidates": req.top_k,
            "maxDocsToLoad": req.max_docs_to_load,
            "maxContextTokens": req.max_context_tokens,
        },
        **selected_groups,
    }


def select_capabilities(
    request: CapabilityRequest | Mapping[str, Any],
    manifests: Sequence[Mapping[str, Any]],
    *,
    kind_limits: Mapping[str, int] | None = None,
) -> dict[str, Any]:
    """Compatibility alias for callers that use the old selector name."""

    return build_capability_brief(request, manifests, kind_limits=kind_limits)


def broker_capabilities(
    request: CapabilityRequest | Mapping[str, Any],
    manifest_paths: str | Path | Sequence[str | Path] | None = None,
    manifests: Sequence[Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """Load manifests when requested and return the compatibility envelope."""

    loaded = list(manifests or [])
    if manifest_paths is not None:
        loaded.extend(load_capability_manifests(manifest_paths))
    return build_capability_brief(request, loaded)


def _from_runtime_output(payload: Mapping[str, Any], req: CapabilityRequest) -> dict[str, Any] | None:
    if payload.get("contract") != "sciforge.capability-broker-output.v1":
        return None
    briefs = _mapping_list(payload.get("briefs"))
    excluded = [
        {"id": _text(item.get("id")), "reason": _text(item.get("reason"))}
        for item in _mapping_list(payload.get("excluded"))
        if _text(item.get("id"))
    ]
    selected = [_compact_summary(brief, _text(brief.get("matchedSignals")) or "selected by runtime") for brief in briefs]
    audit = []
    for item in _mapping_list(payload.get("audit")):
        capability_id = _text(item.get("id"))
        if not capability_id:
            continue
        excluded_reason = _text(item.get("excluded"))
        audit.append(
            _audit_entry(
                capability_id,
                _list(item.get("matchedSignals")),
                [*_list(item.get("penalties")), *([excluded_reason] if excluded_reason else [])],
                excluded=bool(excluded_reason),
                score=_float(item.get("score")),
            )
        )
    return {
        "schemaVersion": 1,
        "intent": _intent(req, selected),
        "selected": selected,
        "excluded": sorted(excluded, key=lambda item: item["id"]),
        "excludedCapabilities": sorted(excluded, key=lambda item: item["id"]),
        "auditTrace": sorted(audit, key=lambda item: item["id"]),
        "needsMoreDiscovery": len(selected) == 0,
        "verificationPolicy": _verification_policy(selected),
        "invocationBudget": {
            "maxCandidates": req.top_k,
            "maxDocsToLoad": req.max_docs_to_load,
            "maxContextTokens": req.max_context_tokens,
        },
        **_group_selected(selected),
    }


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
    return normalized, None


def _compact_summary(manifest: Mapping[str, Any], why: str) -> dict[str, Any]:
    domains = _list(manifest.get("domain", manifest.get("domains")))
    artifacts = _list(manifest.get("artifacts", manifest.get("expectedArtifacts", manifest.get("outputTypes"))))
    summary = {
        "id": _text(manifest.get("id")),
        "kind": _normalize_kind(manifest.get("kind")) or _text(manifest.get("kind")),
        "summary": _truncate(_text(manifest.get("summary") or manifest.get("brief") or manifest.get("description") or manifest.get("title")), 180),
        "why": _truncate(why, 220),
        "score": _float(manifest.get("score")),
        "domains": domains[:5],
        "allowedOperations": _list(manifest.get("allowedOperations", manifest.get("operations")))[:6],
        "expectedArtifacts": artifacts[:6],
        "cost": _text(manifest.get("cost")) or "unknown",
        "latency": _text(manifest.get("latency")) or "unknown",
        "risk": _risk_list(manifest)[:6],
        "sideEffects": _list(manifest.get("sideEffects", manifest.get("side_effects")))[:6],
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


def _intent(req: CapabilityRequest, selected: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    domains = _unique(domain for item in selected for domain in _list(item.get("domains")))
    artifact_types = _unique([*req.expected_artifacts, *[artifact for item in selected for artifact in _list(item.get("expectedArtifacts"))]])
    return {
        "domain": domains[0] if domains else "general",
        "taskType": req.task_type or "general",
        "modalities": _unique(req.modalities),
        "riskLevel": req.risk_tolerance,
        "expectedArtifactTypes": artifact_types[:8],
        "scenario": req.scenario or None,
    }


def _verification_policy(selected: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    has_verifier = any(item.get("kind") == "verifier" for item in selected)
    if has_verifier:
        return {"required": True, "mode": "automatic", "reason": "selected verifier can validate expected artifacts"}
    if selected:
        return {"required": False, "mode": "lightweight", "reason": "selected capabilities provided by runtime or request"}
    return {"required": False, "mode": "none", "reason": "no capability selected"}


def _audit_entry(
    capability_id: str,
    reasons: Sequence[str],
    penalties: Sequence[str],
    *,
    excluded: bool,
    score: float = 0,
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
    aliases = {
        "ui": "ui-component",
        "component": "ui-component",
        "view": "ui-component",
        "observe": "sense",
        "actions": "action",
        "skills": "skill",
        "runtime-adapter": "tool",
    }
    kind = aliases.get(kind, kind)
    return kind if kind in _VALID_KINDS else ""


def _internal_agent_mode(manifest: Mapping[str, Any]) -> InternalAgentMode:
    raw = manifest.get("internalAgent", manifest.get("internal_agent"))
    if raw is True:
        return "optional"
    value = _text(raw).lower()
    return value if value in {"optional", "required"} else "none"


def _risk_list(manifest: Mapping[str, Any]) -> list[str]:
    safety = manifest.get("safety")
    if isinstance(safety, Mapping):
        return _list(safety.get("risk"))
    return _list(manifest.get("risk", manifest.get("riskLevel", manifest.get("risk_level"))))


def _mapping_list(value: Any) -> list[Mapping[str, Any]]:
    if not isinstance(value, Iterable) or isinstance(value, (str, bytes, Mapping)):
        return []
    return [item for item in value if isinstance(item, Mapping)]


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


def _float(value: Any, *, default: float = 0) -> float:
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
    return text[: max(0, limit - 1)].rstrip() + "..."


__all__ = [
    "CapabilityRequest",
    "ScoredCapability",
    "broker_capabilities",
    "build_capability_brief",
    "load_capability_manifests",
    "select_capabilities",
]
