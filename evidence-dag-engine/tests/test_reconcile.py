"""Offline unit tests for the reconcile / what-if 扰动 engine (no LLM, no network).
Run: python -m unittest from the evidence-dag-engine/ directory."""
from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from evidence_dag.graph import ThreadGraph  # noqa: E402
from evidence_dag.model import EdgeRel, NodeType  # noqa: E402
from evidence_dag.reconcile import reconcile  # noqa: E402


def _g():
    return ThreadGraph("t")


def _src(g, txt):
    return g.add_or_get_node(NodeType.SOURCE, txt).id


def _rea(g, txt):
    return g.add_or_get_node(NodeType.REASONING, txt).id


def _claim(g, txt):
    return g.add_or_get_node(NodeType.CLAIM, txt).id


def _sup(g, s, d, nu=0.9):
    return g.add_edge(s, d, EdgeRel.SUPPORTS, nli_score=nu)


def _con(g, s, d):
    return g.add_edge(s, d, EdgeRel.CONTRADICTS)


class TestReconcile(unittest.TestCase):
    def test_remove_only_source_invalidates_claim(self):
        g = _g()
        s = _src(g, "Paper A reports X.")
        c = _claim(g, "X holds.")
        _sup(g, s, c)
        r = reconcile(g, remove_nodes=[s])
        inv = {e["id"] for e in r["invalidated"]}
        self.assertIn(c, inv)
        e = next(x for x in r["invalidated"] if x["id"] == c)
        self.assertEqual(e["lost_sources"], [s])      # broken-chain explanation
        self.assertEqual(r["summary"]["n_invalidated"], 1)

    def test_redundant_source_removal_does_not_invalidate(self):
        # two independent sources -> removing one weakens at most, never collapses
        g = _g()
        s1, s2 = _src(g, "Paper A."), _src(g, "Paper B.")
        c = _claim(g, "Y holds.")
        _sup(g, s1, c)
        _sup(g, s2, c)
        r = reconcile(g, remove_nodes=[s1])
        self.assertEqual(r["summary"]["n_invalidated"], 0)  # s2 still backs c

    def test_invalidation_propagates_downstream(self):
        # s -> r -> c : removing s collapses BOTH the reasoning and the claim
        g = _g()
        s = _src(g, "Paper A.")
        rno = _rea(g, "Weigh A.")
        c = _claim(g, "Z holds.")
        _sup(g, s, rno)
        _sup(g, rno, c)
        r = reconcile(g, remove_nodes=[s])
        inv = {e["id"] for e in r["invalidated"]}
        self.assertEqual(inv, {rno, c})
        self.assertGreaterEqual(r["summary"]["affected_subgraph_size"], 3)

    def test_remove_edge_weakens_below_threshold(self):
        # c backed by one strong + (after removal) nothing -> drops to unverified
        g = _g()
        s1, s2 = _src(g, "A."), _src(g, "B.")
        c = _claim(g, "W holds.")
        e1 = _sup(g, s1, c, nu=0.95)
        _sup(g, s2, c, nu=0.4)
        # removing the strong edge leaves only the weak one (0.4 < 0.7)
        r = reconcile(g, remove_edges=[e1.id])
        # still reaches a source (s2) so it's weakened, not invalidated
        self.assertEqual(r["summary"]["n_invalidated"], 0)
        weak = {e["id"] for e in r["weakened"]}
        self.assertIn(c, weak)

    def test_add_contradiction_marks_conflicting(self):
        g = _g()
        s1, s2 = _src(g, "Supports it."), _src(g, "Counter-evidence.")
        c = _claim(g, "Contested claim.")
        _sup(g, s1, c)
        _sup(g, s2, c)
        r = reconcile(g, add_contradicts=[c])
        conf = {e["id"] for e in r["now_conflicting"]}
        self.assertIn(c, conf)

    def test_unrelated_branch_unaffected(self):
        g = _g()
        s1 = _src(g, "Paper A.")
        c1 = _claim(g, "Claim 1.")
        _sup(g, s1, c1)
        s2 = _src(g, "Paper B.")
        c2 = _claim(g, "Claim 2.")
        _sup(g, s2, c2)
        r = reconcile(g, remove_nodes=[s1])
        ids = {e["id"] for e in r["invalidated"]}
        self.assertIn(c1, ids)
        self.assertNotIn(c2, ids)              # c2's branch untouched
        self.assertNotIn(c2, set())            # sanity

    def test_no_op_perturbation_is_empty_diff(self):
        g = _g()
        s = _src(g, "A.")
        c = _claim(g, "C.")
        _sup(g, s, c)
        r = reconcile(g)  # nothing removed
        self.assertEqual(r["summary"]["blast_radius"], 0)
        self.assertEqual(r["invalidated"], [])

    def test_removing_unknown_node_is_safe(self):
        g = _g()
        s = _src(g, "A.")
        c = _claim(g, "C.")
        _sup(g, s, c)
        r = reconcile(g, remove_nodes=["source:doesnotexist"])
        self.assertEqual(r["summary"]["blast_radius"], 0)


if __name__ == "__main__":
    unittest.main()
