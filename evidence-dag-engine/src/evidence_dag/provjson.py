"""PROV-JSON (de)serialisation for a ThreadGraph.

Mapping (a legitimate, lossless PROV-O serialisation):
  * every node            -> a PROV `entity`, typed `edag:source|reasoning|claim`
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
from .model import Edge, Node

PREFIX = {
    "prov": "http://www.w3.org/ns/prov#",
    "edag": "https://sciforge.ai/ns/evidence-dag#",
}

# node fields serialised as edag: attributes on the entity
_NODE_ATTRS = (
    "content", "status", "trace_ref", "created_at", "created_by", "atms_label",
    "ref", "source_type", "credibility", "source_quality", "retracted",
    "valid_from", "valid_to", "reasoning_type",
)


def to_prov_json(graph: ThreadGraph) -> dict[str, Any]:
    entities: dict[str, Any] = {}
    for n in graph.nodes.values():
        d = n.to_dict()
        ent: dict[str, Any] = {"prov:type": f"edag:{n.type.value}"}
        for attr in _NODE_ATTRS:
            ent[f"edag:{attr}"] = d[attr]
        entities[n.id] = ent

    influenced: dict[str, Any] = {}
    for e in graph.edges.values():
        rel: dict[str, Any] = {
            "prov:influencee": e.dst,
            "prov:influencer": e.src,
            "edag:rel": e.rel.value,
            "edag:created_at": e.created_at,
        }
        # both supports and contradicts edges carry a ν now; persist any score.
        if e.nli_score is not None:
            rel["edag:nli_score"] = e.nli_score
        influenced[e.id] = rel

    return {
        "prefix": dict(PREFIX),
        "entity": entities,
        "wasInfluencedBy": influenced,
        "edag:meta": {"thread_id": graph.thread_id, "meta": graph.meta},
    }


def from_prov_json(doc: dict[str, Any]) -> ThreadGraph:
    meta_block = doc.get("edag:meta", {}) or {}
    thread_id = meta_block.get("thread_id", "unknown")
    graph = ThreadGraph(thread_id, meta_block.get("meta"))

    for nid, ent in (doc.get("entity") or {}).items():
        ntype = str(ent.get("prov:type", "edag:claim")).split(":", 1)[-1]
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
        }
        edge = Edge.from_dict(ed)
        graph.edges[edge.id] = edge

    return graph


def dumps(graph: ThreadGraph, *, indent: int = 2) -> str:
    return json.dumps(to_prov_json(graph), ensure_ascii=False, indent=indent)


def loads(text: str) -> ThreadGraph:
    return from_prov_json(json.loads(text))
