"""SQLite storage for the project DAG.

Invariants (the whole audit story rests on these):
  * NOTHING is ever DELETEd. Invalidation closes a bi-temporal window by
    setting `t_invalid`; the time-machine view is a plain filter.
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
  t_created   TEXT NOT NULL,
  t_expired   TEXT                      -- non-null: replaced by a newer version
);

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

CREATE TABLE IF NOT EXISTS activity (
  id            TEXT PRIMARY KEY,
  activity_type TEXT NOT NULL CHECK(activity_type IN
                ('reasoning','tool_call','human_action')),
  description   TEXT,
  session_id    TEXT,
  started_at    TEXT,
  ended_at      TEXT
);

CREATE TABLE IF NOT EXISTS edge (
  id        TEXT PRIMARY KEY,
  src       TEXT NOT NULL,
  dst       TEXT NOT NULL,
  edge_type TEXT NOT NULL CHECK(edge_type IN (
    'decomposes_to','addresses','supports','contradicts','derived_from',
    'generated_by','used','same_as','mentions')),
  t_valid   TEXT NOT NULL,
  t_invalid TEXT,
  meta      TEXT                          -- JSON: adjudication reason, confidence...
);
CREATE INDEX IF NOT EXISTS idx_edge_src ON edge(src, edge_type);
CREATE INDEX IF NOT EXISTS idx_edge_dst ON edge(dst, edge_type);

-- which session node a claim was promoted from (rewrite detection + provenance)
CREATE TABLE IF NOT EXISTS claim_origin (
  claim_id   TEXT NOT NULL,
  session_id TEXT NOT NULL,
  node_id    TEXT NOT NULL,
  run_id     TEXT,
  PRIMARY KEY (claim_id, session_id, node_id)
);
CREATE INDEX IF NOT EXISTS idx_origin_node ON claim_origin(session_id, node_id);

CREATE TABLE IF NOT EXISTS watermark (
  session_id    TEXT PRIMARY KEY,
  dag_hash      TEXT NOT NULL,
  processed_ids TEXT NOT NULL DEFAULT '[]',  -- JSON array of node ids already seen
  updated_at    TEXT
);

CREATE TABLE IF NOT EXISTS review_item (
  id          TEXT PRIMARY KEY,
  item_type   TEXT NOT NULL CHECK(item_type IN
              ('entity_merge','claim_merge','conflict','human_evidence','orphan_claims')),
  payload     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK(status IN ('pending','accepted','rejected','deferred')),
  created_at  TEXT,
  resolved_at TEXT,
  resolution  TEXT
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
                    parent_root: Optional[str] = None, status: str = "open") -> dict:
        gid = new_id("goal")
        t = now_iso()
        self.x("INSERT INTO goal (id,root_id,parent_id,title,description,status,version,t_created)"
               " VALUES (?,?,?,?,?,?,1,?)", (gid, gid, parent_root, title, description, status, t))
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
        self.x("INSERT INTO goal (id,root_id,parent_id,title,description,status,version,t_created)"
               " VALUES (?,?,?,?,?,?,?,?)",
               (nid, root_id, new["parent_id"], new["title"], new["description"],
                new["status"], cur["version"] + 1, t))
        # claims pointing at this goal must be re-checked next compile
        self.x("UPDATE claim SET needs_regoal=1 WHERE goal_id=? AND t_invalid IS NULL", (root_id,))
        self.conn.commit()
        return self.q1("SELECT * FROM goal WHERE id=?", (nid,))  # type: ignore[return-value]

    def active_goals(self) -> list[dict]:
        return self.q("SELECT * FROM goal WHERE t_expired IS NULL "
                      "AND status NOT IN ('abandoned') ORDER BY t_created")

    # --- watermark --------------------------------------------------------------
    def get_watermark(self, session_id: str) -> Optional[dict]:
        row = self.q1("SELECT * FROM watermark WHERE session_id=?", (session_id,))
        if row:
            row["processed_ids"] = set(json.loads(row["processed_ids"]))
        return row

    def set_watermark(self, session_id: str, dag_hash: str, processed_ids: set[str]) -> None:
        self.x("INSERT INTO watermark (session_id,dag_hash,processed_ids,updated_at)"
               " VALUES (?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET"
               " dag_hash=excluded.dag_hash, processed_ids=excluded.processed_ids,"
               " updated_at=excluded.updated_at",
               (session_id, dag_hash, json.dumps(sorted(processed_ids)), now_iso()))

    # --- review queue -------------------------------------------------------------
    def enqueue_review(self, item_type: str, payload: dict) -> str:
        rid = new_id("review")
        self.x("INSERT INTO review_item (id,item_type,payload,created_at) VALUES (?,?,?,?)",
               (rid, item_type, json.dumps(payload, ensure_ascii=False), now_iso()))
        return rid

    # --- judge cache ------------------------------------------------------------
    def cache_get(self, key: str) -> Optional[str]:
        row = self.q1("SELECT response FROM judge_cache WHERE key=?", (key,))
        return row["response"] if row else None

    def cache_put(self, key: str, task_type: str, response: str) -> None:
        self.x("INSERT OR REPLACE INTO judge_cache (key,task_type,response,created_at)"
               " VALUES (?,?,?,?)", (key, task_type, response, now_iso()))
