"""Canonical immutable Evidence Snapshot contract and digesting."""
from __future__ import annotations

import hashlib
import json
import re
import time
from dataclasses import dataclass
from typing import Any

from .graph import ThreadGraph

SCHEMA_VERSION = "evidence.v2"
EXTRACTOR_VERSION = "extractor.v2"
VERIFIER_VERSION = "verifier.v2"


def snapshot_storage_key(thread_id: str) -> str:
    """Collision-resistant cross-platform key shared by Evidence writers/readers."""
    slug = re.sub(r"[^A-Za-z0-9._-]", "_", thread_id)[:80] or "thread"
    suffix = hashlib.sha256(thread_id.encode("utf-8")).hexdigest()[:12]
    return f"{slug}-{suffix}"


def snapshot_filename(thread_id: str) -> str:
    return f"{snapshot_storage_key(thread_id)}.prov.json"


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _artifact_digests(graph: ThreadGraph) -> list[str]:
    referenced = {node.artifact_version_id for node in graph.nodes.values() if node.artifact_version_id}
    return sorted({
        graph.artifact_versions[version_id].content_digest
        for version_id in referenced
        if version_id in graph.artifact_versions and graph.artifact_versions[version_id].content_digest
    })


def _digest_payload(
    graph: ThreadGraph,
    *,
    input_watermark: str,
    schema_version: str,
    extractor_version: str,
    verifier_version: str,
) -> dict[str, Any]:
    graph_dict = graph.to_dict()
    graph_dict["meta"] = {
        k: v for k, v in graph_dict.get("meta", {}).items()
        if k not in {"snapshot", "inputDigest"}
    }
    registry = graph_dict.get("artifact_registry") or {}
    for version in registry.get("artifactVersions") or []:
        version.pop("observedAt", None)
    for anchor in registry.get("sourceAnchors") or []:
        anchor.pop("createdAt", None)
    canonical_assessments = {
        json.dumps({
            k: v for k, v in assessment.items()
            if k not in {"assessmentId", "targetDigest", "createdAt"}
        }, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        for assessment in graph_dict.get("assessments") or []
    }
    graph_dict["assessments"] = [json.loads(item) for item in sorted(canonical_assessments)]
    for edge in graph_dict.get("edges") or []:
        edge.pop("assessment_ids", None)
    return {
        "threadId": graph.thread_id,
        "inputWatermark": input_watermark,
        "schemaVersion": schema_version,
        "extractorVersion": extractor_version,
        "verifierVersion": verifier_version,
        "artifactDigests": _artifact_digests(graph),
        "graph": graph_dict,
    }


def compute_snapshot_digest(
    graph: ThreadGraph,
    *,
    input_watermark: str,
    schema_version: str = SCHEMA_VERSION,
    extractor_version: str = EXTRACTOR_VERSION,
    verifier_version: str = VERIFIER_VERSION,
) -> str:
    payload = json.dumps(
        _digest_payload(
            graph, input_watermark=input_watermark, schema_version=schema_version,
            extractor_version=extractor_version, verifier_version=verifier_version,
        ),
        ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    )
    return f"sha256:{hashlib.sha256(payload.encode('utf-8')).hexdigest()}"


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

    def __post_init__(self) -> None:
        if self.version < 1:
            raise ValueError("snapshot version must be >= 1")
        if self.status != "committed":
            raise ValueError("only fully committed Evidence Snapshots are valid")
        if not self.digest.startswith("sha256:"):
            raise ValueError("snapshot digest must be SHA-256")

    def to_dict(self) -> dict[str, Any]:
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
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "EvidenceSnapshot":
        required = {
            "threadId", "version", "digest", "inputWatermark", "schemaVersion",
            "extractorVersion", "verifierVersion", "artifactDigests", "createdAt", "status",
        }
        missing = required - set(d)
        if missing:
            raise ValueError(f"incomplete Evidence Snapshot: missing {', '.join(sorted(missing))}")
        return cls(
            thread_id=d["threadId"], version=int(d["version"]), digest=d["digest"],
            input_watermark=str(d["inputWatermark"]), schema_version=d["schemaVersion"],
            extractor_version=d["extractorVersion"], verifier_version=d["verifierVersion"],
            artifact_digests=tuple(d["artifactDigests"]), created_at=d["createdAt"], status=d["status"],
        )


def build_snapshot(graph: ThreadGraph, *, version: int, input_watermark: str) -> EvidenceSnapshot:
    return EvidenceSnapshot(
        thread_id=graph.thread_id,
        version=version,
        digest=compute_snapshot_digest(graph, input_watermark=input_watermark),
        input_watermark=input_watermark,
        schema_version=SCHEMA_VERSION,
        extractor_version=EXTRACTOR_VERSION,
        verifier_version=VERIFIER_VERSION,
        artifact_digests=tuple(_artifact_digests(graph)),
        created_at=_now_iso(),
    )
