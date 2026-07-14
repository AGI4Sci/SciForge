"""Thread-scoped Evidence DAG and snapshot-contained provenance records."""
from __future__ import annotations

from typing import Optional

import networkx as nx

from .model import (
    ACYCLIC_LINEAGE_RELS,
    Artifact,
    ArtifactVersion,
    Assessment,
    Edge,
    EdgeRel,
    Node,
    NodeType,
    ReviewPacket,
    SourceAnchor,
    make_edge_id,
    make_node_id,
)

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
        self.artifacts: dict[str, Artifact] = {}
        self.artifact_versions: dict[str, ArtifactVersion] = {}
        self.source_anchors: dict[str, SourceAnchor] = {}
        self.assessments: list[Assessment] = []
        self.review_policy_version: Optional[str] = None
        self.review_packets: list[ReviewPacket] = []
        # (edge_count, by_src, by_dst) — edges are append-only, so the edge
        # count uniquely identifies the incidence structure.
        self._edge_index: Optional[tuple[int, dict[str, list[Edge]], dict[str, list[Edge]]]] = None

    # --- incidence indexes ----------------------------------------------------
    def _edge_indexes(self) -> tuple[dict[str, list[Edge]], dict[str, list[Edge]]]:
        """Cached src->edges / dst->edges maps. Treat the returned dicts as read-only."""
        cached = self._edge_index
        if cached is not None and cached[0] == len(self.edges):
            return cached[1], cached[2]
        by_src: dict[str, list[Edge]] = {}
        by_dst: dict[str, list[Edge]] = {}
        for edge in self.edges.values():
            by_src.setdefault(edge.src, []).append(edge)
            by_dst.setdefault(edge.dst, []).append(edge)
        self._edge_index = (len(self.edges), by_src, by_dst)
        return by_src, by_dst

    def edges_by_src(self) -> dict[str, list[Edge]]:
        return self._edge_indexes()[0]

    def edges_by_dst(self) -> dict[str, list[Edge]]:
        return self._edge_indexes()[1]

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
        identity_scope = extra.pop("identity_scope", None)
        if identity_scope is None and ntype == NodeType.SOURCE_ASSERTION:
            identity_scope = extra.get("artifact_id")
        if identity_scope is None:
            identity_scope = extra.get("external_id")
        nid = make_node_id(ntype, content, identity_scope)
        existing = self.nodes.get(nid)
        if existing is not None:
            occurrence = Node(
                id=nid, type=ntype, content=content,
                trace_refs=[trace_ref] if trace_ref else [], created_at=created_at,
                created_by=created_by, **extra,
            )
            existing.merge_occurrence(occurrence)
            return existing
        node = Node(
            id=nid,
            type=ntype,
            content=content,
            trace_refs=[trace_ref] if trace_ref else [],
            created_at=created_at,
            created_by=created_by,
            **extra,
        )
        self.nodes[nid] = node
        return node

    def attach_registry_records(
        self,
        *,
        artifact: Artifact,
        artifact_version: ArtifactVersion,
        source_anchor: Optional[SourceAnchor] = None,
    ) -> None:
        self.artifacts[artifact.artifact_id] = Artifact.from_dict(artifact.to_dict())
        self.artifact_versions[artifact_version.version_id] = ArtifactVersion.from_dict(
            artifact_version.to_dict()
        )
        if source_anchor is not None:
            self.source_anchors[source_anchor.anchor_id] = SourceAnchor.from_dict(source_anchor.to_dict())

    def append_assessment(self, assessment: Assessment) -> None:
        if all(existing.assessment_id != assessment.assessment_id for existing in self.assessments):
            self.assessments.append(assessment)
        edge = self.edges.get(assessment.target_id)
        if edge is not None and assessment.assessment_id not in edge.assessment_ids:
            edge.assessment_ids.append(assessment.assessment_id)

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
        if rel in ACYCLIC_LINEAGE_RELS and self._would_cycle(src, dst):
            return None
        edge = Edge(id=eid, src=src, dst=dst, rel=rel, nli_score=nli_score, created_at=created_at)
        self.edges[eid] = edge
        return edge

    def _family_adjacency(self) -> dict[str, list[str]]:
        """src -> [dst] over the acyclic causal-lineage relations only."""
        adjacency: dict[str, list[str]] = {}
        for edge in self.edges.values():
            if edge.rel in ACYCLIC_LINEAGE_RELS:
                adjacency.setdefault(edge.src, []).append(edge.dst)
        return adjacency

    @staticmethod
    def _reaches(adjacency: dict[str, list[str]], start: str, target: str) -> bool:
        stack, seen = [start], {start}
        while stack:
            current = stack.pop()
            if current == target:
                return True
            for successor in adjacency.get(current, ()):
                if successor not in seen:
                    seen.add(successor)
                    stack.append(successor)
        return False

    def _would_cycle(self, src: str, dst: str, *, adjacency: Optional[dict[str, list[str]]] = None) -> bool:
        # Inserting src -> dst closes a cycle iff dst already reaches src.
        return self._reaches(adjacency if adjacency is not None else self._family_adjacency(), dst, src)

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
                existing.merge_occurrence(node)
                continue
            self.nodes[nid] = node
            new_nodes.append(nid)
        new_edges: list[str] = []
        # One adjacency for the whole merge, extended per accepted edge, keeps
        # cycle checking O(reachable) per edge instead of a full-graph rebuild.
        family_adjacency = self._family_adjacency()
        for eid, edge in other.edges.items():
            if edge.src not in self.nodes or edge.dst not in self.nodes:
                continue  # endpoint absent after merge -> drop (mirrors add_edge)
            if eid in self.edges:
                continue
            if edge.rel in ACYCLIC_LINEAGE_RELS:
                if self._would_cycle(edge.src, edge.dst, adjacency=family_adjacency):
                    continue
                family_adjacency.setdefault(edge.src, []).append(edge.dst)
            self.edges[eid] = edge
            new_edges.append(eid)
        self.artifacts.update(other.artifacts)
        self.artifact_versions.update(other.artifact_versions)
        self.source_anchors.update(other.source_anchors)
        for assessment in other.assessments:
            self.append_assessment(assessment)
        if other.review_policy_version:
            self.review_policy_version = other.review_policy_version
        if other.review_packets:
            by_id = {packet.review_packet_id: packet for packet in self.review_packets}
            by_id.update({packet.review_packet_id: packet for packet in other.review_packets})
            self.review_packets = sorted(by_id.values(), key=lambda packet: packet.review_packet_id)
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

    @staticmethod
    def _cyclic_components(g: nx.DiGraph) -> list[list[str]]:
        """Strongly connected components that contain a cycle (linear time).

        Enumerating simple cycles is exponential in dense components; every
        consumer here only needs "which nodes participate in a cycle", which
        SCCs answer exactly.
        """
        return [
            sorted(component) for component in nx.strongly_connected_components(g)
            if len(component) > 1 or any(g.has_edge(n, n) for n in component)
        ]

    def detect_cycles(self) -> dict:
        """Cycle report over the support/structural graph (Gate 1A item).

        We DO NOT silently break cycles: we report them so the extractor /
        scientist can decide, and so the topo layout knows what to exclude.
        Each reported cycle is one strongly connected component.
        """
        cycles = self._cyclic_components(self._digraph(rels=_LAYOUT_RELS))
        in_cycle: set[str] = set()
        for component in cycles:
            in_cycle.update(component)
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
        cyclic = self._cyclic_components(g)
        if cyclic:
            g.remove_nodes_from([n for component in cyclic for n in component])
        return [sorted(layer) for layer in nx.topological_generations(g)]

    def provenance_path(self, node_id: str) -> dict:
        """Resolve a semantic node through assertions/anchors to original Artifacts."""
        if node_id not in self.nodes:
            raise KeyError(node_id)
        by_src, by_dst = self._edge_indexes()

        def incoming_of(nid: str) -> list[Edge]:
            return [e for e in by_dst.get(nid, ()) if e.rel in EVIDENTIAL_RELS]

        seen_nodes: set[str] = set()
        seen_edges: list[Edge] = []
        stack = [node_id]
        while stack:
            cur = stack.pop()
            if cur in seen_nodes:
                continue
            seen_nodes.add(cur)
            for e in incoming_of(cur):
                seen_edges.append(e)
                stack.append(e.src)

        # Extend the epistemic path with explicit activity lineage. Relation
        # direction follows the domain contract: entity --generated_by--> run,
        # run --used--> input/software/environment. Generated logs and outputs
        # are included as sibling entities of the selected run.
        lineage_rels = {
            EdgeRel.GENERATED_BY, EdgeRel.USED, EdgeRel.DERIVED_FROM,
            EdgeRel.ASSOCIATED_WITH, EdgeRel.ATTRIBUTED_TO,
            EdgeRel.VERSION_OF, EdgeRel.SUPERSEDES,
            EdgeRel.REPLICATES, EdgeRel.FAILS_TO_REPLICATE,
        }
        lineage_edges: list[Edge] = []
        lineage_edge_ids: set[str] = set()
        lineage_seen: set[str] = set(seen_nodes)
        lineage_stack = list(seen_nodes)
        while lineage_stack:
            current = lineage_stack.pop()
            # The direction rules below only ever match edges incident to
            # `current`, so walking the incidence index is equivalent to the
            # full edge scan while staying O(degree) per node.
            for edge in (*by_src.get(current, ()), *by_dst.get(current, ())):
                if edge.rel not in lineage_rels:
                    continue
                neighbor: Optional[str] = None
                if edge.rel == EdgeRel.GENERATED_BY:
                    if edge.src == current:
                        neighbor = edge.dst
                    elif edge.dst == current and self.nodes[current].type in {
                        NodeType.EXPERIMENT_RUN, NodeType.ANALYSIS_RUN,
                    }:
                        neighbor = edge.src
                elif edge.rel in {EdgeRel.REPLICATES, EdgeRel.FAILS_TO_REPLICATE}:
                    if edge.dst == current:
                        neighbor = edge.src
                elif edge.src == current:
                    neighbor = edge.dst
                if neighbor is None:
                    continue
                if edge.id not in lineage_edge_ids:
                    lineage_edge_ids.add(edge.id)
                    lineage_edges.append(edge)
                if neighbor not in lineage_seen:
                    lineage_seen.add(neighbor)
                    lineage_stack.append(neighbor)
        seen_nodes.update(lineage_seen)
        seen_edge_ids = {edge.id for edge in seen_edges}
        seen_edges.extend(edge for edge in lineage_edges if edge.id not in seen_edge_ids)
        seen_edge_ids.update(lineage_edge_ids)

        leaves = sorted(n for n in seen_nodes if self.nodes[n].type == NodeType.SOURCE_ASSERTION)
        unsupported_leaves = sorted(
            n for n in seen_nodes if not incoming_of(n) and self.nodes[n].type != NodeType.SOURCE_ASSERTION
        )
        assertions = [self.nodes[n] for n in seen_nodes if self.nodes[n].type == NodeType.SOURCE_ASSERTION]
        artifact_ids = {n.artifact_id for n in assertions if n.artifact_id}
        version_ids = {n.artifact_version_id for n in assertions if n.artifact_version_id}
        anchor_ids = {n.source_anchor_id for n in assertions if n.source_anchor_id}
        breakpoints: list[dict] = []
        levels: list[int] = []
        for assertion in assertions:
            level = 0
            artifact = self.artifacts.get(assertion.artifact_id or "")
            version = self.artifact_versions.get(assertion.artifact_version_id or "")
            trace_only = bool(
                version and version.locator.lower().startswith(("runtime:", "trace:"))
            )
            if artifact is not None and trace_only:
                breakpoints.append({
                    "targetId": assertion.id,
                    "reason": "external_artifact_not_identified",
                })
            elif artifact is not None:
                level = 1
            else:
                breakpoints.append({"targetId": assertion.id, "reason": "artifact_not_linked"})
            anchor = self.source_anchors.get(assertion.source_anchor_id or "")
            if anchor is not None and not trace_only:
                level = max(level, 2)
            elif level >= 1:
                breakpoints.append({"targetId": assertion.id, "reason": "source_anchor_missing"})
            if level >= 2 and version is not None and version.content_digest and not trace_only:
                level = max(level, 3)
            elif level >= 2:
                breakpoints.append({"targetId": assertion.id, "reason": "artifact_digest_missing"})
            levels.append(level)
        level = min(levels) if levels else 0
        from .lineage import reproducibility_report
        reproducibility = reproducibility_report(self, node_id)
        if reproducibility["complete"]:
            level = 4
        elif reproducibility["runIds"]:
            breakpoints.extend(reproducibility["breakpoints"])
        lineage_artifact_nodes = [
            self.nodes[nid] for nid in seen_nodes
            if self.nodes[nid].artifact_id and self.nodes[nid].type != NodeType.SOURCE_ASSERTION
        ]
        reaches_artifact = (
            bool(assertions) and all(x.artifact_id in self.artifacts for x in assertions)
        ) or bool(lineage_artifact_nodes) and all(
            node.artifact_id in self.artifacts for node in lineage_artifact_nodes
        )
        return {
            "root": node_id,
            "nodes": [self.nodes[n].to_dict() for n in sorted(seen_nodes)],
            "edges": [e.to_dict() for e in seen_edges],
            "sourceAssertionLeaves": leaves,
            "unsupportedLeaves": unsupported_leaves,
            "reachesArtifact": reaches_artifact,
            "provenanceLevel": f"L{level}",
            "breakpoints": breakpoints,
            "reproducibility": reproducibility,
            "artifactRegistry": {
                "artifacts": [self.artifacts[x].to_dict() for x in sorted(artifact_ids) if x in self.artifacts],
                "artifactVersions": [self.artifact_versions[x].to_dict() for x in sorted(version_ids)
                                     if x in self.artifact_versions],
                "sourceAnchors": [self.source_anchors[x].to_dict() for x in sorted(anchor_ids)
                                  if x in self.source_anchors],
            },
            "assessments": [a.to_dict() for a in self.assessments
                            if a.target_id in seen_nodes or a.target_id in seen_edge_ids],
        }

    def incoming_supports(self, node_id: str) -> list[Edge]:
        return [e for e in self.edges_by_dst().get(node_id, ()) if e.rel in EVIDENTIAL_RELS]

    def edges_of(self, rel: EdgeRel) -> list[Edge]:
        return [e for e in self.edges.values() if e.rel == rel]

    def nodes_of(self, ntype: NodeType) -> list[Node]:
        return [n for n in self.nodes.values() if n.type == ntype]

    # --- (de)serialisation of the internal form -----------------------------
    def to_dict(self) -> dict:
        result = {
            "thread_id": self.thread_id,
            "meta": self.meta,
            "nodes": [n.to_dict() for n in self.nodes.values()],
            "edges": [e.to_dict() for e in self.edges.values()],
            "artifact_registry": {
                "artifacts": [a.to_dict() for a in self.artifacts.values()],
                "artifactVersions": [v.to_dict() for v in self.artifact_versions.values()],
                "sourceAnchors": [a.to_dict() for a in self.source_anchors.values()],
            },
            "assessments": [a.to_dict() for a in self.assessments],
        }
        if self.review_policy_version or self.review_packets:
            from .human_review import human_review_summary
            result["humanReview"] = human_review_summary(self)
        return result

    @classmethod
    def from_dict(cls, d: dict) -> "ThreadGraph":
        g = cls(d["thread_id"], d.get("meta"))
        for nd in d.get("nodes", []):
            n = Node.from_dict(nd)
            g.nodes[n.id] = n
        for ed in d.get("edges", []):
            e = Edge.from_dict(ed)
            g.edges[e.id] = e
        registry = d.get("artifact_registry") or {}
        for raw in registry.get("artifacts") or []:
            artifact = Artifact.from_dict(raw)
            g.artifacts[artifact.artifact_id] = artifact
        for raw in registry.get("artifactVersions") or []:
            version = ArtifactVersion.from_dict(raw)
            g.artifact_versions[version.version_id] = version
        for raw in registry.get("sourceAnchors") or []:
            anchor = SourceAnchor.from_dict(raw)
            g.source_anchors[anchor.anchor_id] = anchor
        g.assessments = [Assessment.from_dict(raw) for raw in d.get("assessments") or []]
        review = d.get("humanReview") or d.get("human_review") or {}
        if review:
            g.review_policy_version = review.get("policyVersion") or review.get("policy_version")
            g.review_packets = [
                ReviewPacket.from_dict(raw)
                for raw in (review.get("reviewPackets") or review.get("review_packets") or [])
            ]
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
