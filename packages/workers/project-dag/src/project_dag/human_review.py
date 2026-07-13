"""Deterministic Project-level human-review policy and aggregation.

The evaluator is deliberately pure.  It annotates only the subject that owns a
signal; claim/decision signals are never copied to ancestor Goals.  Workflow
code owns persistence of the resulting Review Packet.
"""
from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from typing import Any, Iterable

from .contracts import canonical_json, digest_json


LEVELS = ("none", "optional", "recommended", "required")
LEVEL_WEIGHT = {name: index for index, name in enumerate(LEVELS)}
REVIEW_STATUSES = {
    "not_needed", "pending", "approved", "rejected", "deferred", "expired",
}
POLICY_VERSION = "project-human-review/v1"
_HARD_HUMAN_CODES = {
    "root_intent_reframe", "irreversible_action", "external_action",
    "human_risk_override", "upstream_review_required",
}


def _clamp(value: Any, default: float = 0.0) -> float:
    try:
        return round(max(0.0, min(1.0, float(value))), 4)
    except (TypeError, ValueError):
        return default


def _reason(code: str, message: str, source_type: str, source_id: str) -> dict:
    return {
        "code": code, "message": message,
        "sourceType": source_type, "sourceId": source_id,
    }


def _checker(authority: str = "advisory", *, method: str = POLICY_VERSION) -> dict:
    return {
        "actorType": "rule", "actor": "project-dag:human-review-policy",
        "method": method, "authority": authority,
    }


def _signal(subject_type: str, subject_id: str, level: str, score: float,
            reason: dict, *, status: str = "pending", checker: dict | None = None,
            blast_radius: float = 0.0, machine_check: dict | None = None) -> dict:
    return {
        "subjectType": subject_type, "subjectId": subject_id,
        "level": level, "score": _clamp(score), "status": status,
        "reasons": [reason], "checker": checker or _checker(),
        "blastRadius": _clamp(blast_radius),
        "machineChecks": [machine_check or {
            "code": reason["code"], "status": "flagged", "score": _clamp(score),
        }],
    }


def normalize_upstream_review(value: Any, source_id: str) -> dict | None:
    """Accept a forward-compatible Evidence ``humanReview`` summary."""
    if not isinstance(value, dict):
        return None
    level = value.get("level")
    status = value.get("status", "pending")
    if level not in LEVEL_WEIGHT or status not in REVIEW_STATUSES:
        return None
    reasons = []
    for item in value.get("reasons") or []:
        if not isinstance(item, dict) or not str(item.get("code") or "").strip():
            continue
        reasons.append(_reason(
            str(item["code"]), str(item.get("message") or item["code"]),
            str(item.get("sourceType") or "evidenceSnapshot"),
            str(item.get("sourceId") or source_id),
        ))
    if not reasons and level != "none":
        reasons.append(_reason(
            "upstream_review_required", "Evidence review metadata requests project review.",
            "evidenceSnapshot", source_id,
        ))
    checker = value.get("checker") if isinstance(value.get("checker"), dict) else _checker(
        "blocking" if value.get("blocking") else "advisory",
        method="evidence-human-review/compatible",
    )
    upstream_status = status
    # A rejected/deferred Evidence decision is not approval for Project use.
    # Escalate it as a fresh Project disposition instead of silently dropping
    # it because Project packet construction only queues pending signals.
    if status in {"rejected", "deferred", "expired"}:
        status = "pending"
        reasons.append(_reason(
            f"upstream_review_{upstream_status}",
            f"The Evidence review is {upstream_status}; Project use needs disposition.",
            "evidenceSnapshot", source_id,
        ))
    return {
        "subjectType": "evidenceSnapshot", "subjectId": source_id,
        "level": level, "score": _clamp(value.get("score")), "status": status,
        "reasons": reasons, "checker": checker,
        "blastRadius": _clamp(value.get("blastRadius")),
        "machineChecks": [*list(value.get("machineChecks") or []), {
            "code": "upstream_review_status", "status": upstream_status,
            "sourceId": source_id,
        }],
        "upstreamBlocking": bool(value.get("blocking")),
        "upstreamReviewPacketId": value.get("reviewPacketId"),
    }


def _merge_signals(signals: Iterable[dict]) -> list[dict]:
    grouped: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for signal in signals:
        grouped[(signal["subjectType"], signal["subjectId"])].append(signal)
    merged: list[dict] = []
    for (subject_type, subject_id), items in sorted(grouped.items()):
        highest = max(items, key=lambda item: (LEVEL_WEIGHT[item["level"]], item["score"]))
        reasons = {
            (reason["code"], reason["sourceType"], reason["sourceId"]): reason
            for item in items for reason in item["reasons"]
        }
        checks = {
            canonical_json(check): check for item in items for check in item["machineChecks"]
        }
        merged.append({
            **highest,
            "subjectType": subject_type, "subjectId": subject_id,
            "score": max(item["score"] for item in items),
            "blastRadius": max(item["blastRadius"] for item in items),
            "reasons": [reasons[key] for key in sorted(reasons)],
            "machineChecks": [checks[key] for key in sorted(checks)],
            "upstreamBlocking": any(item.get("upstreamBlocking") for item in items),
        })
    return merged


def _apply_mode(signal: dict, mode: str, checkpoints: set[str]) -> dict:
    reason_codes = {reason["code"] for reason in signal["reasons"]}
    checkpointed = bool(
        checkpoints & (reason_codes | {signal["subjectId"], signal["subjectType"]})
    )
    level = signal["level"]
    if mode == "supervised" and level != "none":
        level = "required"
    elif checkpointed:
        level = "required"
    hard = bool(reason_codes & _HARD_HUMAN_CODES) or signal.get("upstreamBlocking", False)
    blocking = (
        level != "none" if mode == "supervised"
        else level == "required" if mode == "checkpointed"
        else hard
    )
    if signal.get("status") == "approved":
        blocking = False
    authority = (
        signal["checker"].get("authority")
        if signal.get("status") == "approved" else
        "blocking" if blocking else "automatic" if mode == "autonomous" else "advisory"
    )
    return {**signal, "level": level, "blocking": blocking,
            "checker": {**signal["checker"], "authority": authority}}


def evaluate_project_human_review(*, project_key: str, graph: dict,
                                  assessments: list[dict], evidence_reviews: list[dict],
                                  open_reviews: list[dict], policy: dict,
                                  input_identity: Any, created_at: str) -> dict:
    """Return annotated graph/assessments plus one de-duplicated packet draft."""
    mode = str(policy.get("autonomy_mode") or "checkpointed")
    checkpoints = set(policy.get("checkpoints") or [])
    signals: list[dict] = []
    for review in evidence_reviews:
        if not isinstance(review, dict) or review.get("level") not in LEVEL_WEIGHT:
            continue
        source_id = str(review.get("subjectId") or review.get("sourceId") or "evidence")
        normalized = normalize_upstream_review(review, source_id)
        if normalized:
            signals.append(normalized)
    origins: dict[str, set[str]] = defaultdict(set)
    for origin in graph.get("origins") or []:
        origins[str(origin.get("claim_id"))].add(str(origin.get("session_id")))

    for goal in graph.get("goals") or []:
        goal_id = str(goal.get("root_id") or goal.get("id"))
        if goal.get("status") == "blocked":
            signals.append(_signal("goal", goal_id, "required", 0.95,
                _reason("goal_blocked", "Goal is blocked and needs disposition.", "goal", goal_id),
                blast_radius=1.0))
        elif goal.get("status") == "at_risk":
            signals.append(_signal("goal", goal_id, "recommended", 0.72,
                _reason("goal_at_risk", "Goal is marked at risk.", "goal", goal_id),
                blast_radius=0.8))

    for claim in graph.get("claims") or []:
        claim_id = str(claim["id"])
        status = claim.get("status")
        sessions = origins.get(claim_id, set())
        if status == "conflicted":
            code = "cross_session_conflict" if len(sessions) > 1 else "claim_conflicted"
            message = ("Claim conflicts across included sessions."
                       if len(sessions) > 1 else "Claim has unresolved contradictory support.")
            signals.append(_signal("claim", claim_id, "required", 0.92,
                _reason(code, message, "claim", claim_id), blast_radius=1.0,
                machine_check={"code": code, "status": "failed", "sessions": sorted(sessions)}))
        elif status == "fragile":
            signals.append(_signal("claim", claim_id, "recommended", 0.68,
                _reason("claim_fragile", "Claim support is fragile.", "claim", claim_id),
                blast_radius=0.6))
        elif status == "undetermined":
            signals.append(_signal("claim", claim_id, "optional", 0.45,
                _reason("claim_undetermined", "Claim status is undetermined.", "claim", claim_id)))
        load = _clamp(claim.get("load_bearing"))
        blast = min(1.0, float(claim.get("blast_radius") or 0) / 10.0)
        if load >= 0.7 or blast >= 0.3:
            signals.append(_signal("claim", claim_id, "recommended", max(0.7, load, blast),
                _reason("key_conclusion", "Claim is load-bearing or has a broad blast radius.",
                        "claim", claim_id), blast_radius=max(load, blast)))

    for decision in graph.get("decisions") or []:
        decision_id = str(decision["id"])
        reversibility = str(decision.get("reversibility") or "").lower()
        if reversibility and reversibility not in {
            "reversible", "fully_reversible", "fully-reversible",
        }:
            signals.append(_signal("decision", decision_id, "required", 0.96,
                _reason("irreversible_action", "Decision is not fully reversible.",
                        "decision", decision_id), blast_radius=1.0))
        if decision.get("action") == "request_evidence":
            signals.append(_signal("decision", decision_id, "required", 0.9,
                _reason("external_action", "Decision requests work outside the Project DAG.",
                        "decision", decision_id), blast_radius=0.8))
        if decision.get("action") == "override":
            human = decision.get("decided_by") == "human"
            signals.append(_signal("decision", decision_id, "required", 0.98,
                _reason("human_risk_override", "Risk override requires explicit human authority.",
                        "decision", decision_id), status="approved" if human else "pending",
                checker=_checker("override" if human else "blocking"), blast_radius=1.0))

    enriched_assessments = deepcopy(assessments)
    for assessment in enriched_assessments:
        assessment_id = str(assessment.get("target_id") or assessment.get("targetId"))
        result = assessment.get("result")
        if result == "failed":
            level = "required" if assessment.get("dimension") in {"integrity", "provenance"} \
                else "recommended"
            signals.append(_signal("assessment", assessment_id, level,
                1.0 - _clamp(assessment.get("confidence")),
                _reason("assessment_failed", "Machine assessment failed.",
                        "assessment", assessment_id), blast_radius=0.7))
        elif result == "uncertain":
            signals.append(_signal("assessment", assessment_id, "optional", 0.5,
                _reason("assessment_uncertain", "Machine assessment is uncertain.",
                        "assessment", assessment_id), blast_radius=0.3))

    for review in open_reviews:
        subject_id = str(review.get("subject_id") or "")
        review_type = str(review.get("review_type") or "")
        if not subject_id or review_type == "human_review_packet":
            continue
        code = "root_intent_reframe" if review_type == "reframe_proposal" else "human_checkpoint"
        subject_type = "goal" if review_type == "reframe_proposal" else "finding"
        signals.append(_signal(subject_type, subject_id, "required", 1.0,
            _reason(code, "An existing governance item requires human disposition.",
                    subject_type, subject_id), blast_radius=1.0))

    merged = [
        {**_apply_mode(item, mode, checkpoints),
         "policyVersion": str(policy.get("policy_version", 1))}
        for item in _merge_signals(signals)
    ]
    packet_items = [item for item in merged
                    if item["status"] == "pending"
                    and item["level"] in {"recommended", "required"}]
    packet = None
    if packet_items:
        subject_ids = sorted({item["subjectId"] for item in packet_items})
        reasons = {canonical_json(reason): reason for item in packet_items for reason in item["reasons"]}
        packet_id = digest_json({
            "projectKey": project_key, "policyVersion": str(policy.get("policy_version", 1)),
            "inputIdentity": input_identity, "subjects": subject_ids,
            "reasons": sorted(reasons),
        }, "review_packet")
        for item in packet_items:
            item["reviewPacketId"] = packet_id
        blocking = any(item["blocking"] and item["status"] == "pending" for item in packet_items)
        reason_list = [reasons[key] for key in sorted(reasons)]
        packet = {
            "id": packet_id, "projectKey": project_key, "status": "pending",
            "level": max((item["level"] for item in packet_items), key=LEVEL_WEIGHT.get),
            "score": max(item["score"] for item in packet_items), "blocking": blocking,
            "subjectIds": subject_ids, "reasons": reason_list,
            "checker": _checker("blocking" if blocking else "advisory"),
            "question": "Should these project-level findings be approved, rejected, deferred, or sent for more evidence?",
            "machineChecks": [check for item in packet_items for check in item["machineChecks"]],
            "delta": {"addedSubjectIds": subject_ids, "removedSubjectIds": []},
            "blastRadius": max(item["blastRadius"] for item in packet_items),
            "recommendedAction": "request_evidence" if any(
                reason["code"] in {
                    "cross_session_conflict", "external_action", "claim_fragile",
                    "upstream_review_rejected", "upstream_review_deferred",
                    "upstream_review_expired",
                }
                for reason in reason_list
            ) else "approve",
            "options": ["approve", "reject", "defer", "request_evidence"],
            "policyVersion": str(policy.get("policy_version", 1)),
            "createdAt": created_at, "updatedAt": created_at,
        }

    # Attach only to direct owners; never copy a descendant signal to a Goal.
    by_subject = {(item["subjectType"], item["subjectId"]): item for item in merged}
    annotated_graph = deepcopy(graph)
    for collection, subject_type, id_key in (
        ("goals", "goal", "root_id"), ("claims", "claim", "id"),
        ("decisions", "decision", "id"),
    ):
        for node in annotated_graph.get(collection) or []:
            item = by_subject.get((subject_type, str(node.get(id_key) or node.get("id"))))
            if item:
                node["humanReview"] = review_contract(item, created_at)
    for assessment in enriched_assessments:
        item = by_subject.get(("assessment", str(
            assessment.get("target_id") or assessment.get("targetId"))))
        if item:
            assessment["humanReview"] = review_contract(item, created_at)

    human_reviews = [review_contract(item, created_at) | {
        "subjectType": item["subjectType"], "subjectId": item["subjectId"],
    } for item in merged]
    annotated_graph["humanReviews"] = human_reviews
    return {"graph": annotated_graph, "assessments": enriched_assessments,
            "humanReviews": human_reviews, "reviewPacket": packet}


def review_contract(item: dict, timestamp: str) -> dict:
    status = item.get("status", "pending")
    return {
        "level": item["level"], "score": item["score"], "status": status,
        "reasons": item["reasons"], "blocking": bool(item.get("blocking")),
        **({"reviewPacketId": item["reviewPacketId"]} if item.get("reviewPacketId") else {}),
        "policyVersion": str(item.get("policyVersion", POLICY_VERSION)),
        "checker": item["checker"],
        "createdAt": timestamp, "updatedAt": timestamp,
        **({"completedAt": timestamp} if status in {"approved", "rejected", "deferred"} else {}),
    }
