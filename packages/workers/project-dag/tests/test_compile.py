"""Offline end-to-end tests for the compile pipeline (StubJudge, no network).

Covers the M1-M3 acceptance criteria from the construction plan:
  * change a session -> compile -> claims appear, watermark advances,
    re-compiling is a no-op (idempotent)
  * same conclusion reworded in another session -> merged, not duplicated
  * injected contradiction -> weaker claim invalidated with a readable rule
  * incremental reconcile agrees with the full relabel (safety net diff empty)
  * history rewrite (vanished node id) -> old claim loses support, invalidated
  * human action registration + review queue + time machine snapshot
"""
from __future__ import annotations

import os
import re
import sys
import tempfile
import unittest

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

    def human_extract(p):
        return {"description": p["text"], "mentioned_entities": [],
                "happened_at": None}

    return StubJudge({"distill": distill, "entity_same": entity_same,
                      "claim_equiv": claim_equiv, "contradiction": contradiction,
                      "human_extract": human_extract})


def write_session(session_dir: str, sid: str, claims: list[tuple[str, str, str]]) -> None:
    """claims: [(claim_text, source_text, credibility)]"""
    g = ThreadGraph(sid)
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

    # human action + review + time machine
    def test_human_action_and_snapshot(self):
        out = self.engine.register_human_action("昨晚在服务器跑通了 pipeline v3")
        self.assertEqual(out["attestation_method"], "self_report")
        pend = self.engine.review_items()
        self.assertTrue(any(i["item_type"] == "human_evidence" for i in pend))
        write_session(self.sessions, "s1",
                      [("pipeline v3 improves accuracy on x2", "paper A", "high")])
        self.engine.compile()
        snap_now = self.engine.snapshot("2999-01-01T00:00:00Z")
        self.assertEqual(len(snap_now["claims"]), 1)
        snap_past = self.engine.snapshot("2000-01-01T00:00:00Z")
        self.assertEqual(len(snap_past["claims"]), 0)

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

    # weekly report carries claim ids on every progress line
    def test_weekly_report(self):
        write_session(self.sessions, "s1",
                      [("pipeline v3 improves accuracy on x2", "paper A", "high")])
        self.engine.compile()
        rep = self.engine.weekly_report("2000-01-01", "2999-01-01")
        self.assertEqual(len(rep["added"]), 1)
        cid = rep["added"][0]["id"]
        self.assertIn(f"[{cid}]", rep["markdown"])

    # project analysis reuses evidence-dag dominator machinery
    def test_project_analysis(self):
        write_session(self.sessions, "s1",
                      [("pipeline v3 improves accuracy on x2", "paper A", "high")])
        self.engine.compile()
        a = self.engine.analysis()
        self.assertEqual(a["summary"]["n_sources"], 1)
        self.assertTrue(a["fragile"])  # single source -> structurally fragile


if __name__ == "__main__":
    unittest.main(verbosity=2)
