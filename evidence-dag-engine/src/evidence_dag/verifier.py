"""Verification layer L2 (1B).

Each `supports` edge gets ν∈[0,1] = how strongly the premise (src, evidence)
SUPPORTS the hypothesis (dst, claim/reasoning) — evidential support, NOT strict
logical entailment, so concrete findings / data / partial evidence count to the
degree they back the claim. Each `contradicts` edge likewise gets ν∈[0,1] = how
strongly the premise CONTRADICTS the hypothesis. Hypotheses are split into
sentences and scored as the max over sentences (paragraph-level judging degrades).

Per-node status uses noisy-OR aggregation against a threshold (default 0.7):
  source                                  -> supported  (evidence by definition)
  derived, support≥thr, contradiction≥thr -> conflicting (stands AND is contested)
  derived, support≥thr                     -> supported
  otherwise                                -> unverified
"""
from __future__ import annotations

import json
import re

from .graph import ThreadGraph
from .llm import LLM
from .model import EdgeRel, NodeStatus, NodeType

# Both judges keep the "EDAG-TASK: nli" marker so the offline StubLLM routes them
# to its nli handler; the real model reads the framing below.
SUPPORT_SYSTEM = """EDAG-TASK: nli (support)
You judge EVIDENTIAL SUPPORT. Given a PREMISE (evidence) and a HYPOTHESIS (a
claim or reasoning step), output how strongly the premise SUPPORTS the
hypothesis — how much it raises belief in it. This is INDUCTIVE support, NOT
strict logical entailment: concrete findings, data, study results, statistics,
and partial evidence all count to the degree they back the hypothesis. Use ONLY
the premise text; do not bring in outside knowledge. Output STRICT JSON only:
{"support": <float 0..1>, "label": "supports|neutral|undermines"}"""

CONTRA_SYSTEM = """EDAG-TASK: nli (contradiction)
You judge CONTRADICTION. Given a PREMISE and a HYPOTHESIS, output how strongly
the premise CONTRADICTS or conflicts with the hypothesis — how much it lowers
belief in it. Use ONLY the premise text; do not bring in outside knowledge.
Output STRICT JSON only:
{"contradiction": <float 0..1>, "label": "contradicts|neutral|supports"}"""

# CJK terminators (。！？) split with no trailing space; Latin terminators
# (.!?) split only when followed by whitespace (so "e.g."/"U.S." stay intact).
_SENT_SPLIT = re.compile(r"(?<=[。！？])\s*|(?<=[.!?])\s+")


def split_sentences(text: str) -> list[str]:
    parts = [s.strip() for s in _SENT_SPLIT.split(text or "") if s.strip()]
    return parts or ([text.strip()] if text and text.strip() else [])


# Keys we accept from the judge JSON, in priority order. `entailment` stays last
# so the offline StubLLM (which returns {"entailment": ...}) keeps working.
_SCORE_KEYS = ("support", "contradiction", "score", "entailment")


def _judge(llm: LLM, system: str, premise: str, hypothesis: str) -> float:
    raw = llm.chat(
        [
            {"role": "system", "content": system},
            {"role": "user", "content": f"PREMISE: {premise}\nHYPOTHESIS: {hypothesis}"},
        ],
        temperature=0.0,
        max_tokens=200,
    )
    try:
        obj = json.loads(raw.strip().strip("`"))
        for k in _SCORE_KEYS:
            if isinstance(obj, dict) and k in obj:
                return _clamp(float(obj[k]))
    except (json.JSONDecodeError, TypeError, ValueError):
        pass
    m = re.search(r"([01](?:\.\d+)?)", raw)
    return _clamp(float(m.group(1))) if m else 0.0


def nli_score(llm: LLM, premise: str, hypothesis: str) -> float:
    """Single-pair support score in [0,1] (back-compat; prefer edge_nli for edges)."""
    return _judge(llm, SUPPORT_SYSTEM, premise, hypothesis)


def edge_nli(llm: LLM, premise: str, hypothesis: str) -> float:
    """Support ν for one `supports` edge: max over the hypothesis's sentences."""
    sents = split_sentences(hypothesis)
    return max((_judge(llm, SUPPORT_SYSTEM, premise, s) for s in sents), default=0.0)


def edge_contra(llm: LLM, premise: str, hypothesis: str) -> float:
    """Contradiction ν for one `contradicts` edge: max over the hypothesis's sentences."""
    sents = split_sentences(hypothesis)
    return max((_judge(llm, CONTRA_SYSTEM, premise, s) for s in sents), default=0.0)


def noisy_or(scores: list[float]) -> float:
    """1 - Π(1 - νᵢ): many weak supports accumulate, one strong support suffices."""
    p = 1.0
    for s in scores:
        p *= (1.0 - _clamp(s))
    return 1.0 - p


def _clamp(x: float) -> float:
    return max(0.0, min(1.0, x))


def verify(graph: ThreadGraph, llm: LLM, *, threshold: float = 0.7,
           only_unscored: bool = False) -> dict:
    """Fill ν on supports edges, then (re)assign claim/reasoning status.

    `only_unscored=True` runs NLI ONLY on edges that have no ν yet — i.e. the
    edges a merge just added. Existing edges keep their scores (no redundant LLM
    calls as a conversation grows). Status is still recomputed for EVERY node
    (cheap, noisy-OR, no LLM), so a new support edge into an old claim updates
    that claim too.

    Returns a diff of status changes — the seed of phase 2's Reconcile diff.
    """
    before = {nid: n.status for nid, n in graph.nodes.items()}

    def _score_edges(rel: EdgeRel, scorer) -> int:
        n = 0
        for e in graph.edges_of(rel):
            if only_unscored and e.nli_score is not None:
                continue
            src, dst = graph.nodes.get(e.src), graph.nodes.get(e.dst)
            if src and dst:
                e.nli_score = scorer(llm, src.content, dst.content)
                n += 1
        return n

    # supports edges carry ν = support degree; contradicts edges carry ν =
    # contradiction degree — scored the same way, just a different judge.
    scored = _score_edges(EdgeRel.SUPPORTS, edge_nli)
    contra_scored = _score_edges(EdgeRel.CONTRADICTS, edge_contra)

    # aggregate contradiction strength per node — contradiction is mutual, so both
    # endpoints of a contradicts edge are contested by it.
    contra_nu: dict[str, list[float]] = {}
    for e in graph.edges_of(EdgeRel.CONTRADICTS):
        if e.nli_score is None:
            continue
        contra_nu.setdefault(e.dst, []).append(e.nli_score)
        contra_nu.setdefault(e.src, []).append(e.nli_score)

    aggregates: dict[str, float] = {}
    for node in graph.nodes.values():
        if node.type == NodeType.SOURCE:
            node.status = NodeStatus.SUPPORTED  # a source IS evidence — always verified
            continue
        incoming = graph.incoming_supports(node.id)
        agg = noisy_or([e.nli_score for e in incoming if e.nli_score is not None])
        aggregates[node.id] = agg
        contra_agg = noisy_or(contra_nu.get(node.id, []))
        if incoming and agg >= threshold:
            # stands on its evidence — but flag it contested if credibly contradicted
            node.status = NodeStatus.CONFLICTING if contra_agg >= threshold else NodeStatus.SUPPORTED
        else:
            node.status = NodeStatus.UNVERIFIED

    changes = [
        {"node": nid, "from": before[nid].value, "to": graph.nodes[nid].status.value,
         "aggregate_nu": round(aggregates.get(nid, 0.0), 4)}
        for nid in graph.nodes
        if before[nid] != graph.nodes[nid].status
    ]
    return {
        "threshold": threshold,
        "supports_edges_scored": scored,
        "supports_edges_total": len(graph.edges_of(EdgeRel.SUPPORTS)),
        "contradicts_edges_scored": contra_scored,
        "status_changes": changes,
        "aggregates": {k: round(v, 4) for k, v in aggregates.items()},
    }
