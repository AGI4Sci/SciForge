"""Read committed, immutable Evidence Snapshots.

Project DAG deliberately has no raw-trace or legacy-PROV fallback.  A session
file is consumable only when its canonical ``edag:meta.snapshot`` envelope is
present and says ``status=committed``.  The snapshot digest, rather than a
best-effort file hash, is the cross-layer identity recorded in every Project
Snapshot.
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from typing import Optional

import project_dag  # noqa: F401  (side effect: sys.path for evidence_dag)
from evidence_dag import provjson
from evidence_dag.graph import ThreadGraph
from evidence_dag.model import EdgeRel, NodeStatus, NodeType
from evidence_dag.snapshot import (
    compute_snapshot_digest,
    snapshot_artifact_digests,
    snapshot_filename,
    snapshot_storage_key,
)
from .human_review import normalize_upstream_review

# statuses that qualify a session claim for promotion. `conflicting` is
# included on purpose: a claim contested inside one session is exactly the
# kind the project layer should adjudicate across sessions.
ELIGIBLE_STATUS = {NodeStatus.SUPPORTED, NodeStatus.FRAGILE, NodeStatus.CONFLICTED}
ELIGIBLE_NODE_TYPES = {NodeType.CLAIM, NodeType.FINDING}
_UPSTREAM_RELS = {EdgeRel.SUPPORTS, EdgeRel.REFINES, EdgeRel.PREREQUISITE}

CREDIBILITY_SCORE = {"high": 0.9, "medium": 0.6, "low": 0.3}
DEFAULT_QUALITY = 0.5
def _read_snapshot_header(path: str) -> Optional[dict]:
    try:
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
        meta = doc.get("edag:meta") or {}
        snapshot = meta.get("snapshot")
        if not isinstance(snapshot, dict) or snapshot.get("status") != "committed":
            return None
        return snapshot
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


@dataclass(frozen=True)
class EvidenceSnapshot:
    thread_id: str
    version: int
    digest: str
    input_watermark: str
    schema_version: str
    extractor_version: str
    verifier_version: str
    artifact_digests: tuple[str, ...]
    created_at: str
    status: str = "committed"
    human_review: Optional[dict] = None

    @classmethod
    def from_dict(cls, value: dict) -> "EvidenceSnapshot":
        required = (
            "threadId", "version", "digest", "inputWatermark", "schemaVersion",
            "extractorVersion", "verifierVersion", "artifactDigests", "createdAt", "status",
        )
        missing = [key for key in required if key not in value]
        if missing:
            raise ValueError(f"Evidence Snapshot missing fields: {', '.join(missing)}")
        if value["status"] != "committed":
            raise ValueError("Project DAG only consumes committed Evidence Snapshots")
        thread_id = value["threadId"]
        digest = value["digest"]
        if not isinstance(thread_id, str) or not thread_id:
            raise ValueError("Evidence Snapshot threadId must be non-empty")
        if not isinstance(digest, str) or not digest:
            raise ValueError("Evidence Snapshot digest must be non-empty")
        artifacts = value["artifactDigests"]
        if not isinstance(artifacts, list) or not all(isinstance(x, str) for x in artifacts):
            raise ValueError("Evidence Snapshot artifactDigests must be a string array")
        return cls(
            thread_id=thread_id,
            version=int(value["version"]),
            digest=digest,
            input_watermark=str(value["inputWatermark"]),
            schema_version=str(value["schemaVersion"]),
            extractor_version=str(value["extractorVersion"]),
            verifier_version=str(value["verifierVersion"]),
            artifact_digests=tuple(sorted(set(artifacts))),
            created_at=str(value["createdAt"]),
            human_review=normalize_upstream_review(value.get("humanReview"), thread_id),
        )

    def to_dict(self) -> dict:
        return {
            "threadId": self.thread_id,
            "version": self.version,
            "digest": self.digest,
            "inputWatermark": self.input_watermark,
            "schemaVersion": self.schema_version,
            "extractorVersion": self.extractor_version,
            "verifierVersion": self.verifier_version,
            "artifactDigests": list(self.artifact_digests),
            "createdAt": self.created_at,
            "status": self.status,
            **({"humanReview": self.human_review} if self.human_review else {}),
        }


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
                header = _read_snapshot_header(path)
                if header is not None:
                    snapshot = EvidenceSnapshot.from_dict(header)
                    out.append(snapshot.thread_id)
        return out

    def _path(self, session_id: str) -> str:
        return os.path.join(self.session_dir, snapshot_filename(session_id))

    def _historical_path(self, session_id: str, digest: str) -> str:
        if not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
            raise ValueError(f"{session_id}: invalid Evidence Snapshot digest")
        directory = os.path.join(
            self.session_dir, "snapshots", snapshot_storage_key(session_id),
        )
        suffix = f"-{digest[7:]}.prov.json"
        matches = sorted(
            os.path.join(directory, name)
            for name in os.listdir(directory)
            if name.endswith(suffix)
        ) if os.path.isdir(directory) else []
        if len(matches) != 1:
            raise ValueError(
                f"{session_id}: immutable Evidence Snapshot {digest}"
                f" has {len(matches)} matching historical files"
            )
        return matches[0]

    def load(self, session_id: str, expected_digest: Optional[str] = None) \
            -> tuple[ThreadGraph, EvidenceSnapshot, dict]:
        """Parse exactly one committed Evidence Snapshot."""
        path = self._path(session_id)
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
        header = (doc.get("edag:meta") or {}).get("snapshot")
        if not isinstance(header, dict):
            raise ValueError(f"{session_id}: missing committed Evidence Snapshot envelope")
        snapshot = EvidenceSnapshot.from_dict(header)
        if expected_digest is not None and snapshot.digest != expected_digest:
            path = self._historical_path(session_id, expected_digest)
            with open(path, encoding="utf-8") as fh:
                doc = json.load(fh)
            header = (doc.get("edag:meta") or {}).get("snapshot")
            if not isinstance(header, dict):
                raise ValueError(f"{session_id}: historical Evidence Snapshot envelope missing")
            snapshot = EvidenceSnapshot.from_dict(header)
        if snapshot.thread_id != session_id:
            raise ValueError(f"{session_id}: Evidence Snapshot threadId mismatch")
        if expected_digest is not None and snapshot.digest != expected_digest:
            raise ValueError(
                f"{session_id}: expected Evidence digest {expected_digest}, got {snapshot.digest}")
        graph = provjson.from_prov_json(doc)
        actual_digest = compute_snapshot_digest(
            graph,
            input_watermark=snapshot.input_watermark,
            schema_version=snapshot.schema_version,
            extractor_version=snapshot.extractor_version,
            verifier_version=snapshot.verifier_version,
        )
        if actual_digest != snapshot.digest:
            raise ValueError(
                f"{session_id}: Evidence Snapshot digest mismatch;"
                f" envelope={snapshot.digest}, computed={actual_digest}"
            )
        actual_artifact_digests = tuple(snapshot_artifact_digests(graph))
        if actual_artifact_digests != snapshot.artifact_digests:
            raise ValueError(
                f"{session_id}: Evidence Snapshot artifactDigests mismatch;"
                f" envelope={list(snapshot.artifact_digests)},"
                f" computed={list(actual_artifact_digests)}"
            )
        return graph, snapshot, doc

    def delta(self, session_id: str, watermark: Optional[dict],
              expected_digest: Optional[str] = None) -> Optional[SessionDelta]:
        """None if the session is unchanged since the watermark."""
        graph, snapshot, _ = self.load(session_id, expected_digest)
        seen: set[str] = watermark["processed_ids"] if watermark else set()
        if watermark and watermark["dag_hash"] == snapshot.digest:
            return None
        node_ids = set(graph.nodes)
        eligible_claims = [
            nid for nid, n in graph.nodes.items()
            if n.type in ELIGIBLE_NODE_TYPES and n.status in ELIGIBLE_STATUS
        ]
        # A changed immutable Evidence digest can alter support edges, Artifact
        # versions/freshness or node status while semantic node IDs remain the
        # same. Refresh this session's prior contributions before promoting the
        # current eligible Claim/Finding set. This is session-incremental and
        # avoids the incorrect "vector advanced, graph stayed stale" state.
        refresh_prior = sorted(seen)
        return SessionDelta(
            session_id, snapshot.digest, graph, sorted(eligible_claims),
            refresh_prior, node_ids,
        )

    def resolve_reference(self, session_id: str, snapshot_digest: str,
                          node_id: str) -> dict:
        """Resolve transient Evidence data for one immutable reference."""
        graph, _, _ = self.load(session_id, snapshot_digest)
        node = graph.nodes.get(node_id)
        if node is None:
            raise ValueError(
                f"{session_id}: Evidence node {node_id} is absent from {snapshot_digest}")
        version = graph.artifact_versions.get(node.artifact_version_id or "")
        return {
            "node": node,
            "quality": source_quality(graph, node_id),
            "sourceIdentity": (version.content_digest if version is not None
                               and version.content_digest else node_id),
        }

    def resolve_node(self, session_id: str, snapshot_digest: str, node_id: str):
        return self.resolve_reference(session_id, snapshot_digest, node_id)["node"]


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
    """SourceAssertion ids upstream of the claim — its evidence set."""
    sub = supporting_subgraph(graph, claim_id)
    return [n["id"] for n in sub["nodes"] if n["type"] == "source_assertion"]
