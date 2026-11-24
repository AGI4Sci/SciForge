import os
import tempfile
import unittest
from unittest.mock import patch
from evidence_dag.service import Engine, ReviewDecisionConflict
from evidence_dag.snapshot import build_snapshot
from evidence_dag.artifact_versions import ArtifactVersionRefV1
from evidence_dag.historical_read import SNAPSHOT_LIMIT
from test_human_review import committed_engine

REF = {"artifactId": "artifact:fixture", "versionId": "artifact-version:one", "contentDigest": "a" * 64,
       "byteLength": 1, "availability": "available", "retention": "snapshot",
       "accessPolicy": {"visibility": "workspace", "principals": [], "allowExport": True}}


def publish(engine, version, content, ref=None):
    graph = engine.require("thread")
    node = next(iter(graph.nodes.values()))
    node.content = content
    if ref is not None:
        graph.artifact_version_refs[ref["versionId"]] = ArtifactVersionRefV1.from_dict(ref)
        node.artifact_version_id = ref["versionId"]
    snapshot = build_snapshot(graph, version=version, input_watermark=f"turn:{version}")
    graph.meta["snapshot"] = snapshot.to_dict()
    engine._commit_snapshot(graph, snapshot)
    engine._snapshots["thread"] = snapshot
    return snapshot.digest


class AuditBindingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.engine, self.first, self.packet = committed_engine(os.path.realpath(self.tmp.name))

    def test_current_and_historical_graphs_are_distinct_and_read_only(self):
        second = publish(self.engine, 2, "New claim")
        before = self.engine._event_store.read()
        old = self.engine.graph_read("thread", snapshot_digest=self.first)
        current = self.engine.graph_read("thread")
        self.assertEqual(old["snapshot"]["digest"], self.first)
        self.assertEqual(current["snapshot"]["digest"], second)
        self.assertFalse(old["canReview"])
        self.assertTrue(current["canReview"])
        self.assertTrue(self.engine.graph_read("thread", snapshot_digest=second)["canReview"])
        self.assertNotEqual(old["graph"]["nodes"], current["graph"]["nodes"])
        self.assertEqual(before, self.engine._event_store.read())
        with self.assertRaises(ReviewDecisionConflict):
            self.engine.record_review_decision("thread", self.packet, action="approve",
                expected_snapshot_digest=self.first, actor="fixture", rationale="old")

    def test_missing_forged_and_corrupt_do_not_fall_back(self):
        publish(self.engine, 2, "New claim")
        for digest in ("sha256:" + "0" * 64, "../forged"):
            with self.subTest(digest=digest), self.assertRaises((KeyError, ValueError)):
                self.engine.graph_read("thread", snapshot_digest=digest)
        self.engine.require("thread").nodes.clear()
        with self.assertRaises(ValueError):
            self.engine.graph_read("thread", snapshot_digest=self.engine.latest_snapshot("thread").digest)

    def test_material_full_ref_earliest_snapshot_and_mismatch(self):
        second = publish(self.engine, 2, "Material claim", REF)
        publish(self.engine, 3, "Later analysis", REF)
        result = self.engine.graph_read("thread", artifact_ref=REF)
        self.assertEqual(result["binding"]["snapshotDigest"], second)
        with self.assertRaises(ValueError):
            self.engine.graph_read("thread", snapshot_digest=self.first, artifact_ref=REF)
        with self.assertRaises(ValueError):
            self.engine.graph_read("thread", snapshot_digest=second, artifact_ref={**REF, "byteLength": 2})
        missing = self.engine.graph_read("thread", artifact_ref={**REF, "versionId": "artifact-version:absent"})
        self.assertEqual(missing["binding"]["status"], "missing")

    def test_current_acl_revocation_blocks_historical_reads(self):
        publish(self.engine, 2, "New claim")
        self.engine.require("thread").meta["scope"] = {"accessPolicy": {"read": False}}
        with self.assertRaises(PermissionError):
            self.engine.graph_read("thread", snapshot_digest=self.first)
        with self.assertRaises(PermissionError):
            self.engine.human_review_read("thread", snapshot_digest=self.first)

    def test_draft_cannot_replace_default_published_graph(self):
        with patch.object(self.engine, "provisional_graph", side_effect=AssertionError("draft read")):
            self.assertEqual(self.engine.graph_read("thread")["snapshot"]["digest"], self.first)

    def test_bounded_search_is_missing(self):
        names = [f"1-{i:064x}.prov.json" for i in range(SNAPSHOT_LIMIT + 1)]
        with patch.object(self.engine._storage, "listdir", return_value=names):
            result = self.engine.graph_read("thread", artifact_ref=REF)
        self.assertEqual(result["binding"], {"status": "missing", "reason": "snapshot_search_bounded"})

    def test_cold_read_loads_persisted_history_without_model(self):
        second = publish(self.engine, 2, "New claim")
        cold = Engine(storage_dir=os.path.realpath(self.tmp.name))
        self.assertIsNone(cold.llm)
        self.assertEqual(cold.graph_read("thread", snapshot_digest=self.first)["snapshot"]["digest"], self.first)
        self.assertFalse(cold.graph_read("thread", snapshot_digest=self.first)["canReview"])
        self.assertTrue(cold.graph_read("thread", snapshot_digest=second)["canReview"])
