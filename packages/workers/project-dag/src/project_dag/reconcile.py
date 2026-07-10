"""Belief maintenance over the project graph.

Two layers, deliberately separated:
  * relabel rules (this file, pure SQL + python) — the compile-time status
    machine: invalidated / conflicted / fragile / supported. Deterministic and
    cheap; runs incrementally on the affected subgraph after every compile.
  * dominator analysis (REUSED from evidence_dag.analysis) — load-bearing,
    pseudo-robust, hidden shared-source. We PROJECT the project graph into a
    ThreadGraph and call the exact same code the session sidebar uses, so the
    two layers can never disagree on what "fragile structure" means.
"""
from __future__ import annotations

from typing import Optional

import project_dag  # noqa: F401  (sys.path side effect)
from evidence_dag import analysis as edag_analysis
from evidence_dag.graph import ThreadGraph
from evidence_dag.model import EdgeRel, Node, NodeType

from .store import Store, now_iso


# ------------------------------------------------------------------ relabel
def _downstream(store: Store, roots: set[str]) -> set[str]:
    """Claims affected by `roots`: follow derived_from (child->parent stored as
    src=child dst=parent, so downstream = rows where dst is affected) plus
    claims sharing an open contradicts edge."""
    seen: set[str] = set()
    frontier = list(roots)
    while frontier:
        cid = frontier.pop()
        if cid in seen:
            continue
        seen.add(cid)
        for e in store.alive_edges(dst=cid, edge_type="derived_from"):
            frontier.append(e["src"])
        for e in store.alive_edges(src=cid, edge_type="contradicts"):
            frontier.append(e["dst"])
        for e in store.alive_edges(dst=cid, edge_type="contradicts"):
            frontier.append(e["src"])
    return seen


def _relabel_one(store: Store, cid: str) -> Optional[str]:
    claim = store.q1("SELECT * FROM claim WHERE id=?", (cid,))
    if claim is None or claim["t_invalid"] is not None:
        return None
    sup = store.q(
        """SELECT ev.* FROM edge e JOIN evidence ev ON ev.id=e.src
           WHERE e.dst=? AND e.edge_type='supports'
           AND e.t_invalid IS NULL AND ev.t_invalid IS NULL""", (cid,))
    contested = any(
        (e["meta"] or "").find('"unresolved"') >= 0
        for e in store.alive_edges(src=cid, edge_type="contradicts")
        + store.alive_edges(dst=cid, edge_type="contradicts"))

    if not sup:
        status = "invalidated"
    elif contested:
        status = "conflicted"
    else:
        hashes = {ev["source_hash"] or ev["id"] for ev in sup}
        weak_human = all(
            ev["evidence_type"] == "human_attested"
            and float(ev["trust_score"] or 0) < 0.5 for ev in sup)
        status = "fragile" if (len(hashes) <= 1 or weak_human) else "supported"

    if status == "invalidated":
        store.x("UPDATE claim SET status='invalidated', t_invalid=? WHERE id=?",
                (now_iso(), cid))
    elif status != claim["status"]:
        store.x("UPDATE claim SET status=? WHERE id=?", (status, cid))
    return status if status != claim["status"] else None


def _update_load(store: Store, cid: str) -> None:
    """load_bearing/blast_radius = alive claims transitively derived from cid."""
    seen: set[str] = set()
    frontier = [e["src"] for e in store.alive_edges(dst=cid, edge_type="derived_from")]
    while frontier:
        x = frontier.pop()
        if x in seen:
            continue
        seen.add(x)
        frontier += [e["src"] for e in store.alive_edges(dst=x, edge_type="derived_from")]
    alive = 0
    for x in seen:
        row = store.q1("SELECT 1 FROM claim WHERE id=? AND t_invalid IS NULL", (x,))
        alive += 1 if row else 0
    store.x("UPDATE claim SET load_bearing=?, blast_radius=? WHERE id=?",
            (float(alive), len(seen), cid))


def incremental_reconcile(store: Store, touched: set[str], *, commit: bool = True) -> list[dict]:
    """Relabel only the affected subgraph; returns [{id, status}] changes."""
    if not touched:
        return []
    changed = []
    for cid in sorted(_downstream(store, touched)):
        new_status = _relabel_one(store, cid)
        _update_load(store, cid)
        if new_status:
            changed.append({"id": cid, "status": new_status})
    if commit:
        store.conn.commit()
    return changed


def full_reconcile(store: Store, *, commit: bool = True) -> list[dict]:
    """Weekly safety net: relabel EVERY alive claim from scratch. Cheap at
    single-machine scale; the caller diffs against incremental results."""
    ids = {r["id"] for r in store.q("SELECT id FROM claim WHERE t_invalid IS NULL")}
    return incremental_reconcile(store, ids, commit=commit)


# ---------------------------------------------------- projection -> analysis
def project_analysis(store: Store, *, goal_id: Optional[str] = None,
                     claim_ids: Optional[set[str]] = None,
                     support_edge_ids: Optional[set[str]] = None,
                     threshold: float = 0.7) -> dict:
    """Project the alive project graph into an evidence-dag ThreadGraph and run
    the SAME dominator analysis the session sidebar uses (load-bearing /
    fragility / pseudo-robust / hidden shared-source) — zero re-implementation."""
    g = ThreadGraph("project")
    claims = store.q(
        "SELECT * FROM claim WHERE t_invalid IS NULL" +
        (" AND goal_id=?" if goal_id else ""),
        (goal_id,) if goal_id else ())
    if claim_ids is not None:
        claims = [c for c in claims if c["id"] in claim_ids]
    claim_ids = {c["id"] for c in claims}
    for c in claims:
        # keep project-layer ids (ThreadGraph's own ids are content-addressed;
        # we bypass that so analysis output maps 1:1 back to claim/evidence rows)
        g.nodes[c["id"]] = Node(id=c["id"], type=NodeType.CLAIM,
                                content=c["statement"])
    for c in claims:
        for e in store.alive_edges(dst=c["id"], edge_type="supports"):
            if support_edge_ids is not None and e["id"] not in support_edge_ids:
                continue
            ev = store.q1("SELECT * FROM evidence WHERE id=? AND t_invalid IS NULL",
                          (e["src"],))
            if ev is None:
                continue
            w = ev["trust_score"] if ev["evidence_type"] == "human_attested" \
                else ev["quality_score"]
            if ev["id"] not in g.nodes:
                g.nodes[ev["id"]] = Node(id=ev["id"], type=NodeType.SOURCE_ASSERTION,
                                         content=ev["content"] or ev["id"],
                                         source_quality=w)
            g.add_edge(ev["id"], c["id"], EdgeRel.SUPPORTS,
                       nli_score=float(w if w is not None else 0.5))
    for c in claims:
        for e in store.alive_edges(src=c["id"], edge_type="derived_from"):
            if e["dst"] in claim_ids:
                g.add_edge(e["dst"], c["id"], EdgeRel.SUPPORTS, nli_score=0.9)
        for e in store.alive_edges(src=c["id"], edge_type="contradicts"):
            if e["dst"] in claim_ids:
                g.add_edge(c["id"], e["dst"], EdgeRel.CONTRADICTS)
    return edag_analysis.analyze(g, threshold=threshold)
