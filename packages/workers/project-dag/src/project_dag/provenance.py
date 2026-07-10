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

from .reader import SessionReader
from .store import Store

_UPSTREAM = {"supports", "refines", "prerequisite", "derived_from", "generated_by"}
_RESTRICTED_LEVELS = {
    "restricted", "private", "confidential", "sensitive", "secret", "internal",
}
_ALLOWLIST_KEYS = {
    "allowedactors", "allowedprincipals", "allowedroles", "allowlist", "principals", "roles",
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


def _policy(value: Any) -> Any:
    if not isinstance(value, dict):
        return None
    for key in ("accessPolicy", "access_policy", "edag:accessPolicy", "edag:access_policy"):
        if key in value:
            return value[key]
    attributes = value.get("attributes") or value.get("edag:attributes")
    if isinstance(attributes, dict):
        for key in ("accessPolicy", "access_policy"):
            if key in attributes:
                return attributes[key]
    return None


def _is_restricted_policy(policy: Any) -> bool:
    if isinstance(policy, str):
        level = policy.strip().lower()
        return bool(level) and level not in {"public", "open", "unrestricted"}
    if not isinstance(policy, dict) or not policy:
        return False

    normalized = {str(key).replace("_", "").replace("-", "").lower(): value
                  for key, value in policy.items()}
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

    # Access policies are fail-closed.  Only an explicitly public/readable
    # policy is considered unrestricted; unknown policy shapes cannot silently
    # become a data disclosure path.
    explicitly_public = normalized.get("public") is True \
        or normalized.get("read") is True \
        or str(normalized.get("visibility", "")).lower() == "public"
    return not explicitly_public


def _restriction(subject_type: str, subject_id: Any, value: Any) -> Optional[dict[str, Any]]:
    policy = _policy(value)
    restricted_availability = isinstance(value, dict) \
        and str(value.get("availability", "")).lower() == "restricted"
    if not restricted_availability and not _is_restricted_policy(policy):
        return None
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


def _safe_breakpoint(item: dict) -> dict[str, Any]:
    subject = item.get("nodeId") or item.get("threadId") or item.get("detail") or item.get("reason")
    return {
        "reason": item.get("reason", "provenance_breakpoint"),
        "subjectHash": _digest("breakpoint-subject", subject),
        "accessLevel": "restricted",
    }


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

    def resolve(self, target_id: str, snapshot_digest: str) -> dict:
        row = self.store.q1("SELECT project_key,payload FROM project_snapshot WHERE digest=?",
                            (snapshot_digest,))
        if row is None:
            raise KeyError(snapshot_digest)
        snapshot = json.loads(row["payload"])
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
