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
    DECISION_POLICY_V1,
    PROJECT_INVALIDATION_POLICY_V1,
    project_input_fingerprint,
    classify_project_invalidation,
    DECISION_ACTION_CLASSES,
    normalize_decision_rules,
)
from .reader import SessionReader
from .store import Store, new_id, now_iso
from .human_review import evaluate_project_human_review
from .snapshot_integrity import validate_project_snapshot_row

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
        self._finalize_migrated_receipts()
        t = now_iso()
        for job in self.store.q(
                "SELECT * FROM project_update_job WHERE status='running'"):
            generation = job["processing_version"]
            receipt = self.store.q1(
                "SELECT state FROM project_update_receipt"
                " WHERE job_id=? AND request_version=?",
                (job["id"], generation),
            )
            if receipt is None:
                raise RuntimeError(
                    f"running Project update {job['id']} has no durable receipt")
            if receipt["state"] == "committed":
                newer = int(job["request_version"]) != int(generation)
                self.store.x(
                    "UPDATE project_update_job SET status=?,attempts=?,last_error=NULL,"
                    "updated_at=?,started_at=NULL,finished_at=?,next_attempt_at=NULL WHERE id=?",
                    ("queued" if newer else "succeeded", 0 if newer else job["attempts"],
                     t, None if newer else t, job["id"]),
                )
            else:
                error = "worker stopped; accepted update requeued on startup"
                self.store.x(
                    "UPDATE project_update_receipt SET state='queued',last_error=?,updated_at=?"
                    " WHERE job_id=? AND request_version=?",
                    (error, t, job["id"], generation),
                )
                self.store.x(
                    "UPDATE project_update_job SET status='queued',last_error=?,updated_at=?,"
                    " started_at=NULL,finished_at=NULL,next_attempt_at=NULL WHERE id=?",
                    (error, t, job["id"]),
                )
        self.store.x(
            "UPDATE audit_run SET status='queued',started_at=NULL,finished_at=NULL,"
            " updated_at=?,next_attempt_at=?,error=? WHERE status='running'",
            (t, t, "audit worker interrupted; recovered on startup"),
        )
        self.store.conn.commit()

    def _evidence_snapshot_identity(self, vector: list[dict]) -> list[dict]:
        identities = []
        for entry in vector:
            _, snapshot, _ = self.reader.load(entry["threadId"], entry["digest"])
            identities.append({
                "threadId": entry["threadId"],
                "version": int(snapshot.version),
                "digest": snapshot.digest,
                "inputWatermark": snapshot.input_watermark,
                "schemaVersion": snapshot.schema_version,
                "extractorVersion": snapshot.extractor_version,
                "verifierVersion": snapshot.verifier_version,
            })
        return sorted(identities, key=lambda item: item["threadId"])

    def _finalize_migrated_receipts(self) -> None:
        self.store.x("BEGIN IMMEDIATE")
        try:
            for receipt in self.store.q(
                    "SELECT * FROM project_update_receipt"
                    " WHERE state IN ('queued','failed')"):
                context = _loads(receipt["desired_context"], {})
                if not context.get("migrationPending"):
                    continue
                job = self.store.q1(
                    "SELECT * FROM project_update_job WHERE id=?"
                    " AND request_version=?",
                    (receipt["job_id"], receipt["request_version"]),
                )
                if job is None:
                    continue
                vector = _loads(receipt["desired_vector"], [])
                scope = _loads(receipt["captured_scope"], {})
                try:
                    evidence_snapshots = self._evidence_snapshot_identity(vector)
                    self._validate_evidence_monotonic(
                        receipt["project_key"], evidence_snapshots,
                        exclude_job_id=receipt["job_id"])
                    desired_context, fingerprint = self._desired_identity(
                        receipt["project_key"], vector, scope, job["autonomy_mode"],
                        evidence_snapshots=evidence_snapshots)
                except Exception as exc:
                    t = now_iso()
                    error = f"Project DAG v2 upgrade could not recover accepted input: {exc}"
                    self.store.x(
                        "UPDATE project_update_receipt SET state='failed',last_error=?,updated_at=?"
                        " WHERE job_id=? AND request_version=?",
                        (error, t, receipt["job_id"], receipt["request_version"]),
                    )
                    self.store.x(
                        "UPDATE project_update_job SET status='failed',last_error=?,"
                        "next_attempt_at=NULL,finished_at=?,updated_at=? WHERE id=?",
                        (error, t, t, receipt["job_id"]),
                    )
                    continue
                self.store.x(
                    "UPDATE project_update_receipt SET desired_fingerprint=?,desired_context=?,"
                    "updated_at=? WHERE job_id=? AND request_version=?",
                    (fingerprint, canonical_json(desired_context), now_iso(),
                     receipt["job_id"], receipt["request_version"]),
                )
                self.store.x(
                    "UPDATE project_update_job SET desired_fingerprint=? WHERE id=?",
                    (fingerprint, receipt["job_id"]),
                )
            self.store.conn.commit()
        except Exception:
            self.store.conn.rollback()
            raise

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
        return self._present_policy(row)

    @staticmethod
    def _present_policy(row: dict) -> dict:
        row["checkpoints"] = _loads(row["checkpoints"], [])
        row["allowAgentCriticalOverride"] = bool(row.pop("allow_agent_critical_override"))
        row["decisionRules"] = normalize_decision_rules(_loads(row.get("decision_rules"), None))
        row.pop("decision_rules", None)
        return row

    def configure_policy(self, project_key: str, *, autonomy_mode: Optional[str] = None,
                         checkpoints: Optional[list[str]] = None,
                         allow_agent_critical_override: Optional[bool] = None,
                         decision_rules: Optional[dict] = None,
                         actor: str = "human") -> dict:
        current = self.policy(project_key)
        mode = validate_autonomy_mode(autonomy_mode or current["autonomy_mode"])
        points = checkpoints if checkpoints is not None else current["checkpoints"]
        if not isinstance(points, list) or not all(isinstance(x, str) for x in points):
            raise ValueError("checkpoints must be a string array")
        allow = (current["allowAgentCriticalOverride"]
                 if allow_agent_critical_override is None else allow_agent_critical_override)
        rules = normalize_decision_rules(
            decision_rules if decision_rules is not None else current.get("decisionRules"))
        version = int(current["policy_version"]) + 1
        t = now_iso()
        self.store.x(
            "UPDATE project_policy SET autonomy_mode=?,policy_version=?,checkpoints=?,"
            "allow_agent_critical_override=?,decision_rules=?,updated_at=? WHERE project_key=?",
            (mode, version, canonical_json(sorted(set(points))), int(bool(allow)),
             canonical_json(rules), t, project_key),
        )
        self._event(project_key, "ProjectPolicyChanged", actor, {
            "autonomyMode": mode, "policyVersion": version,
            "checkpoints": sorted(set(points)),
            "allowAgentCriticalOverride": bool(allow),
            "decisionRules": rules,
        })
        self.store.conn.commit()
        return self.policy(project_key)

    def mark_stale(self, project_key: str, *, desired_fingerprint: Optional[str] = None,
                   reason: str = "upstream_changed", changed_fields: Optional[list[str]] = None,
                   formal_gate: bool = False) -> dict:
        """Record freshness without compiling or creating a Snapshot."""
        changed = sorted(set(changed_fields or []))
        material = any(
            classify_project_invalidation(field, formal_gate=formal_gate) == "material"
            for field in changed
        )
        current = self.store.q1(
            "SELECT applied_fingerprint FROM project_invalidation WHERE project_key=?",
            (project_key,),
        )
        now = now_iso()
        self.store.x(
            "INSERT INTO project_invalidation"
            " (project_key,desired_fingerprint,applied_fingerprint,stale,reason,changed_fields,updated_at)"
            " VALUES (?,?,?,?,?,?,?) ON CONFLICT(project_key) DO UPDATE SET"
            " desired_fingerprint=excluded.desired_fingerprint,stale=excluded.stale,"
            " reason=excluded.reason,changed_fields=excluded.changed_fields,updated_at=excluded.updated_at",
            (project_key, desired_fingerprint, (current or {}).get("applied_fingerprint"),
             int(material or bool(desired_fingerprint and desired_fingerprint != (current or {}).get("applied_fingerprint"))),
             reason, canonical_json(changed), now),
        )
        self.store.conn.commit()
        return self.invalidation(project_key) or {"projectKey": project_key, "stale": material}

    def invalidation(self, project_key: str) -> Optional[dict]:
        row = self.store.q1("SELECT * FROM project_invalidation WHERE project_key=?", (project_key,))
        if row is None:
            return None
        row["stale"] = bool(row["stale"])
        row["projectKey"] = row.pop("project_key")
        row["changedFields"] = _loads(row.pop("changed_fields"), [])
        row["desiredFingerprint"] = row.pop("desired_fingerprint")
        row["appliedFingerprint"] = row.pop("applied_fingerprint")
        return row

    def scope_revisions(self, project_key: str) -> list[dict]:
        rows = self.store.q(
            "SELECT * FROM project_scope_revision WHERE project_key=? ORDER BY revision", (project_key,))
        for row in rows:
            row["revision"] = int(row["revision"])
            row["includedSessions"] = _loads(row.pop("included_sessions"), [])
            row["excludedSessions"] = _loads(row.pop("excluded_sessions"), [])
            row["isolatedSessions"] = _loads(row.pop("isolated_sessions"), [])
            row["reasons"] = _loads(row.pop("reasons"), {})
            row["createdBy"] = row.pop("created_by")
            row["createdAt"] = row.pop("created_at")
        return rows

    def save_goal_draft(self, project_key: str, *, title: str,
                        description: str = "", root_goal_id: Optional[str] = None,
                        actor: str = "human") -> dict:
        if not isinstance(title, str) or not title.strip():
            raise ValueError("Goal draft title is required")
        current = self.store.q1(
            "SELECT version FROM goal WHERE project_key=? AND root_id=? AND t_expired IS NULL",
            (project_key, root_goal_id),
        ) if root_goal_id else None
        if root_goal_id and current is None:
            raise KeyError(root_goal_id)
        now = now_iso()
        self.store.x(
            "INSERT INTO project_goal_draft"
            " (project_key,root_goal_id,title,description,base_version,updated_by,updated_at)"
            " VALUES (?,?,?,?,?,?,?) ON CONFLICT(project_key) DO UPDATE SET"
            " root_goal_id=excluded.root_goal_id,title=excluded.title,description=excluded.description,"
            " base_version=excluded.base_version,updated_by=excluded.updated_by,updated_at=excluded.updated_at",
            (project_key, root_goal_id, title.strip(), (description or "").strip(),
             current["version"] if current else None, actor, now),
        )
        self.store.conn.commit()
        return self.goal_draft(project_key) or {}

    def goal_draft(self, project_key: str) -> Optional[dict]:
        row = self.store.q1("SELECT * FROM project_goal_draft WHERE project_key=?", (project_key,))
        if row is None:
            return None
        row["baseVersion"] = row.pop("base_version")
        row["rootGoalId"] = row.pop("root_goal_id")
        row["updatedBy"] = row.pop("updated_by")
        row["updatedAt"] = row.pop("updated_at")
        return row

    def save_scope_draft(self, project_key: str, scope: dict, *, actor: str = "human") -> dict:
        """Persist desired membership without changing the applied Scope."""
        normalized = normalize_scope(scope)
        prior = self.store.q1(
            "SELECT MAX(revision) AS revision FROM project_scope_revision WHERE project_key=?",
            (project_key,),
        )
        now = now_iso()
        self.store.x(
            "INSERT INTO project_scope_draft"
            " (project_key,included_sessions,excluded_sessions,isolated_sessions,reasons,"
            "base_revision,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?)"
            " ON CONFLICT(project_key) DO UPDATE SET included_sessions=excluded.included_sessions,"
            "excluded_sessions=excluded.excluded_sessions,isolated_sessions=excluded.isolated_sessions,"
            "reasons=excluded.reasons,base_revision=excluded.base_revision,updated_by=excluded.updated_by,"
            "updated_at=excluded.updated_at",
            (project_key, canonical_json(normalized["includedSessions"]),
             canonical_json(normalized["excludedSessions"]),
             canonical_json(normalized["isolatedSessions"]), canonical_json(normalized["reasons"]),
             int((prior or {}).get("revision") or 0), actor, now),
        )
        self.store.conn.commit()
        return self.scope_draft(project_key) or {}

    def scope_draft(self, project_key: str) -> Optional[dict]:
        row = self.store.q1("SELECT * FROM project_scope_draft WHERE project_key=?", (project_key,))
        if row is None:
            return None
        row["includedSessions"] = _loads(row.pop("included_sessions"), [])
        row["excludedSessions"] = _loads(row.pop("excluded_sessions"), [])
        row["isolatedSessions"] = _loads(row.pop("isolated_sessions"), [])
        row["reasons"] = _loads(row.pop("reasons"), {})
        row["baseRevision"] = row.pop("base_revision")
        row["updatedBy"] = row.pop("updated_by")
        row["updatedAt"] = row.pop("updated_at")
        return row

    def apply_scope_draft(self, project_key: str, *, actor: str = "human") -> dict:
        draft = self.scope_draft(project_key)
        if draft is None:
            raise ValueError("Scope draft is not initialized")
        latest_job = self.store.q1(
            "SELECT desired_vector FROM project_update_job WHERE project_key=?"
            " AND status IN ('queued','running','retry_scheduled','failed')",
            (project_key,),
        )
        latest = self.latest_snapshot(project_key)
        vector = _loads(latest_job["desired_vector"], []) if latest_job else (
            latest["evidenceVector"] if latest else [])
        included = set(draft["includedSessions"])
        by_thread = {entry["threadId"]: entry for entry in vector}
        missing = included - set(by_thread)
        if missing:
            raise ValueError(
                f"Scope includes Sessions without exact Evidence heads: {sorted(missing)}")
        selected = normalize_evidence_vector(by_thread[session] for session in sorted(included))
        scope = {
            "includedSessions": sorted(included),
            "excludedSessions": draft["excludedSessions"],
            "isolatedSessions": draft["isolatedSessions"],
            "reasons": draft["reasons"],
        }
        result = self.enqueue_update(
            project_key=project_key, evidence_vector=selected, captured_scope=scope,
            reason="scope_applied", actor=actor,
        )
        self.store.x("DELETE FROM project_scope_draft WHERE project_key=?", (project_key,))
        self._event(project_key, "ScopeDraftApplied", actor, {
            "scopeRevision": self.scope_revisions(project_key)[-1]["revision"],
        })
        self.store.conn.commit()
        return result

    def apply_goal_draft(self, project_key: str, *, actor_type: str = "human",
                         actor_id: str = "user", reframe: bool = False) -> dict:
        draft = self.goal_draft(project_key)
        if draft is None:
            raise ValueError("Goal draft is not initialized")
        root_id = draft.get("rootGoalId")
        if root_id:
            current = self.store.q1(
                "SELECT * FROM goal WHERE project_key=? AND root_id=? AND t_expired IS NULL",
                (project_key, root_id),
            )
            if current is None:
                raise KeyError(root_id)
            material = any(draft[key] != (current.get(column) or "")
                           for key, column in (("title", "title"), ("description", "description"))
                           ) and current.get("parent_id") is None
            if material and actor_type == "agent" and not reframe:
                return {"proposal": True, "impact": "root_goal_reframe_required", "draft": draft}
            if material and not reframe and actor_type != "human":
                raise ValueError("root reframe requires an accountable human")
            goal = self.store.update_goal(root_id, title=draft["title"],
                                          description=draft["description"])
        else:
            goal = self.store.create_goal(draft["title"], description=draft["description"],
                                          project_key=project_key)
        self.store.x("DELETE FROM project_goal_draft WHERE project_key=?", (project_key,))
        self._event(project_key, "GoalDraftApplied", actor_id, {
            "goalVersion": goal["id"], "rootGoalId": goal["root_id"],
            "version": goal["version"],
        })
        self.store.conn.commit()
        return goal

    def _desired_identity(self, project_key: str, vector: list[dict], scope: dict,
                          autonomy_mode: str, *,
                          evidence_snapshots: Optional[list[dict]] = None) -> tuple[dict, str]:
        policy = self.store.q1(
            "SELECT policy_version FROM project_policy WHERE project_key=?", (project_key,))
        if policy is None:
            raise RuntimeError(f"Project policy is missing for {project_key}")
        decisions = self.store.q(
            "SELECT id FROM decision_event WHERE project_key=? ORDER BY id", (project_key,))
        context = {
            "projectKey": project_key,
            "evidenceVector": vector,
            "evidenceSnapshots": (
                evidence_snapshots
                if evidence_snapshots is not None
                else self._evidence_snapshot_identity(vector)
            ),
            "capturedScope": scope,
            "autonomyMode": autonomy_mode,
            "goalVersion": self._goal_version(project_key),
            "policyVersion": int(policy["policy_version"]),
            "decisionVersion": [row["id"] for row in decisions],
            "compilerVersion": COMPILER_VERSION,
            "invalidationPolicyVersion": PROJECT_INVALIDATION_POLICY_V1,
        }
        return context, project_input_fingerprint(context, "project-update-desired")

    def _validate_evidence_monotonic(
            self, project_key: str, evidence_snapshots: list[dict], *,
            exclude_job_id: Optional[str] = None) -> None:
        baseline: dict[str, dict] = {}
        active_receipt = self.store.q1(
            "SELECT r.job_id,r.desired_context FROM project_update_receipt r"
            " JOIN project_update_job j ON j.id=r.job_id"
            " WHERE j.project_key=?"
            " AND j.status IN ('queued','running','retry_scheduled','failed')"
            " ORDER BY r.request_version DESC LIMIT 1",
            (project_key,),
        )
        if active_receipt and active_receipt["job_id"] != exclude_job_id:
            context = _loads(active_receipt["desired_context"], {})
            for item in context.get("evidenceSnapshots", []):
                baseline[item["threadId"]] = item
        latest = self.latest_snapshot(project_key)
        if latest:
            for item in self._evidence_snapshot_identity(latest["evidenceVector"]):
                prior = baseline.get(item["threadId"])
                if prior is None or int(item["version"]) > int(prior["version"]):
                    baseline[item["threadId"]] = item
        for item in evidence_snapshots:
            prior = baseline.get(item["threadId"])
            if prior is None:
                continue
            version = int(item["version"])
            prior_version = int(prior["version"])
            if version < prior_version:
                raise ValueError(
                    f"{item['threadId']}: Evidence Snapshot version {version}"
                    f" would roll back accepted version {prior_version}")
            if version == prior_version and item["digest"] != prior["digest"]:
                raise ValueError(
                    f"{item['threadId']}: Evidence Snapshot version {version}"
                    " has a different immutable digest")

    def enqueue_update(self, *, project_key: str, evidence_vector: list[dict],
                       captured_scope: Optional[dict], reason: str, priority: int = 0,
                       autonomy_mode: Optional[str] = None,
                       actor: str = "runtime") -> dict:
        with self._queue_lock:
            return self._enqueue_update_locked(
                project_key=project_key, evidence_vector=evidence_vector,
                captured_scope=captured_scope, reason=reason, priority=priority,
                autonomy_mode=autonomy_mode, actor=actor)

    def _enqueue_update_locked(self, *, project_key: str, evidence_vector: list[dict],
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
        if set(scope["includedSessions"]) != {x["threadId"] for x in vector}:
            raise ValueError("capturedScope.includedSessions must exactly match evidenceVector")

        # Evidence DAG's committed immutable files are the sole source of
        # truth.  References are resolved and integrity-checked before the
        # Project update is made durable; no envelope copy is accepted or
        # cached in the Project database.
        evidence_snapshots = []
        for entry in vector:
            try:
                _, snapshot, _ = self.reader.load(entry["threadId"], entry["digest"])
                evidence_snapshots.append({
                    "threadId": entry["threadId"],
                    "version": int(snapshot.version),
                    "digest": snapshot.digest,
                    "inputWatermark": snapshot.input_watermark,
                    "schemaVersion": snapshot.schema_version,
                    "extractorVersion": snapshot.extractor_version,
                    "verifierVersion": snapshot.verifier_version,
                })
            except OSError as exc:
                raise ValueError(
                    f"{entry['threadId']}: committed Evidence Snapshot"
                    f" {entry['digest']} is unavailable") from exc
        evidence_snapshots.sort(key=lambda item: item["threadId"])
        self.policy(project_key)  # Ensure the default exists before BEGIN IMMEDIATE.
        with self.store.transaction_lock:
            self.store.x("BEGIN IMMEDIATE")
            try:
                # Revalidate after acquiring the write transaction. Two
                # concurrent notifications may both have read the same prior
                # generation; only the one still monotonic at acceptance may
                # become the next durable receipt.
                self._validate_evidence_monotonic(project_key, evidence_snapshots)
                accepted_policy = self.store.q1(
                    "SELECT autonomy_mode FROM project_policy WHERE project_key=?",
                    (project_key,),
                )
                if accepted_policy is None:
                    raise RuntimeError(f"Project policy is missing for {project_key}")
                mode = validate_autonomy_mode(
                    autonomy_mode or accepted_policy["autonomy_mode"])
                desired_context, desired_fingerprint = self._desired_identity(
                    project_key, vector, scope, mode,
                    evidence_snapshots=evidence_snapshots)
                prior_snapshot = self.latest_snapshot(project_key)
                prior_input = (prior_snapshot or {}).get("inputFingerprint")
                self.store.x(
                    "INSERT INTO project_invalidation"
                    " (project_key,desired_fingerprint,applied_fingerprint,stale,reason,changed_fields,updated_at)"
                    " VALUES (?,?,?,?,?,?,?) ON CONFLICT(project_key) DO UPDATE SET"
                    " desired_fingerprint=excluded.desired_fingerprint,stale=excluded.stale,"
                    " reason=excluded.reason,changed_fields=excluded.changed_fields,updated_at=excluded.updated_at",
                    (project_key, desired_fingerprint, prior_input,
                     int(prior_input != desired_fingerprint), reason, canonical_json([
                         "evidenceVector", "capturedScope", "goalIntent", "projectPolicyVersion"
                     ]), now_iso()),
                )
                job = self.store.q1(
                    "SELECT * FROM project_update_job WHERE project_key=?"
                    " AND status IN ('queued','running','retry_scheduled','failed')",
                    (project_key,),
                )
                t = now_iso()
                if job is None:
                    job_id = new_id("pjob")
                    generation = 1
                    self._replace_scope(project_key, scope)
                    self.store.x(
                        "INSERT INTO project_update_job (id,project_key,desired_vector,captured_scope,"
                        "reason,priority,autonomy_mode,desired_fingerprint,created_at,updated_at)"
                        " VALUES (?,?,?,?,?,?,?,?,?,?)",
                        (job_id, project_key, canonical_json(vector), canonical_json(scope), reason,
                         int(priority), mode, desired_fingerprint, t, t),
                    )
                    self.store.x(
                        "INSERT INTO project_update_receipt"
                        " (job_id,request_version,project_key,desired_fingerprint,desired_context,"
                        "desired_vector,captured_scope,state,accepted_at,updated_at)"
                        " VALUES (?,?,?,?,?,?,?,'queued',?,?)",
                        (job_id, generation, project_key, desired_fingerprint,
                         canonical_json(desired_context),
                         canonical_json(vector), canonical_json(scope), t, t),
                    )
                elif (
                    job["desired_fingerprint"] == desired_fingerprint
                    and job["status"] != "failed"
                ):
                    # The receipt is the idempotency identity. Repeated delivery
                    # of the same active desired state must not manufacture a
                    # generation that no worker can distinguish.
                    job_id = job["id"]
                    generation = int(job["request_version"])
                    self.store.x(
                        "UPDATE project_update_job SET priority=MAX(priority,?) WHERE id=?",
                        (int(priority), job_id),
                    )
                    self.store.conn.commit()
                    return self.receipt_status(
                        job_id, generation, desired_fingerprint)
                else:
                    # A terminal failure is immutable receipt history, not an
                    # idempotency lock on the desired state. A new enqueue of
                    # that same state is a new accepted generation on the
                    # canonical lane, with fresh attempts and error state.
                    job_id = job["id"]
                    generation = int(job["request_version"]) + 1
                    self._replace_scope(project_key, scope)
                    self.store.x(
                        "UPDATE project_update_job SET desired_vector=?,captured_scope=?,reason=?,"
                        "priority=MAX(priority,?),autonomy_mode=?,request_version=request_version+1,"
                        "desired_fingerprint=?,"
                        "status=CASE WHEN status='running' THEN 'running' ELSE 'queued' END,"
                        "attempts=CASE WHEN status='running' THEN attempts ELSE 0 END,"
                        "last_error=NULL,next_attempt_at=NULL,updated_at=?,finished_at=NULL WHERE id=?",
                        (canonical_json(vector), canonical_json(scope), reason, int(priority), mode,
                         desired_fingerprint, t, job_id),
                    )
                    self.store.x(
                        "UPDATE project_update_receipt SET state='superseded',updated_at=?"
                        " WHERE job_id=? AND state='queued'",
                        (t, job_id),
                    )
                    self.store.x(
                        "INSERT INTO project_update_receipt"
                        " (job_id,request_version,project_key,desired_fingerprint,desired_context,"
                        "desired_vector,captured_scope,state,accepted_at,updated_at)"
                        " VALUES (?,?,?,?,?,?,?,'queued',?,?)",
                        (job_id, generation, project_key, desired_fingerprint,
                         canonical_json(desired_context),
                         canonical_json(vector), canonical_json(scope), t, t),
                    )
                self._event(project_key, "ProjectCompileQueued", actor, {
                    "jobId": job_id, "acceptedRequestVersion": generation,
                    "desiredFingerprint": desired_fingerprint,
                    "evidenceVector": vector, "capturedScope": scope,
                    "reason": reason, "priority": int(priority), "autonomyMode": mode,
                })
                self.store.conn.commit()
            except Exception:
                self.store.conn.rollback()
                raise
        return self.receipt_status(job_id, generation, desired_fingerprint)

    def _replace_scope(self, project_key: str, scope: dict) -> None:
        self.store.x("DELETE FROM project_scope WHERE project_key=?", (project_key,))
        t = now_iso()
        reasons = scope.get("reasons") or {}
        for disposition, key in (
            ("included", "includedSessions"),
            ("excluded", "excludedSessions"),
            ("isolated", "isolatedSessions"),
        ):
            for session_id in scope[key]:
                self.store.x(
                    "INSERT INTO project_scope (project_key,session_id,disposition,reason,updated_at)"
                    " VALUES (?,?,?,?,?)", (project_key, session_id, disposition,
                                               reasons.get(session_id, ""), t))
        latest = self.store.q1(
            "SELECT MAX(revision) AS revision FROM project_scope_revision WHERE project_key=?",
            (project_key,),
        )
        revision = int((latest or {}).get("revision") or 0) + 1
        self.store.x(
            "INSERT INTO project_scope_revision"
            " (project_key,revision,included_sessions,excluded_sessions,isolated_sessions,reasons,created_by,created_at)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (project_key, revision, canonical_json(scope["includedSessions"]),
             canonical_json(scope["excludedSessions"]), canonical_json(scope["isolatedSessions"]),
             canonical_json(reasons), "project-domain", t),
        )

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

    def seal_snapshot(self, project_key: str, *, expected_head_digest: str,
                      reason: str = "formal_barrier") -> dict:
        """Compare-and-set the exact current head for a formal consumer."""
        if not isinstance(expected_head_digest, str) or not expected_head_digest.strip():
            raise ValueError("expectedHeadDigest is required; latest is not an identity")
        with self.store.transaction_lock:
            self.store.x("BEGIN IMMEDIATE")
            try:
                latest = self.latest_snapshot(project_key)
                if latest is None or latest["digest"] != expected_head_digest:
                    self.store.conn.rollback()
                    raise ValueError("Project Snapshot head changed; reload before sealing")
                invalidation = self.invalidation(project_key)
                active = self.store.q1(
                    "SELECT id FROM project_update_job WHERE project_key=?"
                    " AND status IN ('queued','running','retry_scheduled','failed')",
                    (project_key,),
                )
                if (invalidation and invalidation.get("stale")) or active:
                    self.store.conn.rollback()
                    raise ValueError("Project Snapshot is stale; derive the current exact inputs first")
                self._event(project_key, "ProjectSnapshotSealed", "project-governance", {
                    "projectSnapshot": expected_head_digest, "reason": reason,
                })
                self.store.conn.commit()
                return latest
            except Exception:
                if self.store.conn.in_transaction:
                    self.store.conn.rollback()
                raise

    # --------------------------------------------------------------- worker
    def process_next(self, project_key: Optional[str] = None) -> Optional[dict]:
        with self._queue_lock, self.store.transaction_lock:
            self.store.x("BEGIN IMMEDIATE")
            try:
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
                    self.store.conn.rollback()
                    return None
                generation = int(job["request_version"])
                attempt = int(job["attempts"]) + 1
                self.store.x(
                    "UPDATE project_update_job SET status='running',processing_version=?,"
                    "attempts=attempts+1,started_at=?,updated_at=?,finished_at=NULL,"
                    "last_error=NULL,next_attempt_at=NULL WHERE id=?",
                    (generation, t, t, job["id"]),
                )
                updated = self.store.conn.execute(
                    "UPDATE project_update_receipt SET state='running',last_error=NULL,updated_at=?"
                    " WHERE job_id=? AND request_version=? AND desired_fingerprint=?"
                    " AND state='queued'",
                    (t, job["id"], generation, job["desired_fingerprint"]),
                ).rowcount
                if updated != 1:
                    raise RuntimeError(
                        f"Project update {job['id']} generation {generation}"
                        " has no claimable durable receipt")
                self.store.conn.commit()
            except Exception:
                self.store.conn.rollback()
                raise

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
                    job["project_key"], vector, scope, result, job["autonomy_mode"],
                    job_id=job["id"], request_version=generation,
                    desired_fingerprint=job["desired_fingerprint"])
        except Exception as exc:
            with self.store.transaction_lock:
                self.store.conn.rollback()
                failed_at = now_iso()
                current = self.store.q1(
                    "SELECT request_version FROM project_update_job WHERE id=?", (job["id"],))
                superseded = (
                    current is not None and int(current["request_version"]) != generation)
                receipt = self.store.q1(
                    "SELECT state,committed_snapshot_digest FROM project_update_receipt"
                    " WHERE job_id=? AND request_version=?",
                    (job["id"], generation),
                )
                if receipt and receipt["state"] == "committed":
                    self.store.x(
                        "UPDATE project_update_job SET status=?,attempts=?,last_error=NULL,"
                        "finished_at=?,updated_at=?,next_attempt_at=NULL WHERE id=?",
                        ("queued" if superseded else "succeeded",
                         0 if superseded else attempt,
                         None if superseded else failed_at, failed_at, job["id"]),
                    )
                    self.store.conn.commit()
                    committed = self.snapshot(receipt["committed_snapshot_digest"])
                    return {
                        "job": self.job(job["id"]),
                        "snapshot": committed,
                        "compile": result,
                    }
                retryable = getattr(exc, "retryable", None) is not False
                retrying = (
                    not superseded
                    and retryable
                    and attempt < UPDATE_MAX_ATTEMPTS
                )
                status = ("queued" if superseded else
                          "retry_scheduled" if retrying else "failed")
                next_attempt_at = (
                    _retry_at(attempt, UPDATE_RETRY_BASE_SECONDS) if retrying else None)
                self.store.x(
                    "UPDATE project_update_job SET status=?,attempts=?,last_error=?,finished_at=?,"
                    "updated_at=?,next_attempt_at=? WHERE id=?",
                    (status, 0 if superseded else attempt,
                     None if superseded else str(exc),
                     failed_at if status == "failed" else None, failed_at,
                     next_attempt_at, job["id"]),
                )
                updated = self.store.conn.execute(
                    "UPDATE project_update_receipt SET state=?,last_error=?,updated_at=?"
                    " WHERE job_id=? AND request_version=? AND desired_fingerprint=?"
                    " AND state='running'",
                    ("queued" if retrying else "failed", str(exc), failed_at,
                     job["id"], generation, job["desired_fingerprint"]),
                ).rowcount
                if updated != 1:
                    self.store.conn.rollback()
                    raise RuntimeError(
                        f"Project update {job['id']} generation {generation}"
                        " lost its durable receipt while recording failure") from exc
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
            # The Store intentionally uses one SQLite connection for this
            # runtime actor. Keep the response read in the same short critical
            # section so another project's BEGIN IMMEDIATE cannot interleave
            # with sqlite3's row cursor on that connection.
            final_job = self.job(job["id"])
        return {"job": final_job, "snapshot": snapshot, "compile": result}

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
                "finished_at=NULL,last_error=NULL,updated_at=? WHERE id=?", (t, job_id),
            )
            self.store.x(
                "UPDATE project_update_receipt SET state='queued',last_error=NULL,updated_at=?"
                " WHERE job_id=? AND request_version=? AND state IN ('queued','failed')",
                (t, job_id, job["request_version"]),
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
            "title": g["title"], "description": g.get("description") or "",
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
            meta = _loads(edge.get("meta"), {})
            raw_origins = meta.get("origins")
            if isinstance(raw_origins, list):
                scoped_origins = [
                    origin for origin in raw_origins
                    if isinstance(origin, dict) and origin.get("session") in included_set
                ]
                if not scoped_origins:
                    continue
                first = scoped_origins[0]
                scoped_meta = {
                    **meta,
                    "session": first.get("session"),
                    "claim_node": first.get("node"),
                    "run": first.get("run"),
                    "origins": scoped_origins,
                }
                scoped_edges.append({**edge, "meta": canonical_json(scoped_meta)})
                continue
            # Pre-v3 support metadata is still readable in old databases while
            # Store performs its one-way migration.  New writes always use the
            # canonical ``origins`` array.
            if (edge["edge_type"] == "supports" and edge["dst"] in claim_ids
                    and meta.get("session") is not None):
                legacy_origins = [{
                    "session": meta.get("session"), "node": meta.get("claim_node"),
                    "run": meta.get("run"),
                }] if meta.get("session") in included_set else []
                if not legacy_origins:
                    continue
                scoped_edges.append({
                    **edge,
                    "meta": canonical_json({**meta, "origins": legacy_origins}),
                })
                continue
            scoped_edges.append(edge)
        edges = scoped_edges
        all_evidence = self.store.q(
            "SELECT * FROM evidence WHERE project_key=? ORDER BY id",
            (project_key,),
        )
        known_evidence_ids = {item["id"] for item in all_evidence}
        evidence_ids = {
            endpoint for edge in edges for endpoint in (edge["src"], edge["dst"])
            if endpoint in known_evidence_ids and (
                edge["src"] in claim_ids or edge["dst"] in claim_ids
                or edge["edge_type"] in {"replicates", "fails_to_replicate", "rerun_of"}
            )
        }
        evidence = [item for item in all_evidence if item["id"] in evidence_ids]
        entity_ids = {e["dst"] for e in edges if e["edge_type"] == "mentions"
                      and e["src"] in claim_ids}
        entities = [e for e in self.store.q(
            "SELECT * FROM entity WHERE project_key=? AND merged_into IS NULL ORDER BY id",
            (project_key,),
        ) if e["id"] in entity_ids]
        entity_ids = {entity["id"] for entity in entities}
        keep = claim_ids | {g["root_id"] for g in goals} | evidence_ids | entity_ids
        edges = [e for e in edges if e["src"] in keep and e["dst"] in keep]
        decisions = self.store.q(
            "SELECT * FROM decision_event WHERE project_key=? ORDER BY created_at,id", (project_key,))
        return {
            "goals": goals, "claims": claims, "evidence": evidence, "entities": entities,
            "edges": edges, "origins": origins, "decisions": decisions,
        }

    @staticmethod
    def _desired_context_is_covered(previous: dict, committed: dict) -> bool:
        for key in (
            "projectKey", "autonomyMode", "goalVersion", "policyVersion",
            "decisionVersion", "compilerVersion",
        ):
            if previous.get(key) != committed.get(key):
                return False
        if previous.get("capturedScope") != committed.get("capturedScope"):
            return False
        committed_snapshots = {
            item["threadId"]: item
            for item in committed.get("evidenceSnapshots", [])
        }
        for prior in previous.get("evidenceSnapshots", []):
            current = committed_snapshots.get(prior["threadId"])
            if current is None or int(current["version"]) < int(prior["version"]):
                return False
            if (
                int(current["version"]) == int(prior["version"])
                and current["digest"] != prior["digest"]
            ):
                return False
        return True

    def _mark_covered_receipts(self, project_key: str, committed_context: dict,
                               snapshot_digest: str, timestamp: str) -> None:
        for receipt in self.store.q(
                "SELECT job_id,request_version,desired_context"
                " FROM project_update_receipt WHERE project_key=? AND state='superseded'",
                (project_key,)):
            previous = _loads(receipt["desired_context"], {})
            if not self._desired_context_is_covered(previous, committed_context):
                continue
            self.store.x(
                "UPDATE project_update_receipt SET state='covered',"
                "committed_snapshot_digest=?,last_error=NULL,updated_at=?"
                " WHERE job_id=? AND request_version=? AND state='superseded'",
                (snapshot_digest, timestamp, receipt["job_id"], receipt["request_version"]),
            )

    def _commit_project_snapshot(self, project_key: str, vector: list[dict], scope: dict,
                                 compile_result: dict, autonomy_mode: str, *,
                                 job_id: str, request_version: int,
                                 desired_fingerprint: str) -> dict:
        committed_context, committed_fingerprint = self._desired_identity(
            project_key, vector, scope, autonomy_mode)
        if committed_fingerprint != desired_fingerprint:
            raise RuntimeError(
                "desired Project inputs changed after this update generation was accepted")
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
            "capturedScope": scope,
            "compilerVersion": COMPILER_VERSION,
            "createdAt": created_at,
            "status": "committed",
            "autonomyMode": autonomy_mode,
            "graph": review_result["graph"],
            "compileDiff": compile_result["diff"],
            "humanReview": human_review_summary,
            "updateReceipt": {
                "jobId": job_id,
                "acceptedRequestVersion": request_version,
                "desiredFingerprint": desired_fingerprint,
            },
            "scopeRevision": (self.store.q1(
                "SELECT MAX(revision) AS revision FROM project_scope_revision WHERE project_key=?",
                (project_key,)) or {}).get("revision"),
            "inputFingerprint": desired_fingerprint,
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
                "status,payload,scope_revision,input_fingerprint) VALUES (?,?,?,?,?,?,?,?,?,?,'committed',?,?,?)",
                (project_key, version, payload["digest"], payload["goalVersion"],
                 payload["policyVersion"],
                 canonical_json(vector), canonical_json(scope["excludedSessions"]),
                 canonical_json(scope["isolatedSessions"]), COMPILER_VERSION, created_at,
                 canonical_json(payload),
                 (self.store.q1("SELECT MAX(revision) AS revision FROM project_scope_revision WHERE project_key=?",
                                (project_key,)) or {}).get("revision"),
                 desired_fingerprint),
            )
            self.store.x(
                "UPDATE project_invalidation SET applied_fingerprint=?,stale=0,reason=NULL,"
                "changed_fields='[]',updated_at=? WHERE project_key=?",
                (desired_fingerprint, created_at, project_key),
            )
            updated = self.store.conn.execute(
                "UPDATE project_update_receipt SET state='committed',"
                "committed_snapshot_digest=?,last_error=NULL,updated_at=?"
                " WHERE job_id=? AND request_version=? AND desired_fingerprint=?"
                " AND state='running'",
                (payload["digest"], created_at, job_id, request_version,
                 desired_fingerprint),
            ).rowcount
            if updated != 1:
                raise RuntimeError(
                    f"Project update {job_id} generation {request_version}"
                    " lost its durable receipt before commit")
            self._mark_covered_receipts(
                project_key, committed_context, payload["digest"], created_at)
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
            self.store.x("BEGIN IMMEDIATE")
            try:
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
                    self.store.conn.rollback()
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
                    self.store.conn.rollback()
                    return None
                latest = self.latest_snapshot(job["project_key"])
                policy_row = self.store.q1(
                    "SELECT * FROM project_policy WHERE project_key=?",
                    (job["project_key"],),
                )
                if policy_row is None:
                    raise RuntimeError(
                        f"Project policy is missing for {job['project_key']}")
                policy = self._present_policy(policy_row)
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
            except Exception:
                self.store.conn.rollback()
                raise

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
        self.store.x(
            "INSERT INTO finding_event (id,project_key,finding_id,event_type,actor,payload,created_at)"
            " VALUES (?,?,?,?,?,?,?)",
            (new_id("finding-event"), project_key, finding_id, "FindingOpened", "project-auditor",
             canonical_json({"status": status, "severity": severity, "targetDigest": target_digest}), now_iso()),
        )
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
            self._append_review_event(finding["project_key"], existing["id"],
                                      "ReviewCandidateRefreshed", "project-review-policy", {
                                          "findingId": finding["id"], "checkpoint": checkpoint,
                                      })
            return existing["id"]
        review_id = new_id("review")
        self.store.x(
            "INSERT INTO review (id,project_key,finding_id,subject_id,review_type,"
            "checkpoint,status,payload,created_at) VALUES (?,?,?,?,?,?,'open',?,?)",
            (review_id, finding["project_key"], finding["id"], finding["subject_id"],
             finding["finding_type"], checkpoint, canonical_json(payload), now_iso()),
        )
        self._append_review_event(finding["project_key"], review_id, "ReviewCandidateCreated",
                                  "project-review-policy", {
                                      "findingId": finding["id"], "checkpoint": checkpoint,
                                  })
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
        self._append_finding_event(finding["project_key"], finding["id"],
                                   "FindingDispositionRecorded", actor_id, {
                                       "status": status, "decisionId": decision_id,
                                       "action": action,
                                   })
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
            self._append_review_event(finding["project_key"], review_id,
                                      "ReviewDispositionRecorded", actor_id, {
                                          "status": review_status, "decisionId": decision_id,
                                          "action": action,
                                      })
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
                        supersedes_id: Optional[str] = None,
                        action_class: str = "draft_internal_reversible",
                        target: str = "",
                        policy_ref: str = DECISION_POLICY_V1) -> dict:
        mode = validate_autonomy_mode(autonomy_mode)
        if action not in DECISION_ACTIONS:
            raise ValueError(f"invalid decision action: {action}")
        if action_class not in DECISION_ACTION_CLASSES:
            raise ValueError(f"invalid decision action class: {action_class}")
        if decided_by not in {"agent", "human", "tool"}:
            raise ValueError("decidedBy must be agent, human or tool")
        if not rationale.strip() or not actor_id.strip() or not reversibility.strip():
            raise ValueError("actorId, rationale and reversibility are required")
        policy = self.policy(project_key)
        rule = policy["decisionRules"][action_class]
        if decided_by == "agent" and not rule["agentOnly"] and action_class in {
                "certified_internal", "public_external", "specialized_high_impact"}:
            raise ValueError("this action class requires accountable human governance")
        if action_class == "specialized_high_impact" and not rule.get("trustedRoleSource"):
            raise ValueError("specialized_high_impact is blocked_by_policy: trusted role source unavailable")
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
                action_class=action_class, target=target.strip(), policy_ref=policy_ref,
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
            self.store.x(
                "INSERT INTO review_event (id,project_key,review_id,event_type,actor,payload,created_at)"
                " VALUES (?,?,?,?,?,?,?)",
                (new_id("review-event"), project_key, review_id or "project",
                 "ReviewDecisionRecorded", actor_id,
                 canonical_json({"decisionId": decision_id, "snapshot": evidence_digest}), now_iso()),
            ) if review_id else None
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
                             supersedes_id: Optional[str], action_class: str = "draft_internal_reversible",
                             target: str = "", policy_ref: str = DECISION_POLICY_V1) -> str:
        decision_id = new_id("decision")
        self.store.x(
            "INSERT INTO decision_event (id,project_key,review_id,finding_id,action,decided_by,agent_id,"
            "autonomy_mode,rationale,alternatives,evidence_digest,confidence,reversibility,"
            "supersedes_id,action_class,target,policy_ref,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (decision_id, project_key, review_id, finding_id, action, decided_by, actor_id,
             autonomy_mode, rationale, canonical_json(alternatives), evidence_digest,
             max(0.0, min(1.0, float(confidence))), reversibility, supersedes_id,
             action_class, target, policy_ref, now_iso()),
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

    def record_approval(self, *, project_key: str, decision_id: str,
                        attestor: str, attestation: str,
                        trusted_role_assertion_ref: Optional[str] = None,
                        expires_at: Optional[str] = None,
                        revokes_approval_id: Optional[str] = None,
                        policy_ref: str = DECISION_POLICY_V1) -> dict:
        """Append an ApprovalV1 bound to one exact Decision and Snapshot."""
        if not attestor.strip() or not attestation.strip():
            raise ValueError("attestor and attestation are required")
        if attestor.lower().startswith("agent") or attestor.lower().startswith("tool"):
            raise ValueError("an Agent cannot occupy the accountable-human approval role")
        decision = self.store.q1("SELECT * FROM decision_event WHERE id=?", (decision_id,))
        if decision is None or decision["project_key"] != project_key:
            raise KeyError(decision_id)
        snapshot = self.snapshot(decision["evidence_digest"])
        if snapshot is None or snapshot["projectKey"] != project_key:
            raise ValueError("Approval requires an exact Project Snapshot")
        if revokes_approval_id:
            prior = self.store.q1("SELECT * FROM approval_record WHERE id=?", (revokes_approval_id,))
            if prior is None or prior["project_key"] != project_key:
                raise KeyError(revokes_approval_id)
        approval_id = new_id("approval")
        now = now_iso()
        self.store.x(
            "INSERT INTO approval_record"
            " (id,project_key,decision_id,project_snapshot_digest,attestor,"
            "trusted_role_assertion_ref,attestation,policy_ref,created_at,expires_at,revokes_approval_id)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (approval_id, project_key, decision_id, snapshot["digest"], attestor.strip(),
             trusted_role_assertion_ref, attestation.strip(), policy_ref, now, expires_at,
             revokes_approval_id),
        )
        self._event(project_key, "ApprovalRecorded", attestor, {
            "approvalId": approval_id, "decisionId": decision_id,
            "projectSnapshot": snapshot["digest"], "policyRef": policy_ref,
        })
        self.store.conn.commit()
        return self.approval(approval_id) or {}

    def approval(self, approval_id: str) -> Optional[dict]:
        row = self.store.q1("SELECT * FROM approval_record WHERE id=?", (approval_id,))
        if row is None:
            return None
        row.update({
            "approvalId": row.pop("id"), "decisionRef": row.pop("decision_id"),
            "projectSnapshot": row.pop("project_snapshot_digest"),
            "trustedRoleAssertionRef": row.pop("trusted_role_assertion_ref"),
            "policyRef": row.pop("policy_ref"), "createdAt": row.pop("created_at"),
            "expiresAt": row.pop("expires_at"), "revokesApprovalId": row.pop("revokes_approval_id"),
        })
        revoked = self.store.q1(
            "SELECT 1 FROM approval_record WHERE revokes_approval_id=?", (row["approvalId"],))
        expired = bool(row.get("expiresAt") and row["expiresAt"] <= now_iso())
        latest = self.latest_snapshot(row["project_key"])
        if latest is None or latest["digest"] != row["projectSnapshot"]:
            # An approval is a scoped attestation, never a reusable permission.
            # A newer Project input expires it without rewriting its record.
            expired = True
        row["status"] = "revoked" if revoked else "expired" if expired else "effective"
        return row

    def approvals(self, project_key: str, snapshot_digest: Optional[str] = None) -> list[dict]:
        sql = "SELECT id FROM approval_record WHERE project_key=?"
        args: list[Any] = [project_key]
        if snapshot_digest:
            sql += " AND project_snapshot_digest=?"; args.append(snapshot_digest)
        return [item for row in self.store.q(sql + " ORDER BY created_at", args)
                if (item := self.approval(row["id"])) is not None]

    def create_release(self, *, project_key: str, project_snapshot_digest: str,
                       audit_digest: str, created_by: str,
                       output_artifacts: list[dict], requested_status: str = "candidate",
                       runtime_authorization: Optional[dict] = None,
                       external_action: bool = False,
                       target: str = "", classification: str = "internal",
                       decision_refs: Optional[list[str]] = None,
                       approval_refs: Optional[list[str]] = None,
                       expected_head_digest: Optional[str] = None,
                       action_class: Optional[str] = None) -> dict:
        if requested_status not in {"candidate", "certified"}:
            raise ValueError("requestedStatus must be candidate or certified")
        snapshot = self.snapshot(project_snapshot_digest)
        if snapshot is None or snapshot["projectKey"] != project_key:
            raise KeyError(project_snapshot_digest)
        if expected_head_digest is not None and expected_head_digest != project_snapshot_digest:
            raise ValueError("Project Snapshot head changed; reload before release")
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
            if requested_status == "certified" or classification == "public":
                required_runtime = {
                    "principalId", "purpose", "consentRevision", "aclRevision", "target",
                }
                missing_runtime = sorted(key for key in required_runtime if not auth.get(key))
                if missing_runtime:
                    raise PermissionError(
                        "Runtime authorization is missing current exact fields: "
                        + ", ".join(missing_runtime))
                if target and auth.get("target") != target:
                    raise PermissionError("Runtime authorization target does not match release target")
        policy = self.policy(project_key)
        if not isinstance(output_artifacts, list) or any(
                not isinstance(item, dict) for item in output_artifacts):
            raise ValueError("outputArtifacts must be typed Artifact Version references")
        for artifact in output_artifacts:
            if not any(isinstance(artifact.get(key), str) and artifact[key].strip()
                       for key in ("artifactVersionId", "versionId")):
                raise ValueError("each output Artifact must identify an exact Version")
            if not isinstance(artifact.get("contentDigest"), str) \
                    or not artifact["contentDigest"].startswith("sha256:"):
                raise ValueError("each output Artifact must include its exact content digest")
            if any(str(artifact.get(key, "")).lower() in {"latest", "current"}
                   for key in ("artifactVersionId", "versionId")):
                raise ValueError("output Artifact refs cannot use latest or current")
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
        decision_refs = list(decision_refs or [])
        approval_refs = list(approval_refs or [])
        decisions = []
        for ref in decision_refs:
            decision = self.decision(ref)
            if decision is None or decision.get("project_key") != project_key \
                    or decision.get("projectSnapshot") != project_snapshot_digest:
                raise ValueError("Release decisions must bind the exact Project Snapshot")
            decisions.append(decision)
        if classification not in {"internal", "certified", "public"}:
            raise ValueError("classification must be internal, certified or public")
        action_classes = {item.get("actionClass", "draft_internal_reversible") for item in decisions}
        required_class = "public_external" if classification == "public" else (
            "certified_internal" if requested_status == "certified" else None)
        if required_class:
            action_classes.add(required_class)
        selected_action_class = action_class or (
            "public_external" if classification == "public" else
            "certified_internal" if requested_status == "certified" else None)
        if selected_action_class:
            if selected_action_class not in DECISION_ACTION_CLASSES:
                raise ValueError("invalid release action class")
            action_classes.add(selected_action_class)
        if "specialized_high_impact" in action_classes:
            specialized = policy["decisionRules"]["specialized_high_impact"]
            if not specialized.get("trustedRoleSource") or not specialized.get("requiredRoles"):
                policy_block = True
            else:
                policy_block = False
        else:
            policy_block = False
        approvals = [self.approval(ref) for ref in approval_refs]
        if any(item is None or item.get("projectSnapshot") != project_snapshot_digest
               or item.get("status") != "effective" for item in approvals):
            raise ValueError("Release approvals must bind the exact Project Snapshot")
        if requested_status == "certified" and not approval_refs:
            approval_refs = [item["approvalId"] for item in self.approvals(
                project_key, project_snapshot_digest)
                if item.get("status") == "effective"
                and not str(item.get("attestor", "")).lower().startswith("agent")]
        if requested_status == "certified":
            rule = policy["decisionRules"][selected_action_class or required_class or "certified_internal"]
            human_approvals = [item for item in self.approvals(
                project_key, project_snapshot_digest)
                if item.get("status") == "effective"
                and not str(item.get("attestor", "")).lower().startswith(("agent", "tool"))]
            if len({item["approvalId"] for item in human_approvals
                    if item["approvalId"] in approval_refs}) < int(rule.get("quorum", 1)):
                policy_block = True
        gates_pass = not critical and pending is None and not blocking_review_packets
        certification = requested_status
        if requested_status == "certified" and (not gates_pass or not approval_refs or policy_block):
            certification = "blocked"
        release_id = new_id("release")
        self.store.x(
            "INSERT INTO release_record (id,project_key,project_snapshot_digest,evidence_vector,"
            "audit_run_digest,policy_version,critical_findings,overrides,created_by,created_at,"
            "output_artifacts,certification_status,classification,target,attempt_outcome,"
            "audit_refs,decision_refs,approval_refs) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (release_id, project_key, project_snapshot_digest,
             canonical_json(snapshot["evidenceVector"]), audit_digest, policy["policy_version"],
             canonical_json([f["id"] for f in critical]),
             canonical_json([o["id"] for o in overrides]), created_by, now_iso(),
             canonical_json(output_artifacts), certification, classification, target,
             "accepted" if certification != "blocked" else "blocked_by_policy",
             canonical_json([audit_digest]), canonical_json(decision_refs), canonical_json(approval_refs)),
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
            self._append_review_event(project_key, row["id"], "ReviewExpired",
                                      "project-review-policy", {
                                          "snapshotDigest": snapshot_digest,
                                      })
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
            self._append_review_event(project_key, packet["id"],
                                      "ReviewPacketRefreshed", "project-review-policy", {
                                          "snapshotDigest": snapshot_digest,
                                      })
            return
        persisted = {**packet, "snapshotDigest": snapshot_digest}
        self.store.x(
            "INSERT INTO review (id,project_key,subject_id,review_type,checkpoint,status,payload,"
            "created_at) VALUES (?,?,?,'human_review_packet',?,'open',?,?)",
            (packet["id"], project_key, packet["id"],
             "human" if packet["blocking"] else "human_recommended",
            canonical_json(persisted), timestamp),
        )
        self._append_review_event(project_key, packet["id"], "ReviewPacketCreated",
                                  "project-review-policy", {
                                      "snapshotDigest": snapshot_digest,
                                      "status": packet.get("status"),
                                  })
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
        approval = None
        if action == "approve":
            approval = self.record_approval(
                project_key=project_key, decision_id=decision_id, attestor=actor_id,
                attestation=rationale, policy_ref=DECISION_POLICY_V1,
            )
        payload.update({
            "status": review_status, "updatedAt": timestamp,
            "humanResult": {"action": action, "decisionId": decision_id,
                            "actorId": actor_id, "rationale": rationale,
                            "recordedAt": timestamp,
                            **({"approvalId": approval["approvalId"]} if approval else {})},
        })
        if review_status != "pending":
            payload["completedAt"] = timestamp
        self.store.x(
            "UPDATE review SET status=?,payload=?,resolved_at=? WHERE id=?",
            (db_status, canonical_json(payload),
             timestamp if db_status != "open" else None, packet_id),
        )
        self._append_review_event(project_key, packet_id, "ReviewDecisionRecorded", actor_id, {
            "status": review_status, "decisionId": decision_id, "action": action,
            "snapshotDigest": digest,
        })
        self._event(project_key, "HumanReviewResultRecorded", actor_id, {
            "reviewPacketId": packet_id, "decisionId": decision_id,
            "action": action, "snapshotDigest": digest,
        })
        self.store.conn.commit()
        return payload

    # --------------------------------------------------------------- queries
    def receipt_status(self, job_id: str, accepted_request_version: int,
                       desired_fingerprint: str) -> dict:
        row = self.store.q1(
            "SELECT * FROM project_update_receipt"
            " WHERE job_id=? AND request_version=?",
            (job_id, int(accepted_request_version)),
        )
        if row is None:
            raise KeyError(
                f"{job_id}:{accepted_request_version}")
        if row["desired_fingerprint"] != desired_fingerprint:
            raise ValueError("desiredFingerprint does not match the accepted Project update")
        job = self.store.q1(
            "SELECT status,request_version,attempts,next_attempt_at"
            " FROM project_update_job WHERE id=?", (job_id,))
        is_current = (
            job is not None
            and int(job["request_version"]) == int(accepted_request_version)
        )
        return {
            "jobId": row["job_id"],
            "acceptedRequestVersion": int(row["request_version"]),
            "projectKey": row["project_key"],
            "desiredFingerprint": row["desired_fingerprint"],
            "state": row["state"],
            "desiredEvidenceVector": _loads(row["desired_vector"], []),
            "capturedScope": _loads(row["captured_scope"], {}),
            "committedSnapshotDigest": row["committed_snapshot_digest"],
            "lastError": row["last_error"],
            "acceptedAt": row["accepted_at"],
            "updatedAt": row["updated_at"],
            "attempts": int(job["attempts"]) if is_current else None,
            "retryScheduled": bool(
                is_current and job["status"] == "retry_scheduled"),
            "nextAttemptAt": job["next_attempt_at"] if is_current else None,
        }

    def job(self, job_id: str) -> Optional[dict]:
        row = self.store.q1("SELECT * FROM project_update_job WHERE id=?", (job_id,))
        if row:
            row["desiredEvidenceVector"] = _loads(row.pop("desired_vector"), [])
            row["capturedScope"] = _loads(row.pop("captured_scope"), {})
        return row

    def status(self, project_key: str) -> dict:
        recent_snapshots = self.store.q(
            "SELECT * FROM project_snapshot WHERE project_key=? ORDER BY version DESC LIMIT 2",
            (project_key,),
        )
        jobs = self.store.q(
            "SELECT id,status,reason,priority,request_version,desired_fingerprint,"
            "attempts,last_error,next_attempt_at,updated_at"
            " FROM project_update_job WHERE project_key=? ORDER BY updated_at DESC LIMIT 20",
            (project_key,),
        )
        snapshot = (
            validate_project_snapshot_row(recent_snapshots[0])
            if recent_snapshots else None
        )
        previous_snapshot = (
            validate_project_snapshot_row(recent_snapshots[1])
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
        latest_receipt_row = self.store.q1(
            "SELECT job_id,request_version,desired_fingerprint"
            " FROM project_update_receipt WHERE project_key=?"
            " ORDER BY accepted_at DESC,rowid DESC LIMIT 1",
            (project_key,),
        )
        latest_receipt = (
            self.receipt_status(
                latest_receipt_row["job_id"], latest_receipt_row["request_version"],
                latest_receipt_row["desired_fingerprint"])
            if latest_receipt_row else None
        )
        active_states = {"queued", "running", "retry_scheduled", "failed"}
        active = next((
            job for job in jobs
            if latest_receipt
            and job["id"] == latest_receipt["jobId"]
            and int(job["request_version"])
            == int(latest_receipt["acceptedRequestVersion"])
            and job["status"] in active_states
            and latest_receipt["state"] in active_states
        ), None)
        invalidation = self.invalidation(project_key)
        derived_state = ("updating" if active and active["status"] == "running" else
                         "retry_scheduled" if active and active["status"] == "retry_scheduled" else
                         "update_failed" if active and active["status"] == "failed" else
                         "pending" if active else
                         "stale" if invalidation and invalidation.get("stale") else
                         "fresh" if snapshot else "empty")
        return {
            "projectKey": project_key,
            "state": derived_state,
            "committedSnapshot": snapshot,
            "previousCommittedSnapshot": previous_snapshot,
            "desiredEvidenceVector": (self.job(active["id"])["desiredEvidenceVector"]
                                      if active else snapshot["evidenceVector"] if snapshot else []),
            "pending": int(bool(
                active and active["status"] in
                {"queued", "running", "retry_scheduled"})),
            "jobs": jobs,
            "latestReceipt": latest_receipt,
            "activeReceipt": latest_receipt if active else None,
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
            "invalidation": self.invalidation(project_key),
            "scopeRevisions": self.scope_revisions(project_key),
        }

    def snapshot(self, digest: str) -> Optional[dict]:
        row = self.store.q1("SELECT * FROM project_snapshot WHERE digest=?", (digest,))
        return validate_project_snapshot_row(row) if row else None

    def latest_snapshot(self, project_key: str) -> Optional[dict]:
        row = self.store.q1(
            "SELECT * FROM project_snapshot WHERE project_key=? ORDER BY version DESC LIMIT 1",
            (project_key,),
        )
        return validate_project_snapshot_row(row) if row else None

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
            row["decisionId"] = row["id"]
            row["projectSnapshot"] = row["evidence_digest"]
            row["actionClass"] = row.get("action_class", "draft_internal_reversible")
            row["actor"] = {
                "type": row["decided_by"], "id": row["agent_id"],
            }
            row["policyRef"] = row.get("policy_ref", DECISION_POLICY_V1)
            row["target"] = row.get("target", "")
            row["supersedesDecisionId"] = row["supersedes_id"]
        return row

    def release(self, release_id: str) -> Optional[dict]:
        row = self.store.q1("SELECT * FROM release_record WHERE id=?", (release_id,))
        if row:
            for key in ("evidence_vector", "critical_findings", "overrides", "output_artifacts",
                        "audit_refs", "decision_refs", "approval_refs"):
                row[key] = _loads(row[key], [])
            row["releaseId"] = row["id"]
            row["projectSnapshot"] = row["project_snapshot_digest"]
            row["classification"] = row.get("classification", "internal")
            row["target"] = row.get("target", "")
            row["attemptOutcome"] = row.get("attempt_outcome", "accepted")
            row["auditRefs"] = row.get("audit_refs", [])
            row["decisionRefs"] = row.get("decision_refs", [])
            row["approvalRefs"] = row.get("approval_refs", [])
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

    def _append_finding_event(self, project_key: str, finding_id: str,
                              event_type: str, actor: str, payload: dict) -> str:
        event_id = new_id("finding-event")
        self.store.x(
            "INSERT INTO finding_event (id,project_key,finding_id,event_type,actor,payload,created_at)"
            " VALUES (?,?,?,?,?,?,?)",
            (event_id, project_key, finding_id, event_type, actor,
             canonical_json(payload), now_iso()),
        )
        return event_id

    def _append_review_event(self, project_key: str, review_id: str,
                             event_type: str, actor: str, payload: dict) -> str:
        event_id = new_id("review-event")
        self.store.x(
            "INSERT INTO review_event (id,project_key,review_id,event_type,actor,payload,created_at)"
            " VALUES (?,?,?,?,?,?,?)",
            (event_id, project_key, review_id, event_type, actor,
             canonical_json(payload), now_iso()),
        )
        return event_id
