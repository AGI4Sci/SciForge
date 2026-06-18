"""Offline unit tests (stub LLM, no network). Run: python -m unittest -v
from the evidence-dag-engine/ directory."""
from __future__ import annotations

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from evidence_dag import provjson  # noqa: E402
from evidence_dag.extractor import build_graph, render_trace  # noqa: E402
from evidence_dag.graph import ThreadGraph  # noqa: E402
from evidence_dag.llm import StubLLM  # noqa: E402
from evidence_dag.metrics import all_metrics  # noqa: E402
from evidence_dag.model import EdgeRel, NodeStatus, NodeType  # noqa: E402
from evidence_dag.service import Engine  # noqa: E402
from evidence_dag.verifier import noisy_or, split_sentences, verify  # noqa: E402

# A small parsed-extractor payload reused across tests. Note s_dup repeats s1's
# content -> must collapse to one shared node (DAG, not tree).
PARSED = {
    "nodes": [
        {"tmp_id": "s1", "type": "source", "content": "Paper A reports X.", "trace_ref": "step-4",
         "ref": {"doi": "10.1/a"}},
        {"tmp_id": "s_dup", "type": "source", "content": "Paper A reports X.", "trace_ref": "step-9"},
        {"tmp_id": "s2", "type": "source", "content": "Paper B reports not-X.", "trace_ref": "step-7"},
        {"tmp_id": "r1", "type": "reasoning", "content": "Weigh A against B.", "trace_ref": "step-10",
         "reasoning_type": "synthesis"},
        {"tmp_id": "c1", "type": "claim", "content": "X is probably false.", "trace_ref": "step-15"},
        {"tmp_id": "bad", "type": "notatype", "content": "ignored"},
    ],
    "edges": [
        {"src": "s1", "dst": "r1", "rel": "supports"},
        {"src": "s2", "dst": "r1", "rel": "supports"},
        {"src": "r1", "dst": "c1", "rel": "supports"},
        {"src": "s1", "dst": "s2", "rel": "contradicts"},
        {"src": "s1", "dst": "ghost", "rel": "supports"},
    ],
}


class TestExtractorBuild(unittest.TestCase):
    def setUp(self):
        self.g = build_graph(PARSED, "t1")

    def test_shared_node_dedup(self):
        # s1 and s_dup share content -> one node; bad type dropped -> 4 nodes
        self.assertEqual(len(self.g.nodes), 4)
        self.assertEqual(len(self.g.nodes_of(NodeType.SOURCE)), 2)

    def test_dangling_edge_dropped(self):
        # the 'ghost' edge has no node; 4 real edges remain
        self.assertEqual(len(self.g.edges), 4)

    def test_contradicts_extracted_not_resolved(self):
        self.assertEqual(len(self.g.edges_of(EdgeRel.CONTRADICTS)), 1)

    def test_trace_ref_preserved(self):
        claim = self.g.nodes_of(NodeType.CLAIM)[0]
        self.assertEqual(claim.trace_ref, "step-15")


class TestProvJsonRoundTrip(unittest.TestCase):
    def test_lossless(self):
        g = build_graph(PARSED, "t1")
        verify(g, StubLLM(nli_handler=lambda p, h: 0.9))  # add ν so edges carry scores
        reloaded = provjson.loads(provjson.dumps(g))
        self.assertEqual(g.to_dict(), reloaded.to_dict())
        self.assertEqual(g.thread_id, reloaded.thread_id)


class TestGraphOps(unittest.TestCase):
    def test_cycle_detection(self):
        g = ThreadGraph("c")
        a = g.add_or_get_node(NodeType.CLAIM, "A")
        b = g.add_or_get_node(NodeType.CLAIM, "B")
        g.add_edge(a.id, b.id, EdgeRel.SUPPORTS)
        g.add_edge(b.id, a.id, EdgeRel.SUPPORTS)
        rep = g.detect_cycles()
        self.assertFalse(rep["acyclic"])
        self.assertEqual(rep["cycle_count"], 1)

    def test_provenance_reaches_source(self):
        g = build_graph(PARSED, "t1")
        c1 = g.nodes_of(NodeType.CLAIM)[0]
        path = g.provenance_path(c1.id)
        self.assertTrue(path["reaches_source"])
        # claim -> reasoning -> {2 sources}: 3 supports edges on the path
        self.assertEqual(len([e for e in path["edges"] if e["rel"] == "supports"]), 3)


class TestVerifier(unittest.TestCase):
    def test_noisy_or(self):
        self.assertAlmostEqual(noisy_or([0.5, 0.5]), 0.75)
        self.assertAlmostEqual(noisy_or([]), 0.0)

    def test_split_sentences(self):
        self.assertEqual(len(split_sentences("A is true. B is false.")), 2)

    def test_status_assignment_high_vs_low(self):
        g_hi = build_graph(PARSED, "hi")
        verify(g_hi, StubLLM(nli_handler=lambda p, h: 0.95), threshold=0.7)
        self.assertEqual(g_hi.nodes_of(NodeType.CLAIM)[0].status, NodeStatus.SUPPORTED)

        g_lo = build_graph(PARSED, "lo")
        verify(g_lo, StubLLM(nli_handler=lambda p, h: 0.1), threshold=0.7)
        self.assertEqual(g_lo.nodes_of(NodeType.CLAIM)[0].status, NodeStatus.UNVERIFIED)


class TestMetrics(unittest.TestCase):
    def test_metrics_shape_and_coverage(self):
        g = build_graph(PARSED, "t1")
        verify(g, StubLLM(nli_handler=lambda p, h: 0.9))
        m = all_metrics(g)
        self.assertEqual(m["provenance_coverage"], 1.0)  # both derived nodes reach a source
        self.assertGreater(m["provenance_soundness"], 0.8)
        self.assertEqual(m["contradiction_transparency"]["total"], 1)
        self.assertGreater(m["audit_effort"], 0.0)


class TestEngineAndPersistence(unittest.TestCase):
    def test_ingest_verify_persist_reload(self):
        import tempfile
        extract_json = '{"nodes":[{"tmp_id":"s","type":"source","content":"E.","trace_ref":"step-1"},' \
                       '{"tmp_id":"c","type":"claim","content":"C.","trace_ref":"step-2"}],' \
                       '"edges":[{"src":"s","dst":"c","rel":"supports"}]}'
        with tempfile.TemporaryDirectory() as d:
            eng = Engine(StubLLM(extract_response=extract_json, nli_handler=lambda p, h: 0.9),
                         storage_dir=d)
            eng.ingest_trace("tx", [{"id": "step-1", "type": "message", "content": "hi"}])
            eng.verify("tx")
            self.assertTrue(os.path.exists(os.path.join(d, "tx.prov.json")))
            # fresh engine reads it back from disk
            eng2 = Engine(StubLLM(), storage_dir=d)
            g = eng2.get("tx")
            self.assertIsNotNone(g)
            self.assertEqual(len(g.nodes), 2)


class TestRenderTrace(unittest.TestCase):
    def test_render_includes_step_ids(self):
        import json
        with open(os.path.join(os.path.dirname(__file__), "fixtures", "lk99_trace.json"), encoding="utf-8") as fh:
            fx = json.load(fh)
        rendered = render_trace(fx["trace"])
        self.assertIn("[step-1]", rendered)
        self.assertIn("arXiv:2307.12008", rendered)


class _SequencedLLM:
    """Stub that returns a different extract payload per ingest call (to simulate
    successive conversation turns), while answering NLI from a fixed handler."""

    def __init__(self, extract_responses, nli=0.9):
        self._extracts = list(extract_responses)
        self._nli = nli

    def chat(self, messages, *, temperature=0.0, max_tokens=2048):
        system = next((m["content"] for m in messages if m["role"] == "system"), "")
        if "EDAG-TASK: nli" in system:
            return json.dumps({"entailment": self._nli, "label": "entailment"})
        return self._extracts.pop(0) if self._extracts else "{}"


class TestIncrementalMerge(unittest.TestCase):
    """merge=True accumulates each turn into one growing per-thread DAG."""

    TURN1 = ('{"nodes":[{"tmp_id":"s1","type":"source","content":"Source one.","trace_ref":"t1"},'
             '{"tmp_id":"c1","type":"claim","content":"Claim one.","trace_ref":"t1"}],'
             '"edges":[{"src":"s1","dst":"c1","rel":"supports"}]}')
    # Turn 2 re-mentions Source one (must dedup to the SAME node) and adds C2.
    TURN2 = ('{"nodes":[{"tmp_id":"s1","type":"source","content":"Source one.","trace_ref":"t2"},'
             '{"tmp_id":"s2","type":"source","content":"Source two.","trace_ref":"t2"},'
             '{"tmp_id":"c2","type":"claim","content":"Claim two.","trace_ref":"t2"}],'
             '"edges":[{"src":"s2","dst":"c2","rel":"supports"}]}')

    def test_merge_grows_and_preserves_status(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            eng = Engine(_SequencedLLM([self.TURN1, self.TURN2], nli=0.9), storage_dir=d)

            g1 = eng.ingest_trace("conv", [{"id": "t1", "type": "message", "content": "turn1"}], merge=True)
            eng.verify("conv", only_unscored=True)
            self.assertEqual(len(g1.nodes), 2)
            c1 = next(n for n in g1.nodes.values() if n.content == "Claim one.")
            self.assertEqual(c1.status, NodeStatus.SUPPORTED)

            g2 = eng.ingest_trace("conv", [{"id": "t2", "type": "message", "content": "turn2"}], merge=True)
            # Source one deduped (not duplicated); only s2 + c2 are new.
            self.assertEqual(len(g2.nodes), 4)
            delta = eng.last_delta("conv")
            self.assertEqual(len(delta["new_nodes"]), 2)
            self.assertEqual(len(delta["new_edges"]), 1)

            # Turn 1's claim keeps its SUPPORTED status across the merge.
            c1b = next(n for n in g2.nodes.values() if n.content == "Claim one.")
            self.assertEqual(c1b.status, NodeStatus.SUPPORTED)

            # Incremental verify scores only the new edge, then C2 becomes supported.
            diff = eng.verify("conv", only_unscored=True)
            self.assertEqual(diff["supports_edges_scored"], 1)
            self.assertEqual(diff["supports_edges_total"], 2)
            c2 = next(n for n in g2.nodes.values() if n.content == "Claim two.")
            self.assertEqual(c2.status, NodeStatus.SUPPORTED)

    def test_default_ingest_still_replaces(self):
        # merge=False (default) keeps the original "replace" semantics.
        eng = Engine(_SequencedLLM([self.TURN1, self.TURN2], nli=0.9))
        eng.ingest_trace("conv", [{"id": "t1", "type": "message", "content": "x"}])
        g = eng.ingest_trace("conv", [{"id": "t2", "type": "message", "content": "y"}])
        self.assertEqual(len(g.nodes), 3)  # only turn 2's nodes, turn 1 discarded


class TestSourceClassification(unittest.TestCase):
    """Source type + per-source credibility are extracted, normalised, persisted."""

    def test_extracted_normalised_and_roundtrip(self):
        parsed = {
            "nodes": [
                {"tmp_id": "s", "type": "source", "content": "BBC reported X.", "trace_ref": "t1",
                 "ref": {"url": "https://bbc.com/x"}, "source_type": "News", "credibility": "High"},
                {"tmp_id": "c", "type": "claim", "content": "X holds.", "trace_ref": "t1"},
            ],
            "edges": [{"src": "s", "dst": "c", "rel": "supports"}],
        }
        g = build_graph(parsed, "tid")
        src = next(n for n in g.nodes.values() if n.type == NodeType.SOURCE)
        self.assertEqual(src.source_type, "news")     # lower-cased
        self.assertEqual(src.credibility, "high")
        g2 = provjson.loads(provjson.dumps(g))        # lossless round-trip
        s2 = next(n for n in g2.nodes.values() if n.type == NodeType.SOURCE)
        self.assertEqual(s2.source_type, "news")
        self.assertEqual(s2.credibility, "high")

    def test_bad_credibility_dropped(self):
        parsed = {"nodes": [{"tmp_id": "s", "type": "source", "content": "Y.",
                             "trace_ref": "t", "source_type": "blog", "credibility": "kinda"}],
                  "edges": []}
        src = next(iter(build_graph(parsed, "t").nodes.values()))
        self.assertEqual(src.source_type, "blog")
        self.assertIsNone(src.credibility)            # not in {high,medium,low} -> dropped


if __name__ == "__main__":
    unittest.main(verbosity=2)
