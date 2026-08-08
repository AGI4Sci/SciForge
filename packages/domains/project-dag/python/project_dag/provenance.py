"""Cross-layer Project Claim -> Evidence Snapshot -> Artifact resolver.

Access is evaluated while following the canonical provenance path.  The
resolver never treats stored ``accessPolicy`` metadata as caller
authorization: restricted objects are fail-closed unless a trusted
authorizer was injected by the host.  A denied path still reports opaque
hashes, existence, L0-L4 and an auditable breakpoint, but never returns
content, locators, selectors or run details.
"""
from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from typing import Any, Optional

from evidence_dag import build_rerun_spec

from .reader import SessionReader
from .snapshot_integrity import validate_project_snapshot_row
from .store import Store

_UPSTREAM = {"supports", "refines", "prerequisite", "derived_from", "generated_by"}
_RESTRICTED_LEVELS = {
    "restricted", "private", "confidential", "sensitive", "secret", "internal",
}
_ALLOWLIST_KEYS = {
    "allowedactors", "allowedprincipals", "allowedroles", "allowlist", "principals", "roles",
}
_PUBLIC_LEVELS = {"public", "open", "unrestricted"}
_PUBLIC_POLICY_KEYS = {
    "read", "public", "restricted", "visibility", "classification",
    "sensitivity", "accesslevel", "level",
}

# The callback is a trusted host dependency, not request data.  This prevents a
# query from granting itself access by merely sending ``granted=true``.
Authorizer = Callable[[dict[str, Any]], bool]


def _indexed(items: Any, *keys: str) -> dict[str, dict]:
    if isinstance(items, dict):
        values = items.values()
    elif isinstance(items, list):
        values = items
    else:
        values = []
    out: dict[str, dict] = {}
    for item in values:
        if not isinstance(item, dict):
            continue
        identifier = next((item.get(key) for key in keys if item.get(key)), None)
        if isinstance(identifier, str):
            out[identifier] = item
    return out


def _digest(kind: str, value: Any) -> str:
    if isinstance(value, str) and value.startswith("sha256:") and len(value) == 71:
        return value
    try:
        canonical = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    except (TypeError, ValueError):
        canonical = str(value)
    raw = f"project-provenance-access-v1|{kind}|{canonical}".encode("utf-8")
    return "sha256:" + hashlib.sha256(raw).hexdigest()


def _policies(value: Any) -> list[Any]:
    if not isinstance(value, dict):
        return []
    policies = []
    for key in ("accessPolicy", "access_policy", "edag:accessPolicy", "edag:access_policy"):
        if key in value:
            policies.append(value[key])
    for attribute_key in ("attributes", "edag:attributes"):
        attributes = value.get(attribute_key)
        if isinstance(attributes, dict):
            for key in ("accessPolicy", "access_policy"):
                if key in attributes:
                    policies.append(attributes[key])
    return policies


def _is_restricted_policy(policy: Any) -> bool:
    if policy is None:
        return False
    if isinstance(policy, str):
        level = policy.strip().lower()
        return bool(level) and level not in _PUBLIC_LEVELS
    if isinstance(policy, list):
        # An empty JSON collection is equivalent to no policy. Non-empty
        # policy arrays have no supported semantics and are fail-closed.
        return bool(policy)
    if not isinstance(policy, dict):
        # Booleans, numbers, and other unknown policy encodings cannot grant
        # access merely because the parser accepted them as JSON values.
        return True
    if not policy:
        return False

    normalized: dict[str, Any] = {}
    for key, value in policy.items():
        normalized_key = str(key).replace("_", "").replace("-", "").lower()
        if normalized_key in normalized:
            return True
        normalized[normalized_key] = value
    if normalized.get("read") is False or normalized.get("public") is False \
            or normalized.get("restricted") is True:
        return True
    read = normalized.get("read")
    if isinstance(read, dict) and (read.get("allowed") is False or read.get("granted") is False):
        return True
    for key in ("visibility", "classification", "sensitivity", "accesslevel", "level"):
        value = normalized.get(key)
        if isinstance(value, str) and value.strip().lower() in _RESTRICTED_LEVELS:
            return True
    if any(key in normalized and normalized[key] not in (None, [], {}, "")
           for key in _ALLOWLIST_KEYS):
        return True

    # Explicit public policies use a closed schema. Even a readable/public
    # marker cannot override an unknown ACL or tenant constraint alongside it.
    if set(normalized) - _PUBLIC_POLICY_KEYS:
        return True
    if set(normalized).intersection(_ALLOWLIST_KEYS):
        return True
    if "read" in normalized and normalized["read"] is not True:
        return True
    if "public" in normalized and normalized["public"] is not True:
        return True
    if "restricted" in normalized and normalized["restricted"] is not False:
        return True
    for key in ("visibility", "classification", "sensitivity", "accesslevel", "level"):
        if key not in normalized:
            continue
        value = normalized[key]
        if not isinstance(value, str) or value.strip().lower() not in _PUBLIC_LEVELS:
            return True
    explicitly_public = any((
        normalized.get("public") is True,
        normalized.get("read") is True,
        any(
            isinstance(normalized.get(key), str)
            and normalized[key].strip().lower() in _PUBLIC_LEVELS
            for key in ("visibility", "classification", "sensitivity", "accesslevel", "level")
        ),
    ))
    return not explicitly_public


def _restriction(subject_type: str, subject_id: Any, value: Any) -> Optional[dict[str, Any]]:
    policies = _policies(value)
    restricted_policies = [policy for policy in policies if _is_restricted_policy(policy)]
    restricted_availability = isinstance(value, dict) \
        and str(value.get("availability", "")).lower() == "restricted"
    if not restricted_availability and not restricted_policies:
        return None
    policy = (restricted_policies[0] if len(restricted_policies) == 1 else
              {"allOf": restricted_policies} if restricted_policies else
              policies[0] if policies else None)
    return {
        "subjectType": subject_type,
        "subjectHash": _digest(subject_type, subject_id),
        "accessLevel": "restricted",
        # Policy is supplied only to the trusted authorizer and is never copied
        # to a response (ACLs can themselves contain sensitive identities).
        "policy": policy,
        "restrictedAvailability": restricted_availability,
    }


def _public_request(request: dict[str, Any]) -> dict[str, Any]:
    return {key: request[key] for key in ("subjectType", "subjectHash", "accessLevel")}


def _safe_snapshot(snapshot: Any) -> dict[str, Any]:
    raw = snapshot.to_dict() if hasattr(snapshot, "to_dict") else (snapshot or {})
    return {
        "digest": raw.get("digest"),
        "exists": bool(raw),
        "accessLevel": "restricted",
    }


def _safe_claim(claim: dict) -> dict[str, Any]:
    # ``project_key`` is retained only because Engine uses it as the
    # caller-supplied project boundary check before serialisation.  It does not
    # expose content that the caller did not already provide in the request.
    return {
        "id": claim.get("id"),
        "project_key": claim.get("project_key"),
        "contentDigest": _digest("claim-content", claim.get("statement")),
        "exists": True,
        "accessLevel": "restricted",
    }


def _safe_registry_object(kind: str, identifier: Any, value: Optional[dict],
                          *, content_digest: Optional[str] = None) -> dict[str, Any]:
    out = {
        f"{kind}Hash": _digest(kind, identifier),
        "exists": value is not None,
        "accessLevel": "restricted",
    }
    if content_digest:
        out["contentDigest"] = content_digest
    return out


def _safe_session_path(path: list[dict]) -> list[dict]:
    return [{
        "edgeHash": _digest("edge", edge.get("edgeId")),
        "fromHash": _digest("node", edge.get("from")),
        "toHash": _digest("node", edge.get("to")),
    } for edge in path]


def _safe_source_path(
    path: dict[str, Any], *, thread_id: str, session_claim_id: str,
    evidence_snapshot: Any,
) -> dict[str, Any]:
    """Rebuild a previously public source path using the restricted allowlist.

    SourceAssertion traversal runs before the full Evidence closure is known.
    A later restricted ToolInvocation or run must therefore replace—not merely
    annotate—the earlier public object.  Reconstructing the value also avoids
    accidentally retaining future public-only fields added to that contract.
    """
    assertions: list[dict[str, Any]] = []
    for assertion in path.get("sourceAssertions", []):
        if not isinstance(assertion, dict):
            continue
        artifact = assertion.get("artifact")
        artifact = artifact if isinstance(artifact, dict) else None
        version = assertion.get("artifactVersion")
        version = version if isinstance(version, dict) else None
        anchor = assertion.get("sourceAnchor")
        anchor = anchor if isinstance(anchor, dict) else None
        run = assertion.get("run")
        run = run if isinstance(run, dict) else None
        content_digest = ((version or {}).get("contentDigest")
                          or (artifact or {}).get("contentDigest"))
        anchor_digest = (anchor or {}).get("anchorDigest")
        assertions.append({
            "sourceAssertionHash": _digest(
                "source_assertion", assertion.get("sourceAssertionId")),
            "artifact": _safe_registry_object(
                "artifact", assertion.get("artifactId"), artifact,
                content_digest=content_digest,
            ),
            "artifactVersion": _safe_registry_object(
                "artifactVersion", assertion.get("artifactVersionId"), version,
                content_digest=content_digest,
            ),
            "sourceAnchor": _safe_registry_object(
                "sourceAnchor", assertion.get("sourceAnchorId"), anchor,
                content_digest=anchor_digest,
            ),
            "run": (_safe_registry_object(
                "run", assertion.get("sourceAssertionId"), run,
            ) if run is not None else None),
            "level": assertion.get("level", "L0"),
            "sessionPath": _safe_session_path(
                assertion.get("sessionPath")
                if isinstance(assertion.get("sessionPath"), list) else []
            ),
            "exists": True,
            "accessLevel": "restricted",
        })
    return {
        "originHash": _digest("thread", thread_id),
        "evidenceSnapshot": _safe_snapshot(evidence_snapshot),
        "sessionClaimHash": _digest("node", session_claim_id),
        "sourceAssertions": assertions,
        "level": path.get("level", "L0"),
        "exists": True,
        "accessLevel": "restricted",
    }


def _safe_breakpoint(item: dict) -> dict[str, Any]:
    subject = item.get("nodeId") or item.get("threadId") or item.get("detail") or item.get("reason")
    return {
        "reason": item.get("reason", "provenance_breakpoint"),
        "subjectHash": _digest("breakpoint-subject", subject),
        "accessLevel": "restricted",
    }


def _qualified(snapshot_digest: str, kind: str, identifier: Any) -> str:
    return f"evidence:{snapshot_digest}:{kind}:{identifier}"


def _raw_nodes(doc: dict) -> dict[str, dict]:
    result: dict[str, dict] = {}
    for section in ("entity", "activity", "agent"):
        for node_id, value in (doc.get(section) or {}).items():
            if isinstance(value, dict):
                result[node_id] = value
    return result


def _node_type(value: dict) -> str:
    return str(value.get("prov:type") or "edag:entity").split(":", 1)[-1]


class ProvenanceResolver:
    def __init__(self, store: Store, reader: SessionReader,
                 authorizer: Optional[Authorizer] = None) -> None:
        self.store = store
        self.reader = reader
        self.authorizer = authorizer

    def _denied(self, requests: list[Optional[dict[str, Any]]]) \
            -> tuple[bool, list[dict[str, Any]]]:
        restricted = [request for request in requests if request is not None]
        denied: list[dict[str, Any]] = []
        for request in restricted:
            allowed = False
            if self.authorizer is not None:
                try:
                    allowed = self.authorizer(dict(request)) is True
                except Exception:  # authorization failures are fail-closed
                    allowed = False
            if not allowed:
                denied.append(request)
        return bool(denied), denied

    def project_access(self, snapshot_digest: str) -> dict[str, Any]:
        """Resolve snapshot/graph/scope policy even when the graph has no claims."""
        row = self.store.q1(
            "SELECT * FROM project_snapshot WHERE digest=?", (snapshot_digest,))
        if row is None:
            raise KeyError(snapshot_digest)
        snapshot = validate_project_snapshot_row(row)
        graph = snapshot.get("graph")
        graph = graph if isinstance(graph, dict) else {}
        scope = snapshot.get("capturedScope") or snapshot.get("scope") or graph.get("scope")
        requests = [
            _restriction("project_snapshot", snapshot_digest, snapshot),
            _restriction("project_graph", row["project_key"], graph),
            _restriction("project_scope", row["project_key"], scope),
        ]
        denied, denied_requests = self._denied(requests)
        restricted = any(request is not None for request in requests)
        return {
            "level": "restricted" if restricted else "public",
            "redacted": denied,
            "authorized": restricted and not denied,
            "breakpoints": [
                {**_public_request(request), "reason": "access_restricted"}
                for request in denied_requests
            ],
        }

    def evidence_vector_access(self, vector: Any) -> dict[str, Any]:
        """Evaluate accepted Evidence inputs before a Project snapshot exists.

        The first Project update already has durable read surfaces (receipt,
        status and history), but it does not yet have a Project Snapshot whose
        policy can drive those projections.  Resolve the immutable accepted
        Evidence vector and recursively inspect its policy-bearing records so
        that this pre-commit interval is fail-closed as well.
        """
        if not isinstance(vector, list):
            return {
                "level": "restricted", "redacted": True, "authorized": False,
                "breakpoints": [],
            }

        requests: list[Optional[dict[str, Any]]] = []
        for index, entry in enumerate(vector):
            if not isinstance(entry, dict):
                return {
                    "level": "restricted", "redacted": True, "authorized": False,
                    "breakpoints": [],
                }
            thread_id, snapshot_digest = entry.get("threadId"), entry.get("digest")
            if not isinstance(thread_id, str) or not thread_id \
                    or not isinstance(snapshot_digest, str) or not snapshot_digest:
                return {
                    "level": "restricted", "redacted": True, "authorized": False,
                    "breakpoints": [],
                }
            try:
                _, _, document = self.reader.load(thread_id, snapshot_digest)
            except Exception:  # noqa: BLE001 - an unverified input cannot authorize a read
                return {
                    "level": "restricted", "redacted": True, "authorized": False,
                    "breakpoints": [],
                }

            def collect(value: Any, path: tuple[Any, ...]) -> None:
                if isinstance(value, dict):
                    requests.append(_restriction(
                        "evidence_record",
                        {"snapshotDigest": snapshot_digest, "path": path},
                        value,
                    ))
                    for key, child in value.items():
                        collect(child, (*path, key))
                elif isinstance(value, list):
                    for child_index, child in enumerate(value):
                        collect(child, (*path, child_index))

            collect(document, (index,))

        denied, denied_requests = self._denied(requests)
        restricted = any(request is not None for request in requests)
        return {
            "level": "restricted" if restricted else "public",
            "redacted": denied,
            "authorized": restricted and not denied,
            "breakpoints": [
                {**_public_request(request), "reason": "access_restricted"}
                for request in denied_requests
            ],
        }

    def resolve(self, target_id: str, snapshot_digest: str) -> dict:
        """Resolve a federated Project Conclusion -> complete Evidence lineage.

        The committed Project Snapshot keeps only immutable EvidenceRefs. Node
        payloads below are hydrated on demand from the verified Evidence
        Snapshot, so Project storage never becomes a second Evidence fact store.
        """
        result = self._resolve_source_assertions(target_id, snapshot_digest)
        row = self.store.q1(
            "SELECT * FROM project_snapshot WHERE digest=?", (snapshot_digest,))
        if row is None:
            raise KeyError(snapshot_digest)
        snapshot = validate_project_snapshot_row(row)
        graph_payload = snapshot["graph"]
        claim = next((item for item in graph_payload["claims"]
                      if item["id"] == target_id), None)
        if claim is None:
            raise KeyError(target_id)
        vector = {entry["threadId"]: entry["digest"]
                  for entry in snapshot["evidenceVector"]}
        origins = [item for item in graph_payload["origins"]
                   if item["claim_id"] == target_id]

        lineage_nodes: dict[str, dict[str, Any]] = {}
        lineage_edges: dict[str, dict[str, Any]] = {}
        rerun_specs: list[dict[str, Any]] = []
        rerun_spec_references: list[dict[str, Any]] = []
        access_breakpoints: dict[tuple[str, str], dict[str, Any]] = {}
        any_restricted = (result.get("access") or {}).get("level") == "restricted"
        any_redacted = bool((result.get("access") or {}).get("redacted"))
        conclusion_id = f"project:{target_id}"
        if any_redacted:
            lineage_nodes[conclusion_id] = {
                "id": conclusion_id, "nodeType": "conclusion",
                "contentDigest": _digest("claim-content", claim.get("statement")),
                "exists": True, "accessLevel": "restricted", "layer": "project",
            }
        else:
            lineage_nodes[conclusion_id] = {
                "id": conclusion_id,
                "nodeId": target_id,
                "nodeType": "conclusion" if claim.get("claim_type") == "conclusion"
                else "project_claim",
                "statement": claim.get("statement"),
                "status": claim.get("status"),
                "layer": "project",
            }

        max_level = int(str(result.get("provenanceLevel") or "L0")[1:] or 0)
        has_artifact = bool(result.get("reachesArtifact"))
        extra_breakpoints: list[dict[str, Any]] = []
        for origin in origins:
            thread_id = origin["session_id"]
            expected_digest = vector.get(thread_id)
            if expected_digest is None:
                extra_breakpoints.append({
                    "threadId": thread_id, "reason": "origin_not_in_evidence_vector",
                })
                continue
            try:
                evidence_graph, evidence_snapshot, doc = self.reader.load(
                    thread_id, expected_digest)
            except (OSError, ValueError) as exc:
                extra_breakpoints.append({
                    "threadId": thread_id, "reason": "snapshot_unavailable",
                    "detail": str(exc),
                })
                continue
            evidence_lineage = evidence_graph.conclusion_lineage(origin["node_id"])
            node_ids = [item["id"] for item in evidence_lineage["nodes"]]
            evidence_edges = evidence_lineage["edges"]
            raw_nodes = _raw_nodes(doc)
            registry = doc.get("edag:artifactRegistry")
            registry = registry if isinstance(registry, dict) else {}
            artifacts = _indexed(registry.get("artifacts"), "artifactId")
            versions = _indexed(
                registry.get("artifactVersions"), "artifactVersionId", "versionId")
            anchors = _indexed(registry.get("sourceAnchors"), "sourceAnchorId", "anchorId")

            restrictions: list[Optional[dict[str, Any]]] = []
            for node_id in node_ids:
                restrictions.append(_restriction(
                    "evidence_node", node_id, raw_nodes.get(node_id)))
                node = evidence_graph.nodes.get(node_id)
                if node is None:
                    continue
                restrictions.extend((
                    _restriction("artifact", node.artifact_id,
                                 artifacts.get(node.artifact_id or "")),
                    _restriction("artifact_version", node.artifact_version_id,
                                 versions.get(node.artifact_version_id or "")),
                    _restriction("source_anchor", node.source_anchor_id,
                                 anchors.get(node.source_anchor_id or "")),
                ))
            closure_denied, denied_requests = self._denied(restrictions)
            closure_restricted = any(item is not None for item in restrictions)
            paths = result.get("paths", [])
            source_path_index = next((
                index for index, item in enumerate(paths)
                if (
                    item.get("threadId") == thread_id
                    and item.get("sessionClaimId") == origin["node_id"]
                ) or (
                    item.get("originHash") == _digest("thread", thread_id)
                    and item.get("sessionClaimHash") == _digest(
                        "node", origin["node_id"])
                )
            ), None)
            source_path = (paths[source_path_index]
                           if source_path_index is not None else None)
            inherited_denied = bool(
                isinstance(source_path, dict)
                and source_path.get("accessLevel") == "restricted"
                and not source_path.get("threadId")
            )
            lineage_denied = inherited_denied or closure_denied
            any_restricted = any_restricted or closure_restricted
            any_redacted = any_redacted or lineage_denied
            if lineage_denied and source_path_index is not None and not inherited_denied:
                source_path = _safe_source_path(
                    source_path,
                    thread_id=thread_id,
                    session_claim_id=origin["node_id"],
                    evidence_snapshot=evidence_snapshot,
                )
                paths[source_path_index] = source_path
                closure_node_ids = set(node_ids)
                result["breakpoints"] = [
                    _safe_breakpoint(item)
                    if item.get("accessLevel") != "restricted" and (
                        item.get("threadId") == thread_id
                        or item.get("nodeId") in closure_node_ids
                    ) else item
                    for item in result.get("breakpoints", [])
                ]
            for request in denied_requests:
                public = _public_request(request)
                public["reason"] = "access_restricted"
                access_breakpoints[(public["subjectType"], public["subjectHash"])] = public

            def qualified(kind: str, identifier: Any) -> str:
                visible_id = _digest(kind, identifier) if lineage_denied else identifier
                return _qualified(expected_digest, kind, visible_id)

            origin_qid = qualified("node", origin["node_id"])
            if lineage_denied:
                for node_id in node_ids:
                    raw = raw_nodes.get(node_id) or {}
                    qid = qualified("node", node_id)
                    lineage_nodes[qid] = {
                        "id": qid, "nodeHash": _digest("node", node_id),
                        "nodeType": _node_type(raw), "threadHash": _digest("thread", thread_id),
                        "snapshotDigest": expected_digest, "exists": True,
                        "accessLevel": "restricted", "layer": "evidence",
                    }
            else:
                for node_id in node_ids:
                    node = evidence_graph.nodes.get(node_id)
                    if node is None:
                        continue
                    qid = qualified("node", node_id)
                    lineage_nodes[qid] = {
                        "id": qid, "nodeId": node_id, "nodeType": node.type.value,
                        "threadId": thread_id, "snapshotDigest": expected_digest,
                        "content": node.content, "status": node.status.value,
                        "createdAt": node.created_at, "createdBy": node.created_by,
                        "attributes": node.attributes,
                        **({"artifactId": node.artifact_id} if node.artifact_id else {}),
                        **({"artifactVersionId": node.artifact_version_id}
                           if node.artifact_version_id else {}),
                        **({"sourceAnchorId": node.source_anchor_id}
                           if node.source_anchor_id else {}),
                        "layer": "evidence",
                    }

            for edge in evidence_edges:
                edge_id = qualified("edge", edge["id"])
                lineage_edges[edge_id] = {
                    "id": edge_id,
                    "src": qualified("node", edge["src"]),
                    "dst": qualified("node", edge["dst"]),
                    "relation": edge["rel"],
                    "evidenceEdgeId": (_digest("edge", edge["id"])
                                       if lineage_denied else edge["id"]),
                    "threadId": (_digest("thread", thread_id)
                                 if lineage_denied else thread_id),
                    "snapshotDigest": expected_digest,
                }
            origin_edge_id = qualified(
                "edge", f"origin:{origin['node_id']}:{target_id}")
            lineage_edges[origin_edge_id] = {
                "id": origin_edge_id, "src": origin_qid, "dst": conclusion_id,
                "relation": "supports", "layer": "cross_dag",
            }

            # Registry records are materialized only in this read model. They
            # remain owned by the immutable Evidence Snapshot.
            for node_id in node_ids:
                node = evidence_graph.nodes.get(node_id)
                if node is None:
                    continue
                node_qid = qualified("node", node_id)
                registry_chain = (
                    ("source_anchor", node.source_anchor_id,
                     anchors.get(node.source_anchor_id or ""), "anchored_at"),
                    ("artifact_version", node.artifact_version_id,
                     versions.get(node.artifact_version_id or ""), "references_version"),
                    ("artifact", node.artifact_id,
                     artifacts.get(node.artifact_id or ""), "references_artifact"),
                )
                previous = node_qid
                for kind, identifier, value, relation in registry_chain:
                    if not identifier or value is None:
                        continue
                    qid = qualified(kind, identifier)
                    if lineage_denied:
                        content_digest = value.get("contentDigest") or value.get("anchorDigest")
                        lineage_nodes[qid] = {
                            "id": qid, "nodeType": kind,
                            **_safe_registry_object(
                                kind, identifier, value, content_digest=content_digest),
                            "snapshotDigest": expected_digest, "layer": "evidence_registry",
                        }
                    else:
                        lineage_nodes[qid] = {
                            "id": qid, "nodeId": identifier, "nodeType": kind,
                            "threadId": thread_id, "snapshotDigest": expected_digest,
                            "record": value, "layer": "evidence_registry",
                        }
                    has_artifact = has_artifact or kind == "artifact"
                    registry_edge_id = qualified(
                        "edge", f"registry:{node_id}:{identifier}:{relation}")
                    lineage_edges[registry_edge_id] = {
                        "id": registry_edge_id, "src": previous, "dst": qid,
                        "relation": relation, "layer": "evidence_registry",
                    }
                    previous = qid

            rerun_spec: Optional[dict[str, Any]] = None
            try:
                rerun_spec = build_rerun_spec(
                    evidence_graph, evidence_snapshot, origin["node_id"])
            except (KeyError, TypeError, ValueError) as exc:
                extra_breakpoints.append({
                    "threadId": thread_id,
                    "nodeId": origin["node_id"],
                    "reason": "rerun_spec_unavailable",
                    "detail": str(exc),
                })
            if rerun_spec is not None:
                execution_ready = rerun_spec["executionReady"] is True
                if execution_ready:
                    max_level = max(max_level, 4)
                if lineage_denied:
                    reference = {
                        "threadHash": _digest("thread", thread_id),
                        "snapshotDigest": expected_digest,
                        "conclusionHash": _digest("node", origin["node_id"]),
                        "specDigest": rerun_spec["specDigest"],
                        "accessLevel": "restricted",
                    }
                else:
                    reference = {
                        "threadId": thread_id,
                        "snapshotDigest": expected_digest,
                        "conclusionId": origin["node_id"],
                        "specDigest": rerun_spec["specDigest"],
                        "executionReady": execution_ready,
                        "accessLevel": ("restricted" if closure_restricted else "public"),
                    }
                    rerun_specs.append(rerun_spec)
                rerun_spec_references.append(reference)
                for breakpoint in rerun_spec["breakpoints"]:
                    extra_breakpoints.append({
                        "threadId": thread_id,
                        "nodeId": origin["node_id"],
                        "reason": "rerun_spec_blocked",
                        **breakpoint,
                    })

            # Preserve the established path/detail contract while extending it
            # with run-oriented evidence that need not contain SourceAssertions.
            path = source_path
            if path is not None and not lineage_denied:
                if rerun_spec is not None:
                    path["rerunSpecReference"] = reference
                path["lineageNodeIds"] = [
                    qualified("node", node_id) for node_id in node_ids]
                if rerun_spec is not None and not path.get("sourceAssertions"):
                    path["level"] = "L4" if execution_ready else "L3"

        if rerun_spec_references:
            result["breakpoints"] = [
                item for item in result.get("breakpoints", [])
                if item.get("reason") != "no_source_assertion_path"
            ]
        if any_redacted:
            extra_breakpoints = [_safe_breakpoint(item) for item in extra_breakpoints]
        result["breakpoints"].extend(extra_breakpoints)
        result["breakpoints"].extend(access_breakpoints.values())
        # Stable de-duplication is part of the resolver contract.
        result["breakpoints"] = list({
            json.dumps(item, ensure_ascii=False, sort_keys=True): item
            for item in result["breakpoints"]
        }.values())
        result["lineageGraph"] = {
            "nodes": [lineage_nodes[key] for key in sorted(lineage_nodes)],
            "edges": [lineage_edges[key] for key in sorted(lineage_edges)],
        }
        result["rerunSpecReferences"] = sorted(
            rerun_spec_references,
            key=lambda item: str(item.get("threadId") or item.get("threadHash") or ""),
        )
        result["rerunSpecs"] = sorted(
            rerun_specs,
            key=lambda item: str(item.get("specDigest") or ""),
        )
        result["reachesArtifact"] = has_artifact
        result["provenanceLevel"] = f"L{max_level}"
        result["access"] = {
            "level": "restricted" if any_restricted else "public",
            "redacted": any_redacted,
            "authorized": any_restricted and not any_redacted,
        }
        return result

    def _resolve_source_assertions(self, target_id: str, snapshot_digest: str) -> dict:
        row = self.store.q1(
            "SELECT * FROM project_snapshot WHERE digest=?", (snapshot_digest,))
        if row is None:
            raise KeyError(snapshot_digest)
        snapshot = validate_project_snapshot_row(row)
        graph = snapshot["graph"]
        claim = next((c for c in graph["claims"] if c["id"] == target_id), None)
        if claim is None:
            raise KeyError(target_id)

        scope = snapshot.get("capturedScope") or snapshot.get("scope") or graph.get("scope")
        global_policy_requests = [
            _restriction("project_snapshot", snapshot_digest, snapshot),
            _restriction("project_graph", row["project_key"], graph),
            _restriction("project_scope", row["project_key"], scope),
            _restriction("project_claim", target_id, claim),
        ]
        global_denied, global_requests = self._denied(global_policy_requests)

        vector = {entry["threadId"]: entry["digest"] for entry in snapshot["evidenceVector"]}
        origins = [origin for origin in graph["origins"] if origin["claim_id"] == target_id]
        paths: list[dict] = []
        breakpoints: list[dict] = []
        access_breakpoints: dict[tuple[str, str], dict[str, Any]] = {}

        def record_denials(requests: list[dict[str, Any]]) -> None:
            for request in requests:
                public = _public_request(request)
                public["reason"] = "access_restricted"
                access_breakpoints[(public["subjectType"], public["subjectHash"])] = public

        record_denials(global_requests)
        max_level = 0
        any_redacted = global_denied
        any_restricted = any(request is not None for request in global_policy_requests)
        for origin in origins:
            thread_id = origin["session_id"]
            expected_digest = vector.get(thread_id)
            if expected_digest is None:
                item = {"threadId": thread_id, "reason": "origin_not_in_evidence_vector"}
                breakpoints.append(_safe_breakpoint(item) if global_denied else item)
                continue
            try:
                _, evidence_snapshot, doc = self.reader.load(thread_id, expected_digest)
            except (OSError, ValueError) as exc:
                item = {"threadId": thread_id, "reason": "snapshot_unavailable",
                        "detail": str(exc)}
                breakpoints.append(_safe_breakpoint(item) if global_denied else item)
                continue
            entities = doc.get("entity") or {}
            influences = doc.get("wasInfluencedBy") or {}
            upstream: dict[str, list[tuple[str, str]]] = {}
            for edge_id, edge in influences.items():
                rel = edge.get("edag:rel")
                if rel in _UPSTREAM:
                    upstream.setdefault(edge.get("prov:influencee"), []).append(
                        (edge.get("prov:influencer"), edge_id))
            start = origin["node_id"]
            start_entity = entities.get(start) or {}
            session_policy_requests = [
                _restriction("evidence_claim", start, start_entity),
            ]
            session_denied, session_requests = self._denied(session_policy_requests)
            any_restricted = any_restricted or any(
                request is not None for request in session_policy_requests)
            record_denials(session_requests)
            inherited_denied = global_denied or session_denied
            stack: list[tuple[str, list[dict]]] = [(start, [])]
            visited: set[str] = set()
            assertions: list[tuple[str, list[dict]]] = []
            while stack:
                node_id, edge_path = stack.pop()
                if node_id in visited:
                    continue
                visited.add(node_id)
                entity = entities.get(node_id) or {}
                if entity.get("prov:type") == "edag:source_assertion":
                    assertions.append((node_id, edge_path))
                    continue
                for parent, edge_id in upstream.get(node_id, []):
                    stack.append((parent, edge_path + [{"edgeId": edge_id,
                                                        "from": parent, "to": node_id}]))
            if not assertions:
                item = {"threadId": thread_id, "nodeId": start,
                        "reason": "no_source_assertion_path"}
                breakpoints.append(_safe_breakpoint(item) if inherited_denied else item)
                if inherited_denied:
                    any_redacted = True
                    paths.append({
                        "originHash": _digest("thread", thread_id),
                        "evidenceSnapshot": _safe_snapshot(evidence_snapshot),
                        "sessionClaimHash": _digest("node", start),
                        "sourceAssertions": [], "level": "L0",
                        "exists": True, "accessLevel": "restricted",
                    })
                else:
                    paths.append({
                        "threadId": thread_id, "evidenceSnapshot": evidence_snapshot.to_dict(),
                        "sessionClaimId": start, "sourceAssertions": [], "level": "L0",
                    })
                continue
            registry = doc.get("edag:artifactRegistry")
            if not isinstance(registry, dict):
                registry = {}
            artifacts = _indexed(registry.get("artifacts"), "artifactId")
            versions = _indexed(registry.get("artifactVersions"), "artifactVersionId", "versionId")
            anchors = _indexed(registry.get("sourceAnchors"), "sourceAnchorId", "anchorId")
            resolved_assertions = []
            path_level = 0
            path_redacted = inherited_denied
            for assertion_id, edge_path in assertions:
                entity = entities[assertion_id]
                artifact_id = entity.get("edag:artifact_id")
                version_id = entity.get("edag:artifact_version_id")
                anchor_id = entity.get("edag:source_anchor_id")
                artifact = artifacts.get(artifact_id)
                version = versions.get(version_id)
                anchor = anchors.get(anchor_id)
                locator = (version or {}).get("locator")
                trace_only = isinstance(locator, str) and locator.lower().startswith(
                    ("runtime:", "trace:")
                )
                level = 0
                if artifact and isinstance(locator, str) and locator and not trace_only:
                    level = 1
                selector = anchor.get("selector") if anchor else None
                if level >= 1 and isinstance(selector, dict) and selector.get("type") and not trace_only:
                    level = 2
                content_digest = ((version or {}).get("contentDigest")
                                  or (artifact or {}).get("contentDigest"))
                if level >= 2 and content_digest and (anchor or {}).get("anchorDigest") \
                        and not trace_only:
                    level = 3
                run = entity.get("edag:run")
                if level >= 3 and isinstance(run, dict) and all(
                    run.get(key) for key in ("inputs", "software", "parameters", "environment", "outputs")
                ):
                    level = 4
                path_level = max(path_level, level)

                assertion_policy_requests = [
                    _restriction("source_assertion", assertion_id, entity),
                    _restriction("artifact", artifact_id, artifact),
                    _restriction("artifact_version", version_id, version),
                    _restriction("source_anchor", anchor_id, anchor),
                    _restriction("run", assertion_id, run),
                ]
                assertion_denied, assertion_requests = self._denied(assertion_policy_requests)
                any_restricted = any_restricted or any(
                    request is not None for request in assertion_policy_requests)
                record_denials(assertion_requests)
                denied = inherited_denied or assertion_denied
                path_redacted = path_redacted or denied
                any_redacted = any_redacted or denied
                if trace_only:
                    item = {"threadId": thread_id, "nodeId": assertion_id,
                            "reason": "external_artifact_not_identified"}
                    breakpoints.append(_safe_breakpoint(item) if denied else item)
                elif artifact is None:
                    item = {"threadId": thread_id, "nodeId": assertion_id,
                            "reason": "artifact_not_registered"}
                    breakpoints.append(_safe_breakpoint(item) if denied else item)
                elif anchor is None:
                    item = {"threadId": thread_id, "nodeId": assertion_id,
                            "reason": "source_anchor_missing"}
                    breakpoints.append(_safe_breakpoint(item) if denied else item)
                elif level < 3:
                    item = {"threadId": thread_id, "nodeId": assertion_id,
                            "reason": "artifact_or_anchor_digest_missing"}
                    breakpoints.append(_safe_breakpoint(item) if denied else item)

                if denied:
                    anchor_digest = (anchor or {}).get("anchorDigest")
                    resolved_assertions.append({
                        "sourceAssertionHash": _digest("source_assertion", assertion_id),
                        "artifact": _safe_registry_object(
                            "artifact", artifact_id, artifact, content_digest=content_digest),
                        "artifactVersion": _safe_registry_object(
                            "artifactVersion", version_id, version, content_digest=content_digest),
                        "sourceAnchor": _safe_registry_object(
                            "sourceAnchor", anchor_id, anchor, content_digest=anchor_digest),
                        "run": (_safe_registry_object("run", assertion_id, run)
                                if run is not None else None),
                        "level": f"L{level}",
                        "sessionPath": _safe_session_path(edge_path),
                        "exists": True,
                        "accessLevel": "restricted",
                    })
                else:
                    resolved_assertions.append({
                        "sourceAssertionId": assertion_id,
                        "content": entity.get("edag:content"),
                        "artifactId": artifact_id,
                        "artifactVersionId": version_id,
                        "sourceAnchorId": anchor_id,
                        "artifact": artifact,
                        "artifactVersion": version,
                        "sourceAnchor": anchor,
                        "run": run,
                        "level": f"L{level}",
                        "sessionPath": edge_path,
                    })
            max_level = max(max_level, path_level)
            if path_redacted:
                paths.append({
                    "originHash": _digest("thread", thread_id),
                    "evidenceSnapshot": _safe_snapshot(evidence_snapshot),
                    "sessionClaimHash": _digest("node", start),
                    "sourceAssertions": resolved_assertions,
                    "level": f"L{path_level}",
                    "exists": True,
                    "accessLevel": "restricted",
                })
            else:
                paths.append({
                    "threadId": thread_id,
                    "evidenceSnapshot": evidence_snapshot.to_dict(),
                    "sessionClaimId": start,
                    "sourceAssertions": resolved_assertions,
                    "level": f"L{path_level}",
                })
        if not origins:
            item = {"reason": "project_claim_has_no_session_origin"}
            breakpoints.append(_safe_breakpoint(item) if global_denied else item)
        breakpoints.extend(access_breakpoints.values())
        return {
            "targetId": target_id,
            "projectSnapshotDigest": snapshot_digest,
            "claim": _safe_claim(claim) if global_denied else claim,
            "evidenceVector": ([{
                "digest": entry.get("digest"), "exists": True, "accessLevel": "restricted",
            } for entry in snapshot["evidenceVector"]] if global_denied
                else snapshot["evidenceVector"]),
            "paths": paths,
            "reachesArtifact": any(
                assertion.get("artifact", {}).get("exists", True)
                if isinstance(assertion.get("artifact"), dict) else False
                for path in paths for assertion in path.get("sourceAssertions", [])
            ),
            "provenanceLevel": f"L{max_level}",
            "access": {
                "level": "restricted" if any_restricted else "public",
                "redacted": any_redacted,
                "authorized": any_restricted and not any_redacted,
            },
            "breakpoints": breakpoints,
        }
