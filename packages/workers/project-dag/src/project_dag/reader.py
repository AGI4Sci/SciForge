"""Read-only adapter over the evidence-dag session store.

A "session" is one evidence-dag thread, persisted by the sidecar as
`{thread_id}.prov.json` under EDAG_STORAGE_DIR. This module never writes
there. Delta detection uses the file content hash plus the set of node ids
already processed (node ids are content-addressed, so a rewritten node is a
vanished id + a new id — no sequence numbers exist or are needed).
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass, field
from typing import Optional

import project_dag  # noqa: F401  (side effect: sys.path for evidence_dag)
from evidence_dag import provjson
from evidence_dag.graph import ThreadGraph
from evidence_dag.model import EdgeRel, NodeStatus, NodeType

# statuses that qualify a session claim for promotion. `conflicting` is
# included on purpose: a claim contested inside one session is exactly the
# kind the project layer should adjudicate across sessions.
ELIGIBLE_STATUS = {NodeStatus.SUPPORTED, NodeStatus.CONFLICTING}
_UPSTREAM_RELS = {EdgeRel.SUPPORTS, EdgeRel.REFINES, EdgeRel.PREREQUISITE}

CREDIBILITY_SCORE = {"high": 0.9, "medium": 0.6, "low": 0.3}
DEFAULT_QUALITY = 0.5
_WINDOWS_ILLEGAL_FILENAME_CHARS = re.compile(r'[/\\:<>"|?*]')


def _safe_session_filename(session_id: str) -> str:
    return _WINDOWS_ILLEGAL_FILENAME_CHARS.sub("_", session_id)


def _read_thread_id(path: str) -> Optional[str]:
    try:
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
        tid = (doc.get("edag:meta") or {}).get("thread_id")
        return tid if isinstance(tid, str) and tid else None
    except (OSError, ValueError):
        return None


@dataclass
class SessionDelta:
    session_id: str
    dag_hash: str
    graph: ThreadGraph
    new_claim_ids: list[str] = field(default_factory=list)   # eligible & unseen
    vanished_ids: list[str] = field(default_factory=list)    # history rewritten
    all_node_ids: set[str] = field(default_factory=set)


class SessionReader:
    def __init__(self, session_dir: str) -> None:
        self.session_dir = session_dir

    def list_sessions(self) -> list[str]:
        if not os.path.isdir(self.session_dir):
            return []
        out = []
        for fn in sorted(os.listdir(self.session_dir)):
            if fn.endswith(".prov.json"):
                path = os.path.join(self.session_dir, fn)
                out.append(_read_thread_id(path) or fn[: -len(".prov.json")])
        return out

    def _path(self, session_id: str) -> str:
        safe = _safe_session_filename(session_id)
        return os.path.join(self.session_dir, f"{safe}.prov.json")

    def _legacy_path(self, session_id: str) -> Optional[str]:
        """Read-only fallback for pre-sanitiser POSIX session files.

        Evidence DAG now writes Windows-safe filenames, but existing stores may
        still contain flat files like `codex:thread.prov.json`. Project DAG must
        read those without reintroducing unsafe writes or path traversal.
        """
        if session_id == _safe_session_filename(session_id):
            return None
        if "/" in session_id or "\\" in session_id:
            return None
        return os.path.join(self.session_dir, f"{session_id}.prov.json")

    def load(self, session_id: str) -> tuple[ThreadGraph, str]:
        """Parse one session graph; returns (graph, content_hash)."""
        path = self._path(session_id)
        if not os.path.exists(path):
            path = self._legacy_path(session_id) or path
        with open(path, encoding="utf-8") as fh:
            raw = fh.read()
        h = hashlib.sha1(raw.encode("utf-8")).hexdigest()
        return provjson.from_prov_json(json.loads(raw)), h

    def delta(self, session_id: str, watermark: Optional[dict]) -> Optional[SessionDelta]:
        """None if the session is unchanged since the watermark."""
        graph, h = self.load(session_id)
        seen: set[str] = watermark["processed_ids"] if watermark else set()
        if watermark and watermark["dag_hash"] == h:
            return None
        node_ids = set(graph.nodes)
        new_claims = [
            nid for nid, n in graph.nodes.items()
            if n.type == NodeType.CLAIM and n.status in ELIGIBLE_STATUS
            and nid not in seen
        ]
        vanished = sorted(seen - node_ids)
        if not new_claims and not vanished:
            return None  # hash moved but nothing promotable changed
        return SessionDelta(session_id, h, graph, sorted(new_claims), vanished, node_ids)


def supporting_subgraph(graph: ThreadGraph, claim_id: str) -> dict:
    """The claim + everything upstream of it along supports/refines/prerequisite
    edges — what the distill judge is allowed to see and cite."""
    upstream: dict[str, set[str]] = {}
    for e in graph.edges.values():
        if e.rel in _UPSTREAM_RELS:
            upstream.setdefault(e.dst, set()).add(e.src)
    keep: set[str] = set()
    frontier = [claim_id]
    while frontier:
        nid = frontier.pop()
        if nid in keep:
            continue
        keep.add(nid)
        frontier.extend(upstream.get(nid, ()))
    nodes = [{"id": nid,
              "type": graph.nodes[nid].type.value,
              "content": graph.nodes[nid].content}
             for nid in sorted(keep) if nid in graph.nodes]
    edges = [{"src": e.src, "dst": e.dst, "rel": e.rel.value}
             for e in graph.edges.values()
             if e.src in keep and e.dst in keep and e.rel in _UPSTREAM_RELS]
    return {"nodes": nodes, "edges": edges}


def source_quality(graph: ThreadGraph, node_id: str) -> float:
    node = graph.nodes.get(node_id)
    if node is None:
        return DEFAULT_QUALITY
    if node.source_quality is not None:
        return float(node.source_quality)
    return CREDIBILITY_SCORE.get(node.credibility or "", DEFAULT_QUALITY)


def source_ancestors(graph: ThreadGraph, claim_id: str) -> list[str]:
    """SOURCE-node ids upstream of the claim — its evidence set."""
    sub = supporting_subgraph(graph, claim_id)
    return [n["id"] for n in sub["nodes"] if n["type"] == NodeType.SOURCE.value]
