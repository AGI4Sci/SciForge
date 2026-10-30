"""Canonical, non-executing ``sciforge.rerun.v1`` projection.

The TypeScript schema in ``@sciforge/domain-sdk/reproducibility`` is the
authoritative wire contract.  This module emits that exact shape from one
immutable Evidence Snapshot; it deliberately does not define another replay
dialect or execute a workflow.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from datetime import datetime
from decimal import Decimal
from typing import Any, Optional, TYPE_CHECKING
from urllib.parse import parse_qsl, urlsplit

from .model import EdgeRel, Node, NodeType

if TYPE_CHECKING:  # pragma: no cover
    from .graph import ThreadGraph
    from .snapshot import EvidenceSnapshot


RERUN_SCHEMA_VERSION = "sciforge.rerun.v1"
RERUN_COMPARISON_VERSION = "sciforge.rerun-comparison.v1"
_DIGEST_PREFIX = "sha256:"
_SECRET_REFERENCE_PREFIX = "__SCIFORGE_SECRET_REF__:"
_MAX_SAFE_INTEGER = (1 << 53) - 1
_SENSITIVE_HEADER_NAMES = frozenset({
    "authorization", "cookie", "proxy-authorization", "x-api-key",
})
_SECRET_FIELD_NAMES = frozenset({
    "secret", "password", "passwd", "passphrase", "token", "accesstoken",
    "authtoken", "bearertoken", "refreshtoken", "idtoken", "apikey",
    "apisecret", "clientsecret", "credential", "credentials", "authorization",
    "cookie", "privatekey",
})
_ACTIVITY_TYPES = frozenset({
    NodeType.EXPERIMENT_RUN,
    NodeType.ANALYSIS_RUN,
    NodeType.WORKFLOW_RUN,
    NodeType.TOOL_INVOCATION,
})
_RUN_TYPES = frozenset({
    NodeType.EXPERIMENT_RUN,
    NodeType.ANALYSIS_RUN,
    NodeType.WORKFLOW_RUN,
})
_INPUT_TYPES = frozenset({
    NodeType.ARTIFACT,
    NodeType.DATASET_VERSION,
    NodeType.OBSERVATION,
    NodeType.SOURCE_ASSERTION,
})
_BREAKPOINT_COMPONENTS = frozenset({
    "executor", "input", "code", "environment", "parameters", "tool",
    "approval", "artifact", "output", "randomness", "lineage",
})
_RFC3339_TIMESTAMP = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$"
)


def _canonical_json(value: Any) -> str:
    """Mirror JSON.stringify over recursively key-sorted JSON values."""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        try:
            value.encode("utf-8")
        except UnicodeEncodeError as exc:
            raise ValueError("canonical JSON rejects lone UTF-16 surrogates") from exc
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, int):
        if abs(value) <= _MAX_SAFE_INTEGER:
            return str(value)
        # A JSON number written by JavaScript can be lexically integral yet
        # exceed Number.MAX_SAFE_INTEGER (JSON.stringify(1e20) is the canonical
        # example).  json.loads turns that token into a Python int, so restore
        # ECMAScript's binary64 semantics before serialising it.  Producer-side
        # graph metadata is handled separately by _safe_value, which converts
        # unsafe source integers to decimal strings and emits a breakpoint.
        try:
            binary64 = float(value)
        except OverflowError as exc:
            raise ValueError("canonical JSON number exceeds binary64 range") from exc
        if not math.isfinite(binary64):
            raise ValueError("canonical JSON number exceeds binary64 range")
        return _canonical_json(binary64)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("reproducibility metadata numbers must be finite")
        if value == 0:
            return "0"
        absolute = abs(value)
        representation = repr(value).lower()
        if 1e-6 <= absolute < 1e21:
            fixed = format(Decimal(representation), "f")
            if "." in fixed:
                fixed = fixed.rstrip("0").rstrip(".")
            return fixed
        mantissa, exponent = representation.split("e")
        if mantissa.endswith(".0"):
            mantissa = mantissa[:-2]
        sign = "+" if not exponent.startswith("-") else "-"
        digits = exponent.lstrip("+-0") or "0"
        return f"{mantissa}e{sign}{digits}"
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(_canonical_json(item) for item in value) + "]"
    if isinstance(value, dict):
        if not all(isinstance(key, str) for key in value):
            raise TypeError("canonical JSON object keys must be strings")
        return "{" + ",".join(
            f"{_canonical_json(key)}:{_canonical_json(value[key])}"
            for key in sorted(
                value,
                key=lambda item: item.encode("utf-16-be"),
            )
        ) + "}"
    raise TypeError(f"value is not JSON-safe: {type(value).__name__}")


def _digest(value: Any) -> str:
    return _DIGEST_PREFIX + hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _is_digest(value: Any) -> bool:
    if not isinstance(value, str) or not value.startswith(_DIGEST_PREFIX):
        return False
    raw = value[len(_DIGEST_PREFIX):]
    return len(raw) == 64 and all(char in "0123456789abcdef" for char in raw)


def _text(value: Any) -> Optional[str]:
    if isinstance(value, (str, int, float)) and str(value).strip():
        return str(value).strip()
    return None


def _json_copy(value: Any) -> Any:
    return json.loads(_canonical_json(value))


def _secret_slot_id(path: str) -> str:
    readable = "".join(char if char.isalnum() or char in "._-" else "_" for char in path)
    if len(readable) <= 420:
        return f"secret:{readable}"
    return f"secret:{readable[:380]}:{hashlib.sha256(path.encode('utf-8')).hexdigest()[:24]}"


def _safe_value(value: Any, *, path: str, secret_slots: dict[str, str]) -> Any:
    """Return JSON-safe metadata with secret values replaced by named slots."""
    if isinstance(value, dict):
        declared_name = next((
            str(value[key]) for key in ("key", "name")
            if isinstance(value.get(key), str) and str(value[key]).strip()
        ), "")
        redact_declared_value = _is_sensitive_header_name(declared_name) \
            or _is_secret_field_name(_normalized_field_name(declared_name))
        result: dict[str, Any] = {}
        for raw_key, raw_value in sorted(value.items(), key=lambda item: str(item[0])):
            key = str(raw_key)
            normalized = _normalized_field_name(key)
            child_path = f"{path}.{key}" if path else key
            declared_secret_value = redact_declared_value \
                and key in {"value", "defaultValue"}
            if (_is_secret_field_name(normalized) or declared_secret_value) \
                    and _is_environment_reference(raw_value):
                result[key] = raw_value
            elif _safe_secret_reference(raw_value) is not None and (
                _is_secret_field_name(normalized)
                or declared_secret_value
            ):
                slot_id = _safe_secret_reference(raw_value)
                assert slot_id is not None
                secret_slots[slot_id] = child_path
                result[key] = _json_copy(raw_value)
            elif _is_secret_field_name(normalized) or declared_secret_value:
                slot_id = _secret_slot_id(child_path)
                secret_slots[slot_id] = child_path
                result[key] = {"secretRef": slot_id}
            else:
                result[key] = _safe_value(
                    raw_value, path=child_path, secret_slots=secret_slots,
                )
        return result
    if isinstance(value, (list, tuple)):
        return [
            _safe_value(item, path=f"{path}[{index}]", secret_slots=secret_slots)
            for index, item in enumerate(value)
        ]
    if isinstance(value, int) and not isinstance(value, bool) \
            and abs(value) > _MAX_SAFE_INTEGER:
        return str(value)
    if isinstance(value, str) and _url_contains_secret(value):
        slot_id = _secret_slot_id(path)
        secret_slots[slot_id] = path
        return {"secretRef": slot_id}
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def _is_secret_field_name(normalized: str) -> bool:
    if normalized in _SECRET_FIELD_NAMES:
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
        normalized = _normalized_field_name(key)
        if (_is_secret_field_name(normalized) or normalized in sensitive_query) \
                and not (_is_environment_reference(raw_value)
                         or _safe_secret_reference(raw_value) is not None):
            return True
    return False


def _normalized_field_name(value: str) -> str:
    return "".join(char for char in value.lower() if char.isalnum())


def _is_sensitive_header_name(value: str) -> bool:
    return value.strip().lower() in _SENSITIVE_HEADER_NAMES


def _safe_secret_reference(value: Any) -> Optional[str]:
    if isinstance(value, dict) and set(value) == {"secretRef"} \
            and _text(value.get("secretRef")):
        return str(value["secretRef"]).strip()
    if isinstance(value, str) and value.startswith(_SECRET_REFERENCE_PREFIX) \
            and value[len(_SECRET_REFERENCE_PREFIX):].strip():
        return value[len(_SECRET_REFERENCE_PREFIX):].strip()
    return None


def _is_environment_reference(value: Any) -> bool:
    if not isinstance(value, str) or not value.startswith("${") or not value.endswith("}"):
        return False
    name = value[2:-1]
    return bool(name) and (name[0].isalpha() or name[0] == "_") \
        and all(char.isalnum() or char == "_" for char in name)


def _role(node: Node) -> Optional[str]:
    for key in ("semanticRole", "lineageRole"):
        value = node.attributes.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _artifact_reference(
    graph: "ThreadGraph",
    node: Node,
    *,
    role: str,
    required: bool = True,
    secret_slots: Optional[dict[str, str]] = None,
) -> dict[str, Any]:
    artifact = graph.artifacts.get(node.artifact_id or "")
    version = graph.artifact_versions.get(node.artifact_version_id or "")
    result: dict[str, Any] = {
        "id": node.external_id or node.id,
        "role": role,
        "kind": artifact.kind if artifact is not None else node.type.value,
        "name": node.content,
        "required": required,
    }
    if artifact is not None:
        result["artifactId"] = artifact.artifact_id
    if version is not None and artifact is not None and version.artifact_id == artifact.artifact_id:
        result["artifactVersionId"] = version.version_id
        if _url_contains_secret(version.locator):
            slot_id = _secret_slot_id(f"artifacts.{result['id']}.locator")
            if secret_slots is not None:
                secret_slots[slot_id] = f"artifacts.{result['id']}.locator"
            result["locator"] = f"{_SECRET_REFERENCE_PREFIX}{slot_id}"
        else:
            result["locator"] = version.locator
        if version.content_digest:
            result["contentDigest"] = version.content_digest
        if version.version:
            result["version"] = version.version
        if version.media_type:
            result["mediaType"] = version.media_type
    attributes = node.attributes
    if "contentDigest" not in result and _is_digest(attributes.get("contentDigest")):
        result["contentDigest"] = attributes["contentDigest"]
    if "version" not in result and _text(attributes.get("version")):
        result["version"] = _text(attributes.get("version"))
    if node.type == NodeType.OBSERVATION and all(
        key in attributes for key in ("value", "unit", "observedAt")
    ):
        result.setdefault("contentDigest", _digest({
            "value": attributes["value"],
            "unit": attributes["unit"],
            "observedAt": attributes["observedAt"],
        }))
    return result


def _code_reference(
    graph: "ThreadGraph", node: Node, *, secret_slots: dict[str, str],
) -> dict[str, Any]:
    result = _artifact_reference(graph, node, role="code", secret_slots=secret_slots)
    attributes = node.attributes
    for source, target in (
        ("language", "language"),
        ("repository", "repository"),
        ("commit", "commit"),
        ("swhid", "swhid"),
        ("entrypoint", "entrypoint"),
    ):
        value = _text(attributes.get(source))
        if value:
            if target == "repository" and _url_contains_secret(value):
                slot_id = _secret_slot_id(f"code.{node.external_id or node.id}.repository")
                secret_slots[slot_id] = f"code.{node.external_id or node.id}.repository"
                # Repository is URL-shaped in the shared contract.  Omitting a
                # credential-bearing value keeps the export valid and forces
                # replay to obtain it through the named secret slot.
                continue
            else:
                result[target] = value
    return result


def _environment_reference(
    node: Node, *, secret_slots: dict[str, str],
) -> dict[str, Any]:
    attributes = node.attributes
    runtime_versions: dict[str, str] = {}
    declared_versions = attributes.get("runtimeVersions")
    if not isinstance(declared_versions, dict):
        declared_versions = attributes.get("specification")
    if isinstance(declared_versions, dict):
        runtime_versions = {
            str(key): str(value)
            for key, value in declared_versions.items()
            if _text(key) and _text(value)
        }
    lock_digests: list[str] = []
    values = attributes.get("lockDigests")
    if isinstance(values, list):
        lock_digests.extend(str(value) for value in values if _is_digest(value))
    if _is_digest(attributes.get("lockDigest")):
        lock_digests.append(str(attributes["lockDigest"]))
    result: dict[str, Any] = {
        "id": node.external_id or node.id,
        "name": node.content,
        "runtimeVersions": dict(sorted(runtime_versions.items())),
        "lockDigests": sorted(set(lock_digests)),
    }
    for key in ("platform", "architecture"):
        value = _text(attributes.get(key))
        if value:
            result[key] = value
    for key in ("containerDigest", "contentDigest"):
        if _is_digest(attributes.get(key)):
            result[key] = attributes[key]
    safe_attributes = _safe_value(
        attributes, path=f"environments.{node.external_id or node.id}",
        secret_slots=secret_slots,
    )
    if safe_attributes:
        result["attributes"] = safe_attributes
    return result


def _parameter_reference(
    node: Node, *, secret_slots: dict[str, str], fallback_seed: Any = None,
) -> dict[str, Any]:
    raw_values = node.attributes.get("values")
    values = raw_values if _is_json_value(raw_values) else {}
    safe_values = _safe_value(
        values, path=f"parameters.{node.external_id or node.id}",
        secret_slots=secret_slots,
    )
    result: dict[str, Any] = {
        "id": node.external_id or node.id,
        "values": safe_values,
        "digest": _digest(safe_values),
    }
    random_seed = node.attributes.get("randomSeed", fallback_seed)
    if isinstance(random_seed, (str, int, float)) and not isinstance(random_seed, bool):
        result["randomSeed"] = random_seed
    return result


def _is_json_value(value: Any) -> bool:
    try:
        json.dumps(value, ensure_ascii=False, allow_nan=False)
        return True
    except (TypeError, ValueError, UnicodeError):
        return False


def _unsafe_integer_paths(value: Any, *, path: str = "") -> list[str]:
    if isinstance(value, bool) or value is None:
        return []
    if isinstance(value, int):
        return [path or "value"] if abs(value) > _MAX_SAFE_INTEGER else []
    if isinstance(value, list):
        return [
            found
            for index, item in enumerate(value)
            for found in _unsafe_integer_paths(item, path=f"{path}[{index}]")
        ]
    if isinstance(value, dict):
        return [
            found
            for key, item in value.items()
            for found in _unsafe_integer_paths(
                item, path=f"{path}.{key}" if path else str(key),
            )
        ]
    return []


def _tool_reference(node: Node, *, secret_slots: dict[str, str]) -> dict[str, Any]:
    attributes = node.attributes
    arguments = attributes.get("arguments", attributes.get("parameters"))
    safe_arguments = _safe_value(
        arguments if isinstance(arguments, (dict, list)) else {},
        path=f"tools.{node.external_id or node.id}.arguments",
        secret_slots=secret_slots,
    )
    result: dict[str, Any] = {
        "id": node.external_id or node.id,
        "name": node.content,
        "arguments": safe_arguments,
        "argumentsDigest": _digest(safe_arguments),
        "stochastic": attributes.get("stochastic") is True,
        "supportsSeed": attributes.get("supportsSeed") is True,
    }
    for key in ("providerId", "actionId", "version"):
        value = _text(attributes.get(key))
        if value:
            result[key] = value
    if _is_digest(attributes.get("resultDigest")):
        result["resultDigest"] = attributes["resultDigest"]
    return result


def _approval_decision_fingerprint(
    node: Node, subject_id: str,
) -> Optional[str]:
    """Hash the observed decision while excluding its fresh request identity."""
    attributes = node.attributes
    projection: dict[str, Any] = {}
    decision_node_id = next((
        _text(attributes.get(key))
        for key in ("observedNodeId", "decisionNodeId", "declaredSubjectId")
        if _text(attributes.get(key))
    ), None) or subject_id
    projection["nodeId"] = decision_node_id
    for output_key, source_keys in (
        ("status", ("observedStatus", "status")),
        ("decision", ("observedDecision", "decision")),
        ("actor", ("observedActor", "actor")),
        ("rationale", ("observedRationale", "rationale")),
    ):
        value = next((
            _text(attributes.get(key)) for key in source_keys
            if _text(attributes.get(key))
        ), None)
        if value is not None:
            projection[output_key] = value
    if len(projection) == 1:
        return None
    return _digest(projection)


def _approval_requirement_projection(item: dict[str, Any]) -> dict[str, Any]:
    """Return replay requirements without captured historical outcomes."""
    return {
        key: value for key, value in item.items()
        if key not in {"historicalDecisionId", "historicalDecisionFingerprint"}
    }


def _approval_reference(graph: "ThreadGraph", node: Node, subject_id: str) -> dict[str, Any]:
    attributes = node.attributes
    kind = attributes.get("kind")
    if kind not in {
        "capability-confirmation", "workflow-human-approval", "policy-gate",
    }:
        kind = "workflow-human-approval"
    result: dict[str, Any] = {
        "id": node.external_id or node.id,
        "kind": kind,
        "subjectId": subject_id,
        "mode": _text(attributes.get("mode")) or "fresh-decision",
        "freshDecisionRequired": True,
        "historicalDecisionId": _text(attributes.get("historicalDecisionId"))
            or node.external_id or node.id,
    }
    decision_fingerprint = _approval_decision_fingerprint(node, subject_id)
    if decision_fingerprint is not None:
        result["historicalDecisionFingerprint"] = decision_fingerprint
    if _is_digest(attributes.get("policyDigest")):
        result["policyDigest"] = attributes["policyDigest"]
    return result


def _output_comparator(node: Node) -> dict[str, Any]:
    raw = node.attributes.get("comparator")
    if not isinstance(raw, dict):
        return {"kind": "exact-digest"}
    kind = raw.get("kind")
    result: dict[str, Any]
    if kind == "exact-digest":
        return {"kind": kind}
    if kind == "numeric":
        absolute = raw.get("absoluteTolerance")
        if not isinstance(absolute, (int, float)) or isinstance(absolute, bool) or absolute < 0:
            return {"kind": "exact-digest"}
        result = {"kind": kind, "absoluteTolerance": absolute}
    elif kind == "json-structural":
        result = {"kind": kind}
    elif kind == "table":
        result = {
            "kind": kind,
            "keyColumns": [str(item) for item in raw.get("keyColumns", []) if _text(item)],
            "valueColumns": [str(item) for item in raw.get("valueColumns", []) if _text(item)],
        }
    else:
        return {"kind": "exact-digest"}
    for key in ("absoluteTolerance", "relativeTolerance"):
        value = raw.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0:
            result[key] = value
    return result


def _expected_output(
    graph: "ThreadGraph", node: Node, *, role: str, required: bool,
    secret_slots: Optional[dict[str, str]] = None,
) -> dict[str, Any]:
    result = _artifact_reference(
        graph, node, role=role, required=required, secret_slots=secret_slots,
    )
    if "contentDigest" not in result and node.type in {
        NodeType.SOURCE_ASSERTION, NodeType.FINDING, NodeType.OBSERVATION,
    }:
        result["contentDigest"] = _digest({"type": node.type.value, "content": node.content})
    result["comparator"] = _output_comparator(node)
    if _is_digest(result.get("contentDigest")):
        result["baselineDigest"] = result["contentDigest"]
    return result


def _executor(
    node: Node, *, secret_slots: dict[str, str],
) -> tuple[dict[str, Any], Optional[str]]:
    raw = node.attributes.get("executor")
    if isinstance(raw, dict) and raw.get("kind") == "create-loop":
        workflow = raw.get("workflow")
        workflow_digest = raw.get("workflowDigest")
        target = raw.get("target")
        if isinstance(workflow, (dict, list)) and _is_digest(workflow_digest) \
                and isinstance(target, dict) and target.get("kind") in {"workflow", "node"} \
                and _text(target.get("id")):
            try:
                observed_digest = _digest(workflow)
            except (TypeError, ValueError):
                observed_digest = None
            if observed_digest != workflow_digest:
                redacted = _contains_secret_reference(workflow)
                return ({
                    "kind": "unavailable",
                    "reason": (
                        "The executor payload changed during credential redaction and no "
                        "longer matches its declared digest."
                        if redacted else
                        "The executor payload does not match its declared workflow digest."
                    ),
                }, "executor_secret_redacted" if redacted else "executor_digest_mismatch")
            for slot_id in _secret_references(workflow):
                secret_slots.setdefault(slot_id, slot_id)
            return ({
                "kind": "create-loop",
                "workflow": _json_copy(workflow),
                "workflowDigest": workflow_digest,
                "target": {"kind": target["kind"], "id": str(target["id"]).strip()},
            }, None)
        return ({
            "kind": "unavailable",
            "reason": "Declared create-loop executor metadata is incomplete.",
        }, "executor_metadata_incomplete")
    if isinstance(raw, dict) and raw.get("kind") == "unavailable" and _text(raw.get("reason")):
        return ({"kind": "unavailable", "reason": str(raw["reason"]).strip()},
                "executor_unavailable")
    return ({
        "kind": "unavailable",
        "reason": "The Evidence Snapshot records the activity but no executable definition.",
    }, "executor_not_declared")


def _secret_references(value: Any) -> set[str]:
    direct = _safe_secret_reference(value)
    if direct is not None:
        return {direct}
    if isinstance(value, dict):
        result: set[str] = set()
        for item in value.values():
            result.update(_secret_references(item))
        return result
    if isinstance(value, list):
        return {slot for item in value for slot in _secret_references(item)}
    return set()


def _contains_secret_reference(value: Any) -> bool:
    return bool(_secret_references(value))


def _selected_activities(
    graph: "ThreadGraph", lineage: dict[str, Any], conclusion_id: str,
) -> list[Node]:
    component_ids = set(lineage["coverage"]["components"].get("activities", []))
    activities = {node_id: graph.nodes[node_id] for node_id in component_ids
                  if node_id in graph.nodes and graph.nodes[node_id].type in _ACTIVITY_TYPES}
    if not activities:
        return []
    selected_edges = {
        edge["id"] for edge in lineage.get("edges", []) if isinstance(edge, dict) and edge.get("id")
    }
    by_src = graph.edges_by_src()
    direct: set[str] = set()
    evidence_ids = set(lineage["coverage"]["components"].get("evidence", [])) | {conclusion_id}
    for evidence_id in evidence_ids:
        for edge in by_src.get(evidence_id, ()):
            if edge.id in selected_edges and edge.rel == EdgeRel.GENERATED_BY \
                    and edge.dst in activities:
                direct.add(edge.dst)
    candidates = direct or set(activities)
    # A child activity is replayed by its containing workflow/run when that
    # parent is present.  Standalone tool invocations remain valid units.
    parent_by_child = {
        edge.src: edge.dst
        for edge in graph.edges.values()
        if edge.rel == EdgeRel.PART_OF and edge.src in activities and edge.dst in activities
    }
    top_level: set[str] = set()
    for activity_id in candidates:
        seen = {activity_id}
        current = activity_id
        while parent_by_child.get(current) in activities and parent_by_child[current] not in seen:
            current = parent_by_child[current]
            seen.add(current)
        top_level.add(current)
    return [activities[node_id] for node_id in sorted(top_level)]


def _activity_members(graph: "ThreadGraph", activity_id: str) -> set[str]:
    members = {activity_id}
    pending = [activity_id]
    by_dst = graph.edges_by_dst()
    while pending:
        parent = pending.pop()
        for edge in by_dst.get(parent, ()):
            if edge.rel != EdgeRel.PART_OF or edge.src in members:
                continue
            child = graph.nodes.get(edge.src)
            if child is not None and child.type in _ACTIVITY_TYPES:
                members.add(child.id)
                pending.append(child.id)
    return members


def _breakpoint(
    code: str,
    component: str,
    message: str,
    *,
    blocking: bool,
    activity_id: Optional[str] = None,
    node_id: Optional[str] = None,
) -> dict[str, Any]:
    normalized_component = component if component in _BREAKPOINT_COMPONENTS else "lineage"
    result: dict[str, Any] = {
        "code": code,
        "component": normalized_component,
        "message": message,
        "blocking": blocking,
    }
    if activity_id:
        result["activityId"] = activity_id
    if node_id:
        result["nodeId"] = node_id
    return result


def _build_activity(
    graph: "ThreadGraph",
    activity: Node,
    *,
    secret_slots: dict[str, str],
) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    shared = activity.attributes.get("sharedReproResource")
    if isinstance(shared, dict):
        source_activity = shared.get("activity")
        source_breakpoints = shared.get("breakpoints")
        source_slots = shared.get("secretSlots")
        if isinstance(source_activity, dict) and isinstance(source_breakpoints, list) \
                and isinstance(source_slots, list):
            # This activity already passed the shared SDK contract at ingestion.
            # Preserve it exactly: private Evidence completeness heuristics must
            # not silently downgrade an executable producer-owned resource.
            return (
                _json_copy(source_activity),
                [_json_copy(item) for item in source_breakpoints if isinstance(item, dict)],
                [_json_copy(item) for item in source_slots if isinstance(item, dict)],
            )
    member_ids = _activity_members(graph, activity.id)
    by_src, by_dst = graph.edges_by_src(), graph.edges_by_dst()
    used_ids = {
        edge.dst for member_id in member_ids for edge in by_src.get(member_id, ())
        if edge.rel == EdgeRel.USED and edge.dst not in member_ids
    }
    generated_ids = {
        edge.src for member_id in member_ids for edge in by_dst.get(member_id, ())
        if edge.rel == EdgeRel.GENERATED_BY and edge.src not in member_ids
    }
    tool_nodes = [
        graph.nodes[node_id] for node_id in sorted(member_ids - {activity.id})
        if graph.nodes[node_id].type == NodeType.TOOL_INVOCATION
    ]
    inputs = [
        _artifact_reference(
            graph, graph.nodes[node_id], role="input", secret_slots=secret_slots,
        )
        for node_id in sorted(used_ids)
        if graph.nodes[node_id].type in _INPUT_TYPES or _role(graph.nodes[node_id]) == "input"
    ]
    code_nodes = [
        graph.nodes[node_id] for node_id in sorted(used_ids)
        if graph.nodes[node_id].type == NodeType.SOFTWARE_VERSION
        or _role(graph.nodes[node_id]) == "code"
    ]
    code = [_code_reference(graph, node, secret_slots=secret_slots) for node in code_nodes]
    environments = [
        _environment_reference(graph.nodes[node_id], secret_slots=secret_slots)
        for node_id in sorted(used_ids)
        if graph.nodes[node_id].type == NodeType.ENVIRONMENT
    ]
    parameter_nodes = [
        graph.nodes[node_id] for node_id in sorted(used_ids)
        if graph.nodes[node_id].type == NodeType.PARAMETER_SET
    ]
    for tool in tool_nodes:
        parameter_nodes.extend(
            graph.nodes[edge.dst] for edge in by_src.get(tool.id, ())
            if edge.rel == EdgeRel.USED
            and graph.nodes[edge.dst].type == NodeType.PARAMETER_SET
            and graph.nodes[edge.dst] not in parameter_nodes
        )
    seed = activity.attributes.get("randomSeed")
    parameter_sets = [
        _parameter_reference(node, secret_slots=secret_slots, fallback_seed=seed)
        for node in parameter_nodes
    ]
    tools = [_tool_reference(node, secret_slots=secret_slots) for node in tool_nodes]

    approvals: list[dict[str, Any]] = []
    subjects = [activity, *tool_nodes]
    for subject in subjects:
        for edge in by_src.get(subject.id, ()):
            node = graph.nodes.get(edge.dst)
            if edge.rel == EdgeRel.AUTHORIZED_BY and node is not None \
                    and node.type == NodeType.APPROVAL_DECISION:
                approvals.append(_approval_reference(
                    graph, node, subject.external_id or subject.id,
                ))

    outputs: list[dict[str, Any]] = []
    for node_id in sorted(generated_ids):
        node = graph.nodes[node_id]
        role = _role(node)
        if role == "log":
            outputs.append(_expected_output(
                graph, node, role="log", required=False, secret_slots=secret_slots,
            ))
        elif role == "output" or node.type in {
            NodeType.ARTIFACT, NodeType.DATASET_VERSION, NodeType.OBSERVATION,
        }:
            outputs.append(_expected_output(
                graph, node, role="output", required=True, secret_slots=secret_slots,
            ))
        elif role == "evidence" or node.type in {
            NodeType.SOURCE_ASSERTION, NodeType.FINDING,
        }:
            outputs.append(_expected_output(
                graph, node, role="evidence", required=True, secret_slots=secret_slots,
            ))

    executor, executor_error = _executor(activity, secret_slots=secret_slots)
    stochastic = activity.attributes.get("stochastic") is True \
        or any(tool["stochastic"] for tool in tools)
    computed_input_fingerprint = _digest(sorted(inputs, key=_canonical_json))
    execution_context_projection = {
        "executor": _executor_context_projection(executor),
        "code": code,
        "environments": environments,
        "parameterSets": parameter_sets,
        "tools": tools,
        # Historical decisions are evidence only; the replay requirement is
        # always a fresh decision and therefore excludes captured outcomes.
        "approvals": [_approval_requirement_projection(item) for item in approvals],
    }
    computed_context_fingerprint = _digest(execution_context_projection)
    required_outputs = [item for item in outputs if item["required"]]
    computed_output_fingerprint = _digest(sorted(required_outputs, key=_canonical_json))
    computed_spec_fingerprint = _digest({
        "inputFingerprint": computed_input_fingerprint,
        "executionContextFingerprint": computed_context_fingerprint,
        "stochastic": stochastic,
        "outputs": [{
            "role": item["role"],
            "kind": item["kind"],
            "name": item.get("name"),
            "comparator": item["comparator"],
        } for item in required_outputs],
    })
    producer_baseline: dict[str, Any] = {}
    if executor.get("kind") == "create-loop" and isinstance(executor.get("workflow"), dict):
        raw_baseline = executor["workflow"].get("baseline")
        if isinstance(raw_baseline, dict):
            producer_baseline = raw_baseline

    def producer_fingerprint(
        baseline_key: str, attribute_keys: tuple[str, ...],
    ) -> Optional[str]:
        declared = producer_baseline.get(baseline_key)
        if _is_digest(declared):
            return declared
        for key in attribute_keys:
            declared = activity.attributes.get(key)
            if _is_digest(declared):
                return declared
        return None

    result = {
        "id": activity.external_id or activity.id,
        "type": activity.type.value,
        "name": activity.content,
        "executor": executor,
        "inputs": inputs,
        "code": code,
        "environments": environments,
        "parameterSets": parameter_sets,
        "tools": tools,
        "approvals": sorted(approvals, key=_canonical_json),
        "outputs": outputs,
        "stochastic": stochastic,
        "inputFingerprint": computed_input_fingerprint,
        "specFingerprint": computed_spec_fingerprint,
        "executionContextFingerprint": computed_context_fingerprint,
        "baselineOutputFingerprint": computed_output_fingerprint,
    }

    activity_id = result["id"]
    breakpoints: list[dict[str, Any]] = []
    if executor_error:
        breakpoints.append(_breakpoint(
            executor_error, "executor", executor["reason"], blocking=True,
            activity_id=activity_id, node_id=activity.id,
        ))
    if not inputs:
        breakpoints.append(_breakpoint(
            "input_not_declared", "input", "No exact activity input is declared.",
            blocking=True, activity_id=activity_id,
        ))
    for item in inputs:
        if not _is_digest(item.get("contentDigest")):
            breakpoints.append(_breakpoint(
                "input_digest_missing", "input",
                "An input has no exact SHA-256 content digest.", blocking=True,
                activity_id=activity_id, node_id=item["id"],
            ))
    if not code and not tools:
        breakpoints.append(_breakpoint(
            "code_or_tool_not_declared", "code",
            "Neither exact code nor a versioned tool is declared.", blocking=True,
            activity_id=activity_id,
        ))
    for item in code:
        if not any((_is_digest(item.get("contentDigest")), item.get("commit"), item.get("swhid"))):
            breakpoints.append(_breakpoint(
                "code_revision_missing", "code",
                "Code must reference a content digest, commit, or SWHID.", blocking=True,
                activity_id=activity_id, node_id=item["id"],
            ))
    if not environments:
        breakpoints.append(_breakpoint(
            "environment_not_declared", "environment",
            "No reproducible environment is declared.", blocking=True,
            activity_id=activity_id,
        ))
    for item in environments:
        if not any((_is_digest(item.get("containerDigest")),
                    _is_digest(item.get("contentDigest")), item["lockDigests"])):
            breakpoints.append(_breakpoint(
                "environment_digest_missing", "environment",
                "Environment metadata has no container, content, or lock digest.",
                blocking=True, activity_id=activity_id, node_id=item["id"],
            ))
    if not parameter_sets:
        breakpoints.append(_breakpoint(
            "parameters_not_declared", "parameters",
            "No explicit parameter set is declared.", blocking=True,
            activity_id=activity_id,
        ))
    for item in tools:
        if not item.get("version"):
            breakpoints.append(_breakpoint(
                "tool_version_missing", "tool", "A tool version is not declared.",
                blocking=True, activity_id=activity_id, node_id=item["id"],
            ))
    if not required_outputs:
        breakpoints.append(_breakpoint(
            "output_not_declared", "output",
            "No required result or Evidence output is declared.", blocking=True,
            activity_id=activity_id,
        ))
    for item in required_outputs:
        if item["comparator"]["kind"] == "exact-digest" \
                and not _is_digest(item.get("baselineDigest")):
            breakpoints.append(_breakpoint(
                "output_digest_missing", "output",
                "Exact comparison requires a baseline SHA-256 digest.", blocking=True,
                activity_id=activity_id, node_id=item["id"],
            ))
    seed_present = any("randomSeed" in item for item in parameter_sets)
    unseedable_tool = any(item["stochastic"] and not item["supportsSeed"] for item in tools)
    if stochastic and (not seed_present or unseedable_tool):
        breakpoints.append(_breakpoint(
            "random_seed_uncontrolled", "randomness",
            "The activity has unseeded or unseedable randomness; a mismatch is inconclusive.",
            blocking=False, activity_id=activity_id, node_id=activity.id,
        ))
    for node_id in sorted(member_ids | used_ids | generated_ids):
        node = graph.nodes.get(node_id)
        if node is None:
            continue
        unsafe_paths = _unsafe_integer_paths(node.attributes)
        if unsafe_paths:
            breakpoints.append(_breakpoint(
                "unsafe_integer_normalized", "parameters",
                "An integer outside the JavaScript safe range was normalized to a "
                "decimal string; confirm its intended numeric semantics before rerun.",
                blocking=True, activity_id=activity_id, node_id=node.id,
            ))
    return result, breakpoints, []


def _placeholder_activity(conclusion_id: str) -> dict[str, Any]:
    identifier = f"unavailable:{hashlib.sha256(conclusion_id.encode('utf-8')).hexdigest()[:24]}"
    empty_digest = _digest([])
    executor = {
        "kind": "unavailable",
        "reason": "The conclusion is not linked to a recorded execution activity.",
    }
    return {
        "id": identifier,
        "type": "analysis_run",
        "name": "Unavailable activity for conclusion",
        "executor": executor,
        "inputs": [],
        "code": [],
        "environments": [],
        "parameterSets": [],
        "tools": [],
        "approvals": [],
        "outputs": [],
        "stochastic": False,
        "inputFingerprint": empty_digest,
        "specFingerprint": _digest({"executor": executor}),
        "executionContextFingerprint": _digest(executor),
        "baselineOutputFingerprint": empty_digest,
    }


def _lineage_breakpoints(lineage: dict[str, Any]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for raw in lineage["coverage"].get("breakpoints", []):
        if not isinstance(raw, dict):
            continue
        reason = _text(raw.get("reason")) or "lineage_incomplete"
        component = _text(raw.get("component")) or "lineage"
        node_ids = raw.get("nodeIds") if isinstance(raw.get("nodeIds"), list) else []
        blocking = raw.get("blocking") is not False
        if node_ids:
            for node_id in node_ids:
                result.append(_breakpoint(
                    reason, component,
                    f"Conclusion lineage is incomplete: {reason.replace('_', ' ')}.",
                    blocking=blocking, node_id=_text(node_id),
                ))
        else:
            result.append(_breakpoint(
                reason, component,
                f"Conclusion lineage is incomplete: {reason.replace('_', ' ')}.",
                blocking=blocking,
            ))
    return result


def _dedupe_breakpoints(values: list[dict[str, Any]]) -> list[dict[str, Any]]:
    unique = {_canonical_json(value): value for value in values}
    return [unique[key] for key in sorted(unique)]


def build_rerun_spec(
    graph: "ThreadGraph", snapshot: "EvidenceSnapshot", conclusion_id: str,
) -> dict[str, Any]:
    """Project one immutable conclusion lineage into the shared SDK schema."""
    if snapshot.thread_id != graph.thread_id:
        raise ValueError("rerun snapshot threadId does not match graph")
    if conclusion_id not in graph.nodes:
        raise KeyError(conclusion_id)
    lineage = graph.conclusion_lineage(conclusion_id)
    secret_slots: dict[str, str] = {}
    inherited_secret_slots: dict[str, dict[str, Any]] = {}
    selected = _selected_activities(graph, lineage, conclusion_id)
    activities: list[dict[str, Any]] = []
    activity_id_by_node: dict[str, str] = {}
    breakpoints = _lineage_breakpoints(lineage)
    for node in selected:
        activity, activity_breakpoints, activity_secret_slots = _build_activity(
            graph, node, secret_slots=secret_slots,
        )
        activities.append(activity)
        activity_id_by_node[node.id] = activity["id"]
        breakpoints.extend(activity_breakpoints)
        for slot in activity_secret_slots:
            slot_id = _text(slot.get("id"))
            if slot_id:
                inherited_secret_slots.setdefault(slot_id, slot)
    for slot_id, slot_name in sorted(secret_slots.items()):
        breakpoints.append(_breakpoint(
            "secret_slot_unresolved", "environment",
            f"Required secret slot {slot_name} has no Evidence-side resolver.",
            blocking=True,
        ))
    if not activities:
        activities = [_placeholder_activity(conclusion_id)]
        breakpoints.append(_breakpoint(
            "executor_unavailable", "executor",
            "No executable activity is linked to the conclusion.",
            blocking=True, activity_id=activities[0]["id"], node_id=conclusion_id,
        ))
        breakpoints.append(_breakpoint(
            "activity_not_linked", "lineage",
            "The conclusion is not linked to an ExperimentRun, AnalysisRun, WorkflowRun, or ToolInvocation.",
            blocking=True, node_id=conclusion_id,
        ))

    selected_ids = {node.id for node in selected}
    dependencies = [
        {"src": activity_id_by_node[edge.src], "dst": activity_id_by_node[edge.dst],
         "relation": edge.rel.value}
        for edge in graph.edges.values()
        if edge.src in selected_ids and edge.dst in selected_ids
        and edge.rel in {EdgeRel.PART_OF, EdgeRel.RERUN_OF, EdgeRel.USED}
    ]
    breakpoints = _dedupe_breakpoints(breakpoints)
    blocking = any(item["blocking"] for item in breakpoints)
    uncontrolled = bool(breakpoints)
    source: dict[str, Any] = {
        "snapshotDigest": snapshot.digest,
        "threadId": graph.thread_id,
        "conclusionId": conclusion_id,
    }
    if len(activities) == 1 and selected:
        source["activityId"] = activities[0]["id"]
    identity = {
        "snapshotDigest": snapshot.digest,
        "conclusionId": conclusion_id,
    }
    base: dict[str, Any] = {
        "schemaVersion": RERUN_SCHEMA_VERSION,
        "specId": f"repro-spec:{hashlib.sha256(_canonical_json(identity).encode('utf-8')).hexdigest()[:32]}",
        "source": source,
        "target": {"kind": "conclusion", "id": conclusion_id},
        "executionReady": not blocking,
        "reproducibility": "incomplete" if blocking else "uncontrolled" if uncontrolled else "controlled",
        "activities": sorted(activities, key=lambda item: item["id"]),
        "dependencies": sorted(dependencies, key=_canonical_json),
        "secretSlots": sorted([
            *inherited_secret_slots.values(),
            *(
            {"id": slot_id, "name": name, "required": True}
            for slot_id, name in sorted(secret_slots.items())
            if slot_id not in inherited_secret_slots
            ),
        ], key=_canonical_json),
        "breakpoints": breakpoints,
        "createdAt": snapshot.created_at,
    }
    spec = {**base, "specDigest": _digest(base)}
    validate_rerun_spec(spec)
    return spec


def _required_output_identity(output: dict[str, Any]) -> str:
    return _canonical_json({
        "role": output.get("role"),
        "kind": output.get("kind"),
        "name": output.get("name"),
        "comparator": output.get("comparator"),
    })


def _executor_context_projection(executor: Any) -> Any:
    """Return executable definition bytes without captured baseline results."""
    if not isinstance(executor, dict) or executor.get("kind") != "create-loop":
        return executor
    result = _json_copy(executor)
    # workflowDigest covers the full payload including its captured baseline;
    # the replay context binds the executable body below instead.
    result.pop("workflowDigest", None)
    payload = result.get("workflow")
    if isinstance(payload, dict):
        payload.pop("baseline", None)
    return result


def _generic_activity_fingerprints(activity: dict[str, Any]) -> dict[str, str]:
    inputs = activity.get("inputs") if isinstance(activity.get("inputs"), list) else []
    approvals = activity.get("approvals") if isinstance(activity.get("approvals"), list) else []
    outputs = activity.get("outputs") if isinstance(activity.get("outputs"), list) else []
    input_fingerprint = _digest(sorted(inputs, key=_canonical_json))
    context_fingerprint = _digest({
        "executor": _executor_context_projection(activity.get("executor")),
        "code": activity.get("code"),
        "environments": activity.get("environments"),
        "parameterSets": activity.get("parameterSets"),
        "tools": activity.get("tools"),
        "approvals": [
            _approval_requirement_projection(item)
            for item in approvals if isinstance(item, dict)
        ],
    })
    required_outputs = [
        item for item in outputs
        if isinstance(item, dict) and item.get("required") is True
    ]
    output_fingerprint = _digest(sorted(required_outputs, key=_canonical_json))
    spec_fingerprint = _digest({
        "inputFingerprint": input_fingerprint,
        "executionContextFingerprint": context_fingerprint,
        "stochastic": activity.get("stochastic") is True,
        "outputs": [{
            "role": item.get("role"),
            "kind": item.get("kind"),
            "name": item.get("name"),
            "comparator": item.get("comparator"),
        } for item in required_outputs],
    })
    return {
        "inputFingerprint": input_fingerprint,
        "executionContextFingerprint": context_fingerprint,
        "baselineOutputFingerprint": output_fingerprint,
        "specFingerprint": spec_fingerprint,
    }


def _parse_json_or_text(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return value


def _create_loop_fingerprints(activity: dict[str, Any]) -> dict[str, str]:
    executor = activity.get("executor")
    if not isinstance(executor, dict) or executor.get("kind") != "create-loop":
        return
    payload = executor.get("workflow")
    if not isinstance(payload, dict) \
            or payload.get("schemaVersion") != "sciforge.create-loop.executor.v1":
        raise ValueError("create-loop executor payload is not canonical")
    for key in ("workflow", "input", "context", "baseline"):
        if key not in payload:
            raise ValueError(f"create-loop executor payload is missing {key}")
    baseline = payload.get("baseline")
    if not isinstance(baseline, dict):
        raise ValueError("create-loop executor baseline is invalid")
    workflow_fingerprint = _digest(payload["workflow"])
    input_fingerprint = _digest(payload["input"])
    context_fingerprint = _digest(payload["context"])
    output_fingerprint = _digest(_parse_json_or_text(baseline.get("outputJson")))
    outputs = activity.get("outputs") if isinstance(activity.get("outputs"), list) else []
    primary = next((
        item for item in outputs
        if isinstance(item, dict) and item.get("role") == "primary-output"
    ), None)
    if primary is None:
        primary = next((
            item for item in outputs
            if isinstance(item, dict) and item.get("required") is True
        ), None)
    comparator = primary.get("comparator") if isinstance(primary, dict) else {"kind": "exact-digest"}
    approvals = [
        _approval_requirement_projection(item)
        for item in activity.get("approvals", []) if isinstance(item, dict)
    ]
    spec_fingerprint = _digest({
        "workflowFingerprint": workflow_fingerprint,
        "inputFingerprint": input_fingerprint,
        "contextFingerprint": context_fingerprint,
        "approvalRequirements": approvals,
        "comparator": comparator,
    })
    expected: dict[str, str] = {
        "inputFingerprint": input_fingerprint,
        "executionContextFingerprint": context_fingerprint,
        "baselineOutputFingerprint": output_fingerprint,
        "specFingerprint": spec_fingerprint,
    }
    if executor.get("workflowDigest") != _digest(payload):
        raise ValueError("create-loop executor workflowDigest does not match its body")
    repeated = {
        "workflowFingerprint": workflow_fingerprint,
        "inputFingerprint": input_fingerprint,
        "contextFingerprint": context_fingerprint,
        "outputFingerprint": output_fingerprint,
    }
    for key, value in repeated.items():
        if baseline.get(key) != value:
            raise ValueError(f"create-loop baseline {key} does not match its body")
    return expected


def _validate_create_loop_reference_alignment(
    activity: dict[str, Any], expected: dict[str, str],
) -> None:
    input_fingerprint = expected["inputFingerprint"]
    output_fingerprint = expected["baselineOutputFingerprint"]
    embedded_inputs = [
        item for item in activity.get("inputs", [])
        if isinstance(item, dict) and item.get("required") is True
        and item.get("kind") == "embedded-json"
    ]
    if not embedded_inputs or any(
        item.get("contentDigest") != input_fingerprint for item in embedded_inputs
    ):
        raise ValueError("create-loop embedded input digest does not match its body")
    outputs = activity.get("outputs") if isinstance(activity.get("outputs"), list) else []
    primary = next((
        item for item in outputs
        if isinstance(item, dict) and item.get("role") == "primary-output"
    ), None)
    if isinstance(primary, dict) and any(
        primary.get(key) != output_fingerprint for key in ("contentDigest", "baselineDigest")
    ):
        raise ValueError("create-loop primary output digest does not match its body")


def _validate_create_loop_fingerprints(activity: dict[str, Any]) -> None:
    expected = _create_loop_fingerprints(activity)
    for key, value in expected.items():
        if activity.get(key) != value:
            raise ValueError(f"rerun activity {key} does not match create-loop body")
    baseline = activity["executor"]["workflow"]["baseline"]
    if baseline.get("specFingerprint") != expected["specFingerprint"]:
        raise ValueError("create-loop baseline specFingerprint does not match its body")
    _validate_create_loop_reference_alignment(activity, expected)


def _validate_activity_fingerprints(activity: dict[str, Any]) -> None:
    executor = activity.get("executor")
    if isinstance(executor, dict) and executor.get("kind") == "unavailable":
        return
    if isinstance(executor, dict) and executor.get("kind") == "create-loop":
        create_loop_expected = _create_loop_fingerprints(activity)
        if all(activity.get(key) == value for key, value in create_loop_expected.items()):
            _validate_create_loop_fingerprints(activity)
            return
    expected = _generic_activity_fingerprints(activity)
    for key in ("inputFingerprint", "specFingerprint"):
        if activity.get(key) != expected[key]:
            raise ValueError(f"rerun activity {key} does not match canonical body")
    for key in ("executionContextFingerprint", "baselineOutputFingerprint"):
        if key in activity and activity.get(key) != expected[key]:
            raise ValueError(f"rerun activity {key} does not match canonical body")


def validate_rerun_spec(spec: dict[str, Any]) -> None:
    """Validate invariants that are shared with the authoritative SDK schema."""
    if not isinstance(spec, dict) or spec.get("schemaVersion") != RERUN_SCHEMA_VERSION:
        raise ValueError("rerun spec must use sciforge.rerun.v1")
    expected_keys = {
        "schemaVersion", "specId", "specDigest", "source", "target",
        "executionReady", "reproducibility", "activities", "dependencies",
        "secretSlots", "breakpoints", "createdAt",
    }
    if set(spec) != expected_keys:
        raise ValueError("rerun spec fields do not match the shared SDK contract")
    _validate_spec_shape(spec)
    if not _is_digest(spec.get("specDigest")):
        raise ValueError("rerun specDigest must be a lowercase SHA-256 digest")
    digest_payload = {key: value for key, value in spec.items() if key != "specDigest"}
    if _digest(digest_payload) != spec["specDigest"]:
        raise ValueError("rerun specDigest does not match canonical content")
    activities = spec.get("activities")
    if not isinstance(activities, list) or not activities:
        raise ValueError("rerun spec requires at least one activity")
    activity_ids = [item.get("id") for item in activities if isinstance(item, dict)]
    if len(activity_ids) != len(activities) or not all(_text(item) for item in activity_ids) \
            or len(set(activity_ids)) != len(activity_ids):
        raise ValueError("rerun activity ids must be present and unique")
    activity_id_set = set(activity_ids)
    for activity in activities:
        if activity.get("type") not in {item.value for item in _ACTIVITY_TYPES}:
            raise ValueError("rerun activity type is unsupported")
        for key in ("inputFingerprint", "specFingerprint"):
            if not _is_digest(activity.get(key)):
                raise ValueError(f"rerun activity {key} must be a SHA-256 digest")
        for key in (
            "inputs", "code", "environments", "parameterSets", "tools",
            "approvals", "outputs",
        ):
            if not isinstance(activity.get(key), list):
                raise ValueError(f"rerun activity {key} must be an array")
        if not isinstance(activity.get("stochastic"), bool):
            raise ValueError("rerun activity stochastic must be boolean")
        executor = activity.get("executor")
        if not isinstance(executor, dict) or executor.get("kind") not in {
            "create-loop", "unavailable",
        }:
            raise ValueError("rerun activity executor is invalid")
        for requirement in activity["approvals"]:
            if not isinstance(requirement, dict) \
                    or requirement.get("freshDecisionRequired") is not True:
                raise ValueError("rerun approvals always require a fresh decision")
        for output in activity["outputs"]:
            if not isinstance(output, dict) or not _valid_comparator(output.get("comparator")):
                raise ValueError("rerun output comparator is invalid")
        output_ids = [output.get("id") for output in activity["outputs"]]
        if len(set(output_ids)) != len(output_ids):
            raise ValueError("rerun output ids must be unique within an activity")
        required_identities = [
            _required_output_identity(output) for output in activity["outputs"]
            if output.get("required") is True
        ]
        if len(set(required_identities)) != len(required_identities):
            raise ValueError("required output contracts must be unambiguous")
        _validate_activity_fingerprints(activity)
    stable_output_identities = [
        _output_identity((str(activity["id"]), activity, output), include_activity=True)
        for activity in activities
        for output in activity["outputs"]
        if output.get("required") is True
    ]
    if len(set(stable_output_identities)) != len(stable_output_identities):
        raise ValueError(
            "required output owner identities must be globally unambiguous"
        )
    dependencies = spec.get("dependencies")
    if not isinstance(dependencies, list):
        raise ValueError("rerun dependencies must be an array")
    for edge in dependencies:
        if not isinstance(edge, dict) or edge.get("src") not in activity_id_set \
                or edge.get("dst") not in activity_id_set:
            raise ValueError("rerun dependency endpoint is not an activity")
    if _dependency_cycle(activity_ids, dependencies):
        raise ValueError("rerun activity dependencies must be acyclic")
    source = spec.get("source")
    target = spec.get("target")
    if not isinstance(source, dict) or not _is_digest(source.get("snapshotDigest")) \
            or not isinstance(target, dict):
        raise ValueError("rerun source and target are invalid")
    if not (_text(source.get("conclusionId")) or _text(source.get("activityId"))):
        raise ValueError("rerun source requires a conclusion or activity")
    if source.get("activityId") is not None and source.get("activityId") not in activity_id_set:
        raise ValueError("rerun source activity is not in the spec")
    if target.get("kind") == "activity":
        if target.get("id") not in activity_id_set \
                or source.get("activityId") != target.get("id"):
            raise ValueError("rerun activity target must match source.activityId")
    elif target.get("kind") == "conclusion":
        if source.get("conclusionId") != target.get("id"):
            raise ValueError("rerun conclusion target must match source.conclusionId")
    else:
        raise ValueError("rerun target kind is invalid")
    breakpoints = spec.get("breakpoints")
    if not isinstance(breakpoints, list):
        raise ValueError("rerun breakpoints must be an array")
    if any(
        not isinstance(item, dict)
        or item.get("component") not in _BREAKPOINT_COMPONENTS
        or not isinstance(item.get("blocking"), bool)
        for item in breakpoints
    ):
        raise ValueError("rerun breakpoint is invalid")
    blocking = any(isinstance(item, dict) and item.get("blocking") is True
                   for item in breakpoints)
    if spec.get("executionReady") == blocking:
        raise ValueError("executionReady must be false exactly for a blocking breakpoint")
    expected_reproducibility = (
        "incomplete" if blocking else "uncontrolled" if breakpoints else "controlled"
    )
    if spec.get("reproducibility") != expected_reproducibility:
        raise ValueError(
            f"rerun reproducibility must be {expected_reproducibility} for its breakpoints"
        )
    for activity in activities:
        activity_id = activity["id"]
        executor = activity["executor"]
        if executor.get("kind") == "unavailable" and not any(
            item.get("blocking") is True and item.get("component") == "executor"
            and item.get("activityId") in (None, activity_id)
            for item in breakpoints
        ):
            raise ValueError("an unavailable executor requires a blocking executor breakpoint")
        stochastic_tools = [
            item for item in activity["tools"]
            if isinstance(item, dict) and item.get("stochastic") is True
        ]
        if stochastic_tools and activity.get("stochastic") is not True:
            raise ValueError("an activity containing a stochastic tool must be stochastic")
        has_seed = any(
            isinstance(item, dict) and "randomSeed" in item
            for item in activity["parameterSets"]
        )
        has_unseedable = any(item.get("supportsSeed") is not True for item in stochastic_tools)
        if activity.get("stochastic") is True and (not has_seed or has_unseedable) \
                and not any(
                    item.get("blocking") is False and item.get("component") == "randomness"
                    and item.get("activityId") in (None, activity_id)
                    for item in breakpoints
                ):
            raise ValueError(
                "unseeded or unseedable stochastic activity requires a randomness breakpoint"
            )


def _valid_comparator(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    kind = value.get("kind")
    allowed_keys: set[str]
    if kind == "exact-digest":
        return set(value) == {"kind"}
    if kind == "numeric":
        allowed_keys = {"kind", "absoluteTolerance", "relativeTolerance"}
        absolute = value.get("absoluteTolerance")
        if not _nonnegative_finite(absolute):
            return False
    elif kind == "json-structural":
        allowed_keys = {"kind", "absoluteTolerance", "relativeTolerance"}
    elif kind == "table":
        allowed_keys = {
            "kind", "keyColumns", "valueColumns",
            "absoluteTolerance", "relativeTolerance",
        }
        key_columns = value.get("keyColumns")
        value_columns = value.get("valueColumns")
        if not isinstance(key_columns, list) or len(key_columns) > 256 \
                or not isinstance(value_columns, list) or len(value_columns) > 2_048:
            return False
        try:
            for index, column in enumerate(key_columns):
                _bounded_string(
                    column, maximum=512, label=f"comparator.keyColumns[{index}]",
                )
            for index, column in enumerate(value_columns):
                _bounded_string(
                    column, maximum=512, label=f"comparator.valueColumns[{index}]",
                )
        except ValueError:
            return False
    else:
        return False
    if not set(value).issubset(allowed_keys):
        return False
    return all(
        key not in value or _nonnegative_finite(value[key])
        for key in ("absoluteTolerance", "relativeTolerance")
    )


def _nonnegative_finite(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) \
        and math.isfinite(value) and value >= 0


def _strict_keys(
    value: Any,
    *,
    allowed: set[str],
    required: set[str],
    label: str,
) -> dict[str, Any]:
    if not isinstance(value, dict) or not required.issubset(value) or not set(value).issubset(allowed):
        raise ValueError(f"rerun {label} fields do not match the shared SDK contract")
    return value


def _bounded_string(value: Any, *, maximum: int, label: str) -> str:
    if not isinstance(value, str) or not value.strip() or value != value.strip() \
            or _utf16_length(value) > maximum:
        raise ValueError(f"rerun {label} must be a non-empty bounded string")
    return value


def _utf16_length(value: str) -> int:
    """Return JavaScript ``String.length`` while rejecting lone surrogates."""
    try:
        return len(value.encode("utf-16-le")) // 2
    except UnicodeEncodeError as exc:
        raise ValueError("rerun strings cannot contain lone UTF-16 surrogates") from exc


def _timestamp(value: Any, *, label: str) -> str:
    text = _bounded_string(value, maximum=128, label=label)
    if not _RFC3339_TIMESTAMP.fullmatch(text):
        raise ValueError(f"rerun {label} must be an RFC 3339 timestamp with an offset")
    try:
        datetime.fromisoformat(text[:-1] + "+00:00" if text.endswith("Z") else text)
    except ValueError as exc:
        raise ValueError(
            f"rerun {label} must be an RFC 3339 timestamp with an offset"
        ) from exc
    return text


def _json_contract(value: Any, *, label: str = "JSON value") -> None:
    if value is None or isinstance(value, bool):
        return
    if isinstance(value, int):
        try:
            if not math.isfinite(float(value)):
                raise ValueError
        except (OverflowError, ValueError) as exc:
            raise ValueError(f"rerun {label} contains a non-finite number") from exc
        return
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError(f"rerun {label} contains a non-finite number")
        return
    if isinstance(value, str):
        if _utf16_length(value) > 100_000:
            raise ValueError(f"rerun {label} contains an oversized string")
        return
    if isinstance(value, list):
        if len(value) > 10_000:
            raise ValueError(f"rerun {label} contains an oversized array")
        for item in value:
            _json_contract(item, label=label)
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str) or key != key.strip() or not key \
                    or _utf16_length(key) > 192:
                raise ValueError(f"rerun {label} contains an invalid object key")
            _json_contract(item, label=label)
        return
    raise ValueError(f"rerun {label} is not a JSON value")


_ARTIFACT_KEYS = {
    "id", "role", "kind", "name", "artifactId", "artifactVersionId",
    "locator", "contentDigest", "version", "mediaType", "required",
}


def _validate_artifact_shape(
    value: Any, *, label: str, code: bool = False, output: bool = False,
) -> None:
    optional = set(_ARTIFACT_KEYS)
    if code:
        optional.update({"language", "repository", "commit", "swhid", "entrypoint"})
    if output:
        optional.update({"comparator", "baselineDigest"})
    item = _strict_keys(
        value, allowed=optional,
        required={"id", "role", "kind", "required"} | ({"comparator"} if output else set()),
        label=label,
    )
    for key in ("id", "role", "kind"):
        _bounded_string(item[key], maximum=512, label=f"{label}.{key}")
    if not isinstance(item["required"], bool):
        raise ValueError(f"rerun {label}.required must be boolean")
    for key, maximum in (
        ("name", 1_024), ("artifactId", 512), ("artifactVersionId", 512),
        ("locator", 16_384), ("version", 512), ("mediaType", 512),
        ("language", 128), ("repository", 16_384), ("commit", 256),
        ("swhid", 512), ("entrypoint", 4_096),
    ):
        if key in item:
            text = _bounded_string(item[key], maximum=maximum, label=f"{label}.{key}")
            if key == "commit" and len(text) < 7:
                raise ValueError(f"rerun {label}.commit must contain at least seven characters")
            if key == "repository" and "://" not in text:
                raise ValueError(f"rerun {label}.repository must be a URL")
    for key in ("contentDigest", "baselineDigest"):
        if key in item and not _is_digest(item[key]):
            raise ValueError(f"rerun {label}.{key} must be a SHA-256 digest")
    if output and not _valid_comparator(item["comparator"]):
        raise ValueError(f"rerun {label}.comparator is invalid")


def _validate_spec_shape(spec: dict[str, Any]) -> None:
    _bounded_string(spec.get("specId"), maximum=512, label="specId")
    if not isinstance(spec.get("executionReady"), bool):
        raise ValueError("rerun executionReady must be boolean")
    if spec.get("reproducibility") not in {"controlled", "uncontrolled", "incomplete"}:
        raise ValueError("rerun reproducibility is invalid")
    _timestamp(spec.get("createdAt"), label="createdAt")

    source = _strict_keys(
        spec.get("source"),
        allowed={"snapshotDigest", "threadId", "conclusionId", "activityId"},
        required={"snapshotDigest"}, label="source",
    )
    if not _is_digest(source["snapshotDigest"]):
        raise ValueError("rerun source.snapshotDigest must be a SHA-256 digest")
    for key in ("threadId", "conclusionId", "activityId"):
        if key in source:
            _bounded_string(source[key], maximum=512, label=f"source.{key}")
    target = _strict_keys(
        spec.get("target"), allowed={"kind", "id"}, required={"kind", "id"},
        label="target",
    )
    if target["kind"] not in {"activity", "conclusion"}:
        raise ValueError("rerun target.kind is invalid")
    _bounded_string(target["id"], maximum=512, label="target.id")

    activities = spec.get("activities")
    if not isinstance(activities, list) or not 1 <= len(activities) <= 10_000:
        raise ValueError("rerun activities must be a bounded non-empty array")
    activity_allowed = {
        "id", "type", "name", "executor", "inputs", "code", "environments",
        "parameterSets", "tools", "approvals", "outputs", "stochastic",
        "inputFingerprint", "specFingerprint", "executionContextFingerprint",
        "baselineOutputFingerprint",
    }
    activity_required = activity_allowed - {
        "executionContextFingerprint", "baselineOutputFingerprint",
    }
    for activity_index, raw_activity in enumerate(activities):
        prefix = f"activities[{activity_index}]"
        activity = _strict_keys(
            raw_activity, allowed=activity_allowed, required=activity_required, label=prefix,
        )
        _bounded_string(activity["id"], maximum=512, label=f"{prefix}.id")
        _bounded_string(activity["name"], maximum=1_024, label=f"{prefix}.name")
        if activity["type"] not in {item.value for item in _ACTIVITY_TYPES}:
            raise ValueError(f"rerun {prefix}.type is invalid")
        if not isinstance(activity["stochastic"], bool):
            raise ValueError(f"rerun {prefix}.stochastic must be boolean")
        for key in (
            "inputFingerprint", "specFingerprint", "executionContextFingerprint",
            "baselineOutputFingerprint",
        ):
            if key in activity and not _is_digest(activity[key]):
                raise ValueError(f"rerun {prefix}.{key} must be a SHA-256 digest")

        executor = activity["executor"]
        if isinstance(executor, dict) and executor.get("kind") == "create-loop":
            executor = _strict_keys(
                executor, allowed={"kind", "workflow", "workflowDigest", "target"},
                required={"kind", "workflow", "workflowDigest", "target"},
                label=f"{prefix}.executor",
            )
            _json_contract(executor["workflow"], label=f"{prefix}.executor.workflow")
            if not _is_digest(executor["workflowDigest"]):
                raise ValueError(f"rerun {prefix}.executor.workflowDigest is invalid")
            executor_target = _strict_keys(
                executor["target"], allowed={"kind", "id"}, required={"kind", "id"},
                label=f"{prefix}.executor.target",
            )
            if executor_target["kind"] not in {"workflow", "node"}:
                raise ValueError(f"rerun {prefix}.executor.target.kind is invalid")
            _bounded_string(
                executor_target["id"], maximum=512, label=f"{prefix}.executor.target.id",
            )
        elif isinstance(executor, dict) and executor.get("kind") == "unavailable":
            executor = _strict_keys(
                executor, allowed={"kind", "reason"}, required={"kind", "reason"},
                label=f"{prefix}.executor",
            )
            _bounded_string(executor["reason"], maximum=4_000,
                            label=f"{prefix}.executor.reason")
        else:
            raise ValueError(f"rerun {prefix}.executor is invalid")

        array_limits = {
            "inputs": 10_000, "code": 10_000, "environments": 128,
            "parameterSets": 128, "tools": 10_000, "approvals": 10_000,
            "outputs": 10_000,
        }
        for key, maximum in array_limits.items():
            if not isinstance(activity[key], list) or len(activity[key]) > maximum:
                raise ValueError(f"rerun {prefix}.{key} must be a bounded array")
        for index, value in enumerate(activity["inputs"]):
            _validate_artifact_shape(value, label=f"{prefix}.inputs[{index}]")
        for index, value in enumerate(activity["code"]):
            _validate_artifact_shape(value, label=f"{prefix}.code[{index}]", code=True)
        for index, raw_environment in enumerate(activity["environments"]):
            label = f"{prefix}.environments[{index}]"
            environment = _strict_keys(
                raw_environment,
                allowed={
                    "id", "name", "platform", "architecture", "runtimeVersions",
                    "containerDigest", "lockDigests", "contentDigest", "attributes",
                },
                required={"id", "runtimeVersions", "lockDigests"}, label=label,
            )
            _bounded_string(environment["id"], maximum=512, label=f"{label}.id")
            for key, maximum in (("name", 1_024), ("platform", 512), ("architecture", 128)):
                if key in environment:
                    _bounded_string(environment[key], maximum=maximum, label=f"{label}.{key}")
            versions = environment["runtimeVersions"]
            if not isinstance(versions, dict):
                raise ValueError(f"rerun {label}.runtimeVersions must be an object")
            for key, value in versions.items():
                _bounded_string(key, maximum=192, label=f"{label}.runtimeVersions key")
                _bounded_string(value, maximum=512, label=f"{label}.runtimeVersions value")
            locks = environment["lockDigests"]
            if not isinstance(locks, list) or len(locks) > 128 or not all(_is_digest(x) for x in locks):
                raise ValueError(f"rerun {label}.lockDigests is invalid")
            for key in ("containerDigest", "contentDigest"):
                if key in environment and not _is_digest(environment[key]):
                    raise ValueError(f"rerun {label}.{key} is invalid")
            if "attributes" in environment:
                _json_contract(environment["attributes"], label=f"{label}.attributes")
        for index, raw_parameters in enumerate(activity["parameterSets"]):
            label = f"{prefix}.parameterSets[{index}]"
            parameters = _strict_keys(
                raw_parameters, allowed={"id", "values", "digest", "randomSeed"},
                required={"id", "values", "digest"}, label=label,
            )
            _bounded_string(parameters["id"], maximum=512, label=f"{label}.id")
            _json_contract(parameters["values"], label=f"{label}.values")
            if not _is_digest(parameters["digest"]):
                raise ValueError(f"rerun {label}.digest is invalid")
            if "randomSeed" in parameters:
                seed = parameters["randomSeed"]
                if isinstance(seed, bool) or not isinstance(seed, (str, int, float)) \
                        or isinstance(seed, str) and len(seed) > 512 \
                        or isinstance(seed, (int, float)) and not math.isfinite(float(seed)):
                    raise ValueError(f"rerun {label}.randomSeed is invalid")
        for index, raw_tool in enumerate(activity["tools"]):
            label = f"{prefix}.tools[{index}]"
            tool = _strict_keys(
                raw_tool,
                allowed={
                    "id", "name", "providerId", "actionId", "version", "arguments",
                    "argumentsDigest", "resultDigest", "stochastic", "supportsSeed",
                },
                required={
                    "id", "name", "argumentsDigest", "stochastic", "supportsSeed",
                }, label=label,
            )
            _bounded_string(tool["id"], maximum=512, label=f"{label}.id")
            _bounded_string(tool["name"], maximum=1_024, label=f"{label}.name")
            for key in ("providerId", "actionId"):
                if key in tool:
                    _bounded_string(tool[key], maximum=512, label=f"{label}.{key}")
            if "version" in tool:
                _bounded_string(tool["version"], maximum=512, label=f"{label}.version")
            if "arguments" in tool:
                _json_contract(tool["arguments"], label=f"{label}.arguments")
            for key in ("argumentsDigest", "resultDigest"):
                if key in tool and not _is_digest(tool[key]):
                    raise ValueError(f"rerun {label}.{key} is invalid")
            if not isinstance(tool["stochastic"], bool) or not isinstance(tool["supportsSeed"], bool):
                raise ValueError(f"rerun {label} stochastic flags must be boolean")
        for index, raw_approval in enumerate(activity["approvals"]):
            label = f"{prefix}.approvals[{index}]"
            approval = _strict_keys(
                raw_approval,
                allowed={
                    "id", "kind", "subjectId", "mode", "freshDecisionRequired",
                    "historicalDecisionId", "historicalDecisionFingerprint",
                    "policyDigest",
                },
                required={"id", "kind", "subjectId", "mode", "freshDecisionRequired"},
                label=label,
            )
            for key in ("id", "subjectId", "mode", "historicalDecisionId"):
                if key in approval:
                    _bounded_string(approval[key], maximum=512, label=f"{label}.{key}")
            if approval["kind"] not in {
                "capability-confirmation", "workflow-human-approval", "policy-gate",
            } or approval["freshDecisionRequired"] is not True:
                raise ValueError(f"rerun {label} is invalid")
            if "policyDigest" in approval and not _is_digest(approval["policyDigest"]):
                raise ValueError(f"rerun {label}.policyDigest is invalid")
            if "historicalDecisionFingerprint" in approval \
                    and not _is_digest(approval["historicalDecisionFingerprint"]):
                raise ValueError(
                    f"rerun {label}.historicalDecisionFingerprint is invalid"
                )
        for index, value in enumerate(activity["outputs"]):
            _validate_artifact_shape(
                value, label=f"{prefix}.outputs[{index}]", output=True,
            )

    dependencies = spec.get("dependencies")
    if not isinstance(dependencies, list) or len(dependencies) > 100_000:
        raise ValueError("rerun dependencies must be a bounded array")
    for index, raw_dependency in enumerate(dependencies):
        dependency = _strict_keys(
            raw_dependency, allowed={"src", "dst", "relation"},
            required={"src", "dst", "relation"}, label=f"dependencies[{index}]",
        )
        for key in ("src", "dst", "relation"):
            _bounded_string(dependency[key], maximum=512,
                            label=f"dependencies[{index}].{key}")

    slots = spec.get("secretSlots")
    if not isinstance(slots, list) or len(slots) > 10_000:
        raise ValueError("rerun secretSlots must be a bounded array")
    for index, raw_slot in enumerate(slots):
        slot = _strict_keys(
            raw_slot, allowed={"id", "name", "providerId", "required"},
            required={"id", "name", "required"}, label=f"secretSlots[{index}]",
        )
        _bounded_string(slot["id"], maximum=512, label=f"secretSlots[{index}].id")
        _bounded_string(slot["name"], maximum=1_024, label=f"secretSlots[{index}].name")
        if "providerId" in slot:
            _bounded_string(slot["providerId"], maximum=512,
                            label=f"secretSlots[{index}].providerId")
        if not isinstance(slot["required"], bool):
            raise ValueError(f"rerun secretSlots[{index}].required must be boolean")

    breakpoints = spec.get("breakpoints")
    if not isinstance(breakpoints, list) or len(breakpoints) > 10_000:
        raise ValueError("rerun breakpoints must be a bounded array")
    for index, raw_breakpoint in enumerate(breakpoints):
        label = f"breakpoints[{index}]"
        breakpoint = _strict_keys(
            raw_breakpoint,
            allowed={"code", "component", "message", "activityId", "nodeId", "blocking"},
            required={"code", "component", "message", "blocking"}, label=label,
        )
        _bounded_string(breakpoint["code"], maximum=512, label=f"{label}.code")
        _bounded_string(breakpoint["message"], maximum=4_000, label=f"{label}.message")
        for key in ("activityId", "nodeId"):
            if key in breakpoint:
                _bounded_string(breakpoint[key], maximum=512, label=f"{label}.{key}")
        if breakpoint["component"] not in _BREAKPOINT_COMPONENTS \
                or not isinstance(breakpoint["blocking"], bool):
            raise ValueError(f"rerun {label} is invalid")


def _dependency_cycle(activity_ids: list[str], dependencies: list[dict[str, Any]]) -> bool:
    incoming = {activity_id: 0 for activity_id in activity_ids}
    outgoing = {activity_id: [] for activity_id in activity_ids}
    for edge in dependencies:
        src, dst = edge.get("src"), edge.get("dst")
        if src not in incoming or dst not in incoming:
            continue
        outgoing[src].append(dst)
        incoming[dst] += 1
    ready = [activity_id for activity_id, count in incoming.items() if count == 0]
    visited = 0
    while ready:
        current = ready.pop()
        visited += 1
        for target in outgoing[current]:
            incoming[target] -= 1
            if incoming[target] == 0:
                ready.append(target)
    return visited != len(activity_ids)


def _aggregate_fingerprint(spec: dict[str, Any], key: str) -> str:
    return _digest(sorted(
        activity.get(key) for activity in spec.get("activities", [])
        if isinstance(activity, dict) and _is_digest(activity.get(key))
    ))


def _activity_owner_signature(
    activity: dict[str, Any], *, include_output_contracts: bool,
) -> str:
    """Return a replay-stable activity identity without run-local ids.

    Fingerprints are deliberately excluded: inputs, code, environment and
    parameters are comparison dimensions, so using any of their fingerprints
    as the owner key would make a changed activity look like a different
    activity.  Output contracts are used only as a disambiguator when the
    type/name/executor target tuple is not unique within a spec.
    """
    executor = activity.get("executor")
    target = executor.get("target") if isinstance(executor, dict) else None
    signature: dict[str, Any] = {
        "type": activity.get("type"),
        "name": activity.get("name"),
        "executor": {
            "kind": executor.get("kind") if isinstance(executor, dict) else None,
            "target": target if isinstance(target, dict) else None,
        },
    }
    if include_output_contracts:
        signature["outputContracts"] = sorted(
            _required_output_identity(output)
            for output in activity.get("outputs", [])
            if isinstance(output, dict) and output.get("required") is True
        )
    return _canonical_json(signature)


def _owner_index(
    spec: dict[str, Any], *, include_output_contracts: bool,
) -> Optional[dict[str, str]]:
    """Map run-local activity ids to unique stable owner identities."""
    pairs = [
        (
            str(activity.get("id")),
            _activity_owner_signature(
                activity, include_output_contracts=include_output_contracts,
            ),
        )
        for activity in spec.get("activities", [])
        if isinstance(activity, dict)
    ]
    owners = [owner for _activity_id, owner in pairs]
    if len(pairs) != len(spec.get("activities", [])) \
            or len(set(owners)) != len(owners):
        return None
    return dict(pairs)


def _paired_owner_indexes(
    baseline: dict[str, Any], candidate: dict[str, Any],
) -> tuple[Optional[dict[str, str]], Optional[dict[str, str]]]:
    """Choose the least volatile identity that is unique in both specs."""
    for include_outputs in (False, True):
        left = _owner_index(
            baseline, include_output_contracts=include_outputs,
        )
        right = _owner_index(
            candidate, include_output_contracts=include_outputs,
        )
        if left is not None and right is not None:
            return left, right
    return None, None


def _owned_fingerprint(
    spec: dict[str, Any], key: str, owners: dict[str, str],
) -> str:
    """Bind a fingerprint to its stable activity owner before aggregation."""
    return _digest(sorted(
        [{
            "owner": owners[str(activity.get("id"))],
            "fingerprint": activity.get(key),
        }
        for activity in spec.get("activities", [])
        if isinstance(activity, dict) and _is_digest(activity.get(key))
        ], key=_canonical_json,
    ))


def _stable_approval_subject(
    activity: dict[str, Any], approval: dict[str, Any],
) -> str:
    """Normalize an approval owner without retaining run-local request ids."""
    subject = str(approval.get("subjectId") or "")
    if subject == str(activity.get("id") or ""):
        return "$activity"
    if ":node:" in subject:
        return "node:" + subject.rsplit(":node:", 1)[1]
    return subject


def _approval_state_fingerprint(
    spec: dict[str, Any], owners: Optional[dict[str, str]],
) -> str:
    """Bind captured decision digests to stable activity/gate identities."""
    records: list[dict[str, Any]] = []
    for activity in spec.get("activities", []):
        if not isinstance(activity, dict):
            continue
        activity_id = str(activity.get("id") or "")
        owner = owners.get(activity_id) if owners is not None else \
            _activity_owner_signature(activity, include_output_contracts=True)
        for approval in activity.get("approvals", []):
            if not isinstance(approval, dict):
                continue
            decision_fingerprint = approval.get("historicalDecisionFingerprint")
            if not _is_digest(decision_fingerprint):
                continue
            records.append({
                "owner": owner,
                "kind": approval.get("kind"),
                "subject": _stable_approval_subject(activity, approval),
                "decisionFingerprint": decision_fingerprint,
            })
    return _digest(sorted(records, key=_canonical_json))


def _normalized_dependencies(
    spec: dict[str, Any], owners: dict[str, str],
) -> list[dict[str, str]]:
    """Normalize directed dependencies across run-local activity ids."""
    unique = {
        _canonical_json({
            "src": owners[str(edge.get("src"))],
            "dst": owners[str(edge.get("dst"))],
            "relation": str(edge.get("relation")),
        })
        for edge in spec.get("dependencies", [])
        if isinstance(edge, dict)
    }
    return [json.loads(value) for value in sorted(unique)]


def _required_outputs(
    spec: dict[str, Any],
) -> list[tuple[str, dict[str, Any], dict[str, Any]]]:
    return [
        (str(activity.get("id")), activity, output)
        for activity in spec.get("activities", []) if isinstance(activity, dict)
        for output in activity.get("outputs", []) if isinstance(output, dict)
        and output.get("required", True)
    ]


def _output_signature(
    activity: dict[str, Any], output: dict[str, Any],
) -> dict[str, Any]:
    return {
        "activity": {
            "id": activity.get("id"),
            "type": activity.get("type"),
            "name": activity.get("name"),
            "specFingerprint": activity.get("specFingerprint"),
        },
        "role": output.get("role"),
        "kind": output.get("kind"),
        "name": output.get("name"),
        "comparator": output.get("comparator") or {"kind": "exact-digest"},
        "digest": output.get("contentDigest") or output.get("baselineDigest"),
    }


def _output_identity(
    item: tuple[str, dict[str, Any], dict[str, Any]],
    *, include_activity: bool,
) -> str:
    _activity_id, activity, output = item
    signature = _output_signature(activity, output)
    signature.pop("digest", None)
    if include_activity:
        # Run/activity ids may change between replays, while this tuple is the
        # stable executable contract needed to keep same-named outputs from
        # different activities out of each other's comparison lane.
        signature["activity"].pop("id", None)
    else:
        # With a single activity, spec/context changes are explanation
        # dimensions and must not suppress an observable output-equivalence
        # result; compare those fingerprints separately.
        signature.pop("activity", None)
    return _canonical_json(signature)


def _output_value_key(activity_id: str, output: dict[str, Any]) -> tuple[str, str]:
    return activity_id, str(output.get("id") or "")


def output_values_for_spec(
    graph: "ThreadGraph", spec: dict[str, Any],
) -> dict[tuple[str, str], Any]:
    """Resolve explicitly persisted canonical output values for comparison."""
    by_external: dict[str, Node] = {}
    for node in graph.nodes.values():
        by_external.setdefault(node.external_id or node.id, node)
        by_external.setdefault(node.id, node)
    values: dict[tuple[str, str], Any] = {}
    for activity_id, _activity, output in _required_outputs(spec):
        node = by_external.get(str(output.get("id") or ""))
        if node is not None and "value" in node.attributes:
            values[_output_value_key(activity_id, output)] = _json_copy(
                node.attributes["value"]
            )
    return values


def _compare_values(left: Any, right: Any, comparator: dict[str, Any]) -> bool:
    kind = comparator["kind"]
    absolute = float(comparator.get("absoluteTolerance", 0))
    relative = float(comparator.get("relativeTolerance", 0))
    if kind == "numeric":
        if isinstance(left, bool) or isinstance(right, bool) \
                or not isinstance(left, (int, float)) \
                or not isinstance(right, (int, float)):
            return False
        return _numbers_equivalent(float(left), float(right), absolute, relative)
    if kind == "table":
        if not isinstance(left, list) or not isinstance(right, list):
            return False
        keys = comparator.get("keyColumns", [])
        columns = comparator.get("valueColumns", [])

        def row_key(row: Any) -> str:
            if not isinstance(row, dict):
                return _canonical_json(row)
            return "\0".join(str(row.get(key, "")) for key in keys)

        def project(row: Any) -> Any:
            if not isinstance(row, dict) or not columns:
                return row
            # Key columns define row identity, so retain them even when the
            # caller asks to compare only a subset of value columns.
            projected = dict.fromkeys([*keys, *columns])
            return {column: row.get(column) for column in projected}

        left = [project(row) for row in sorted(left, key=row_key)]
        right = [project(row) for row in sorted(right, key=row_key)]
    return _structural_equivalent(left, right, absolute, relative)


def _structural_equivalent(
    left: Any, right: Any, absolute: float, relative: float,
) -> bool:
    if isinstance(left, bool) or isinstance(right, bool):
        return type(left) is type(right) and left == right
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return _numbers_equivalent(float(left), float(right), absolute, relative)
    if isinstance(left, list) or isinstance(right, list):
        return isinstance(left, list) and isinstance(right, list) \
            and len(left) == len(right) and all(
                _structural_equivalent(a, b, absolute, relative)
                for a, b in zip(left, right)
            )
    if isinstance(left, dict) or isinstance(right, dict):
        return isinstance(left, dict) and isinstance(right, dict) \
            and set(left) == set(right) and all(
                _structural_equivalent(left[key], right[key], absolute, relative)
                for key in left
            )
    return type(left) is type(right) and left == right


def _numbers_equivalent(
    left: float, right: float, absolute: float, relative: float,
) -> bool:
    if not math.isfinite(left) or not math.isfinite(right):
        return left == right
    difference = abs(left - right)
    return difference <= absolute or difference <= relative * max(abs(left), abs(right))


def _compare_outputs(
    baseline: dict[str, Any],
    candidate: dict[str, Any],
    baseline_values: Optional[dict[tuple[str, str], Any]],
    candidate_values: Optional[dict[tuple[str, str], Any]],
) -> tuple[bool, bool, list[dict[str, Any]]]:
    include_activity = len(baseline.get("activities", [])) > 1 \
        or len(candidate.get("activities", [])) > 1
    identity = lambda item: _output_identity(  # noqa: E731 - shared stable key
        item, include_activity=include_activity,
    )
    left = sorted(_required_outputs(baseline), key=identity)
    right = sorted(_required_outputs(candidate), key=identity)
    if not left and not right:
        empty_digest = _digest([])
        return False, False, [{
            "component": "output",
            "baselineDigest": empty_digest,
            "candidateDigest": empty_digest,
            "reasonCode": "required_output_unverifiable",
        }]
    if len(left) != len(right) or [*_map_output_identities(
        left, include_activity=include_activity,
    )] != [*_map_output_identities(right, include_activity=include_activity)]:
        return False, False, [{
            "component": "output",
            "baselineDigest": _digest([
                _output_signature(activity, output)
                for _, activity, output in left
            ]),
            "candidateDigest": _digest([
                _output_signature(activity, output)
                for _, activity, output in right
            ]),
            "reasonCode": "output_contract_changed",
        }]
    matches = True
    verifiable = True
    differences: list[dict[str, Any]] = []
    for (left_activity, _left_activity_value, left_output), \
            (right_activity, _right_activity_value, right_output) in zip(left, right):
        comparator = left_output.get("comparator")
        if comparator != right_output.get("comparator") or not isinstance(comparator, dict):
            matches = False
            verifiable = False
            reason = "output_comparator_changed"
        elif comparator.get("kind") == "exact-digest":
            left_digest = left_output.get("contentDigest") or left_output.get("baselineDigest")
            right_digest = right_output.get("contentDigest") or right_output.get("baselineDigest")
            if not _is_digest(left_digest) or not _is_digest(right_digest):
                matches = False
                verifiable = False
                reason = "output_digest_missing"
            else:
                current_match = left_digest == right_digest
                matches = matches and current_match
                reason = "output_digest_changed"
                if current_match:
                    continue
        else:
            left_key = _output_value_key(left_activity, left_output)
            right_key = _output_value_key(right_activity, right_output)
            if baseline_values is None or candidate_values is None \
                    or left_key not in baseline_values or right_key not in candidate_values:
                matches = False
                verifiable = False
                reason = "explicit_comparator_requires_output_values"
            else:
                left_value = baseline_values[left_key]
                right_value = candidate_values[right_key]
                current_match = _compare_values(
                    left_value, right_value, comparator,
                )
                matches = matches and current_match
                reason = "explicit_comparator_mismatch"
                if current_match:
                    left_digest = left_output.get("contentDigest") \
                        or left_output.get("baselineDigest")
                    right_digest = right_output.get("contentDigest") \
                        or right_output.get("baselineDigest")
                    left_value_digest = _digest(left_value)
                    right_value_digest = _digest(right_value)
                    if left_digest != right_digest or left_value_digest != right_value_digest:
                        differences.append({
                            "component": "output",
                            "baselineDigest": left_digest,
                            "candidateDigest": right_digest,
                            "baselineValueDigest": left_value_digest,
                            "candidateValueDigest": right_value_digest,
                            "reasonCode": "explicit_comparator_match_with_observed_change",
                            "baselineOutputId": left_output.get("id"),
                            "candidateOutputId": right_output.get("id"),
                        })
                    continue
        differences.append({
            "component": "output",
            "baselineDigest": left_output.get("contentDigest") or left_output.get("baselineDigest"),
            "candidateDigest": right_output.get("contentDigest") or right_output.get("baselineDigest"),
            "reasonCode": reason,
            "baselineOutputId": left_output.get("id"),
            "candidateOutputId": right_output.get("id"),
        })
    return matches, verifiable, differences


def _map_output_identities(
    values: list[tuple[str, dict[str, Any], dict[str, Any]]],
    *, include_activity: bool,
):
    return (
        _output_identity(item, include_activity=include_activity)
        for item in values
    )


def compare_rerun_specs(
    baseline: dict[str, Any],
    candidate: dict[str, Any],
    *,
    baseline_output_values: Optional[dict[tuple[str, str], Any]] = None,
    candidate_output_values: Optional[dict[tuple[str, str], Any]] = None,
) -> dict[str, Any]:
    """Classify replay differences without inventing tolerance or certainty."""
    validate_rerun_spec(baseline)
    validate_rerun_spec(candidate)
    baseline_owners, candidate_owners = _paired_owner_indexes(baseline, candidate)
    owner_mapping_unambiguous = (
        baseline_owners is not None and candidate_owners is not None
    )
    owner_sets_match = owner_mapping_unambiguous and (
        set(baseline_owners.values()) == set(candidate_owners.values())
    )
    if owner_sets_match:
        baseline_input = _owned_fingerprint(
            baseline, "inputFingerprint", baseline_owners,
        )
        candidate_input = _owned_fingerprint(
            candidate, "inputFingerprint", candidate_owners,
        )
        baseline_spec = _owned_fingerprint(
            baseline, "specFingerprint", baseline_owners,
        )
        candidate_spec = _owned_fingerprint(
            candidate, "specFingerprint", candidate_owners,
        )
        baseline_context = _owned_fingerprint(
            baseline, "executionContextFingerprint", baseline_owners,
        )
        candidate_context = _owned_fingerprint(
            candidate, "executionContextFingerprint", candidate_owners,
        )
    else:
        # Preserve an explainable aggregate when an activity was added,
        # removed, or cannot be mapped.  The dependency comparison below still
        # fails closed, so this fallback cannot produce a replication claim.
        baseline_input = _aggregate_fingerprint(baseline, "inputFingerprint")
        candidate_input = _aggregate_fingerprint(candidate, "inputFingerprint")
        baseline_spec = _aggregate_fingerprint(baseline, "specFingerprint")
        candidate_spec = _aggregate_fingerprint(candidate, "specFingerprint")
        baseline_context = _aggregate_fingerprint(
            baseline, "executionContextFingerprint",
        )
        candidate_context = _aggregate_fingerprint(
            candidate, "executionContextFingerprint",
        )

    if owner_mapping_unambiguous:
        baseline_dependencies: Any = _normalized_dependencies(
            baseline, baseline_owners,
        )
        candidate_dependencies: Any = _normalized_dependencies(
            candidate, candidate_owners,
        )
    else:
        # Do not include run-local activity ids in the diagnostic digest.
        baseline_dependencies = {
            "ownerMapping": "ambiguous",
            "edgeCount": len(baseline.get("dependencies", [])),
            "relations": sorted(
                str(edge.get("relation"))
                for edge in baseline.get("dependencies", [])
                if isinstance(edge, dict)
            ),
        }
        candidate_dependencies = {
            "ownerMapping": "ambiguous",
            "edgeCount": len(candidate.get("dependencies", [])),
            "relations": sorted(
                str(edge.get("relation"))
                for edge in candidate.get("dependencies", [])
                if isinstance(edge, dict)
            ),
        }
    same_dependencies = owner_sets_match \
        and baseline_dependencies == candidate_dependencies
    same_input = baseline_input == candidate_input
    same_spec = baseline_spec == candidate_spec and same_dependencies
    same_context = baseline_context == candidate_context
    baseline_approvals = _approval_state_fingerprint(
        baseline, baseline_owners,
    )
    candidate_approvals = _approval_state_fingerprint(
        candidate, candidate_owners,
    )
    approval_changed = baseline_approvals != candidate_approvals

    result_match, output_comparison_verifiable, output_differences = _compare_outputs(
        baseline, candidate, baseline_output_values, candidate_output_values,
    )
    comparison_verifiable = output_comparison_verifiable \
        and owner_mapping_unambiguous
    uncontrolled = (
        baseline.get("reproducibility") == "uncontrolled"
        or candidate.get("reproducibility") == "uncontrolled"
    )
    incomplete = (
        baseline.get("reproducibility") == "incomplete"
        or candidate.get("reproducibility") == "incomplete"
    )

    differences: list[dict[str, Any]] = []
    for component, left, right in (
        ("input", baseline_input, candidate_input),
        ("spec", baseline_spec, candidate_spec),
        ("context", baseline_context, candidate_context),
    ):
        if left != right:
            differences.append({
                "component": component,
                "baselineDigest": left,
                "candidateDigest": right,
                "reasonCode": f"{component}_fingerprint_changed",
            })
    if not same_dependencies:
        differences.append({
            "component": "dependency",
            "baselineDigest": _digest(baseline_dependencies),
            "candidateDigest": _digest(candidate_dependencies),
            "reasonCode": "dependency_graph_changed",
        })
    if approval_changed:
        differences.append({
            "component": "approval",
            "baselineDigest": baseline_approvals,
            "candidateDigest": candidate_approvals,
            "reasonCode": "approval_decision_changed",
        })
    differences.extend(output_differences)

    if not same_input:
        classification = "input_changed"
        replication_status = "inconclusive"
        relation = None
    elif not same_context:
        classification = "context_changed"
        replication_status = "inconclusive"
        relation = None
    elif not same_spec:
        classification = "spec_changed"
        replication_status = "inconclusive"
        relation = None
    elif approval_changed:
        if not comparison_verifiable:
            classification = "unverifiable"
        elif incomplete:
            classification = "unverifiable" if result_match else "output_changed"
        elif result_match:
            classification = "component_changed"
        elif uncontrolled:
            classification = "uncontrolled_output_changed"
        else:
            classification = "output_changed"
        replication_status = "inconclusive"
        relation = None
    elif not comparison_verifiable:
        classification = "unverifiable"
        replication_status = "inconclusive"
        relation = None
    elif incomplete:
        # A blocking/incomplete export cannot support a replication claim even
        # when the bytes that happened to be observed are identical.
        classification = "unverifiable" if result_match else "output_changed"
        replication_status = "inconclusive"
        relation = None
    elif result_match:
        classification = "match"
        replication_status = "matched"
        relation = EdgeRel.REPLICATES.value
    elif uncontrolled:
        classification = "uncontrolled_output_changed"
        replication_status = "inconclusive"
        relation = None
    else:
        classification = "output_changed"
        replication_status = "failed"
        relation = EdgeRel.FAILS_TO_REPLICATE.value

    reason_codes = [item["reasonCode"] for item in differences]
    if same_input:
        reason_codes.insert(0, "same_input")
    if uncontrolled and not result_match:
        reason_codes.append("uncontrolled_randomness")
    if incomplete:
        reason_codes.append("incomplete_reproducibility")
    if not same_spec:
        reason_codes.append("execution_spec_changed")
    if not same_context:
        reason_codes.append("execution_context_changed")
    return {
        "schemaVersion": RERUN_COMPARISON_VERSION,
        "baselineSpecDigest": baseline["specDigest"],
        "candidateSpecDigest": candidate["specDigest"],
        "sameInput": same_input,
        "sameSpec": same_spec,
        "sameExecutionContext": same_context,
        "resultMatch": result_match,
        "comparisonVerifiable": comparison_verifiable,
        "classification": classification,
        "replicationStatus": replication_status,
        "replicationRelation": relation,
        "differences": differences,
        "reasonCodes": sorted(set(reason_codes)),
    }
