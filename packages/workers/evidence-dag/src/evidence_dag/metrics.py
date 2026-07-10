"""Four AAR audit metrics as callable evaluation functions (1B).

Operational definitions (phase 1):
- Provenance Coverage:     fraction of claim/reasoning nodes that have at least
                           one supports-path reaching a source leaf.
- Provenance Soundness:    mean ν of the supports edges that lie on accepted
                           (source-rooted) provenance paths — i.e. how strong the
                           load-bearing entailments are. (The *benchmark* variant
                           that compares against the cosine baseline lives in
                           benchmark/soundness_benchmark.py and is scored vs gold.)
- Contradiction Transparency: fraction of `contradicts` edges that are surfaced.
                           By construction phase 1 exposes every extracted
                           contradicts edge, so this is 1.0 when any exist (we also
                           report the raw count); it becomes meaningful once phase
                           2 can hide/resolve conflicts.
- Audit Effort:            mean provenance-path length (edges) from a
                           claim/reasoning node to its source leaves — lower is
                           cheaper to audit.
"""
from __future__ import annotations

from datetime import datetime
from statistics import mean
from typing import Any, Optional

from .graph import ThreadGraph
from .lineage import reproducibility_report
from .model import EdgeRel, NodeType

_DERIVED = (NodeType.CLAIM, NodeType.REASONING)
_RESEARCH_CONCLUSIONS = (NodeType.CLAIM, NodeType.FINDING)


def provenance_coverage(graph: ThreadGraph) -> float:
    derived = [n for n in graph.nodes.values() if n.type in _DERIVED]
    if not derived:
        return 1.0
    covered = sum(1 for n in derived if graph.provenance_path(n.id)["sourceAssertionLeaves"])
    return covered / len(derived)


def provenance_soundness(graph: ThreadGraph) -> float:
    """Mean ν over supports edges that sit on a source-rooted path."""
    load_bearing: list[float] = []
    for n in graph.nodes.values():
        if n.type not in _DERIVED:
            continue
        path = graph.provenance_path(n.id)
        if not path["sourceAssertionLeaves"]:
            continue
        for e in path["edges"]:
            if e["rel"] == EdgeRel.SUPPORTS.value and e["nli_score"] is not None:
                load_bearing.append(e["nli_score"])
    return mean(load_bearing) if load_bearing else 0.0


def contradiction_transparency(graph: ThreadGraph) -> dict:
    contradicts = graph.edges_of(EdgeRel.CONTRADICTS)
    # phase 1: every extracted contradicts edge is exposed in the graph/UI.
    surfaced = len(contradicts)
    total = len(contradicts)
    return {
        "ratio": (surfaced / total) if total else 1.0,
        "surfaced": surfaced,
        "total": total,
    }


def audit_effort(graph: ThreadGraph) -> float:
    lengths: list[int] = []
    for n in graph.nodes.values():
        if n.type not in _DERIVED:
            continue
        path = graph.provenance_path(n.id)
        if path["sourceAssertionLeaves"]:
            lengths.append(len(path["edges"]))
    return mean(lengths) if lengths else 0.0


def _parse_time(value: Any) -> Optional[datetime]:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo is not None else None


def _duration_ms(start: Any, end: Any) -> Optional[float]:
    first, second = _parse_time(start), _parse_time(end)
    if first is None or second is None or second < first:
        return None
    return round((second - first).total_seconds() * 1000, 3)


def _latencies(events: list[dict[str, Any]]) -> tuple[list[float], list[float]]:
    by_id = {str(event.get("eventId")): event for event in events}
    queue_samples: list[float] = []
    commit_samples: list[float] = []
    committed = sorted(
        (event for event in events if event.get("type") == "EvidenceSnapshotCommitted"),
        key=lambda event: int(event.get("sequence", 0)),
    )
    for event in committed:
        payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
        queued = by_id.get(str(payload.get("queuedEventId") or ""))
        if queued is not None:
            sample = _duration_ms(queued.get("occurredAt"), payload.get("startedAt"))
            if sample is not None:
                queue_samples.append(sample)
        sample = _duration_ms(payload.get("startedAt"), payload.get("completedAt"))
        if sample is not None:
            commit_samples.append(sample)
    return queue_samples, commit_samples


def _staleness(
    snapshot: Optional[dict[str, Any]],
    audits: list[dict[str, Any]],
    snapshot_history: list[dict[str, Any]],
) -> tuple[Optional[int], dict[str, Any]]:
    if not snapshot:
        return None, {"status": "unavailable", "reason": "snapshot_not_committed"}
    completed = [run for run in audits if run.get("status") == "completed"]
    if not completed:
        return None, {"status": "unavailable", "reason": "audit_not_run"}
    latest = max(
        completed,
        key=lambda run: (str(run.get("completed_at") or ""), str(run.get("id") or "")),
    )
    current_digest = snapshot.get("digest")
    target_digest = latest.get("target_digest")
    if target_digest == current_digest:
        lag: Optional[int] = 0
    else:
        versions = {
            item.get("digest"): int(item["version"])
            for item in snapshot_history
            if item.get("digest") and isinstance(item.get("version"), int)
        }
        current_version = snapshot.get("version")
        target_version = versions.get(target_digest)
        lag = (
            max(0, int(current_version) - target_version)
            if isinstance(current_version, int) and target_version is not None else None
        )
    detail = {
        "status": "available" if lag is not None else "unavailable",
        "reason": None if lag is not None else "audit_target_snapshot_not_found",
        "auditRunId": latest.get("id"),
        "targetDigest": target_digest,
        "currentDigest": current_digest,
    }
    return lag, detail


def _provenance_rates(graph: ThreadGraph) -> tuple[Optional[float], Optional[float], Optional[float], dict]:
    conclusions = [node for node in graph.nodes.values() if node.type in _RESEARCH_CONCLUSIONS]
    if not conclusions:
        return None, None, None, {
            "status": "unavailable", "reason": "no_claim_or_finding", "denominator": 0,
        }
    paths = [graph.provenance_path(node.id) for node in conclusions]
    broken = sum(
        1 for path in paths
        if path.get("provenanceLevel") == "L0" or bool(path.get("breakpoints"))
    )
    reachable = sum(1 for path in paths if path.get("reachesArtifact"))
    level_2_plus = sum(
        1 for path in paths
        if str(path.get("provenanceLevel") or "L0") in {"L2", "L3", "L4"}
    )
    total = len(conclusions)
    return (
        round(broken / total, 4),
        round(reachable / total, 4),
        round(level_2_plus / total, 4),
        {"status": "available", "numerator": broken, "denominator": total},
    )


def _reproducible_finding_rate(graph: ThreadGraph) -> tuple[Optional[float], dict[str, Any]]:
    eligible: list[dict[str, Any]] = []
    for node in graph.nodes.values():
        if node.type != NodeType.FINDING:
            continue
        report = reproducibility_report(graph, node.id)
        # A literature Finding with no ExperimentRun/AnalysisRun is outside the
        # metric denominator.  We do not infer that it is computational from prose.
        if report.get("runIds"):
            eligible.append(report)
    if not eligible:
        return None, {
            "status": "unavailable", "reason": "no_finding_with_explicit_run",
            "numerator": 0, "denominator": 0,
        }
    reproduced = sum(1 for report in eligible if report.get("complete") is True)
    return round(reproduced / len(eligible), 4), {
        "status": "available", "numerator": reproduced, "denominator": len(eligible),
    }


def all_metrics(
    graph: ThreadGraph,
    *,
    events: Optional[list[dict[str, Any]]] = None,
    audits: Optional[list[dict[str, Any]]] = None,
    snapshot: Optional[dict[str, Any]] = None,
    snapshot_history: Optional[list[dict[str, Any]]] = None,
) -> dict:
    event_list = list(events or [])
    queue_samples, commit_samples = _latencies(event_list)
    audit_lag, audit_detail = _staleness(
        snapshot, list(audits or []), list(snapshot_history or []),
    )
    break_rate, reachability, level_2_plus, break_detail = _provenance_rates(graph)
    reproducible_rate, reproducible_detail = _reproducible_finding_rate(graph)
    return {
        "provenance_coverage": round(provenance_coverage(graph), 4),
        "provenance_soundness": round(provenance_soundness(graph), 4),
        "contradiction_transparency": contradiction_transparency(graph),
        "audit_effort": round(audit_effort(graph), 4),
        "artifact_reachability": reachability,
        "level_2_plus_coverage": level_2_plus,
        "queue_latency_ms": queue_samples[-1] if queue_samples else None,
        "commit_latency_ms": commit_samples[-1] if commit_samples else None,
        "audit_staleness": audit_lag,
        "provenance_break_rate": break_rate,
        "reproducible_finding_rate": reproducible_rate,
        "metric_evidence": {
            "queue_latency_ms": {
                "status": "available" if queue_samples else "unavailable",
                "reason": None if queue_samples else "no_linked_queue_and_commit_event",
                "sampleCount": len(queue_samples),
                "mean": round(mean(queue_samples), 3) if queue_samples else None,
            },
            "commit_latency_ms": {
                "status": "available" if commit_samples else "unavailable",
                "reason": None if commit_samples else "no_commit_timing_event",
                "sampleCount": len(commit_samples),
                "mean": round(mean(commit_samples), 3) if commit_samples else None,
            },
            "audit_staleness": audit_detail,
            "provenance_break_rate": break_detail,
            "reproducible_finding_rate": reproducible_detail,
        },
    }
