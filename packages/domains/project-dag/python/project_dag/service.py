"""Project DAG application facade.

All state-changing domain commands ultimately enqueue the same durable Project
update lane.  The facade intentionally exposes no direct compiler method.
"""
from __future__ import annotations

import json
import os
import re
from typing import Any, Optional

from .compiler import Compiler
from .contracts import canonical_json, digest_json
from .judge import Judge
from .provenance import ProvenanceResolver
from .reader import SessionReader
from .store import Store, new_id, now_iso
from .workflow import ProjectWorkflow


_SAFE_PROJECT_STATUSES = {
    "active", "completed", "abandoned", "supported", "conflicted", "invalidated",
    "fragile", "undetermined", "pending", "approved", "rejected", "deferred",
    "open", "closed", "accepted", "failed", "committed", "not_needed",
    "restricted", "queued", "running", "succeeded", "superseded", "covered",
    "updating", "update_failed", "retry_scheduled", "fresh", "empty", "not_run", "stale",
    "resolved", "blocked", "candidate", "certified",
}
_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")


def _safe_project_status(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    return normalized if normalized in _SAFE_PROJECT_STATUSES else None


def _restricted_project_ref(kind: str, value: Any) -> dict[str, Any]:
    item = value if isinstance(value, dict) else {}
    identifier = next((
        item.get(key) for key in (
            "id", "root_id", "rootId", "reviewPacketId", "claim_id", "claimId",
            "target_id", "targetId", "threadId", "jobId", "digest",
        ) if item.get(key) is not None
    ), value)
    status = _safe_project_status(
        item.get("status") or item.get("state") or item.get("gateStatus"))
    return {
        "idHash": digest_json({"kind": kind, "id": identifier}),
        **({"status": status} if status else {}),
        "exists": value is not None,
        "accessLevel": "restricted",
    }


def _restricted_project_vector(vector: Any) -> list[dict[str, Any]]:
    result = []
    for entry in vector if isinstance(vector, list) else []:
        if not isinstance(entry, dict):
            continue
        digest = entry.get("digest")
        result.append({
            "idHash": digest_json({"kind": "evidence-vector", "id": entry.get("threadId")}),
            **({"contentDigest": digest}
               if isinstance(digest, str) and _SHA256.fullmatch(digest) else {}),
            "exists": True,
            "accessLevel": "restricted",
        })
    return result


class Engine:
    UPDATE_FIELDS = {
        "projectKey", "evidenceVector", "capturedScope", "reason", "priority", "autonomyMode",
    }

    def __init__(self, db_path: str, session_dir: str, llm: Any = None,
                 judge: Any = None) -> None:
        self.store = Store(db_path)
        self.reader = SessionReader(session_dir)
        self.judge = judge if judge is not None else Judge(llm, self.store)
        self._compiler = Compiler(self.store, self.reader, self.judge)
        self.workflow = ProjectWorkflow(self.store, self.reader, self._compiler)
        self.provenance_resolver = ProvenanceResolver(self.store, self.reader)

    # ---------------------------------------------------------- update lane
    def enqueue_update(self, payload: dict, *, actor: str = "runtime") -> dict:
        unknown = sorted(set(payload) - self.UPDATE_FIELDS)
        if unknown:
            raise ValueError(f"unknown update fields: {unknown}")
        result = self.workflow.enqueue_update(
            project_key=payload.get("projectKey"),
            evidence_vector=payload.get("evidenceVector") or [],
            captured_scope=payload.get("capturedScope"),
            reason=payload.get("reason"),
            priority=int(payload.get("priority", 0)),
            autonomy_mode=payload.get("autonomyMode"),
            actor=actor,
        )
        return self._project_response(
            result["projectKey"], "project-update-receipt", result)

    def process_updates(self, project_key: Optional[str] = None) -> Optional[dict]:
        return self.workflow.process_next(project_key)

    def derive_on_open(self, project_key: str) -> Optional[dict]:
        """Queue demand-driven derivation when opening a stale Project view.

        Opening a fresh view is read-only.  A stale view reuses the latest
        explicit vector and Scope through the canonical update lane; it never
        scans the Workspace or invokes the compiler directly.
        """
        latest = self.workflow.latest_snapshot(project_key)
        invalidation = self.workflow.invalidation(project_key)
        active = self.store.q1(
            "SELECT id FROM project_update_job WHERE project_key=?"
            " AND status IN ('queued','running','retry_scheduled','failed')",
            (project_key,),
        )
        if latest is not None and not (invalidation and invalidation.get("stale")) \
                and active is None:
            return None
        if latest is None and active is None:
            return None
        result = self._enqueue_after_domain_change(project_key, "project_open")
        return self._project_response(project_key, "project-open-receipt", result)

    def retry_update(self, job_id: str, *, actor: str = "human",
                     project_key: Optional[str] = None) -> dict:
        if project_key is not None:
            row = self.workflow.job(job_id)
            if row is None or row.get("project_key") != project_key:
                raise KeyError(job_id)
        result = self.workflow.retry_update(job_id, actor=actor)
        return self._project_response(
            result["project_key"], "project-update-job", result)

    def update_status(self, project_key: str) -> dict:
        status = self.workflow.status(project_key)
        raw_snapshots = {
            field: status.get(field)
            for field in ("committedSnapshot", "previousCommittedSnapshot")
        }
        for field in ("committedSnapshot", "previousCommittedSnapshot"):
            snapshot = status.get(field)
            if isinstance(snapshot, dict) and isinstance(snapshot.get("digest"), str):
                status[field] = self.snapshot_view(project_key, snapshot["digest"])
        access = self._project_read_access(project_key)
        if access is None or not access["redacted"]:
            return status
        return {
            "projectHash": digest_json({"kind": "project", "id": project_key}),
            "state": _safe_project_status(status.get("state")) or "restricted",
            "committedSnapshot": self._restricted_snapshot_projection(
                raw_snapshots["committedSnapshot"], access)
                if isinstance(raw_snapshots["committedSnapshot"], dict) else None,
            "previousCommittedSnapshot": self._restricted_snapshot_projection(
                raw_snapshots["previousCommittedSnapshot"], access)
                if isinstance(raw_snapshots["previousCommittedSnapshot"], dict) else None,
            "desiredEvidenceVector": _restricted_project_vector(
                status.get("desiredEvidenceVector")),
            "pending": bool(status.get("pending")),
            "jobs": [
                _restricted_project_ref("project-update-job", job)
                for job in status.get("jobs") or [] if isinstance(job, dict)
            ],
            "latestReceipt": (
                _restricted_project_ref("project-update-receipt", status["latestReceipt"])
                if isinstance(status.get("latestReceipt"), dict) else None
            ),
            "activeReceipt": (
                _restricted_project_ref("project-update-receipt", status["activeReceipt"])
                if isinstance(status.get("activeReceipt"), dict) else None
            ),
            "auditStatus": _safe_project_status(status.get("auditStatus")) or "restricted",
            "auditPending": bool(status.get("auditPending")),
            "auditStale": bool(status.get("auditStale")),
            "attentionPending": bool(status.get("attentionCount")),
            "humanReview": _restricted_project_ref(
                "human-review-summary", status.get("humanReview")),
            "access": {
                "level": "restricted", "redacted": True, "authorized": False,
            },
        }

    def update_receipt_status(self, job_id: str, accepted_request_version: int,
                              desired_fingerprint: str,
                              project_key: Optional[str] = None) -> dict:
        receipt = self.workflow.receipt_status(
            job_id, accepted_request_version, desired_fingerprint)
        if project_key is not None and receipt["projectKey"] != project_key:
            raise KeyError(job_id)
        access = self._project_read_access(receipt["projectKey"])
        if access and access["redacted"]:
            return _restricted_project_ref("project-update-receipt", receipt)
        return receipt

    def update_history(self, project_key: str, limit: int = 20) -> list[dict]:
        rows = self.store.q(
            "SELECT id FROM project_update_job WHERE project_key=?"
            " ORDER BY updated_at DESC LIMIT ?", (project_key, limit))
        history = [self.workflow.job(row["id"]) for row in rows]
        access = self._project_read_access(project_key)
        if access and access["redacted"]:
            return [
                _restricted_project_ref("project-update-job", job)
                for job in history if isinstance(job, dict)
            ]
        return history  # type: ignore[return-value]

    def _snapshot_read_access(self, snapshot: dict) -> dict:
        """Aggregate Project and downstream Evidence access for side reads.

        Graph and Claim views can project individual restricted branches.  A
        status row, audit record, review, or job has no equally precise public
        ownership boundary, so those views are fail-closed when *any* Claim
        closure reaches restricted Evidence/Artifact data.
        """
        access = self.provenance_resolver.project_access(snapshot["digest"])
        if access["redacted"]:
            return access
        for claim in snapshot.get("graph", {}).get("claims", []):
            claim_id = claim.get("id") if isinstance(claim, dict) else None
            if not isinstance(claim_id, str) or not claim_id:
                return {
                    "level": "restricted", "redacted": True, "authorized": False,
                    "breakpoints": [],
                }
            try:
                closure = self.provenance_resolver.resolve(claim_id, snapshot["digest"])
            except Exception:  # noqa: BLE001 - access-check failures are fail-closed
                # A malformed or unavailable closure cannot prove public
                # visibility and therefore cannot authorize a side read.
                return {
                    "level": "restricted", "redacted": True, "authorized": False,
                    "breakpoints": [],
                }
            closure_access = closure.get("access") or {}
            if closure_access.get("redacted") is True:
                return {
                    "level": "restricted", "redacted": True, "authorized": False,
                    "breakpoints": [],
                }
        return access

    def _project_read_access(self, project_key: str,
                             snapshot_digest: Optional[str] = None) -> Optional[dict]:
        """Return the access decision for a Project read boundary.

        Read facades must not call ``workflow`` query helpers directly because
        those helpers intentionally return persistence rows.  Prefer the
        explicitly requested immutable Snapshot and otherwise use the latest
        committed Snapshot for the Project.
        """
        latest = self.workflow.latest_snapshot(project_key)
        if latest is not None:
            latest_access = self._snapshot_read_access(latest)
            # A restricted current Project cannot be opened through a public
            # or malformed historical identifier.
            if latest_access["redacted"] or not snapshot_digest:
                return latest_access
        if snapshot_digest:
            snapshot = self.workflow.snapshot(snapshot_digest)
            if snapshot is not None and snapshot.get("projectKey") == project_key:
                return self._snapshot_read_access(snapshot)
        if latest is not None:
            return self._snapshot_read_access(latest)

        # A first accepted update has externally readable receipts before its
        # first Project Snapshot commits.  Use the immutable Evidence vector
        # from the accepted receipt as a provisional policy boundary; otherwise
        # restricted input identities, scope and reasons would be exposed in
        # exactly that pre-commit window.
        pending = self.store.q1(
            "SELECT desired_vector FROM project_update_receipt WHERE project_key=?"
            " ORDER BY accepted_at DESC,rowid DESC LIMIT 1",
            (project_key,),
        )
        if pending is None:
            pending = self.store.q1(
                "SELECT desired_vector FROM project_update_job WHERE project_key=?"
                " ORDER BY updated_at DESC,rowid DESC LIMIT 1",
                (project_key,),
            )
        if pending is None:
            return None
        try:
            vector = json.loads(pending["desired_vector"])
        except (KeyError, TypeError, ValueError):
            return {
                "level": "restricted", "redacted": True, "authorized": False,
                "breakpoints": [],
            }
        return self.provenance_resolver.evidence_vector_access(vector)

    def _project_response(self, project_key: str, kind: str, value: dict,
                          snapshot_digest: Optional[str] = None) -> dict:
        access = self._project_read_access(project_key, snapshot_digest)
        if access and access["redacted"]:
            return _restricted_project_ref(kind, value)
        return value

    def findings(self, project_key: str,
                 status: Optional[str] = None) -> list[dict]:
        findings = self.workflow.findings(project_key, status)
        access = self._project_read_access(project_key)
        if access and access["redacted"]:
            return [_restricted_project_ref("finding", item) for item in findings]
        return findings

    def reviews(self, project_key: str, status: str = "open") -> list[dict]:
        reviews = self.workflow.reviews(project_key, status)
        access = self._project_read_access(project_key)
        if access and access["redacted"]:
            return [_restricted_project_ref("review", item) for item in reviews]
        return reviews

    def attention(self, project_key: str,
                  snapshot_digest: Optional[str] = None) -> list[dict]:
        attention = self.workflow.attention(project_key, snapshot_digest)
        access = self._project_read_access(project_key, snapshot_digest)
        if access and access["redacted"]:
            return [_restricted_project_ref("attention", item) for item in attention]
        return attention

    def assessments(self, project_key: str,
                    snapshot_digest: Optional[str] = None) -> list[dict]:
        assessments = self.workflow.assessments(project_key, snapshot_digest)
        access = self._project_read_access(project_key, snapshot_digest)
        if access and access["redacted"]:
            return [_restricted_project_ref("assessment", item) for item in assessments]
        return assessments

    def audits(self, project_key: str, limit: int = 20) -> list[dict]:
        audits = self.workflow.audits(project_key, limit)
        access = self._project_read_access(project_key)
        if access and access["redacted"]:
            return [_restricted_project_ref("audit", item) for item in audits]
        return audits

    def audit(self, audit_id: str, project_key: Optional[str] = None) -> Optional[dict]:
        audit = self.workflow.audit(audit_id)
        if audit is None:
            return None
        audit_project_key = audit.get("project_key")
        if not isinstance(audit_project_key, str):
            return _restricted_project_ref("audit", audit)
        if project_key is not None and audit_project_key != project_key:
            raise KeyError(audit_id)
        target_digest = audit.get("target_digest")
        access = self._project_read_access(
            audit_project_key, target_digest if isinstance(target_digest, str) else None)
        if access and access["redacted"]:
            return _restricted_project_ref("audit", audit)
        return audit

    # ----------------------------------------------------------- P3 audit lane
    def enqueue_audit(self, payload: dict, *, actor: str = "runtime") -> dict:
        result = self.workflow.enqueue_audit(
            project_key=payload.get("projectKey"),
            target_digest=payload.get("targetDigest"),
            level=payload.get("level"),
            reason=payload.get("reason", "manual"),
            priority=int(payload.get("priority", 0)),
            autonomy_mode=payload.get("autonomyMode"),
            actor=actor,
        )
        return self._project_response(
            result["project_key"], "audit", result, result.get("target_digest"))

    def process_audits(self, project_key: Optional[str] = None) -> Optional[dict]:
        return self.workflow.process_next_audit(project_key)

    def retry_audit(self, audit_id: str, *, actor: str = "human",
                    project_key: Optional[str] = None) -> dict:
        if project_key is not None:
            row = self.workflow.audit(audit_id)
            if row is None or row.get("project_key") != project_key:
                raise KeyError(audit_id)
        result = self.workflow.retry_audit(audit_id, actor=actor)
        return self._project_response(
            result["project_key"], "audit", result, result.get("target_digest"))

    def _enqueue_after_domain_change(self, project_key: str, reason: str,
                                     autonomy_mode: Optional[str] = None) -> Optional[dict]:
        latest_job = self.store.q1(
            "SELECT desired_vector,captured_scope FROM project_update_job WHERE project_key=?"
            " ORDER BY updated_at DESC LIMIT 1", (project_key,))
        latest_snapshot = self.workflow.latest_snapshot(project_key)
        if latest_job:
            vector = json.loads(latest_job["desired_vector"])
            scope = json.loads(latest_job["captured_scope"])
        elif latest_snapshot:
            vector = latest_snapshot["evidenceVector"]
            scope = {
                "includedSessions": [e["threadId"] for e in vector],
                "excludedSessions": latest_snapshot["excludedSessions"],
                "isolatedSessions": latest_snapshot["isolatedSessions"],
            }
        else:
            vector, scope = [], {
                "includedSessions": [], "excludedSessions": [], "isolatedSessions": [],
            }
        return self.workflow.enqueue_update(
            project_key=project_key, evidence_vector=vector,
            captured_scope=scope, reason=reason, priority=10,
            autonomy_mode=autonomy_mode, actor="project-domain-command",
        )

    # --------------------------------------------------------------- goals
    def goal_tree(self, project_key: str) -> list[dict]:
        goals = self.store.active_goals(project_key=project_key, scoped=True)
        committed_claims = (self.workflow.latest_snapshot(project_key) or {}).get("graph", {}).get(
            "claims", [])
        stats: dict[str, dict] = {}
        for goal in goals:
            by_status: dict[str, int] = {}
            for claim in committed_claims:
                if claim.get("goal_id") == goal["root_id"]:
                    by_status[claim["status"]] = by_status.get(claim["status"], 0) + 1
            stats[goal["root_id"]] = by_status
        by_parent: dict[Optional[str], list[dict]] = {}
        for goal in goals:
            item = dict(goal)
            item["claim_stats"] = stats.get(goal["root_id"], {})
            by_parent.setdefault(goal["parent_id"], []).append(item)

        def build(parent: Optional[str]) -> list[dict]:
            return [{**goal, "children": build(goal["root_id"])}
                    for goal in by_parent.get(parent, [])]
        tree = build(None)
        access = self._project_read_access(project_key)
        if access and access["redacted"]:
            return [_restricted_project_ref("goal", goal) for goal in tree]
        return tree

    def create_goal(self, project_key: str, title: str, description: str = "",
                    parent_root: Optional[str] = None,
                    actor_type: str = "human", actor_id: str = "user") -> dict:
        if actor_type not in {"agent", "human"}:
            raise ValueError("actorType must be agent or human")
        goal = self.store.create_goal(title, description=description,
                                      parent_root=parent_root, project_key=project_key)
        self.store.x(
            "UPDATE claim SET needs_regoal=1 WHERE project_key=? AND t_invalid IS NULL"
            " AND (? IS NULL OR goal_id=? OR goal_id IS NULL)",
            (project_key, parent_root, parent_root),
        )
        self.workflow._event(project_key, "GoalVersionCreated", actor_id, {
            "rootId": goal["root_id"], "version": goal["version"],
            "parentRoot": parent_root, "actorType": actor_type,
        })
        self.store.conn.commit()
        self._enqueue_after_domain_change(project_key, "goal_changed")
        return self._project_response(project_key, "goal", goal)

    def update_goal(self, project_key: str, root_id: str, *, actor_type: str,
                    actor_id: str, reframe: bool = False, **changes: Any) -> dict:
        current = self.store.q1(
            "SELECT * FROM goal WHERE root_id=? AND project_key=? AND t_expired IS NULL",
            (root_id, project_key),
        )
        if current is None:
            raise KeyError(root_id)
        changes = {key: value for key, value in changes.items()
                   if key in {"title", "description", "status", "parent_id"}}
        changes_intent = current["parent_id"] is None and any(
            key in changes and changes[key] != current[key] for key in ("title", "description"))
        if actor_type == "agent" and changes_intent and not reframe:
            review_id = new_id("review")
            payload = {"rootId": root_id, "proposedChanges": changes,
                       "reason": "agent cannot silently rewrite root research intent"}
            self.store.x(
                "INSERT INTO review (id,project_key,subject_id,review_type,checkpoint,status,payload,"
                "created_at) VALUES (?,?,?,'reframe_proposal','root_intent','open',?,?)",
                (review_id, project_key, root_id, canonical_json(payload), now_iso()),
            )
            self.workflow._event(project_key, "GoalReframeProposed", actor_id,
                                 {"reviewId": review_id, **payload})
            self.store.conn.commit()
            return self._project_response(project_key, "goal-reframe-proposal", {
                "proposal": True, "reviewId": review_id, "goal": current,
            })
        if actor_type == "agent" and changes_intent:
            raise ValueError("root reframe must be accepted by a human DecisionEvent")
        goal = self.store.update_goal(root_id, **changes)
        self.workflow._event(project_key, "GoalVersionCreated", actor_id, {
            "rootId": root_id, "version": goal["version"], "actorType": actor_type,
        })
        self.store.conn.commit()
        self._enqueue_after_domain_change(project_key, "goal_changed")
        return self._project_response(project_key, "goal", goal)

    # ----------------------------------------------------------- graph/query
    def _resolved_graph(self, snapshot: dict) -> dict:
        graph = json.loads(json.dumps(snapshot["graph"]))
        vector = {entry["threadId"]: entry["digest"]
                  for entry in snapshot["evidenceVector"]}
        for evidence in graph.get("evidence") or []:
            thread_id = evidence["thread_id"]
            snapshot_digest = evidence["snapshot_digest"]
            if vector.get(thread_id) != snapshot_digest:
                raise ValueError("Project evidence reference is outside its Evidence vector")
            node = self.reader.resolve_node(
                thread_id, snapshot_digest, evidence["node_id"])
            evidence["content"] = node.content
        return graph

    def claims(self, project_key: str, goal_id: Optional[str] = None) -> list[dict]:
        snapshot = self.workflow.latest_snapshot(project_key)
        if snapshot is None:
            return []
        project_access = self.provenance_resolver.project_access(snapshot["digest"])
        claims = self._access_project_claims(snapshot, project_access)
        if project_access["redacted"]:
            return claims
        if goal_id:
            claims = [claim for claim in claims if claim.get("goal_id") == goal_id]
        return sorted(claims, key=lambda claim: claim.get("t_created", ""), reverse=True)

    def _access_project_claims(self, snapshot: dict,
                               project_access: Optional[dict] = None) -> list[dict]:
        access = project_access or self.provenance_resolver.project_access(snapshot["digest"])
        raw_claims = snapshot.get("graph", {}).get("claims", [])
        if access["redacted"]:
            return [_restricted_project_ref("claim", claim) for claim in raw_claims]
        claims = []
        for claim in raw_claims:
            result = self.provenance_resolver.resolve(claim["id"], snapshot["digest"])
            if (result.get("access") or {}).get("redacted"):
                resolved_claim = result.get("claim") or {}
                claims.append({
                    "id": claim["id"],
                    "contentDigest": resolved_claim.get("contentDigest") or digest_json(
                        claim.get("statement"), "restricted_claim"),
                    "exists": True,
                    "accessLevel": "restricted",
                })
            else:
                claims.append(json.loads(json.dumps(claim)))
        return claims

    def _restricted_project_graph(self, graph: dict, snapshot: dict,
                                  project_access: dict) -> dict:
        collections = {
            "goals": "goal",
            "claims": "claim",
            "evidence": "evidence",
            "entities": "entity",
            "edges": "edge",
            "origins": "origin",
            "decisions": "decision",
            "assessments": "assessment",
            "humanReviews": "human-review",
            "reviewPackets": "review-packet",
        }
        projected = {
            key: [
                _restricted_project_ref(kind, item)
                for item in (graph.get(key) or [])
                if isinstance(item, dict)
            ]
            for key, kind in collections.items()
        }
        projected["humanReview"] = _restricted_project_ref(
            "human-review-summary", graph.get("humanReview"))
        scope = snapshot.get("capturedScope") or snapshot.get("scope") \
            or (snapshot.get("graph") or {}).get("scope")
        if scope is not None:
            projected["scope"] = _restricted_project_ref("project-scope", scope)
        if graph.get("meta") is not None:
            projected["meta"] = _restricted_project_ref("project-meta", graph["meta"])
        snapshot_ref = _restricted_project_ref("project-snapshot", snapshot)
        if isinstance(snapshot.get("digest"), str) and _SHA256.fullmatch(snapshot["digest"]):
            snapshot_ref["contentDigest"] = snapshot["digest"]
        snapshot_ref["evidenceVector"] = _restricted_project_vector(
            snapshot.get("evidenceVector"))
        projected["snapshot"] = snapshot_ref
        projected["access"] = {
            "level": "restricted",
            "redacted": True,
            "authorized": False,
        }
        return projected

    def _access_project_graph(self, graph: dict, snapshot: dict,
                              project_access: Optional[dict] = None) -> dict:
        projected = json.loads(json.dumps(graph))
        access = project_access or self.provenance_resolver.project_access(snapshot["digest"])
        if access["redacted"]:
            return self._restricted_project_graph(projected, snapshot, access)
        raw_claims = list(projected.get("claims") or [])
        access_claims = {
            claim["id"]: claim for claim in self._access_project_claims(snapshot, access)
        }
        by_id = {
            claim["id"]: (
                access_claims[claim["id"]]
                if access_claims[claim["id"]].get("accessLevel") == "restricted"
                else claim
            )
            for claim in raw_claims
        }
        restricted_ids = {
            claim_id for claim_id, claim in by_id.items()
            if claim.get("accessLevel") == "restricted"
        }
        projected["claims"] = [by_id[claim["id"]] for claim in raw_claims]
        if not restricted_ids:
            return projected

        projected.pop("accessPolicy", None)
        projected["edges"] = [
            edge for edge in projected.get("edges") or []
            if edge.get("src") not in restricted_ids and edge.get("dst") not in restricted_ids
        ]
        projected["origins"] = [
            origin for origin in projected.get("origins") or []
            if origin.get("claim_id") not in restricted_ids
        ]
        retained_edge_ids = {
            endpoint
            for edge in projected["edges"]
            for endpoint in (edge.get("src"), edge.get("dst"))
        }
        projected["evidence"] = [
            evidence for evidence in projected.get("evidence") or []
            if evidence.get("id") in retained_edge_ids
        ]
        projected["entities"] = [
            entity for entity in projected.get("entities") or []
            if entity.get("id") in retained_edge_ids
        ]
        projected["assessments"] = [
            assessment for assessment in projected.get("assessments") or []
            if (assessment.get("target_id") or assessment.get("targetId"))
            not in restricted_ids
        ]
        projected["humanReviews"] = []
        projected["reviewPackets"] = []
        projected["decisions"] = []
        projected["humanReview"] = {
            "gateStatus": "restricted",
            "pendingCount": 0,
            "blockingPacketIds": [],
            "reviewPackets": [],
        }
        for collection in ("goals", "claims", "decisions"):
            for node in projected.get(collection) or []:
                if isinstance(node, dict):
                    node.pop("humanReview", None)

        visible_threads = {
            evidence.get("thread_id") for evidence in projected["evidence"]
            if evidence.get("thread_id")
        } | {
            origin.get("session_id") for origin in projected["origins"]
            if origin.get("session_id")
        }
        snapshot_view = projected.get("snapshot")
        if isinstance(snapshot_view, dict):
            snapshot_view["evidenceVector"] = [
                entry if entry.get("threadId") in visible_threads else {
                    "digest": entry.get("digest"),
                    "exists": True,
                    "accessLevel": "restricted",
                }
                for entry in snapshot_view.get("evidenceVector") or []
                if isinstance(entry, dict)
            ]
            snapshot_view["excludedSessions"] = []
            snapshot_view["isolatedSessions"] = []
        return projected

    def _restricted_snapshot_projection(self, snapshot: dict,
                                        project_access: dict) -> dict:
        graph = json.loads(json.dumps(snapshot.get("graph") or {}))
        graph["assessments"] = json.loads(json.dumps(snapshot.get("assessments") or []))
        graph["humanReview"] = json.loads(json.dumps(snapshot.get("humanReview") or {}))
        projected = self._restricted_project_graph(graph, snapshot, project_access)
        return {
            **projected["snapshot"],
            "graph": {key: value for key, value in projected.items()
                      if key not in {"snapshot", "access"}},
            "access": projected["access"],
        }

    def snapshot_view(self, project_key: str,
                      snapshot_digest: Optional[str] = None) -> Optional[dict]:
        snapshot = (self.workflow.snapshot(snapshot_digest) if snapshot_digest
                    else self.workflow.latest_snapshot(project_key))
        if snapshot is None or snapshot.get("projectKey") != project_key:
            return None
        access = self._project_read_access(project_key, snapshot["digest"])
        if access is None:
            return None
        if access["redacted"]:
            return self._restricted_snapshot_projection(snapshot, access)
        graph = json.loads(json.dumps(snapshot.get("graph") or {}))
        graph["assessments"] = json.loads(json.dumps(snapshot.get("assessments") or []))
        graph["humanReview"] = json.loads(json.dumps(snapshot.get("humanReview") or {}))
        graph["snapshot"] = {
            key: snapshot[key] for key in (
                "projectKey", "version", "digest", "goalVersion", "policyVersion",
                "evidenceVector", "excludedSessions", "isolatedSessions", "createdAt", "status",
            ) if key in snapshot
        }
        projected = self._access_project_graph(graph, snapshot, access)
        snapshot_view = {
            key: json.loads(json.dumps(snapshot[key]))
            for key in (
                "projectKey", "version", "digest", "goalVersion", "policyVersion",
                "compilerVersion", "createdAt", "status", "autonomyMode",
            ) if key in snapshot
        }
        projected_snapshot = projected.pop("snapshot", {})
        snapshot_view["evidenceVector"] = projected_snapshot.get("evidenceVector", [])
        snapshot_view["excludedSessions"] = projected_snapshot.get("excludedSessions", [])
        snapshot_view["isolatedSessions"] = projected_snapshot.get("isolatedSessions", [])
        snapshot_view["assessments"] = projected.pop("assessments", [])
        snapshot_view["humanReview"] = projected.get("humanReview", {})
        snapshot_view["graph"] = projected
        return snapshot_view

    def claim_detail(self, project_key: str, claim_id: str,
                     snapshot_digest: Optional[str] = None) -> Optional[dict]:
        snapshot = (self.workflow.snapshot(snapshot_digest) if snapshot_digest
                    else self.workflow.latest_snapshot(project_key))
        if snapshot is None or snapshot["projectKey"] != project_key:
            return None
        access = self._project_read_access(project_key, snapshot["digest"])
        if access and access["redacted"]:
            claim = next((
                item for item in (snapshot.get("graph") or {}).get("claims", [])
                if isinstance(item, dict) and item.get("id") == claim_id
            ), None)
            if claim is None:
                return None
            claim_ref = _restricted_project_ref("claim", claim)
            return {
                **claim_ref,
                "supports": [], "contradicts": [], "origins": [], "assessments": [],
                "provenance": self._restricted_provenance_projection(
                    snapshot, claim_ref, access),
            }
        graph = self._resolved_graph(snapshot)
        claim = next((item for item in graph["claims"] if item["id"] == claim_id), None)
        if claim is None:
            return None
        evidence = {item["id"]: item for item in graph["evidence"]}
        support_edges = [edge for edge in graph["edges"]
                         if edge["dst"] == claim_id and edge["edge_type"] == "supports"]
        supports = [{**evidence[edge["src"]], "edge_meta": json.loads(edge["meta"]),
                     "edge_t_invalid": edge.get("t_invalid")}
                    for edge in support_edges if edge["src"] in evidence]
        detail = {
            **claim,
            "supports": supports,
            "contradicts": [edge for edge in graph["edges"]
                            if edge["edge_type"] == "contradicts"
                            and claim_id in {edge["src"], edge["dst"]}],
            "origins": [origin for origin in graph["origins"]
                        if origin["claim_id"] == claim_id],
            "assessments": [assessment for assessment in snapshot.get("assessments", [])
                            if assessment["target_id"] == claim_id],
        }
        digest = snapshot["digest"]
        if digest:
            provenance = self.provenance_resolver.resolve(claim_id, digest)
            detail["provenance"] = provenance
            if (provenance.get("access") or {}).get("redacted"):
                # The provenance resolver is the single access-policy boundary.
                # Do not reattach raw supports/origins/assessments around its
                # redacted response in the Claim detail facade.
                visible_claim = dict(provenance.get("claim") or {})
                visible_claim.pop("project_key", None)
                detail = {
                    **visible_claim,
                    "supports": [],
                    "contradicts": [],
                    "origins": [],
                    "assessments": [],
                    "provenance": provenance,
                }
        return detail

    def graph(self, project_key: str) -> dict:
        latest = self.workflow.latest_snapshot(project_key)
        if latest:
            # The graph endpoint exposes immutable Evidence references only.
            # Content is hydrated at the access-controlled Claim/provenance
            # boundary, never copied into the general Project graph view.
            graph = json.loads(json.dumps(latest["graph"]))
            packets = self.workflow.review_packets(project_key, latest["digest"])
            packet_by_id = {packet["id"]: packet for packet in packets}

            def overlay(review: Any) -> None:
                if not isinstance(review, dict):
                    return
                packet = packet_by_id.get(review.get("reviewPacketId"))
                if not packet:
                    return
                review["status"] = packet["status"]
                review["blocking"] = bool(
                    packet.get("blocking") and packet["status"] in {
                        "pending", "rejected", "deferred",
                    })
                review["updatedAt"] = packet.get("updatedAt", review.get("updatedAt"))
                if packet.get("completedAt"):
                    review["completedAt"] = packet["completedAt"]

            for collection in ("goals", "claims", "decisions"):
                for node in graph.get(collection) or []:
                    overlay(node.get("humanReview"))
            for review in graph.get("humanReviews") or []:
                overlay(review)
            assessments = json.loads(json.dumps(latest.get("assessments") or []))
            for assessment in assessments:
                overlay(assessment.get("humanReview"))
            graph["assessments"] = assessments
            graph["reviewPackets"] = packets
            graph["humanReview"] = self.workflow.human_review_summary(
                project_key, latest["digest"])
            response = {**graph, "snapshot": {
                key: latest[key] for key in (
                    "projectKey", "version", "digest", "goalVersion", "policyVersion",
                    "evidenceVector",
                    "excludedSessions", "isolatedSessions", "createdAt", "status")
            }}
            return self._access_project_graph(response, latest)
        response = {"goals": self.goal_tree(project_key), "claims": [], "evidence": [],
                    "entities": [], "edges": [], "origins": [], "decisions": [],
                    "assessments": [], "humanReviews": [], "reviewPackets": [],
                    "humanReview": self.workflow.human_review_summary(project_key),
                    "snapshot": None}
        access = self._project_read_access(project_key)
        if access and access["redacted"]:
            response["humanReview"] = _restricted_project_ref(
                "human-review-summary", response["humanReview"])
            response["access"] = {
                "level": "restricted", "redacted": True, "authorized": False,
            }
        return response

    def analysis(self, project_key: str, goal_id: Optional[str] = None,
                 threshold: float = 0.7) -> dict:
        snapshot = self.workflow.latest_snapshot(project_key)
        if snapshot is None:
            response = {"summary": {"n_sources": 0, "n_derived": 0}, "fragile": [],
                        "snapshotDigest": None}
            access = self._project_read_access(project_key)
            if access and access["redacted"]:
                response["access"] = {
                    "level": "restricted", "redacted": True, "authorized": False,
                }
            return response
        access = self._snapshot_read_access(snapshot)
        if access["redacted"]:
            raw_claims = snapshot.get("graph", {}).get("claims", [])
            return {
                "summary": {"n_sources": 0, "n_derived": len(raw_claims)},
                "fragile": [], "conflicted": [], "threshold": threshold,
                "snapshotDigest": snapshot["digest"],
                "access": {
                    "level": "restricted", "redacted": True, "authorized": False,
                },
            }
        claims = self.claims(project_key, goal_id)
        claim_ids = {claim["id"] for claim in claims}
        supports = [edge for edge in snapshot["graph"]["edges"]
                    if edge["edge_type"] == "supports" and edge["dst"] in claim_ids]
        source_ids = {edge["src"] for edge in supports}
        return {
            "summary": {"n_sources": len(source_ids), "n_derived": len(claims)},
            "fragile": [claim["id"] for claim in claims if claim.get("status") == "fragile"],
            "conflicted": [claim["id"] for claim in claims if claim.get("status") == "conflicted"],
            "threshold": threshold, "snapshotDigest": snapshot["digest"],
        }

    def resolve_provenance(self, project_key: str, target_id: str,
                           snapshot_digest: str) -> dict:
        snapshot = self.workflow.snapshot(snapshot_digest)
        if snapshot is None or snapshot.get("projectKey") != project_key:
            raise KeyError(target_id)
        access = self._project_read_access(project_key, snapshot_digest)
        if access and access["redacted"]:
            claim = next((
                item for item in (snapshot.get("graph") or {}).get("claims", [])
                if isinstance(item, dict) and item.get("id") == target_id
            ), None)
            if claim is None:
                raise KeyError(target_id)
            return self._restricted_provenance_projection(
                snapshot, _restricted_project_ref("claim", claim), access)
        result = self.provenance_resolver.resolve(target_id, snapshot_digest)
        return result

    @staticmethod
    def _restricted_provenance_projection(snapshot: dict, claim_ref: dict,
                                          access: dict) -> dict:
        """Minimal current-policy projection for a historical provenance read."""
        return {
            "claim": claim_ref,
            "evidenceVector": _restricted_project_vector(
                snapshot.get("evidenceVector")),
            "paths": [],
            "breakpoints": json.loads(json.dumps(access.get("breakpoints") or [])),
            "lineageGraph": {"nodes": [], "edges": []},
            "rerunSpecReferences": [], "rerunSpecs": [],
            "reachesArtifact": False, "provenanceLevel": "L0",
            "access": {
                "level": "restricted", "redacted": True, "authorized": False,
            },
        }

    # ------------------------------------------------------ governance facade
    def record_decision(self, payload: dict) -> dict:
        result = self.workflow.record_decision(
            project_key=payload["projectKey"], action=payload["action"],
            decided_by=payload["decidedBy"], actor_id=payload["actorId"],
            autonomy_mode=payload["autonomyMode"], rationale=payload["rationale"],
            alternatives=payload.get("alternatives") or [],
            evidence_digest=payload["evidenceDigest"],
            confidence=float(payload["confidence"]),
            reversibility=payload["reversibility"], review_id=payload.get("reviewId"),
            finding_id=payload.get("findingId"), supersedes_id=payload.get("supersedesId"),
            action_class=payload.get("actionClass", "draft_internal_reversible"),
            target=payload.get("target", ""), policy_ref=payload.get("policyRef", "decision-policy/v1"),
        )
        self._enqueue_after_domain_change(payload["projectKey"], "decision_recorded",
                                          payload["autonomyMode"])
        return self._project_response(payload["projectKey"], "decision", result)

    def configure_policy(self, project_key: str, payload: dict) -> dict:
        policy = self.workflow.configure_policy(
            project_key, autonomy_mode=payload.get("autonomyMode"),
            checkpoints=payload.get("checkpoints"),
            allow_agent_critical_override=payload.get("allowAgentCriticalOverride"),
            decision_rules=payload.get("decisionRules"),
            actor=payload.get("actorId", "human"),
        )
        self._enqueue_after_domain_change(
            project_key, "policy_changed", policy["autonomy_mode"])
        return self._project_response(project_key, "project-policy", policy)

    def record_review_result(self, project_key: str, packet_id: str,
                             payload: dict) -> dict:
        result = self.workflow.record_review_result(
            project_key=project_key, packet_id=packet_id,
            action=payload["action"], actor_id=payload.get("actorId", "human"),
            rationale=payload.get("rationale", "Human review disposition"),
            confidence=float(payload.get("confidence", 1.0)),
            expected_snapshot_digest=payload.get("expectedSnapshotDigest"),
        )
        return self._project_response(project_key, "human-review", result)

    def create_release(self, payload: dict) -> dict:
        result = self.workflow.create_release(
            project_key=payload["projectKey"],
            project_snapshot_digest=payload["projectSnapshotDigest"],
            audit_digest=payload["auditDigest"], created_by=payload["createdBy"],
            output_artifacts=payload.get("outputArtifacts") or [],
            requested_status=payload.get("requestedStatus", "candidate"),
            runtime_authorization=payload.get("runtimeAuthorization"),
            external_action=bool(payload.get("externalAction", False)),
            target=payload.get("target", ""),
            classification=payload.get("classification", "internal"),
            decision_refs=payload.get("decisionRefs") or [],
            approval_refs=payload.get("approvalRefs") or [],
            expected_head_digest=payload.get("expectedHeadDigest"),
            action_class=payload.get("actionClass"),
        )
        return self._project_response(
            payload["projectKey"], "release", result,
            payload["projectSnapshotDigest"])

    def save_goal_draft(self, payload: dict) -> dict:
        project_key = self.project_key(
            payload.get("workspaceRoot"), payload.get("projectRoot"), payload.get("project"))
        return self._project_response(project_key, "goal-draft", self.workflow.save_goal_draft(
            project_key, title=payload["title"], description=payload.get("description", ""),
            root_goal_id=payload.get("rootGoalId"), actor=payload.get("actorId", "human")))

    def apply_goal_draft(self, payload: dict) -> dict:
        project_key = self.project_key(
            payload.get("workspaceRoot"), payload.get("projectRoot"), payload.get("project"))
        result = self.workflow.apply_goal_draft(
            project_key, actor_type=payload.get("actorType", "human"),
            actor_id=payload.get("actorId", "user"), reframe=bool(payload.get("reframe", False)))
        if result.get("proposal"):
            return result
        self._enqueue_after_domain_change(project_key, "goal_changed")
        return self._project_response(project_key, "goal", result)

    def goal_draft(self, project_key: str) -> Optional[dict]:
        result = self.workflow.goal_draft(project_key)
        return self._project_response(project_key, "goal-draft", result) if result else None

    def scope_revisions(self, project_key: str) -> list[dict]:
        return self.workflow.scope_revisions(project_key)

    def scope_draft(self, project_key: str) -> Optional[dict]:
        return self.workflow.scope_draft(project_key)

    def save_scope_draft(self, payload: dict) -> dict:
        project_key = self.project_key(
            payload.get("workspaceRoot"), payload.get("projectRoot"), payload.get("project"))
        scope_payload = payload.get("scope") or {
            "includedSessions": payload.get("includedSessions") or [],
            "excludedSessions": payload.get("excludedSessions") or [],
            "isolatedSessions": payload.get("isolatedSessions") or [],
            "reasons": payload.get("reasons") or {},
        }
        # Initialization from a visible Session is explicit and deterministic:
        # only that Session is proposed, while related Sessions stay suggestions.
        current_session = payload.get("currentSessionId")
        if current_session and not any(scope_payload.get(key) for key in (
                "includedSessions", "excludedSessions", "isolatedSessions")):
            scope_payload = {**scope_payload,
                             "includedSessions": [current_session]}
        return self._project_response(project_key, "scope-draft", self.workflow.save_scope_draft(
            project_key, scope_payload, actor=payload.get("actorId", "human")))

    def apply_scope_draft(self, payload: dict) -> dict:
        project_key = self.project_key(
            payload.get("workspaceRoot"), payload.get("projectRoot"), payload.get("project"))
        return self._project_response(project_key, "scope", self.workflow.apply_scope_draft(
            project_key, actor=payload.get("actorId", "human")))

    def invalidation(self, project_key: str) -> Optional[dict]:
        return self.workflow.invalidation(project_key)

    def mark_invalidation(self, payload: dict, *, actor: str = "runtime") -> dict:
        """Persist upstream freshness without enqueueing Project compilation."""
        project_key = payload.get("projectKey") or self.project_key(
            payload.get("workspaceRoot"), payload.get("projectRoot"),
            payload.get("project"))
        changed_fields = payload.get("changedFields") or []
        if not isinstance(changed_fields, list) or not all(
                isinstance(field, str) and field.strip() for field in changed_fields):
            raise ValueError("changedFields must be a string array")
        result = self.workflow.mark_stale(
            project_key,
            desired_fingerprint=payload.get("desiredFingerprint"),
            reason=payload.get("reason", "upstream_changed"),
            changed_fields=changed_fields,
            formal_gate=bool(payload.get("formalGate", False)),
        )
        self.workflow._event(project_key, "ProjectInvalidated", actor, {
            "reason": payload.get("reason", "upstream_changed"),
            "changedFields": sorted(set(changed_fields)),
            "desiredFingerprint": payload.get("desiredFingerprint"),
        })
        self.store.conn.commit()
        return self._project_response(project_key, "project-invalidation", result)

    def record_approval(self, payload: dict) -> dict:
        project_key = payload["projectKey"]
        result = self.workflow.record_approval(
            project_key=project_key, decision_id=payload["decisionId"],
            attestor=payload["attestor"], attestation=payload["attestation"],
            trusted_role_assertion_ref=payload.get("trustedRoleAssertionRef"),
            expires_at=payload.get("expiresAt"),
            revokes_approval_id=payload.get("revokesApprovalId"),
            policy_ref=payload.get("policyRef", "decision-policy/v1"),
        )
        return self._project_response(project_key, "approval", result)

    def approvals(self, project_key: str, snapshot_digest: Optional[str] = None) -> list[dict]:
        return self.workflow.approvals(project_key, snapshot_digest)

    def seal_snapshot(self, payload: dict) -> dict:
        project_key = payload["projectKey"]
        snapshot = self.workflow.seal_snapshot(
            project_key, expected_head_digest=payload["expectedHeadDigest"],
            reason=payload.get("reason", "formal_barrier"))
        return self._project_response(project_key, "project-snapshot", snapshot,
                                      snapshot["digest"])

    # --------------------------------------------------------------- helpers
    @staticmethod
    def project_key(workspace_root: Optional[str] = None,
                    project_root: Optional[str] = None,
                    project: Optional[str] = None) -> str:
        """Derive the sole Project identity from a canonical Workspace path.

        ``project:<id>`` was an early transport convenience, but it is not
        bound to a Workspace and therefore lets a caller select arbitrary
        Project rows.  Project identity is now path-derived everywhere.  Both
        roots are accepted only as alternate spellings of the same canonical
        Workspace and relative paths are rejected because they depend on the
        sidecar process working directory.
        """
        canonical: list[tuple[str, str]] = []
        for field, value in (("workspaceRoot", workspace_root),
                             ("projectRoot", project_root)):
            if value is None or not isinstance(value, str) or not value.strip():
                continue
            expanded = os.path.expanduser(value.strip())
            if not os.path.isabs(expanded):
                raise ValueError(f"{field} must be an absolute workspace path")
            normalized = os.path.normcase(os.path.normpath(expanded))
            canonical.append((field, normalized.replace(os.sep, "/")))
        if isinstance(project, str) and project.strip():
            raise ValueError(
                "project identity is unsupported; provide the canonical workspaceRoot")
        if canonical and len({path for _, path in canonical}) != 1:
            raise ValueError("workspaceRoot and projectRoot must identify the same workspace")
        if canonical:
            return f"path:{canonical[0][1]}"
        raise ValueError("canonical workspaceRoot or projectRoot identity is required")
