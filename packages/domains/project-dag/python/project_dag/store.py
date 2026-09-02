"""SQLite storage for the project DAG.

Invariants (the whole audit story rests on these):
  * Claim/evidence history is append-only. Invalidation closes a validity
    window by setting `t_invalid`.
  * Goals are versioned, never edited in place.
  * The watermark is a per-session (thread) content hash + the set of
    node ids already promoted — evidence-dag node ids are content-addressed,
    so "history was rewritten" shows up as ids vanishing, not seq gaps.
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import threading
import time
import uuid
from typing import Any, Iterable, Optional

PROJECT_UPDATE_RECEIPT_SCHEMA = """
CREATE TABLE IF NOT EXISTS project_update_receipt (
  job_id                    TEXT NOT NULL,
  request_version           INTEGER NOT NULL,
  project_key               TEXT NOT NULL,
  desired_fingerprint       TEXT NOT NULL,
  desired_context           TEXT NOT NULL,
  desired_vector            TEXT NOT NULL,
  captured_scope            TEXT NOT NULL,
  state                     TEXT NOT NULL
                            CHECK(state IN
                            ('queued','running','committed','covered',
                             'superseded','failed')),
  committed_snapshot_digest TEXT,
  last_error                TEXT,
  accepted_at               TEXT NOT NULL,
  updated_at                TEXT NOT NULL,
  PRIMARY KEY(job_id, request_version),
  UNIQUE(job_id, request_version, desired_fingerprint),
  FOREIGN KEY(job_id) REFERENCES project_update_job(id)
);
CREATE INDEX IF NOT EXISTS idx_project_receipt_project
  ON project_update_receipt(project_key, accepted_at DESC);
"""

SCHEMA = """
CREATE TABLE IF NOT EXISTS project_schema (
  version INTEGER PRIMARY KEY CHECK(version=3)
);
INSERT OR IGNORE INTO project_schema(version) VALUES (3);

CREATE TABLE IF NOT EXISTS goal (
  id          TEXT PRIMARY KEY,
  root_id     TEXT NOT NULL,            -- stable identity across versions
  parent_id   TEXT,                     -- root_id of parent goal
  title       TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'open'
              CHECK(status IN ('open','achieved','at_risk','blocked','abandoned')),
  version     INTEGER NOT NULL DEFAULT 1,
  project_key TEXT,
  t_created   TEXT NOT NULL,
  t_expired   TEXT                      -- non-null: replaced by a newer version
);
CREATE INDEX IF NOT EXISTS idx_goal_project_key ON goal(project_key);

CREATE TABLE IF NOT EXISTS entity (
  id             TEXT PRIMARY KEY,
  project_key    TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  entity_type    TEXT,
  aliases        TEXT NOT NULL DEFAULT '[]',   -- JSON array
  provisional    INTEGER NOT NULL DEFAULT 0,   -- awaiting a merge review
  merged_into    TEXT,                          -- non-null: absorbed by that entity
  merged_from    TEXT NOT NULL DEFAULT '[]',   -- JSON array (audit trail)
  t_created      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entity_project ON entity(project_key, merged_into);

CREATE TABLE IF NOT EXISTS claim (
  id            TEXT PRIMARY KEY,
  project_key   TEXT NOT NULL,
  statement     TEXT NOT NULL,
  claim_type    TEXT CHECK(claim_type IN
                ('hypothesis','finding','method_result','negative_result','decision','conclusion')),
  status        TEXT NOT NULL DEFAULT 'supported' CHECK(status IN
                ('supported','conflicted','invalidated','fragile','undetermined')),
  confidence    REAL,
  goal_id       TEXT,                    -- root_id of the goal it addresses
  t_valid       TEXT NOT NULL,
  t_invalid     TEXT,
  t_created     TEXT NOT NULL,
  load_bearing  REAL NOT NULL DEFAULT 0,
  blast_radius  INTEGER NOT NULL DEFAULT 0,
  needs_regoal  INTEGER NOT NULL DEFAULT 0  -- goal changed under it; re-check next compile
);

CREATE TABLE IF NOT EXISTS evidence (
  id            TEXT PRIMARY KEY,
  project_key   TEXT NOT NULL,
  thread_id     TEXT NOT NULL,
  snapshot_digest TEXT NOT NULL,
  node_id       TEXT NOT NULL,
  node_type     TEXT NOT NULL CHECK(length(trim(node_type)) > 0),
  UNIQUE(project_key,thread_id,snapshot_digest,node_id)
);
CREATE INDEX IF NOT EXISTS idx_evidence_ref
  ON evidence(project_key,thread_id,snapshot_digest,node_id);

CREATE TABLE IF NOT EXISTS edge (
  id        TEXT PRIMARY KEY,
  src       TEXT NOT NULL,
  dst       TEXT NOT NULL,
  edge_type TEXT NOT NULL CHECK(edge_type IN (
    'decomposes_to','addresses','supports','contradicts','derived_from',
    'same_as','mentions','replicates','fails_to_replicate','rerun_of')),
  t_valid   TEXT NOT NULL,
  t_invalid TEXT,
  meta      TEXT                          -- JSON: adjudication reason, confidence...
);
CREATE INDEX IF NOT EXISTS idx_edge_src ON edge(src, edge_type);
CREATE INDEX IF NOT EXISTS idx_edge_dst ON edge(dst, edge_type);

-- which session node a claim was promoted from (rewrite detection + provenance)
CREATE TABLE IF NOT EXISTS claim_origin (
  claim_id   TEXT NOT NULL,
  project_key TEXT NOT NULL,
  session_id TEXT NOT NULL,
  node_id    TEXT NOT NULL,
  run_id     TEXT,
  PRIMARY KEY (project_key, claim_id, session_id, node_id)
);
CREATE INDEX IF NOT EXISTS idx_origin_node ON claim_origin(session_id, node_id);

CREATE TABLE IF NOT EXISTS watermark (
  project_key   TEXT NOT NULL,
  session_id    TEXT NOT NULL,
  dag_hash      TEXT NOT NULL,
  processed_ids TEXT NOT NULL DEFAULT '[]',  -- JSON array of node ids already seen
  updated_at    TEXT,
  PRIMARY KEY(project_key, session_id)
);

CREATE TABLE IF NOT EXISTS compile_run (
  id          TEXT PRIMARY KEY,
  trigger     TEXT CHECK(trigger IN ('scheduled','manual')),
  scope       TEXT,
  started_at  TEXT,
  finished_at TEXT,
  status      TEXT NOT NULL DEFAULT 'running'
              CHECK(status IN ('running','done','failed','interrupted')),
  stats       TEXT,
  diff        TEXT
);

-- llm_judge response cache: same task + payload hash -> same answer, replayable
CREATE TABLE IF NOT EXISTS judge_cache (
  key        TEXT PRIMARY KEY,
  task_type  TEXT NOT NULL,
  response   TEXT NOT NULL,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS project_policy (
  project_key        TEXT PRIMARY KEY,
  autonomy_mode      TEXT NOT NULL DEFAULT 'checkpointed'
                     CHECK(autonomy_mode IN ('autonomous','checkpointed','supervised')),
  policy_version     INTEGER NOT NULL DEFAULT 1,
  checkpoints        TEXT NOT NULL DEFAULT '[]',
  allow_agent_critical_override INTEGER NOT NULL DEFAULT 0,
  min_literature_level TEXT NOT NULL DEFAULT 'L2',
  min_run_level      TEXT NOT NULL DEFAULT 'L4',
  decision_rules     TEXT NOT NULL DEFAULT '{}',
  updated_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_scope (
  project_key  TEXT NOT NULL,
  session_id   TEXT NOT NULL,
  disposition  TEXT NOT NULL CHECK(disposition IN ('included','excluded','isolated')),
  reason       TEXT NOT NULL DEFAULT '',
  updated_at   TEXT NOT NULL,
  PRIMARY KEY(project_key, session_id)
);

-- Stage 4 keeps the desired Scope as an explicit immutable revision. The
-- materialized project_scope rows are only the current applied membership;
-- historical revisions preserve why a Session was included/excluded/isolated.
CREATE TABLE IF NOT EXISTS project_scope_revision (
  project_key   TEXT NOT NULL,
  revision      INTEGER NOT NULL,
  included_sessions TEXT NOT NULL,
  excluded_sessions TEXT NOT NULL,
  isolated_sessions TEXT NOT NULL,
  reasons       TEXT NOT NULL DEFAULT '{}',
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY(project_key, revision)
);

CREATE TABLE IF NOT EXISTS project_goal_draft (
  project_key TEXT PRIMARY KEY,
  root_goal_id TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  base_version INTEGER,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_scope_draft (
  project_key       TEXT PRIMARY KEY,
  included_sessions TEXT NOT NULL,
  excluded_sessions TEXT NOT NULL,
  isolated_sessions TEXT NOT NULL,
  reasons           TEXT NOT NULL DEFAULT '{}',
  base_revision     INTEGER,
  updated_by        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_invalidation (
  project_key TEXT PRIMARY KEY,
  desired_fingerprint TEXT,
  applied_fingerprint TEXT,
  stale INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  changed_fields TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approval_record (
  id TEXT PRIMARY KEY,
  project_key TEXT NOT NULL,
  decision_id TEXT NOT NULL,
  project_snapshot_digest TEXT NOT NULL,
  attestor TEXT NOT NULL,
  trusted_role_assertion_ref TEXT,
  attestation TEXT NOT NULL,
  policy_ref TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  revokes_approval_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_approval_snapshot
  ON approval_record(project_key,project_snapshot_digest,created_at);

CREATE TABLE IF NOT EXISTS finding_event (
  id TEXT PRIMARY KEY,
  project_key TEXT NOT NULL,
  finding_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_event (
  id TEXT PRIMARY KEY,
  project_key TEXT NOT NULL,
  review_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- One durable, coalescing compiler lane per project.  While a job is running,
-- enqueue only advances request_version and desired inputs; the worker commits
-- its captured generation and requeues the row if a newer generation arrived.
CREATE TABLE IF NOT EXISTS project_update_job (
  id                 TEXT PRIMARY KEY,
  project_key        TEXT NOT NULL,
  desired_vector     TEXT NOT NULL,
  captured_scope     TEXT NOT NULL,
  reason             TEXT NOT NULL,
  priority           INTEGER NOT NULL DEFAULT 0,
  autonomy_mode      TEXT NOT NULL,
  desired_fingerprint TEXT NOT NULL,
  request_version    INTEGER NOT NULL DEFAULT 1,
  processing_version INTEGER,
  status             TEXT NOT NULL DEFAULT 'queued'
  CHECK(status IN
                     ('queued','running','retry_scheduled','succeeded','failed')),
  attempts           INTEGER NOT NULL DEFAULT 0,
  last_error         TEXT,
  next_attempt_at    TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  started_at         TEXT,
  finished_at        TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_job_open
  ON project_update_job(project_key)
  WHERE status IN ('queued','running','retry_scheduled','failed');

-- A receipt is the durable client contract for one accepted generation.  The
-- coalescing lane may move on, but the accepted identity and its exact outcome
-- remain queryable without inferring completion from global queue idleness.
""" + PROJECT_UPDATE_RECEIPT_SCHEMA + """
CREATE TABLE IF NOT EXISTS project_snapshot (
  project_key       TEXT NOT NULL,
  version           INTEGER NOT NULL,
  digest            TEXT NOT NULL UNIQUE,
  goal_version      TEXT NOT NULL,
  policy_version    INTEGER NOT NULL,
  evidence_vector   TEXT NOT NULL,
  excluded_sessions TEXT NOT NULL,
  isolated_sessions TEXT NOT NULL,
  compiler_version  TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  status            TEXT NOT NULL CHECK(status='committed'),
  payload           TEXT NOT NULL,
  scope_revision    INTEGER,
  input_fingerprint TEXT,
  PRIMARY KEY(project_key, version)
);

CREATE TABLE IF NOT EXISTS project_snapshot_seal (
  project_key       TEXT NOT NULL,
  snapshot_digest   TEXT NOT NULL,
  reason            TEXT NOT NULL,
  sealed_by         TEXT NOT NULL,
  sealed_at         TEXT NOT NULL,
  PRIMARY KEY(project_key, snapshot_digest)
);

CREATE TABLE IF NOT EXISTS domain_event (
  id          TEXT PRIMARY KEY,
  event_type  TEXT NOT NULL,
  project_key TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  actor       TEXT NOT NULL,
  payload     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assessment (
  id            TEXT PRIMARY KEY,
  project_key   TEXT NOT NULL,
  target_id     TEXT NOT NULL,
  dimension     TEXT NOT NULL CHECK(dimension IN
                  ('integrity','provenance','entailment','methodology',
                   'applicability','reproducibility')),
  level         TEXT NOT NULL CHECK(level IN ('A0','A1','A2','A3','human')),
  result        TEXT NOT NULL CHECK(result IN ('passed','failed','uncertain','overridden')),
  actor         TEXT NOT NULL,
  method        TEXT NOT NULL,
  details       TEXT NOT NULL DEFAULT '{}',
  confidence    REAL NOT NULL,
  target_digest TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  UNIQUE(project_key,target_id,dimension,level,actor,method,target_digest)
);

CREATE TABLE IF NOT EXISTS finding (
  id            TEXT PRIMARY KEY,
  project_key   TEXT NOT NULL,
  target_digest TEXT NOT NULL,
  finding_type  TEXT NOT NULL,
  subject_id    TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  severity      TEXT NOT NULL CHECK(severity IN ('low','medium','high','critical')),
  status        TEXT NOT NULL CHECK(status IN
                  ('open','auto_resolved','resolved','deferred','overridden')),
  details       TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  resolved_at   TEXT,
  UNIQUE(target_digest,finding_type,subject_id,policy_version)
);

CREATE TABLE IF NOT EXISTS review (
  id            TEXT PRIMARY KEY,
  project_key   TEXT NOT NULL,
  finding_id    TEXT,
  subject_id    TEXT NOT NULL,
  review_type   TEXT NOT NULL,
  checkpoint    TEXT,
  status        TEXT NOT NULL CHECK(status IN ('open','resolved','deferred')),
  payload       TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  resolved_at   TEXT
);

CREATE TABLE IF NOT EXISTS decision_event (
  id               TEXT PRIMARY KEY,
  project_key      TEXT NOT NULL,
  review_id        TEXT,
  finding_id       TEXT,
  action           TEXT NOT NULL,
  decided_by       TEXT NOT NULL CHECK(decided_by IN ('agent','human','tool')),
  agent_id         TEXT,
  autonomy_mode    TEXT NOT NULL,
  rationale        TEXT NOT NULL,
  alternatives     TEXT NOT NULL,
  evidence_digest  TEXT NOT NULL,
  confidence       REAL NOT NULL,
  reversibility    TEXT NOT NULL,
  supersedes_id    TEXT,
  action_class     TEXT NOT NULL DEFAULT 'draft_internal_reversible',
  target           TEXT NOT NULL DEFAULT '',
  policy_ref       TEXT NOT NULL DEFAULT 'decision-policy/v1',
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS risk_override (
  id              TEXT PRIMARY KEY,
  project_key     TEXT NOT NULL,
  finding_id      TEXT NOT NULL,
  decision_id     TEXT NOT NULL,
  actor_type      TEXT NOT NULL CHECK(actor_type IN ('agent','human')),
  actor_id        TEXT NOT NULL,
  autonomy_mode   TEXT NOT NULL,
  rationale       TEXT NOT NULL,
  policy_version  INTEGER NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_run (
  id            TEXT PRIMARY KEY,
  request_key   TEXT NOT NULL UNIQUE,
  project_key   TEXT NOT NULL,
  target_digest TEXT NOT NULL,
  level         TEXT NOT NULL CHECK(level IN ('L0','L1','L2')),
  policy_version INTEGER NOT NULL,
  reason        TEXT NOT NULL,
  priority      INTEGER NOT NULL DEFAULT 0,
  lane          TEXT NOT NULL DEFAULT 'P3' CHECK(lane='P3'),
  autonomy_mode TEXT NOT NULL CHECK(autonomy_mode IN
                ('autonomous','checkpointed','supervised')),
  status        TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed','stale')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  digest        TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  started_at    TEXT,
  finished_at   TEXT,
  error         TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_request ON audit_run(request_key);
CREATE INDEX IF NOT EXISTS idx_audit_queue
  ON audit_run(lane,status,next_attempt_at,priority,created_at);
CREATE TABLE IF NOT EXISTS attention_frontier (
  project_key    TEXT NOT NULL,
  snapshot_digest TEXT NOT NULL,
  subject_id     TEXT NOT NULL,
  subject_type   TEXT NOT NULL,
  score          REAL NOT NULL,
  factors        TEXT NOT NULL,
  blocking       INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  PRIMARY KEY(project_key,snapshot_digest,subject_id)
);

CREATE TABLE IF NOT EXISTS release_record (
  id                      TEXT PRIMARY KEY,
  project_key             TEXT NOT NULL,
  project_snapshot_digest TEXT NOT NULL,
  evidence_vector         TEXT NOT NULL,
  audit_run_digest        TEXT NOT NULL,
  policy_version          INTEGER NOT NULL,
  critical_findings       TEXT NOT NULL,
  overrides               TEXT NOT NULL,
  created_by              TEXT NOT NULL,
  created_at              TEXT NOT NULL,
  output_artifacts        TEXT NOT NULL,
  certification_status    TEXT NOT NULL CHECK(certification_status IN
                            ('candidate','certified','blocked'))
);
"""


def _migration_fingerprint(context: dict) -> str:
    raw = json.dumps(
        context, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8")
    return f"project-update-desired:{hashlib.sha256(raw).hexdigest()}"


def _upgrade_v1_to_v2(conn: sqlite3.Connection) -> None:
    """Upgrade the durable queue once, then leave only the v2 runtime shape."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        jobs = [dict(row) for row in conn.execute(
            "SELECT * FROM project_update_job ORDER BY created_at,id").fetchall()]
        snapshots_by_project: dict[str, list[dict]] = {}
        for row in conn.execute(
                "SELECT project_key,digest,payload FROM project_snapshot"
                " ORDER BY project_key,version DESC").fetchall():
            snapshots_by_project.setdefault(row["project_key"], []).append({
                "digest": row["digest"], "payload": json.loads(row["payload"]),
            })

        conn.execute("DROP INDEX IF EXISTS idx_project_job_open")
        conn.execute("ALTER TABLE project_update_job RENAME TO project_update_job_v1")
        conn.execute("""
            CREATE TABLE project_update_job (
              id TEXT PRIMARY KEY,
              project_key TEXT NOT NULL,
              desired_vector TEXT NOT NULL,
              captured_scope TEXT NOT NULL,
              reason TEXT NOT NULL,
              priority INTEGER NOT NULL DEFAULT 0,
              autonomy_mode TEXT NOT NULL,
              desired_fingerprint TEXT NOT NULL,
              request_version INTEGER NOT NULL DEFAULT 1,
              processing_version INTEGER,
              status TEXT NOT NULL DEFAULT 'queued'
                CHECK(status IN
                  ('queued','running','retry_scheduled','succeeded','failed')),
              attempts INTEGER NOT NULL DEFAULT 0,
              last_error TEXT,
              next_attempt_at TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              started_at TEXT,
              finished_at TEXT
            )
        """)
        prepared: list[tuple[dict, dict, str, str, Optional[str], Optional[str]]] = []
        for job in jobs:
            vector = json.loads(job["desired_vector"])
            scope = json.loads(job["captured_scope"])
            context = {
                "migrationPending": job["status"] in {
                    "queued", "running", "retry_scheduled", "failed",
                },
                "projectKey": job["project_key"],
                "evidenceVector": vector,
                "capturedScope": scope,
                "autonomyMode": job["autonomy_mode"],
                "compilerVersion": "project-dag/1",
            }
            fingerprint = _migration_fingerprint(context)
            status = "queued" if job["status"] == "running" else job["status"]
            last_error = job["last_error"]
            next_attempt_at = job["next_attempt_at"]
            started_at = job["started_at"]
            finished_at = job["finished_at"]
            if job["status"] == "running":
                last_error = "worker interrupted during Project DAG v2 upgrade"
                next_attempt_at = None
                started_at = None
                finished_at = None
            conn.execute(
                "INSERT INTO project_update_job"
                " (id,project_key,desired_vector,captured_scope,reason,priority,autonomy_mode,"
                "desired_fingerprint,request_version,processing_version,status,attempts,last_error,"
                "next_attempt_at,created_at,updated_at,started_at,finished_at)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (job["id"], job["project_key"], job["desired_vector"],
                 job["captured_scope"], job["reason"], job["priority"],
                 job["autonomy_mode"], fingerprint, job["request_version"],
                 job["processing_version"], status, job["attempts"], last_error,
                 next_attempt_at, job["created_at"], job["updated_at"],
                 started_at, finished_at),
            )
            receipt_state = "queued"
            committed_digest: Optional[str] = None
            if status == "failed":
                receipt_state = "failed"
            elif status == "succeeded":
                receipt_state = "superseded"
                for candidate in snapshots_by_project.get(job["project_key"], []):
                    payload = candidate["payload"]
                    candidate_scope = {
                        "includedSessions": [
                            entry["threadId"]
                            for entry in payload.get("evidenceVector", [])
                        ],
                        "excludedSessions": payload.get("excludedSessions", []),
                        "isolatedSessions": payload.get("isolatedSessions", []),
                    }
                    if (
                        payload.get("evidenceVector") == vector
                        and candidate_scope == scope
                        and payload.get("autonomyMode") == job["autonomy_mode"]
                    ):
                        receipt_state = "covered"
                        committed_digest = candidate["digest"]
                        break
            prepared.append((
                job, context, fingerprint, receipt_state, committed_digest, last_error,
            ))
        conn.execute("DROP TABLE project_update_job_v1")
        conn.execute(
            "CREATE UNIQUE INDEX idx_project_job_open ON project_update_job(project_key)"
            " WHERE status IN ('queued','running','retry_scheduled','failed')")
        for statement in PROJECT_UPDATE_RECEIPT_SCHEMA.split(";"):
            if statement.strip():
                conn.execute(statement)
        for job, context, fingerprint, state, digest, last_error in prepared:
            conn.execute(
                "INSERT INTO project_update_receipt"
                " (job_id,request_version,project_key,desired_fingerprint,desired_context,"
                "desired_vector,captured_scope,state,committed_snapshot_digest,last_error,"
                "accepted_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (job["id"], job["request_version"], job["project_key"], fingerprint,
                 json.dumps(context, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
                 job["desired_vector"], job["captured_scope"], state, digest,
                 last_error, job["created_at"], job["updated_at"]),
            )
        conn.execute("DROP TABLE project_schema")
        conn.execute(
            "CREATE TABLE project_schema"
            " (version INTEGER PRIMARY KEY CHECK(version=2))")
        conn.execute("INSERT INTO project_schema(version) VALUES (2)")
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def _upgrade_v2_to_v3(conn: sqlite3.Connection) -> None:
    """Upgrade Project graph references and relation vocabulary atomically.

    v3 keeps Evidence as immutable cross-DAG references.  The new ``node_type``
    column is descriptive routing metadata copied from the referenced Evidence
    node, never an Evidence payload or Snapshot envelope.
    """
    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute("ALTER TABLE claim RENAME TO claim_v2")
        conn.execute("""
            CREATE TABLE claim (
              id TEXT PRIMARY KEY,
              project_key TEXT NOT NULL,
              statement TEXT NOT NULL,
              claim_type TEXT CHECK(claim_type IN
                ('hypothesis','finding','method_result','negative_result','decision','conclusion')),
              status TEXT NOT NULL DEFAULT 'supported' CHECK(status IN
                ('supported','conflicted','invalidated','fragile','undetermined')),
              confidence REAL,
              goal_id TEXT,
              t_valid TEXT NOT NULL,
              t_invalid TEXT,
              t_created TEXT NOT NULL,
              load_bearing REAL NOT NULL DEFAULT 0,
              blast_radius INTEGER NOT NULL DEFAULT 0,
              needs_regoal INTEGER NOT NULL DEFAULT 0
            )
        """)
        conn.execute("""
            INSERT INTO claim
              (id,project_key,statement,claim_type,status,confidence,goal_id,t_valid,
               t_invalid,t_created,load_bearing,blast_radius,needs_regoal)
            SELECT id,project_key,statement,claim_type,status,confidence,goal_id,t_valid,
                   t_invalid,t_created,load_bearing,blast_radius,needs_regoal
            FROM claim_v2
        """)
        conn.execute("DROP TABLE claim_v2")

        conn.execute("ALTER TABLE evidence RENAME TO evidence_v2")
        conn.execute("""
            CREATE TABLE evidence (
              id TEXT PRIMARY KEY,
              project_key TEXT NOT NULL,
              thread_id TEXT NOT NULL,
              snapshot_digest TEXT NOT NULL,
              node_id TEXT NOT NULL,
              node_type TEXT NOT NULL CHECK(length(trim(node_type)) > 0),
              UNIQUE(project_key,thread_id,snapshot_digest,node_id)
            )
        """)
        conn.execute("""
            INSERT INTO evidence
              (id,project_key,thread_id,snapshot_digest,node_id,node_type)
            SELECT id,project_key,thread_id,snapshot_digest,node_id,'source_assertion'
            FROM evidence_v2
        """)
        conn.execute("DROP TABLE evidence_v2")
        conn.execute("""
            CREATE INDEX idx_evidence_ref
            ON evidence(project_key,thread_id,snapshot_digest,node_id)
        """)

        conn.execute("ALTER TABLE edge RENAME TO edge_v2")
        conn.execute("""
            CREATE TABLE edge (
              id TEXT PRIMARY KEY,
              src TEXT NOT NULL,
              dst TEXT NOT NULL,
              edge_type TEXT NOT NULL CHECK(edge_type IN (
                'decomposes_to','addresses','supports','contradicts','derived_from',
                'same_as','mentions','replicates','fails_to_replicate','rerun_of')),
              t_valid TEXT NOT NULL,
              t_invalid TEXT,
              meta TEXT
            )
        """)
        conn.execute("""
            INSERT INTO edge (id,src,dst,edge_type,t_valid,t_invalid,meta)
            SELECT id,src,dst,edge_type,t_valid,t_invalid,meta FROM edge_v2
        """)
        conn.execute("DROP TABLE edge_v2")
        conn.execute("CREATE INDEX idx_edge_src ON edge(src, edge_type)")
        conn.execute("CREATE INDEX idx_edge_dst ON edge(dst, edge_type)")

        conn.execute("DROP TABLE project_schema")
        conn.execute(
            "CREATE TABLE project_schema"
            " (version INTEGER PRIMARY KEY CHECK(version=3))")
        conn.execute("INSERT INTO project_schema(version) VALUES (3)")
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


class Store:
    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        parent = os.path.dirname(os.path.abspath(db_path))
        if parent:
            os.makedirs(parent, exist_ok=True)
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        # One connection is shared by the HTTP worker threads.  Long-running
        # model preparation must happen outside this lock; only short SQLite
        # snapshots/transactions are serialized through it.
        self.transaction_lock = threading.RLock()
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        existing_tables = {
            row["name"] for row in self.q(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        }
        if existing_tables:
            schema = (self.q1("SELECT version FROM project_schema")
                      if "project_schema" in existing_tables else None)
            if schema is not None and schema["version"] == 1:
                _upgrade_v1_to_v2(self.conn)
                schema = {"version": 2}
            if schema is not None and schema["version"] == 2:
                _upgrade_v2_to_v3(self.conn)
                schema = {"version": 3}
            if schema is None or schema["version"] != 3:
                self.conn.close()
                raise RuntimeError("Project DAG requires a clean project-view database")
        self.conn.executescript(SCHEMA)
        self._ensure_stage4_schema()
        self._migrate_legacy_governance_roots()
        self.conn.commit()

    def _ensure_stage4_schema(self) -> None:
        """Install additive Stage 4 columns/tables for existing v3 stores."""
        def columns(table: str) -> set[str]:
            return {row["name"] for row in self.q(f"PRAGMA table_info({table})")}

        if "reason" not in columns("project_scope"):
            self.conn.execute(
                "ALTER TABLE project_scope ADD COLUMN reason TEXT NOT NULL DEFAULT ''")
        snapshot_columns = columns("project_snapshot")
        if "scope_revision" not in snapshot_columns:
            self.conn.execute("ALTER TABLE project_snapshot ADD COLUMN scope_revision INTEGER")
        if "input_fingerprint" not in snapshot_columns:
            self.conn.execute("ALTER TABLE project_snapshot ADD COLUMN input_fingerprint TEXT")
        release_columns = columns("release_record")
        for name, definition in {
            "classification": "TEXT NOT NULL DEFAULT 'internal'",
            "target": "TEXT NOT NULL DEFAULT ''",
            "attempt_outcome": "TEXT NOT NULL DEFAULT 'accepted'",
            "audit_refs": "TEXT NOT NULL DEFAULT '[]'",
            "decision_refs": "TEXT NOT NULL DEFAULT '[]'",
            "approval_refs": "TEXT NOT NULL DEFAULT '[]'",
        }.items():
            if name not in release_columns:
                self.conn.execute(f"ALTER TABLE release_record ADD COLUMN {name} {definition}")
        policy_columns = columns("project_policy")
        if "decision_rules" not in policy_columns:
            self.conn.execute(
                "ALTER TABLE project_policy ADD COLUMN decision_rules TEXT NOT NULL DEFAULT '{}'")
        decision_columns = columns("decision_event")
        for name, definition in {
            "action_class": "TEXT NOT NULL DEFAULT 'draft_internal_reversible'",
            "target": "TEXT NOT NULL DEFAULT ''",
            "policy_ref": "TEXT NOT NULL DEFAULT 'decision-policy/v1'",
        }.items():
            if name not in decision_columns:
                self.conn.execute(f"ALTER TABLE decision_event ADD COLUMN {name} {definition}")
        # The CREATE TABLE statements above are idempotent and also create all
        # additive Stage 4 indexes on databases created before this change.
        self.conn.executescript(";\n".join(
            statement.strip() for statement in (
                """CREATE TABLE IF NOT EXISTS project_scope_revision (
                  project_key TEXT NOT NULL, revision INTEGER NOT NULL,
                  included_sessions TEXT NOT NULL, excluded_sessions TEXT NOT NULL,
                  isolated_sessions TEXT NOT NULL, reasons TEXT NOT NULL DEFAULT '{}',
                  created_by TEXT NOT NULL, created_at TEXT NOT NULL,
                  PRIMARY KEY(project_key, revision)
                )""",
                """CREATE TABLE IF NOT EXISTS project_goal_draft (
                  project_key TEXT PRIMARY KEY, root_goal_id TEXT, title TEXT NOT NULL,
                  description TEXT NOT NULL DEFAULT '', base_version INTEGER,
                  updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
                )""",
                """CREATE TABLE IF NOT EXISTS project_scope_draft (
                  project_key TEXT PRIMARY KEY, included_sessions TEXT NOT NULL,
                  excluded_sessions TEXT NOT NULL, isolated_sessions TEXT NOT NULL,
                  reasons TEXT NOT NULL DEFAULT '{}', base_revision INTEGER,
                  updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
                )""",
                """CREATE TABLE IF NOT EXISTS project_invalidation (
                  project_key TEXT PRIMARY KEY, desired_fingerprint TEXT,
                  applied_fingerprint TEXT, stale INTEGER NOT NULL DEFAULT 0,
                  reason TEXT, changed_fields TEXT NOT NULL DEFAULT '[]',
                  updated_at TEXT NOT NULL
                )""",
                """CREATE TABLE IF NOT EXISTS project_snapshot_seal (
                  project_key TEXT NOT NULL, snapshot_digest TEXT NOT NULL,
                  reason TEXT NOT NULL, sealed_by TEXT NOT NULL, sealed_at TEXT NOT NULL,
                  PRIMARY KEY(project_key, snapshot_digest)
                )""",
                """CREATE TABLE IF NOT EXISTS approval_record (
                  id TEXT PRIMARY KEY, project_key TEXT NOT NULL, decision_id TEXT NOT NULL,
                  project_snapshot_digest TEXT NOT NULL, attestor TEXT NOT NULL,
                  trusted_role_assertion_ref TEXT, attestation TEXT NOT NULL,
                  policy_ref TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT,
                  revokes_approval_id TEXT
                )""",
                """CREATE TABLE IF NOT EXISTS finding_event (
                  id TEXT PRIMARY KEY, project_key TEXT NOT NULL, finding_id TEXT NOT NULL,
                  event_type TEXT NOT NULL, actor TEXT NOT NULL, payload TEXT NOT NULL,
                  created_at TEXT NOT NULL
                )""",
                """CREATE TABLE IF NOT EXISTS review_event (
                  id TEXT PRIMARY KEY, project_key TEXT NOT NULL, review_id TEXT NOT NULL,
                  event_type TEXT NOT NULL, actor TEXT NOT NULL, payload TEXT NOT NULL,
                  created_at TEXT NOT NULL
                )""",
            )
        ))

    def _migrate_legacy_governance_roots(self) -> None:
        """Record pre-event Finding/Review rows as exact legacy roots once."""
        self.conn.execute(
            "INSERT INTO finding_event (id,project_key,finding_id,event_type,actor,payload,created_at)"
            " SELECT 'legacy-finding-root:' || id,project_key,id,'legacy_finding_root',"
            " 'migration',details,created_at FROM finding f"
            " WHERE NOT EXISTS (SELECT 1 FROM finding_event e WHERE e.finding_id=f.id)")
        self.conn.execute(
            "INSERT INTO review_event (id,project_key,review_id,event_type,actor,payload,created_at)"
            " SELECT 'legacy-review-root:' || id,project_key,id,'legacy_review_root',"
            " 'migration',payload,created_at FROM review r"
            " WHERE NOT EXISTS (SELECT 1 FROM review_event e WHERE e.review_id=r.id)")

    def close(self) -> None:
        self.conn.close()

    # --- tiny row helpers ----------------------------------------------------
    def q(self, sql: str, args: Iterable[Any] = ()) -> list[dict]:
        return [dict(r) for r in self.conn.execute(sql, tuple(args)).fetchall()]

    def q1(self, sql: str, args: Iterable[Any] = ()) -> Optional[dict]:
        r = self.conn.execute(sql, tuple(args)).fetchone()
        return dict(r) if r else None

    def x(self, sql: str, args: Iterable[Any] = ()) -> None:
        self.conn.execute(sql, tuple(args))

    # --- edges ----------------------------------------------------------------
    def add_edge(self, src: str, dst: str, edge_type: str,
                 meta: Optional[dict] = None, t_valid: Optional[str] = None) -> str:
        eid = new_id("edge")
        self.x("INSERT INTO edge (id,src,dst,edge_type,t_valid,meta) VALUES (?,?,?,?,?,?)",
               (eid, src, dst, edge_type, t_valid or now_iso(),
                json.dumps(meta, ensure_ascii=False) if meta else None))
        return eid

    def close_edge(self, edge_id: str, t: Optional[str] = None) -> None:
        self.x("UPDATE edge SET t_invalid=? WHERE id=? AND t_invalid IS NULL",
               (t or now_iso(), edge_id))

    def alive_edges(self, *, src: Optional[str] = None, dst: Optional[str] = None,
                    edge_type: Optional[str] = None) -> list[dict]:
        sql, args = "SELECT * FROM edge WHERE t_invalid IS NULL", []
        if src is not None:
            sql += " AND src=?"; args.append(src)
        if dst is not None:
            sql += " AND dst=?"; args.append(dst)
        if edge_type is not None:
            sql += " AND edge_type=?"; args.append(edge_type)
        return self.q(sql, args)

    # --- goals ----------------------------------------------------------------
    def create_goal(self, title: str, *, description: str = "",
                    parent_root: Optional[str] = None, status: str = "open",
                    project_key: Optional[str] = None) -> dict:
        gid = new_id("goal")
        t = now_iso()
        self.x("INSERT INTO goal (id,root_id,parent_id,title,description,status,version,project_key,t_created)"
               " VALUES (?,?,?,?,?,?,1,?,?)",
               (gid, gid, parent_root, title, description, status, project_key, t))
        self.conn.commit()
        return self.q1("SELECT * FROM goal WHERE id=?", (gid,))  # type: ignore[return-value]

    def update_goal(self, root_id: str, **changes: Any) -> dict:
        """Versioned update: expire the live row, insert version+1."""
        cur = self.q1("SELECT * FROM goal WHERE root_id=? AND t_expired IS NULL", (root_id,))
        if cur is None:
            raise KeyError(root_id)
        t = now_iso()
        self.x("UPDATE goal SET t_expired=? WHERE id=?", (t, cur["id"]))
        new = {**cur, **{k: v for k, v in changes.items()
                         if k in ("title", "description", "status", "parent_id")}}
        nid = new_id("goal")
        self.x("INSERT INTO goal (id,root_id,parent_id,title,description,status,version,project_key,t_created)"
               " VALUES (?,?,?,?,?,?,?,?,?)",
               (nid, root_id, new["parent_id"], new["title"], new["description"],
                new["status"], cur["version"] + 1, cur.get("project_key"), t))
        # claims pointing at this goal must be re-checked next compile
        self.x("UPDATE claim SET needs_regoal=1 WHERE goal_id=? AND t_invalid IS NULL", (root_id,))
        self.conn.commit()
        return self.q1("SELECT * FROM goal WHERE id=?", (nid,))  # type: ignore[return-value]

    def active_goals(self, *, project_key: Optional[str] = None,
                     scoped: bool = False) -> list[dict]:
        sql = "SELECT * FROM goal WHERE t_expired IS NULL AND status NOT IN ('abandoned')"
        args: list[Any] = []
        if scoped:
            if project_key:
                sql += " AND project_key=?"
                args.append(project_key)
            else:
                sql += " AND project_key IS NULL"
        return self.q(sql + " ORDER BY t_created", args)

    # --- watermark --------------------------------------------------------------
    def get_watermark(self, project_key: str, session_id: str) -> Optional[dict]:
        row = self.q1("SELECT * FROM watermark WHERE project_key=? AND session_id=?",
                      (project_key, session_id))
        if row:
            row["processed_ids"] = set(json.loads(row["processed_ids"]))
        return row

    def set_watermark(self, project_key: str, session_id: str, dag_hash: str,
                      processed_ids: set[str]) -> None:
        self.x("INSERT INTO watermark (project_key,session_id,dag_hash,processed_ids,updated_at)"
               " VALUES (?,?,?,?,?) ON CONFLICT(project_key,session_id) DO UPDATE SET"
               " dag_hash=excluded.dag_hash, processed_ids=excluded.processed_ids,"
               " updated_at=excluded.updated_at",
               (project_key, session_id, dag_hash, json.dumps(sorted(processed_ids)), now_iso()))

    # --- review queue -------------------------------------------------------------
    def enqueue_review(self, project_key: str, item_type: str, payload: dict,
                       subject_id: str = "project-compile") -> str:
        rid = new_id("review")
        self.x("INSERT INTO review (id,project_key,subject_id,review_type,status,payload,created_at)"
               " VALUES (?,?,?,?,'open',?,?)",
               (rid, project_key, subject_id, item_type,
                json.dumps(payload, ensure_ascii=False), now_iso()))
        return rid

    # --- judge cache ------------------------------------------------------------
    def cache_get(self, key: str) -> Optional[str]:
        row = self.q1("SELECT response FROM judge_cache WHERE key=?", (key,))
        return row["response"] if row else None

    def cache_put(self, key: str, task_type: str, response: str) -> None:
        self.x("INSERT OR REPLACE INTO judge_cache (key,task_type,response,created_at)"
               " VALUES (?,?,?,?)", (key, task_type, response, now_iso()))
