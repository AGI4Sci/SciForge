"""Offline end-to-end tests for the compile pipeline (StubJudge, no network).

Covers the M1-M3 acceptance criteria from the construction plan:
  * change a session -> compile -> claims appear, watermark advances,
    re-compiling is a no-op (idempotent)
  * same conclusion reworded in another session -> merged, not duplicated
  * injected contradiction -> weaker claim invalidated with a readable rule
  * incremental reconcile agrees with the full relabel (safety net diff empty)
  * history rewrite (vanished node id) -> old claim loses support, invalidated
"""
from __future__ import annotations

import os
import re
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

import project_dag  # noqa: F401  (sys.path side effect for evidence_dag)
from evidence_dag import provjson
from evidence_dag.graph import ThreadGraph
from evidence_dag.model import EdgeRel, NodeStatus, NodeType

from project_dag.judge import StubJudge
from project_dag.service import Engine


def _safe_session_filename(session_id: str) -> str:
    return re.sub(r'[/\\:<>"|?*]', "_", session_id)


def _norm(s: str) -> str:
    return " ".join((s or "").lower().split())


def make_judge() -> StubJudge:
    def distill(p):
        goals = p.get("active_goals") or []
        return {
            "statement": p["claim"],
            "claim_type": "finding",
            "mentioned_entities": ["dataset-x"] if "x2" in p["claim"] else ["pipeline-v3"],
            "addresses_goal": goals[0]["id"] if goals else "none",
            "source_node_ids": [n["id"] for n in p["subgraph"]["nodes"]],
            "confidence": 0.9,
        }

    def entity_same(p):
        return {"same": _norm(p["name"]) == _norm(p["candidate"]), "confidence": 0.95}

    def claim_equiv(p):
        new = _norm(p["new"]).replace("(again) ", "")
        for c in p["pool"]:
            if _norm(c["statement"]) == new:
                return {"relation": "equivalent", "target": c["id"], "confidence": 0.95}
        return {"relation": "new", "target": None, "confidence": 0.9}

    def contradiction(p):
        a, b = _norm(p["a"]), _norm(p["b"])
        flip = ("improves" in a and "does not improve" in b) or \
               ("does not improve" in a and "improves" in b)
        return {"contradicts": flip, "confidence": 0.9}

    return StubJudge({"distill": distill, "entity_same": entity_same,
                      "claim_equiv": claim_equiv, "contradiction": contradiction})


def write_session(session_dir: str, sid: str, claims: list[tuple[str, str, str]],
                  meta: dict | None = None) -> None:
    """claims: [(claim_text, source_text, credibility)]"""
    g = ThreadGraph(sid, meta=meta)
    for claim_text, source_text, cred in claims:
        s = g.add_or_get_node(NodeType.SOURCE, source_text, credibility=cred)
        c = g.add_or_get_node(NodeType.CLAIM, claim_text)
        c.status = NodeStatus.SUPPORTED
        g.add_edge(s.id, c.id, EdgeRel.SUPPORTS, nli_score=0.9)
    with open(os.path.join(session_dir, f"{_safe_session_filename(sid)}.prov.json"), "w",
              encoding="utf-8") as fh:
        fh.write(provjson.dumps(g))


class CompileTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.sessions = os.path.join(self.tmp.name, "threads")
        os.makedirs(self.sessions)
        self.engine = Engine(os.path.join(self.tmp.name, "project.db"),
                             self.sessions, judge=make_judge())
        self.goal = self.engine.create_goal("提升 pipeline 效果")

    def tearDown(self):
        self.engine.store.close()
        self.tmp.cleanup()

    def test_engine_creates_nested_database_parent_directory(self):
        other = tempfile.TemporaryDirectory()
        engine = None
        try:
            sessions = os.path.join(other.name, "threads")
            db_path = os.path.join(other.name, "missing", "project-dag", "project.db")
            os.makedirs(sessions)

            engine = Engine(db_path, sessions, judge=make_judge())

            self.assertTrue(os.path.exists(os.path.dirname(db_path)))
            self.assertTrue(os.path.exists(db_path))
        finally:
            if engine is not None:
                engine.store.close()
            other.cleanup()

    def test_startup_marks_stale_running_compile_interrupted(self):
        other = tempfile.TemporaryDirectory()
        engine = engine2 = None
        try:
            sessions = os.path.join(other.name, "threads")
            os.makedirs(sessions)
            db_path = os.path.join(other.name, "project.db")
            engine = Engine(db_path, sessions, judge=make_judge())
            engine.store.x("INSERT INTO compile_run (id,trigger,scope,started_at,status)"
                           " VALUES ('run_stale','manual','\"all\"','2026-07-08T00:00:00Z','running')")
            engine.store.conn.commit()
            engine.store.close()
            engine = None

            engine2 = Engine(db_path, sessions, judge=make_judge())
            row = engine2.store.q1("SELECT status,finished_at FROM compile_run WHERE id='run_stale'")
            self.assertEqual(row["status"], "interrupted")
            self.assertIsNotNone(row["finished_at"])
        finally:
            if engine is not None:
                engine.store.close()
            if engine2 is not None:
                engine2.store.close()
            other.cleanup()

    def test_busy_manual_compile_returns_skipped(self):
        from project_dag import compiler as compiler_mod

        compiler_mod._LOCK.acquire()
        try:
            result = self.engine.compile()
        finally:
            compiler_mod._LOCK.release()

        self.assertEqual(result, {
            "skipped": True,
            "reason": "compile already running",
        })
        self.assertEqual(self.engine.compile_runs(), [])

    def test_compile_failure_marks_running_run_failed(self):
        write_session(self.sessions, "s1",
                      [("pipeline v3 improves accuracy on x2", "paper A found it",
                        "high")])

        with patch("project_dag.compiler.incremental_reconcile",
                   side_effect=RuntimeError("reconcile exploded")):
            with self.assertRaises(RuntimeError):
                self.engine.compile()

        row = self.engine.compile_runs(1)[0]
        self.assertEqual(row["status"], "failed")
        self.assertIsNotNone(row["finished_at"])
        self.assertEqual(row["stats"]["errors"], 1)
        detail = self.engine.compile_run(row["id"])
        self.assertIn("reconcile exploded", detail["diff"]["errors"][0]["error"])

    # M1: promote + watermark + idempotent
    def test_basic_promote_and_idempotent(self):
        write_session(self.sessions, "s1",
                      [("pipeline v3 improves accuracy on x2", "paper A found it",
                        "high")])
        r1 = self.engine.compile()
        self.assertEqual(r1["stats"]["claims_added"], 1)
        claims = self.engine.claims(goal_id=self.goal["root_id"])
        self.assertEqual(len(claims), 1)
        r2 = self.engine.compile()
        self.assertEqual(r2["stats"]["sessions_compiled"], 0)
        self.assertEqual(len(self.engine.claims(goal_id=self.goal["root_id"])), 1)

    # regression: Evidence-DAG stores Windows-safe filenames, but the real id is in PROV meta
    def test_colon_session_id_roundtrip_from_prov_meta(self):
        write_session(self.sessions, "codex:thread-42",
                      [("pipeline v3 improves accuracy on x2", "paper A", "high")])
        self.assertTrue(os.path.exists(os.path.join(
            self.sessions, "codex_thread-42.prov.json")))

        r = self.engine.compile()

        self.assertEqual(r["diff"]["sessions"], ["codex:thread-42"])
        claim = self.engine.claims(goal_id=self.goal["root_id"])[0]
        detail = self.engine.claim_detail(claim["id"])
        self.assertEqual(detail["origins"][0]["session_id"], "codex:thread-42")
        self.assertTrue(detail["supports"][0]["content_ref"].startswith("codex:thread-42#"))

    def test_legacy_colon_session_filename_still_loads(self):
        if os.name == "nt":
            self.skipTest("colon filenames are not legal on Windows")
        sid = "codex:legacy-thread"
        g = ThreadGraph(sid)
        s = g.add_or_get_node(NodeType.SOURCE, "paper A", credibility="high")
        c = g.add_or_get_node(NodeType.CLAIM, "pipeline v3 improves accuracy on x2")
        c.status = NodeStatus.SUPPORTED
        g.add_edge(s.id, c.id, EdgeRel.SUPPORTS, nli_score=0.9)
        with open(os.path.join(self.sessions, f"{sid}.prov.json"), "w", encoding="utf-8") as fh:
            fh.write(provjson.dumps(g))

        r = self.engine.compile()

        self.assertEqual(r["stats"]["errors"], 0)
        self.assertEqual(r["diff"]["sessions"], [sid])
        claim = self.engine.claims(goal_id=self.goal["root_id"])[0]
        detail = self.engine.claim_detail(claim["id"])
        self.assertEqual(detail["origins"][0]["session_id"], sid)

    # cold start: no goals -> orphan pool, adopt via review
    def test_orphan_pool_and_adopt(self):
        self.engine.store.x("UPDATE goal SET status='abandoned'")
        self.engine.store.conn.commit()
        write_session(self.sessions, "s1",
                      [("pipeline v3 improves accuracy on x2", "paper A", "high")])
        r = self.engine.compile()
        self.assertEqual(r["stats"]["claims_added"], 0)
        self.assertEqual(r["stats"]["orphans"], 1)
        items = self.engine.review_items()
        orphan = next(i for i in items if i["item_type"] == "orphan_claims")
        g = self.engine.create_goal("新方向")
        out = self.engine.resolve_review(orphan["id"], "accepted",
                                         extra={"goal_id": g["root_id"]})
        self.assertEqual(len(self.engine.claims(goal_id=g["root_id"])), 1)

    # regression: orphans across many sessions -> exactly ONE review item
    def test_orphans_enqueued_once_across_sessions(self):
        self.engine.store.x("UPDATE goal SET status='abandoned'")
        self.engine.store.conn.commit()
        for i in range(3):
            write_session(self.sessions, f"s{i}",
                          [(f"finding number {i} about some topic", f"paper {i}", "high")])
        r = self.engine.compile()
        self.assertEqual(r["stats"]["orphans"], 3)
        orphan_items = [it for it in self.engine.review_items()
                        if it["item_type"] == "orphan_claims"]
        self.assertEqual(len(orphan_items), 1)                       # one item...
        self.assertEqual(len(orphan_items[0]["payload"]["candidates"]), 3)  # ...all 3 orphans

    # M2: same conclusion reworded -> merged, evidence union
    def test_cross_session_merge(self):
        write_session(self.sessions, "s1",
                      [("pipeline v3 improves accuracy on x2", "paper A", "high")])
        self.engine.compile()
        write_session(self.sessions, "s2",
                      [("(again) pipeline v3 improves accuracy on x2", "paper B",
                        "medium")])
        r = self.engine.compile()
        self.assertEqual(r["stats"]["claims_merged"], 1)
        claims = self.engine.claims(goal_id=self.goal["root_id"])
        self.assertEqual(len(claims), 1)
        detail = self.engine.claim_detail(claims[0]["id"])
        alive_sup = [s for s in detail["supports"] if s["edge_t_invalid"] is None]
        self.assertEqual(len(alive_sup), 2)          # two independent sources
        self.assertEqual(claims[0]["status"], "supported")
        self.assertEqual(len(detail["origins"]), 2)  # both sessions on record

    # regression: rewriting one merged session must not close another session's support
    def test_rewrite_one_session_preserves_other_support(self):
        write_session(self.sessions, "s1",
                      [("pipeline v3 improves accuracy on x2", "paper A", "high")])
        self.engine.compile()
        write_session(self.sessions, "s2",
                      [("(again) pipeline v3 improves accuracy on x2", "paper B",
                        "medium")])
        self.engine.compile()
        claim = self.engine.claims(goal_id=self.goal["root_id"])[0]
        before = self.engine.claim_detail(claim["id"])
        self.assertEqual(
            len([s for s in before["supports"] if s["edge_t_invalid"] is None]),
            2,
        )

        write_session(self.sessions, "s1",
                      [("something unrelated entirely", "paper D", "medium")])
        self.engine.compile()

        old = self.engine.store.q1("SELECT * FROM claim WHERE id=?", (claim["id"],))
        self.assertIsNone(old["t_invalid"])
        self.assertEqual(old["status"], "fragile")
        after = self.engine.claim_detail(claim["id"])
        alive_sup = [s for s in after["supports"] if s["edge_t_invalid"] is None]
        self.assertEqual(len(alive_sup), 1)
        self.assertEqual(alive_sup[0]["edge_meta"]["session"], "s2")

    # M3: contradiction -> rule adjudication, weaker invalidated, reason readable
    def test_conflict_adjudication(self):
        write_session(self.sessions, "s1",
                      [("pipeline v3 improves accuracy on x2", "paper A", "high"),
                       ("pipeline v3 improves accuracy on x2", "paper B", "high")])
        self.engine.compile()
        write_session(self.sessions, "s2",
                      [("pipeline v3 does not improve accuracy on x2", "blog C",
                        "low")])
        r = self.engine.compile()
        self.assertEqual(len(r["diff"]["conflicts"]), 1)
        self.assertTrue(r["diff"]["conflicts"][0]["resolved"])
        inv = r["diff"]["invalidated_claims"]
        self.assertEqual(len(inv), 1)
        self.assertIn("rule", inv[0]["why"])
        alive = self.engine.claims(goal_id=self.goal["root_id"])
        self.assertEqual(len(alive), 1)
        self.assertIn("improves", alive[0]["statement"])
        self.assertNotIn("does not", alive[0]["statement"])

    # incremental == full relabel (weekly safety net finds nothing)
    def test_full_check_clean(self):
        write_session(self.sessions, "s1",
                      [("pipeline v3 improves accuracy on x2", "paper A", "high")])
        self.engine.compile()
        self.assertTrue(self.engine.full_check()["clean"])

    # history rewrite: node id vanishes -> claim loses support -> invalidated
    def test_history_rewrite(self):
        write_session(self.sessions, "s1",
                      [("pipeline v3 improves accuracy on x2", "paper A", "high")])
        self.engine.compile()
        write_session(self.sessions, "s1",
                      [("something unrelated entirely", "paper D", "medium")])
        r = self.engine.compile()
        old = self.engine.store.q1(
            "SELECT * FROM claim WHERE statement LIKE 'pipeline v3 improves%'")
        self.assertEqual(old["status"], "invalidated")
        self.assertIsNotNone(old["t_invalid"])

    # fragile: single source only
    def test_fragile_single_source(self):
        write_session(self.sessions, "s1",
                      [("pipeline v3 improves accuracy on x2", "paper A", "high")])
        self.engine.compile()
        c = self.engine.claims(goal_id=self.goal["root_id"])[0]
        self.assertEqual(c["status"], "fragile")

    # goal versioning marks claims for re-attribution
    def test_goal_versioning(self):
        write_session(self.sessions, "s1",
                      [("pipeline v3 improves accuracy on x2", "paper A", "high")])
        self.engine.compile()
        g2 = self.engine.update_goal(self.goal["root_id"], title="新标题")
        self.assertEqual(g2["version"], 2)
        c = self.engine.claims(goal_id=self.goal["root_id"])[0]
        self.assertEqual(c["needs_regoal"], 1)
        tree = self.engine.goal_tree()
        self.assertEqual(tree[0]["title"], "新标题")

    # project analysis reuses evidence-dag dominator machinery
    def test_project_analysis(self):
        write_session(self.sessions, "s1",
                      [("pipeline v3 improves accuracy on x2", "paper A", "high")])
        self.engine.compile()
        a = self.engine.analysis()
        self.assertEqual(a["summary"]["n_sources"], 1)
        self.assertTrue(a["fragile"])  # single source -> structurally fragile

    def test_graph_filters_by_explicit_sessions_without_losing_provenance(self):
        write_session(self.sessions, "s1",
                      [("pipeline v3 improves accuracy on x2", "paper A", "high")])
        write_session(self.sessions, "s2",
                      [("pipeline v4 improves accuracy on y3", "paper B", "high")])
        self.engine.compile()

        graph = self.engine.graph(sessions=["s1"])

        self.assertEqual(graph["scope"]["sessions"], ["s1"])
        self.assertEqual([c["statement"] for c in graph["claims"]],
                         ["pipeline v3 improves accuracy on x2"])
        self.assertEqual(graph["claims"][0]["sessions"], ["s1"])
        self.assertEqual(len(graph["evidence"]), 1)
        self.assertIn("s1#", graph["evidence"][0]["content_ref"])

    def test_analysis_filters_by_explicit_sessions(self):
        write_session(self.sessions, "s1",
                      [("pipeline v3 improves accuracy on x2", "paper A", "high")])
        write_session(self.sessions, "s2",
                      [("pipeline v4 improves accuracy on y3", "paper B", "high")])
        self.engine.compile()

        a = self.engine.analysis(sessions=["s1"])

        self.assertEqual(a["scope"]["sessions"], ["s1"])
        self.assertEqual(a["summary"]["n_derived"], 1)
        self.assertEqual(a["summary"]["n_sources"], 1)

    def test_project_scoped_compile_does_not_fall_back_to_all_sessions(self):
        write_session(self.sessions, "s1",
                      [("pipeline v3 improves accuracy on x2", "paper A", "high")])
        write_session(self.sessions, "s2",
                      [("pipeline v4 improves accuracy on y3", "paper B", "high")])

        r = self.engine.compile(workspace_root="/tmp/project-a")

        self.assertEqual(r["diff"]["sessions"], [])
        self.assertEqual(r["stats"]["claims_added"], 0)

        self.engine.create_goal("项目 A", workspace_root="/tmp/project-a")
        r = self.engine.compile(workspace_root="/tmp/project-a", sessions=["s1"])

        self.assertEqual(r["diff"]["sessions"], ["s1"])
        self.assertEqual(r["stats"]["claims_added"], 1)

    def test_explicit_session_scope_filters_without_workspace_metadata(self):
        write_session(self.sessions, "s1",
                      [("pipeline v3 improves accuracy on x2", "paper A", "high")])
        write_session(self.sessions, "s2",
                      [("pipeline v4 improves accuracy on y3", "paper B", "high")])

        r = self.engine.compile(sessions=["s1"])
        graph = self.engine.graph(sessions=["s1"])

        self.assertEqual(r["diff"]["sessions"], ["s1"])
        self.assertEqual(graph["scope"]["strategy"], "explicit-sessions")
        self.assertEqual(graph["scope"]["sessions"], ["s1"])
        self.assertEqual([c["statement"] for c in graph["claims"]],
                         ["pipeline v3 improves accuracy on x2"])

    def test_goal_tree_uses_project_scoped_goals(self):
        project_goal = self.engine.create_goal("项目 A", workspace_root="/tmp/project-a")
        self.engine.create_goal("项目 B", workspace_root="/tmp/project-b")

        tree = self.engine.goal_tree(workspace_root="/tmp/project-a", sessions=["s1"])

        self.assertEqual([g["root_id"] for g in tree], [project_goal["root_id"]])


if __name__ == "__main__":
    unittest.main(verbosity=2)
