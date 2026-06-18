"""Core data contract for the evidence DAG (阶段一).

One thread == one graph. Status is limited to {supported, unverified} in phase 1;
`contradicts` edges are extracted and exposed but never adjudicated here.
Source nodes carry only what phase 1 can realistically obtain
(`ref:{doi|url|citation}`); quality / retraction / validity fields stay
`None` and are owned by phase 2 (world_update).
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional


class NodeType(str, Enum):
    SOURCE = "source"
    REASONING = "reasoning"
    CLAIM = "claim"


class NodeStatus(str, Enum):
    SUPPORTED = "supported"
    UNVERIFIED = "unverified"
    CONFLICTING = "conflicting"  # supported AND credibly contradicted (ν≥threshold on a contradicts edge)
    # phase 2+: INVALIDATED / FRAGILE — still computed as views (reconcile/analysis), not persisted here.


class EdgeRel(str, Enum):
    SUPPORTS = "supports"
    CONTRADICTS = "contradicts"
    REFINES = "refines"
    PREREQUISITE = "prerequisite"


def normalize(text: str) -> str:
    """Whitespace/­case-normalised form used for shared-node dedup."""
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def make_node_id(ntype: "NodeType | str", content: str) -> str:
    """Deterministic, content-addressed id.

    Two identically-typed nodes with the same normalised content collapse to the
    same id — that is exactly the "same evidence cited in many places becomes one
    shared node" requirement (DAG, not tree) from 技术要点.
    """
    t = ntype.value if isinstance(ntype, NodeType) else str(ntype)
    h = hashlib.sha1(f"{t}|{normalize(content)}".encode("utf-8")).hexdigest()[:12]
    return f"{t}:{h}"


def make_edge_id(src: str, dst: str, rel: "EdgeRel | str") -> str:
    r = rel.value if isinstance(rel, EdgeRel) else str(rel)
    h = hashlib.sha1(f"{src}|{dst}|{r}".encode("utf-8")).hexdigest()[:12]
    return f"edge:{h}"


@dataclass
class Node:
    id: str
    type: NodeType
    content: str
    status: NodeStatus = NodeStatus.UNVERIFIED
    trace_ref: Optional[str] = None
    created_at: Optional[str] = None
    created_by: Optional[str] = None
    atms_label: list = field(default_factory=list)  # populated from phase 2 (L3)
    # source-only metadata (phase 1 fills `ref` at best; the rest stay None)
    ref: Optional[dict] = None
    source_type: Optional[str] = None   # paper|preprint|guideline|dataset|news|blog|web|unknown
    credibility: Optional[str] = None   # high|medium|low — LLM-judged for THIS specific source
    source_quality: Optional[float] = None
    retracted: Optional[bool] = None
    valid_from: Optional[str] = None
    valid_to: Optional[str] = None
    # reasoning-only
    reasoning_type: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type.value,
            "content": self.content,
            "status": self.status.value,
            "trace_ref": self.trace_ref,
            "created_at": self.created_at,
            "created_by": self.created_by,
            "atms_label": self.atms_label,
            "ref": self.ref,
            "source_type": self.source_type,
            "credibility": self.credibility,
            "source_quality": self.source_quality,
            "retracted": self.retracted,
            "valid_from": self.valid_from,
            "valid_to": self.valid_to,
            "reasoning_type": self.reasoning_type,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Node":
        return cls(
            id=d["id"],
            type=NodeType(d["type"]),
            content=d.get("content", ""),
            status=NodeStatus(d.get("status", "unverified")),
            trace_ref=d.get("trace_ref"),
            created_at=d.get("created_at"),
            created_by=d.get("created_by"),
            atms_label=d.get("atms_label", []) or [],
            ref=d.get("ref"),
            source_type=d.get("source_type"),
            credibility=d.get("credibility"),
            source_quality=d.get("source_quality"),
            retracted=d.get("retracted"),
            valid_from=d.get("valid_from"),
            valid_to=d.get("valid_to"),
            reasoning_type=d.get("reasoning_type"),
        )


@dataclass
class Edge:
    id: str
    src: str
    dst: str
    rel: EdgeRel
    nli_score: Optional[float] = None  # only `supports` edges carry ν∈[0,1]
    created_at: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "src": self.src,
            "dst": self.dst,
            "rel": self.rel.value,
            "nli_score": self.nli_score,
            "created_at": self.created_at,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Edge":
        return cls(
            id=d["id"],
            src=d["src"],
            dst=d["dst"],
            rel=EdgeRel(d["rel"]),
            nli_score=d.get("nli_score"),
            created_at=d.get("created_at"),
        )
