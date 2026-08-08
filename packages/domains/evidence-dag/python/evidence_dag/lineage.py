"""Deterministic scientific run lineage and strict L4 evaluation.

Only an explicit ``evidenceLineage`` envelope in a visible structured tool
result is consumed.  Missing records are never guessed from prose, filenames,
or tool names.  The resulting nodes and relations use the same ThreadGraph and
immutable Snapshot path as literature evidence.
"""
from __future__ import annotations

import json
import hashlib
from typing import Any, Optional, TYPE_CHECKING
from urllib.parse import parse_qsl, urlsplit

from .artifacts import ArtifactRegistry
from .model import EdgeRel, Node, NodeType

if TYPE_CHECKING:  # pragma: no cover
    from .graph import ThreadGraph


_RUN_TYPES = frozenset({
    NodeType.EXPERIMENT_RUN, NodeType.ANALYSIS_RUN, NodeType.WORKFLOW_RUN,
})
_ACTIVITY_TYPES = _RUN_TYPES | frozenset({NodeType.TOOL_INVOCATION})
_INPUT_TYPES = frozenset({NodeType.ARTIFACT, NodeType.DATASET_VERSION, NodeType.OBSERVATION})
_OUTPUT_TYPES = _INPUT_TYPES
_EVIDENCE_TYPES = frozenset({
    NodeType.SOURCE_ASSERTION, NodeType.FINDING, NodeType.OBSERVATION, NodeType.ARTIFACT,
})
_EXPLICIT_RELATIONS = frozenset({
    EdgeRel.SUPPORTS,
    EdgeRel.CONTRADICTS,
    EdgeRel.REFINES,
    EdgeRel.PREREQUISITE,
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
    EdgeRel.PART_OF,
    EdgeRel.AUTHORIZED_BY,
    EdgeRel.RERUN_OF,
})

# Reserved relation targets for an evidenceLineage embedded in a canonical
# execution result.  The producer still has to declare the relation explicitly;
# these aliases only solve the otherwise impossible task of naming a run id that
# is allocated by the runtime after the workflow payload has been produced.
_EXECUTION_REF = "$execution"
_ACTIVITY_REF = "$activity"
_WORKFLOW_RUN_REF = "$workflowRun"
_RESERVED_EXECUTION_REFS = frozenset({
    _EXECUTION_REF, _ACTIVITY_REF, _WORKFLOW_RUN_REF,
})


class _TrustedSharedReproResource:
    """In-memory marker for an SDK-validated, secret-free shared resource.

    A plain lineage JSON object cannot manufacture this marker.  It lets the
    ingestion path preserve the already-canonical executor bytes without
    exposing a public bypass around normal metadata redaction.
    """

    def __init__(self, value: dict[str, Any]) -> None:
        self.value = value


def ingest_trace_lineage(
    graph: "ThreadGraph",
    trace: list[dict[str, Any]],
    registry: ArtifactRegistry,
    *,
    created_by: str = "structured-lineage-extractor",
    created_at: Optional[str] = None,
    allowed_historical_rerun_refs: frozenset[str] = frozenset(),
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

    A relation may use ``$execution`` as its endpoint to explicitly reference
    the canonical WorkflowRun/Activity carrying the envelope.  ``$activity``
    and ``$workflowRun`` select those records when both are present.  Merely
    declaring Evidence does not create any implicit execution relationship.

    The function is deliberately independent from model extraction.  It does
    not accept unstructured prose and does not manufacture absent identifiers,
    digests, versions, parameters, or relationships.
    """
    before_nodes, before_edges = len(graph.nodes), len(graph.edges)
    envelopes = 0
    for item in trace:
        payload = _structured_payload(item)
        envelope = (
            _execution_event_envelope(item)
            or _lineage_envelope(payload)
            or _lineage_envelope(item)
        )
        if envelope is None:
            if _trace_kind(item) not in {"tool_result", "function_result", "tool_output"}:
                continue
            continue
        envelopes += 1
        _ingest_envelope(
            graph, envelope, registry, trace_ref=_trace_id(item),
            created_by=created_by, created_at=created_at,
            allowed_historical_rerun_refs=allowed_historical_rerun_refs,
        )
    return {
        "envelopes": envelopes,
        "nodes": len(graph.nodes) - before_nodes,
        "edges": len(graph.edges) - before_edges,
    }


def _ingest_envelope(
    graph: "ThreadGraph",
    envelope: dict[str, Any],
    registry: ArtifactRegistry,
    *,
    trace_ref: str,
    created_by: str,
    created_at: Optional[str],
    allowed_historical_rerun_refs: frozenset[str],
) -> None:
    raw_workflow = envelope.get("workflowRun") or envelope.get("workflow_run") \
        or envelope.get("workflow")
    workflow = _add_declared_node(
        graph, raw_workflow, allowed=frozenset({NodeType.WORKFLOW_RUN}),
        default_type=NodeType.WORKFLOW_RUN, registry=registry, trace_ref=trace_ref,
        created_by=created_by, created_at=created_at, role="workflow",
    ) if isinstance(raw_workflow, dict) else None
    raw_activity = envelope.get("activity")
    activity = _add_declared_node(
        graph, raw_activity, allowed=_ACTIVITY_TYPES,
        default_type=None, registry=registry, trace_ref=trace_ref,
        created_by=created_by, created_at=created_at, role="activity",
    ) if isinstance(raw_activity, dict) else None
    execution = activity or workflow
    if execution is None:
        return

    refs: dict[str, str] = {}

    def remember(node: Node) -> None:
        refs[node.id] = node.id
        if node.external_id and node.external_id not in _RESERVED_EXECUTION_REFS:
            refs[node.external_id] = node.id

    remember(execution)
    if isinstance(raw_activity, dict) and _nonempty(raw_activity.get("sourceActivityId")):
        refs[str(raw_activity["sourceActivityId"]).strip()] = execution.id
    if workflow is not None:
        remember(workflow)
    if activity is not None:
        remember(activity)
    refs[_EXECUTION_REF] = execution.id
    refs[_ACTIVITY_REF] = (activity or execution).id
    refs[_WORKFLOW_RUN_REF] = (workflow or execution).id
    if workflow is not None and activity is not None:
        graph.add_edge(activity.id, workflow.id, EdgeRel.PART_OF, created_at=created_at)

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
            remember(node)
            src, dst = (execution.id, node.id) if activity_is_src else (node.id, execution.id)
            graph.add_edge(src, dst, rel, created_at=created_at)
        return added

    def add_unlinked(
        raw_values: Any,
        *,
        allowed: frozenset[NodeType],
        default_type: Optional[NodeType],
        role: Optional[str],
    ) -> list[tuple[Node, dict[str, Any]]]:
        values = raw_values if isinstance(raw_values, list) else []
        result: list[tuple[Node, dict[str, Any]]] = []
        for raw in values:
            if not isinstance(raw, dict):
                continue
            node = _add_declared_node(
                graph, raw, allowed=allowed, default_type=default_type,
                registry=registry, trace_ref=trace_ref, created_by=created_by,
                created_at=created_at, role=role,
            )
            if node is not None:
                remember(node)
                result.append((node, raw))
        return result

    add_many(
        envelope.get("inputs"), allowed=_INPUT_TYPES, default_type=None,
        role="input", rel=EdgeRel.USED, activity_is_src=True,
    )
    add_many(
        envelope.get("software"), allowed=frozenset({NodeType.SOFTWARE_VERSION}),
        default_type=NodeType.SOFTWARE_VERSION, role="code", rel=EdgeRel.USED,
        activity_is_src=True,
    )
    add_many(
        envelope.get("code"), allowed=frozenset({NodeType.SOFTWARE_VERSION, NodeType.ARTIFACT}),
        default_type=NodeType.SOFTWARE_VERSION, role="code", rel=EdgeRel.USED,
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

    raw_parameters = envelope.get("parameters")
    parameter_values: list[dict[str, Any]] = []
    if isinstance(raw_parameters, list):
        parameter_values = [value for value in raw_parameters if isinstance(value, dict)]
    elif isinstance(raw_parameters, dict):
        if _nonempty(raw_parameters.get("id")):
            parameter_values = [raw_parameters]
        else:
            parameter_values = [{
                "id": f"{execution.external_id or execution.id}:parameters",
                "name": f"Parameters for {execution.content}",
                "values": raw_parameters,
            }]
    elif isinstance(raw_activity, dict) and isinstance(raw_activity.get("parameters"), dict):
        parameter_values = [{
            "id": f"{execution.external_id or execution.id}:parameters",
            "name": f"Parameters for {execution.content}",
            "values": raw_activity["parameters"],
        }]
    add_many(
        parameter_values, allowed=frozenset({NodeType.PARAMETER_SET}),
        default_type=NodeType.PARAMETER_SET, role="parameter", rel=EdgeRel.USED,
        activity_is_src=True,
    )

    tools = add_unlinked(
        envelope.get("tools"), allowed=frozenset({NodeType.TOOL_INVOCATION}),
        default_type=NodeType.TOOL_INVOCATION, role="tool",
    )
    for tool, raw in tools:
        parent = _resolve_ref(graph, refs, raw.get("parentId") or raw.get("runId"))
        graph.add_edge(tool.id, parent or execution.id, EdgeRel.PART_OF, created_at=created_at)
        values = raw.get("parameters") or raw.get("arguments")
        if isinstance(values, dict):
            parameter = _add_declared_node(
                graph, {
                    "id": f"{tool.external_id or tool.id}:parameters",
                    "name": f"Parameters for {tool.content}",
                    "values": values,
                }, allowed=frozenset({NodeType.PARAMETER_SET}),
                default_type=NodeType.PARAMETER_SET, registry=registry,
                trace_ref=trace_ref, created_by=created_by, created_at=created_at,
                role="parameter",
            )
            if parameter is not None:
                remember(parameter)
                graph.add_edge(tool.id, parameter.id, EdgeRel.USED, created_at=created_at)

    approvals = add_unlinked(
        envelope.get("approvals"), allowed=frozenset({NodeType.APPROVAL_DECISION}),
        default_type=NodeType.APPROVAL_DECISION, role="approval",
    )
    for approval, raw in approvals:
        subject = _resolve_local_ref(
            graph, refs,
            raw.get("subjectId") or raw.get("toolId") or raw.get("activityId"),
        )
        if subject:
            graph.add_edge(subject, approval.id, EdgeRel.AUTHORIZED_BY, created_at=created_at)

    add_unlinked(
        envelope.get("evidence"), allowed=_EVIDENCE_TYPES, default_type=None,
        role="evidence",
    )
    conclusions = envelope.get("conclusions")
    if isinstance(envelope.get("conclusion"), dict):
        conclusions = [*(conclusions if isinstance(conclusions, list) else []),
                       envelope["conclusion"]]
    add_unlinked(
        conclusions, allowed=frozenset({NodeType.CONCLUSION}),
        default_type=NodeType.CONCLUSION, role="conclusion",
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
        src = _resolve_local_ref(graph, refs, raw.get("src"))
        dst = _resolve_local_ref(graph, refs, raw.get("dst"))
        if src and dst is None and rel in {
            EdgeRel.RERUN_OF, EdgeRel.REPLICATES, EdgeRel.FAILS_TO_REPLICATE,
        }:
            external_dst = _nonempty(raw.get("dst"))
            if external_dst in allowed_historical_rerun_refs:
                dst = _resolve_ref(graph, refs, external_dst)
        if src and dst:
            graph.add_edge(src, dst, rel, created_at=created_at)


def _add_declared_node(
    graph: "ThreadGraph",
    raw: dict[str, Any],
    *,
    allowed: frozenset[NodeType],
    default_type: Optional[NodeType],
    registry: ArtifactRegistry,
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
    name = _nonempty(raw.get("name")) or _nonempty(raw.get("content")) or external_id
    trusted_repro = raw.get("_trustedSharedReproResource")
    attributes = {
        str(key): _json_copy(value)
        for key, value in raw.items()
        if key not in {
            "id", "type", "name", "content", "artifact",
            "_trustedSharedReproResource",
        } and _json_value(value)
    }
    attributes = _redact_metadata(attributes, path=f"nodes.{external_id}")
    if isinstance(trusted_repro, _TrustedSharedReproResource):
        # The complete incoming spec was validated before the marker was made,
        # and its secret-bearing fields were checked to contain placeholders
        # only.  Re-redacting this object would alter workflowDigest.
        shared_resource = _json_copy(trusted_repro.value)
        attributes["sharedReproResource"] = shared_resource
        attributes["executor"] = _json_copy(shared_resource["activity"]["executor"])
    if role is not None:
        attributes["lineageRole"] = role
        attributes["semanticRole"] = role
    if ntype == NodeType.PARAMETER_SET:
        values = raw.get("values")
        if not _json_value(values):
            return None
        canonical = json.dumps(
            values, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
            allow_nan=False,
        )
        attributes["values"] = _json_copy(values)
        attributes["valueDigest"] = "sha256:" + hashlib.sha256(
            canonical.encode("utf-8")
        ).hexdigest()
    if ntype in _RUN_TYPES:
        # Presence is significant: an explicitly empty parameter map is a
        # complete declaration, whereas an absent map is an L4 breakpoint.
        attributes["parametersDeclared"] = "parameters" in raw

    extra: dict[str, Any] = {"external_id": external_id, "attributes": attributes}
    attached = _register_artifact(raw.get("artifact"), registry)
    if attached is not None:
        artifact, version = attached
        extra["artifact_id"] = artifact.artifact_id
        extra["artifact_version_id"] = version.version_id

    identity_scope = external_id
    if attached is not None:
        identity_scope = f"{external_id}|artifact-version:{attached[1].version_id}"
    elif ntype in _OUTPUT_TYPES | _EVIDENCE_TYPES and _sha256(raw.get("contentDigest")):
        digest = str(raw["contentDigest"]).lower()
        identity_scope = f"{external_id}|content:{digest}"
    node = graph.add_or_get_node(
        ntype, name, identity_scope=identity_scope, trace_ref=trace_ref or None,
        created_by=created_by, created_at=created_at, **extra,
    )
    if attached is not None:
        artifact, version = attached
        graph.attach_registry_records(artifact=artifact, artifact_version=version)
    return node


def _register_artifact(raw: Any, registry: ArtifactRegistry) -> Optional[tuple[Any, Any]]:
    if not isinstance(raw, dict) or _nonempty(raw.get("locator")) is None:
        return None
    if _url_contains_secret(str(raw["locator"])):
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
    if target.type in _ACTIVITY_TYPES:
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
            if edge.rel == EdgeRel.GENERATED_BY and graph.nodes[edge.dst].type in _ACTIVITY_TYPES:
                runs.add(edge.dst)
    for edge in by_dst.get(target_id, ()):
        if edge.rel in {EdgeRel.REPLICATES, EdgeRel.FAILS_TO_REPLICATE} \
                and graph.nodes[edge.src].type in _ACTIVITY_TYPES:
            runs.add(edge.src)
    return sorted(runs)


def _run_report(graph: "ThreadGraph", run_id: str) -> dict[str, Any]:
    run = graph.nodes[run_id]
    by_src, by_dst = graph.edges_by_src(), graph.edges_by_dst()
    member_ids = {run_id}
    pending = [run_id]
    while pending:
        parent = pending.pop()
        for edge in by_dst.get(parent, ()):
            if edge.rel != EdgeRel.PART_OF or edge.src in member_ids:
                continue
            if graph.nodes[edge.src].type in _ACTIVITY_TYPES:
                member_ids.add(edge.src)
                pending.append(edge.src)
    used = [graph.nodes[e.dst] for member_id in member_ids for e in by_src.get(member_id, ())
            if e.rel == EdgeRel.USED and e.dst not in member_ids]
    generated = [graph.nodes[e.src] for member_id in member_ids for e in by_dst.get(member_id, ())
                 if e.rel == EdgeRel.GENERATED_BY and e.src not in member_ids]
    inputs = [node for node in used if node.type in _INPUT_TYPES
              or node.attributes.get("semanticRole") == "input"]
    software = [node for node in used if node.type == NodeType.SOFTWARE_VERSION
                or node.attributes.get("semanticRole") == "code"]
    tools = [graph.nodes[item] for item in member_ids
             if graph.nodes[item].type == NodeType.TOOL_INVOCATION]
    parameters = [node for node in used if node.type == NodeType.PARAMETER_SET]
    for tool in tools:
        parameters.extend(
            graph.nodes[edge.dst] for edge in by_src.get(tool.id, ())
            if edge.rel == EdgeRel.USED
            and graph.nodes[edge.dst].type == NodeType.PARAMETER_SET
            and graph.nodes[edge.dst] not in parameters
        )
    environments = [node for node in used if node.type == NodeType.ENVIRONMENT]
    logs = [node for node in generated if node.attributes.get("lineageRole") == "log"]
    outputs = [node for node in generated if node.attributes.get("lineageRole") == "output"]

    checks: list[tuple[str, bool, str, list[str]]] = [
        ("run", bool(run.external_id and run.trace_refs), "run_identity_or_trace_missing", [run.id]),
        ("status", str(run.attributes.get("status") or "").strip().lower() in
         {"completed", "succeeded", "success"}, "run_status_not_completed", [run.id]),
        ("inputs", bool(inputs) and all(_input_verifiable(graph, n) for n in inputs),
         "input_missing_or_unverifiable", [n.id for n in inputs]),
        ("software", (bool(software) and all(_software_verifiable(graph, n) for n in software))
         or (bool(tools) and all(_tool_verifiable(n) for n in tools)),
         "software_or_tool_missing_or_unverifiable", [n.id for n in [*software, *tools]]),
        ("parameters", bool(parameters) or (
            bool(run.attributes.get("parametersDeclared"))
            and isinstance(run.attributes.get("parameters"), dict)
         ), "parameters_not_declared", [n.id for n in parameters]),
        ("environment", bool(environments) and all(_environment_verifiable(graph, n)
                                                   for n in environments),
         "environment_missing_or_unverifiable", [n.id for n in environments]),
        ("logs", bool(logs) and all(_artifact_backed(graph, n) for n in logs),
         "logs_missing_or_unverifiable", [n.id for n in logs]),
        ("outputs", bool(outputs) and all(_artifact_backed(graph, n) for n in outputs),
         "outputs_missing_or_unverifiable", [n.id for n in outputs]),
    ]
    if run.attributes.get("stochastic") is True or any(
        tool.attributes.get("stochastic") is True for tool in tools
    ):
        checks.append((
            "randomSeed", "randomSeed" in run.attributes or any(
                "randomSeed" in node.attributes for node in parameters
            ),
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
            "tools": [n.id for n in tools],
            "parameters": [n.id for n in parameters],
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


def _tool_verifiable(node: Node) -> bool:
    version = _nonempty(node.attributes.get("version"))
    return bool(node.external_id and version)


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


def _resolve_local_ref(
    graph: "ThreadGraph", refs: dict[str, str], value: Any,
) -> Optional[str]:
    key = _nonempty(value)
    if key is None:
        return None
    # Exact internal ids are capability-like, content-derived references.
    # Deliberately do not search historical ``external_id`` values here: an
    # envelope may only use its own aliases or an already materialized node id.
    return refs.get(key) or (key if key in graph.nodes else None)


def _lineage_envelope(payload: Any) -> Optional[dict[str, Any]]:
    if not isinstance(payload, dict):
        return None
    for key in ("evidenceLineage", "evidence_lineage"):
        value = payload.get(key)
        if isinstance(value, dict):
            return value
    metadata = payload.get("metadata")
    if isinstance(metadata, dict):
        for key in ("evidenceLineage", "evidence_lineage"):
            value = metadata.get(key)
            if isinstance(value, dict):
                return value
    nested = payload.get("payload")
    if isinstance(nested, dict):
        value = _lineage_envelope(nested)
        if value is not None:
            return value
    return None


def _execution_event_envelope(item: Any) -> Optional[dict[str, Any]]:
    """Project the generic SDK completion event into deterministic lineage.

    Producers can provide a native ``evidenceLineage`` envelope.  Create Loop's
    immutable run manifest is also sufficiently explicit to project without a
    model call; this is a data-shape adapter, not a dependency on that package.
    """
    if not isinstance(item, dict) \
            or item.get("schemaVersion") != "sciforge.execution-event.v1":
        return None
    if item.get("phase") not in {"run_completed", "run_failed"}:
        return None
    candidates: list[Any] = []
    payload = item.get("payload")
    if isinstance(payload, dict):
        candidates.extend((payload, payload.get("manifest")))
    artifacts = item.get("artifacts")
    if isinstance(artifacts, list):
        for artifact in artifacts:
            candidates.append(artifact)
            if isinstance(artifact, dict):
                candidates.append(artifact.get("manifest"))
                candidates.append(artifact.get("spec"))
    shared_spec = next(
        (
            artifact.get("spec")
            for artifact in (artifacts if isinstance(artifacts, list) else [])
            if isinstance(artifact, dict)
            and artifact.get("kind") == "sciforge.repro-spec"
            and isinstance(artifact.get("spec"), dict)
            and artifact["spec"].get("schemaVersion") == "sciforge.rerun.v1"
        ),
        None,
    )
    manifest = next(
        (value for value in candidates
         if isinstance(value, dict) and value.get("schema") == "sciforge.create-loop.run.v2"),
        None,
    )
    declared = _manifest_output_lineage(manifest)
    if shared_spec is not None:
        projected = _shared_spec_envelope(item, shared_spec, manifest)
        if projected is not None:
            return _merge_execution_lineage(projected, declared)
    direct = _lineage_envelope(item)
    if direct is not None:
        return _merge_execution_lineage(direct, declared)
    if manifest is None:
        return _minimal_execution_envelope(item)
    return _merge_execution_lineage(
        _create_loop_manifest_envelope(item, manifest), declared,
    )


def _manifest_output_lineage(manifest: Any) -> Optional[dict[str, Any]]:
    """Read only an explicitly declared evidenceLineage from outputJson."""
    if not isinstance(manifest, dict):
        return None
    raw = manifest.get("outputJson")
    if not isinstance(raw, str) or not raw.strip().startswith("{"):
        return None
    try:
        decoded = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None
    return _lineage_envelope(decoded) if isinstance(decoded, dict) else None


def _merge_execution_lineage(
    execution: Optional[dict[str, Any]], declared: Optional[dict[str, Any]],
) -> Optional[dict[str, Any]]:
    """Attach explicit scientific claims to one canonical execution envelope."""
    if execution is None:
        return declared
    if declared is None:
        return execution
    merged = dict(execution)
    list_fields = (
        "inputs", "software", "code", "environment", "logs", "outputs",
        "agents", "tools", "approvals", "evidence", "conclusions", "relations",
    )
    for key in list_fields:
        left = merged.get(key)
        right = declared.get(key)
        left_values = left if isinstance(left, list) else ([left] if isinstance(left, dict) else [])
        right_values = right if isinstance(right, list) else ([right] if isinstance(right, dict) else [])
        values = [*left_values, *right_values]
        if values:
            unique = {_canonical_lineage_json(value): value for value in values}
            merged[key] = [unique[item] for item in sorted(unique)]
    if isinstance(declared.get("conclusion"), dict):
        conclusions = merged.get("conclusions") if isinstance(merged.get("conclusions"), list) else []
        values = [*conclusions, declared["conclusion"]]
        unique = {_canonical_lineage_json(value): value for value in values}
        merged["conclusions"] = [unique[item] for item in sorted(unique)]
    # Execution metadata always comes from the event/shared spec.  A declared
    # output may add it only when no canonical execution record exists.
    if not any(isinstance(merged.get(key), dict) for key in ("activity", "workflowRun")):
        for key in ("activity", "workflowRun", "workflow_run", "workflow"):
            if isinstance(declared.get(key), dict):
                merged[key] = declared[key]
                break
    return merged


def _canonical_lineage_json(value: Any) -> str:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        allow_nan=False,
    )


def _minimal_execution_envelope(event: dict[str, Any]) -> Optional[dict[str, Any]]:
    run_id = _nonempty(event.get("runId"))
    if run_id is None:
        return None
    producer = event.get("producer") if isinstance(event.get("producer"), dict) else {}
    module_id = _nonempty(producer.get("moduleId")) or "unknown-producer"
    module_version = _nonempty(producer.get("moduleVersion"))
    activity_type = "tool_invocation" if event.get("activityId") else "workflow_run"
    activity: dict[str, Any] = {
        "id": run_id,
        "type": activity_type,
        "name": f"Execution {run_id}",
        "status": "completed" if event.get("phase") == "run_completed" else "failed",
        "parameters": {},
        "executor": {
            "kind": "unavailable",
            "reason": "The producer emitted completion metadata without an executable definition.",
        },
    }
    if event.get("rerunOfRunId"):
        activity["rerunOfRunId"] = event["rerunOfRunId"]
    tools = [{
        "id": f"{run_id}:producer",
        "name": module_id,
        "providerId": module_id,
        "actionId": "execution",
        "version": module_version,
        "arguments": {},
        "parentId": run_id,
    }]
    return {"activity": activity, "tools": tools, "parameters": {}}


def _create_loop_manifest_envelope(
    event: dict[str, Any], manifest: dict[str, Any],
) -> dict[str, Any]:
    run_id = _nonempty(event.get("runId")) or "unknown-run"
    workflow = manifest.get("workflow") if isinstance(manifest.get("workflow"), dict) else {}
    context = manifest.get("context") if isinstance(manifest.get("context"), dict) else {}
    workflow_id = _nonempty(workflow.get("id")) or run_id
    workflow_name = _nonempty(workflow.get("name")) or f"Workflow {workflow_id}"
    workflow_fingerprint = manifest.get("workflowFingerprint")
    executor = {
        "kind": "unavailable",
        "reason": "The run manifest records observations but no shared executable resource was supplied.",
    }
    parameter_values = {
        "workflow": _redact_metadata(workflow, path=f"executions.{run_id}.parameters.workflow")
    }
    determinism = manifest.get("determinism") \
        if isinstance(manifest.get("determinism"), dict) else {}
    stochastic_ids = set(
        str(value) for value in determinism.get("stochasticNodeIds", [])
        if _nonempty(value)
    )
    workflow_run: dict[str, Any] = {
        "id": run_id,
        "name": workflow_name,
        "status": "completed" if event.get("phase") == "run_completed" else "failed",
        "parameters": parameter_values,
        "stochastic": determinism.get("control") == "uncontrolled",
        "executor": executor,
        "inputFingerprint": manifest.get("inputFingerprint"),
        "outputFingerprint": manifest.get("outputFingerprint"),
        "contextFingerprint": manifest.get("contextFingerprint"),
        "comparison": manifest.get("comparison"),
    }
    input_value = _redact_metadata(
        manifest.get("input"), path=f"executions.{run_id}.input",
    )
    inputs = [{
        "id": f"{run_id}:input",
        "type": "artifact",
        "name": f"Input for {workflow_name}",
        "contentDigest": manifest.get("inputFingerprint"),
        "value": input_value,
    }]
    environments = [{
        "id": f"{run_id}:environment",
        "name": f"Environment for {workflow_name}",
        "platform": context.get("platform"),
        "architecture": context.get("architecture"),
        "contentDigest": manifest.get("contextFingerprint"),
        "runtimeVersions": {
            "package": context.get("packageVersion"),
            "node": context.get("nodeVersion"),
        },
    }]
    tools: list[dict[str, Any]] = []
    raw_nodes = workflow.get("nodes") if isinstance(workflow.get("nodes"), list) else []
    for raw in raw_nodes:
        if not isinstance(raw, dict) or _nonempty(raw.get("id")) is None:
            continue
        node_id = str(raw["id"]).strip()
        tools.append({
            "id": f"{run_id}:node:{node_id}",
            "name": _nonempty(raw.get("name")) or node_id,
            "providerId": context.get("packageOwner"),
            "actionId": _nonempty(raw.get("type")) or "workflow-node",
            "version": context.get("packageVersion"),
            "arguments": _redact_metadata(
                raw.get("config") if isinstance(raw.get("config"), dict) else {},
                path=f"executions.{run_id}.nodes.{node_id}",
            ),
            "stochastic": node_id in stochastic_ids,
            "supportsSeed": False,
            "parentId": run_id,
        })

    raw_approvals = manifest.get("approvals") \
        if isinstance(manifest.get("approvals"), list) else []
    approvals = []
    for raw in raw_approvals:
        if not isinstance(raw, dict) or _nonempty(raw.get("requestId")) is None:
            continue
        raw_node_id = _nonempty(raw.get("nodeId"))
        subject_id = f"{run_id}:node:{raw_node_id}" if raw_node_id else run_id
        approvals.append({
            "id": str(raw["requestId"]).strip(),
            "name": _nonempty(raw.get("title")) or "Workflow approval",
            "kind": "workflow-human-approval",
            "mode": "fresh-decision",
            "subjectId": subject_id,
            "decisionNodeId": raw_node_id,
            "status": raw.get("status"),
            "decision": raw.get("decision"),
            "actor": raw.get("actor"),
            "rationale": raw.get("rationale"),
        })

    raw_artifacts = manifest.get("artifactRefs") \
        if isinstance(manifest.get("artifactRefs"), list) else []
    outputs: list[dict[str, Any]] = []
    for index, raw in enumerate(raw_artifacts):
        if not isinstance(raw, dict) or _nonempty(raw.get("ref")) is None:
            continue
        output: dict[str, Any] = {
            "id": f"{run_id}:artifact:{index}",
            "type": "artifact",
            "name": str(raw["ref"]),
            "contentDigest": raw.get("digest"),
        }
        if _nonempty(raw.get("ref")):
            output["artifact"] = {
                "kind": _nonempty(raw.get("kind")) or "other",
                "locator": str(raw["ref"]),
                "contentDigest": raw.get("digest"),
                "mediaType": raw.get("mediaType"),
            }
        outputs.append(output)
    # The canonical result fingerprint remains observable even when the
    # producer did not expose a file Artifact.
    result_output: dict[str, Any] = {
        "id": f"{run_id}:result",
        "type": "artifact",
        "name": f"Result of {workflow_name}",
        "contentDigest": manifest.get("outputFingerprint"),
        "comparator": manifest.get("comparator"),
    }
    output_json = manifest.get("outputJson")
    if isinstance(output_json, str):
        try:
            result_output["value"] = json.loads(output_json)
        except (json.JSONDecodeError, TypeError):
            pass
    outputs.append(result_output)
    relations: list[dict[str, Any]] = []
    rerun_of = _nonempty(manifest.get("rerunOfRunId"))
    if rerun_of:
        relations.append({"src": run_id, "dst": rerun_of, "rel": "rerun_of"})
        comparison = manifest.get("comparison") \
            if isinstance(manifest.get("comparison"), dict) else {}
        replication_status = comparison.get("replicationStatus")
        comparable = comparison.get("comparisonVerifiable") is True and all(
            comparison.get(key) is True for key in (
                "sameInput", "sameSpec", "sameExecutionContext",
            )
        )
        result_match = comparison.get("resultMatch")
        legacy_matches_present = "matches" in comparison
        legacy_matches = comparison.get("matches")
        result_basis_valid = type(result_match) is bool and (
            not legacy_matches_present
            or type(legacy_matches) is bool and legacy_matches is result_match
        )
        result_matches = result_basis_valid and result_match is True
        result_differs = result_basis_valid and result_match is False
        if replication_status == "matched" and comparable and result_matches:
            relations.append({"src": run_id, "dst": rerun_of, "rel": "replicates"})
        elif replication_status == "failed" \
                and determinism.get("control") == "controlled" \
                and comparable and result_differs:
            relations.append({
                "src": run_id, "dst": rerun_of, "rel": "fails_to_replicate",
            })
    return {
        "workflowRun": workflow_run,
        "inputs": inputs,
        "environment": environments,
        "parameters": {
            "id": f"{run_id}:parameters",
            "name": f"Parameters for {workflow_name}",
            "values": parameter_values,
        },
        "tools": tools,
        "approvals": approvals,
        "outputs": outputs,
        "relations": relations,
    }


def _shared_spec_envelope(
    event: dict[str, Any],
    spec: dict[str, Any],
    manifest: Optional[dict[str, Any]],
) -> Optional[dict[str, Any]]:
    """Use the shared rerun resource as the sole executable definition."""
    from .rerun import validate_rerun_spec

    try:
        validate_rerun_spec(spec)
    except (TypeError, ValueError):
        return None
    activities = spec.get("activities") if isinstance(spec.get("activities"), list) else []
    activity_by_id = {
        str(item.get("id")): item for item in activities
        if isinstance(item, dict) and _nonempty(item.get("id"))
    }
    target = spec.get("target") if isinstance(spec.get("target"), dict) else {}
    source = spec.get("source") if isinstance(spec.get("source"), dict) else {}
    preferred_ids = [
        target.get("id") if target.get("kind") == "activity" else None,
        event.get("activityId"),
        source.get("activityId"),
    ]
    selected = next(
        (activity_by_id[str(value)] for value in preferred_ids if value in activity_by_id),
        activities[0] if len(activities) == 1 and isinstance(activities[0], dict) else None,
    )
    if not isinstance(selected, dict):
        return _minimal_execution_envelope(event)

    run_id = _nonempty(event.get("runId")) or str(selected["id"])
    activity_type = str(selected.get("type") or "")
    unsafe_secret = _raw_secret_path(selected)
    executor = selected.get("executor")
    if unsafe_secret:
        executor = {
            "kind": "unavailable",
            "reason": (
                "The shared rerun resource contained a raw secret at "
                f"{unsafe_secret}; the hashed executor payload was rejected unchanged."
            ),
        }
    raw_activity: dict[str, Any] = {
        "id": run_id,
        "type": activity_type,
        "name": _nonempty(selected.get("name")) or run_id,
        "status": "completed" if event.get("phase") == "run_completed" else "failed",
        "stochastic": selected.get("stochastic") is True,
        "executor": _json_copy(executor),
        "sourceActivityId": selected.get("id"),
        "sourceSpecDigest": spec.get("specDigest"),
    }
    if isinstance(manifest, dict) and isinstance(manifest.get("comparison"), dict):
        # The shared spec supplies the executable definition, while the real
        # producer manifest remains authoritative for observed comparison facts.
        raw_activity["comparison"] = _json_copy(manifest["comparison"])
    if unsafe_secret is None:
        relevant_breakpoints = [
            _json_copy(item) for item in spec.get("breakpoints", [])
            if isinstance(item, dict)
            and item.get("activityId") in (None, selected.get("id"))
        ]
        blocking = any(item.get("blocking") is True for item in relevant_breakpoints)
        raw_activity["_trustedSharedReproResource"] = _TrustedSharedReproResource({
            "schemaVersion": "sciforge.shared-repro-source.v1",
            "sourceSpecDigest": spec["specDigest"],
            "executionReady": not blocking,
            "reproducibility": (
                "incomplete" if blocking else
                "uncontrolled" if relevant_breakpoints else "controlled"
            ),
            "activity": _json_copy(selected),
            "secretSlots": _json_copy(spec.get("secretSlots", [])),
            "breakpoints": relevant_breakpoints,
        })
    parameter_sets = selected.get("parameterSets") \
        if isinstance(selected.get("parameterSets"), list) else []
    raw_activity["parameters"] = {
        str(item.get("id")): item.get("values")
        for item in parameter_sets if isinstance(item, dict) and _nonempty(item.get("id"))
    }
    if any(isinstance(item, dict) and "randomSeed" in item for item in parameter_sets):
        raw_activity["randomSeed"] = next(
            item["randomSeed"] for item in parameter_sets
            if isinstance(item, dict) and "randomSeed" in item
        )

    def artifact_node(raw: Any, *, default_type: str, role: str) -> Optional[dict[str, Any]]:
        if not isinstance(raw, dict) or _nonempty(raw.get("id")) is None:
            return None
        kind = str(raw.get("kind") or "").lower()
        node_type = (
            "dataset_version" if "dataset" in kind else
            "observation" if kind == "observation" else default_type
        )
        result: dict[str, Any] = {
            "id": raw["id"],
            "type": node_type,
            "name": raw.get("name") or raw["id"],
            "contentDigest": raw.get("contentDigest"),
            "version": raw.get("version"),
            "mediaType": raw.get("mediaType"),
            "semanticRole": role,
        }
        if _nonempty(raw.get("locator")):
            result["artifact"] = {
                "kind": raw.get("kind") or "other",
                "locator": raw["locator"],
                "contentDigest": raw.get("contentDigest"),
                "version": raw.get("version"),
                "mediaType": raw.get("mediaType"),
            }
        if isinstance(raw.get("comparator"), dict):
            result["comparator"] = _json_copy(raw["comparator"])
        if _nonempty(raw.get("baselineDigest")):
            result["baselineDigest"] = raw["baselineDigest"]
        if isinstance(raw.get("required"), bool):
            result["required"] = raw["required"]
        return result

    inputs = [
        node for node in (
            artifact_node(item, default_type="artifact", role="input")
            for item in (selected.get("inputs") or [])
        ) if node is not None
    ]
    code: list[dict[str, Any]] = []
    for item in selected.get("code") or []:
        node = artifact_node(item, default_type="software_version", role="code")
        if node is None:
            continue
        for key in ("language", "repository", "commit", "swhid", "entrypoint"):
            if item.get(key) is not None:
                node[key] = item[key]
        code.append(node)
    environments = [
        {**item, "id": item["id"], "name": item.get("name") or item["id"]}
        for item in (selected.get("environments") or [])
        if isinstance(item, dict) and _nonempty(item.get("id"))
    ]
    parameters = [
        {
            "id": item["id"],
            "name": f"Parameter set {item['id']}",
            "values": item.get("values"),
            **({"randomSeed": item["randomSeed"]} if "randomSeed" in item else {}),
        }
        for item in parameter_sets
        if isinstance(item, dict) and _nonempty(item.get("id"))
    ]
    tools = [
        {
            **item,
            "id": item["id"],
            "name": item.get("name") or item["id"],
            "parentId": run_id,
        }
        for item in (selected.get("tools") or [])
        if isinstance(item, dict) and _nonempty(item.get("id"))
    ]

    observed = _create_loop_manifest_envelope(event, manifest) \
        if isinstance(manifest, dict) else None
    observed_approvals = observed.get("approvals", []) if observed else []
    approvals: list[dict[str, Any]] = []
    tool_subject_ids = {
        str(item["id"]) for item in tools
        if isinstance(item, dict) and _nonempty(item.get("id"))
    }
    for requirement in selected.get("approvals") or []:
        if not isinstance(requirement, dict) or _nonempty(requirement.get("id")) is None:
            continue
        declared_subject_id = requirement.get("subjectId")
        subject_id = declared_subject_id
        if subject_id == selected.get("id"):
            subject_id = run_id
        elif subject_id not in tool_subject_ids and subject_id != run_id:
            # Some producer-owned gates target a workflow node which is not a
            # ToolInvocation (for example a human-approval node).  Keep that
            # declared identity as evidence, but bind the decision to the run
            # so AUTHORIZED_BY and conclusion coverage cannot silently vanish.
            subject_id = run_id
        matching = next((
            decision for decision in observed_approvals
            if isinstance(decision, dict)
            and (
                decision.get("subjectId") in {subject_id, declared_subject_id}
                or str(decision.get("subjectId") or "").endswith(
                    f":{declared_subject_id}"
                )
            )
        ), {})
        approvals.append({
            "id": requirement["id"],
            "name": f"Approval {requirement['id']}",
            "kind": requirement.get("kind"),
            "mode": requirement.get("mode"),
            "subjectId": subject_id,
            "policyDigest": requirement.get("policyDigest"),
            "freshDecisionRequired": True,
            "historicalDecisionId": matching.get("id")
                or requirement.get("historicalDecisionId"),
            **({"declaredSubjectId": declared_subject_id}
               if declared_subject_id != subject_id else {}),
            **({
                "observedNodeId": matching.get("decisionNodeId"),
                "observedStatus": matching.get("status"),
                "observedDecision": matching.get("decision"),
                "observedActor": matching.get("actor"),
                "observedRationale": matching.get("rationale"),
            } if matching else {}),
        })

    expected_outputs = [
        node for node in (
            artifact_node(item, default_type="artifact", role="output")
            for item in (selected.get("outputs") or [])
        ) if node is not None
    ]
    outputs = expected_outputs
    if observed:
        observed_outputs = [
            item for item in observed.get("outputs", []) if isinstance(item, dict)
        ]
        matched_observed: set[int] = set()
        merged_outputs: list[dict[str, Any]] = []
        for expected in expected_outputs:
            expected_id = str(expected.get("id") or "")
            expected_name = str(expected.get("name") or "")
            match_index = next((
                index for index, actual in enumerate(observed_outputs)
                if index not in matched_observed and (
                    str(actual.get("id") or "") == expected_id
                    or (
                        expected_id.endswith(":result")
                        and str(actual.get("id") or "").endswith(":result")
                    )
                    or (
                        expected_name
                        and str(actual.get("name") or "") == expected_name
                    )
                )
            ), None)
            if match_index is None:
                merged_outputs.append(expected)
                continue
            matched_observed.add(match_index)
            actual = observed_outputs[match_index]
            merged = dict(expected)
            for key in ("contentDigest", "version", "mediaType", "artifact"):
                if actual.get(key) is not None:
                    merged[key] = _json_copy(actual[key])
            merged_outputs.append(merged)
        # Manifest-only artifacts remain observable outputs, while expected
        # outputs retain the comparator declared by the shared rerun resource.
        merged_outputs.extend(
            actual for index, actual in enumerate(observed_outputs)
            if index not in matched_observed
        )
        outputs = merged_outputs
    relations = list(observed.get("relations", [])) if observed else []
    raw_rerun = event.get("rerunOfRunId")
    if _nonempty(raw_rerun):
        relations.append({"src": run_id, "dst": raw_rerun, "rel": "rerun_of"})
    envelope: dict[str, Any] = {
        "inputs": inputs,
        "code": code,
        "environment": environments,
        "parameters": parameters,
        "tools": tools,
        "approvals": approvals,
        "outputs": outputs,
        "relations": relations,
    }
    if activity_type == "workflow_run":
        envelope["workflowRun"] = raw_activity
    else:
        envelope["activity"] = raw_activity
    return envelope


_RAW_SECRET_FIELDS = frozenset({
    "secret", "password", "passwd", "passphrase", "token", "accesstoken",
    "authtoken", "bearertoken", "refreshtoken", "idtoken", "apikey",
    "apisecret", "clientsecret", "credential", "credentials", "authorization",
    "cookie", "privatekey",
})
_SECRET_REFERENCE_PREFIX = "__SCIFORGE_SECRET_REF__:"
_SENSITIVE_HEADER_NAMES = frozenset({
    "authorization", "cookie", "proxy-authorization", "x-api-key",
})


def _is_secret_field_name(normalized: str) -> bool:
    if normalized in _RAW_SECRET_FIELDS:
        return True
    return normalized.endswith((
        "password", "passwd", "accesstoken", "authtoken", "bearertoken",
        "apikey", "clientsecret", "credential", "credentials", "privatekey",
    )) or normalized.endswith("token") and not normalized.endswith("tokens")


def _url_contains_secret(value: str) -> bool:
    try:
        parsed = urlsplit(value)
    except ValueError:
        return False
    if not parsed.scheme:
        return False
    if parsed.username is not None or parsed.password is not None:
        return True
    sensitive_query = {
        "sig", "signature", "sas", "xamzsignature", "xamzcredential",
    }
    for key, raw_value in parse_qsl(parsed.query, keep_blank_values=True):
        normalized = "".join(char for char in key.lower() if char.isalnum())
        if (_is_secret_field_name(normalized) or normalized in sensitive_query) \
                and not _secret_placeholder(raw_value):
            return True
    return False


def _raw_secret_path(value: Any, *, path: str = "activity") -> Optional[str]:
    """Return the first raw credential path, allowing only empty/slot values."""
    if isinstance(value, dict):
        declared_name = next((
            str(value[key]) for key in ("key", "name")
            if isinstance(value.get(key), str) and str(value[key]).strip()
        ), "")
        redact_declared_value = declared_name.strip().lower() in _SENSITIVE_HEADER_NAMES \
            or _is_secret_field_name(
                "".join(char for char in declared_name.lower() if char.isalnum())
            )
        if str(value.get("type") or "").strip().lower() == "secret" \
                and "value" in value and not _secret_placeholder(value.get("value")):
            return f"{path}.value"
        for raw_key, raw_value in value.items():
            key = str(raw_key)
            normalized = "".join(char for char in key.lower() if char.isalnum())
            child = f"{path}.{key}"
            declared_secret_value = redact_declared_value \
                and key in {"value", "defaultValue"}
            if (_is_secret_field_name(normalized) or declared_secret_value) \
                    and not _secret_placeholder(raw_value):
                return child
            found = _raw_secret_path(raw_value, path=child)
            if found:
                return found
    elif isinstance(value, list):
        for index, item in enumerate(value):
            found = _raw_secret_path(item, path=f"{path}[{index}]")
            if found:
                return found
    elif isinstance(value, str) and _url_contains_secret(value):
        return path
    return None


def _secret_placeholder(value: Any) -> bool:
    if value in (None, ""):
        return True
    if isinstance(value, dict) and set(value) == {"secretRef"} \
            and _nonempty(value.get("secretRef")) is not None:
        return True
    if isinstance(value, str) and value.startswith(_SECRET_REFERENCE_PREFIX) \
            and bool(value[len(_SECRET_REFERENCE_PREFIX):].strip()):
        return True
    if not isinstance(value, str) or not value.startswith("${") or not value.endswith("}"):
        return False
    name = value[2:-1]
    return bool(name) and (name[0].isalpha() or name[0] == "_") \
        and all(char.isalnum() or char == "_" for char in name)


def _redact_metadata(value: Any, *, path: str) -> Any:
    if isinstance(value, dict):
        is_secret_record = str(value.get("type") or "").strip().lower() == "secret"
        declared_name = next((
            str(value[key]) for key in ("key", "name")
            if isinstance(value.get(key), str) and str(value[key]).strip()
        ), "")
        redact_declared_value = declared_name.strip().lower() in _SENSITIVE_HEADER_NAMES \
            or _is_secret_field_name(
                "".join(char for char in declared_name.lower() if char.isalnum())
            )
        result: dict[str, Any] = {}
        for raw_key, raw_value in value.items():
            key = str(raw_key)
            normalized = "".join(char for char in key.lower() if char.isalnum())
            child_path = f"{path}.{key}"
            declared_secret_value = redact_declared_value \
                and key in {"value", "defaultValue"}
            if (is_secret_record and key == "value") \
                    or _is_secret_field_name(normalized) or declared_secret_value:
                result[key] = raw_value if _secret_placeholder(raw_value) \
                    else {"secretRef": child_path}
            else:
                result[key] = _redact_metadata(raw_value, path=child_path)
        return result
    if isinstance(value, list):
        return [_redact_metadata(item, path=f"{path}[{index}]")
                for index, item in enumerate(value)]
    if isinstance(value, str) and _url_contains_secret(value):
        return {"secretRef": path}
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


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
        json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)
        return True
    except (TypeError, ValueError):
        return False


def _json_copy(value: Any) -> Any:
    return json.loads(json.dumps(
        value, ensure_ascii=False, sort_keys=True, allow_nan=False,
    ))
