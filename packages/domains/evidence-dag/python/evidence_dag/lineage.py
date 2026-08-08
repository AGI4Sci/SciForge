"""Deterministic scientific run lineage and strict L4 evaluation.

Only an explicit ``evidenceLineage`` envelope in a visible structured tool
result is consumed.  Missing records are never guessed from prose, filenames,
or tool names.  The resulting nodes and relations use the same ThreadGraph and
immutable Snapshot path as literature evidence.
"""
from __future__ import annotations

import json
from typing import Any, Optional, TYPE_CHECKING

from .artifact_versions import ArtifactVersionProjectionClient
from .model import EdgeRel, Node, NodeType

if TYPE_CHECKING:  # pragma: no cover
    from .graph import ThreadGraph


_RUN_TYPES = frozenset({NodeType.EXPERIMENT_RUN, NodeType.ANALYSIS_RUN})
_INPUT_TYPES = frozenset({NodeType.ARTIFACT, NodeType.DATASET_VERSION, NodeType.OBSERVATION})
_OUTPUT_TYPES = _INPUT_TYPES
_EXPLICIT_RELATIONS = frozenset({
    EdgeRel.EXTRACTED_FROM,
    EdgeRel.USED,
    EdgeRel.GENERATED_BY,
    EdgeRel.DERIVED_FROM,
    EdgeRel.ASSOCIATED_WITH,
    EdgeRel.ATTRIBUTED_TO,
    EdgeRel.VERSION_OF,
    EdgeRel.SUPERSEDES,
    EdgeRel.REPLICATES,
    EdgeRel.FAILS_TO_REPLICATE,
    EdgeRel.SAME_AS,
    EdgeRel.INVALIDATES,
})


def ingest_trace_lineage(
    graph: "ThreadGraph",
    trace: list[dict[str, Any]],
    registry: ArtifactVersionProjectionClient,
    *,
    created_by: str = "structured-lineage-extractor",
    created_at: Optional[str] = None,
) -> dict[str, int]:
    """Ingest explicit run envelopes from visible tool results.

    Canonical envelope::

        {"evidenceLineage": {
          "activity": {"id": "run-1", "type": "analysis_run", ...},
          "inputs": [...], "software": [...], "environment": {...},
          "logs": [...], "outputs": [...], "agents": [...],
          "relations": [{"src": "local-or-node-id", "dst": "...",
                         "rel": "supersedes|replicates|..."}]
        }}

    The function is deliberately independent from model extraction.  It does
    not accept unstructured prose and does not manufacture absent identifiers,
    digests, versions, parameters, or relationships.
    """
    before_nodes, before_edges = len(graph.nodes), len(graph.edges)
    envelopes = 0
    for item in trace:
        if _trace_kind(item) not in {"tool_result", "function_result", "tool_output"}:
            continue
        payload = _structured_payload(item)
        envelope = _lineage_envelope(payload) or _lineage_envelope(item)
        if envelope is None:
            continue
        envelopes += 1
        _ingest_envelope(
            graph, envelope, registry, trace_ref=_trace_id(item),
            created_by=created_by, created_at=created_at,
        )
    return {
        "envelopes": envelopes,
        "nodes": len(graph.nodes) - before_nodes,
        "edges": len(graph.edges) - before_edges,
    }


def _ingest_envelope(
    graph: "ThreadGraph",
    envelope: dict[str, Any],
    registry: ArtifactVersionProjectionClient,
    *,
    trace_ref: str,
    created_by: str,
    created_at: Optional[str],
) -> None:
    raw_activity = envelope.get("activity")
    if not isinstance(raw_activity, dict):
        return
    activity = _add_declared_node(
        graph, raw_activity, allowed=_RUN_TYPES, default_type=None,
        registry=registry, trace_ref=trace_ref, created_by=created_by, created_at=created_at,
    )
    if activity is None:
        return

    refs: dict[str, str] = {activity.id: activity.id}
    if activity.external_id:
        refs[activity.external_id] = activity.id

    def add_many(
        raw_values: Any,
        *,
        allowed: frozenset[NodeType],
        default_type: Optional[NodeType],
        role: Optional[str],
        rel: EdgeRel,
        activity_is_src: bool,
    ) -> list[Node]:
        values = raw_values if isinstance(raw_values, list) else []
        added: list[Node] = []
        for raw in values:
            if not isinstance(raw, dict):
                continue
            node = _add_declared_node(
                graph, raw, allowed=allowed, default_type=default_type,
                registry=registry, trace_ref=trace_ref, created_by=created_by,
                created_at=created_at, role=role,
            )
            if node is None:
                continue
            added.append(node)
            refs[node.id] = node.id
            if node.external_id:
                refs[node.external_id] = node.id
            src, dst = (activity.id, node.id) if activity_is_src else (node.id, activity.id)
            graph.add_edge(src, dst, rel, created_at=created_at)
        return added

    add_many(
        envelope.get("inputs"), allowed=_INPUT_TYPES, default_type=None,
        role="input", rel=EdgeRel.USED, activity_is_src=True,
    )
    add_many(
        envelope.get("software"), allowed=frozenset({NodeType.SOFTWARE_VERSION}),
        default_type=NodeType.SOFTWARE_VERSION, role="software", rel=EdgeRel.USED,
        activity_is_src=True,
    )
    environment = envelope.get("environment")
    environment_values = environment if isinstance(environment, list) else [environment]
    add_many(
        environment_values, allowed=frozenset({NodeType.ENVIRONMENT}),
        default_type=NodeType.ENVIRONMENT, role="environment", rel=EdgeRel.USED,
        activity_is_src=True,
    )
    add_many(
        envelope.get("logs"), allowed=frozenset({NodeType.ARTIFACT}),
        default_type=NodeType.ARTIFACT, role="log", rel=EdgeRel.GENERATED_BY,
        activity_is_src=False,
    )
    add_many(
        envelope.get("outputs"), allowed=_OUTPUT_TYPES, default_type=NodeType.ARTIFACT,
        role="output", rel=EdgeRel.GENERATED_BY, activity_is_src=False,
    )
    add_many(
        envelope.get("agents"), allowed=frozenset({NodeType.AGENT}),
        default_type=NodeType.AGENT, role=None, rel=EdgeRel.ASSOCIATED_WITH,
        activity_is_src=True,
    )

    raw_relations = envelope.get("relations")
    if not isinstance(raw_relations, list):
        return
    for raw in raw_relations:
        if not isinstance(raw, dict):
            continue
        try:
            rel = EdgeRel(str(raw.get("rel") or ""))
        except ValueError:
            continue
        if rel not in _EXPLICIT_RELATIONS:
            continue
        src = _resolve_ref(graph, refs, raw.get("src"))
        dst = _resolve_ref(graph, refs, raw.get("dst"))
        if src and dst:
            graph.add_edge(src, dst, rel, created_at=created_at)


def _add_declared_node(
    graph: "ThreadGraph",
    raw: dict[str, Any],
    *,
    allowed: frozenset[NodeType],
    default_type: Optional[NodeType],
    registry: ArtifactVersionProjectionClient,
    trace_ref: str,
    created_by: str,
    created_at: Optional[str],
    role: Optional[str] = None,
) -> Optional[Node]:
    external_id = _nonempty(raw.get("id"))
    if external_id is None:
        return None
    try:
        ntype = NodeType(str(raw.get("type"))) if raw.get("type") is not None else default_type
    except ValueError:
        return None
    if ntype is None or ntype not in allowed:
        return None
    name = _nonempty(raw.get("name")) or external_id
    attributes = {
        str(key): _json_copy(value)
        for key, value in raw.items()
        if key not in {"id", "type", "name", "artifact"} and _json_value(value)
    }
    if role is not None:
        attributes["lineageRole"] = role
    if ntype in _RUN_TYPES:
        # Presence is significant: an explicitly empty parameter map is a
        # complete declaration, whereas an absent map is an L4 breakpoint.
        attributes["parametersDeclared"] = "parameters" in raw
    projection_status = registry.status_for_trace([trace_ref])
    if projection_status and projection_status.get("status") in {"pending", "failed"}:
        attributes["artifactVersionProvenanceStatus"] = projection_status["status"]
        attributes["artifactVersionProvenanceReason"] = projection_status.get("reason")

    extra: dict[str, Any] = {"external_id": external_id, "attributes": attributes}
    attached = _register_artifact(raw.get("artifact"), registry)
    if attached is not None:
        artifact, version = attached
        extra["artifact_id"] = artifact.artifact_id
        extra["artifact_version_id"] = version.version_id

    node = graph.add_or_get_node(
        ntype, name, identity_scope=external_id, trace_ref=trace_ref or None,
        created_by=created_by, created_at=created_at, **extra,
    )
    if attached is not None:
        artifact, version = attached
        graph.attach_registry_records(
            artifact=artifact, artifact_version=version,
            artifact_version_ref=registry.refs.get(version.version_id),
        )
    return node


def _register_artifact(
    raw: Any, registry: ArtifactVersionProjectionClient,
) -> Optional[tuple[Any, Any]]:
    if not isinstance(raw, dict) or _nonempty(raw.get("locator")) is None:
        return None
    try:
        artifact, version, _ = registry.register(
            kind=_nonempty(raw.get("kind")) or "other",
            locator=str(raw["locator"]),
            content_digest=raw.get("contentDigest"),
            version=_nonempty(raw.get("version")),
            size=raw.get("size") if isinstance(raw.get("size"), int) else None,
            media_type=_nonempty(raw.get("mediaType")),
            retention=_nonempty(raw.get("retention")) or "reference",
            access_policy=raw.get("accessPolicy") if isinstance(raw.get("accessPolicy"), dict) else None,
        )
    except (OSError, TypeError, ValueError):
        return None
    return artifact, version


def reproducibility_report(graph: "ThreadGraph", target_id: str) -> dict[str, Any]:
    """Return strict, explainable L4 readiness for a Finding or run.

    L4 is true only when every related run has a stable identity and visible
    record, verified inputs/software/environment/log/output references, and an
    explicit parameters declaration.  Empty parameters are valid; absence is
    not.  Stochastic runs additionally require an explicit random seed.
    """
    if target_id not in graph.nodes:
        raise KeyError(target_id)
    run_ids = _related_runs(graph, target_id)
    if not run_ids:
        return {
            "targetId": target_id,
            "complete": False,
            "level": None,
            "runIds": [],
            "runs": [],
            "breakpoints": [{"component": "run", "reason": "run_not_linked"}],
        }
    reports = [_run_report(graph, run_id) for run_id in run_ids]
    breakpoints = [
        {"runId": report["runId"], **item}
        for report in reports for item in report["breakpoints"]
    ]
    complete = all(report["complete"] for report in reports)
    return {
        "targetId": target_id,
        "complete": complete,
        "level": "L4" if complete else None,
        "runIds": run_ids,
        "runs": reports,
        "breakpoints": breakpoints,
    }


def _related_runs(graph: "ThreadGraph", target_id: str) -> list[str]:
    target = graph.nodes[target_id]
    if target.type in _RUN_TYPES:
        return [target_id]
    by_src, by_dst = graph.edges_by_src(), graph.edges_by_dst()
    # Walk epistemic inputs backwards, then follow entity -> activity generation.
    candidates = {target_id}
    stack = [target_id]
    while stack:
        current = stack.pop()
        for edge in by_dst.get(current, ()):
            if edge.rel in {EdgeRel.SUPPORTS, EdgeRel.DERIVED_FROM} and edge.src not in candidates:
                candidates.add(edge.src)
                stack.append(edge.src)
    runs: set[str] = set()
    for candidate in candidates:
        for edge in by_src.get(candidate, ()):
            if edge.rel == EdgeRel.GENERATED_BY and graph.nodes[edge.dst].type in _RUN_TYPES:
                runs.add(edge.dst)
    for edge in by_dst.get(target_id, ()):
        if edge.rel in {EdgeRel.REPLICATES, EdgeRel.FAILS_TO_REPLICATE} \
                and graph.nodes[edge.src].type in _RUN_TYPES:
            runs.add(edge.src)
    return sorted(runs)


def _run_report(graph: "ThreadGraph", run_id: str) -> dict[str, Any]:
    run = graph.nodes[run_id]
    used = [graph.nodes[e.dst] for e in graph.edges_by_src().get(run_id, ())
            if e.rel == EdgeRel.USED]
    generated = [graph.nodes[e.src] for e in graph.edges_by_dst().get(run_id, ())
                 if e.rel == EdgeRel.GENERATED_BY]
    inputs = [node for node in used if node.type in _INPUT_TYPES]
    software = [node for node in used if node.type == NodeType.SOFTWARE_VERSION]
    environments = [node for node in used if node.type == NodeType.ENVIRONMENT]
    logs = [node for node in generated if node.attributes.get("lineageRole") == "log"]
    outputs = [node for node in generated if node.attributes.get("lineageRole") == "output"]

    checks: list[tuple[str, bool, str, list[str]]] = [
        ("run", bool(run.external_id and run.trace_refs), "run_identity_or_trace_missing", [run.id]),
        ("status", str(run.attributes.get("status") or "").strip().lower() in
         {"completed", "succeeded", "success"}, "run_status_not_completed", [run.id]),
        ("inputs", bool(inputs) and all(_input_verifiable(graph, n) for n in inputs),
         "input_missing_or_unverifiable", [n.id for n in inputs]),
        ("software", bool(software) and all(_software_verifiable(graph, n) for n in software),
         "software_missing_or_unverifiable", [n.id for n in software]),
        ("parameters", bool(run.attributes.get("parametersDeclared")) and
         isinstance(run.attributes.get("parameters"), dict),
         "parameters_not_declared", []),
        ("environment", bool(environments) and all(_environment_verifiable(graph, n)
                                                   for n in environments),
         "environment_missing_or_unverifiable", [n.id for n in environments]),
        ("logs", bool(logs) and all(_artifact_backed(graph, n) for n in logs),
         "logs_missing_or_unverifiable", [n.id for n in logs]),
        ("outputs", bool(outputs) and all(_artifact_backed(graph, n) for n in outputs),
         "outputs_missing_or_unverifiable", [n.id for n in outputs]),
    ]
    if run.attributes.get("stochastic") is True:
        checks.append((
            "randomSeed", "randomSeed" in run.attributes,
            "stochastic_run_seed_missing", [],
        ))
    breakpoints = [
        {"component": component, "reason": reason, "nodeIds": node_ids}
        for component, passed, reason, node_ids in checks if not passed
    ]
    return {
        "runId": run_id,
        "runType": run.type.value,
        "externalId": run.external_id,
        "complete": not breakpoints,
        "components": {
            "inputs": [n.id for n in inputs],
            "software": [n.id for n in software],
            "environment": [n.id for n in environments],
            "logs": [n.id for n in logs],
            "outputs": [n.id for n in outputs],
        },
        "breakpoints": breakpoints,
    }


def _artifact_backed(graph: "ThreadGraph", node: Node) -> bool:
    artifact = graph.artifacts.get(node.artifact_id or "")
    version = graph.artifact_versions.get(node.artifact_version_id or "")
    return bool(
        artifact and version and version.artifact_id == artifact.artifact_id and
        version.content_digest and version.availability in {"available", "moved", "remote"}
    )


def _input_verifiable(graph: "ThreadGraph", node: Node) -> bool:
    if _artifact_backed(graph, node):
        return True
    if node.type == NodeType.OBSERVATION:
        attrs = node.attributes
        return all(key in attrs for key in ("value", "unit", "observedAt"))
    return False


def _software_verifiable(graph: "ThreadGraph", node: Node) -> bool:
    if _artifact_backed(graph, node):
        return True
    attrs = node.attributes
    moving = {"latest", "current", "head", "main", "master", "stable"}
    version = (_nonempty(attrs.get("version")) or "").lower()
    commit = (_nonempty(attrs.get("commit")) or "").lower()
    swhid = (_nonempty(attrs.get("swhid")) or "").lower()
    return bool(node.external_id and (
        (version and version not in moving) or
        (len(commit) >= 7 and commit not in moving) or
        swhid.startswith("swh:1:") or
        _sha256(attrs.get("containerDigest")) or
        _sha256(attrs.get("contentDigest"))
    ))


def _environment_verifiable(graph: "ThreadGraph", node: Node) -> bool:
    if _artifact_backed(graph, node):
        return True
    attrs = node.attributes
    return bool(any(
        _sha256(attrs.get(key)) for key in ("containerDigest", "lockDigest", "contentDigest")
    ))


def _resolve_ref(graph: "ThreadGraph", refs: dict[str, str], value: Any) -> Optional[str]:
    key = _nonempty(value)
    if key is None:
        return None
    if key in refs:
        return refs[key]
    if key in graph.nodes:
        return key
    matches = [node.id for node in graph.nodes.values() if node.external_id == key]
    return matches[0] if len(matches) == 1 else None


def _lineage_envelope(payload: Any) -> Optional[dict[str, Any]]:
    current = payload
    for _ in range(4):
        if not isinstance(current, dict):
            return None
        for key in ("evidenceLineage", "evidence_lineage"):
            value = current.get(key)
            if isinstance(value, dict):
                return value
        metadata = current.get("metadata")
        if isinstance(metadata, dict):
            for key in ("evidenceLineage", "evidence_lineage"):
                value = metadata.get(key)
                if isinstance(value, dict):
                    return value
        current = next((
            current.get(key) for key in ("output", "result", "value")
            if isinstance(current.get(key), dict)
        ), None)
    return None


def _structured_payload(item: dict[str, Any]) -> Any:
    payload: Any = ""
    for key in ("output", "content", "result", "text"):
        if item.get(key) not in (None, ""):
            payload = item[key]
            break
    if not isinstance(payload, str):
        return payload
    stripped = payload.strip()
    if not stripped.startswith("{"):
        return payload
    try:
        decoded = json.loads(stripped)
    except (json.JSONDecodeError, TypeError):
        return payload
    return decoded if isinstance(decoded, dict) else payload


def _trace_kind(item: dict[str, Any]) -> str:
    return str(item.get("type") or item.get("kind") or "").strip().lower()


def _trace_id(item: dict[str, Any]) -> str:
    return str(item.get("id") or item.get("step_id") or item.get("stepId") or "").strip()


def _nonempty(value: Any) -> Optional[str]:
    if isinstance(value, (str, int, float)) and str(value).strip():
        return str(value).strip()
    return None


def _sha256(value: Any) -> bool:
    raw = _nonempty(value)
    if raw is None:
        return False
    digest = raw[7:] if raw.lower().startswith("sha256:") else raw
    return len(digest) == 64 and all(char in "0123456789abcdefABCDEF" for char in digest)


def _json_value(value: Any) -> bool:
    try:
        json.dumps(value, ensure_ascii=False, sort_keys=True)
        return True
    except (TypeError, ValueError):
        return False


def _json_copy(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False, sort_keys=True))
