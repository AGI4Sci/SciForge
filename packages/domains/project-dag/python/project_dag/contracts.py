"""Canonical immutable contracts shared by compiler, queue and HTTP facade."""
from __future__ import annotations

import hashlib
import json
from typing import Any, Iterable, Mapping


AUTONOMY_MODES = {"autonomous", "checkpointed", "supervised"}
DECISION_ACTIONS = {
    "endorse", "challenge", "supersede", "request_evidence", "rollback",
    "resolve", "defer", "override",
}
A3_AUTOMATED_ACTIONS = {
    "resolve", "defer", "request_evidence", "challenge", "override",
}

# Stage 4 governance contracts.  These are deliberately data-only so the
# compiler, service and any future UI can share one deterministic policy.
PROJECT_INVALIDATION_POLICY_V1 = "project-invalidation-policy/v1"
DECISION_POLICY_V1 = "decision-policy/v1"
DECISION_ACTION_CLASSES = {
    "draft_internal_reversible",
    "certified_internal",
    "public_external",
    "specialized_high_impact",
}
DEFAULT_DECISION_RULES = {
    "draft_internal_reversible": {
        "agentOnly": True,
        "requiredRoles": [],
        "quorum": 0,
        "allowCertification": False,
        "trustedRoleSource": None,
    },
    "certified_internal": {
        "agentOnly": False,
        "requiredRoles": [{"role": "accountable_human", "count": 1}],
        "quorum": 1,
        "allowCertification": True,
        "trustedRoleSource": "project-governance",
    },
    "public_external": {
        "agentOnly": False,
        "requiredRoles": [{"role": "accountable_human", "count": 1}],
        "quorum": 1,
        "allowCertification": True,
        "trustedRoleSource": "project-governance",
    },
    # No discipline-specific role source is installed by default.  This rule
    # therefore fails closed until a workspace governance authority installs it.
    "specialized_high_impact": {
        "agentOnly": False,
        "requiredRoles": [],
        "quorum": 1,
        "allowCertification": False,
        "trustedRoleSource": None,
    },
}
MATERIAL_PROJECT_INPUT_FIELDS = frozenset({
    "goalIntent", "capturedScope", "evidenceVector", "evidenceClosures",
    "evidenceSchemaVersion", "evidenceExtractorVersion",
    "evidenceVerifierVersion", "evidenceClosurePolicyVersion",
    "projectCompilerVersion", "projectPolicyVersion", "sourceLifecycleRevision",
    "artifactLifecycleRevision", "aclRevision", "consentRevision",
    "retentionRevision", "actionTarget", "outputArtifactVersions", "risk",
})
NON_MATERIAL_PROJECT_INPUT_FIELDS = frozenset({
    "layout", "presentation", "selectedTab", "displayLabel",
})


def classify_project_invalidation(field: str, *, formal_gate: bool = False) -> str:
    """Classify one changed fingerprint field, failing closed for unknowns."""
    if field in MATERIAL_PROJECT_INPUT_FIELDS:
        return "material"
    if field in NON_MATERIAL_PROJECT_INPUT_FIELDS:
        return "non_material"
    return "material" if formal_gate else "unknown"


def project_input_fingerprint(context: Mapping[str, Any], prefix: str = "project-input") -> str:
    """Hash the complete authorized Project input context."""
    return digest_json(dict(context), prefix)


def default_decision_rules() -> dict[str, dict]:
    """Return a copy so policy callers cannot mutate the shared defaults."""
    return json.loads(canonical_json(DEFAULT_DECISION_RULES))


def normalize_decision_rules(value: Any) -> dict[str, dict]:
    rules = default_decision_rules()
    if value is None:
        return rules
    if not isinstance(value, Mapping):
        raise ValueError("decisionRules must be an object")
    for action_class, raw in value.items():
        if action_class not in DECISION_ACTION_CLASSES:
            raise ValueError(f"unknown decision action class: {action_class}")
        if not isinstance(raw, Mapping):
            raise ValueError(f"decisionRules.{action_class} must be an object")
        merged = {**rules[action_class], **dict(raw)}
        roles = merged.get("requiredRoles")
        if not isinstance(roles, list) or any(
                not isinstance(item, Mapping)
                or not isinstance(item.get("role"), str)
                or not item["role"].strip()
                or not isinstance(item.get("count"), int)
                or item["count"] <= 0
                for item in roles):
            raise ValueError(f"decisionRules.{action_class}.requiredRoles is invalid")
        if not isinstance(merged.get("quorum"), int) or merged["quorum"] < 0:
            raise ValueError(f"decisionRules.{action_class}.quorum is invalid")
        if not isinstance(merged.get("agentOnly"), bool) \
                or not isinstance(merged.get("allowCertification"), bool):
            raise ValueError(f"decisionRules.{action_class} flags are invalid")
        rules[action_class] = merged
    return rules

_A3_CHALLENGE_MARKERS = (
    "conflict", "contradict", "cycle", "merge", "entailment", "methodology",
)
_A3_DEFER_TYPES = {
    "stale_release_snapshot", "adversarial_applicability",
}
_A3_NON_OVERRIDABLE_TYPES = {
    "broken_provenance", "acyclic_family_cycle", "evidence_watermark_not_reached",
    "stale_release_snapshot",
}


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def digest_json(value: Any, prefix: str = "sha256") -> str:
    raw = canonical_json(value).encode("utf-8")
    return f"{prefix}:{hashlib.sha256(raw).hexdigest()}"


def select_a3_action(finding: dict, *, condition_cleared: bool = False,
                     evidence_supported: bool = False,
                     allow_agent_critical_override: bool = False) -> str:
    """Choose an A3 disposition without pretending a decision is evidence.

    ``resolve`` is reserved for a condition that disappeared on a newer,
    independently assessed snapshot.  ``override`` accepts a still-present
    risk and therefore needs both explicit policy permission and supporting
    assessments.  All other branches keep the scientific condition visible.
    """
    finding_type = str(finding.get("finding_type") or "")
    severity = str(finding.get("severity") or "medium")
    if condition_cleared and evidence_supported:
        return "resolve"
    if (
        severity == "critical"
        and allow_agent_critical_override
        and evidence_supported
        and finding_type not in _A3_NON_OVERRIDABLE_TYPES
    ):
        return "override"
    if finding_type in _A3_DEFER_TYPES or severity == "low":
        return "defer"
    if any(marker in finding_type for marker in _A3_CHALLENGE_MARKERS):
        return "challenge"
    return "request_evidence"


def remediation_candidate(action: str, finding: dict) -> dict:
    """Return a durable, non-executing candidate for the selected decision.

    A candidate can describe external research, but Project DAG never performs
    it.  Runtime remains the sole permission boundary for any later execution.
    """
    if action not in A3_AUTOMATED_ACTIONS:
        raise ValueError(f"invalid A3 remediation action: {action}")
    operation = {
        "resolve": "close_verified_condition",
        "defer": "revisit_on_new_snapshot",
        "request_evidence": "collect_or_reingest_evidence",
        "challenge": "run_independent_adversarial_review",
        "override": "record_explicit_risk_acceptance",
    }[action]
    external = action == "request_evidence"
    target = {
        "findingId": finding.get("id"),
        "findingType": finding.get("finding_type"),
        "subjectId": finding.get("subject_id"),
        "targetDigest": finding.get("target_digest"),
    }
    candidate_id = digest_json({
        "action": action, "operation": operation, "target": target,
    }, "remediation")
    return {
        "id": candidate_id,
        "kind": "remediation_candidate",
        "action": action,
        "operation": operation,
        "target": target,
        "execution": "record_only",
        "externalAction": external,
        "runtimePermissionRequired": external,
    }


def normalize_evidence_vector(value: Iterable[dict]) -> list[dict]:
    by_thread: dict[str, str] = {}
    for entry in value:
        if not isinstance(entry, dict):
            raise ValueError("evidenceVector entries must be objects")
        thread_id = entry.get("threadId")
        digest = entry.get("digest")
        if not isinstance(thread_id, str) or not thread_id.strip():
            raise ValueError("evidenceVector.threadId must be non-empty")
        if not isinstance(digest, str) or not digest.strip():
            raise ValueError("evidenceVector.digest must be non-empty")
        previous = by_thread.get(thread_id)
        if previous is not None and previous != digest:
            raise ValueError(f"evidenceVector has conflicting digests for {thread_id}")
        by_thread[thread_id] = digest
    return [{"threadId": tid, "digest": by_thread[tid]} for tid in sorted(by_thread)]


def normalize_scope(value: dict | None, default_sessions: Iterable[str] = ()) -> dict:
    raw = value or {}
    if not isinstance(raw, dict):
        raise ValueError("capturedScope must be an object")

    def strings(key: str, fallback: Iterable[str] = ()) -> list[str]:
        candidate = raw.get(key, fallback)
        if candidate is None:
            candidate = []
        if not isinstance(candidate, list):
            raise ValueError(f"capturedScope.{key} must be a string array")
        return sorted({x.strip() for x in candidate if isinstance(x, str) and x.strip()})

    included = strings("includedSessions", default_sessions)
    excluded = strings("excludedSessions")
    isolated = strings("isolatedSessions")
    overlap = set(included) & (set(excluded) | set(isolated))
    if overlap:
        raise ValueError(f"capturedScope includes excluded/isolated sessions: {sorted(overlap)}")
    raw_reasons = raw.get("reasons", {})
    if raw_reasons is None:
        raw_reasons = {}
    if not isinstance(raw_reasons, dict):
        raise ValueError("capturedScope.reasons must be an object")
    reasons = {
        key.strip(): value.strip()
        for key, value in raw_reasons.items()
        if isinstance(key, str) and key.strip()
        and isinstance(value, str) and value.strip()
    }
    unknown_reasons = set(reasons) - (set(included) | set(excluded) | set(isolated))
    if unknown_reasons:
        raise ValueError(
            f"capturedScope.reasons reference unknown sessions: {sorted(unknown_reasons)}")
    return {
        "includedSessions": included,
        "excludedSessions": excluded,
        "isolatedSessions": isolated,
        "reasons": dict(sorted(reasons.items())),
    }


def validate_autonomy_mode(mode: str | None) -> str:
    selected = mode or "checkpointed"
    if selected not in AUTONOMY_MODES:
        raise ValueError(f"invalid autonomyMode: {selected}")
    return selected
