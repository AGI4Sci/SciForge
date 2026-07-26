"""Evidence Audit Runs: adversarial, deterministic review over an Evidence DAG.

An audit run is not a new belief in the graph. It is a review artifact derived
from the current graph + analysis view: "what could be wrong if a researcher
tries to reuse these conclusions?"  The first implementation is deliberately
deterministic and cheap so it can run after normal ingest without slowing the
agent's exploration loop.
"""
from __future__ import annotations

import hashlib
import time
import uuid
from typing import Any, Optional

from . import analysis as _analysis
from .graph import ThreadGraph
from .model import NodeStatus, NodeType

VALID_TRIGGERS = {"auto", "manual"}
_SEVERITY_ORDER = {"info": 0, "minor": 1, "major": 2, "blocker": 3}


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _brief(text: str, limit: int = 180) -> str:
    compact = " ".join((text or "").split())
    return compact[:limit]


def _normalize(value: Any, allowed: set[str], fallback: str) -> str:
    raw = str(value or "").strip().lower()
    return raw if raw in allowed else fallback


def _finding_id(run_id: str, target_id: str, finding_type: str) -> str:
    digest = hashlib.sha1(f"{run_id}|{target_id}|{finding_type}".encode("utf-8")).hexdigest()[:10]
    return f"finding:{digest}"


def graph_digest(graph: ThreadGraph) -> str:
    """Stable digest for the current DAG payload, independent of audit run id."""
    import json

    payload = json.dumps(graph.to_dict(), sort_keys=True, separators=(",", ":"))
    return f"sha256:{hashlib.sha256(payload.encode('utf-8')).hexdigest()}"


def finding_fingerprint(thread_id: str, dag_digest: str, target_id: str, finding_type: str) -> str:
    digest = hashlib.sha1(
        f"{thread_id}|{dag_digest}|{target_id}|{finding_type}".encode("utf-8")
    ).hexdigest()[:16]
    return f"finding-fp:{digest}"


def _node_payload(graph: ThreadGraph, node_id: str) -> dict:
    node = graph.nodes.get(node_id)
    if node is None:
        return {"id": node_id, "type": "unknown", "content": ""}
    return {
        "id": node.id,
        "type": node.type.value,
        "content": _brief(node.content),
        "status": node.status.value,
        "trace_refs": list(node.trace_refs),
    }


def _risk_digest(findings: list[dict]) -> dict:
    counts = {"blocker": 0, "major": 0, "minor": 0, "info": 0}
    for finding in findings:
        sev = finding.get("severity", "info")
        if sev in counts:
            counts[sev] += 1
    highest = "none"
    for sev in ("blocker", "major", "minor", "info"):
        if counts[sev]:
            highest = sev
            break
    if counts["blocker"]:
        recommendation = "block_commit_until_resolved"
    elif counts["major"]:
        recommendation = "revise_or_accept_risk_before_commit"
    elif counts["minor"]:
        recommendation = "continue_with_attention"
    else:
        recommendation = "no_action_needed"
    return {
        "status": "risks_found" if findings else "clean",
        "total_findings": len(findings),
        "counts_by_severity": counts,
        "highest_severity": highest,
        "recommendation": recommendation,
    }


def run_audit(
    graph: ThreadGraph,
    *,
    threshold: float = 0.7,
    trigger: str = "manual",
    run_id: Optional[str] = None,
    started_at: Optional[str] = None,
    target_digest: Optional[str] = None,
    level: str = "L0",
) -> dict:
    """Run a deterministic adversarial review over the current DAG.

    The reviewer consumes the same structural analysis shown in the UI and turns
    it into actionable findings: ungrounded claims, contradictions, single-source
    dependencies, pseudo-robust support, weak support, load-bearing evidence, and
    low-credibility sources. It never mutates the graph.
    """
    trigger = _normalize(trigger, VALID_TRIGGERS, "manual")
    if level != "L0":
        raise ValueError("Evidence worker currently supports only L0 structural AuditRun")
    run_id = run_id or f"audit:{uuid.uuid4().hex[:12]}"
    started = started_at or _now_iso()
    analysis = _analysis.analyze(graph, threshold=threshold)
    dag_digest = target_digest or graph_digest(graph)

    findings: list[dict] = []
    seen: set[tuple[str, str]] = set()

    def add(
        target_id: str,
        finding_type: str,
        severity: str,
        title: str,
        rationale: str,
        recommended_fix: str,
        *,
        evidence_refs: Optional[list[str]] = None,
        metadata: Optional[dict] = None,
    ) -> None:
        key = (target_id, finding_type)
        if key in seen:
            return
        seen.add(key)
        node = _node_payload(graph, target_id)
        findings.append({
            "id": _finding_id(run_id, target_id, finding_type),
            "fingerprint": finding_fingerprint(graph.thread_id, dag_digest, target_id, finding_type),
            "target_id": target_id,
            "target": node,
            "finding_type": finding_type,
            "severity": severity if severity in _SEVERITY_ORDER else "info",
            "title": title,
            "rationale": rationale,
            "recommended_fix": recommended_fix,
            "evidence_refs": evidence_refs or [target_id],
            "metadata": metadata or {},
            "status": "open",
        })

    for item in analysis.get("fragile", []):
        target_id = item["id"]
        reasons = item.get("reasons", [])
        spof = item.get("spof", [])
        if item.get("n_sources", 0) == 0:
            add(
                target_id,
                "missing_evidence",
                "blocker",
                "Ungrounded conclusion",
                "This conclusion has no upstream source evidence in the current Evidence DAG.",
                "Add source evidence, downgrade the wording, or remove the conclusion from committed outputs.",
                evidence_refs=[target_id],
                metadata={"reasons": reasons},
            )
        if item.get("contested"):
            add(
                target_id,
                "contradiction",
                "blocker",
                "Contested conclusion",
                "A contradicts edge reaches the review threshold for this target.",
                "Resolve the contradiction, scope the claim more narrowly, or require human override before reuse.",
                evidence_refs=[target_id, *spof],
                metadata={"contradiction_strength": item.get("contradiction_strength"), "reasons": reasons},
            )
        if item.get("pseudo_robust"):
            refs = [target_id, *item.get("shared_source", []), *item.get("shared_reasoning", [])]
            add(
                target_id,
                "non_independent_support",
                "major",
                "Pseudo-robust support",
                "The claim appears to have multiple support paths, but the paths funnel through one source or assumption.",
                "Add an independent source or explicitly label the claim as single-origin evidence.",
                evidence_refs=refs,
                metadata={"reasons": reasons},
            )
        elif item.get("n_sources") == 1 and graph.nodes.get(target_id, None) is not None \
                and graph.nodes[target_id].type == NodeType.CLAIM:
            add(
                target_id,
                "single_source_dependency",
                "major",
                "Single-source conclusion",
                "This claim rests on exactly one source; a retraction or source-quality problem would collapse it.",
                "Seek independent evidence before using this as a stable project conclusion.",
                evidence_refs=[target_id, *spof],
                metadata={"reasons": reasons},
            )

    for item in analysis.get("weakly_supported", []):
        strength = float(item.get("support_strength", 0.0))
        severity = "major" if strength < max(0.4, threshold * 0.6) else "minor"
        add(
            item["id"],
            "weak_support",
            severity,
            "Weak evidential support",
            f"Aggregate support strength is {strength:.2f}, below the audit threshold {threshold:.2f}.",
            "Add stronger support, re-run verification, or downgrade the claim.",
            evidence_refs=[item["id"]],
            metadata={"support_strength": strength, "threshold": threshold, "n_sources": item.get("n_sources")},
        )

    for item in analysis.get("load_bearing", []):
        critical_count = int(item.get("critical_count", 0) or 0)
        add(
            item["id"],
            "load_bearing_dependency",
            "major" if critical_count >= 3 else "minor",
            "Load-bearing evidence or reasoning",
            f"Removing this node would disconnect {critical_count} downstream conclusion(s).",
            "Inspect the blast radius before relying on downstream conclusions; add alternate evidence paths if possible.",
            evidence_refs=[item["id"], *item.get("critical_for", [])],
            metadata={"critical_count": critical_count, "critical_for": item.get("critical_for", [])},
        )

    for node in graph.nodes.values():
        if node.type == NodeType.CLAIM and node.status == NodeStatus.CONFLICTED:
            add(
                node.id,
                "conflicted_status",
                "blocker",
                "Claim marked conflicted",
                "Verification found both support and credible contradiction for this claim.",
                "Resolve or qualify the conflict before using the claim in a decision or external artifact.",
                evidence_refs=[node.id],
            )
        elif node.type == NodeType.CLAIM and node.status == NodeStatus.UNDETERMINED:
            add(
                node.id,
                "undetermined_claim",
                "minor",
                "Claim remains undetermined",
                "The claim has not crossed the support threshold in the current DAG.",
                "Treat as provisional unless further evidence or verification supports it.",
                evidence_refs=[node.id],
            )
        if node.type == NodeType.SOURCE_ASSERTION and node.credibility == "low":
            add(
                node.id,
                "low_credibility_source",
                "major",
                "Low-credibility source",
                "A source node is marked low credibility.",
                "Avoid using this source as sole support; seek independent higher-quality evidence.",
                evidence_refs=[node.id],
                metadata={"source_type": node.source_type},
            )

    findings.sort(key=lambda f: (-_SEVERITY_ORDER.get(f["severity"], 0), f["target_id"], f["finding_type"]))
    completed = _now_iso()
    risk_digest = _risk_digest(findings)
    return {
        "schema_version": 1,
        "id": run_id,
        "thread_id": graph.thread_id,
        "target_digest": dag_digest,
        "level": level,
        "trigger": trigger,
        "threshold": threshold,
        "status": "completed",
        "started_at": started,
        "completed_at": completed,
        "reviewer": {
            "kind": "evidence_dag_adversarial_reviewer",
            "mode": "deterministic",
            "version": 1,
        },
        "dag_summary": graph.summary(),
        "analysis_summary": analysis.get("summary", {}),
        "risk_digest": risk_digest,
        "findings": findings,
    }
