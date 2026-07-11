"""Committed Evidence Snapshot integrity checks at the Project DAG boundary."""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
import unittest

from evidence_dag import provjson
from evidence_dag.graph import ThreadGraph
from evidence_dag.model import (
    Artifact,
    ArtifactVersion,
    EdgeRel,
    NodeStatus,
    NodeType,
    SourceAnchor,
    SourceSelector,
)
from evidence_dag.snapshot import build_snapshot, snapshot_filename, snapshot_storage_key
from project_dag.reader import SessionReader


def _sha(value: str) -> str:
    return "sha256:" + hashlib.sha256(value.encode("utf-8")).hexdigest()


def _snapshot_document(thread_id: str, *, version: int, source_text: str) -> tuple[dict, dict]:
    graph = ThreadGraph(thread_id)
    artifact_id = "artifact:test-paper"
    artifact_version_id = "artifact-version:test-paper-v1"
    anchor_id = "anchor:test-paper-page-2"
    artifact = Artifact(
        artifact_id=artifact_id,
        kind="paper",
        created_at="2026-07-11T00:00:00Z",
        current_version_id=artifact_version_id,
    )
    artifact_version = ArtifactVersion(
        version_id=artifact_version_id,
        artifact_id=artifact_id,
        locator="papers/test.pdf",
        content_digest=_sha("test PDF bytes"),
        version="v1",
        size=14,
        media_type="application/pdf",
        observed_at="2026-07-11T00:00:00Z",
        availability="available",
        retention="reference",
    )
    anchor = SourceAnchor(
        anchor_id=anchor_id,
        artifact_id=artifact_id,
        artifact_version_id=artifact_version_id,
        selector=SourceSelector(type="pdf", page=2, quote=source_text),
        anchor_digest=_sha(source_text),
        created_at="2026-07-11T00:00:00Z",
    )
    graph.attach_registry_records(
        artifact=artifact,
        artifact_version=artifact_version,
        source_anchor=anchor,
    )
    source = graph.add_or_get_node(
        NodeType.SOURCE_ASSERTION,
        source_text,
        artifact_id=artifact_id,
        artifact_version_id=artifact_version_id,
        source_anchor_id=anchor_id,
        status=NodeStatus.SUPPORTED,
    )
    claim = graph.add_or_get_node(
        NodeType.CLAIM,
        "The test result is supported.",
        status=NodeStatus.SUPPORTED,
    )
    graph.add_edge(source.id, claim.id, EdgeRel.SUPPORTS, nli_score=0.95)
    snapshot = build_snapshot(graph, version=version, input_watermark=f"turn:{version}")
    graph.meta["snapshot"] = snapshot.to_dict()
    return json.loads(provjson.dumps(graph)), snapshot.to_dict()


class SessionReaderIntegrityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.reader = SessionReader(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _write_current(self, thread_id: str, document: dict) -> None:
        path = os.path.join(self.tmp.name, snapshot_filename(thread_id))
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(document, handle, ensure_ascii=False)

    def _write_historical(self, thread_id: str, digest: str, document: dict) -> None:
        directory = os.path.join(self.tmp.name, "snapshots", snapshot_storage_key(thread_id))
        os.makedirs(directory, exist_ok=True)
        path = os.path.join(directory, f"00000001-{digest[7:]}.prov.json")
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(document, handle, ensure_ascii=False)

    def test_valid_current_snapshot_is_compatible(self) -> None:
        thread_id = "sciforge:integrity-current"
        document, snapshot = _snapshot_document(thread_id, version=1, source_text="Measured effect")
        self._write_current(thread_id, document)

        graph, loaded, _ = self.reader.load(thread_id, snapshot["digest"])

        self.assertEqual(loaded.digest, snapshot["digest"])
        self.assertEqual(graph.thread_id, thread_id)

    def test_rejects_tampered_graph_with_unchanged_envelope_digest(self) -> None:
        thread_id = "sciforge:integrity-graph"
        document, snapshot = _snapshot_document(thread_id, version=1, source_text="Measured effect")
        claim = next(
            value for value in document["entity"].values()
            if value.get("prov:type") == "edag:claim"
        )
        claim["edag:content"] = "Tampered claim content"
        self._write_current(thread_id, document)

        with self.assertRaisesRegex(ValueError, "Evidence Snapshot digest mismatch"):
            self.reader.load(thread_id, snapshot["digest"])

    def test_rejects_tampered_registry_and_artifact_digest_envelope(self) -> None:
        thread_id = "sciforge:integrity-registry"
        document, snapshot = _snapshot_document(thread_id, version=1, source_text="Measured effect")
        registry = document["edag:artifactRegistry"]
        registry["artifactVersions"][0]["locator"] = "papers/replaced.pdf"
        self._write_current(thread_id, document)
        with self.assertRaisesRegex(ValueError, "Evidence Snapshot digest mismatch"):
            self.reader.load(thread_id, snapshot["digest"])

        document, snapshot = _snapshot_document(thread_id, version=1, source_text="Measured effect")
        document["edag:meta"]["snapshot"]["artifactDigests"] = [_sha("unrelated bytes")]
        self._write_current(thread_id, document)
        with self.assertRaisesRegex(ValueError, "artifactDigests mismatch"):
            self.reader.load(thread_id, snapshot["digest"])

    def test_historical_snapshot_is_also_verified_after_digest_fallback(self) -> None:
        thread_id = "sciforge:integrity-history"
        historical, first = _snapshot_document(thread_id, version=1, source_text="Original result")
        current, second = _snapshot_document(thread_id, version=2, source_text="Updated result")
        claim = next(
            value for value in historical["entity"].values()
            if value.get("prov:type") == "edag:claim"
        )
        claim["edag:content"] = "Tampered historical claim"
        self._write_historical(thread_id, first["digest"], historical)
        self._write_current(thread_id, current)

        self.assertNotEqual(first["digest"], second["digest"])
        with self.assertRaisesRegex(ValueError, "Evidence Snapshot digest mismatch"):
            self.reader.load(thread_id, first["digest"])


if __name__ == "__main__":
    unittest.main()
