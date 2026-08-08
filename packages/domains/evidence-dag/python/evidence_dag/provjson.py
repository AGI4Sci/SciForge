"""PROV-JSON (de)serialisation for a ThreadGraph.

Mapping (a legitimate, lossless PROV-O serialisation):
  * every semantic node   -> a PROV `entity`
  * every edge            -> a PROV `wasInfluencedBy` relation
                             (influencee = dst, influencer = src), tagged with
                             `edag:rel`; `supports` edges additionally carry
                             `edag:nli_score`.
  * thread/graph metadata -> a custom top-level `edag:meta` object.

All domain fields are stored under the `edag:` namespace, so
serialise -> deserialise is a lossless round-trip (Gate 1A).
"""
from __future__ import annotations

import json
from typing import Any

from .graph import ThreadGraph
from .model import (
    Artifact, ArtifactVersion, Assessment, Edge, EdgeRel, Node, NodeType,
    ReviewPacket, SourceAnchor,
)

PREFIX = {
    "prov": "http://www.w3.org/ns/prov#",
    "edag": "https://sciforge.ai/ns/evidence-dag#",
}

# node fields serialised as edag: attributes on the entity
_NODE_ATTRS = (
    "content", "status", "trace_refs", "created_at", "created_by", "atms_label",
    "source_type", "credibility", "source_quality", "retracted",
    "valid_from", "valid_to", "reasoning_type", "artifact_id", "artifact_version_id",
    "source_anchor_id", "freshness",
    "external_id", "attributes",
)


def to_prov_json(graph: ThreadGraph) -> dict[str, Any]:
    entities: dict[str, Any] = {}
    activities: dict[str, Any] = {}
    agents: dict[str, Any] = {}
    for n in graph.nodes.values():
        d = n.to_dict()
        ent: dict[str, Any] = {"prov:type": f"edag:{n.type.value}"}
        for attr in _NODE_ATTRS:
            ent[f"edag:{attr}"] = d[attr]
        if n.type in {NodeType.EXPERIMENT_RUN, NodeType.ANALYSIS_RUN}:
            activities[n.id] = ent
        elif n.type == NodeType.AGENT:
            agents[n.id] = ent
        else:
            entities[n.id] = ent

    influenced: dict[str, Any] = {}
    used: dict[str, Any] = {}
    generated: dict[str, Any] = {}
    derived: dict[str, Any] = {}
    associated: dict[str, Any] = {}
    attributed: dict[str, Any] = {}
    for e in graph.edges.values():
        common: dict[str, Any] = {
            "edag:rel": e.rel.value,
            "edag:created_at": e.created_at,
            "edag:assessment_ids": list(e.assessment_ids),
        }
        # both supports and contradicts edges carry a ν now; persist any score.
        if e.nli_score is not None:
            common["edag:nli_score"] = e.nli_score
        if e.rel == EdgeRel.USED:
            used[e.id] = {"prov:activity": e.src, "prov:entity": e.dst, **common}
        elif e.rel == EdgeRel.GENERATED_BY:
            generated[e.id] = {"prov:entity": e.src, "prov:activity": e.dst, **common}
        elif e.rel == EdgeRel.DERIVED_FROM:
            derived[e.id] = {
                "prov:generatedEntity": e.src, "prov:usedEntity": e.dst, **common,
            }
        elif e.rel == EdgeRel.ASSOCIATED_WITH:
            associated[e.id] = {"prov:activity": e.src, "prov:agent": e.dst, **common}
        elif e.rel == EdgeRel.ATTRIBUTED_TO:
            attributed[e.id] = {"prov:entity": e.src, "prov:agent": e.dst, **common}
        else:
            influenced[e.id] = {
                "prov:influencee": e.dst, "prov:influencer": e.src, **common,
            }

    result = {
        "prefix": dict(PREFIX),
        "entity": entities,
        "activity": activities,
        "agent": agents,
        "used": used,
        "wasGeneratedBy": generated,
        "wasDerivedFrom": derived,
        "wasAssociatedWith": associated,
        "wasAttributedTo": attributed,
        "wasInfluencedBy": influenced,
        "edag:order": {
            "nodes": list(graph.nodes),
            "edges": list(graph.edges),
        },
        "edag:meta": {"thread_id": graph.thread_id, **graph.meta},
        "edag:artifactRegistry": {
            "artifacts": [item.to_dict() for item in graph.artifacts.values()],
            "artifactVersions": [item.to_dict() for item in graph.artifact_versions.values()],
            "sourceAnchors": [item.to_dict() for item in graph.source_anchors.values()],
        },
        "edag:assessments": [item.to_dict() for item in graph.assessments],
    }
    if graph.artifact_version_refs:
        result["edag:artifactRegistry"]["artifactVersionRefs"] = [
            graph.artifact_version_refs[key].to_dict()
            for key in sorted(graph.artifact_version_refs)
        ]
    if graph.review_policy_version or graph.review_packets:
        from .human_review import human_review_summary
        result["edag:humanReview"] = human_review_summary(graph)
    return result


def from_prov_json(doc: dict[str, Any]) -> ThreadGraph:
    meta_block = doc.get("edag:meta", {}) or {}
    thread_id = meta_block.get("thread_id", "unknown")
    graph = ThreadGraph(thread_id, {k: v for k, v in meta_block.items() if k != "thread_id"})

    for section, fallback in (("entity", "claim"), ("activity", "analysis_run"), ("agent", "agent")):
        for nid, ent in (doc.get(section) or {}).items():
            if section != "entity" and "prov:type" not in ent:
                # PROV permits arbitrary activity/agent records, but this
                # domain graph imports only records explicitly typed as EDAG
                # objects. Unknown extension sections remain ignored.
                continue
            ntype = str(ent.get("prov:type", f"edag:{fallback}")).split(":", 1)[-1]
            if section == "activity" and ntype not in {
                NodeType.EXPERIMENT_RUN.value, NodeType.ANALYSIS_RUN.value,
            }:
                continue
            if section == "agent" and ntype != NodeType.AGENT.value:
                continue
            nd: dict[str, Any] = {"id": nid, "type": ntype}
            for attr in _NODE_ATTRS:
                if f"edag:{attr}" in ent:
                    nd[attr] = ent[f"edag:{attr}"]
            node = Node.from_dict(nd)
            graph.nodes[node.id] = node

    for eid, rel in (doc.get("wasInfluencedBy") or {}).items():
        ed = {
            "id": eid,
            "src": rel["prov:influencer"],
            "dst": rel["prov:influencee"],
            "rel": rel.get("edag:rel", "supports"),
            "nli_score": rel.get("edag:nli_score"),
            "created_at": rel.get("edag:created_at"),
            "assessment_ids": rel.get("edag:assessment_ids") or [],
        }
        edge = Edge.from_dict(ed)
        graph.edges[edge.id] = edge

    relation_sections = (
        ("used", "prov:activity", "prov:entity", EdgeRel.USED),
        ("wasGeneratedBy", "prov:entity", "prov:activity", EdgeRel.GENERATED_BY),
        ("wasDerivedFrom", "prov:generatedEntity", "prov:usedEntity", EdgeRel.DERIVED_FROM),
        ("wasAssociatedWith", "prov:activity", "prov:agent", EdgeRel.ASSOCIATED_WITH),
        ("wasAttributedTo", "prov:entity", "prov:agent", EdgeRel.ATTRIBUTED_TO),
    )
    for section, src_key, dst_key, fallback_rel in relation_sections:
        for eid, rel in (doc.get(section) or {}).items():
            ed = {
                "id": eid,
                "src": rel[src_key],
                "dst": rel[dst_key],
                "rel": rel.get("edag:rel", fallback_rel.value),
                "nli_score": rel.get("edag:nli_score"),
                "created_at": rel.get("edag:created_at"),
                "assessment_ids": rel.get("edag:assessment_ids") or [],
            }
            edge = Edge.from_dict(ed)
            graph.edges[edge.id] = edge

    order = doc.get("edag:order") or {}
    node_order = order.get("nodes") if isinstance(order.get("nodes"), list) else []
    edge_order = order.get("edges") if isinstance(order.get("edges"), list) else []
    if node_order:
        graph.nodes = {
            node_id: graph.nodes[node_id] for node_id in node_order if node_id in graph.nodes
        } | {node_id: node for node_id, node in graph.nodes.items() if node_id not in node_order}
    if edge_order:
        graph.edges = {
            edge_id: graph.edges[edge_id] for edge_id in edge_order if edge_id in graph.edges
        } | {edge_id: edge for edge_id, edge in graph.edges.items() if edge_id not in edge_order}

    registry = doc.get("edag:artifactRegistry") or {}
    for raw in registry.get("artifacts") or []:
        item = Artifact.from_dict(raw)
        graph.artifacts[item.artifact_id] = item
    for raw in registry.get("artifactVersions") or []:
        item = ArtifactVersion.from_dict(raw)
        graph.artifact_versions[item.version_id] = item
    from .artifact_versions import ArtifactVersionRefV1
    for raw in registry.get("artifactVersionRefs") or []:
        item = ArtifactVersionRefV1.from_dict(raw)
        graph.artifact_version_refs[item.version_id] = item
    for raw in registry.get("sourceAnchors") or []:
        item = SourceAnchor.from_dict(raw)
        graph.source_anchors[item.anchor_id] = item
    graph.assessments = [Assessment.from_dict(raw) for raw in doc.get("edag:assessments") or []]
    review = doc.get("edag:humanReview") or {}
    if review:
        graph.review_policy_version = review.get("policyVersion") or review.get("policy_version")
        graph.review_packets = [
            ReviewPacket.from_dict(raw)
            for raw in (review.get("reviewPackets") or review.get("review_packets") or [])
        ]

    return graph


def dumps(graph: ThreadGraph, *, indent: int = 2) -> str:
    return json.dumps(to_prov_json(graph), ensure_ascii=False, indent=indent)


def loads(text: str) -> ThreadGraph:
    return from_prov_json(json.loads(text))
