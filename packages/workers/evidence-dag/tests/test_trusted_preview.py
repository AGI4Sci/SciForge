from __future__ import annotations

import json
import os
import tempfile
import threading
import unittest
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer

from evidence_dag.llm import StubLLM
from evidence_dag.model import NodeType
from evidence_dag.server import Handler
from evidence_dag.service import Engine


def _extract_payload() -> str:
    return json.dumps({
        "nodes": [
            {
                "tmp_id": "source",
                "type": "source_assertion",
                "content": "The local file reports a measured effect.",
                "trace_ref": "item-1",
                "source_type": "dataset",
                "artifact": {"kind": "dataset", "locator": "evidence/source.txt"},
                "selector": {
                    "type": "text",
                    "lineRange": "1:1",
                    "quote": "measured effect",
                },
            },
            {
                "tmp_id": "claim",
                "type": "claim",
                "content": "A measured effect was observed.",
                "trace_ref": "item-1",
            },
        ],
        "edges": [{"src": "source", "dst": "claim", "rel": "supports"}],
    })


class TestTrustedEvidencePreview(unittest.TestCase):
    def _committed(self, workspace: str, *, access_policy=None):
        os.makedirs(os.path.join(workspace, "evidence"), exist_ok=True)
        with open(os.path.join(workspace, "evidence", "source.txt"), "w", encoding="utf-8") as fh:
            fh.write("measured effect\n")
        engine = Engine(
            StubLLM(extract_response=_extract_payload(), nli_handler=lambda _p, _h: 0.95),
            storage_dir=os.path.join(workspace, ".edag"),
        )
        result = engine.update(
            thread_id="codex:thread-1",
            target_watermark="item-1",
            reason="turn_committed",
            priority="P2",
            trace=[{"id": "item-1", "type": "message", "content": "result"}],
            workspace_root=workspace,
            project_root=workspace,
            project_key=workspace,
            access_policy=access_policy,
        )
        source = engine.require("codex:thread-1").nodes_of(NodeType.SOURCE_ASSERTION)[0]
        return engine, result["snapshot"], source

    def test_refetches_only_the_exact_tuple_from_the_verified_snapshot(self):
        with tempfile.TemporaryDirectory() as workspace:
            engine, snapshot, source = self._committed(workspace)
            resolved = engine.trusted_evidence_preview(
                "codex:thread-1",
                snapshot_digest=snapshot["digest"],
                source_assertion_id=source.id,
                artifact_version_id=source.artifact_version_id or "",
                source_anchor_id=source.source_anchor_id or "",
            )
            self.assertTrue(resolved["resolved"])
            self.assertEqual(resolved["snapshotDigest"], snapshot["digest"])
            self.assertEqual(resolved["workspaceRoot"], workspace)
            self.assertEqual(resolved["sourceAssertion"]["id"], source.id)
            self.assertEqual(resolved["artifactVersion"]["locator"], "evidence/source.txt")
            self.assertEqual(resolved["sourceAnchor"]["selector"]["lineRange"], "1:1")
            self.assertTrue(resolved["artifactVersion"]["contentDigest"].startswith("sha256:"))

    def test_rejects_stale_snapshot_and_tuple_without_returning_registry_records(self):
        with tempfile.TemporaryDirectory() as workspace:
            engine, snapshot, source = self._committed(workspace)
            stale = engine.trusted_evidence_preview(
                "codex:thread-1",
                snapshot_digest="sha256:" + "0" * 64,
                source_assertion_id=source.id,
                artifact_version_id=source.artifact_version_id or "",
                source_anchor_id=source.source_anchor_id or "",
            )
            mismatch = engine.trusted_evidence_preview(
                "codex:thread-1",
                snapshot_digest=snapshot["digest"],
                source_assertion_id=source.id,
                artifact_version_id="artifact-version:other",
                source_anchor_id=source.source_anchor_id or "",
            )
            self.assertEqual(stale, {
                "resolved": False,
                "code": "snapshot_mismatch",
                "message": "Pinned committed Evidence Snapshot was not found or failed verification.",
            })
            self.assertFalse(mismatch["resolved"])
            self.assertEqual(mismatch["code"], "provenance_mismatch")
            self.assertNotIn("artifactVersion", mismatch)

    def test_recomputes_the_snapshot_digest_before_exposing_a_cached_tuple(self):
        with tempfile.TemporaryDirectory() as workspace:
            engine, snapshot, source = self._committed(workspace)
            graph = engine.require("codex:thread-1")
            graph.artifact_versions[source.artifact_version_id or ""].locator = "../tampered.txt"

            resolved = engine.trusted_evidence_preview(
                "codex:thread-1",
                snapshot_digest=snapshot["digest"],
                source_assertion_id=source.id,
                artifact_version_id=source.artifact_version_id or "",
                source_anchor_id=source.source_anchor_id or "",
            )
            self.assertFalse(resolved["resolved"])
            self.assertEqual(resolved["code"], "snapshot_mismatch")
            self.assertNotIn("artifactVersion", resolved)

    def test_reads_a_historical_committed_snapshot_without_falling_forward(self):
        with tempfile.TemporaryDirectory() as workspace:
            engine, first, source = self._committed(workspace)
            second = engine.update(
                thread_id="codex:thread-1",
                target_watermark="item-2",
                reason="manual_update",
                priority="P2",
                trace=None,
                workspace_root=workspace,
                project_root=workspace,
                project_key=workspace,
            )["snapshot"]
            self.assertNotEqual(first["digest"], second["digest"])

            resolved = engine.trusted_evidence_preview(
                "codex:thread-1",
                snapshot_digest=first["digest"],
                source_assertion_id=source.id,
                artifact_version_id=source.artifact_version_id or "",
                source_anchor_id=source.source_anchor_id or "",
            )
            self.assertTrue(resolved["resolved"])
            self.assertEqual(resolved["snapshotDigest"], first["digest"])

    def test_returns_committed_scope_acl_for_main_process_enforcement(self):
        with tempfile.TemporaryDirectory() as workspace:
            engine, snapshot, source = self._committed(
                workspace, access_policy={"redacted": True, "read": False},
            )
            resolved = engine.trusted_evidence_preview(
                "codex:thread-1",
                snapshot_digest=snapshot["digest"],
                source_assertion_id=source.id,
                artifact_version_id=source.artifact_version_id or "",
                source_anchor_id=source.source_anchor_id or "",
            )
            self.assertTrue(resolved["resolved"])
            self.assertEqual(resolved["accessPolicy"], {"redacted": True, "read": False})

    def test_authenticated_http_endpoint_returns_the_verified_tuple(self):
        with tempfile.TemporaryDirectory() as workspace:
            engine, snapshot, source = self._committed(workspace)
            previous_engine, previous_token = Handler.engine, Handler.api_token
            Handler.engine = engine
            Handler.api_token = "preview-test-token"
            server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                query = urllib.parse.urlencode({
                    "snapshotDigest": snapshot["digest"],
                    "sourceAssertionId": source.id,
                    "artifactVersionId": source.artifact_version_id or "",
                    "sourceAnchorId": source.source_anchor_id or "",
                })
                thread_id = urllib.parse.quote("codex:thread-1", safe="")
                request = urllib.request.Request(
                    f"http://127.0.0.1:{server.server_port}/threads/{thread_id}/evidence-preview?{query}",
                    headers={"Authorization": "Bearer preview-test-token"},
                )
                with urllib.request.urlopen(request, timeout=2) as response:
                    body = json.loads(response.read().decode("utf-8"))
                self.assertTrue(body["ok"])
                self.assertTrue(body["data"]["resolved"])
                self.assertEqual(body["data"]["snapshotDigest"], snapshot["digest"])
                self.assertEqual(body["data"]["artifactVersion"]["locator"], "evidence/source.txt")
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)
                Handler.engine, Handler.api_token = previous_engine, previous_token


if __name__ == "__main__":
    unittest.main()
