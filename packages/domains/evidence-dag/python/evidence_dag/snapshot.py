"""Canonical immutable Evidence Snapshot contract and digesting."""
from __future__ import annotations

import hashlib
import json
import re
import time
from dataclasses import dataclass
from typing import Any, Optional

from .graph import ThreadGraph

SCHEMA_VERSION = "evidence.v3"
EXTRACTOR_VERSION = "extractor.v3"
VERIFIER_VERSION = "verifier.v3"
LEGACY_SCHEMA_VERSION = "evidence.v2"
SUPPORTED_SCHEMA_VERSIONS = frozenset({LEGACY_SCHEMA_VERSION, SCHEMA_VERSION})


def snapshot_storage_key(thread_id: str) -> str:
    """Collision-resistant cross-platform key shared by Evidence writers/readers."""
    slug = re.sub(r"[^A-Za-z0-9._-]", "_", thread_id)[:80] or "thread"
    suffix = hashlib.sha256(thread_id.encode("utf-8")).hexdigest()[:12]
    return f"{slug}-{suffix}"


def snapshot_filename(thread_id: str) -> str:
    return f"{snapshot_storage_key(thread_id)}.prov.json"


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def snapshot_artifact_digests(graph: ThreadGraph) -> list[str]:
    """Return the immutable Artifact digests bound into a snapshot digest."""
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
    # Assessment/check execution timestamps are audit metadata, not semantic
    # input.  Excluding them preserves idempotence for a repeated compile.
    normalized_assessments: set[str] = set()
    for raw in graph_dict.get("assessments") or []:
        assessment = {
            k: v for k, v in raw.items()
            if k not in {"assessmentId", "targetDigest", "createdAt"}
        }
        review = assessment.get("humanReview")
        if isinstance(review, dict):
            review = dict(review)
            review.pop("computedAt", None)
            for key in ("status", "blocking", "reviewedBy", "reviewedAt"):
                review.pop(key, None)
            reasons = []
            for reason in review.get("reasons") or []:
                if isinstance(reason, dict):
                    reason = dict(reason)
                    if reason.get("sourceType") == "assessment":
                        reason.pop("sourceId", None)
                reasons.append(reason)
            review["reasons"] = reasons
            assessment["humanReview"] = review
        normalized_assessments.add(json.dumps(
            assessment, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        ))
    canonical_assessments = normalized_assessments
    graph_dict["assessments"] = [json.loads(item) for item in sorted(canonical_assessments)]
    review = graph_dict.get("humanReview")
    if isinstance(review, dict):
        review = dict(review)
        # The flat fields are a read-model projection of the highest-priority
        # packet for cross-DAG consumers.  Canonical semantics live in the
        # packets below, so decision-driven projection changes must not mutate
        # the immutable Evidence digest.
        for key in (
            "gateStatus", "pendingCount", "blockingCount", "reviewPacketIds",
            "level", "score", "status", "reasons", "blocking",
            "reviewPacketId", "checker", "machineChecks", "blastRadius",
            "computedAt", "reviewedBy", "reviewedAt",
        ):
            review.pop(key, None)
        packets = []
        for raw in review.get("reviewPackets") or []:
            if not isinstance(raw, dict):
                continue
            packet = dict(raw)
            packet.pop("computedAt", None)
            packet.pop("assessmentIds", None)
            for key in ("status", "blocking", "reviewedBy", "reviewedAt"):
                packet.pop(key, None)
            checks = []
            for raw_check in packet.get("machineChecks") or []:
                check = dict(raw_check)
                check.pop("assessmentId", None)
                checks.append(check)
            packet["machineChecks"] = checks
            reasons = []
            for raw_reason in packet.get("reasons") or []:
                reason = dict(raw_reason)
                if reason.get("sourceType") == "assessment":
                    reason.pop("sourceId", None)
                reasons.append(reason)
            packet["reasons"] = reasons
            packets.append(packet)
        review["reviewPackets"] = sorted(packets, key=lambda item: item.get("reviewPacketId", ""))
        graph_dict["humanReview"] = review
    for edge in graph_dict.get("edges") or []:
        edge.pop("assessment_ids", None)
    return {
        "threadId": graph.thread_id,
        "inputWatermark": input_watermark,
        "schemaVersion": schema_version,
        "extractorVersion": extractor_version,
        "verifierVersion": verifier_version,
        "artifactDigests": snapshot_artifact_digests(graph),
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
    # ``_digest_payload`` intentionally remains the exact v2 canonical
    # projection.  v3 adds node/edge enum values and stores new semantics in
    # existing ``attributes`` fields, so a persisted evidence.v2 envelope can
    # still be recomputed byte-for-byte instead of being rewritten in place.
    if schema_version not in SUPPORTED_SCHEMA_VERSIONS:
        raise ValueError(f"unsupported Evidence Snapshot schema: {schema_version}")
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
    human_review: Optional[dict[str, Any]] = None

    def __post_init__(self) -> None:
        if self.version < 1:
            raise ValueError("snapshot version must be >= 1")
        if self.status != "committed":
            raise ValueError("only fully committed Evidence Snapshots are valid")
        if not self.digest.startswith("sha256:"):
            raise ValueError("snapshot digest must be SHA-256")

    def to_dict(self) -> dict[str, Any]:
        result = {
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
        if self.human_review is not None:
            result["humanReview"] = self.human_review
        return result

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
            human_review=d.get("humanReview") or d.get("human_review"),
        )


def build_snapshot(graph: ThreadGraph, *, version: int, input_watermark: str) -> EvidenceSnapshot:
    from .human_review import human_review_summary
    review = human_review_summary(graph)
    if review is not None:
        review = {key: value for key, value in review.items() if key != "reviewPackets"}
    return EvidenceSnapshot(
        thread_id=graph.thread_id,
        version=version,
        digest=compute_snapshot_digest(graph, input_watermark=input_watermark),
        input_watermark=input_watermark,
        schema_version=SCHEMA_VERSION,
        extractor_version=EXTRACTOR_VERSION,
        verifier_version=VERIFIER_VERSION,
        artifact_digests=tuple(snapshot_artifact_digests(graph)),
        created_at=_now_iso(),
        human_review=review,
    )
