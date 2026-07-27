"""Risk-scored human review policy and bounded review packet aggregation.

The machine assessment ledger remains append-only.  Human review metadata is
derived deterministically from those checks, while decisions are preserved on
stable packets until a semantic change produces a different packet identity.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, replace
from typing import Any, Iterable, Optional

from .digraph import DirectedGraph, descendants
from .graph import ThreadGraph
from .model import (
    Assessment,
    AssessmentDimension,
    AssessmentLevel,
    AssessmentResult,
    EdgeRel,
    HumanReview,
    HumanReviewActorType,
    HumanReviewAuthority,
    HumanReviewChecker,
    HumanReviewLevel,
    HumanReviewReason,
    HumanReviewStatus,
    NodeStatus,
    NodeType,
    ReviewPacket,
)


@dataclass(frozen=True)
class HumanReviewPolicy:
    version: str = "human-review.v1"
    optional_threshold: float = 0.25
    recommended_threshold: float = 0.50
    required_threshold: float = 0.75

    def level_for(self, score: float) -> HumanReviewLevel:
        if score >= self.required_threshold:
            return HumanReviewLevel.REQUIRED
        if score >= self.recommended_threshold:
            return HumanReviewLevel.RECOMMENDED
        if score >= self.optional_threshold:
            return HumanReviewLevel.OPTIONAL
        return HumanReviewLevel.NONE


DEFAULT_POLICY = HumanReviewPolicy()
CHECKER_ACTOR = "evidence-human-review-checker"
CHECKER_METHOD = "risk-score-policy-v1"


def _checker(level: HumanReviewLevel) -> HumanReviewChecker:
    if level == HumanReviewLevel.REQUIRED:
        authority = HumanReviewAuthority.BLOCKING
    elif level == HumanReviewLevel.NONE:
        authority = HumanReviewAuthority.AUTOMATIC
    else:
        authority = HumanReviewAuthority.ADVISORY
    return HumanReviewChecker(
        actor_type=HumanReviewActorType.RULE,
        actor=CHECKER_ACTOR,
        method=CHECKER_METHOD,
        authority=authority,
    )


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "yes", "high", "critical"}


def _critical_reason(graph: ThreadGraph, target_id: str) -> Optional[HumanReviewReason]:
    node = graph.nodes.get(target_id)
    if node is None:
        return None
    attributes = node.attributes or {}
    critical = any(_truthy(attributes.get(key)) for key in (
        "critical", "decisionCritical", "highImpact", "high_impact",
    )) or str(attributes.get("impact", "")).lower() == "high"
    if not critical:
        return None
    return HumanReviewReason(
        code="critical_or_high_impact_target",
        message="The target is marked critical or high impact.",
        source_type="node",
        source_id=target_id,
    )


def _dispute_reason(graph: ThreadGraph, target_id: str) -> Optional[HumanReviewReason]:
    node = graph.nodes.get(target_id)
    disputed = node is not None and node.status in {
        NodeStatus.CONFLICTED, NodeStatus.INVALIDATED,
    }
    disputed = disputed or any(
        edge.rel in {EdgeRel.CONTRADICTS, EdgeRel.INVALIDATES, EdgeRel.FAILS_TO_REPLICATE}
        for incident in (graph.edges_by_src().get(target_id, ()), graph.edges_by_dst().get(target_id, ()))
        for edge in incident
    )
    if not disputed:
        return None
    return HumanReviewReason(
        code="disputed_or_invalidated_target",
        message="Conflicting, invalidating, or failed-replication evidence affects the target.",
        source_type="node",
        source_id=target_id,
    )


def _downstream_count(support: DirectedGraph, target_id: str) -> int:
    """Descendant count on a caller-built supports digraph (built once per pass)."""
    if target_id not in support:
        return 0
    return len(descendants(support, target_id))


def select_a2_targets(
    graph: ThreadGraph,
    *,
    changed_node_ids: Optional[Iterable[str]] = None,
    changed_edge_ids: Optional[Iterable[str]] = None,
) -> dict[str, tuple[HumanReviewReason, ...]]:
    """Select only changed/impacted targets that are critical, disputed, or broad.

    The returned reasons make selection inspectable; they are also reused by
    review scoring.  When no delta is supplied this behaves as a full policy
    audit, still excluding ordinary low-impact claims.
    """
    changed_nodes = set(changed_node_ids or ())
    changed_edges = set(changed_edge_ids or ())
    has_delta_filter = changed_node_ids is not None or changed_edge_ids is not None
    impacted = set(changed_nodes)
    support = graph.supports_digraph()
    for edge_id in changed_edges:
        edge = graph.edges.get(edge_id)
        if edge is not None:
            impacted.update((edge.src, edge.dst))
    for node_id in tuple(impacted):
        if node_id in support:
            impacted.update(descendants(support, node_id))

    selected: dict[str, tuple[HumanReviewReason, ...]] = {}
    for node in graph.nodes.values():
        if node.type not in {NodeType.CLAIM, NodeType.FINDING, NodeType.ASSUMPTION}:
            continue
        if has_delta_filter and node.id not in impacted:
            continue
        reasons = [reason for reason in (
            _critical_reason(graph, node.id),
            _dispute_reason(graph, node.id),
        ) if reason is not None]
        downstream = _downstream_count(support, node.id)
        if downstream >= 3:
            reasons.append(HumanReviewReason(
                code="high_blast_radius",
                message=f"The target influences {downstream} downstream nodes.",
                source_type="node",
                source_id=node.id,
            ))
        if reasons:
            selected[node.id] = tuple(reasons)
    return selected


def _score_assessment(
    graph: ThreadGraph,
    assessment: Assessment,
    policy: HumanReviewPolicy,
    *,
    computed_at: str,
) -> HumanReview:
    score_by_result = {
        AssessmentResult.PASSED: 0.05,
        AssessmentResult.OVERRIDDEN: 0.15,
        AssessmentResult.UNCERTAIN: 0.48,
        AssessmentResult.FAILED: 0.68,
    }
    score = score_by_result[assessment.result]
    reasons: list[HumanReviewReason] = []
    if assessment.result == AssessmentResult.FAILED:
        reasons.append(HumanReviewReason(
            code="machine_check_failed",
            message=f"The {assessment.level.value} {assessment.dimension.value} check failed.",
            source_type="assessment",
            source_id=assessment.assessment_id,
        ))
    elif assessment.result == AssessmentResult.UNCERTAIN:
        reasons.append(HumanReviewReason(
            code="machine_check_uncertain",
            message=f"The {assessment.level.value} {assessment.dimension.value} check is uncertain.",
            source_type="assessment",
            source_id=assessment.assessment_id,
        ))

    if assessment.level == AssessmentLevel.A1:
        score += 0.05
    elif assessment.level == AssessmentLevel.A2:
        score += 0.12

    critical = _critical_reason(graph, assessment.target_id)
    dispute = _dispute_reason(graph, assessment.target_id)
    if critical is not None:
        reasons.append(critical)
        score += 0.18
    if dispute is not None:
        reasons.append(dispute)
        score += 0.15

    deterministic_blocker = (
        assessment.level == AssessmentLevel.A0
        and assessment.result == AssessmentResult.FAILED
        and assessment.dimension in {
            AssessmentDimension.INTEGRITY,
            AssessmentDimension.PROVENANCE,
            AssessmentDimension.REPRODUCIBILITY,
        }
    )
    if deterministic_blocker:
        score = max(score, policy.required_threshold)
        reasons.append(HumanReviewReason(
            code="snapshot_safety_gate_failed",
            message="A deterministic snapshot safety check failed and requires human disposition.",
            source_type="assessment",
            source_id=assessment.assessment_id,
        ))

    score = round(min(1.0, max(0.0, score)), 4)
    level = policy.level_for(score)
    if deterministic_blocker:
        level = HumanReviewLevel.REQUIRED
    status = HumanReviewStatus.NOT_NEEDED if level == HumanReviewLevel.NONE else HumanReviewStatus.PENDING
    return HumanReview(
        level=level,
        score=score,
        status=status,
        reasons=tuple(reasons),
        blocking=level == HumanReviewLevel.REQUIRED,
        policy_version=policy.version,
        computed_at=computed_at,
        checker=_checker(level),
    )


def _packet_id(
    policy_version: str,
    level: HumanReviewLevel,
    target_ids: Iterable[str],
    reason_codes: Iterable[str],
) -> str:
    canonical = json.dumps({
        "policyVersion": policy_version,
        "level": level.value,
        "targetIds": sorted(set(target_ids)),
        "reasonCodes": sorted(set(reason_codes)),
    }, sort_keys=True, separators=(",", ":"))
    return "review-packet:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:24]


def _unique_reasons(reasons: Iterable[HumanReviewReason]) -> tuple[HumanReviewReason, ...]:
    unique: dict[tuple[str, Optional[str], Optional[str]], HumanReviewReason] = {}
    for reason in reasons:
        unique[(reason.code, reason.source_type, reason.source_id)] = reason
    return tuple(unique[key] for key in sorted(
        unique, key=lambda item: tuple(str(part or "") for part in item),
    ))


def _preserve_decision(candidate: ReviewPacket, previous: ReviewPacket) -> ReviewPacket:
    if previous.status not in {
        HumanReviewStatus.APPROVED,
        HumanReviewStatus.REJECTED,
        HumanReviewStatus.DEFERRED,
    }:
        return candidate
    return replace(
        candidate,
        status=previous.status,
        blocking=False if previous.status == HumanReviewStatus.APPROVED else candidate.blocking,
        reviewed_by=previous.reviewed_by,
        reviewed_at=previous.reviewed_at,
    )


def attach_human_reviews(
    graph: ThreadGraph,
    assessments: list[Assessment],
    *,
    delta: Optional[dict[str, Any]],
    computed_at: str,
    policy: HumanReviewPolicy = DEFAULT_POLICY,
) -> tuple[list[Assessment], list[ReviewPacket]]:
    """Annotate assessments and create a bounded, deduplicated review queue."""
    support = graph.supports_digraph()
    reviewed = [replace(
        assessment,
        human_review=_score_assessment(graph, assessment, policy, computed_at=computed_at),
    ) for assessment in assessments]

    # Aggregate by review severity, never by ancestor/target.  A compile can
    # therefore create at most three active packets (optional/recommended/required).
    groups: dict[HumanReviewLevel, list[Assessment]] = {}
    for assessment in reviewed:
        assert assessment.human_review is not None
        if assessment.human_review.level != HumanReviewLevel.NONE:
            groups.setdefault(assessment.human_review.level, []).append(assessment)

    previous_by_id = {packet.review_packet_id: packet for packet in graph.review_packets}
    packets: list[ReviewPacket] = []
    packet_by_assessment: dict[str, str] = {}
    for level in sorted(groups, key=lambda item: item.value):
        members = groups[level]
        reasons = _unique_reasons(
            reason for item in members for reason in item.human_review.reasons  # type: ignore[union-attr]
        )
        targets = tuple(sorted({item.target_id for item in members}))
        packet_id = _packet_id(policy.version, level, targets, (reason.code for reason in reasons))
        score = max(item.human_review.score for item in members if item.human_review is not None)
        blocking = level == HumanReviewLevel.REQUIRED
        candidate = ReviewPacket(
            review_packet_id=packet_id,
            level=level,
            score=score,
            status=HumanReviewStatus.PENDING,
            reasons=reasons,
            blocking=blocking,
            policy_version=policy.version,
            computed_at=computed_at,
            target_ids=targets,
            assessment_ids=tuple(sorted(item.assessment_id for item in members)),
            checker=_checker(level),
            question=(
                "Do the aggregated machine-check findings permit this Evidence Snapshot to be trusted?"
            ),
            machine_checks=tuple({
                "assessmentId": item.assessment_id,
                "targetId": item.target_id,
                "level": item.level.value,
                "dimension": item.dimension.value,
                "result": item.result.value,
                "confidence": item.confidence,
                "actor": item.actor,
                "method": item.method,
            } for item in members),
            delta={
                "newNodeIds": sorted((delta or {}).get("new_nodes") or []),
                "newEdgeIds": sorted((delta or {}).get("new_edges") or []),
            },
            blast_radius={
                "targetCount": len(targets),
                "maxDownstreamNodes": max((_downstream_count(support, target) for target in targets), default=0),
            },
            recommended_action=(
                "Resolve required evidence gaps before relying on the snapshot."
                if blocking else "Inspect the grouped findings and record a disposition."
            ),
            options=(
                {"action": "approve", "label": "Approve"},
                {"action": "reject", "label": "Reject"},
                {"action": "defer", "label": "Defer"},
                {"action": "request_evidence", "label": "Request evidence"},
            ),
        )
        previous = previous_by_id.get(packet_id)
        packet = _preserve_decision(candidate, previous) if previous is not None else candidate
        packets.append(packet)
        for item in members:
            packet_by_assessment[item.assessment_id] = packet_id

    reviewed = [replace(
        item,
        human_review=replace(
            item.human_review,
            review_packet_id=packet_by_assessment.get(item.assessment_id),
            status=(
                next(
                    packet.status for packet in packets
                    if packet.review_packet_id == packet_by_assessment.get(item.assessment_id)
                ) if packet_by_assessment.get(item.assessment_id) else item.human_review.status
            ),
            reviewed_by=(
                next((packet.reviewed_by for packet in packets
                      if packet.review_packet_id == packet_by_assessment.get(item.assessment_id)), None)
            ),
            reviewed_at=(
                next((packet.reviewed_at for packet in packets
                      if packet.review_packet_id == packet_by_assessment.get(item.assessment_id)), None)
            ),
            blocking=(
                next((packet.blocking for packet in packets
                      if packet.review_packet_id == packet_by_assessment.get(item.assessment_id)),
                     item.human_review.blocking)
            ),
        ),
    ) for item in reviewed]

    # Keep prior audit records.  Superseded pending packets are explicitly
    # expired so queues never silently accumulate stale ancestors.
    current_ids = {packet.review_packet_id for packet in packets}
    affected_targets = set((delta or {}).get("new_nodes") or [])
    for edge_id in (delta or {}).get("new_edges") or []:
        edge = graph.edges.get(edge_id)
        if edge is not None:
            affected_targets.update((edge.src, edge.dst))
    for target_id in tuple(affected_targets):
        if target_id in support:
            affected_targets.update(descendants(support, target_id))
    for old in graph.review_packets:
        if old.review_packet_id in current_ids:
            continue
        covered_by_current = any(
            packet.review_packet_id != old.review_packet_id
            and packet.level == old.level
            and set(old.target_ids).issubset(packet.target_ids)
            for packet in packets
        )
        superseded = covered_by_current or bool(affected_targets.intersection(old.target_ids))
        if superseded and old.status == HumanReviewStatus.PENDING:
            packets.append(replace(old, status=HumanReviewStatus.EXPIRED, blocking=False))
        else:
            packets.append(old)
    packets.sort(key=lambda packet: packet.review_packet_id)
    return reviewed, packets


def remap_review_packet_assessment_ids(
    packets: Iterable[ReviewPacket],
    id_map: dict[str, str],
) -> list[ReviewPacket]:
    """Replace provisional assessment ids after binding the snapshot digest."""
    result: list[ReviewPacket] = []
    for packet in packets:
        machine_checks = tuple({
            **check,
            "assessmentId": id_map.get(str(check.get("assessmentId")), str(check.get("assessmentId"))),
        } for check in packet.machine_checks)
        result.append(replace(
            packet,
            assessment_ids=tuple(id_map.get(item, item) for item in packet.assessment_ids),
            machine_checks=machine_checks,
        ))
    return result


def human_review_summary(graph: ThreadGraph) -> Optional[dict[str, Any]]:
    if not graph.review_policy_version and not graph.review_packets:
        return None
    active = [packet for packet in graph.review_packets if packet.status in {
        HumanReviewStatus.PENDING, HumanReviewStatus.DEFERRED,
    }]
    blocking = [packet for packet in graph.review_packets if packet.blocking and packet.status not in {
        HumanReviewStatus.APPROVED, HumanReviewStatus.EXPIRED,
    }]
    gate_status = "blocked" if blocking else ("pending" if active else "clear")
    unresolved = [packet for packet in graph.review_packets if packet.status not in {
        HumanReviewStatus.NOT_NEEDED, HumanReviewStatus.APPROVED, HumanReviewStatus.EXPIRED,
    }]
    level_rank = {
        HumanReviewLevel.NONE: 0,
        HumanReviewLevel.OPTIONAL: 1,
        HumanReviewLevel.RECOMMENDED: 2,
        HumanReviewLevel.REQUIRED: 3,
    }
    highest = max(
        unresolved,
        key=lambda packet: (packet.blocking, level_rank[packet.level], packet.score),
        default=None,
    )
    result: dict[str, Any] = {
        "policyVersion": graph.review_policy_version or DEFAULT_POLICY.version,
        "gateStatus": gate_status,
        "pendingCount": len(active),
        "blockingCount": len(blocking),
        "reviewPacketIds": [packet.review_packet_id for packet in active],
        "reviewPackets": [packet.to_dict() for packet in graph.review_packets],
    }
    if highest is None:
        result.update({
            "level": HumanReviewLevel.NONE.value,
            "score": 0.0,
            "status": HumanReviewStatus.NOT_NEEDED.value,
            "reasons": [],
            "blocking": False,
            "reviewPacketId": None,
            "checker": _checker(HumanReviewLevel.NONE).to_dict(),
            "machineChecks": [],
            "blastRadius": 0.0,
        })
        return result
    raw_radius = int((highest.blast_radius or {}).get("maxDownstreamNodes") or 0)
    radius_denominator = max(1, len(graph.nodes) - 1)
    result.update({
        "level": highest.level.value,
        "score": highest.score,
        "status": highest.status.value,
        "reasons": [reason.to_dict() for reason in highest.reasons],
        "blocking": highest.blocking,
        "reviewPacketId": highest.review_packet_id,
        "checker": highest.checker.to_dict(),
        "machineChecks": list(highest.machine_checks),
        "blastRadius": round(min(1.0, max(0.0, raw_radius / radius_denominator)), 4),
        "computedAt": highest.computed_at,
    })
    if highest.reviewed_by:
        result["reviewedBy"] = highest.reviewed_by
    if highest.reviewed_at:
        result["reviewedAt"] = highest.reviewed_at
    return result
