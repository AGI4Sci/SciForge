"""Fail-closed read projections for access-restricted Evidence records."""
from __future__ import annotations

import copy
import hashlib
import re
from typing import Any

from .graph import ThreadGraph


_RESTRICTED_LEVELS = {
    "restricted", "private", "confidential", "sensitive", "secret", "internal",
}
_PUBLIC_LEVELS = {"public", "open", "unrestricted"}
_PUBLIC_ARTIFACT_AVAILABILITY = {"available", "moved", "remote", "missing"}
_ALLOWLIST_KEYS = {
    "allowedactors", "allowedprincipals", "allowedroles", "allowlist", "principals", "roles",
}


def policy_restricted(value: Any) -> bool:
    if value is None or value == "" or value == {} or value == []:
        return False
    if isinstance(value, str):
        policy = value.strip().lower()
        return bool(policy) and policy not in _PUBLIC_LEVELS
    if not isinstance(value, dict):
        return True
    normalized_pairs = [
        ("".join(char for char in str(key).lower() if char.isalnum()), item)
        for key, item in value.items()
    ]
    normalized = dict(normalized_pairs)
    if len(normalized) != len(normalized_pairs) or "" in normalized:
        return True
    known_keys = {
        "read", "public", "authorized", "restricted", "redacted", "denied",
        "level", "visibility", "classification", "sensitivity", "accesslevel",
        *_ALLOWLIST_KEYS,
    }
    if any(key not in known_keys for key in normalized):
        return True
    # An ACL cannot be evaluated without a caller principal.  Presence alone
    # is therefore restrictive: an empty list may mean "nobody", not public.
    if any(key in normalized for key in _ALLOWLIST_KEYS):
        return True

    explicitly_public = False
    for key in ("public", "authorized"):
        if key not in normalized:
            continue
        item = normalized[key]
        if not isinstance(item, bool) or item is False:
            return True
        explicitly_public = True
    for key in ("restricted", "redacted", "denied"):
        if key not in normalized:
            continue
        item = normalized[key]
        if not isinstance(item, bool) or item is True:
            return True

    if "read" in normalized:
        read = normalized["read"]
        if isinstance(read, bool):
            if read is False:
                return True
            explicitly_public = True
        elif isinstance(read, dict):
            nested_pairs = [
                (
                    "".join(char for char in str(key).lower() if char.isalnum()),
                    item,
                )
                for key, item in read.items()
            ]
            normalized_read = dict(nested_pairs)
            if len(normalized_read) != len(nested_pairs) or "" in normalized_read:
                return True
            if any(key not in {"allowed", "granted", "authorized", "public"}
                   for key in normalized_read):
                return True
            saw_allow = False
            for item in normalized_read.values():
                if not isinstance(item, bool) or item is False:
                    return True
                saw_allow = True
            if not saw_allow:
                return True
            explicitly_public = True
        else:
            return True

    for key in ("level", "visibility", "classification", "sensitivity", "accesslevel"):
        if key not in normalized:
            continue
        item = normalized[key]
        if not isinstance(item, str):
            return True
        level = item.strip().lower()
        if level in _RESTRICTED_LEVELS:
            return True
        if level not in _PUBLIC_LEVELS:
            return True
        explicitly_public = True
    # Unknown non-empty policies are access controls, not public metadata.
    return not explicitly_public


def scope_restricted(graph: ThreadGraph) -> bool:
    raw_scope = graph.meta.get("scope")
    if raw_scope is not None and not isinstance(raw_scope, dict):
        return True
    scope = raw_scope if isinstance(raw_scope, dict) else {}
    return policy_restricted(scope.get("accessPolicy"))


def availability_restricted(value: Any) -> bool:
    """Treat malformed or future Artifact availability states as restricted.

    Availability is persisted input and older snapshots are not guaranteed to
    have passed the current registry writer.  Only the four lifecycle states
    whose disclosure contract is known are therefore public.
    """
    return not isinstance(value, str) \
        or value not in _PUBLIC_ARTIFACT_AVAILABILITY


def artifact_restricted(graph: ThreadGraph, artifact_id: str) -> bool:
    if scope_restricted(graph):
        return True
    artifact = graph.artifacts.get(artifact_id)
    if artifact is not None and policy_restricted(artifact.access_policy):
        return True
    if any(
        version.artifact_id == artifact_id
        and availability_restricted(version.availability)
        for version in graph.artifact_versions.values()
    ):
        return True
    return any(
        anchor.artifact_id == artifact_id and policy_restricted(anchor.access_policy)
        for anchor in graph.source_anchors.values()
    )


def _restricted_artifact_ids(graph: ThreadGraph) -> set[str]:
    candidates = set(graph.artifacts)
    candidates.update(version.artifact_id for version in graph.artifact_versions.values())
    candidates.update(anchor.artifact_id for anchor in graph.source_anchors.values())
    return {
        artifact_id for artifact_id in candidates
        if artifact_restricted(graph, artifact_id)
    }


def lineage_restricted(graph: ThreadGraph, lineage: dict[str, Any]) -> bool:
    if scope_restricted(graph):
        return True
    restricted_artifacts = _restricted_artifact_ids(graph)
    restricted_nodes = _restricted_node_ids(graph, restricted_artifacts)
    return any(
        isinstance(node, dict) and node.get("id") in restricted_nodes
        for node in lineage.get("nodes", [])
    )


def graph_restricted(graph: ThreadGraph) -> bool:
    """Return whether any part of a graph needs an access projection.

    Derived read models such as analysis, audit, and reconcile mix identifiers
    and prose from many graph components.  Unless a dedicated lossless
    projector exists for that model, the only safe policy is to reject the
    entire derived read when even one connected component is restricted.
    """
    return scope_restricted(graph) or bool(_restricted_artifact_ids(graph))


def require_unrestricted(graph: ThreadGraph, operation: str) -> None:
    """Fail closed for a read model that cannot be safely partially projected."""
    if graph_restricted(graph):
        raise PermissionError(f"{operation} is unavailable for restricted evidence")


def project_summary(graph: ThreadGraph) -> dict[str, Any]:
    """Keep public summaries byte-for-byte compatible; restrict identity fields."""
    summary = graph.summary()
    if not graph_restricted(graph):
        return summary
    cycles = summary.get("cycles") if isinstance(summary.get("cycles"), dict) else {}
    return {
        "node_count": summary.get("node_count", 0),
        "edge_count": summary.get("edge_count", 0),
        "nodes_by_type": copy.deepcopy(summary.get("nodes_by_type") or {}),
        "edges_by_rel": copy.deepcopy(summary.get("edges_by_rel") or {}),
        "nodes_by_status": copy.deepcopy(summary.get("nodes_by_status") or {}),
        "cycles": {
            "acyclic": cycles.get("acyclic"),
            "cycle_count": cycles.get("cycle_count", 0),
        },
        "accessRestricted": True,
    }


def project_snapshot(graph: ThreadGraph, snapshot: dict[str, Any]) -> dict[str, Any]:
    """Expose only non-identifying lifecycle facts for a restricted snapshot."""
    if not graph_restricted(graph):
        return copy.deepcopy(snapshot)
    return {
        key: copy.deepcopy(snapshot[key])
        for key in (
            "version", "schemaVersion", "extractorVersion", "verifierVersion",
            "createdAt", "status",
        )
        if key in snapshot
    } | {"accessRestricted": True}


def project_update_status(graph: ThreadGraph, status: dict[str, Any]) -> dict[str, Any]:
    """Strip reasons, errors, staging traces, watermarks, and event identities."""
    if not graph_restricted(graph):
        return copy.deepcopy(status)
    projected = {
        key: copy.deepcopy(status[key])
        for key in ("status", "nodeCount", "edgeCount", "graphState")
        if key in status
    }
    staging = status.get("staging")
    if isinstance(staging, dict) and isinstance(staging.get("status"), str):
        projected["staging"] = {"status": staging["status"], "accessRestricted": True}
    projected["accessRestricted"] = True
    return projected


def project_update_result(graph: ThreadGraph, result: dict[str, Any]) -> dict[str, Any]:
    """Project the body returned by the write command as another read surface."""
    if not graph_restricted(graph):
        return copy.deepcopy(result)
    projected: dict[str, Any] = {
        "idempotent": bool(result.get("idempotent")),
        "accessRestricted": True,
    }
    snapshot = result.get("snapshot")
    if isinstance(snapshot, dict):
        projected["snapshot"] = project_snapshot(graph, snapshot)
    delta = result.get("delta")
    if isinstance(delta, dict):
        projected["delta"] = {
            "new_node_count": len(delta.get("new_nodes") or []),
            "new_edge_count": len(delta.get("new_edges") or []),
            "accessRestricted": True,
        }
    verification = result.get("verification")
    if isinstance(verification, dict):
        projected["verification"] = {
            key: copy.deepcopy(verification[key])
            for key in (
                "threshold", "supports_edges_scored", "supports_edges_total",
                "contradicts_edges_scored", "mode", "status",
            )
            if key in verification
        }
    return projected


def project_metrics(graph: ThreadGraph, metrics: dict[str, Any]) -> dict[str, Any]:
    """Metrics are aggregate-safe, but their evidence block can contain IDs."""
    if not graph_restricted(graph):
        return copy.deepcopy(metrics)
    scalar_keys = (
        "provenance_coverage", "provenance_soundness", "audit_effort",
        "artifact_reachability", "level_2_plus_coverage", "queue_latency_ms",
        "commit_latency_ms", "audit_staleness", "provenance_break_rate",
        "reproducible_finding_rate",
    )
    projected = {
        key: copy.deepcopy(metrics[key]) for key in scalar_keys if key in metrics
    }
    transparency = metrics.get("contradiction_transparency")
    if isinstance(transparency, dict):
        projected["contradiction_transparency"] = {
            key: transparency[key]
            for key in ("ratio", "surfaced", "total") if key in transparency
        }
    evidence = metrics.get("metric_evidence")
    if isinstance(evidence, dict):
        projected["metric_evidence"] = {
            str(name): {
                key: copy.deepcopy(detail[key])
                for key in (
                    "status", "reason", "sampleCount", "mean", "numerator", "denominator",
                )
                if isinstance(detail, dict) and key in detail
            }
            for name, detail in evidence.items()
        }
    projected["accessRestricted"] = True
    return projected


def project_event(event: dict[str, Any], *, restricted: bool) -> dict[str, Any]:
    """Strict event allowlist: no aggregate, payload, correlation, or path IDs."""
    if not restricted:
        return copy.deepcopy(event)
    return {
        **{
            key: copy.deepcopy(event[key])
            for key in ("schemaVersion", "sequence", "type", "occurredAt", "persistent")
            if key in event
        },
        "accessRestricted": True,
    }


def registry_result_restricted(result: dict[str, Any]) -> bool:
    """Evaluate Artifact Registry objects with the same fail-closed policy."""
    artifacts: list[Any] = []
    versions: list[Any] = []
    anchors: list[Any] = []
    if isinstance(result.get("artifact"), dict):
        artifacts.append(result["artifact"])
    if isinstance(result.get("artifactVersion"), dict):
        versions.append(result["artifactVersion"])
    if isinstance(result.get("sourceAnchor"), dict):
        anchors.append(result["sourceAnchor"])
    artifacts.extend(result.get("artifacts") or [])
    versions.extend(result.get("versions") or result.get("artifactVersions") or [])
    anchors.extend(result.get("anchors") or result.get("sourceAnchors") or [])
    return any(
        isinstance(item, dict) and policy_restricted(item.get("accessPolicy"))
        for item in [*artifacts, *anchors]
    ) or any(
        not isinstance(item, dict)
        or availability_restricted(item.get("availability"))
        for item in versions
    )


def _project_artifact_record(item: Any) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None
    projected: dict[str, Any] = {"exists": True, "accessRestricted": True}
    for key in ("artifactId", "currentVersionId"):
        opaque = _opaque_reference(item.get(key))
        if opaque is not None:
            projected[key] = opaque
    if isinstance(item.get("kind"), str):
        projected["kind"] = item["kind"]
    return projected


def _project_version_record(item: Any) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None
    projected: dict[str, Any] = {"exists": True, "accessRestricted": True}
    for key in ("versionId", "artifactId", "supersedes"):
        opaque = _opaque_reference(item.get(key))
        if opaque is not None:
            projected[key] = opaque
    digest = item.get("contentDigest")
    if isinstance(digest, str) and re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
        projected["contentDigest"] = digest
    projected["availability"] = "restricted"
    return projected


def _project_anchor_record(item: Any) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None
    projected: dict[str, Any] = {"exists": True, "accessRestricted": True}
    for key in ("anchorId", "artifactId", "artifactVersionId"):
        opaque = _opaque_reference(item.get(key))
        if opaque is not None:
            projected[key] = opaque
    digest = item.get("anchorDigest")
    if isinstance(digest, str) and re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
        projected["anchorDigest"] = digest
    return projected


def _project_lifecycle_event(item: Any) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None
    projected: dict[str, Any] = {"accessRestricted": True}
    for key in ("type", "outcome", "availability", "occurredAt"):
        if isinstance(item.get(key), str):
            projected[key] = item[key]
    for key in ("eventId", "artifactId", "previousVersionId", "artifactVersionId"):
        opaque = _opaque_reference(item.get(key))
        if opaque is not None:
            projected[key] = opaque
    return projected


def project_registry_result(
    result: dict[str, Any], *, restricted: bool | None = None,
) -> dict[str, Any]:
    """Project register/resolve/rebind responses before returning them."""
    denied = registry_result_restricted(result) if restricted is None else restricted
    if not denied:
        return copy.deepcopy(result)
    projected: dict[str, Any] = {"accessRestricted": True}
    for key in ("outcome", "status", "resolved", "code"):
        if key in result and isinstance(result[key], (str, bool)):
            projected[key] = result[key]
    for key, projector in (
        ("artifact", _project_artifact_record),
        ("artifactVersion", _project_version_record),
        ("sourceAnchor", _project_anchor_record),
    ):
        value = projector(result.get(key))
        if value is not None:
            projected[key] = value
    for key, aliases, projector in (
        ("artifacts", ("artifacts",), _project_artifact_record),
        ("versions", ("versions", "artifactVersions"), _project_version_record),
        ("anchors", ("anchors", "sourceAnchors"), _project_anchor_record),
    ):
        source = next((result.get(alias) for alias in aliases if isinstance(result.get(alias), list)), None)
        if source is not None:
            projected[key] = [
                value for value in (projector(item) for item in source) if value is not None
            ]
    for key in ("event", "events"):
        source = result.get(key)
        if key == "event" and source is not None:
            projected[key] = _project_lifecycle_event(source)
        elif isinstance(source, list):
            projected[key] = [
                value for value in (_project_lifecycle_event(item) for item in source)
                if value is not None
            ]
    domain_event = result.get("domainEvent")
    if isinstance(domain_event, dict):
        projected["domainEvent"] = project_event(domain_event, restricted=True)
    domain_events = result.get("domainEvents")
    if isinstance(domain_events, list):
        projected["domainEvents"] = [
            project_event(item, restricted=True) for item in domain_events
            if isinstance(item, dict)
        ]
    if isinstance(result.get("affectedThreads"), list):
        projected["affectedThreadCount"] = len(result["affectedThreads"])
    return projected


def project_graph(graph: ThreadGraph) -> dict[str, Any]:
    result = copy.deepcopy(graph.to_dict())
    restrict_all = scope_restricted(graph)
    restricted_ids = _restricted_artifact_ids(graph)
    restricted_nodes = _restricted_node_ids(graph, restricted_ids)
    restricted_targets = _restricted_target_ids(graph, restricted_nodes)
    if restrict_all or restricted_ids:
        result["thread_id"] = _opaque_reference(result.get("thread_id"))
    _redact_scope(result.get("meta"), force=bool(restrict_all or restricted_ids))
    _redact_registry(result.get("artifact_registry"), restricted_ids)
    _redact_nodes(result.get("nodes"), restricted_nodes)
    _redact_edges(result.get("edges"), restricted_nodes)
    restricted_assessments = _redact_assessments(
        result.get("assessments"), restricted_targets, restrict_all=restrict_all,
    )
    _redact_human_review(
        result.get("humanReview"), restricted_targets, restricted_assessments,
        restrict_all=restrict_all,
    )
    return result


def project_lineage(graph: ThreadGraph, lineage: dict[str, Any]) -> dict[str, Any]:
    restricted_lineage = lineage_restricted(graph, lineage)
    result = copy.deepcopy(lineage)
    restrict_all = scope_restricted(graph)
    restricted_ids = _restricted_artifact_ids(graph)
    restricted_nodes = _restricted_node_ids(graph, restricted_ids)
    restricted_targets = _restricted_target_ids(graph, restricted_nodes)
    _redact_registry(result.get("artifactRegistry"), restricted_ids)
    _redact_nodes(result.get("nodes"), restricted_nodes)
    _redact_assessments(
        result.get("assessments"), restricted_targets, restrict_all=restrict_all,
    )
    attempts = result.get("attemptHistory")
    if isinstance(attempts, dict):
        _redact_nodes(attempts.get("nodes"), restricted_nodes)
    if restricted_lineage:
        return _restricted_lineage_shape(result)
    return result


def project_prov_json(graph: ThreadGraph, document: dict[str, Any]) -> dict[str, Any]:
    result = copy.deepcopy(document)
    restrict_all = scope_restricted(graph)
    restricted_ids = _restricted_artifact_ids(graph)
    restricted_nodes = _restricted_node_ids(graph, restricted_ids)
    restricted_targets = _restricted_target_ids(graph, restricted_nodes)
    _redact_scope(result.get("edag:meta"), force=bool(restrict_all or restricted_ids))
    _redact_registry(result.get("edag:artifactRegistry"), restricted_ids)
    for section in ("entity", "activity", "agent"):
        values = result.get(section)
        if not isinstance(values, dict):
            continue
        projected_values: dict[str, Any] = {}
        for node_id, node in values.items():
            if not isinstance(node, dict) or node_id not in restricted_nodes:
                projected_values[node_id] = node
                continue
            node_type = node.get("prov:type")
            status = node.get("edag:status")
            node.clear()
            if isinstance(node_type, str):
                node["prov:type"] = node_type
            node["edag:content"] = "[restricted evidence]"
            if isinstance(status, str):
                node["edag:status"] = status
            node["edag:attributes"] = {"accessRestricted": True}
            projected_values[_opaque_reference(node_id) or node_id] = node
        result[section] = projected_values
    restricted_edges = {
        edge.id for edge in graph.edges.values()
        if edge.src in restricted_nodes or edge.dst in restricted_nodes
    }
    _redact_prov_relations(result, restricted_edges)
    order = result.get("edag:order")
    if isinstance(order, dict):
        if isinstance(order.get("nodes"), list):
            order["nodes"] = [
                _opaque_reference(item) or item if item in restricted_nodes else item
                for item in order["nodes"]
            ]
        if isinstance(order.get("edges"), list):
            order["edges"] = [
                _opaque_reference(item) or item if item in restricted_edges else item
                for item in order["edges"]
            ]
    restricted_assessments = _redact_assessments(
        result.get("edag:assessments"), restricted_targets,
        restrict_all=restrict_all,
    )
    _redact_human_review(
        result.get("edag:humanReview"), restricted_targets,
        restricted_assessments, restrict_all=restrict_all,
    )
    return result


def _restricted_node_ids(
    graph: ThreadGraph, restricted_artifact_ids: set[str],
) -> set[str]:
    if scope_restricted(graph):
        return set(graph.nodes)
    restricted = {
        node.id for node in graph.nodes.values()
        if node.artifact_id in restricted_artifact_ids
    }
    # Any value connected to a restricted Artifact can carry a derived secret
    # (conclusion text, activity command, parameter, environment, selector).
    # Project the entire undirected lineage component before serialization.
    adjacency: dict[str, set[str]] = {}
    for edge in graph.edges.values():
        adjacency.setdefault(edge.src, set()).add(edge.dst)
        adjacency.setdefault(edge.dst, set()).add(edge.src)
    pending = list(restricted)
    while pending:
        current = pending.pop()
        for neighbor in adjacency.get(current, ()):
            if neighbor not in restricted:
                restricted.add(neighbor)
                pending.append(neighbor)
    return restricted


def _restricted_target_ids(
    graph: ThreadGraph, restricted_node_ids: set[str],
) -> set[str]:
    """Return node and edge assessment targets in a restricted component."""
    restricted = set(restricted_node_ids)
    restricted.update(
        edge.id for edge in graph.edges.values()
        if edge.src in restricted_node_ids or edge.dst in restricted_node_ids
    )
    return restricted


def _redact_scope(meta: Any, *, force: bool = False) -> None:
    if not isinstance(meta, dict):
        return
    scope = meta.get("scope")
    if not force and (
        not isinstance(scope, dict) or not policy_restricted(scope.get("accessPolicy"))
    ):
        return
    snapshot = meta.get("snapshot") if isinstance(meta.get("snapshot"), dict) else None
    projected: dict[str, Any] = {
        "scope": {"accessPolicy": {"restricted": True, "redacted": True}},
        "accessRestricted": True,
    }
    if snapshot is not None:
        projected["snapshot"] = {
            key: copy.deepcopy(snapshot[key])
            for key in (
                "version", "schemaVersion", "extractorVersion", "verifierVersion",
                "createdAt", "status",
            )
            if key in snapshot
        } | {"accessRestricted": True}
    meta.clear()
    meta.update(projected)


def _redact_registry(registry: Any, restricted_ids: set[str]) -> None:
    if not isinstance(registry, dict):
        return
    for key, projector in (
        ("artifacts", _project_artifact_record),
        ("artifactVersions", _project_version_record),
        ("sourceAnchors", _project_anchor_record),
    ):
        values = registry.get(key)
        if not isinstance(values, list):
            continue
        registry[key] = [
            projected
            if isinstance(item, dict) and item.get("artifactId") in restricted_ids
            and (projected := projector(item)) is not None
            else item
            for item in values
        ]


def _redact_nodes(nodes: Any, restricted_node_ids: set[str]) -> None:
    if not isinstance(nodes, list):
        return
    for node in nodes:
        if not isinstance(node, dict) or node.get("id") not in restricted_node_ids:
            continue
        node_id = node.get("id")
        node_type = node.get("type")
        status = node.get("status")
        node.clear()
        opaque_node_id = _opaque_reference(node_id)
        if opaque_node_id is not None:
            node["id"] = opaque_node_id
        if isinstance(node_type, str):
            node["type"] = node_type
        node["content"] = "[restricted evidence]"
        if isinstance(status, str):
            node["status"] = status
        node["attributes"] = {"accessRestricted": True}


def _redact_edges(edges: Any, restricted_node_ids: set[str]) -> None:
    if not isinstance(edges, list):
        return
    for index, edge in enumerate(edges):
        if not isinstance(edge, dict) or not (
            edge.get("src") in restricted_node_ids
            or edge.get("dst") in restricted_node_ids
        ):
            continue
        projected = _project_edge(edge)
        if projected is not None:
            edges[index] = projected


def _project_edge(edge: Any) -> dict[str, Any] | None:
    if not isinstance(edge, dict):
        return None
    projected = {
        key: copy.deepcopy(edge[key])
        for key in ("rel", "family", "nli_score") if key in edge
    }
    for key in ("id", "src", "dst"):
        opaque = _opaque_reference(edge.get(key))
        if opaque is not None:
            projected[key] = opaque
    assessment_ids = edge.get("assessment_ids") or edge.get("assessmentIds")
    if isinstance(assessment_ids, list):
        projected["assessment_ids"] = [
            opaque for opaque in (_opaque_reference(item) for item in assessment_ids)
            if opaque is not None
        ]
    projected["accessRestricted"] = True
    return projected


def _redact_prov_relations(
    document: dict[str, Any], restricted_edge_ids: set[str],
) -> None:
    for section in (
        "used", "wasGeneratedBy", "wasDerivedFrom", "wasAssociatedWith",
        "wasAttributedTo", "wasInformedBy", "wasInfluencedBy",
    ):
        relations = document.get(section)
        if not isinstance(relations, dict):
            continue
        projected_relations: dict[str, Any] = {}
        for edge_id, relation in relations.items():
            if edge_id not in restricted_edge_ids or not isinstance(relation, dict):
                projected_relations[edge_id] = relation
                continue
            projected: dict[str, Any] = {
                "edag:accessRestricted": True,
            }
            for key, value in relation.items():
                if key.startswith("prov:"):
                    opaque = _opaque_reference(value)
                    if opaque is not None:
                        projected[key] = opaque
                elif key in {"edag:rel", "edag:nli_score"}:
                    projected[key] = copy.deepcopy(value)
            projected_relations[_opaque_reference(edge_id) or edge_id] = projected
        document[section] = projected_relations


def _restricted_lineage_shape(result: dict[str, Any]) -> dict[str, Any]:
    """Strict allowlist for mixed derived lineage/reproducibility records."""
    projected: dict[str, Any] = {"accessRestricted": True}
    root = _opaque_reference(result.get("root"))
    if root is not None:
        projected["root"] = root
    for key in ("snapshotBound", "reachesArtifact"):
        if isinstance(result.get(key), bool):
            projected[key] = result[key]
    if isinstance(result.get("provenanceLevel"), str):
        projected["provenanceLevel"] = result["provenanceLevel"]
    nodes = result.get("nodes")
    if isinstance(nodes, list):
        projected["nodes"] = [copy.deepcopy(node) for node in nodes if isinstance(node, dict)]
    edges = result.get("edges")
    if isinstance(edges, list):
        projected["edges"] = [
            item for item in (_project_edge(edge) for edge in edges) if item is not None
        ]
    registry = result.get("artifactRegistry")
    if isinstance(registry, dict):
        projected["artifactRegistry"] = copy.deepcopy(registry)
    assessments = result.get("assessments")
    if isinstance(assessments, list):
        projected["assessments"] = copy.deepcopy(assessments)
    for key, count_key in (
        ("sourceAssertionLeaves", "sourceAssertionLeafCount"),
        ("unsupportedLeaves", "unsupportedLeafCount"),
        ("breakpoints", "breakpointCount"),
    ):
        if isinstance(result.get(key), list):
            projected[count_key] = len(result[key])
    reproducibility = result.get("reproducibility")
    if isinstance(reproducibility, dict):
        projected["reproducibility"] = {
            **{
                key: copy.deepcopy(reproducibility[key])
                for key in ("complete", "level") if key in reproducibility
            },
            "runCount": len(reproducibility.get("runs") or []),
            "breakpointCount": len(reproducibility.get("breakpoints") or []),
            "accessRestricted": True,
        }
    attempts = result.get("attemptHistory")
    if isinstance(attempts, dict):
        projected["attemptHistory"] = {
            "nodes": [
                copy.deepcopy(node) for node in attempts.get("nodes") or []
                if isinstance(node, dict)
            ],
            "edges": [
                item for item in (
                    _project_edge(edge) for edge in (attempts.get("edges") or [])
                ) if item is not None
            ],
            "includedCount": len(attempts.get("includedInPrerequisiteClosure") or []),
            "accessRestricted": True,
        }
    coverage = result.get("coverage")
    if isinstance(coverage, dict):
        safe_coverage = {
            key: copy.deepcopy(coverage[key])
            for key in (
                "complete", "structuralClosureComplete", "evidenceCount",
                "groundedEvidenceCount", "groundingRatio",
            )
            if key in coverage
        }
        components = coverage.get("components")
        if isinstance(components, dict):
            safe_coverage["componentCounts"] = {
                str(key): len(value) for key, value in components.items()
                if isinstance(value, list)
            }
        sufficiency = coverage.get("scientificSufficiency")
        if isinstance(sufficiency, dict):
            safe_coverage["scientificSufficiency"] = {
                key: copy.deepcopy(sufficiency[key])
                for key in ("status", "sufficient") if key in sufficiency
            }
        safe_coverage["breakpointCount"] = len(coverage.get("breakpoints") or [])
        safe_coverage["accessRestricted"] = True
        projected["coverage"] = safe_coverage
    return projected


def _opaque_reference(value: Any) -> str | None:
    """Keep canonical content-addressed IDs; hash all other references."""
    if not isinstance(value, str) or not value:
        return None
    if re.fullmatch(r"[a-z][a-z0-9_-]*:[0-9a-f]{16,64}", value):
        return value
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()[:24]
    return f"restricted-ref:{digest}"


def _redact_assessments(
    assessments: Any,
    restricted_target_ids: set[str],
    *,
    restrict_all: bool,
) -> set[str]:
    """Project restricted assessments to opaque identity and outcome only."""
    restricted_assessment_ids: set[str] = set()
    if not isinstance(assessments, list):
        return restricted_assessment_ids
    for assessment in assessments:
        if not isinstance(assessment, dict):
            continue
        target_id = assessment.get("targetId") or assessment.get("target_id")
        if not restrict_all and target_id not in restricted_target_ids:
            continue
        assessment_id = assessment.get("assessmentId") or assessment.get("assessment_id")
        if isinstance(assessment_id, str):
            restricted_assessment_ids.add(assessment_id)
        projected: dict[str, Any] = {"accessRestricted": True}
        opaque_assessment_id = _opaque_reference(assessment_id)
        opaque_target_id = _opaque_reference(target_id)
        if opaque_assessment_id is not None:
            projected["assessmentId"] = opaque_assessment_id
        if opaque_target_id is not None:
            projected["targetId"] = opaque_target_id
        if isinstance(assessment.get("result"), str):
            projected["result"] = assessment["result"]
        human_review = assessment.get("humanReview") or assessment.get("human_review")
        if isinstance(human_review, dict):
            review: dict[str, Any] = {"exists": True, "accessRestricted": True}
            if isinstance(human_review.get("status"), str):
                review["status"] = human_review["status"]
            packet_id = _opaque_reference(
                human_review.get("reviewPacketId") or human_review.get("review_packet_id")
            )
            if packet_id is not None:
                review["reviewPacketId"] = packet_id
            if isinstance(human_review.get("blocking"), bool):
                review["blocking"] = human_review["blocking"]
            projected["humanReview"] = review
        assessment.clear()
        assessment.update(projected)
    return restricted_assessment_ids


def _packet_restricted(
    packet: dict[str, Any],
    restricted_target_ids: set[str],
    restricted_assessment_ids: set[str],
) -> bool:
    target_ids = packet.get("targetIds") or packet.get("target_ids") or []
    assessment_ids = packet.get("assessmentIds") or packet.get("assessment_ids") or []
    if isinstance(target_ids, list) and restricted_target_ids.intersection(
        item for item in target_ids if isinstance(item, str)
    ):
        return True
    if isinstance(assessment_ids, list) and restricted_assessment_ids.intersection(
        item for item in assessment_ids if isinstance(item, str)
    ):
        return True
    checks = packet.get("machineChecks") or packet.get("machine_checks") or []
    return isinstance(checks, list) and any(
        isinstance(check, dict) and (
            check.get("targetId") in restricted_target_ids
            or check.get("assessmentId") in restricted_assessment_ids
        )
        for check in checks
    )


def _project_review_packet(packet: dict[str, Any]) -> dict[str, Any]:
    projected: dict[str, Any] = {"accessRestricted": True, "exists": True}
    packet_id = _opaque_reference(
        packet.get("reviewPacketId") or packet.get("review_packet_id")
    )
    if packet_id is not None:
        projected["reviewPacketId"] = packet_id
    if isinstance(packet.get("status"), str):
        projected["status"] = packet["status"]
    if isinstance(packet.get("blocking"), bool):
        projected["blocking"] = packet["blocking"]
    for key, snake in (("targetIds", "target_ids"), ("assessmentIds", "assessment_ids")):
        values = packet.get(key) or packet.get(snake) or []
        if isinstance(values, list):
            projected[key] = [
                opaque for opaque in (_opaque_reference(item) for item in values)
                if opaque is not None
            ]
    return projected


def _redact_human_review(
    review: Any,
    restricted_target_ids: set[str],
    restricted_assessment_ids: set[str],
    *,
    restrict_all: bool,
) -> None:
    """Remove review prose, actors, options, checks, and decision metadata."""
    if not isinstance(review, dict):
        return
    packets = review.get("reviewPackets") or review.get("review_packets") or []
    restricted_packet_ids: set[str] = set()
    projected_packets: list[Any] = []
    if isinstance(packets, list):
        for packet in packets:
            if not isinstance(packet, dict):
                projected_packets.append(packet)
                continue
            is_restricted = restrict_all or _packet_restricted(
                packet, restricted_target_ids, restricted_assessment_ids,
            )
            if is_restricted:
                packet_id = packet.get("reviewPacketId") or packet.get("review_packet_id")
                if isinstance(packet_id, str):
                    restricted_packet_ids.add(packet_id)
                projected_packets.append(_project_review_packet(packet))
            else:
                projected_packets.append(packet)
    highest_packet_id = review.get("reviewPacketId") or review.get("review_packet_id")
    if restrict_all or highest_packet_id in restricted_packet_ids:
        projected: dict[str, Any] = {"accessRestricted": True, "exists": True}
        for key in ("gateStatus", "pendingCount", "blockingCount", "status", "blocking"):
            if key in review and isinstance(review[key], (str, int, bool)):
                projected[key] = review[key]
        packet_id = _opaque_reference(highest_packet_id)
        if packet_id is not None:
            projected["reviewPacketId"] = packet_id
        active_ids = review.get("reviewPacketIds")
        if isinstance(active_ids, list):
            projected["reviewPacketIds"] = [
                opaque for opaque in (_opaque_reference(item) for item in active_ids)
                if opaque is not None
            ]
        projected["reviewPackets"] = projected_packets
        review.clear()
        review.update(projected)
    elif isinstance(packets, list):
        review["reviewPackets"] = projected_packets
        review.pop("review_packets", None)
