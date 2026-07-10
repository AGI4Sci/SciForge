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

import json
import os
import sqlite3
import time
import uuid
from typing import Any, Iterable, Optional

SCHEMA = """
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
  canonical_name TEXT NOT NULL,
  entity_type    TEXT,
  aliases        TEXT NOT NULL DEFAULT '[]',   -- JSON array
  provisional    INTEGER NOT NULL DEFAULT 0,   -- awaiting a merge review
  merged_into    TEXT,                          -- non-null: absorbed by that entity
  merged_from    TEXT NOT NULL DEFAULT '[]',   -- JSON array (audit trail)
  t_created      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS claim (
  id            TEXT PRIMARY KEY,
  project_key   TEXT NOT NULL,
  statement     TEXT NOT NULL,
  claim_type    TEXT CHECK(claim_type IN
                ('hypothesis','finding','method_result','negative_result','decision')),
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
  evidence_type TEXT NOT NULL CHECK(evidence_type IN
                ('agent_derived','human_attested','external_source','tool_output')),
  content       TEXT,
  content_ref   TEXT,                    -- session node id or local file/log path
  source_hash   TEXT,                    -- dedup key (evidence-dag ids are content hashes)
  quality_score REAL,
  attestation_method TEXT CHECK(attestation_method IN
                ('self_report','log_corroborated','artifact_hash')),
  trust_score   REAL,
  t_valid       TEXT NOT NULL,
  t_invalid     TEXT
);
CREATE INDEX IF NOT EXISTS idx_evidence_hash ON evidence(source_hash);

CREATE TABLE IF NOT EXISTS edge (
  id        TEXT PRIMARY KEY,
  src       TEXT NOT NULL,
  dst       TEXT NOT NULL,
  edge_type TEXT NOT NULL CHECK(edge_type IN (
    'decomposes_to','addresses','supports','contradicts','derived_from',
    'same_as','mentions')),
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

-- Immutable cross-layer input registry.  A digest may only ever describe one
-- canonical snapshot envelope.
CREATE TABLE IF NOT EXISTS evidence_snapshot (
  thread_id          TEXT NOT NULL,
  digest             TEXT NOT NULL,
  version            INTEGER NOT NULL,
  input_watermark    TEXT NOT NULL,
  schema_version     TEXT NOT NULL,
  extractor_version  TEXT NOT NULL,
  verifier_version   TEXT NOT NULL,
  artifact_digests   TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  registered_at      TEXT NOT NULL,
  envelope           TEXT NOT NULL,
  PRIMARY KEY(thread_id, digest),
  UNIQUE(thread_id, version)
);

CREATE TABLE IF NOT EXISTS project_policy (
  project_key        TEXT PRIMARY KEY,
  autonomy_mode      TEXT NOT NULL DEFAULT 'autonomous'
                     CHECK(autonomy_mode IN ('autonomous','checkpointed','supervised')),
  policy_version     INTEGER NOT NULL DEFAULT 1,
  checkpoints        TEXT NOT NULL DEFAULT '[]',
  allow_agent_critical_override INTEGER NOT NULL DEFAULT 0,
  min_literature_level TEXT NOT NULL DEFAULT 'L2',
  min_run_level      TEXT NOT NULL DEFAULT 'L4',
  updated_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_scope (
  project_key  TEXT NOT NULL,
  session_id   TEXT NOT NULL,
  disposition  TEXT NOT NULL CHECK(disposition IN ('included','excluded','isolated')),
  updated_at   TEXT NOT NULL,
  PRIMARY KEY(project_key, session_id)
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
  request_version    INTEGER NOT NULL DEFAULT 1,
  processing_version INTEGER,
  status             TEXT NOT NULL DEFAULT 'queued'
                     CHECK(status IN ('queued','running','done','failed','interrupted')),
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
  WHERE status IN ('queued','running','failed','interrupted');

CREATE TABLE IF NOT EXISTS project_snapshot (
  project_key       TEXT NOT NULL,
  version           INTEGER NOT NULL,
  digest            TEXT NOT NULL UNIQUE,
  goal_version      TEXT NOT NULL,
  evidence_vector   TEXT NOT NULL,
  excluded_sessions TEXT NOT NULL,
  isolated_sessions TEXT NOT NULL,
  compiler_version  TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  status            TEXT NOT NULL CHECK(status='committed'),
  payload           TEXT NOT NULL,
  PRIMARY KEY(project_key, version)
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
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self.conn.executescript(SCHEMA)
        self._migrate()
        self.conn.commit()

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

    def _migrate(self) -> None:
        """Apply the one-way canonical queue schema, then reject older graph schemas."""
        update_columns = {row["name"] for row in self.q(
            "PRAGMA table_info(project_update_job)")}
        if "next_attempt_at" not in update_columns:
            self.x("ALTER TABLE project_update_job ADD COLUMN next_attempt_at TEXT")

        audit_columns = {row["name"] for row in self.q("PRAGMA table_info(audit_run)")}
        audit_additions = {
            "request_key": "TEXT",
            "reason": "TEXT NOT NULL DEFAULT 'manual'",
            "priority": "INTEGER NOT NULL DEFAULT 0",
            "lane": "TEXT NOT NULL DEFAULT 'P3'",
            "autonomy_mode": "TEXT NOT NULL DEFAULT 'autonomous'",
            "attempts": "INTEGER NOT NULL DEFAULT 0",
            "next_attempt_at": "TEXT",
            "created_at": "TEXT",
            "updated_at": "TEXT",
        }
        for name, declaration in audit_additions.items():
            if name not in audit_columns:
                self.x(f"ALTER TABLE audit_run ADD COLUMN {name} {declaration}")
        migration_time = now_iso()
        self.x(
            "UPDATE audit_run SET request_key=COALESCE(request_key,'migrated:' || id),"
            " created_at=COALESCE(created_at,started_at,finished_at,?),"
            " updated_at=COALESCE(updated_at,finished_at,started_at,?)",
            (migration_time, migration_time),
        )
        self.x("CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_request ON audit_run(request_key)")
        self.x(
            "CREATE INDEX IF NOT EXISTS idx_audit_queue"
            " ON audit_run(lane,status,next_attempt_at,priority,created_at)"
        )

        columns = {row["name"] for row in self.q("PRAGMA table_info(goal)")}
        if "project_key" not in columns:
            raise RuntimeError(
                "legacy Project DAG database requires an explicit offline migration")
        claim_columns = {row["name"] for row in self.q("PRAGMA table_info(claim)")}
        watermark_columns = {row["name"] for row in self.q("PRAGMA table_info(watermark)")}
        if "project_key" not in claim_columns or "project_key" not in watermark_columns:
            raise RuntimeError(
                "legacy Project DAG database requires an explicit offline migration")

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
