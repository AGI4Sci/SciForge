"""Belief maintenance over the project graph.

This module owns the deterministic compile-time status machine: invalidated /
conflicted / fragile / supported. It runs incrementally on the affected,
project-scoped subgraph after every compile.
"""
from __future__ import annotations

from .reader import SessionReader
from .store import Store, now_iso


# ------------------------------------------------------------------ relabel
def _downstream(store: Store, project_key: str, roots: set[str]) -> set[str]:
    """Claims affected by `roots`: follow derived_from (child->parent stored as
    src=child dst=parent, so downstream = rows where dst is affected) plus
    claims sharing an open contradicts edge."""
    seen: set[str] = set()
    frontier = list(roots)
    while frontier:
        cid = frontier.pop()
        if cid in seen:
            continue
        claim = store.q1("SELECT 1 FROM claim WHERE id=? AND project_key=?", (cid, project_key))
        if claim is None:
            continue
        seen.add(cid)
        for e in store.alive_edges(dst=cid, edge_type="derived_from"):
            frontier.append(e["src"])
        for e in store.alive_edges(src=cid, edge_type="contradicts"):
            frontier.append(e["dst"])
        for e in store.alive_edges(dst=cid, edge_type="contradicts"):
            frontier.append(e["src"])
    return seen


def _relabel_one(store: Store, reader: SessionReader,
                 project_key: str, cid: str) -> str | None:
    claim = store.q1("SELECT * FROM claim WHERE id=? AND project_key=?", (cid, project_key))
    if claim is None or claim["t_invalid"] is not None:
        return None
    sup = store.q(
        """SELECT ev.* FROM edge e JOIN evidence ev ON ev.id=e.src
           WHERE e.dst=? AND e.edge_type='supports'
           AND e.t_invalid IS NULL
           AND ev.project_key=?""", (cid, project_key))
    contested = any(
        (e["meta"] or "").find('"unresolved"') >= 0
        for e in store.alive_edges(src=cid, edge_type="contradicts")
        + store.alive_edges(dst=cid, edge_type="contradicts"))

    if not sup:
        # A current session Claim/Finding without a source assertion is an
        # explicit provenance gap, not proof that the claim ceased to exist.
        # Keep it visible as undetermined so review/audit can request evidence.
        # Only close the claim after every session origin has disappeared (for
        # example, an Evidence rewrite removed the upstream node).
        has_origin = store.q1(
            "SELECT 1 AS present FROM claim_origin"
            " WHERE project_key=? AND claim_id=? LIMIT 1", (project_key, cid))
        status = "undetermined" if has_origin is not None else "invalidated"
    elif contested:
        status = "conflicted"
    else:
        sources = {
            reader.resolve_reference(
                ev["thread_id"], ev["snapshot_digest"], ev["node_id"])["sourceIdentity"]
            for ev in sup
        }
        status = "fragile" if len(sources) <= 1 else "supported"

    if status == "invalidated":
        store.x(
            "UPDATE claim SET status='invalidated', t_invalid=? WHERE id=? AND project_key=?",
            (now_iso(), cid, project_key),
        )
    elif status != claim["status"]:
        store.x("UPDATE claim SET status=? WHERE id=? AND project_key=?",
                (status, cid, project_key))
    return status if status != claim["status"] else None


def _update_load(store: Store, project_key: str, cid: str) -> None:
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
        row = store.q1(
            "SELECT 1 FROM claim WHERE id=? AND project_key=? AND t_invalid IS NULL",
            (x, project_key),
        )
        alive += 1 if row else 0
    store.x(
        "UPDATE claim SET load_bearing=?, blast_radius=? WHERE id=? AND project_key=?",
        (float(alive), len(seen), cid, project_key),
    )


def incremental_reconcile(store: Store, reader: SessionReader,
                          project_key: str, touched: set[str], *,
                          commit: bool = True) -> list[dict]:
    """Relabel only the affected subgraph; returns [{id, status}] changes."""
    if not touched:
        return []
    changed = []
    for cid in sorted(_downstream(store, project_key, touched)):
        new_status = _relabel_one(store, reader, project_key, cid)
        _update_load(store, project_key, cid)
        if new_status:
            changed.append({"id": cid, "status": new_status})
    if commit:
        store.conn.commit()
    return changed


def full_reconcile(store: Store, reader: SessionReader, project_key: str, *,
                   commit: bool = True) -> list[dict]:
    """Weekly safety net: relabel EVERY alive claim from scratch. Cheap at
    single-machine scale; the caller diffs against incremental results."""
    ids = {r["id"] for r in store.q(
        "SELECT id FROM claim WHERE project_key=? AND t_invalid IS NULL", (project_key,))}
    return incremental_reconcile(store, reader, project_key, ids, commit=commit)
