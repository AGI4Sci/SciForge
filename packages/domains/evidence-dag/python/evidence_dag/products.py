"""Deterministic exports for one verified, immutable Evidence Snapshot.

Evidence owns the scientific projections in this module.  It deliberately
does not write files or create Artifact identities; the desktop runtime sends
the returned canonical bytes to the Artifact Versions domain in one atomic
commit after independently resolving every pinned source version.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Mapping
from urllib.parse import quote

from . import audit as _audit
from . import provjson
from .artifact_versions import ArtifactVersionRefV1
from .datacite import (
    DataCiteCreator,
    DataCiteDescription,
    DataCiteProject,
    DataCiteResource,
    RelatedIdentifier,
    export_datacite,
)
from .graph import ThreadGraph
from .lineage import reproducibility_report
from .model import NodeType, normalize_sha256
from .rocrate import export_ro_crate
from .snapshot import EvidenceSnapshot

PRODUCT_SCHEMA_VERSION = "sciforge-evidence-products.v1"
PRODUCT_ORDER = (
    "prov-json",
    "ro-crate",
    "datacite",
    "audit-report",
    "reproduction-report",
)


def _canonical_json(value: Any) -> str:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ) + "\n"


def _content_record(product: str, filename: str, media_type: str, value: Any) -> dict[str, Any]:
    content = _canonical_json(value)
    encoded = content.encode("utf-8")
    return {
        "product": product,
        "fileName": filename,
        "mediaType": media_type,
        "content": content,
        "contentDigest": hashlib.sha256(encoded).hexdigest(),
        "byteLength": len(encoded),
    }


def _required_text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"DataCite {field} is required")
    return value.strip()


def _datacite_resource(raw: Mapping[str, Any]) -> tuple[DataCiteResource, DataCiteProject]:
    if not isinstance(raw, Mapping):
        raise ValueError("DataCite metadata must be an object")
    allowed = {
        "doi", "title", "creators", "publisher", "publicationYear", "projectId",
        "resourceType", "language", "landingPage", "descriptions",
    }
    unexpected = set(raw) - allowed
    if unexpected:
        raise ValueError(f"unsupported DataCite metadata fields: {sorted(unexpected)}")
    creators_raw = raw.get("creators")
    if not isinstance(creators_raw, list) or not creators_raw:
        raise ValueError("DataCite creators must contain at least one explicit creator")
    creators: list[DataCiteCreator] = []
    for item in creators_raw:
        if not isinstance(item, Mapping):
            raise ValueError("DataCite creator must be an object")
        creator_allowed = {"name", "nameType", "givenName", "familyName", "orcid"}
        if set(item) - creator_allowed:
            raise ValueError("unsupported DataCite creator fields")
        creators.append(DataCiteCreator(
            name=_required_text(item.get("name"), "creator.name"),
            name_type=item.get("nameType"),
            given_name=item.get("givenName"),
            family_name=item.get("familyName"),
            orcid=item.get("orcid"),
        ))
    descriptions_raw = raw.get("descriptions") or []
    if not isinstance(descriptions_raw, list):
        raise ValueError("DataCite descriptions must be an array")
    descriptions: list[DataCiteDescription] = []
    for item in descriptions_raw:
        if not isinstance(item, Mapping) or set(item) != {"description", "descriptionType"}:
            raise ValueError("DataCite description must contain description and descriptionType")
        descriptions.append(DataCiteDescription(
            description=_required_text(item.get("description"), "description"),
            description_type=_required_text(item.get("descriptionType"), "descriptionType"),
        ))
    publication_year = raw.get("publicationYear")
    resource = DataCiteResource(
        doi=_required_text(raw.get("doi"), "DOI"),
        title=_required_text(raw.get("title"), "title"),
        creators=tuple(creators),
        publisher=_required_text(raw.get("publisher"), "publisher"),
        publication_year=publication_year,
        resource_type=raw.get("resourceType"),
        language=raw.get("language"),
        landing_page=raw.get("landingPage"),
        descriptions=tuple(descriptions),
    )
    # validate here so an invalid publication year, DOI, ORCID, URL, or
    # description never reaches a product response.
    resource.validate()
    return resource, DataCiteProject(_required_text(raw.get("projectId"), "projectId"))


def source_artifact_version_refs(graph: ThreadGraph) -> list[dict[str, Any]]:
    """Return every exact ArtifactVersionRef used by the snapshot, or fail closed."""
    referenced: set[str] = {
        node.artifact_version_id
        for node in graph.nodes.values()
        if node.artifact_version_id
    }
    referenced.update(
        anchor.artifact_version_id for anchor in graph.source_anchors.values()
    )
    for node in graph.nodes.values():
        if node.type != NodeType.SOURCE_ASSERTION:
            continue
        if not node.artifact_id or not node.artifact_version_id or not node.source_anchor_id:
            raise ValueError(f"SourceAssertion {node.id} lacks a pinned provenance tuple")
        anchor = graph.source_anchors.get(node.source_anchor_id)
        if anchor is None or (
            anchor.artifact_id != node.artifact_id
            or anchor.artifact_version_id != node.artifact_version_id
        ):
            raise ValueError(f"SourceAssertion {node.id} provenance tuple does not match")

    result: list[dict[str, Any]] = []
    for version_id in sorted(referenced):
        version = graph.artifact_versions.get(version_id)
        ref = graph.artifact_version_refs.get(version_id)
        if version is None or ref is None:
            raise ValueError(f"pinned ArtifactVersionRef is missing for {version_id}")
        artifact = graph.artifacts.get(version.artifact_id)
        if artifact is None:
            raise ValueError(f"ArtifactVersion {version_id} references a missing Artifact")
        if ref.artifact_id != version.artifact_id or ref.version_id != version.version_id:
            raise ValueError(f"ArtifactVersionRef identity mismatch for {version_id}")
        if normalize_sha256(ref.content_digest) != normalize_sha256(version.content_digest):
            raise ValueError(f"ArtifactVersionRef content digest mismatch for {version_id}")
        if ref.byte_length != version.size or ref.media_type != version.media_type:
            raise ValueError(f"ArtifactVersionRef byte or media metadata mismatch for {version_id}")
        if ref.availability != version.availability or ref.retention != version.retention:
            raise ValueError(f"ArtifactVersionRef lifecycle state mismatch for {version_id}")
        if artifact.access_policy and ref.access_policy != artifact.access_policy:
            raise ValueError(f"ArtifactVersionRef access policy mismatch for {version_id}")
        result.append(ref.to_dict())
    return result


def _audit_report(graph: ThreadGraph, snapshot: EvidenceSnapshot) -> dict[str, Any]:
    token = snapshot.digest.removeprefix("sha256:")[:24]
    report = _audit.run_audit(
        graph,
        target_digest=snapshot.digest,
        level="L0",
        trigger="manual",
        threshold=0.7,
        run_id=f"audit-export:{token}",
        started_at=snapshot.created_at,
    )
    # run_audit is also used for interactive audits and records wall-clock
    # completion.  A snapshot export must be byte-deterministic instead.
    report["completed_at"] = snapshot.created_at
    return {
        "schemaVersion": PRODUCT_SCHEMA_VERSION,
        "product": "audit-report",
        "threadId": graph.thread_id,
        "snapshotDigest": snapshot.digest,
        "bindingStatus": "generated-for-exact-snapshot",
        "stale": False,
        "audit": report,
    }


def _reproduction_report(graph: ThreadGraph, snapshot: EvidenceSnapshot) -> dict[str, Any]:
    target_types = {
        NodeType.CLAIM, NodeType.FINDING, NodeType.EXPERIMENT_RUN, NodeType.ANALYSIS_RUN,
    }
    targets = [
        reproducibility_report(graph, node_id)
        for node_id in sorted(graph.nodes)
        if graph.nodes[node_id].type in target_types
    ]
    breakpoints = [
        {"targetId": target["targetId"], **item}
        for target in targets for item in target["breakpoints"]
    ]
    if not targets:
        breakpoints.append({
            "targetId": None,
            "component": "snapshot",
            "reason": "no_reproducibility_targets",
        })
    complete = bool(targets) and all(target["complete"] for target in targets)
    return {
        "schemaVersion": PRODUCT_SCHEMA_VERSION,
        "product": "reproduction-report",
        "threadId": graph.thread_id,
        "snapshotDigest": snapshot.digest,
        "status": "complete" if complete else "incomplete",
        "complete": complete,
        "level": "L4" if complete else None,
        "targets": targets,
        "breakpoints": breakpoints,
    }


def export_snapshot_products(
    graph: ThreadGraph,
    snapshot: EvidenceSnapshot,
    datacite_metadata: Mapping[str, Any],
) -> dict[str, Any]:
    """Build five canonical JSON products for one already-verified snapshot."""
    if graph.thread_id != snapshot.thread_id:
        raise ValueError("Evidence graph and Snapshot threadId do not match")
    source_refs = source_artifact_version_refs(graph)
    resource, project = _datacite_resource(datacite_metadata)
    snapshot_urn = (
        "urn:sciforge:evidence-snapshot:"
        + quote(snapshot.digest, safe="")
    )
    datacite = export_datacite(
        resource,
        project,
        related_identifiers=(RelatedIdentifier(
            snapshot_urn, "URN", "IsMetadataFor", "Dataset",
        ),),
    )
    products = [
        _content_record(
            "prov-json", "evidence.prov.json", "application/provenance+json",
            provjson.to_prov_json(graph),
        ),
        _content_record(
            "ro-crate", "ro-crate-metadata.json", "application/ld+json",
            export_ro_crate(graph, snapshot),
        ),
        _content_record(
            "datacite", "datacite.json", "application/json", datacite,
        ),
        _content_record(
            "audit-report", "evidence-audit.json", "application/json",
            _audit_report(graph, snapshot),
        ),
        _content_record(
            "reproduction-report", "reproduction-report.json", "application/json",
            _reproduction_report(graph, snapshot),
        ),
    ]
    if tuple(item["product"] for item in products) != PRODUCT_ORDER:
        raise RuntimeError("Evidence product order is not canonical")
    return {
        "schemaVersion": PRODUCT_SCHEMA_VERSION,
        "threadId": graph.thread_id,
        "snapshotDigest": snapshot.digest,
        "sourceArtifactVersionRefs": source_refs,
        "products": products,
    }
