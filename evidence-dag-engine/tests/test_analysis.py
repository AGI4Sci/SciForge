"""Offline unit tests for load-bearing / fragility analysis (no LLM, no network).
Run: python -m unittest from the evidence-dag-engine/ directory."""
from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from evidence_dag.analysis import analyze  # noqa: E402
from evidence_dag.graph import ThreadGraph  # noqa: E402
from evidence_dag.model import EdgeRel, NodeType  # noqa: E402


def _g():
    return ThreadGraph("t")


def _src(g, txt):
    return g.add_or_get_node(NodeType.SOURCE, txt).id


def _rea(g, txt):
    return g.add_or_get_node(NodeType.REASONING, txt).id


def _claim(g, txt):
    return g.add_or_get_node(NodeType.CLAIM, txt).id


def _sup(g, s, d, nu=0.9):
    g.add_edge(s, d, EdgeRel.SUPPORTS, nli_score=nu)


def _con(g, s, d):
    g.add_edge(s, d, EdgeRel.CONTRADICTS)


class TestFragility(unittest.TestCase):
    def test_single_source_is_spof_and_fragile(self):
        g = _g()
        s = _src(g, "Paper A reports X.")
        c = _claim(g, "X holds.")
        _sup(g, s, c)
        r = analyze(g)
        frag = {f["id"]: f for f in r["fragile"]}
        self.assertIn(c, frag)
        self.assertEqual(frag[c]["n_sources"], 1)
        self.assertEqual(frag[c]["spof"], [s])  # removing s ungrounds c

    def test_two_independent_sources_is_robust(self):
        g = _g()
        s1, s2 = _src(g, "Paper A."), _src(g, "Paper B.")
        c = _claim(g, "Y holds.")
        _sup(g, s1, c)
        _sup(g, s2, c)
        r = analyze(g)
        self.assertNotIn(c, {f["id"] for f in r["fragile"]})  # no SPOF, strong, uncontested
        self.assertEqual(r["summary"]["n_robust"], 1)

    def test_pivotal_reasoning_is_spof(self):
        g = _g()
        s = _src(g, "Paper A.")
        rno = _rea(g, "Weigh A.")
        c = _claim(g, "Z holds.")
        _sup(g, s, rno)
        _sup(g, rno, c)
        r = analyze(g)
        frag = {f["id"]: f for f in r["fragile"]}
        # every evidence path to c passes through BOTH the reasoning step and the source
        self.assertEqual(set(frag[c]["spof"]), {rno, s})

    def test_ungrounded_claim_flagged(self):
        g = _g()
        c = _claim(g, "Unsupported assertion.")
        r = analyze(g)
        frag = {f["id"]: f for f in r["fragile"]}
        self.assertEqual(frag[c]["n_sources"], 0)
        self.assertTrue(any("ungrounded" in reason for reason in frag[c]["reasons"]))

    def test_contested_claim_flagged(self):
        g = _g()
        s1, s2 = _src(g, "Supports it."), _src(g, "Refutes it.")
        c = _claim(g, "Contested claim.")
        _sup(g, s1, c)
        _sup(g, s2, c)            # 2 sources -> not SPOF-fragile on its own
        _con(g, s2, c)            # but a contradicts edge is attached
        r = analyze(g)
        frag = {f["id"]: f for f in r["fragile"]}
        self.assertIn(c, frag)
        self.assertTrue(frag[c]["contested"])

    def test_weak_support_alone_is_not_fragile(self):
        # weak ν is NOT fragility (it's shown by edge labels + Soundness). Two
        # independent sources, both weak, uncontested -> structurally fine.
        g = _g()
        s1, s2 = _src(g, "A."), _src(g, "B.")
        c = _claim(g, "Weakly supported but multi-source.")
        _sup(g, s1, c, nu=0.2)
        _sup(g, s2, c, nu=0.2)
        r = analyze(g)
        self.assertNotIn(c, {f["id"] for f in r["fragile"]})

    def test_single_source_reasoning_not_fragile(self):
        # a reasoning step built on one source is normal plumbing, not fragile;
        # only single-source CLAIMS are flagged.
        g = _g()
        s = _src(g, "Paper A.")
        rno = _rea(g, "Infer from A.")
        _sup(g, s, rno)
        r = analyze(g)
        self.assertNotIn(rno, {f["id"] for f in r["fragile"]})


class TestHiddenSharedSource(unittest.TestCase):
    def test_two_paths_one_source_is_pseudo_robust(self):
        # claim LOOKS doubly-supported (2 incoming edges via 2 reasoning steps),
        # but both reasoning steps trace back to the SAME source ->假鲁棒.
        g = _g()
        s = _src(g, "Single keystone paper.")
        r1, r2 = _rea(g, "Angle one on the paper."), _rea(g, "Angle two on the paper.")
        c = _claim(g, "Robust-looking claim.")
        _sup(g, s, r1)
        _sup(g, s, r2)
        _sup(g, r1, c)
        _sup(g, r2, c)
        r = analyze(g)
        pr = {p["id"]: p for p in r["pseudo_robust"]}
        self.assertIn(c, pr)
        self.assertEqual(pr[c]["n_support_edges"], 2)   # looks like 2 supports
        self.assertEqual(pr[c]["shared_source"], [s])   # really 1 source
        self.assertEqual(r["summary"]["n_pseudo_robust"], 1)
        # and it is flagged fragile with the pseudo-robust reason
        frag = {f["id"]: f for f in r["fragile"]}
        self.assertIn(c, frag)
        self.assertTrue(frag[c]["pseudo_robust"])
        self.assertTrue(any("pseudo-robust" in why for why in frag[c]["reasons"]))

    def test_two_paths_two_sources_not_pseudo_robust(self):
        # genuinely independent: 2 reasoning steps, each on its OWN source.
        g = _g()
        s1, s2 = _src(g, "Paper A."), _src(g, "Paper B.")
        r1, r2 = _rea(g, "From A."), _rea(g, "From B.")
        c = _claim(g, "Truly robust.")
        _sup(g, s1, r1)
        _sup(g, s2, r2)
        _sup(g, r1, c)
        _sup(g, r2, c)
        r = analyze(g)
        self.assertEqual(r["pseudo_robust"], [])
        self.assertEqual(r["summary"]["n_pseudo_robust"], 0)
        self.assertNotIn(c, {f["id"] for f in r["fragile"]})  # no SPOF, multi-source


class TestLoadBearing(unittest.TestCase):
    def test_source_bearing_many_conclusions_ranks_first(self):
        g = _g()
        s = _src(g, "Keystone study.")
        c1, c2, c3 = _claim(g, "C1."), _claim(g, "C2."), _claim(g, "C3.")
        for c in (c1, c2, c3):
            _sup(g, s, c)
        r = analyze(g)
        self.assertEqual(r["summary"]["top_load_bearing"], s)
        self.assertEqual(r["summary"]["max_critical_count"], 3)
        top = r["load_bearing"][0]
        self.assertEqual(set(top["critical_for"]), {c1, c2, c3})

    def test_independent_source_not_load_bearing(self):
        # if a claim has two sources, neither alone is a single point of failure
        g = _g()
        s1, s2 = _src(g, "A."), _src(g, "B.")
        c = _claim(g, "C.")
        _sup(g, s1, c)
        _sup(g, s2, c)
        r = analyze(g)
        self.assertEqual(r["load_bearing"], [])  # nothing dominates c

    def test_empty_graph_is_safe(self):
        r = analyze(_g())
        self.assertEqual(r["load_bearing"], [])
        self.assertEqual(r["fragile"], [])
        self.assertEqual(r["summary"]["n_sources"], 0)


if __name__ == "__main__":
    unittest.main()
