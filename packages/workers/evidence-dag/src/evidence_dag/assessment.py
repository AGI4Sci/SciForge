"""Append-only A0-A2 assessment ledger generation."""
from __future__ import annotations

import hashlib
import json
import time
from dataclasses import replace
from typing import Any, Optional

from .graph import ThreadGraph
from .llm import LLM
from .model import (
    Assessment,
    AssessmentDimension,
    AssessmentLevel,
    AssessmentResult,
    EdgeRel,
    NodeType,
)

A2_SYSTEM = """EDAG-TASK: adversarial
You are an independent adversarial verifier. Review only the visible claim and
evidence supplied in this request. Look for unsupported leaps, scope mismatch,
alternative explanations, and missing methodology. Do not invent external facts.
Return strict JSON only:
{"result":"passed|failed|uncertain","confidence":0.0,"rationale":"brief visible review rationale"}
"""


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _assessment(
    target_id: str,
    dimension: AssessmentDimension,
    level: AssessmentLevel,
    result: AssessmentResult,
    *,
    actor: str,
    method: str,
    confidence: float,
    rationale: Optional[str] = None,
    created_at: Optional[str] = None,
) -> Assessment:
    created = created_at or _now_iso()
    canonical = json.dumps({
        "targetId": target_id, "dimension": dimension.value, "level": level.value,
        "result": result.value, "actor": actor, "method": method,
        "confidence": round(float(confidence), 6), "createdAt": created,
    }, sort_keys=True, separators=(",", ":"))
    aid = f"assessment:{hashlib.sha256(canonical.encode('utf-8')).hexdigest()[:24]}"
    return Assessment(
        assessment_id=aid, target_id=target_id, dimension=dimension, level=level,
        result=result, actor=actor, method=method, confidence=max(0.0, min(1.0, float(confidence))),
        target_digest="pending", created_at=created, rationale=rationale,
    )


def run_a0(graph: ThreadGraph) -> list[Assessment]:
    assessments = [_assessment(
        f"thread:{graph.thread_id}", AssessmentDimension.PROVENANCE, AssessmentLevel.A0,
        AssessmentResult.PASSED,
        actor="evidence-schema-validator", method="evidence-schema-v1", confidence=1.0,
        rationale="Graph nodes, edges, Artifact records, and selectors passed schema construction.",
    )]
    for node in graph.nodes.values():
        if node.type != NodeType.SOURCE_ASSERTION:
            continue
        artifact = graph.artifacts.get(node.artifact_id or "")
        version = graph.artifact_versions.get(node.artifact_version_id or "")
        anchor = graph.source_anchors.get(node.source_anchor_id or "")
        linked = bool(artifact and version and version.artifact_id == artifact.artifact_id)
        assessments.append(_assessment(
            node.id, AssessmentDimension.PROVENANCE, AssessmentLevel.A0,
            AssessmentResult.PASSED if linked else AssessmentResult.FAILED,
            actor="artifact-link-validator", method="artifact-registry-reference-v1",
            confidence=1.0,
            rationale="SourceAssertion resolves to a registered ArtifactVersion." if linked else
            "SourceAssertion does not resolve to a registered ArtifactVersion.",
        ))
        if linked:
            integrity_result = AssessmentResult.PASSED if (
                version.content_digest and version.availability in {"available", "moved"}
            ) else (AssessmentResult.FAILED if version.availability == "missing" else AssessmentResult.UNCERTAIN)
            assessments.append(_assessment(
                version.version_id, AssessmentDimension.INTEGRITY, AssessmentLevel.A0,
                integrity_result, actor="artifact-digest-validator", method="sha256-and-availability-v1",
                confidence=1.0 if integrity_result != AssessmentResult.UNCERTAIN else 0.5,
                rationale=f"ArtifactVersion availability={version.availability}; "
                          f"contentDigest={'present' if version.content_digest else 'missing'}.",
            ))
        if node.source_anchor_id:
            anchor_valid = bool(
                anchor and version and anchor.artifact_id == node.artifact_id and
                anchor.artifact_version_id == node.artifact_version_id and anchor.anchor_digest
            )
            assessments.append(_assessment(
                node.source_anchor_id, AssessmentDimension.PROVENANCE, AssessmentLevel.A0,
                AssessmentResult.PASSED if anchor_valid else AssessmentResult.FAILED,
                actor="source-anchor-validator", method="structured-selector-and-digest-v1",
                confidence=1.0,
                rationale="Structured selector and anchor digest are valid." if anchor_valid else
                "SourceAnchor linkage, selector, or digest is invalid.",
            ))
    from .lineage import reproducibility_report
    for node in graph.nodes.values():
        if node.type not in {NodeType.EXPERIMENT_RUN, NodeType.ANALYSIS_RUN}:
            continue
        report = reproducibility_report(graph, node.id)
        assessments.append(_assessment(
            node.id, AssessmentDimension.REPRODUCIBILITY, AssessmentLevel.A0,
            AssessmentResult.PASSED if report["complete"] else AssessmentResult.FAILED,
            actor="run-manifest-validator", method="strict-l4-run-manifest-v1",
            confidence=1.0,
            rationale=(
                "Run has verified inputs, software, parameters, environment, logs, and outputs."
                if report["complete"] else
                "Run is not L4 complete: " + ", ".join(
                    item["reason"] for item in report["breakpoints"]
                )
            ),
        ))
    return assessments


def run_a1(
    graph: ThreadGraph,
    *,
    threshold: float,
    verifier_version: str,
    target_edge_ids: Optional[set[str]] = None,
) -> list[Assessment]:
    """Assess semantic edges, optionally restricted to the current delta.

    Passing ``None`` retains the public full-audit behavior.  The incremental
    compiler passes the set of newly introduced edge ids so A1 cost is tied to
    semantic change instead of total thread history.
    """
    assessments: list[Assessment] = []
    for edge in graph.edges.values():
        if target_edge_ids is not None and edge.id not in target_edge_ids:
            continue
        if edge.rel not in {EdgeRel.SUPPORTS, EdgeRel.CONTRADICTS}:
            continue
        if edge.nli_score is None:
            result, confidence = AssessmentResult.UNCERTAIN, 0.0
        else:
            result = AssessmentResult.PASSED if edge.nli_score >= threshold else AssessmentResult.FAILED
            confidence = edge.nli_score if result == AssessmentResult.PASSED else 1.0 - edge.nli_score
        assessments.append(_assessment(
            edge.id, AssessmentDimension.ENTAILMENT, AssessmentLevel.A1, result,
            actor=f"independent-verifier:{verifier_version}",
            method=f"independent-prompt:nli-{edge.rel.value}-v1", confidence=confidence,
            rationale=f"{edge.rel.value} score={edge.nli_score}; threshold={threshold}.",
        ))
    return assessments


def run_a2(
    graph: ThreadGraph,
    llm: LLM,
    *,
    reviewer_version: str,
    target_ids: Optional[set[str]] = None,
) -> list[Assessment]:
    """Run adversarial review only for policy-selected semantic targets."""
    assessments: list[Assessment] = []
    for node in graph.nodes.values():
        if target_ids is not None and node.id not in target_ids:
            continue
        if node.type not in {NodeType.CLAIM, NodeType.FINDING, NodeType.ASSUMPTION}:
            continue
        path = graph.provenance_path(node.id)
        evidence = [
            item["content"] for item in path["nodes"]
            if item["id"] != node.id and item["type"] in {"source_assertion", "reasoning"}
        ]
        try:
            raw = llm.chat([
                {"role": "system", "content": A2_SYSTEM},
                {"role": "user", "content": "CLAIM: " + node.content + "\nVISIBLE EVIDENCE:\n- " +
                 "\n- ".join(evidence[:20])},
            ], temperature=0.0, max_tokens=300)
            parsed = json.loads(raw)
            result = AssessmentResult(str(parsed.get("result", "uncertain")))
            confidence = max(0.0, min(1.0, float(parsed.get("confidence", 0.0))))
            rationale = str(parsed.get("rationale") or "No rationale returned.")[:800]
        except (TypeError, ValueError, json.JSONDecodeError, RuntimeError) as exc:
            result, confidence = AssessmentResult.UNCERTAIN, 0.0
            rationale = f"Independent adversarial review failed safely: {type(exc).__name__}."
        assessments.append(_assessment(
            node.id, AssessmentDimension.METHODOLOGY, AssessmentLevel.A2, result,
            actor=f"independent-adversarial-reviewer:{reviewer_version}",
            method="independent-prompt-and-context:adversarial-v1", confidence=confidence,
            rationale=rationale,
        ))
    return assessments


def bind_target_digest(assessments: list[Assessment], target_digest: str) -> list[Assessment]:
    bound: list[Assessment] = []
    for assessment in assessments:
        canonical = f"{assessment.assessment_id}|{target_digest}"
        bound.append(replace(
            assessment,
            assessment_id=f"assessment:{hashlib.sha256(canonical.encode('utf-8')).hexdigest()[:24]}",
            target_digest=target_digest,
        ))
    return bound
