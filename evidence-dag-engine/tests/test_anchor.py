"""trace_ref anchor-repair tests: every node must end up pointing at a REAL
trace item id even when the LLM invents/abbreviates ids."""
from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from evidence_dag.extractor import build_graph, resolve_trace_refs  # noqa: E402
from evidence_dag.model import NodeType  # noqa: E402

TRACE = [
    {"id": "item_a1", "type": "tool_result", "tool_name": "web_search",
     "output": "A 2003 meta-analysis found creatine increases strength versus placebo."},
    {"id": "item_b2", "type": "message", "role": "assistant",
     "content": "Creatine is effective for increasing muscle strength."},
]

# LLM output with WRONG ids (invented "step-N", as observed live)
PARSED = {
    "nodes": [
        {"tmp_id": "s", "type": "source", "trace_ref": "step-1",
         "content": "A 2003 meta-analysis found creatine increases strength versus placebo."},
        {"tmp_id": "c", "type": "claim", "trace_ref": "step-2",
         "content": "Creatine is effective for increasing muscle strength."},
    ],
    "edges": [{"src": "s", "dst": "c", "rel": "supports"}],
}


class TestAnchorRepair(unittest.TestCase):
    def test_invalid_refs_repaired_to_real_ids(self):
        g = build_graph(PARSED, "t")
        # before repair: bogus ids
        self.assertEqual({n.trace_ref for n in g.nodes.values()}, {"step-1", "step-2"})
        repaired = resolve_trace_refs(g, TRACE)
        self.assertEqual(repaired, 2)
        refs = {n.type: n.trace_ref for n in g.nodes.values()}
        self.assertEqual(refs[NodeType.SOURCE], "item_a1")
        self.assertEqual(refs[NodeType.CLAIM], "item_b2")

    def test_valid_refs_left_untouched(self):
        parsed = {"nodes": [{"tmp_id": "s", "type": "source", "trace_ref": "item_a1",
                             "content": "totally unrelated text xyz"}], "edges": []}
        g = build_graph(parsed, "t")
        self.assertEqual(resolve_trace_refs(g, TRACE), 0)  # already valid -> no change
        self.assertEqual(next(iter(g.nodes.values())).trace_ref, "item_a1")

    def test_no_false_anchor_when_no_overlap(self):
        parsed = {"nodes": [{"tmp_id": "x", "type": "claim", "trace_ref": "bogus",
                             "content": "zzz qqq vvv nothing matches"}], "edges": []}
        g = build_graph(parsed, "t")
        resolve_trace_refs(g, TRACE)  # below min_overlap -> stays bogus, not mis-anchored
        self.assertEqual(next(iter(g.nodes.values())).trace_ref, "bogus")


if __name__ == "__main__":
    unittest.main(verbosity=2)
