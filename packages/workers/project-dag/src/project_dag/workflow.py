"""Durable Project DAG orchestration, governance and immutable snapshots."""
from __future__ import annotations

import json
import os
import threading
import time
from typing import Any, Optional

from .compiler import Compiler
from .contracts import (
    DECISION_ACTIONS,
    canonical_json,
    digest_json,
    normalize_evidence_vector,
    normalize_scope,
    remediation_candidate,
    select_a3_action,
    validate_autonomy_mode,
)
from .reader import SessionReader
from .store import Store, new_id, now_iso
from .human_review import evaluate_project_human_review

COMPILER_VERSION = "project-dag/1"
UPDATE_RETRY_BASE_SECONDS = max(
    0.1, float(os.environ.get("PDAG_UPDATE_RETRY_BASE_SECONDS", "1")))
UPDATE_MAX_ATTEMPTS = max(1, int(os.environ.get("PDAG_UPDATE_MAX_ATTEMPTS", "5")))
AUDIT_RETRY_BASE_SECONDS = max(
    0.1, float(os.environ.get("PDAG_AUDIT_RETRY_BASE_SECONDS", "5")))
RETRY_MAX_SECONDS = max(
    1.0, float(os.environ.get("PDAG_RETRY_MAX_SECONDS", "300")))


def _loads(value: Optional[str], default: Any) -> Any:
    if not value:
        return default
    return json.loads(value)


def _retry_at(attempt: int, base_seconds: float) -> str:
    delay = min(RETRY_MAX_SECONDS, base_seconds * (2 ** max(0, attempt - 1)))
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + delay))


class ProjectWorkflow:
    """The only path from a trigger to a Project Snapshot.

    Automatic Evidence commits, Goal changes, manual immediate updates,
    DecisionEvents and retries all coalesce into ``project_update_job``.  No
    caller can invoke the compiler directly through this facade.
    """

    def __init__(self, store: Store, reader: SessionReader, compiler: Compiler) -> None:
        self.store = store
        self.reader = reader
        self.compiler = compiler
        # Only protects short queue-claim/status transitions. Compilation uses
        # Compiler's project-key lock, so model preparation is not serialized
        # across unrelated projects.
        self._queue_lock = threading.RLock()
        self.recover()

    # ------------------------------------------------------------ persistence
    def recover(self) -> None:
        t = now_iso()
        self.store.x(
            "UPDATE project_update_job SET status='queued',last_error=?,updated_at=?,"
            " started_at=NULL,finished_at=NULL,next_attempt_at=NULL WHERE status='running'",
            ("worker stopped; update requeued on startup", t),
        )
        self.store.x(
            "UPDATE audit_run SET status='queued',started_at=NULL,finished_at=NULL,"
            " updated_at=?,next_attempt_at=?,error=? WHERE status='running'",
            (t, t, "audit worker interrupted; recovered on startup"),
        )
        self.store.conn.commit()

    def policy(self, project_key: str) -> dict:
        row = self.store.q1("SELECT * FROM project_policy WHERE project_key=?", (project_key,))
        if row is None:
            t = now_iso()
            self.store.x(
                "INSERT INTO project_policy (project_key,autonomy_mode,updated_at)"
                " VALUES (?,'checkpointed',?)", (project_key, t))
            self.store.conn.commit()
            row = self.store.q1("SELECT * FROM project_policy WHERE project_key=?", (project_key,))
        assert row is not None
        row["checkpoints"] = _loads(row["checkpoints"], [])
        row["allowAgentCriticalOverride"] = bool(row.pop("allow_agent_critical_override"))
        return row

    def configure_policy(self, project_key: str, *, autonomy_mode: Optional[str] = None,
                         checkpoints: Optional[list[str]] = None,
                         allow_agent_critical_override: Optional[bool] = None,
                         actor: str = "human") -> dict:
        current = self.policy(project_key)
        mode = validate_autonomy_mode(autonomy_mode or current["autonomy_mode"])
        points = checkpoints if checkpoints is not None else current["checkpoints"]
        if not isinstance(points, list) or not all(isinstance(x, str) for x in points):
            raise ValueError("checkpoints must be a string array")
        allow = (current["allowAgentCriticalOverride"]
                 if allow_agent_critical_override is None else allow_agent_critical_override)
        version = int(current["policy_version"]) + 1
        t = now_iso()
        self.store.x(
            "UPDATE project_policy SET autonomy_mode=?,policy_version=?,checkpoints=?,"
            "allow_agent_critical_override=?,updated_at=? WHERE project_key=?",
            (mode, version, canonical_json(sorted(set(points))), int(bool(allow)), t, project_key),
        )
        self._event(project_key, "ProjectPolicyChanged", actor, {
            "autonomyMode": mode, "policyVersion": version,
            "checkpoints": sorted(set(points)),
            "allowAgentCriticalOverride": bool(allow),
        })
        self.store.conn.commit()
        return self.policy(project_key)

    def enqueue_update(self, *, project_key: str, evidence_vector: list[dict],
                       captured_scope: Optional[dict], reason: str, priority: int = 0,
                       autonomy_mode: Optional[str] = None,
                       actor: str = "runtime") -> dict:
        if not isinstance(project_key, str) or not project_key.strip():
            raise ValueError("projectKey is required")
        if not reason or not isinstance(reason, str):
            raise ValueError("reason is required")
        project_key = project_key.strip()
        vector = normalize_evidence_vector(evidence_vector)
        scope = normalize_scope(captured_scope, (x["threadId"] for x in vector))
        if reason == "evidence_snapshot_committed":
            # Runtime may notify with only the changed session. Merge it into
            # the already-persisted membership/vector; never widen by scanning
            # the global Evidence store and never shrink another workspace.
            membership = self.store.q(
                "SELECT session_id,disposition FROM project_scope WHERE project_key=?",
                (project_key,),
            )
            previous_scope = {
                "includedSessions": [r["session_id"] for r in membership
                                     if r["disposition"] == "included"],
                "excludedSessions": [r["session_id"] for r in membership
                                     if r["disposition"] == "excluded"],
                "isolatedSessions": [r["session_id"] for r in membership
                                     if r["disposition"] == "isolated"],
            }
            previous_vector: list[dict] = []
            active_job = self.store.q1(
                "SELECT desired_vector FROM project_update_job WHERE project_key=?"
                " AND status IN ('queued','running','retry_scheduled','failed')",
                (project_key,),
            )
            if active_job:
                previous_vector = _loads(active_job["desired_vector"], [])
            else:
                latest = self.latest_snapshot(project_key)
                previous_vector = latest["evidenceVector"] if latest else []
            merged_vector = {e["threadId"]: e["digest"] for e in previous_vector}
            merged_vector.update({e["threadId"]: e["digest"] for e in vector})
            included = set(previous_scope["includedSessions"]) | set(scope["includedSessions"])
            excluded = set(previous_scope["excludedSessions"]) | set(scope["excludedSessions"])
            isolated = set(previous_scope["isolatedSessions"]) | set(scope["isolatedSessions"])
            included -= excluded | isolated
            scope = {
                "includedSessions": sorted(included),
                "excludedSessions": sorted(excluded),
                "isolatedSessions": sorted(isolated),
            }
            missing = included - set(merged_vector)
            if missing:
                raise ValueError(
                    f"persisted project membership lacks Evidence digests: {sorted(missing)}")
            vector = normalize_evidence_vector(
                {"threadId": tid, "digest": merged_vector[tid]} for tid in included)
        if set(scope["includedSessions"]) != {x["threadId"] for x in vector}:
            raise ValueError("capturedScope.includedSessions must exactly match evidenceVector")

        # Evidence DAG's committed immutable files are the sole source of
        # truth.  References are resolved and integrity-checked before the
        # Project update is made durable; no envelope copy is accepted or
        # cached in the Project database.
        for entry in vector:
            try:
                self.reader.load(entry["threadId"], entry["digest"])
            except OSError as exc:
                raise ValueError(
                    f"{entry['threadId']}: committed Evidence Snapshot"
                    f" {entry['digest']} is unavailable") from exc
        policy = self.policy(project_key)
        mode = validate_autonomy_mode(autonomy_mode or policy["autonomy_mode"])
        with self._queue_lock, self.store.transaction_lock:
            self.store.x("BEGIN IMMEDIATE")
            try:
                self._replace_scope(project_key, scope)
                job = self.store.q1(
                    "SELECT * FROM project_update_job WHERE project_key=?"
                    " AND status IN ('queued','running','retry_scheduled','failed')",
                    (project_key,),
                )
                t = now_iso()
                if job is None:
                    job_id = new_id("pjob")
                    self.store.x(
                        "INSERT INTO project_update_job (id,project_key,desired_vector,captured_scope,"
                        "reason,priority,autonomy_mode,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
                        (job_id, project_key, canonical_json(vector), canonical_json(scope), reason,
                         int(priority), mode, t, t),
                    )
                else:
                    job_id = job["id"]
                    self.store.x(
                        "UPDATE project_update_job SET desired_vector=?,captured_scope=?,reason=?,"
                        "priority=MAX(priority,?),autonomy_mode=?,request_version=request_version+1,"
                        "status=CASE WHEN status='running' THEN 'running' ELSE 'queued' END,"
                        "attempts=CASE WHEN status='running' THEN attempts ELSE 0 END,"
                        "last_error=NULL,next_attempt_at=NULL,updated_at=?,finished_at=NULL WHERE id=?",
                        (canonical_json(vector), canonical_json(scope), reason, int(priority), mode,
                         t, job_id),
                    )
                event_type = ("EvidenceSnapshotCommitted" if reason == "evidence_snapshot_committed"
                              else "ProjectCompileQueued")
                self._event(project_key, event_type, actor, {
                    "jobId": job_id, "evidenceVector": vector, "capturedScope": scope,
                    "reason": reason, "priority": int(priority), "autonomyMode": mode,
                })
                self.store.conn.commit()
            except Exception:
                self.store.conn.rollback()
                raise
        return self.job(job_id)  # type: ignore[return-value]

    def _replace_scope(self, project_key: str, scope: dict) -> None:
        self.store.x("DELETE FROM project_scope WHERE project_key=?", (project_key,))
        t = now_iso()
        for disposition, key in (
            ("included", "includedSessions"),
            ("excluded", "excludedSessions"),
            ("isolated", "isolatedSessions"),
        ):
            for session_id in scope[key]:
                self.store.x(
                    "INSERT INTO project_scope (project_key,session_id,disposition,updated_at)"
                    " VALUES (?,?,?,?)", (project_key, session_id, disposition, t))

    def _enqueue_from_committed_snapshot(self, project_key: str, reason: str) -> dict:
        snapshot = self.latest_snapshot(project_key)
        if snapshot is None:
            raise RuntimeError("a committed Project Snapshot is required")
        vector = snapshot["evidenceVector"]
        return self.enqueue_update(
            project_key=project_key, evidence_vector=vector,
            captured_scope={
                "includedSessions": [e["threadId"] for e in vector],
                "excludedSessions": snapshot["excludedSessions"],
                "isolatedSessions": snapshot["isolatedSessions"],
            }, reason=reason, priority=5, autonomy_mode=snapshot["autonomyMode"],
            actor="project-governance",
        )

    # --------------------------------------------------------------- worker
    def process_next(self, project_key: Optional[str] = None) -> Optional[dict]:
        with self._queue_lock, self.store.transaction_lock:
            t = now_iso()
            args: tuple[Any, ...] = (t,)
            where = ("(status='queued' OR"
                     " (status='retry_scheduled' AND next_attempt_at<=?))")
            if project_key is not None:
                where += " AND project_key=?"
                args = (t, project_key)
            job = self.store.q1(
                f"SELECT * FROM project_update_job WHERE {where}"
                " ORDER BY priority DESC,updated_at ASC LIMIT 1", args)
            if job is None:
                return None
            generation = int(job["request_version"])
            attempt = int(job["attempts"]) + 1
            self.store.x(
                "UPDATE project_update_job SET status='running',processing_version=?,attempts=attempts+1,"
                "started_at=?,updated_at=?,finished_at=NULL,last_error=NULL,next_attempt_at=NULL"
                " WHERE id=?",
                (generation, t, t, job["id"]),
            )
            self.store.conn.commit()

        vector = _loads(job["desired_vector"], [])
        scope = _loads(job["captured_scope"], {})
        try:
            with self.compiler.compile_transaction(
                    "scheduled", scope["includedSessions"], project_key=job["project_key"],
                    evidence_vector=vector) as result:
                if result.get("skipped"):
                    raise RuntimeError(result.get("reason", "compiler busy"))
                if result["stats"].get("errors"):
                    raise RuntimeError(canonical_json(result["diff"]["errors"]))
                snapshot = self._commit_project_snapshot(
                    job["project_key"], vector, scope, result, job["autonomy_mode"])
        except Exception as exc:
            with self.store.transaction_lock:
                self.store.conn.rollback()
                failed_at = now_iso()
                retrying = attempt < UPDATE_MAX_ATTEMPTS
                status = "retry_scheduled" if retrying else "failed"
                next_attempt_at = (
                    _retry_at(attempt, UPDATE_RETRY_BASE_SECONDS) if retrying else None)
                self.store.x(
                    "UPDATE project_update_job SET status=?,last_error=?,finished_at=?,updated_at=?,"
                    "next_attempt_at=? WHERE id=?",
                    (status, str(exc), None if retrying else failed_at, failed_at,
                     next_attempt_at, job["id"]),
                )
                self.store.conn.commit()
            raise

        with self.store.transaction_lock:
            current = self.store.q1(
                "SELECT request_version FROM project_update_job WHERE id=?", (job["id"],))
            superseded = current is not None and int(current["request_version"]) != generation
            status = "queued" if superseded else "succeeded"
            self.store.x(
                "UPDATE project_update_job SET status=?,attempts=?,finished_at=?,updated_at=?,"
                "next_attempt_at=NULL"
                " WHERE id=?",
                (status, 0 if superseded else attempt, now_iso(), now_iso(), job["id"]),
            )
            self.store.conn.commit()
        return {"job": self.job(job["id"]), "snapshot": snapshot, "compile": result}

    def retry_update(self, job_id: str, *, actor: str = "human") -> dict:
        """Make a scheduled or terminal failure immediately eligible again."""
        with self._queue_lock, self.store.transaction_lock:
            job = self.store.q1("SELECT * FROM project_update_job WHERE id=?", (job_id,))
            if job is None:
                raise KeyError(job_id)
            if job["status"] not in {"retry_scheduled", "failed"}:
                raise ValueError("only retry-scheduled or failed Project updates can be retried")
            t = now_iso()
            self.store.x(
                "UPDATE project_update_job SET status='queued',attempts=0,next_attempt_at=NULL,"
                "finished_at=NULL,updated_at=? WHERE id=?", (t, job_id),
            )
            self._event(job["project_key"], "ProjectCompileRetryQueued", actor, {
                "jobId": job_id, "attempts": job["attempts"],
                "previousError": job["last_error"],
            })
            self.store.conn.commit()
        return self.job(job_id)  # type: ignore[return-value]

    def _goal_version(self, project_key: str) -> str:
        goals = self.store.active_goals(project_key=project_key, scoped=True)
        return digest_json([{
            "rootId": g["root_id"], "version": g["version"], "status": g["status"],
        } for g in sorted(goals, key=lambda x: x["root_id"])], "goal")

    def _snapshot_graph(self, project_key: str, included: list[str]) -> dict:
        included_set = set(included)
        origins = self.store.q(
            "SELECT * FROM claim_origin WHERE project_key=? ORDER BY claim_id,session_id,node_id",
            (project_key,),
        )
        origins = [origin for origin in origins if origin["session_id"] in included_set]
        scoped_claim_ids = {origin["claim_id"] for origin in origins}
        claims = self.store.q(
            "SELECT * FROM claim WHERE project_key=? AND t_invalid IS NULL ORDER BY id",
            (project_key,),
        )
        claims = [claim for claim in claims if claim["id"] in scoped_claim_ids]
        claim_ids = {c["id"] for c in claims}
        goals = self.store.active_goals(project_key=project_key, scoped=True)
        edges = self.store.q("SELECT * FROM edge WHERE t_invalid IS NULL ORDER BY id")
        scoped_edges: list[dict] = []
        for edge in edges:
            if edge["edge_type"] != "supports" or edge["dst"] not in claim_ids:
                scoped_edges.append(edge)
                continue
            meta = _loads(edge.get("meta"), {})
            raw_origins = meta.get("origins")
            if isinstance(raw_origins, list):
                support_origins = [
                    origin for origin in raw_origins
                    if isinstance(origin, dict) and origin.get("session") in included_set
                ]
            elif meta.get("session") in included_set:
                support_origins = [{
                    "session": meta.get("session"), "node": meta.get("claim_node"),
                    "run": meta.get("run"),
                }]
            else:
                support_origins = []
            if not support_origins:
                continue
            first = support_origins[0]
            scoped_meta = {
                **meta,
                "session": first.get("session"),
                "claim_node": first.get("node"),
                "run": first.get("run"),
                "origins": support_origins,
            }
            scoped_edges.append({**edge, "meta": canonical_json(scoped_meta)})
        edges = scoped_edges
        support_ids = {e["src"] for e in edges if e["edge_type"] == "supports"
                       and e["dst"] in claim_ids}
        evidence = [e for e in self.store.q(
            "SELECT * FROM evidence WHERE project_key=? ORDER BY id",
            (project_key,),
        ) if e["id"] in support_ids]
        entity_ids = {e["dst"] for e in edges if e["edge_type"] == "mentions"
                      and e["src"] in claim_ids}
        entities = [e for e in self.store.q(
            "SELECT * FROM entity WHERE project_key=? AND merged_into IS NULL ORDER BY id",
            (project_key,),
        ) if e["id"] in entity_ids]
        entity_ids = {entity["id"] for entity in entities}
        keep = claim_ids | {g["root_id"] for g in goals} | support_ids | entity_ids
        edges = [e for e in edges if e["src"] in keep and e["dst"] in keep]
        decisions = self.store.q(
            "SELECT * FROM decision_event WHERE project_key=? ORDER BY created_at,id", (project_key,))
        return {
            "goals": goals, "claims": claims, "evidence": evidence, "entities": entities,
            "edges": edges, "origins": origins, "decisions": decisions,
        }

    def _commit_project_snapshot(self, project_key: str, vector: list[dict], scope: dict,
                                 compile_result: dict, autonomy_mode: str) -> dict:
        latest = self.store.q1(
            "SELECT MAX(version) AS version FROM project_snapshot WHERE project_key=?",
            (project_key,),
        )
        version = int((latest or {}).get("version") or 0) + 1
        created_at = now_iso()
        graph = self._snapshot_graph(project_key, scope["includedSessions"])
        vector_by_thread = {entry["threadId"]: entry["digest"] for entry in vector}
        for evidence_ref in graph["evidence"]:
            if vector_by_thread.get(evidence_ref["thread_id"]) != evidence_ref["snapshot_digest"]:
                raise ValueError("Project evidence reference is outside the captured Evidence vector")
        if any(origin["session_id"] not in vector_by_thread for origin in graph["origins"]):
            raise ValueError("Project claim origin is outside the captured Evidence vector")
        assessment_specs = self._assessment_specs(graph)
        policy = self.policy(project_key)
        evidence_reviews = []
        for entry in vector:
            _, evidence_snapshot, _ = self.reader.load(entry["threadId"], entry["digest"])
            if isinstance(evidence_snapshot.human_review, dict):
                evidence_reviews.append(evidence_snapshot.human_review)
        open_reviews = self.store.q(
            "SELECT * FROM review WHERE project_key=? AND status='open'"
            " AND review_type<>'human_review_packet' ORDER BY created_at",
            (project_key,),
        )
        review_result = evaluate_project_human_review(
            project_key=project_key, graph=graph, assessments=assessment_specs,
            evidence_reviews=evidence_reviews, open_reviews=open_reviews, policy=policy,
            input_identity={
                "evidenceVector": vector,
                "goalVersion": self._goal_version(project_key),
                "policyVersion": int(policy["policy_version"]),
            },
            created_at=created_at,
        )
        packet = review_result["reviewPacket"]
        human_review_summary = {
            "policyVersion": str(policy["policy_version"]),
            "gateStatus": "pending" if packet else "not_needed",
            "pendingCount": 1 if packet else 0,
            "blockingPacketIds": [packet["id"]] if packet and packet["blocking"] else [],
            "reviewPackets": [packet] if packet else [],
        }
        review_result["graph"]["humanReview"] = human_review_summary
        review_result["graph"]["reviewPackets"] = [packet] if packet else []
        payload = {
            "projectKey": project_key,
            "version": version,
            "goalVersion": self._goal_version(project_key),
            "policyVersion": int(policy["policy_version"]),
            "evidenceVector": vector,
            "excludedSessions": scope["excludedSessions"],
            "isolatedSessions": scope["isolatedSessions"],
            "compilerVersion": COMPILER_VERSION,
            "createdAt": created_at,
            "status": "committed",
            "autonomyMode": autonomy_mode,
            "graph": review_result["graph"],
            "compileDiff": compile_result["diff"],
            "humanReview": human_review_summary,
        }
        payload["assessments"] = review_result["assessments"]
        payload["digest"] = digest_json(payload, "project")
        if not self.store.conn.in_transaction:
            raise RuntimeError("Project Snapshot commit requires the compiler transaction")
        try:
            for assessment in assessment_specs:
                self._assessment(project_key=project_key, target_digest=payload["digest"],
                                 **assessment)
            self._persist_review_packet(project_key, payload["digest"], packet, created_at)
            self.store.x(
                "INSERT INTO project_snapshot (project_key,version,digest,goal_version,policy_version,"
                "evidence_vector,excluded_sessions,isolated_sessions,compiler_version,created_at,"
                "status,payload) VALUES (?,?,?,?,?,?,?,?,?,?,'committed',?)",
                (project_key, version, payload["digest"], payload["goalVersion"],
                 payload["policyVersion"],
                 canonical_json(vector), canonical_json(scope["excludedSessions"]),
                 canonical_json(scope["isolatedSessions"]), COMPILER_VERSION, created_at,
                 canonical_json(payload)),
            )
            self.store.x(
                "UPDATE audit_run SET status='stale',updated_at=?,"
                "finished_at=COALESCE(finished_at,?) WHERE project_key=?"
                " AND status IN ('queued','running','completed','failed') AND target_digest<>?",
                (created_at, created_at, project_key, payload["digest"]),
            )
            self._enqueue_audit(
                project_key=project_key, target_digest=payload["digest"], level="L0",
                reason="project_snapshot_committed", priority=0,
                autonomy_mode=autonomy_mode, actor="project-compiler", commit=False,
            )
            self._enqueue_audit(
                project_key=project_key, target_digest=payload["digest"], level="L1",
                reason="project_snapshot_committed_semantic_verification", priority=-1,
                autonomy_mode=autonomy_mode, actor="project-compiler", commit=False,
            )
            self._event(project_key, "ProjectSnapshotCommitted", "project-compiler", {
                "digest": payload["digest"], "version": version,
                "evidenceVector": vector, "goalVersion": payload["goalVersion"],
                "policyVersion": payload["policyVersion"],
            })
            self.store.conn.commit()
        except Exception:
            self.store.conn.rollback()
            raise
        return self.snapshot(payload["digest"])  # type: ignore[return-value]

    # ------------------------------------------------------- assessment/audit
    def _assessment(self, project_key: str, target_id: str, dimension: str, level: str,
                    result: str, actor: str, method: str, confidence: float,
                    target_digest: str, details: Optional[dict] = None) -> None:
        self.store.x(
            "INSERT OR IGNORE INTO assessment (id,project_key,target_id,dimension,level,result,"
            "actor,method,details,confidence,target_digest,created_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (new_id("assessment"), project_key, target_id, dimension, level, result, actor,
             method, canonical_json(details or {}),
             max(0.0, min(1.0, float(confidence))), target_digest, now_iso()),
        )

    def _assessment_specs(self, graph: dict) -> list[dict]:
        """Return only deterministic A0 assessments safe for P2 commit.

        Model-backed A1/A2 verification belongs to the independently scheduled
        P3 L1 audit lane.  Snapshot construction must never wait for those
        calls, and the immutable snapshot records only assessments available
        atomically at commit time.
        """
        specs: list[dict] = []
        supports = {c["id"]: [] for c in graph["claims"]}
        for edge in graph["edges"]:
            if edge["edge_type"] == "supports" and edge["dst"] in supports:
                supports[edge["dst"]].append(edge["src"])
        for claim in graph["claims"]:
            cid = claim["id"]
            specs.append({
                "target_id": cid, "dimension": "integrity", "level": "A0",
                "result": "passed" if claim.get("statement") else "failed",
                "actor": "project-dag:deterministic", "method": "schema-and-content-rule/v1",
                "confidence": 1.0, "details": {},
            })
            has_support = bool(supports[cid])
            specs.append({
                "target_id": cid, "dimension": "provenance", "level": "A0",
                "result": "passed" if has_support else "failed",
                "actor": "project-dag:deterministic", "method": "support-path-existence/v1",
                "confidence": 1.0, "details": {},
            })
        return specs

    def _semantic_assessment_specs(self, graph: dict) -> list[dict]:
        """Run independent model verification inside the P3 L1 worker."""
        specs: list[dict] = []
        supports = {c["id"]: [] for c in graph["claims"]}
        evidence = {}
        for item in graph["evidence"]:
            node = self.reader.resolve_node(
                item["thread_id"], item["snapshot_digest"], item["node_id"])
            evidence[item["id"]] = {**item, "content": node.content}
        for edge in graph["edges"]:
            if edge["edge_type"] == "supports" and edge["dst"] in supports:
                supports[edge["dst"]].append(edge["src"])
        for claim in graph["claims"]:
            cid = claim["id"]
            payload = {
                "claim": {"id": cid, "statement": claim["statement"],
                          "claimType": claim["claim_type"], "status": claim["status"]},
                "supports": [evidence[eid] for eid in supports[cid] if eid in evidence],
                "scope": {"goalId": claim.get("goal_id")},
                "verificationContext": "independent-from-distill",
            }
            try:
                a1 = self.compiler.judge("a1_verify", payload)
                for dimension in ("entailment", "applicability"):
                    value = a1.get(dimension) or {}
                    result = value.get("result", "uncertain")
                    if result not in {"passed", "failed", "uncertain"}:
                        result = "uncertain"
                    specs.append({
                        "target_id": cid, "dimension": dimension, "level": "A1",
                        "result": result, "actor": "project-dag:independent-verifier",
                        "method": "a1-snapshot-isolated-model/v1",
                        "confidence": float(value.get("confidence", 0.0)),
                        "details": {"reason": value.get("reason", "")},
                    })
            except Exception as exc:  # model outage remains explicit and retryable evidence
                for dimension in ("entailment", "applicability"):
                    specs.append({
                        "target_id": cid, "dimension": dimension, "level": "A1",
                        "result": "uncertain", "actor": "project-dag:independent-verifier",
                        "method": "a1-verifier-unavailable/v1", "confidence": 0.0,
                        "details": {"error": str(exc)},
                    })
            try:
                a2 = self.compiler.judge("a2_adversarial", payload)
                mapping = {
                    "methodology": "methodology", "reproducibility": "reproducibility",
                    "independence": "provenance",
                }
                for key, dimension in mapping.items():
                    value = a2.get(key) or {}
                    result = value.get("result", "uncertain")
                    if result not in {"passed", "failed", "uncertain"}:
                        result = "uncertain"
                    specs.append({
                        "target_id": cid, "dimension": dimension, "level": "A2",
                        "result": result, "actor": "project-dag:adversarial-reviewer",
                        "method": "a2-independent-adversarial-model/v1",
                        "confidence": float(value.get("confidence", 0.0)),
                        "details": {"reason": value.get("reason", ""), "check": key},
                    })
            except Exception as exc:
                for key, dimension in (("methodology", "methodology"),
                                       ("reproducibility", "reproducibility"),
                                       ("independence", "provenance")):
                    specs.append({
                        "target_id": cid, "dimension": dimension, "level": "A2",
                        "result": "uncertain", "actor": "project-dag:adversarial-reviewer",
                        "method": "a2-reviewer-unavailable/v1", "confidence": 0.0,
                        "details": {"error": str(exc), "check": key},
                    })
        return specs

    def enqueue_audit(self, project_key: str, target_digest: str, level: str,
                      *, reason: str = "manual", priority: int = 0,
                      autonomy_mode: Optional[str] = None,
                      actor: str = "runtime") -> dict:
        """Persist an immutable-digest P3 audit request without running it inline."""
        return self._enqueue_audit(
            project_key=project_key, target_digest=target_digest, level=level,
            reason=reason, priority=priority, autonomy_mode=autonomy_mode,
            actor=actor, commit=True,
        )

    def _enqueue_audit(self, *, project_key: str, target_digest: str, level: str,
                       reason: str, priority: int,
                       autonomy_mode: Optional[str], actor: str,
                       commit: bool) -> dict:
        if not isinstance(project_key, str) or not project_key.strip():
            raise ValueError("projectKey is required")
        if not isinstance(target_digest, str) or not target_digest.strip():
            raise ValueError("targetDigest is required")
        project_key = project_key.strip()
        target_digest = target_digest.strip()
        if level not in {"L0", "L1", "L2"}:
            raise ValueError("audit level must be L0, L1 or L2")
        if not isinstance(reason, str) or not reason.strip():
            raise ValueError("audit reason is required")
        snapshot = self.snapshot(target_digest)
        if snapshot is None or snapshot["projectKey"] != project_key:
            raise KeyError(target_digest)
        policy = self.policy(project_key)
        mode = validate_autonomy_mode(autonomy_mode or policy["autonomy_mode"])
        request_key = digest_json({
            "projectKey": project_key, "targetDigest": target_digest,
            "level": level, "policyVersion": int(policy["policy_version"]),
        }, "audit-request")
        existing = self.store.q1(
            "SELECT id,status,priority FROM audit_run WHERE request_key=?", (request_key,))
        if existing is not None:
            if existing["status"] == "queued" and int(priority) > int(existing["priority"]):
                self.store.x(
                    "UPDATE audit_run SET priority=?,updated_at=? WHERE id=?",
                    (int(priority), now_iso(), existing["id"]),
                )
                if commit:
                    self.store.conn.commit()
            return self.audit(existing["id"])  # type: ignore[return-value]
        t = now_iso()
        run_id = new_id("audit")
        self.store.x(
            "INSERT INTO audit_run (id,request_key,project_key,target_digest,level,policy_version,"
            "reason,priority,lane,autonomy_mode,status,created_at,updated_at)"
            " VALUES (?,?,?,?,?,?,?,?, 'P3',?,'queued',?,?)",
            (run_id, request_key, project_key, target_digest, level,
             int(policy["policy_version"]), reason.strip(), int(priority), mode, t, t),
        )
        self._event(project_key, "AuditQueued", actor, {
            "auditRunId": run_id, "targetDigest": target_digest, "level": level,
            "policyVersion": int(policy["policy_version"]), "lane": "P3",
            "priority": int(priority), "reason": reason.strip(),
        })
        if commit:
            self.store.conn.commit()
        return self.audit(run_id)  # type: ignore[return-value]

    def process_next_audit(self, project_key: Optional[str] = None) -> Optional[dict]:
        """Run one eligible P3 job; P2 workers never call this from snapshot commit."""
        with self._queue_lock, self.store.transaction_lock:
            t = now_iso()
            p2_args: tuple[Any, ...] = (t,)
            p2_where = (
                "(status IN ('queued','running')"
                " OR (status='retry_scheduled' AND next_attempt_at<=?))"
            )
            if project_key is not None:
                p2_where += " AND project_key=?"
                p2_args = (t, project_key)
            if self.store.q1(
                    f"SELECT id FROM project_update_job WHERE {p2_where} LIMIT 1",
                    p2_args) is not None:
                return None
            args: tuple[Any, ...] = (t,)
            where = ("lane='P3' AND status IN ('queued','failed')"
                     " AND (next_attempt_at IS NULL OR next_attempt_at<=?)")
            if project_key is not None:
                where += " AND project_key=?"
                args = (t, project_key)
            job = self.store.q1(
                f"SELECT * FROM audit_run WHERE {where}"
                " ORDER BY priority DESC,created_at ASC LIMIT 1", args,
            )
            if job is None:
                return None
            latest = self.latest_snapshot(job["project_key"])
            policy = self.policy(job["project_key"])
            if latest is None or latest["digest"] != job["target_digest"]:
                self.store.x(
                    "UPDATE audit_run SET status='stale',updated_at=?,finished_at=? WHERE id=?",
                    (t, t, job["id"]),
                )
                self.store.conn.commit()
                return {"audit": self.audit(job["id"]), "skipped": "stale_target"}
            if int(job["policy_version"]) != int(policy["policy_version"]):
                self.store.x(
                    "UPDATE audit_run SET status='stale',updated_at=?,finished_at=? WHERE id=?",
                    (t, t, job["id"]),
                )
                replacement = self._enqueue_audit(
                    project_key=job["project_key"], target_digest=job["target_digest"],
                    level=job["level"], reason="policy_changed",
                    priority=int(job["priority"]), autonomy_mode=policy["autonomy_mode"],
                    actor="project-auditor", commit=False,
                )
                self.store.conn.commit()
                return {"audit": self.audit(job["id"]), "replacement": replacement,
                        "skipped": "stale_policy"}
            attempt = int(job["attempts"]) + 1
            self.store.x(
                "UPDATE audit_run SET status='running',attempts=attempts+1,started_at=?,"
                "finished_at=NULL,updated_at=?,next_attempt_at=NULL,error=NULL WHERE id=?",
                (t, t, job["id"]),
            )
            self.store.conn.commit()

        try:
            return self._execute_audit(job["id"])
        except Exception as exc:
            self.store.conn.rollback()
            failed_at = now_iso()
            current = self.store.q1("SELECT status FROM audit_run WHERE id=?", (job["id"],))
            if current is not None and current["status"] == "running":
                next_attempt_at = _retry_at(attempt, AUDIT_RETRY_BASE_SECONDS)
                self.store.x(
                    "UPDATE audit_run SET status='failed',error=?,finished_at=?,updated_at=?,"
                    "next_attempt_at=? WHERE id=?",
                    (str(exc), failed_at, failed_at, next_attempt_at, job["id"]),
                )
                self._event(job["project_key"], "AuditFailed", "project-auditor", {
                    "auditRunId": job["id"], "targetDigest": job["target_digest"],
                    "attempt": attempt, "nextAttemptAt": next_attempt_at,
                    "error": str(exc),
                })
                self.store.conn.commit()
            raise

    def _execute_audit(self, run_id: str) -> dict:
        job = self.store.q1("SELECT * FROM audit_run WHERE id=?", (run_id,))
        if job is None:
            raise KeyError(run_id)
        if job["status"] != "running":
            return {"audit": self.audit(run_id), "skipped": job["status"]}
        snapshot = self.snapshot(job["target_digest"])
        if snapshot is None or snapshot["projectKey"] != job["project_key"]:
            raise KeyError(job["target_digest"])
        latest = self.latest_snapshot(job["project_key"])
        if latest is None or latest["digest"] != job["target_digest"]:
            t = now_iso()
            self.store.x(
                "UPDATE audit_run SET status='stale',updated_at=?,finished_at=? WHERE id=?",
                (t, t, run_id),
            )
            self.store.conn.commit()
            return {"audit": self.audit(run_id), "skipped": "stale_target"}
        policy = self.policy(job["project_key"])
        if int(policy["policy_version"]) != int(job["policy_version"]):
            raise RuntimeError("audit policy changed while the job was running")
        findings: list[str] = []
        l0_findings_after_semantic_verification: list[str] = []
        if job["level"] == "L0":
            findings.extend(self._audit_l0(job["project_key"], snapshot, policy))
        elif job["level"] == "L1":
            findings.extend(self._audit_l1(job["project_key"], snapshot, policy))
            # Re-evaluate deterministic findings after A1/A2 are persisted so
            # previously cleared L0 conditions can now pass the evidence-gated
            # A3 resolution rule.  `_open_finding` and decision replay guards
            # keep this idempotent with the independently queued L0 run.
            l0_findings_after_semantic_verification.extend(
                self._audit_l0(job["project_key"], snapshot, policy))
        else:
            findings.extend(self._audit_l2(job["project_key"], snapshot, policy))
        audit_payload = {
            "runId": run_id, "targetDigest": job["target_digest"], "level": job["level"],
            "policyVersion": int(job["policy_version"]), "findings": findings,
        }
        audit_digest = digest_json(audit_payload, "audit")
        # A3 never writes the graph directly. It records DecisionEvents and
        # enqueues the same Project update lane before this P3 job completes.
        self._autonomous_review(
            job["project_key"], job["target_digest"], findings, job["autonomy_mode"],
            job["level"])
        if job["level"] == "L1":
            self._autonomous_review(
                job["project_key"], job["target_digest"],
                l0_findings_after_semantic_verification, job["autonomy_mode"], "L0")
        self._compute_attention(
            job["project_key"], job["target_digest"], job["autonomy_mode"])
        current = self.store.q1("SELECT status FROM audit_run WHERE id=?", (run_id,))
        latest = self.latest_snapshot(job["project_key"])
        if current is None or current["status"] != "running" \
                or latest is None or latest["digest"] != job["target_digest"]:
            t = now_iso()
            self.store.x(
                "UPDATE audit_run SET status='stale',updated_at=?,finished_at=?"
                " WHERE id=? AND status='running'", (t, t, run_id),
            )
            self.store.conn.commit()
            return {"audit": self.audit(run_id), "skipped": "stale_target"}
        completed_at = now_iso()
        self.store.x(
            "UPDATE audit_run SET status='completed',digest=?,finished_at=?,updated_at=?,"
            "next_attempt_at=NULL,error=NULL WHERE id=?",
            (audit_digest, completed_at, completed_at, run_id),
        )
        self._event(job["project_key"], "AuditCompleted", "project-auditor", audit_payload)
        self.store.conn.commit()
        return {"audit": self.audit(run_id), "findings": findings}

    def retry_audit(self, audit_id: str, *, actor: str = "human") -> dict:
        """Bypass a failed job's backoff without creating a synchronous audit path."""
        with self._queue_lock, self.store.transaction_lock:
            audit = self.store.q1("SELECT * FROM audit_run WHERE id=?", (audit_id,))
            if audit is None:
                raise KeyError(audit_id)
            if audit["status"] != "failed":
                raise ValueError("only failed audit jobs can be retried")
            latest = self.latest_snapshot(audit["project_key"])
            if latest is None or latest["digest"] != audit["target_digest"]:
                raise ValueError("stale audit jobs cannot be retried")
            t = now_iso()
            self.store.x(
                "UPDATE audit_run SET status='queued',next_attempt_at=NULL,finished_at=NULL,"
                "updated_at=? WHERE id=?", (t, audit_id),
            )
            self._event(audit["project_key"], "AuditRetryQueued", actor, {
                "auditRunId": audit_id, "targetDigest": audit["target_digest"],
                "attempts": audit["attempts"], "previousError": audit["error"],
            })
            self.store.conn.commit()
        return self.audit(audit_id)  # type: ignore[return-value]

    def _audit_l0(self, project_key: str, snapshot: dict, policy: dict) -> list[str]:
        digest, graph = snapshot["digest"], snapshot["graph"]
        findings: list[str] = []
        support_by_claim: dict[str, list[str]] = {c["id"]: [] for c in graph["claims"]}
        for edge in graph["edges"]:
            if edge["edge_type"] == "supports" and edge["dst"] in support_by_claim:
                support_by_claim[edge["dst"]].append(edge["src"])
        evidence = {e["id"]: e for e in graph["evidence"]}
        for claim in graph["claims"]:
            cid = claim["id"]
            supports = support_by_claim[cid]
            if not supports:
                findings.append(self._open_finding(
                    project_key, digest, "broken_provenance", cid,
                    int(policy["policy_version"]), "critical",
                    {"reason": "claim has no live support path", "auditLevel": "L0"},
                ))
                continue
            hashes = [
                self.reader.resolve_reference(
                    evidence[eid]["thread_id"], evidence[eid]["snapshot_digest"],
                    evidence[eid]["node_id"],
                )["sourceIdentity"]
                for eid in supports if eid in evidence
            ]
            if len(hashes) > 1 and len(set(hashes)) == 1:
                findings.append(self._open_finding(
                    project_key, digest, "hidden_shared_source", cid,
                    int(policy["policy_version"]), "high",
                    {"supportPaths": len(hashes), "independentSources": 1,
                     "auditLevel": "L0"},
                ))
            if claim["status"] in {"fragile", "conflicted", "undetermined"}:
                severity = "high" if claim["status"] == "conflicted" else "medium"
                findings.append(self._open_finding(
                    project_key, digest, f"claim_{claim['status']}", cid,
                    int(policy["policy_version"]), severity,
                    {"status": claim["status"], "auditLevel": "L0"},
                ))
        # Derivation/prerequisite families must remain acyclic.
        adjacency: dict[str, set[str]] = {}
        for edge in graph["edges"]:
            if edge["edge_type"] == "derived_from":
                adjacency.setdefault(edge["src"], set()).add(edge["dst"])
        visiting: set[str] = set()
        visited: set[str] = set()

        def cyclic(node: str) -> bool:
            if node in visiting:
                return True
            if node in visited:
                return False
            visiting.add(node)
            hit = any(cyclic(child) for child in adjacency.get(node, set()))
            visiting.remove(node); visited.add(node)
            return hit

        if any(cyclic(node) for node in list(adjacency)):
            findings.append(self._open_finding(
                project_key, digest, "acyclic_family_cycle", "project-graph",
                int(policy["policy_version"]), "critical",
                {"edgeFamily": "derived_from", "auditLevel": "L0"},
            ))
        return findings

    def _audit_l1(self, project_key: str, snapshot: dict, policy: dict) -> list[str]:
        digest, graph = snapshot["digest"], snapshot["graph"]
        findings: list[str] = []
        # A1/A2 are deliberately generated here, after the Project Snapshot is
        # committed and outside the P2 update lane.  The assessment uniqueness
        # constraint makes an idempotent audit retry safe.
        for assessment in self._semantic_assessment_specs(graph):
            self._assessment(project_key=project_key, target_digest=digest, **assessment)
        assessments = self.store.q(
            "SELECT * FROM assessment WHERE project_key=? AND target_digest=?"
            " AND level IN ('A1','A2') AND result IN ('failed','uncertain')",
            (project_key, digest),
        )
        for assessment in assessments:
            details = _loads(assessment["details"], {})
            check = details.get("check") or assessment["dimension"]
            severity = "high" if assessment["result"] == "failed" else "medium"
            findings.append(self._open_finding(
                project_key, digest, f"adversarial_{check}", assessment["target_id"],
                int(policy["policy_version"]), severity,
                {"assessmentId": assessment["id"], "result": assessment["result"],
                 "method": assessment["method"], "detail": details, "auditLevel": "L1"},
            ))
        evidence = {e["id"]: e for e in graph["evidence"]}
        support: dict[str, list[str]] = {}
        for edge in graph["edges"]:
            if edge["edge_type"] == "supports":
                support.setdefault(edge["dst"], []).append(edge["src"])
        origin_count: dict[str, int] = {}
        for origin in graph["origins"]:
            origin_count[origin["claim_id"]] = origin_count.get(origin["claim_id"], 0) + 1
        for claim in graph["claims"]:
            hashes = {
                self.reader.resolve_reference(
                    evidence[eid]["thread_id"], evidence[eid]["snapshot_digest"],
                    evidence[eid]["node_id"],
                )["sourceIdentity"]
                for eid in support.get(claim["id"], []) if eid in evidence
            }
            if origin_count.get(claim["id"], 0) > 1 and len(hashes) <= 1:
                findings.append(self._open_finding(
                    project_key, digest, "suspicious_cross_session_merge", claim["id"],
                    int(policy["policy_version"]), "high",
                    {"origins": origin_count[claim["id"]],
                     "independentSources": len(hashes), "auditLevel": "L1"},
                ))
        return findings

    def _audit_l2(self, project_key: str, snapshot: dict, policy: dict) -> list[str]:
        digest = snapshot["digest"]
        findings: list[str] = []
        latest = self.latest_snapshot(project_key)
        if latest is None or latest["digest"] != digest:
            findings.append(self._open_finding(
                project_key, digest, "stale_release_snapshot", "project-release",
                int(policy["policy_version"]), "critical",
                {"latestDigest": (latest or {}).get("digest"), "auditLevel": "L2"},
            ))
        active = self.store.q1(
            "SELECT desired_vector FROM project_update_job WHERE project_key=?"
            " AND status IN ('queued','running','retry_scheduled','failed')", (project_key,))
        if active and _loads(active["desired_vector"], []) != snapshot["evidenceVector"]:
            findings.append(self._open_finding(
                project_key, digest, "evidence_watermark_not_reached", "project-release",
                int(policy["policy_version"]), "critical",
                {"desiredEvidenceVector": _loads(active["desired_vector"], []),
                 "auditLevel": "L2"},
            ))
        level_rank = {"L0": 0, "L1": 1, "L2": 2, "L3": 3, "L4": 4}
        for claim in snapshot["graph"]["claims"]:
            try:
                provenance = self._resolve_provenance(claim["id"], digest)
                actual = provenance["provenanceLevel"]
            except Exception as exc:
                actual = "L0"
                provenance = {"breakpoints": [{"reason": str(exc)}]}
            required = (policy["min_run_level"] if claim["claim_type"] == "method_result"
                        else policy["min_literature_level"])
            if level_rank.get(actual, 0) < level_rank.get(required, 0):
                findings.append(self._open_finding(
                    project_key, digest, "release_provenance_below_policy", claim["id"],
                    int(policy["policy_version"]), "critical",
                    {"actual": actual, "required": required,
                     "breakpoints": provenance.get("breakpoints", []), "auditLevel": "L2"},
                ))
        return findings

    def _resolve_provenance(self, target_id: str, digest: str) -> dict:
        # Local import avoids a workflow<->resolver construction cycle.
        from .provenance import ProvenanceResolver
        return ProvenanceResolver(self.store, self.reader).resolve(target_id, digest)

    def _open_finding(self, project_key: str, target_digest: str, finding_type: str,
                      subject_id: str, policy_version: int, severity: str,
                      details: dict) -> str:
        existing = self.store.q1(
            "SELECT id FROM finding WHERE target_digest=? AND finding_type=?"
            " AND subject_id=? AND policy_version=?",
            (target_digest, finding_type, subject_id, policy_version),
        )
        if existing:
            return existing["id"]
        inherited = self._inherited_disposition(
            project_key, target_digest, finding_type, subject_id, policy_version)
        status = inherited["status"] if inherited else "open"
        stored_details = dict(details)
        if inherited:
            stored_details["inheritedDecisionId"] = inherited["decisionId"]
        finding_id = new_id("finding")
        self.store.x(
            "INSERT INTO finding (id,project_key,target_digest,finding_type,subject_id,"
            "policy_version,severity,status,details,created_at,resolved_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (finding_id, project_key, target_digest, finding_type, subject_id,
             policy_version, severity, status, canonical_json(stored_details), now_iso(),
             now_iso() if inherited else None),
        )
        if inherited and status == "overridden":
            prior = self.store.q1(
                "SELECT * FROM risk_override WHERE decision_id=?"
                " ORDER BY created_at DESC LIMIT 1", (inherited["decisionId"],),
            )
            if prior:
                self.store.x(
                    "INSERT INTO risk_override (id,project_key,finding_id,decision_id,actor_type,"
                    "actor_id,autonomy_mode,rationale,policy_version,created_at)"
                    " VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (new_id("override"), project_key, finding_id, inherited["decisionId"],
                     prior["actor_type"], prior["actor_id"], prior["autonomy_mode"],
                     prior["rationale"], policy_version, now_iso()),
                )
        self._event(project_key, "FindingOpened", "project-auditor", {
            "findingId": finding_id, "targetDigest": target_digest,
            "findingType": finding_type, "subjectId": subject_id, "severity": severity,
            "status": status, "inheritedDecisionId": (inherited or {}).get("decisionId"),
        })
        return finding_id

    def _inherited_disposition(self, project_key: str, target_digest: str,
                               finding_type: str, subject_id: str,
                               policy_version: int) -> Optional[dict]:
        """Carry an explicit defer/override across a decision-only snapshot.

        The prior Decision must be part of the current immutable snapshot and
        the Evidence vector must be unchanged.  New evidence therefore always
        forces a fresh review instead of silently inheriting risk acceptance.
        """
        current = self.snapshot(target_digest)
        if current is None:
            return None
        included = {
            item.get("id") for item in current.get("graph", {}).get("decisions", [])
            if isinstance(item, dict)
        }
        if not included:
            return None
        rows = self.store.q(
            "SELECT d.id,d.action,d.evidence_digest FROM decision_event d"
            " JOIN finding prior ON prior.id=d.finding_id"
            " WHERE d.project_key=? AND d.action IN ('defer','override')"
            " AND prior.finding_type=? AND prior.subject_id=? AND prior.policy_version=?"
            " ORDER BY d.created_at DESC,d.id DESC",
            (project_key, finding_type, subject_id, policy_version),
        )
        for row in rows:
            if row["id"] not in included:
                continue
            previous = self.snapshot(row["evidence_digest"])
            if previous and previous["evidenceVector"] == current["evidenceVector"]:
                return {
                    "status": "overridden" if row["action"] == "override" else "deferred",
                    "decisionId": row["id"],
                }
        return None

    def _a3_evidence_supported(self, project_key: str, subject_id: str,
                               target_digest: str) -> bool:
        rows = self.store.q(
            "SELECT level,result FROM assessment WHERE project_key=? AND target_id=?"
            " AND target_digest=? AND level IN ('A1','A2')",
            (project_key, subject_id, target_digest),
        )
        if any(row["result"] == "failed" for row in rows):
            return False
        passed = {row["level"] for row in rows if row["result"] == "passed"}
        return passed == {"A1", "A2"}

    @staticmethod
    def _a3_requires_human(finding: dict, mode: str, checkpoints: set[str]) -> bool:
        if mode == "supervised":
            return True
        if mode != "checkpointed":
            return False
        return (
            finding["severity"] == "critical"
            or finding["finding_type"] in checkpoints
            or finding["subject_id"] in checkpoints
            or "audit_finding" in checkpoints
        )

    def _ensure_review_item(self, finding: dict, candidate: dict, *,
                            checkpoint: str) -> str:
        existing = self.store.q1(
            "SELECT id FROM review WHERE finding_id=? AND status='open'"
            " ORDER BY created_at DESC LIMIT 1", (finding["id"],),
        )
        payload = {
            "finding": {
                "id": finding["id"], "type": finding["finding_type"],
                "subjectId": finding["subject_id"], "severity": finding["severity"],
                "targetDigest": finding["target_digest"],
            },
            "findingDetails": _loads(finding["details"], {}),
            "remediationCandidate": candidate,
        }
        if existing:
            self.store.x(
                "UPDATE review SET checkpoint=?,payload=? WHERE id=?",
                (checkpoint, canonical_json(payload), existing["id"]),
            )
            return existing["id"]
        review_id = new_id("review")
        self.store.x(
            "INSERT INTO review (id,project_key,finding_id,subject_id,review_type,"
            "checkpoint,status,payload,created_at) VALUES (?,?,?,?,?,?,'open',?,?)",
            (review_id, finding["project_key"], finding["id"], finding["subject_id"],
             finding["finding_type"], checkpoint, canonical_json(payload), now_iso()),
        )
        return review_id

    def _same_input_decision(self, finding: dict, target_digest: str) -> bool:
        current = self.snapshot(target_digest)
        if current is None:
            return False
        rows = self.store.q(
            "SELECT d.evidence_digest FROM decision_event d"
            " JOIN finding prior ON prior.id=d.finding_id"
            " WHERE d.project_key=? AND prior.subject_id=? AND prior.finding_type=?"
            " AND prior.policy_version=? ORDER BY d.created_at DESC",
            (finding["project_key"], finding["subject_id"], finding["finding_type"],
             finding["policy_version"]),
        )
        for row in rows:
            previous = self.snapshot(row["evidence_digest"])
            if previous and previous["evidenceVector"] == current["evidenceVector"]:
                return True
        return False

    def _apply_decision_disposition(self, finding: dict, review_id: Optional[str],
                                    action: str, decided_by: str, decision_id: str,
                                    actor_id: str, mode: str, rationale: str,
                                    candidate: Optional[dict]) -> None:
        if action in {"resolve", "endorse", "rollback", "supersede"}:
            status = "auto_resolved" if decided_by in {"agent", "tool"} else "resolved"
        elif action == "defer":
            status = "deferred"
        elif action == "override":
            status = "overridden"
        else:
            status = "open"
        self.store.x(
            "UPDATE finding SET status=?,resolved_at=? WHERE id=?",
            (status, now_iso() if status != "open" else None, finding["id"]),
        )
        if review_id:
            review_status = "deferred" if action == "defer" else "resolved"
            review = self.store.q1("SELECT payload FROM review WHERE id=?", (review_id,))
            payload = _loads((review or {}).get("payload"), {})
            if candidate:
                payload["remediationCandidate"] = candidate
            payload["decisionId"] = decision_id
            self.store.x(
                "UPDATE review SET status=?,payload=?,resolved_at=? WHERE id=?",
                (review_status, canonical_json(payload), now_iso(), review_id),
            )
        if action == "override":
            self._create_override(
                finding["project_key"], finding, decision_id, decided_by,
                actor_id, mode, rationale)

    def _record_automatic_decision(self, finding: dict, review_id: str, action: str,
                                   candidate: dict, mode: str,
                                   target_digest: str) -> str:
        rationale = {
            "resolve": "a newer independently assessed snapshot no longer exhibits the condition",
            "defer": "the condition remains visible and will be revisited on a new snapshot",
            "request_evidence": "the condition requires additional or re-ingested evidence",
            "challenge": "the condition requires an independent adversarial challenge",
            "override": "policy permits explicit risk acceptance supported by current assessments",
        }[action]
        alternatives = sorted({
            "resolve", "defer", "request_evidence", "challenge", "override",
        } - {action})
        decision_id = self._record_decision_row(
            project_key=finding["project_key"], review_id=review_id,
            finding_id=finding["id"], action=action, decided_by="agent",
            actor_id="project-dag:autonomous-reviewer", autonomy_mode=mode,
            rationale=rationale, alternatives=alternatives,
            evidence_digest=target_digest, confidence=0.85,
            reversibility="fully_reversible", supersedes_id=None,
        )
        self._apply_decision_disposition(
            finding, review_id, action, "agent", decision_id,
            "project-dag:autonomous-reviewer", mode, rationale, candidate)
        result = "passed" if action == "resolve" else (
            "overridden" if action == "override" else "uncertain")
        self._assessment(
            finding["project_key"], finding["subject_id"], "methodology", "A3",
            result, "project-dag:autonomous-reviewer", f"decision:{decision_id}",
            0.85, target_digest, {
                "findingId": finding["id"], "reviewId": review_id,
                "action": action, "remediationCandidateId": candidate["id"],
            })
        self._event(finding["project_key"], "DecisionRecorded",
                    "project-dag:autonomous-reviewer", {
                        "decisionId": decision_id, "findingId": finding["id"],
                        "reviewId": review_id, "action": action,
                    })
        return decision_id

    def _resolve_cleared_findings(self, project_key: str, target_digest: str,
                                  current_findings: list[dict], mode: str,
                                  audit_level: str, checkpoints: set[str]) -> list[str]:
        current_keys = {
            (finding["finding_type"], finding["subject_id"])
            for finding in current_findings
        }
        snapshot = self.snapshot(target_digest) or {}
        live_subjects = {
            claim.get("id") for claim in snapshot.get("graph", {}).get("claims", [])
        }
        created: list[str] = []
        prior_findings = self.store.q(
            "SELECT * FROM finding WHERE project_key=? AND target_digest<>? AND status='open'"
            " ORDER BY created_at", (project_key, target_digest),
        )
        policy = self.policy(project_key)
        for finding in prior_findings:
            details = _loads(finding["details"], {})
            if details.get("auditLevel") != audit_level:
                continue
            if (finding["finding_type"], finding["subject_id"]) in current_keys:
                continue
            if finding["subject_id"] not in live_subjects:
                continue
            supported = self._a3_evidence_supported(
                project_key, finding["subject_id"], target_digest)
            action = select_a3_action(
                finding, condition_cleared=True, evidence_supported=supported,
                allow_agent_critical_override=policy["allowAgentCriticalOverride"])
            if action != "resolve":
                continue
            candidate = remediation_candidate(action, finding)
            review_id = self._ensure_review_item(
                finding, candidate,
                checkpoint=("human" if self._a3_requires_human(
                    finding, mode, checkpoints) else "agent"),
            )
            if self._a3_requires_human(finding, mode, checkpoints):
                continue
            created.append(self._record_automatic_decision(
                finding, review_id, action, candidate, mode, target_digest))
        return created

    def _autonomous_review(self, project_key: str, target_digest: str,
                           finding_ids: list[str], mode: str, audit_level: str) -> None:
        policy = self.policy(project_key)
        checkpoints = set(policy["checkpoints"])
        findings = [
            finding for finding_id in finding_ids
            if (finding := self.store.q1(
                "SELECT * FROM finding WHERE id=?", (finding_id,))) is not None
        ]
        created = self._resolve_cleared_findings(
            project_key, target_digest, findings, mode, audit_level, checkpoints)
        for finding in findings:
            if finding["status"] != "open":
                continue
            supported = self._a3_evidence_supported(
                project_key, finding["subject_id"], target_digest)
            action = select_a3_action(
                finding, evidence_supported=supported,
                allow_agent_critical_override=policy["allowAgentCriticalOverride"],
            )
            candidate = remediation_candidate(action, finding)
            requires_human = self._a3_requires_human(finding, mode, checkpoints)
            review_id = self._ensure_review_item(
                finding, candidate, checkpoint="human" if requires_human else "agent")
            if requires_human:
                continue
            if self._same_input_decision(finding, target_digest):
                continue
            created.append(self._record_automatic_decision(
                finding, review_id, action, candidate, mode, target_digest))
        self.store.conn.commit()
        if created:
            self._enqueue_from_committed_snapshot(project_key, "autonomous_decision")

    # ------------------------------------------------------------ decisions
    def record_decision(self, *, project_key: str, action: str, decided_by: str,
                        actor_id: str, autonomy_mode: str, rationale: str,
                        alternatives: list[str], evidence_digest: str, confidence: float,
                        reversibility: str, review_id: Optional[str] = None,
                        finding_id: Optional[str] = None,
                        supersedes_id: Optional[str] = None) -> dict:
        mode = validate_autonomy_mode(autonomy_mode)
        if action not in DECISION_ACTIONS:
            raise ValueError(f"invalid decision action: {action}")
        if decided_by not in {"agent", "human", "tool"}:
            raise ValueError("decidedBy must be agent, human or tool")
        if not rationale.strip() or not actor_id.strip() or not reversibility.strip():
            raise ValueError("actorId, rationale and reversibility are required")
        if not isinstance(alternatives, list) or not all(
                isinstance(item, str) and item.strip() for item in alternatives):
            raise ValueError("alternatives must be a string array")
        snapshot = self.snapshot(evidence_digest)
        if snapshot is None or snapshot["projectKey"] != project_key:
            raise ValueError("evidenceDigest must identify a committed Project Snapshot")
        finding = None
        if finding_id:
            finding = self.store.q1("SELECT * FROM finding WHERE id=?", (finding_id,))
            if finding is None or finding["project_key"] != project_key:
                raise KeyError(finding_id)
        if action == "override" and finding is None:
            raise ValueError("override requires a Finding")
        review = None
        if review_id:
            review = self.store.q1("SELECT * FROM review WHERE id=?", (review_id,))
            if review is None or review["project_key"] != project_key:
                raise KeyError(review_id)
            if finding and review["finding_id"] not in {None, finding["id"]}:
                raise ValueError("ReviewItem and Finding do not match")
        if supersedes_id is not None:
            superseded = self.store.q1(
                "SELECT * FROM decision_event WHERE id=?", (supersedes_id,))
            if superseded is None or superseded["project_key"] != project_key:
                raise KeyError(supersedes_id)
        evidence_supported = bool(finding and self._a3_evidence_supported(
            project_key, finding["subject_id"], evidence_digest))
        if finding and action in {"resolve", "endorse"} and (
                evidence_digest == finding["target_digest"] or not evidence_supported):
            raise ValueError(
                "resolve/endorse requires a newer independently supported Project Snapshot")
        if finding and action == "override" and decided_by != "human" \
                and not evidence_supported:
            raise ValueError("agent override requires independent supporting assessments")
        candidate = (remediation_candidate(action, finding)
                     if finding and action in {
                         "resolve", "defer", "request_evidence", "challenge", "override",
                     } else None)
        if finding and review_id is None and candidate is not None:
            review_id = self._ensure_review_item(finding, candidate, checkpoint="human")
        try:
            decision_id = self._record_decision_row(
                project_key=project_key, review_id=review_id, finding_id=finding_id,
                action=action, decided_by=decided_by, actor_id=actor_id,
                autonomy_mode=mode, rationale=rationale, alternatives=alternatives,
                evidence_digest=evidence_digest, confidence=confidence,
                reversibility=reversibility, supersedes_id=supersedes_id,
            )
            if finding:
                self._apply_decision_disposition(
                    finding, review_id, action, decided_by, decision_id,
                    actor_id, mode, rationale, candidate)
            elif review_id:
                self.store.x(
                    "UPDATE review SET status=?,resolved_at=? WHERE id=?",
                    ("deferred" if action == "defer" else "resolved", now_iso(), review_id),
                )
            self._event(project_key, "DecisionRecorded", actor_id, {
                "decisionId": decision_id, "findingId": finding_id,
                "reviewId": review_id, "action": action,
            })
            self.store.conn.commit()
        except Exception:
            self.store.conn.rollback()
            raise
        return self.decision(decision_id)  # type: ignore[return-value]

    def _record_decision_row(self, *, project_key: str, review_id: Optional[str],
                             finding_id: Optional[str], action: str,
                             decided_by: str, actor_id: str, autonomy_mode: str,
                             rationale: str, alternatives: list[str], evidence_digest: str,
                             confidence: float, reversibility: str,
                             supersedes_id: Optional[str]) -> str:
        decision_id = new_id("decision")
        self.store.x(
            "INSERT INTO decision_event (id,project_key,review_id,finding_id,action,decided_by,agent_id,"
            "autonomy_mode,rationale,alternatives,evidence_digest,confidence,reversibility,"
            "supersedes_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (decision_id, project_key, review_id, finding_id, action, decided_by, actor_id,
             autonomy_mode, rationale, canonical_json(alternatives), evidence_digest,
             max(0.0, min(1.0, float(confidence))), reversibility, supersedes_id, now_iso()),
        )
        return decision_id

    def _create_override(self, project_key: str, finding: dict, decision_id: str,
                         actor_type: str, actor_id: str, mode: str, rationale: str) -> str:
        policy = self.policy(project_key)
        if actor_type == "tool":
            raise ValueError("tool actors cannot override risk")
        if finding["severity"] == "critical" and actor_type == "agent" \
                and not policy["allowAgentCriticalOverride"]:
            raise ValueError("project policy forbids agent critical override")
        if mode in {"checkpointed", "supervised"} and actor_type != "human" \
                and finding["severity"] == "critical":
            raise ValueError("critical override requires a human in this autonomy mode")
        override_id = new_id("override")
        self.store.x(
            "INSERT INTO risk_override (id,project_key,finding_id,decision_id,actor_type,actor_id,"
            "autonomy_mode,rationale,policy_version,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (override_id, project_key, finding["id"], decision_id, actor_type, actor_id,
             mode, rationale, policy["policy_version"], now_iso()),
        )
        return override_id

    # --------------------------------------------------------- attention/release
    def _compute_attention(self, project_key: str, digest: str, autonomy_mode: str) -> None:
        self.store.x("DELETE FROM attention_frontier WHERE project_key=? AND snapshot_digest=?",
                     (project_key, digest))
        findings = self.store.q(
            "SELECT * FROM finding WHERE project_key=? AND target_digest=? AND status='open'",
            (project_key, digest),
        )
        severity_weight = {"low": 0.15, "medium": 0.35, "high": 0.7, "critical": 1.0}
        for finding in findings:
            claim = self.store.q1("SELECT * FROM claim WHERE id=?", (finding["subject_id"],)) or {}
            factors = {
                "blastRadius": min(1.0, float(claim.get("blast_radius") or 0) / 10.0),
                "uncertainty": 1.0 if claim.get("status") in {"conflicted", "undetermined"} else 0.5,
                "novelty": 0.5,
                "irreversibility": 0.2,
                "conflict": 1.0 if claim.get("status") == "conflicted" else 0.0,
                "releaseRelevance": severity_weight[finding["severity"]],
            }
            score = round(sum(factors.values()) / len(factors), 4)
            blocking = int(autonomy_mode != "autonomous" and finding["severity"] == "critical")
            self.store.x(
                "INSERT INTO attention_frontier (project_key,snapshot_digest,subject_id,subject_type,"
                "score,factors,blocking,created_at) VALUES (?,?,?,?,?,?,?,?)"
                " ON CONFLICT(project_key,snapshot_digest,subject_id) DO UPDATE SET"
                " score=MAX(attention_frontier.score,excluded.score),"
                " factors=CASE WHEN excluded.score>=attention_frontier.score"
                " THEN excluded.factors ELSE attention_frontier.factors END,"
                " blocking=MAX(attention_frontier.blocking,excluded.blocking),"
                " created_at=excluded.created_at",
                (project_key, digest, finding["subject_id"], "finding", score,
                 canonical_json(factors), blocking, now_iso()),
            )
        snapshot = self.snapshot(digest) or {}
        decisions = (snapshot.get("graph") or {}).get("decisions") or []
        superseded = {
            decision.get("supersedes_id") for decision in decisions
            if decision.get("supersedes_id")
        }
        # A deferred condition is intentionally unresolved.  Keep its durable
        # Decision on the attention frontier (non-blocking) so autonomous mode
        # does not make a low-severity risk disappear from view.
        attention_actions = {"defer", "request_evidence", "challenge", "override", "rollback"}
        for decision in decisions:
            if decision.get("id") in superseded or decision.get("action") not in attention_actions:
                continue
            confidence = max(0.0, min(1.0, float(decision.get("confidence") or 0.0)))
            reversibility = str(decision.get("reversibility") or "").lower()
            action = decision["action"]
            factors = {
                "blastRadius": 0.5,
                "uncertainty": round(1.0 - confidence, 4),
                "novelty": 0.7,
                "irreversibility": 0.2 if reversibility in {
                    "reversible", "fully_reversible", "fully-reversible",
                } else 0.8,
                "conflict": 0.8 if action in {"challenge", "rollback"} else 0.4,
                "releaseRelevance": (
                    0.9 if action == "override" else 0.3 if action == "defer" else 0.6
                ),
            }
            score = round(sum(factors.values()) / len(factors), 4)
            blocking = int(
                autonomy_mode != "autonomous" and action in {"override", "rollback"}
            )
            self.store.x(
                "INSERT INTO attention_frontier (project_key,snapshot_digest,subject_id,subject_type,"
                "score,factors,blocking,created_at) VALUES (?,?,?,?,?,?,?,?)",
                (project_key, digest, decision["id"], "decision", score,
                 canonical_json(factors), blocking, now_iso()),
            )
        self.store.conn.commit()

    def create_release(self, *, project_key: str, project_snapshot_digest: str,
                       audit_digest: str, created_by: str,
                       output_artifacts: list[dict], requested_status: str = "candidate",
                       runtime_authorization: Optional[dict] = None,
                       external_action: bool = False) -> dict:
        if requested_status not in {"candidate", "certified"}:
            raise ValueError("requestedStatus must be candidate or certified")
        snapshot = self.snapshot(project_snapshot_digest)
        if snapshot is None or snapshot["projectKey"] != project_key:
            raise KeyError(project_snapshot_digest)
        audit = self.store.q1(
            "SELECT * FROM audit_run WHERE project_key=? AND target_digest=? AND digest=?"
            " AND status='completed' AND level='L2'",
            (project_key, project_snapshot_digest, audit_digest))
        if audit is None:
            raise ValueError("auditDigest is not a current completed L2 release audit")
        if external_action:
            auth = runtime_authorization or {}
            if auth.get("granted") is not True or not auth.get("permissionId"):
                raise PermissionError("external release requires Runtime authorization")
        policy = self.policy(project_key)
        critical = self.store.q(
            "SELECT * FROM finding WHERE project_key=? AND target_digest=?"
            " AND severity='critical' AND status IN ('open','deferred')",
            (project_key, project_snapshot_digest),
        )
        overrides = self.store.q(
            "SELECT o.* FROM risk_override o JOIN finding f ON f.id=o.finding_id"
            " WHERE o.project_key=? AND f.target_digest=?",
            (project_key, project_snapshot_digest),
        )
        pending = self.store.q1(
            "SELECT id FROM project_update_job WHERE project_key=?"
            " AND status IN ('queued','running','retry_scheduled','failed')", (project_key,))
        blocking_review_packets = [
            packet for packet in self.review_packets(project_key, project_snapshot_digest)
            if packet.get("blocking") and packet.get("status") in {
                "pending", "rejected", "deferred",
            }
        ]
        gates_pass = not critical and pending is None and not blocking_review_packets
        certification = requested_status
        if requested_status == "certified" and not gates_pass:
            certification = "blocked"
        release_id = new_id("release")
        self.store.x(
            "INSERT INTO release_record (id,project_key,project_snapshot_digest,evidence_vector,"
            "audit_run_digest,policy_version,critical_findings,overrides,created_by,created_at,"
            "output_artifacts,certification_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (release_id, project_key, project_snapshot_digest,
             canonical_json(snapshot["evidenceVector"]), audit_digest, policy["policy_version"],
             canonical_json([f["id"] for f in critical]),
             canonical_json([o["id"] for o in overrides]), created_by, now_iso(),
             canonical_json(output_artifacts), certification),
        )
        self._event(project_key, "ReleaseRecordCreated", created_by, {
            "releaseId": release_id, "certificationStatus": certification,
            "runtimeAuthorization": runtime_authorization if external_action else None,
            "blockingReviewPacketIds": [packet["id"] for packet in blocking_review_packets],
        })
        self.store.conn.commit()
        return self.release(release_id)  # type: ignore[return-value]

    # ---------------------------------------------------------- human review
    def _persist_review_packet(self, project_key: str, snapshot_digest: str,
                               packet: Optional[dict], timestamp: str) -> None:
        """Upsert the current packet and expire superseded open packets."""
        current_id = packet["id"] if packet else None
        stale = self.store.q(
            "SELECT * FROM review WHERE project_key=? AND review_type='human_review_packet'"
            " AND status='open' AND (? IS NULL OR id<>?)",
            (project_key, current_id, current_id),
        )
        for row in stale:
            payload = _loads(row["payload"], {})
            payload.update({"status": "expired", "updatedAt": timestamp,
                            "completedAt": timestamp})
            self.store.x(
                "UPDATE review SET status='resolved',payload=?,resolved_at=? WHERE id=?",
                (canonical_json(payload), timestamp, row["id"]),
            )
        if packet is None:
            return
        stored = self.store.q1("SELECT * FROM review WHERE id=?", (packet["id"],))
        if stored:
            prior = _loads(stored["payload"], {})
            status = prior.get("status", packet["status"])
            updated = {**packet, "snapshotDigest": snapshot_digest,
                       "status": status, "createdAt": prior.get("createdAt", packet["createdAt"]),
                       "updatedAt": timestamp}
            if status in {"approved", "rejected", "deferred", "expired"}:
                updated["completedAt"] = prior.get("completedAt") or timestamp
            self.store.x("UPDATE review SET payload=? WHERE id=?",
                         (canonical_json(updated), packet["id"]))
            return
        persisted = {**packet, "snapshotDigest": snapshot_digest}
        self.store.x(
            "INSERT INTO review (id,project_key,subject_id,review_type,checkpoint,status,payload,"
            "created_at) VALUES (?,?,?,'human_review_packet',?,'open',?,?)",
            (packet["id"], project_key, packet["id"],
             "human" if packet["blocking"] else "human_recommended",
             canonical_json(persisted), timestamp),
        )
        self._event(project_key, "HumanReviewPacketQueued", "project-review-policy", {
            "reviewPacketId": packet["id"], "snapshotDigest": snapshot_digest,
            "blocking": packet["blocking"], "subjectIds": packet["subjectIds"],
            "policyVersion": packet["policyVersion"],
        })

    def review_packets(self, project_key: str, snapshot_digest: Optional[str] = None) -> list[dict]:
        rows = self.store.q(
            "SELECT * FROM review WHERE project_key=? AND review_type='human_review_packet'"
            " ORDER BY created_at,id", (project_key,),
        )
        packets = []
        for row in rows:
            payload = _loads(row["payload"], {})
            if snapshot_digest and payload.get("snapshotDigest") != snapshot_digest:
                continue
            packets.append(payload)
        return packets

    def human_review_summary(self, project_key: str,
                             snapshot_digest: Optional[str] = None) -> dict:
        target = snapshot_digest or (self.latest_snapshot(project_key) or {}).get("digest")
        packets = self.review_packets(project_key, target) if target else []
        pending = [packet for packet in packets if packet.get("status") == "pending"]
        rejected = [packet for packet in packets if packet.get("status") == "rejected"]
        deferred = [packet for packet in packets if packet.get("status") == "deferred"]
        gate_status = (
            "rejected" if rejected else "pending" if pending else
            "deferred" if deferred else "approved" if packets else "not_needed"
        )
        policy = self.policy(project_key)
        return {
            "policyVersion": str(policy["policy_version"]), "gateStatus": gate_status,
            "pendingCount": len(pending),
            "blockingPacketIds": [packet["id"] for packet in pending if packet.get("blocking")],
            "reviewPackets": packets,
        }

    def record_review_result(self, *, project_key: str, packet_id: str, action: str,
                             actor_id: str, rationale: str,
                             confidence: float = 1.0,
                             expected_snapshot_digest: Optional[str] = None) -> dict:
        action_map = {
            "approve": ("endorse", "approved", "resolved"),
            "reject": ("challenge", "rejected", "resolved"),
            "defer": ("defer", "deferred", "deferred"),
            "request_evidence": ("request_evidence", "pending", "open"),
        }
        if action not in action_map:
            raise ValueError("review action must be approve, reject, defer or request_evidence")
        if not actor_id.strip() or not rationale.strip():
            raise ValueError("actorId and rationale are required")
        review = self.store.q1("SELECT * FROM review WHERE id=?", (packet_id,))
        if review is None or review["project_key"] != project_key \
                or review["review_type"] != "human_review_packet":
            raise KeyError(packet_id)
        payload = _loads(review["payload"], {})
        if review["status"] != "open" or payload.get("status") == "expired":
            raise ValueError("Review Packet is no longer open")
        digest = payload.get("snapshotDigest")
        snapshot = self.snapshot(digest) if isinstance(digest, str) else None
        if snapshot is None or snapshot["projectKey"] != project_key:
            raise ValueError("Review Packet does not identify a committed Project Snapshot")
        if expected_snapshot_digest and expected_snapshot_digest != digest:
            raise ValueError("Review Packet snapshot changed; reload before recording a decision")
        latest = self.latest_snapshot(project_key)
        if latest is None or latest["digest"] != digest:
            raise ValueError("Review Packet is stale; reload the latest Project Snapshot")
        decision_action, review_status, db_status = action_map[action]
        policy = self.policy(project_key)
        timestamp = now_iso()
        decision_id = self._record_decision_row(
            project_key=project_key, review_id=packet_id, finding_id=None,
            action=decision_action, decided_by="human", actor_id=actor_id,
            autonomy_mode=policy["autonomy_mode"], rationale=rationale,
            alternatives=sorted(set(action_map) - {action}), evidence_digest=digest,
            confidence=confidence, reversibility="fully_reversible", supersedes_id=None,
        )
        payload.update({
            "status": review_status, "updatedAt": timestamp,
            "humanResult": {"action": action, "decisionId": decision_id,
                            "actorId": actor_id, "rationale": rationale,
                            "recordedAt": timestamp},
        })
        if review_status != "pending":
            payload["completedAt"] = timestamp
        self.store.x(
            "UPDATE review SET status=?,payload=?,resolved_at=? WHERE id=?",
            (db_status, canonical_json(payload),
             timestamp if db_status != "open" else None, packet_id),
        )
        self._event(project_key, "HumanReviewResultRecorded", actor_id, {
            "reviewPacketId": packet_id, "decisionId": decision_id,
            "action": action, "snapshotDigest": digest,
        })
        self.store.conn.commit()
        return payload

    # --------------------------------------------------------------- queries
    def job(self, job_id: str) -> Optional[dict]:
        row = self.store.q1("SELECT * FROM project_update_job WHERE id=?", (job_id,))
        if row:
            row["desiredEvidenceVector"] = _loads(row.pop("desired_vector"), [])
            row["capturedScope"] = _loads(row.pop("captured_scope"), {})
        return row

    def status(self, project_key: str) -> dict:
        recent_snapshots = self.store.q(
            "SELECT payload FROM project_snapshot WHERE project_key=? ORDER BY version DESC LIMIT 2",
            (project_key,),
        )
        jobs = self.store.q(
            "SELECT id,status,reason,priority,request_version,attempts,last_error,next_attempt_at,"
            "updated_at"
            " FROM project_update_job WHERE project_key=? ORDER BY updated_at DESC LIMIT 20",
            (project_key,),
        )
        active = next((j for j in jobs if j["status"] in
                       {"queued", "running", "retry_scheduled", "failed"}), None)
        snapshot = _loads(recent_snapshots[0]["payload"], None) if recent_snapshots else None
        previous_snapshot = (
            _loads(recent_snapshots[1]["payload"], None)
            if len(recent_snapshots) > 1 else None
        )
        latest_audit = self.store.q1(
            "SELECT id,target_digest,status,digest,error,next_attempt_at FROM audit_run"
            " WHERE project_key=? AND (? IS NULL OR target_digest=?)"
            " ORDER BY updated_at DESC,created_at DESC LIMIT 1",
            (project_key, snapshot["digest"] if snapshot else None,
             snapshot["digest"] if snapshot else None),
        )
        audit_pending = self.store.q1(
            "SELECT COUNT(*) n FROM audit_run WHERE project_key=?"
            " AND status IN ('queued','running','failed')", (project_key,))
        attention = self.store.q1(
            "SELECT COUNT(*) n FROM attention_frontier WHERE project_key=?"
            " AND snapshot_digest=?", (project_key, snapshot["digest"] if snapshot else ""))
        return {
            "projectKey": project_key,
            "state": ("updating" if active and active["status"] == "running" else
                      "retry_scheduled" if active and active["status"] == "retry_scheduled" else
                      "update_failed" if active and active["status"] == "failed" else
                      "pending" if active else "fresh" if snapshot else "empty"),
            "committedSnapshot": snapshot,
            "previousCommittedSnapshot": previous_snapshot,
            "desiredEvidenceVector": (self.job(active["id"])["desiredEvidenceVector"]
                                      if active else snapshot["evidenceVector"] if snapshot else []),
            "pending": sum(
                j["status"] in {"queued", "running", "retry_scheduled"} for j in jobs),
            "jobs": jobs,
            "auditTargetDigest": latest_audit["target_digest"] if latest_audit else None,
            "auditStatus": latest_audit["status"] if latest_audit else "not_run",
            "auditRunId": latest_audit["id"] if latest_audit else None,
            "auditError": latest_audit["error"] if latest_audit else None,
            "auditNextAttemptAt": latest_audit["next_attempt_at"] if latest_audit else None,
            "auditPending": int((audit_pending or {}).get("n") or 0),
            "auditStale": bool(snapshot and (
                latest_audit is None
                or latest_audit["target_digest"] != snapshot["digest"]
                or latest_audit["status"] == "stale"
            )),
            "attentionCount": int((attention or {}).get("n") or 0),
            "autonomy": self.policy(project_key),
            "humanReview": self.human_review_summary(
                project_key, snapshot["digest"] if snapshot else None),
        }

    def snapshot(self, digest: str) -> Optional[dict]:
        row = self.store.q1("SELECT payload FROM project_snapshot WHERE digest=?", (digest,))
        return _loads(row["payload"], None) if row else None

    def latest_snapshot(self, project_key: str) -> Optional[dict]:
        row = self.store.q1(
            "SELECT payload FROM project_snapshot WHERE project_key=? ORDER BY version DESC LIMIT 1",
            (project_key,),
        )
        return _loads(row["payload"], None) if row else None

    def findings(self, project_key: str, status: Optional[str] = None) -> list[dict]:
        sql, args = "SELECT * FROM finding WHERE project_key=?", [project_key]
        if status:
            sql += " AND status=?"; args.append(status)
        rows = self.store.q(sql + " ORDER BY created_at", args)
        for row in rows:
            row["details"] = _loads(row["details"], {})
        return rows

    def reviews(self, project_key: str, status: str = "open") -> list[dict]:
        rows = self.store.q(
            "SELECT * FROM review WHERE project_key=? AND status=?"
            " ORDER BY CASE WHEN review_type='human_review_packet' THEN 1 ELSE 0 END,created_at",
            (project_key, status),
        )
        for row in rows:
            row["payload"] = _loads(row["payload"], {})
        return rows

    def attention(self, project_key: str, digest: Optional[str] = None) -> list[dict]:
        target = digest or (self.latest_snapshot(project_key) or {}).get("digest")
        if not target:
            return []
        rows = self.store.q(
            "SELECT * FROM attention_frontier WHERE project_key=? AND snapshot_digest=?"
            " ORDER BY score DESC", (project_key, target),
        )
        for row in rows:
            row["factors"] = _loads(row["factors"], {})
            row["blocking"] = bool(row["blocking"])
        return rows

    def audit(self, audit_id: str) -> Optional[dict]:
        return self.store.q1("SELECT * FROM audit_run WHERE id=?", (audit_id,))

    def audits(self, project_key: str, limit: int = 20) -> list[dict]:
        return self.store.q(
            "SELECT * FROM audit_run WHERE project_key=?"
            " ORDER BY updated_at DESC LIMIT ?", (project_key, max(1, min(limit, 200))),
        )

    def decision(self, decision_id: str) -> Optional[dict]:
        row = self.store.q1("SELECT * FROM decision_event WHERE id=?", (decision_id,))
        if row:
            row["alternatives"] = _loads(row["alternatives"], [])
        return row

    def release(self, release_id: str) -> Optional[dict]:
        row = self.store.q1("SELECT * FROM release_record WHERE id=?", (release_id,))
        if row:
            for key in ("evidence_vector", "critical_findings", "overrides", "output_artifacts"):
                row[key] = _loads(row[key], [])
        return row

    def assessments(self, project_key: str, target_digest: Optional[str] = None) -> list[dict]:
        sql, args = "SELECT * FROM assessment WHERE project_key=?", [project_key]
        if target_digest:
            sql += " AND target_digest=?"; args.append(target_digest)
        return self.store.q(sql + " ORDER BY created_at,id", args)

    def _event(self, project_key: str, event_type: str, actor: str, payload: dict) -> str:
        event_id = digest_json({
            "projectKey": project_key, "eventType": event_type, "actor": actor,
            "payload": payload,
        }, "event")
        self.store.x(
            "INSERT OR IGNORE INTO domain_event (id,event_type,project_key,occurred_at,actor,payload)"
            " VALUES (?,?,?,?,?,?)",
            (event_id, event_type, project_key, now_iso(), actor, canonical_json(payload)),
        )
        return event_id
