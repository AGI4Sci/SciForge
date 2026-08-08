"""Canonical, reference-first RO-Crate exchange for immutable Evidence Snapshots.

The crate is deliberately a projection of one committed ``EvidenceSnapshot``.
It does not create a second ingest path: import reconstructs a ``ThreadGraph``
and verifies its canonical Evidence digest before returning it to the caller.
Scientific files remain references; the Artifact Registry decides retention.
"""
from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TypeVar
from urllib.parse import quote

from .graph import ThreadGraph
from .model import (
    Artifact,
    ArtifactVersion,
    Assessment,
    Edge,
    EdgeRel,
    Node,
    NodeType,
    SourceAnchor,
    make_edge_id,
    make_node_id,
)
from .snapshot import EvidenceSnapshot, compute_snapshot_digest


RO_CRATE_CONTEXT = "https://w3id.org/ro/crate/1.1/context"
RO_CRATE_PROFILE = "https://w3id.org/ro/crate/1.1"
EDAG_NAMESPACE = "https://sciforge.ai/ns/evidence-dag#"
CRATE_SCHEMA_VERSION = "sciforge-ro-crate.v1"
METADATA_FILE = "ro-crate-metadata.json"

_CONTEXT: list[Any] = [
    RO_CRATE_CONTEXT,
    {
        "prov": "http://www.w3.org/ns/prov#",
        "edag": EDAG_NAMESPACE,
        "edagRecord": {"@id": "edag:record", "@type": "@json"},
        "edagGraphMeta": {"@id": "edag:graphMeta", "@type": "@json"},
        "edagOrder": {"@id": "edag:order", "@type": "@json"},
        "edagSnapshot": {"@id": "edag:snapshot", "@type": "@id"},
        "edagSchemaVersion": "edag:schemaVersion",
        "edagThreadId": "edag:threadId",
        "edagIdentifier": "edag:identifier",
        "edagNodeType": "edag:nodeType",
        "edagArtifact": {"@id": "edag:artifact", "@type": "@id"},
        "edagArtifactVersion": {"@id": "edag:artifactVersion", "@type": "@id"},
        "edagSourceAnchor": {"@id": "edag:sourceAnchor", "@type": "@id"},
        "edagCurrentVersion": {"@id": "edag:currentVersion", "@type": "@id"},
        "edagAvailability": "edag:availability",
        "edagRetention": "edag:retention",
        "edagSelector": {"@id": "edag:selector", "@type": "@json"},
        "edagAnchorDigest": "edag:anchorDigest",
    },
]

_RUN_TYPES = frozenset({
    NodeType.EXPERIMENT_RUN,
    NodeType.ANALYSIS_RUN,
    NodeType.WORKFLOW_RUN,
    NodeType.TOOL_INVOCATION,
})


@dataclass(frozen=True)
class ImportedRoCrate:
    """A verified graph and the immutable snapshot identity it represents."""

    graph: ThreadGraph
    snapshot: EvidenceSnapshot


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _iri(kind: str, identifier: str) -> str:
    return f"urn:sciforge:ro-crate:{kind}:{quote(identifier, safe='')}"


def _ref(identifier: str) -> dict[str, str]:
    return {"@id": identifier}


def _types(value: Any) -> set[str]:
    if isinstance(value, str):
        return {value}
    if isinstance(value, list) and all(isinstance(item, str) for item in value):
        return set(value)
    return set()


def _node_ro_types(node: Node) -> list[str]:
    if node.type in _RUN_TYPES:
        return ["Action", "prov:Activity", "edag:EvidenceNode"]
    if node.type == NodeType.AGENT:
        return ["prov:Agent", "edag:EvidenceNode"]
    if node.type == NodeType.DATASET_VERSION:
        return ["Dataset", "prov:Entity", "edag:EvidenceNode"]
    if node.type == NodeType.SOFTWARE_VERSION:
        return ["SoftwareSourceCode", "prov:Entity", "edag:EvidenceNode"]
    return ["CreativeWork", "prov:Entity", "edag:EvidenceNode"]


def _version_ro_type(kind: str) -> str:
    if kind == "dataset":
        return "Dataset"
    if kind in {"code", "notebook"}:
        return "SoftwareSourceCode"
    return "File"


def _append_ref(record: dict[str, Any], property_name: str, target: str) -> None:
    values = record.setdefault(property_name, [])
    reference = _ref(target)
    if reference not in values:
        values.append(reference)


def _edge_prov_record(edge: Edge, node_iris: dict[str, str]) -> dict[str, Any]:
    src = node_iris[edge.src]
    dst = node_iris[edge.dst]
    common = {
        "@id": _iri("edge", edge.id),
        "edagIdentifier": edge.id,
        "edagRecord": edge.to_dict(),
    }
    if edge.rel == EdgeRel.USED:
        return {
            **common, "@type": ["prov:Usage", "edag:EvidenceEdge"],
            "prov:activity": _ref(src), "prov:entity": _ref(dst),
        }
    if edge.rel == EdgeRel.RERUN_OF:
        return {
            **common, "@type": ["prov:Communication", "edag:EvidenceEdge"],
            "prov:informed": _ref(src), "prov:informant": _ref(dst),
        }
    if edge.rel == EdgeRel.GENERATED_BY:
        return {
            **common, "@type": ["prov:Generation", "edag:EvidenceEdge"],
            "prov:entity": _ref(src), "prov:activity": _ref(dst),
        }
    if edge.rel == EdgeRel.DERIVED_FROM:
        return {
            **common, "@type": ["prov:Derivation", "edag:EvidenceEdge"],
            "prov:generatedEntity": _ref(src), "prov:usedEntity": _ref(dst),
        }
    if edge.rel == EdgeRel.ASSOCIATED_WITH:
        return {
            **common, "@type": ["prov:Association", "edag:EvidenceEdge"],
            "prov:activity": _ref(src), "prov:agent": _ref(dst),
        }
    if edge.rel == EdgeRel.ATTRIBUTED_TO:
        return {
            **common, "@type": ["prov:Attribution", "edag:EvidenceEdge"],
            "prov:entity": _ref(src), "prov:agent": _ref(dst),
        }
    return {
        **common, "@type": ["prov:Influence", "edag:EvidenceEdge"],
        "prov:influencer": _ref(src), "prov:influencee": _ref(dst),
    }


def _add_direct_prov_relation(
    edge: Edge, node_records: dict[str, dict[str, Any]], node_iris: dict[str, str],
) -> None:
    src = node_iris[edge.src]
    dst = node_iris[edge.dst]
    if edge.rel == EdgeRel.USED:
        _append_ref(node_records[edge.src], "prov:used", dst)
    elif edge.rel == EdgeRel.RERUN_OF:
        _append_ref(node_records[edge.src], "prov:wasInformedBy", dst)
    elif edge.rel == EdgeRel.GENERATED_BY:
        _append_ref(node_records[edge.src], "prov:wasGeneratedBy", dst)
    elif edge.rel == EdgeRel.DERIVED_FROM:
        _append_ref(node_records[edge.src], "prov:wasDerivedFrom", dst)
    elif edge.rel == EdgeRel.ASSOCIATED_WITH:
        _append_ref(node_records[edge.src], "prov:wasAssociatedWith", dst)
    elif edge.rel == EdgeRel.ATTRIBUTED_TO:
        _append_ref(node_records[edge.src], "prov:wasAttributedTo", dst)
    else:
        _append_ref(node_records[edge.dst], "prov:wasInfluencedBy", src)


def _referenced_artifact_digests(graph: ThreadGraph) -> tuple[str, ...]:
    version_ids = {
        node.artifact_version_id for node in graph.nodes.values() if node.artifact_version_id
    }
    return tuple(sorted({
        graph.artifact_versions[version_id].content_digest
        for version_id in version_ids
        if version_id in graph.artifact_versions
        and graph.artifact_versions[version_id].content_digest
    }))


def _validate_graph_references(graph: ThreadGraph) -> None:
    """Enforce current graph invariants without mutating the imported graph."""
    validation_graph = ThreadGraph(graph.thread_id)
    validation_graph.nodes = dict(graph.nodes)
    for node in graph.nodes.values():
        legacy_scope = (
            node.artifact_id if node.type == NodeType.SOURCE_ASSERTION and node.artifact_id
            else node.external_id
        )
        identity_scopes = {legacy_scope}
        if node.external_id and node.artifact_version_id:
            identity_scopes.add(
                f"{node.external_id}|artifact-version:{node.artifact_version_id}"
            )
        content_digest = node.attributes.get("contentDigest")
        if node.external_id and isinstance(content_digest, str) \
                and len(content_digest) == 71 and content_digest.startswith("sha256:") \
                and all(char in "0123456789abcdef" for char in content_digest[7:]):
            identity_scopes.add(f"{node.external_id}|content:{content_digest}")
        if node.id not in {
            make_node_id(node.type, node.content, scope) for scope in identity_scopes
        }:
            raise ValueError(f"RO-Crate node identity is not canonical: {node.id}")
    for edge in graph.edges.values():
        if edge.src not in graph.nodes or edge.dst not in graph.nodes:
            raise ValueError(f"RO-Crate edge has dangling endpoint: {edge.id}")
        if edge.id != make_edge_id(edge.src, edge.dst, edge.rel):
            raise ValueError(f"RO-Crate edge identity is not canonical: {edge.id}")
        accepted = validation_graph.add_edge(
            edge.src, edge.dst, edge.rel, nli_score=edge.nli_score, created_at=edge.created_at,
        )
        if accepted is None:
            raise ValueError(f"RO-Crate edge violates graph constraints: {edge.id}")

    for artifact in graph.artifacts.values():
        current = graph.artifact_versions.get(artifact.current_version_id)
        if current is None or current.artifact_id != artifact.artifact_id:
            raise ValueError(f"RO-Crate Artifact current version is invalid: {artifact.artifact_id}")
    for version in graph.artifact_versions.values():
        if version.artifact_id not in graph.artifacts:
            raise ValueError(f"RO-Crate ArtifactVersion has no Artifact: {version.version_id}")
        if version.supersedes is not None:
            previous = graph.artifact_versions.get(version.supersedes)
            if previous is None or previous.artifact_id != version.artifact_id:
                raise ValueError(
                    f"RO-Crate ArtifactVersion supersedes invalid version: {version.version_id}"
                )
    for artifact in graph.artifacts.values():
        visited: set[str] = set()
        current_id: str | None = artifact.current_version_id
        while current_id is not None:
            if current_id in visited:
                raise ValueError(f"RO-Crate ArtifactVersion history is cyclic: {artifact.artifact_id}")
            visited.add(current_id)
            current_id = graph.artifact_versions[current_id].supersedes
    for anchor in graph.source_anchors.values():
        version = graph.artifact_versions.get(anchor.artifact_version_id)
        if version is None or version.artifact_id != anchor.artifact_id:
            raise ValueError(f"RO-Crate SourceAnchor version is invalid: {anchor.anchor_id}")
    for node in graph.nodes.values():
        if node.artifact_id is not None and node.artifact_id not in graph.artifacts:
            raise ValueError(f"RO-Crate node references unknown Artifact: {node.id}")
        if node.artifact_version_id is not None:
            version = graph.artifact_versions.get(node.artifact_version_id)
            if version is None or version.artifact_id != node.artifact_id:
                raise ValueError(f"RO-Crate node references invalid ArtifactVersion: {node.id}")
        if node.source_anchor_id is not None:
            anchor = graph.source_anchors.get(node.source_anchor_id)
            if (
                anchor is None
                or anchor.artifact_id != node.artifact_id
                or anchor.artifact_version_id != node.artifact_version_id
            ):
                raise ValueError(f"RO-Crate node references invalid SourceAnchor: {node.id}")
    assessment_ids = [item.assessment_id for item in graph.assessments]
    if len(assessment_ids) != len(set(assessment_ids)):
        raise ValueError("RO-Crate graph contains duplicate Assessment ids")


def _validate_snapshot(graph: ThreadGraph, snapshot: EvidenceSnapshot) -> None:
    _validate_graph_references(graph)
    if graph.thread_id != snapshot.thread_id:
        raise ValueError("RO-Crate graph threadId does not match Evidence Snapshot")
    embedded = (graph.meta or {}).get("snapshot")
    if embedded is not None:
        if EvidenceSnapshot.from_dict(embedded).to_dict() != snapshot.to_dict():
            raise ValueError("RO-Crate graph metadata contains a different Evidence Snapshot")
    if _referenced_artifact_digests(graph) != snapshot.artifact_digests:
        raise ValueError("Evidence Snapshot artifact digests do not match graph references")
    computed = compute_snapshot_digest(
        graph,
        input_watermark=snapshot.input_watermark,
        schema_version=snapshot.schema_version,
        extractor_version=snapshot.extractor_version,
        verifier_version=snapshot.verifier_version,
    )
    if computed != snapshot.digest:
        raise ValueError("Evidence Snapshot digest does not match RO-Crate graph")


def export_ro_crate(
    graph: ThreadGraph,
    snapshot: EvidenceSnapshot,
    *,
    name: str | None = None,
    description: str | None = None,
) -> dict[str, Any]:
    """Export one exact committed Evidence Snapshot as reference-first RO-Crate JSON-LD."""
    _validate_snapshot(graph, snapshot)

    snapshot_iri = _iri("snapshot", snapshot.digest)
    node_iris = {node_id: _iri("node", node_id) for node_id in graph.nodes}
    artifact_iris = {
        artifact_id: _iri("artifact", artifact_id) for artifact_id in graph.artifacts
    }
    version_iris = {
        version_id: _iri("artifact-version", version_id)
        for version_id in graph.artifact_versions
    }
    anchor_iris = {
        anchor_id: _iri("source-anchor", anchor_id) for anchor_id in graph.source_anchors
    }

    node_records: dict[str, dict[str, Any]] = {}
    for node in graph.nodes.values():
        record: dict[str, Any] = {
            "@id": node_iris[node.id],
            "@type": _node_ro_types(node),
            "name": node.content,
            "identifier": node.external_id or node.id,
            "edagIdentifier": node.id,
            "edagNodeType": node.type.value,
            "edagRecord": node.to_dict(),
        }
        if node.created_at:
            record["dateCreated"] = node.created_at
        if node.artifact_id in artifact_iris:
            record["edagArtifact"] = _ref(artifact_iris[node.artifact_id])
        if node.artifact_version_id in version_iris:
            record["edagArtifactVersion"] = _ref(version_iris[node.artifact_version_id])
        if node.source_anchor_id in anchor_iris:
            record["edagSourceAnchor"] = _ref(anchor_iris[node.source_anchor_id])
        node_records[node.id] = record

    edge_records: list[dict[str, Any]] = []
    for edge in graph.edges.values():
        edge_records.append(_edge_prov_record(edge, node_iris))
        _add_direct_prov_relation(edge, node_records, node_iris)

    artifact_records: list[dict[str, Any]] = []
    for artifact in graph.artifacts.values():
        versions = [
            version for version in graph.artifact_versions.values()
            if version.artifact_id == artifact.artifact_id
        ]
        artifact_records.append({
            "@id": artifact_iris[artifact.artifact_id],
            "@type": ["CreativeWork", "prov:Entity", "edag:Artifact"],
            "name": artifact.artifact_id,
            "identifier": artifact.artifact_id,
            "additionalType": f"edag:{artifact.kind}",
            "hasPart": [_ref(version_iris[item.version_id]) for item in versions],
            "edagCurrentVersion": _ref(version_iris[artifact.current_version_id]),
            "edagRecord": artifact.to_dict(),
        })

    version_records: list[dict[str, Any]] = []
    for version in graph.artifact_versions.values():
        artifact = graph.artifacts.get(version.artifact_id)
        if artifact is None:
            raise ValueError(f"ArtifactVersion references unknown Artifact: {version.version_id}")
        record: dict[str, Any] = {
            "@id": version_iris[version.version_id],
            "@type": [_version_ro_type(artifact.kind), "prov:Entity", "edag:ArtifactVersion"],
            "name": version.locator,
            "identifier": version.locator,
            "contentUrl": version.locator,
            "isPartOf": _ref(artifact_iris[version.artifact_id]),
            "prov:specializationOf": _ref(artifact_iris[version.artifact_id]),
            "edagIdentifier": version.version_id,
            "edagAvailability": version.availability,
            "edagRetention": version.retention,
            "edagRecord": version.to_dict(),
        }
        if version.content_digest:
            record["sha256"] = version.content_digest.removeprefix("sha256:")
        if version.version:
            record["version"] = version.version
        if version.size is not None:
            record["contentSize"] = str(version.size)
        if version.media_type:
            record["encodingFormat"] = version.media_type
        if version.supersedes:
            record["prov:wasRevisionOf"] = _ref(version_iris[version.supersedes])
        version_records.append(record)

    anchor_records: list[dict[str, Any]] = []
    for anchor in graph.source_anchors.values():
        anchor_records.append({
            "@id": anchor_iris[anchor.anchor_id],
            "@type": ["CreativeWork", "prov:Entity", "edag:SourceAnchor"],
            "name": f"Source anchor {anchor.anchor_id}",
            "identifier": anchor.anchor_id,
            "about": _ref(version_iris[anchor.artifact_version_id]),
            "prov:specializationOf": _ref(version_iris[anchor.artifact_version_id]),
            "edagArtifact": _ref(artifact_iris[anchor.artifact_id]),
            "edagSelector": anchor.selector.to_dict(),
            "edagAnchorDigest": anchor.anchor_digest,
            "edagRecord": anchor.to_dict(),
        })

    assessment_records: list[dict[str, Any]] = []
    target_iris = {
        **node_iris,
        **{edge_id: _iri("edge", edge_id) for edge_id in graph.edges},
        **artifact_iris,
        **version_iris,
        **anchor_iris,
    }
    for assessment in graph.assessments:
        record: dict[str, Any] = {
            "@id": _iri("assessment", assessment.assessment_id),
            "@type": ["Review", "edag:Assessment"],
            "identifier": assessment.assessment_id,
            "edagRecord": assessment.to_dict(),
        }
        if assessment.target_id in target_iris:
            record["about"] = _ref(target_iris[assessment.target_id])
        assessment_records.append(record)

    order = {
        "nodes": list(graph.nodes),
        "edges": list(graph.edges),
        "artifacts": list(graph.artifacts),
        "artifactVersions": list(graph.artifact_versions),
        "sourceAnchors": list(graph.source_anchors),
        "assessments": [item.assessment_id for item in graph.assessments],
    }
    parts = [
        *node_records.values(), *edge_records, *artifact_records, *version_records,
        *anchor_records, *assessment_records,
    ]
    part_refs = [_ref(item["@id"]) for item in parts]
    root: dict[str, Any] = {
        "@id": "./",
        "@type": "Dataset",
        "name": name or f"SciForge Evidence Snapshot {snapshot.version}",
        "description": description or "Immutable, reference-first SciForge Evidence DAG exchange",
        "identifier": snapshot.digest,
        "datePublished": snapshot.created_at,
        "hasPart": [_ref(snapshot_iri), *part_refs],
        "edagSchemaVersion": CRATE_SCHEMA_VERSION,
        "edagThreadId": graph.thread_id,
        "edagSnapshot": _ref(snapshot_iri),
        "edagGraphMeta": json.loads(_canonical_json(graph.meta)),
        "edagOrder": order,
    }
    snapshot_record = {
        "@id": snapshot_iri,
        "@type": ["CreativeWork", "prov:Entity", "edag:EvidenceSnapshot"],
        "name": f"Evidence Snapshot {snapshot.version}",
        "identifier": snapshot.digest,
        "dateCreated": snapshot.created_at,
        "about": _ref("./"),
        "edagRecord": snapshot.to_dict(),
    }
    return {
        "@context": json.loads(_canonical_json(_CONTEXT)),
        "@graph": [
            {
                "@id": METADATA_FILE,
                "@type": "CreativeWork",
                "about": _ref("./"),
                "conformsTo": _ref(RO_CRATE_PROFILE),
            },
            root,
            snapshot_record,
            *parts,
        ],
    }


def dumps_ro_crate(
    graph: ThreadGraph,
    snapshot: EvidenceSnapshot,
    *,
    name: str | None = None,
    description: str | None = None,
    indent: int = 2,
) -> str:
    return json.dumps(
        export_ro_crate(graph, snapshot, name=name, description=description),
        ensure_ascii=False, indent=indent,
    )


def _require_ref(value: Any, expected: str, field: str) -> None:
    if not isinstance(value, dict) or value.get("@id") != expected:
        raise ValueError(f"invalid RO-Crate {field} reference")


def _require_prov_shape(
    edge: Edge, record: dict[str, Any], node_iris: dict[str, str],
) -> None:
    src = node_iris[edge.src]
    dst = node_iris[edge.dst]
    if edge.rel == EdgeRel.USED:
        _require_ref(record.get("prov:activity"), src, "prov:activity")
        _require_ref(record.get("prov:entity"), dst, "prov:entity")
    elif edge.rel == EdgeRel.RERUN_OF:
        _require_ref(record.get("prov:informed"), src, "prov:informed")
        _require_ref(record.get("prov:informant"), dst, "prov:informant")
    elif edge.rel == EdgeRel.GENERATED_BY:
        _require_ref(record.get("prov:entity"), src, "prov:entity")
        _require_ref(record.get("prov:activity"), dst, "prov:activity")
    elif edge.rel == EdgeRel.DERIVED_FROM:
        _require_ref(record.get("prov:generatedEntity"), src, "prov:generatedEntity")
        _require_ref(record.get("prov:usedEntity"), dst, "prov:usedEntity")
    elif edge.rel == EdgeRel.ASSOCIATED_WITH:
        _require_ref(record.get("prov:activity"), src, "prov:activity")
        _require_ref(record.get("prov:agent"), dst, "prov:agent")
    elif edge.rel == EdgeRel.ATTRIBUTED_TO:
        _require_ref(record.get("prov:entity"), src, "prov:entity")
        _require_ref(record.get("prov:agent"), dst, "prov:agent")
    else:
        _require_ref(record.get("prov:influencer"), src, "prov:influencer")
        _require_ref(record.get("prov:influencee"), dst, "prov:influencee")


T = TypeVar("T")


def _ordered_records(
    records: dict[str, T], order: Any, *, label: str,
) -> list[T]:
    if not isinstance(order, list) or not all(isinstance(item, str) for item in order):
        raise ValueError(f"invalid RO-Crate {label} order")
    if len(order) != len(set(order)) or set(order) != set(records):
        raise ValueError(f"RO-Crate {label} order does not match records")
    return [records[item] for item in order]


def _entity_index(document: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    raw_graph = document.get("@graph")
    if not isinstance(raw_graph, list) or not all(isinstance(item, dict) for item in raw_graph):
        raise ValueError("RO-Crate @graph must be an array of objects")
    indexed: dict[str, dict[str, Any]] = {}
    for record in raw_graph:
        identifier = record.get("@id")
        if not isinstance(identifier, str) or not identifier:
            raise ValueError("every RO-Crate entity requires @id")
        if identifier in indexed:
            raise ValueError(f"duplicate RO-Crate entity @id: {identifier}")
        indexed[identifier] = record
    return raw_graph, indexed


def import_ro_crate(
    document: dict[str, Any], *, expected_snapshot_digest: str | None = None,
) -> ImportedRoCrate:
    """Import the canonical crate and reject any graph/snapshot identity mismatch."""
    if not isinstance(document, dict):
        raise ValueError("RO-Crate document must be an object")
    context = document.get("@context")
    contexts = context if isinstance(context, list) else [context]
    if RO_CRATE_CONTEXT not in contexts:
        raise ValueError("unsupported RO-Crate context")
    raw_graph, indexed = _entity_index(document)
    metadata = indexed.get(METADATA_FILE)
    root = indexed.get("./")
    if metadata is None or root is None:
        raise ValueError("RO-Crate metadata and root Dataset are required")
    _require_ref(metadata.get("about"), "./", "metadata about")
    _require_ref(metadata.get("conformsTo"), RO_CRATE_PROFILE, "profile")
    if "Dataset" not in _types(root.get("@type")):
        raise ValueError("RO-Crate root must be a Dataset")
    if root.get("edagSchemaVersion") != CRATE_SCHEMA_VERSION:
        raise ValueError("unsupported SciForge RO-Crate schema")
    thread_id = root.get("edagThreadId")
    if not isinstance(thread_id, str) or not thread_id:
        raise ValueError("RO-Crate root requires edagThreadId")
    snapshot_ref = root.get("edagSnapshot")
    if not isinstance(snapshot_ref, dict) or not isinstance(snapshot_ref.get("@id"), str):
        raise ValueError("RO-Crate root requires immutable snapshot reference")
    snapshot_entity = indexed.get(snapshot_ref["@id"])
    if snapshot_entity is None or "edag:EvidenceSnapshot" not in _types(snapshot_entity.get("@type")):
        raise ValueError("RO-Crate Evidence Snapshot entity is missing")
    snapshot_raw = snapshot_entity.get("edagRecord")
    if not isinstance(snapshot_raw, dict):
        raise ValueError("RO-Crate Evidence Snapshot record is missing")
    snapshot = EvidenceSnapshot.from_dict(snapshot_raw)
    if snapshot.thread_id != thread_id:
        raise ValueError("RO-Crate threadId does not match Evidence Snapshot")
    if snapshot_entity["@id"] != _iri("snapshot", snapshot.digest):
        raise ValueError("RO-Crate Evidence Snapshot identity mismatch")
    _require_ref(snapshot_entity.get("about"), "./", "snapshot about")
    if snapshot_entity.get("identifier") != snapshot.digest or root.get("identifier") != snapshot.digest:
        raise ValueError("RO-Crate snapshot digest identifiers disagree")
    if expected_snapshot_digest is not None and snapshot.digest != expected_snapshot_digest:
        raise ValueError("RO-Crate does not contain the requested Evidence Snapshot")

    raw_parts = root.get("hasPart")
    if not isinstance(raw_parts, list) or not all(
        isinstance(item, dict) and isinstance(item.get("@id"), str)
        for item in raw_parts
    ):
        raise ValueError("RO-Crate root hasPart must contain entity references")
    part_list = [item["@id"] for item in raw_parts]
    if len(part_list) != len(set(part_list)):
        raise ValueError("RO-Crate root contains duplicate hasPart references")
    part_ids = set(part_list)
    if snapshot_ref["@id"] not in part_ids:
        raise ValueError("RO-Crate root does not contain its Evidence Snapshot")

    nodes: dict[str, Node] = {}
    edges: dict[str, Edge] = {}
    artifacts: dict[str, Artifact] = {}
    versions: dict[str, ArtifactVersion] = {}
    anchors: dict[str, SourceAnchor] = {}
    assessments: dict[str, Assessment] = {}
    entity_by_canonical: dict[tuple[str, str], dict[str, Any]] = {}

    def require_record(entity: dict[str, Any], type_name: str) -> dict[str, Any]:
        if entity["@id"] not in part_ids:
            raise ValueError(f"RO-Crate root does not contain {type_name} record")
        raw = entity.get("edagRecord")
        if not isinstance(raw, dict):
            raise ValueError(f"RO-Crate {type_name} record is missing")
        return raw

    for entity in raw_graph:
        entity_types = _types(entity.get("@type"))
        if "edag:EvidenceNode" in entity_types:
            raw = require_record(entity, "EvidenceNode")
            node = Node.from_dict(raw)
            if entity.get("edagIdentifier") != node.id or entity["@id"] != _iri("node", node.id):
                raise ValueError("RO-Crate EvidenceNode identity mismatch")
            required_prov_type = (
                "prov:Activity" if node.type in _RUN_TYPES else
                "prov:Agent" if node.type == NodeType.AGENT else "prov:Entity"
            )
            if required_prov_type not in entity_types:
                raise ValueError("RO-Crate EvidenceNode has incorrect PROV type")
            if node.id in nodes:
                raise ValueError(f"duplicate EvidenceNode id: {node.id}")
            nodes[node.id] = node
            entity_by_canonical[("node", node.id)] = entity
        elif "edag:EvidenceEdge" in entity_types:
            raw = require_record(entity, "EvidenceEdge")
            edge = Edge.from_dict(raw)
            if entity.get("edagIdentifier") != edge.id or entity["@id"] != _iri("edge", edge.id):
                raise ValueError("RO-Crate EvidenceEdge identity mismatch")
            if edge.id in edges:
                raise ValueError(f"duplicate EvidenceEdge id: {edge.id}")
            edges[edge.id] = edge
            entity_by_canonical[("edge", edge.id)] = entity
        elif "edag:ArtifactVersion" in entity_types:
            raw = require_record(entity, "ArtifactVersion")
            version = ArtifactVersion.from_dict(raw)
            if entity.get("edagIdentifier") != version.version_id or entity["@id"] != _iri(
                "artifact-version", version.version_id,
            ):
                raise ValueError("RO-Crate ArtifactVersion identity mismatch")
            if version.version_id in versions:
                raise ValueError(f"duplicate ArtifactVersion id: {version.version_id}")
            versions[version.version_id] = version
        elif "edag:Artifact" in entity_types:
            raw = require_record(entity, "Artifact")
            artifact = Artifact.from_dict(raw)
            if entity["@id"] != _iri("artifact", artifact.artifact_id):
                raise ValueError("RO-Crate Artifact identity mismatch")
            if artifact.artifact_id in artifacts:
                raise ValueError(f"duplicate Artifact id: {artifact.artifact_id}")
            artifacts[artifact.artifact_id] = artifact
        elif "edag:SourceAnchor" in entity_types:
            raw = require_record(entity, "SourceAnchor")
            anchor = SourceAnchor.from_dict(raw)
            if entity["@id"] != _iri("source-anchor", anchor.anchor_id):
                raise ValueError("RO-Crate SourceAnchor identity mismatch")
            if anchor.anchor_id in anchors:
                raise ValueError(f"duplicate SourceAnchor id: {anchor.anchor_id}")
            anchors[anchor.anchor_id] = anchor
        elif "edag:Assessment" in entity_types:
            raw = require_record(entity, "Assessment")
            assessment = Assessment.from_dict(raw)
            if entity["@id"] != _iri("assessment", assessment.assessment_id):
                raise ValueError("RO-Crate Assessment identity mismatch")
            if assessment.assessment_id in assessments:
                raise ValueError(f"duplicate Assessment id: {assessment.assessment_id}")
            assessments[assessment.assessment_id] = assessment

    order = root.get("edagOrder")
    if not isinstance(order, dict):
        raise ValueError("RO-Crate canonical record order is missing")
    graph_meta = root.get("edagGraphMeta")
    if not isinstance(graph_meta, dict):
        raise ValueError("RO-Crate graph metadata must be an object")
    graph = ThreadGraph(thread_id, json.loads(_canonical_json(graph_meta)))
    graph.nodes = {
        item.id: item for item in _ordered_records(nodes, order.get("nodes"), label="node")
    }
    graph.edges = {
        item.id: item for item in _ordered_records(edges, order.get("edges"), label="edge")
    }
    graph.artifacts = {
        item.artifact_id: item
        for item in _ordered_records(artifacts, order.get("artifacts"), label="Artifact")
    }
    graph.artifact_versions = {
        item.version_id: item
        for item in _ordered_records(
            versions, order.get("artifactVersions"), label="ArtifactVersion",
        )
    }
    graph.source_anchors = {
        item.anchor_id: item
        for item in _ordered_records(anchors, order.get("sourceAnchors"), label="SourceAnchor")
    }
    graph.assessments = _ordered_records(
        assessments, order.get("assessments"), label="Assessment",
    )

    _validate_snapshot(graph, snapshot)
    node_iris = {node_id: _iri("node", node_id) for node_id in graph.nodes}
    for edge in graph.edges.values():
        _require_prov_shape(edge, entity_by_canonical[("edge", edge.id)], node_iris)
    return ImportedRoCrate(graph=graph, snapshot=snapshot)


def loads_ro_crate(text: str, *, expected_snapshot_digest: str | None = None) -> ImportedRoCrate:
    try:
        document = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError("invalid RO-Crate JSON") from exc
    return import_ro_crate(document, expected_snapshot_digest=expected_snapshot_digest)


def write_ro_crate(
    directory: str | os.PathLike[str],
    graph: ThreadGraph,
    snapshot: EvidenceSnapshot,
    *,
    name: str | None = None,
    description: str | None = None,
) -> Path:
    """Write metadata into a directory without copying referenced Artifact bytes.

    Re-exporting the same crate is idempotent.  A different snapshot is never
    allowed to overwrite an existing metadata file.
    """
    target_dir = Path(directory)
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / METADATA_FILE
    text = dumps_ro_crate(graph, snapshot, name=name, description=description) + "\n"
    if target.exists():
        if target.read_text(encoding="utf-8") == text:
            return target
        raise FileExistsError(f"immutable RO-Crate already exists: {target}")
    fd, temporary = tempfile.mkstemp(prefix=f".{METADATA_FILE}.", dir=target_dir)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        # Refuse a concurrent writer rather than replacing another snapshot.
        try:
            os.link(temporary, target)
        except FileExistsError:
            if target.read_text(encoding="utf-8") != text:
                raise FileExistsError(f"immutable RO-Crate already exists: {target}")
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
    return target


def read_ro_crate(
    path: str | os.PathLike[str], *, expected_snapshot_digest: str | None = None,
) -> ImportedRoCrate:
    source = Path(path)
    if source.is_dir():
        source = source / METADATA_FILE
    if source.name != METADATA_FILE:
        raise ValueError(f"RO-Crate metadata file must be named {METADATA_FILE}")
    return loads_ro_crate(
        source.read_text(encoding="utf-8"),
        expected_snapshot_digest=expected_snapshot_digest,
    )
