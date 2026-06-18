"""COMPREHENSIVE end-to-end test (offline, no network).

One realistic scientific thread that deliberately contains every structural
shape the engine must handle, then asserts the WHOLE surface in one place:

  extractor  -> shared-node dedup, dangling-edge drop, contradicts exposed
  verifier   -> ν filled, noisy-OR status, ungrounded stays unverified
  metrics    -> coverage (<1 because one claim is ungrounded), soundness,
                contradiction transparency
  analysis   -> load-bearing (dominator of >=2), fragility (single/contested/
                ungrounded), HIDDEN SHARED SOURCE (假鲁棒)
  reconcile  -> what-if: keystone removal collapses its dependents; redundant
                source removal collapses nothing; removing the contradictor
                RESTORES the conflicted claim
  graph      -> provenance path, cycle report
  provjson   -> lossless round-trip (incl. ν)

The scenario (a cardiology evidence thread):
  S_key      Keystone RCT (TRIAL-2020)          [load-bearing + shared source]
  S_coh1/2   Two independent cohort studies      [give a genuinely robust claim]
  S_obs      A single observational study        [single-source claim]
  S_counter  A study that contradicts C_contested

  R_a, R_b   Two reasoning angles, BOTH off S_key  (=> C_pseudo looks 2-supported)
  C_pseudo   "looks multi-supported but funnels through S_key"   [pseudo-robust]
  C_single   backed only by S_key directly                       [single source]
  C_robust   backed independently by S_coh1 AND S_coh2           [robust]
  C_contested backed by S_obs, contradicted by S_counter         [contested]
  C_ungrounded no incoming evidence at all                       [ungrounded]

Run: python -m unittest tests.test_comprehensive -v   (from evidence-dag-engine/)
"""
from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from evidence_dag import analysis, provjson, reconcile  # noqa: E402
from evidence_dag.extractor import build_graph  # noqa: E402
from evidence_dag.metrics import all_metrics  # noqa: E402
from evidence_dag.model import EdgeRel, NodeStatus, NodeType  # noqa: E402
from evidence_dag.verifier import verify  # noqa: E402


class StrongLLM:
    """Deterministic NLI judge: every supports edge entails at 0.9. Keeps the
    test about STRUCTURE (who supports whom) rather than scoring nuance — every
    scored claim clears the 0.7 bar, so status is driven purely by topology."""
    def chat(self, messages, *, temperature=0.0, max_tokens=2048):
        return '{"entailment": 0.9, "label": "entailment"}'


# Parsed extractor payload. `s_key_dup` repeats S_key's content on purpose — it
# MUST collapse to one shared node. The `ghost` edge is dangling — it MUST drop.
PARSED = {
    "nodes": [
        {"tmp_id": "s_key", "type": "source", "trace_ref": "step-3",
         "content": "Keystone RCT (TRIAL-2020): intensive lipid lowering cut major cardiac events.",
         "ref": {"doi": "10.1000/trial2020"}},
        {"tmp_id": "s_key_dup", "type": "source", "trace_ref": "step-11",
         "content": "Keystone RCT (TRIAL-2020): intensive lipid lowering cut major cardiac events."},
        {"tmp_id": "s_coh1", "type": "source", "content": "Cohort study A links statin use to fewer events.", "trace_ref": "step-5"},
        {"tmp_id": "s_coh2", "type": "source", "content": "Cohort study B independently links statin use to fewer events.", "trace_ref": "step-6"},
        {"tmp_id": "s_obs", "type": "source", "content": "A single observational study suggests a niche benefit.", "trace_ref": "step-7"},
        {"tmp_id": "s_counter", "type": "source", "content": "A later study found no such niche benefit.", "trace_ref": "step-9"},
        {"tmp_id": "r_a", "type": "reasoning", "content": "Angle A: the trial effect is dose-responsive.", "trace_ref": "step-12"},
        {"tmp_id": "r_b", "type": "reasoning", "content": "Angle B: the trial effect survives covariate adjustment.", "trace_ref": "step-13"},
        {"tmp_id": "c_pseudo", "type": "claim", "content": "Intensive lipid lowering reduces cardiac events.", "trace_ref": "step-14"},
        {"tmp_id": "c_single", "type": "claim", "content": "The trial supports a specific LDL target.", "trace_ref": "step-15"},
        {"tmp_id": "c_robust", "type": "claim", "content": "Statin use is associated with fewer cardiac events.", "trace_ref": "step-16"},
        {"tmp_id": "c_contested", "type": "claim", "content": "There is a niche subgroup benefit.", "trace_ref": "step-17"},
        {"tmp_id": "c_ungrounded", "type": "claim", "content": "An unsupported leap with no cited evidence.", "trace_ref": "step-18"},
    ],
    "edges": [
        # pseudo-robust: c_pseudo has TWO incoming edges, but both reasoning
        # angles trace back to the SAME source (s_key) -> hidden shared source.
        {"src": "s_key", "dst": "r_a", "rel": "supports"},
        {"src": "s_key", "dst": "r_b", "rel": "supports"},
        {"src": "r_a", "dst": "c_pseudo", "rel": "supports"},
        {"src": "r_b", "dst": "c_pseudo", "rel": "supports"},
        # single-source claim straight off the keystone
        {"src": "s_key", "dst": "c_single", "rel": "supports"},
        # genuinely robust: two independent sources
        {"src": "s_coh1", "dst": "c_robust", "rel": "supports"},
        {"src": "s_coh2", "dst": "c_robust", "rel": "supports"},
        # contested: supported by s_obs, contradicted by s_counter (exposed, not adjudicated)
        {"src": "s_obs", "dst": "c_contested", "rel": "supports"},
        {"src": "s_counter", "dst": "c_contested", "rel": "contradicts"},
        # dangling edge -> must be dropped by the graph layer
        {"src": "s_key", "dst": "ghost", "rel": "supports"},
        # c_ungrounded intentionally has NO incoming edge
    ],
}


class TestComprehensiveEndToEnd(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.g = build_graph(PARSED, "comprehensive")
        # find content-addressed ids by tmp content so assertions are readable
        def nid(ntype, needle):
            for n in cls.g.nodes.values():
                if n.type == ntype and needle in n.content:
                    return n.id
            raise AssertionError(f"node not found: {ntype} ~ {needle}")
        cls.S_key = nid(NodeType.SOURCE, "Keystone RCT")
        cls.S_coh1 = nid(NodeType.SOURCE, "Cohort study A")
        cls.S_obs = nid(NodeType.SOURCE, "single observational")
        cls.S_counter = nid(NodeType.SOURCE, "no such niche")
        cls.C_pseudo = nid(NodeType.CLAIM, "Intensive lipid")
        cls.C_single = nid(NodeType.CLAIM, "specific LDL target")
        cls.C_robust = nid(NodeType.CLAIM, "Statin use is associated")
        cls.C_contested = nid(NodeType.CLAIM, "niche subgroup benefit")
        cls.C_ungrounded = nid(NodeType.CLAIM, "unsupported leap")
        cls.verify_diff = verify(cls.g, StrongLLM(), threshold=0.7)
        cls.an = analysis.analyze(cls.g, threshold=0.7)

    # --- 1. extractor: dedup + dangling drop + contradicts -----------------
    def test_extractor_shared_node_dedup(self):
        # s_key + s_key_dup share content -> ONE shared node (DAG, not tree).
        # 6 source payload entries, 2 of which are identical -> 5 unique sources.
        self.assertEqual(len(self.g.nodes_of(NodeType.SOURCE)), 5)
        self.assertEqual(len(self.g.nodes), 12)  # 5 src + 2 reasoning + 5 claim

    def test_extractor_dangling_edge_dropped(self):
        self.assertNotIn("ghost", self.g.nodes)
        # 9 real edges survive (1 dangling 'ghost' supports edge dropped)
        self.assertEqual(len(self.g.edges), 9)

    def test_contradicts_exposed_not_resolved(self):
        cons = self.g.edges_of(EdgeRel.CONTRADICTS)
        self.assertEqual(len(cons), 1)
        self.assertEqual(cons[0].dst, self.C_contested)

    def test_acyclic(self):
        self.assertTrue(self.g.detect_cycles()["acyclic"])

    # --- 2. verifier: ν filled, status by topology -------------------------
    def test_scored_claims_supported_ungrounded_not(self):
        st = {nid: n.status for nid, n in self.g.nodes.items()}
        for c in (self.C_pseudo, self.C_single, self.C_robust):
            self.assertEqual(st[c], NodeStatus.SUPPORTED, c)
        # supported AND credibly contradicted -> conflicting (contested), not plain supported
        self.assertEqual(st[self.C_contested], NodeStatus.CONFLICTING)
        # no incoming supports edge -> never scored -> stays unverified
        self.assertEqual(st[self.C_ungrounded], NodeStatus.UNVERIFIED)

    def test_every_supports_edge_scored(self):
        for e in self.g.edges_of(EdgeRel.SUPPORTS):
            self.assertIsNotNone(e.nli_score)

    # --- 3. metrics --------------------------------------------------------
    def test_metrics(self):
        m = all_metrics(self.g)
        # 7 derived (2 reasoning + 5 claims); only c_ungrounded fails to reach a
        # source -> coverage = 6/7.
        self.assertAlmostEqual(m["provenance_coverage"], 6 / 7, places=3)
        self.assertGreater(m["provenance_soundness"], 0.7)        # all edges 0.9
        self.assertEqual(m["contradiction_transparency"]["ratio"], 1.0)
        self.assertEqual(m["contradiction_transparency"]["total"], 1)

    # --- 4. analysis: load-bearing / fragility / pseudo-robust -------------
    def test_load_bearing_keystone(self):
        lb = {x["id"]: x for x in self.an["load_bearing"]}
        self.assertIn(self.S_key, lb)
        # s_key dominates both reasoning angles + the pseudo claim + the single-source claim
        self.assertTrue({self.C_pseudo, self.C_single}.issubset(set(lb[self.S_key]["critical_for"])))
        self.assertGreaterEqual(lb[self.S_key]["critical_count"], 4)
        self.assertEqual(self.an["summary"]["top_load_bearing"], self.S_key)

    def test_hidden_shared_source(self):
        pr = {x["id"]: x for x in self.an["pseudo_robust"]}
        self.assertIn(self.C_pseudo, pr)                      # the 假鲁棒 claim
        self.assertEqual(pr[self.C_pseudo]["n_support_edges"], 2)   # looks 2-supported
        self.assertEqual(pr[self.C_pseudo]["shared_source"], [self.S_key])  # really 1 source
        self.assertEqual(self.an["summary"]["n_pseudo_robust"], 1)

    def test_fragility_set(self):
        frag = {x["id"]: x for x in self.an["fragile"]}
        # fragile: pseudo (hidden shared src), single source, contested, ungrounded
        self.assertIn(self.C_pseudo, frag)
        self.assertIn(self.C_single, frag)
        self.assertIn(self.C_contested, frag)
        self.assertIn(self.C_ungrounded, frag)
        # robust claim (2 independent sources, uncontested) is NOT fragile
        self.assertNotIn(self.C_robust, frag)
        self.assertTrue(any("pseudo-robust" in r for r in frag[self.C_pseudo]["reasons"]))
        self.assertTrue(frag[self.C_contested]["contested"])

    def test_robust_claim_counted(self):
        self.assertGreaterEqual(self.an["summary"]["n_robust"], 1)

    # --- 5. reconcile: what-if perturbation --------------------------------
    def test_remove_keystone_collapses_dependents(self):
        r = reconcile.reconcile(self.g, remove_nodes=[self.S_key])
        inv = {x["id"] for x in r["invalidated"]}
        # everything funneling through s_key collapses; the robust + contested
        # branches (other sources) survive.
        self.assertIn(self.C_pseudo, inv)
        self.assertIn(self.C_single, inv)
        self.assertNotIn(self.C_robust, inv)
        self.assertNotIn(self.C_contested, inv)
        # broken-chain explanation present
        e = next(x for x in r["invalidated"] if x["id"] == self.C_single)
        self.assertEqual(e["lost_sources"], [self.S_key])
        self.assertGreaterEqual(r["summary"]["affected_subgraph_size"], 4)

    def test_remove_redundant_source_collapses_nothing(self):
        r = reconcile.reconcile(self.g, remove_nodes=[self.S_coh1])
        self.assertEqual(r["summary"]["n_invalidated"], 0)   # s_coh2 still backs c_robust
        # still ≥ threshold after losing one strong edge -> not even weakened
        self.assertEqual(r["summary"]["n_weakened"], 0)

    def test_remove_contradictor_restores_conflicted_claim(self):
        # baseline: c_contested has a supports edge AND a contradicts edge -> conflicting.
        r = reconcile.reconcile(self.g, remove_nodes=[self.S_counter])
        restored = {x["id"] for x in r["restored"]}
        self.assertIn(self.C_contested, restored)

    def test_no_op_perturbation_empty(self):
        r = reconcile.reconcile(self.g)
        self.assertEqual(r["summary"]["blast_radius"], 0)

    # --- 6. provenance -----------------------------------------------------
    def test_provenance_pseudo_reaches_keystone(self):
        p = self.g.provenance_path(self.C_pseudo)
        self.assertTrue(p["reaches_source"])
        self.assertIn(self.S_key, p["source_leaves"])
        # the subtree is exactly s_key, r_a, r_b, c_pseudo
        self.assertEqual(set(n["id"] for n in p["nodes"]),
                         {self.S_key, self.C_pseudo} | {n.id for n in self.g.nodes.values()
                          if n.type == NodeType.REASONING})

    def test_ungrounded_has_no_source(self):
        self.assertFalse(self.g.provenance_path(self.C_ungrounded)["reaches_source"])

    # --- 7. PROV-JSON lossless round-trip ----------------------------------
    def test_provjson_roundtrip(self):
        doc = provjson.to_prov_json(self.g)
        g2 = provjson.from_prov_json(doc)
        self.assertEqual(len(g2.nodes), len(self.g.nodes))
        self.assertEqual(len(g2.edges), len(self.g.edges))
        # ν preserved on supports edges
        nu_before = sorted(e.nli_score for e in self.g.edges_of(EdgeRel.SUPPORTS))
        nu_after = sorted(e.nli_score for e in g2.edges_of(EdgeRel.SUPPORTS))
        self.assertEqual(nu_before, nu_after)
        # analysis on the reloaded graph is identical (deterministic, no LLM)
        self.assertEqual(analysis.analyze(g2)["summary"], self.an["summary"])


if __name__ == "__main__":
    unittest.main()
