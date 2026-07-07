"""Offline tests for Evidence Audit Runs."""
from __future__ import annotations

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from evidence_dag.audit import run_audit  # noqa: E402
from evidence_dag.graph import ThreadGraph  # noqa: E402
from evidence_dag.model import EdgeRel, NodeStatus, NodeType  # noqa: E402
from evidence_dag.service import Engine  # noqa: E402


def _graph_with_risks() -> ThreadGraph:
    g = ThreadGraph("audit-thread")
    low = g.add_or_get_node(
        NodeType.SOURCE,
        "A low-quality blog claims X.",
        source_type="blog",
        credibility="low",
    )
    support = g.add_or_get_node(NodeType.SOURCE, "Paper A supports X.")
    contra = g.add_or_get_node(NodeType.SOURCE, "Paper B refutes X.")
    claim = g.add_or_get_node(NodeType.CLAIM, "X is established.")
    ungrounded = g.add_or_get_node(NodeType.CLAIM, "Y is established without evidence.")
    claim.status = NodeStatus.CONFLICTING
    g.add_edge(low.id, claim.id, EdgeRel.SUPPORTS, nli_score=0.2)
    g.add_edge(support.id, claim.id, EdgeRel.SUPPORTS, nli_score=0.2)
    g.add_edge(contra.id, claim.id, EdgeRel.CONTRADICTS, nli_score=0.9)
    return g


class TestEvidenceAuditRun(unittest.TestCase):
    def test_audit_generates_actionable_findings(self):
        run = run_audit(_graph_with_risks(), run_id="audit:test", threshold=0.7)
        self.assertEqual(run["status"], "completed")
        self.assertIsInstance(run["dag_digest"], str)
        self.assertEqual(run["risk_digest"]["highest_severity"], "blocker")
        types = {finding["finding_type"] for finding in run["findings"]}
        self.assertIn("missing_evidence", types)
        self.assertIn("contradiction", types)
        self.assertIn("weak_support", types)
        self.assertIn("low_credibility_source", types)

    def test_engine_persists_audit_runs(self):
        with tempfile.TemporaryDirectory() as d:
            eng = Engine(storage_dir=d)
            graph = _graph_with_risks()
            eng._graphs[graph.thread_id] = graph
            run = eng.audit(graph.thread_id, trigger="manual")
            self.assertEqual(run["trigger"], "manual")
            self.assertTrue(os.path.exists(os.path.join(d, "audit-thread.audit.json")))

            eng2 = Engine(storage_dir=d)
            runs = eng2.audit_runs(graph.thread_id)
            self.assertEqual(len(runs), 1)
            self.assertEqual(runs[0]["id"], run["id"])

    def test_auto_audit_reuses_unchanged_dag_digest(self):
        eng = Engine()
        graph = _graph_with_risks()
        eng._graphs[graph.thread_id] = graph

        first = eng.audit(graph.thread_id, trigger="auto")
        second = eng.audit(graph.thread_id, trigger="auto")

        self.assertEqual(first["id"], second["id"])
        self.assertEqual(len(eng.audit_runs(graph.thread_id)), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
