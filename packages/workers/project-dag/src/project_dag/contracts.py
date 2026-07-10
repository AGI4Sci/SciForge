"""Canonical immutable contracts shared by compiler, queue and HTTP facade."""
from __future__ import annotations

import hashlib
import json
from typing import Any, Iterable


AUTONOMY_MODES = {"autonomous", "checkpointed", "supervised"}
DECISION_ACTIONS = {
    "endorse", "challenge", "supersede", "request_evidence", "rollback",
    "resolve", "defer", "override",
}
A3_AUTOMATED_ACTIONS = {
    "resolve", "defer", "request_evidence", "challenge", "override",
}

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
    return {
        "includedSessions": included,
        "excludedSessions": excluded,
        "isolatedSessions": isolated,
    }


def validate_autonomy_mode(mode: str | None) -> str:
    selected = mode or "autonomous"
    if selected not in AUTONOMY_MODES:
        raise ValueError(f"invalid autonomyMode: {selected}")
    return selected
