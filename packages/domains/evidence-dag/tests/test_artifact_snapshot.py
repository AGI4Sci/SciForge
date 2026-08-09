"""Evidence snapshot invariants after Artifact Registry ownership was removed."""
from __future__ import annotations

import json
import os
import tempfile
import threading
import unittest

from evidence_dag.artifact_versions import digest_bytes
from evidence_dag.llm import StubLLM
from evidence_dag.model import NodeType, make_node_id
from evidence_dag.service import Engine


def _extract_payload() -> str:
    return json.dumps({
        "nodes": [
            {
                "tmp_id": "s", "type": "source_assertion",
                "content": "The paper reports a result.", "trace_ref": "item-1",
                "source_type": "paper", "credibility": "high",
            },
            {
                "tmp_id": "c", "type": "claim",
                "content": "The result supports the claim.", "trace_ref": "item-1",
            },
        ],
        "edges": [{"src": "s", "dst": "c", "rel": "supports"}],
    })


class TestEvidenceSnapshots(unittest.TestCase):
    def test_semantic_id_never_reuses_artifact_digest(self):
        semantic_id = make_node_id(NodeType.CLAIM, "A normalized scientific claim")
        artifact_digest = digest_bytes(b"A normalized scientific claim")
        self.assertNotEqual(semantic_id, artifact_digest)
        self.assertTrue(semantic_id.startswith("claim:"))
        self.assertTrue(artifact_digest.startswith("sha256:"))

    def test_snapshots_remain_immutable_and_identical_input_is_idempotent(self):
        with tempfile.TemporaryDirectory() as workspace:
            storage = os.path.join(workspace, ".edag")
            llm = StubLLM(
                extract_response=_extract_payload(), nli_handler=lambda _p, _h: 0.9,
            )
            engine = Engine(llm, storage_dir=storage)
            command = dict(
                thread_id="t", target_watermark="w1", reason="turn_committed",
                priority="P2",
                trace=[{"id": "item-1", "type": "message", "content": "result"}],
                workspace_root=workspace, project_root=workspace,
            )
            first = engine.update(**command)
            calls = len(llm.calls)
            repeated = engine.update(**command)
            self.assertTrue(repeated["idempotent"])
            self.assertEqual(len(llm.calls), calls)
            self.assertEqual(repeated["snapshot"]["digest"], first["snapshot"]["digest"])

            immutable = os.path.join(
                engine._snapshot_dir("t"),
                f"00000001-{first['snapshot']['digest'][7:]}.prov.json",
            )
            with open(immutable, encoding="utf-8") as handle:
                original = handle.read()
            second = engine.update(
                thread_id="t", target_watermark="w2", reason="manual_update",
                priority="P2", trace=None, workspace_root=workspace,
                project_root=workspace,
            )
            self.assertEqual(second["snapshot"]["version"], 2)
            with open(immutable, encoding="utf-8") as handle:
                self.assertEqual(handle.read(), original)
            restarted = Engine(storage_dir=storage)
            self.assertEqual(
                restarted.require("t").meta["snapshot"]["digest"],
                second["snapshot"]["digest"],
            )
            self.assertEqual(restarted.list_threads(), ["t"])

    def test_failed_concurrent_update_never_exposes_partial_graph(self):
        class BlockingFailure:
            def __init__(self):
                self.entered = threading.Event()
                self.release = threading.Event()

            def chat(self, _messages, *, temperature=0.0, max_tokens=2048):
                self.entered.set()
                self.release.wait(timeout=5)
                raise RuntimeError("injected compiler failure")

        with tempfile.TemporaryDirectory() as workspace:
            engine = Engine(
                StubLLM(extract_response=_extract_payload(), nli_handler=lambda _p, _h: 0.9),
                storage_dir=os.path.join(workspace, ".edag"),
            )
            first = engine.update(
                thread_id="t", target_watermark="w1", reason="turn_committed",
                priority="P2",
                trace=[{"id": "item-1", "type": "message", "content": "result"}],
                workspace_root=workspace, project_root=workspace,
            )
            old_graph = engine.require("t").to_dict()
            blocker = BlockingFailure()
            engine.llm = blocker
            errors = []

            def compile_update():
                try:
                    engine.update(
                        thread_id="t", target_watermark="w2", reason="turn_committed",
                        priority="P2",
                        trace=[{"id": "item-2", "type": "message", "content": "new"}],
                        workspace_root=workspace, project_root=workspace,
                    )
                except Exception as error:  # expected injected failure
                    errors.append(error)

            worker = threading.Thread(target=compile_update)
            worker.start()
            self.assertTrue(blocker.entered.wait(timeout=2))
            self.assertEqual(engine.latest_snapshot("t").digest, first["snapshot"]["digest"])
            self.assertEqual(engine.require("t").to_dict(), old_graph)
            blocker.release.set()
            worker.join(timeout=5)
            self.assertEqual(len(errors), 1)
            self.assertEqual(engine.require("t").to_dict(), old_graph)


if __name__ == "__main__":
    unittest.main()
