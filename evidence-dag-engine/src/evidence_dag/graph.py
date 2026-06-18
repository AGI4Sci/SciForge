"""Thread-scoped evidence graph: storage, shared-node dedup, cycle detection,
provenance traversal, and topo layering.

Scope decision (2026-06-16): **one thread == one graph**. Cross-thread
accumulation is out of scope for phase 1.
"""
from __future__ import annotations

from typing import Optional

import networkx as nx

from .model import Edge, EdgeRel, Node, NodeType, make_edge_id, make_node_id

# Edges whose direction is "evidence -> conclusion" and that we walk backwards
# when reconstructing a provenance path. `contradicts` is exposed but NOT
# treated as provenance (it is not support); `prerequisite`/`refines` are
# structural and also excluded from the support-only backward walk.
EVIDENTIAL_RELS = {EdgeRel.SUPPORTS}
# Support + structural relations that define the topo layout / cycle scope.
_LAYOUT_RELS = EVIDENTIAL_RELS | {EdgeRel.REFINES, EdgeRel.PREREQUISITE}


class ThreadGraph:
    def __init__(self, thread_id: str, meta: Optional[dict] = None) -> None:
        self.thread_id = thread_id
        self.meta: dict = dict(meta or {})
        self.nodes: dict[str, Node] = {}
        self.edges: dict[str, Edge] = {}

    # --- mutation -----------------------------------------------------------
    def add_or_get_node(
        self,
        ntype: NodeType,
        content: str,
        *,
        trace_ref: Optional[str] = None,
        created_at: Optional[str] = None,
        created_by: Optional[str] = None,
        **extra,
    ) -> Node:
        """Idempotent insert. Same (type, normalised content) -> same shared node.

        On a repeat hit we keep the first node but merge a missing `trace_ref`
        (a shared source may first appear without one) so later citations don't
        lose provenance.
        """
        nid = make_node_id(ntype, content)
        existing = self.nodes.get(nid)
        if existing is not None:
            if existing.trace_ref is None and trace_ref is not None:
                existing.trace_ref = trace_ref
            return existing
        node = Node(
            id=nid,
            type=ntype,
            content=content,
            trace_ref=trace_ref,
            created_at=created_at,
            created_by=created_by,
            **extra,
        )
        self.nodes[nid] = node
        return node

    def add_edge(
        self,
        src: str,
        dst: str,
        rel: EdgeRel,
        *,
        nli_score: Optional[float] = None,
        created_at: Optional[str] = None,
    ) -> Optional[Edge]:
        if src not in self.nodes or dst not in self.nodes:
            return None  # dangling edge -> drop (extractor may hallucinate ids)
        if src == dst:
            return None  # no self-loops
        eid = make_edge_id(src, dst, rel)
        if eid in self.edges:
            e = self.edges[eid]
            if nli_score is not None:
                e.nli_score = nli_score
            return e
        edge = Edge(id=eid, src=src, dst=dst, rel=rel, nli_score=nli_score, created_at=created_at)
        self.edges[eid] = edge
        return edge

    def merge_from(self, other: "ThreadGraph") -> dict:
        """Accumulate another graph's nodes/edges into this one, in place.

        This is what makes a thread's DAG GROW across a conversation instead of
        being rebuilt per turn: a later turn is extracted on its own and merged
        here. Content-addressed ids make it idempotent — a node/edge already
        present is KEPT AS-IS (so its verified `status` / edge `nli_score`
        survive; we never reset a previously-supported claim), and only genuinely
        new ids are inserted. A repeat node may backfill a missing `trace_ref`.

        Returns {"new_nodes": [...], "new_edges": [...]} — the ids introduced by
        this merge, so the caller can verify ONLY the new edges (incremental).
        """
        new_nodes: list[str] = []
        for nid, node in other.nodes.items():
            existing = self.nodes.get(nid)
            if existing is not None:
                if existing.trace_ref is None and node.trace_ref is not None:
                    existing.trace_ref = node.trace_ref
                continue
            self.nodes[nid] = node
            new_nodes.append(nid)
        new_edges: list[str] = []
        for eid, edge in other.edges.items():
            if edge.src not in self.nodes or edge.dst not in self.nodes:
                continue  # endpoint absent after merge -> drop (mirrors add_edge)
            if eid in self.edges:
                continue
            self.edges[eid] = edge
            new_edges.append(eid)
        return {"new_nodes": new_nodes, "new_edges": new_edges}

    # --- graph views --------------------------------------------------------
    def _digraph(self, rels: Optional[set[EdgeRel]] = None) -> nx.DiGraph:
        g = nx.DiGraph()
        g.add_nodes_from(self.nodes.keys())
        for e in self.edges.values():
            if rels is None or e.rel in rels:
                g.add_edge(e.src, e.dst, key=e.id, rel=e.rel.value, nli=e.nli_score)
        return g

    def supports_digraph(self) -> nx.DiGraph:
        """Plain evidence -> conclusion DiGraph over `supports` edges only.

        Shared by the analysis (dominator) and reconcile (downstream) views, which
        only need the support topology — no edge attributes, no other relations.
        """
        return self._digraph(rels=EVIDENTIAL_RELS)

    def detect_cycles(self) -> dict:
        """Cycle report over the support/structural graph (Gate 1A item).

        We DO NOT silently break cycles: we report them so the extractor /
        scientist can decide, and so the topo layout knows what to exclude.
        """
        g = self._digraph(rels=_LAYOUT_RELS)
        cycles = [list(c) for c in nx.simple_cycles(g)]
        in_cycle: set[str] = set()
        for c in cycles:
            in_cycle.update(c)
        return {
            "acyclic": len(cycles) == 0,
            "cycle_count": len(cycles),
            "cycles": cycles,
            "nodes_in_cycles": sorted(in_cycle),
        }

    def layers(self) -> list[list[str]]:
        """Topological generations of the acyclic support+structural graph.

        Nodes inside cycles are excluded from layered layout (returned in a
        trailing 'unsorted' bucket by the server) — matches the plan's
        "成环子图排除出 topo 布局".
        """
        g = self._digraph(rels=_LAYOUT_RELS)
        if not nx.is_directed_acyclic_graph(g):
            # strip nodes participating in any cycle, then layer the remainder
            g = g.copy()
            for c in nx.simple_cycles(g):
                g.remove_nodes_from([n for n in c if n in g])
        return [sorted(layer) for layer in nx.topological_generations(g)]

    def provenance_path(self, node_id: str) -> dict:
        """Backward closure over `supports` edges from a claim down to its
        source leaves. Returns the induced sub-DAG (nodes + supports edges,
        each carrying ν) — this is the refs-first trace-back.
        """
        if node_id not in self.nodes:
            raise KeyError(node_id)
        # incoming supports edges, indexed by destination
        incoming: dict[str, list[Edge]] = {}
        for e in self.edges.values():
            if e.rel in EVIDENTIAL_RELS:
                incoming.setdefault(e.dst, []).append(e)

        seen_nodes: set[str] = set()
        seen_edges: list[Edge] = []
        stack = [node_id]
        while stack:
            cur = stack.pop()
            if cur in seen_nodes:
                continue
            seen_nodes.add(cur)
            for e in incoming.get(cur, []):
                seen_edges.append(e)
                stack.append(e.src)

        leaves = sorted(
            n for n in seen_nodes
            if self.nodes[n].type == NodeType.SOURCE or not incoming.get(n)
        )
        return {
            "root": node_id,
            "nodes": [self.nodes[n].to_dict() for n in sorted(seen_nodes)],
            "edges": [e.to_dict() for e in seen_edges],
            "source_leaves": leaves,
            "reaches_source": any(self.nodes[n].type == NodeType.SOURCE for n in seen_nodes),
        }

    def incoming_supports(self, node_id: str) -> list[Edge]:
        return [e for e in self.edges.values() if e.dst == node_id and e.rel in EVIDENTIAL_RELS]

    def edges_of(self, rel: EdgeRel) -> list[Edge]:
        return [e for e in self.edges.values() if e.rel == rel]

    def nodes_of(self, ntype: NodeType) -> list[Node]:
        return [n for n in self.nodes.values() if n.type == ntype]

    # --- (de)serialisation of the internal form -----------------------------
    def to_dict(self) -> dict:
        return {
            "thread_id": self.thread_id,
            "meta": self.meta,
            "nodes": [n.to_dict() for n in self.nodes.values()],
            "edges": [e.to_dict() for e in self.edges.values()],
        }

    @classmethod
    def from_dict(cls, d: dict) -> "ThreadGraph":
        g = cls(d["thread_id"], d.get("meta"))
        for nd in d.get("nodes", []):
            n = Node.from_dict(nd)
            g.nodes[n.id] = n
        for ed in d.get("edges", []):
            e = Edge.from_dict(ed)
            g.edges[e.id] = e
        return g

    def summary(self) -> dict:
        by_type = {t.value: len(self.nodes_of(t)) for t in NodeType}
        by_rel = {r.value: len(self.edges_of(r)) for r in EdgeRel}
        by_status: dict[str, int] = {}
        for n in self.nodes.values():
            by_status[n.status.value] = by_status.get(n.status.value, 0) + 1
        return {
            "thread_id": self.thread_id,
            "node_count": len(self.nodes),
            "edge_count": len(self.edges),
            "nodes_by_type": by_type,
            "edges_by_rel": by_rel,
            "nodes_by_status": by_status,
            "cycles": self.detect_cycles(),
        }
