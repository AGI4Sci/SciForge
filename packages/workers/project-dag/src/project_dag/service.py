"""Project DAG application facade.

All state-changing domain commands ultimately enqueue the same durable Project
update lane.  The facade intentionally exposes no direct compiler method.
"""
from __future__ import annotations

import json
import os
from typing import Any, Optional

from .compiler import Compiler
from .contracts import canonical_json
from .judge import Judge
from .provenance import ProvenanceResolver
from .reader import SessionReader
from .store import Store, new_id, now_iso
from .workflow import ProjectWorkflow


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
        return self.workflow.enqueue_update(
            project_key=payload.get("projectKey"),
            evidence_vector=payload.get("evidenceVector") or [],
            captured_scope=payload.get("capturedScope"),
            reason=payload.get("reason"),
            priority=int(payload.get("priority", 0)),
            autonomy_mode=payload.get("autonomyMode"),
            actor=actor,
        )

    def process_updates(self, project_key: Optional[str] = None) -> Optional[dict]:
        return self.workflow.process_next(project_key)

    def retry_update(self, job_id: str, *, actor: str = "human") -> dict:
        return self.workflow.retry_update(job_id, actor=actor)

    def update_status(self, project_key: str) -> dict:
        return self.workflow.status(project_key)

    def update_history(self, project_key: str, limit: int = 20) -> list[dict]:
        rows = self.store.q(
            "SELECT id FROM project_update_job WHERE project_key=?"
            " ORDER BY updated_at DESC LIMIT ?", (project_key, limit))
        return [self.workflow.job(row["id"]) for row in rows]  # type: ignore[list-item]

    # ----------------------------------------------------------- P3 audit lane
    def enqueue_audit(self, payload: dict, *, actor: str = "runtime") -> dict:
        return self.workflow.enqueue_audit(
            project_key=payload.get("projectKey"),
            target_digest=payload.get("targetDigest"),
            level=payload.get("level"),
            reason=payload.get("reason", "manual"),
            priority=int(payload.get("priority", 0)),
            autonomy_mode=payload.get("autonomyMode"),
            actor=actor,
        )

    def process_audits(self, project_key: Optional[str] = None) -> Optional[dict]:
        return self.workflow.process_next_audit(project_key)

    def retry_audit(self, audit_id: str, *, actor: str = "human") -> dict:
        return self.workflow.retry_audit(audit_id, actor=actor)

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
        return build(None)

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
        return goal

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
            return {"proposal": True, "reviewId": review_id, "goal": current}
        if actor_type == "agent" and changes_intent:
            raise ValueError("root reframe must be accepted by a human DecisionEvent")
        goal = self.store.update_goal(root_id, **changes)
        self.workflow._event(project_key, "GoalVersionCreated", actor_id, {
            "rootId": root_id, "version": goal["version"], "actorType": actor_type,
        })
        self.store.conn.commit()
        self._enqueue_after_domain_change(project_key, "goal_changed")
        return goal

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
        claims = list((snapshot or {}).get("graph", {}).get("claims", []))
        if goal_id:
            claims = [claim for claim in claims if claim.get("goal_id") == goal_id]
        return sorted(claims, key=lambda claim: claim.get("t_created", ""), reverse=True)

    def claim_detail(self, project_key: str, claim_id: str,
                     snapshot_digest: Optional[str] = None) -> Optional[dict]:
        snapshot = (self.workflow.snapshot(snapshot_digest) if snapshot_digest
                    else self.workflow.latest_snapshot(project_key))
        if snapshot is None or snapshot["projectKey"] != project_key:
            return None
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
            return {**graph, "snapshot": {
                key: latest[key] for key in (
                    "projectKey", "version", "digest", "goalVersion", "policyVersion",
                    "evidenceVector",
                    "excludedSessions", "isolatedSessions", "createdAt", "status")
            }}
        return {"goals": self.goal_tree(project_key), "claims": [], "evidence": [],
                "entities": [], "edges": [], "origins": [], "decisions": [],
                "assessments": [], "humanReviews": [], "reviewPackets": [],
                "humanReview": self.workflow.human_review_summary(project_key),
                "snapshot": None}

    def analysis(self, project_key: str, goal_id: Optional[str] = None,
                 threshold: float = 0.7) -> dict:
        snapshot = self.workflow.latest_snapshot(project_key)
        if snapshot is None:
            return {"summary": {"n_sources": 0, "n_derived": 0}, "fragile": [],
                    "snapshotDigest": None}
        claims = self.claims(project_key, goal_id)
        claim_ids = {claim["id"] for claim in claims}
        supports = [edge for edge in snapshot["graph"]["edges"]
                    if edge["edge_type"] == "supports" and edge["dst"] in claim_ids]
        source_ids = {edge["src"] for edge in supports}
        return {
            "summary": {"n_sources": len(source_ids), "n_derived": len(claims)},
            "fragile": [claim["id"] for claim in claims if claim["status"] == "fragile"],
            "conflicted": [claim["id"] for claim in claims if claim["status"] == "conflicted"],
            "threshold": threshold, "snapshotDigest": snapshot["digest"],
        }

    def resolve_provenance(self, project_key: str, target_id: str,
                           snapshot_digest: str) -> dict:
        result = self.provenance_resolver.resolve(target_id, snapshot_digest)
        if result["claim"]["project_key"] != project_key:
            raise KeyError(target_id)
        return result

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
        )
        self._enqueue_after_domain_change(payload["projectKey"], "decision_recorded",
                                          payload["autonomyMode"])
        return result

    def configure_policy(self, project_key: str, payload: dict) -> dict:
        policy = self.workflow.configure_policy(
            project_key, autonomy_mode=payload.get("autonomyMode"),
            checkpoints=payload.get("checkpoints"),
            allow_agent_critical_override=payload.get("allowAgentCriticalOverride"),
            actor=payload.get("actorId", "human"),
        )
        self._enqueue_after_domain_change(
            project_key, "policy_changed", policy["autonomy_mode"])
        return policy

    def record_review_result(self, project_key: str, packet_id: str,
                             payload: dict) -> dict:
        return self.workflow.record_review_result(
            project_key=project_key, packet_id=packet_id,
            action=payload["action"], actor_id=payload.get("actorId", "human"),
            rationale=payload.get("rationale", "Human review disposition"),
            confidence=float(payload.get("confidence", 1.0)),
            expected_snapshot_digest=payload.get("expectedSnapshotDigest"),
        )

    # --------------------------------------------------------------- helpers
    @staticmethod
    def project_key(workspace_root: Optional[str] = None,
                    project_root: Optional[str] = None,
                    project: Optional[str] = None) -> str:
        path = project_root or workspace_root
        if isinstance(path, str) and path.strip():
            normalized = os.path.normcase(os.path.normpath(os.path.expanduser(path.strip())))
            return f"path:{normalized.replace(os.sep, '/')}"
        if isinstance(project, str) and project.strip():
            return f"project:{project.strip()}"
        raise ValueError("projectKey or workspace/project identity is required")
