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

from statistics import mean

from .graph import ThreadGraph
from .model import EdgeRel, NodeType

_DERIVED = (NodeType.CLAIM, NodeType.REASONING)


def provenance_coverage(graph: ThreadGraph) -> float:
    derived = [n for n in graph.nodes.values() if n.type in _DERIVED]
    if not derived:
        return 1.0
    covered = sum(1 for n in derived if graph.provenance_path(n.id)["reaches_source"])
    return covered / len(derived)


def provenance_soundness(graph: ThreadGraph) -> float:
    """Mean ν over supports edges that sit on a source-rooted path."""
    load_bearing: list[float] = []
    for n in graph.nodes.values():
        if n.type not in _DERIVED:
            continue
        path = graph.provenance_path(n.id)
        if not path["reaches_source"]:
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
        if path["reaches_source"]:
            lengths.append(len(path["edges"]))
    return mean(lengths) if lengths else 0.0


def all_metrics(graph: ThreadGraph) -> dict:
    return {
        "provenance_coverage": round(provenance_coverage(graph), 4),
        "provenance_soundness": round(provenance_soundness(graph), 4),
        "contradiction_transparency": contradiction_transparency(graph),
        "audit_effort": round(audit_effort(graph), 4),
    }
